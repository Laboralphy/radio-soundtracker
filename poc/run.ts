/**
 * Proof of concept: VLC renders the sound, src/libs/broadcast/frames.ts renders the images, ffmpeg merges them.
 *
 *   VLC ──► PulseAudio null sink "radio_poc" ──► ffmpeg input 0 (radio_poc.monitor)
 *   src/libs/broadcast/frames.ts ──► raw RGBA on a pipe ──► ffmpeg input 1 ──► test.flv
 *
 * Usage: node --import tsx poc/run.ts [--music DIR] [--duration SECONDS] [--out FILE]
 * Needs: pactl (PulseAudio or PipeWire), cvlc, ffmpeg.
 */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { VLCControl } from '../src/libs/vlc-control/VLCControl.js';
import { ProgramPlayer } from '../src/libs/vlc-control/ProgramPlayer.js';
import { Program } from '../src/libs/vlc-control/Program.js';
import { EVENTS } from '../src/libs/vlc-control/consts.js';

const { values: args } = parseArgs({
    options: {
        music: { type: 'string', default: path.join(os.homedir(), 'Musique', 'mods') },
        duration: { type: 'string', default: '60' },
        out: { type: 'string', default: path.join('poc', 'out', 'test.flv') },
    },
});

const SINK = 'radio_poc';
const RC_PORT = 4322;
const WIDTH = 854;
const HEIGHT = 480;
const FPS = 30;

const log = (message: string) => console.log(`[poc] ${message}`);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function waitExit(child: ChildProcess, ms: number): Promise<void> {
    return new Promise(resolve => {
        if (child.exitCode !== null || child.signalCode !== null) {
            resolve();
            return;
        }
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            resolve();
        }, ms);
        child.once('exit', () => {
            clearTimeout(timer);
            resolve();
        });
    });
}

mkdirSync(path.dirname(args.out), { recursive: true });
const ffmpegLog = createWriteStream(path.join(path.dirname(args.out), 'ffmpeg.log'));

// 1. virtual sound card: VLC plays into it, ffmpeg records its ".monitor"
const sinkModule = execFileSync('pactl', [
    'load-module', 'module-null-sink', `sink_name=${SINK}`, `sink_properties=device.description=${SINK}`,
]).toString().trim();
log(`virtual sink "${SINK}" created (module ${sinkModule})`);

// 2. VLC, sound sent to the virtual sink
const vlcProcess = spawn('cvlc', ['--aout', 'pulse', '--extraintf', 'rc', '--rc-host', `localhost:${RC_PORT}`], {
    env: { ...process.env, PULSE_SINK: SINK },
    stdio: 'ignore',
});

// 3. the image program
const framesProcess = spawn(process.execPath, ['--import', 'tsx', path.join('src', 'libs', 'broadcast', 'frames.ts'), `${WIDTH}`, `${HEIGHT}`, `${FPS}`], {
    stdio: ['pipe', 'pipe', 'inherit'],
});

// 4. ffmpeg: audio from the sink monitor, video from the frames pipe, both stamped with the real clock
const ffmpegProcess = spawn('ffmpeg', [
    '-hide_banner', '-y',
    '-thread_queue_size', '1024', '-f', 'pulse', '-i', `${SINK}.monitor`,
    '-thread_queue_size', '64', '-use_wallclock_as_timestamps', '1',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${WIDTH}x${HEIGHT}`, '-r', `${FPS}`, '-i', 'pipe:0',
    '-map', '1:v', '-map', '0:a',
    '-fps_mode', 'cfr', '-r', `${FPS}`,
    '-af', 'aresample=async=1',
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-g', `${FPS * 2}`, '-b:v', '1500k',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '44100',
    '-f', 'flv', args.out,
], { stdio: ['pipe', 'ignore', 'pipe'] });
ffmpegProcess.stderr!.pipe(ffmpegLog);
framesProcess.stdout!.pipe(ffmpegProcess.stdin!);
ffmpegProcess.stdin!.on('error', () => {});

let cleaningUp = false;
const vlc = new VLCControl({ port: RC_PORT });
const player = new ProgramPlayer({ vlc });

async function cleanup(): Promise<void> {
    if (cleaningUp) return;
    cleaningUp = true;
    log('stopping');
    await player.stop().catch(() => {});
    // SIGINT lets ffmpeg finish the file properly
    ffmpegProcess.kill('SIGINT');
    await waitExit(ffmpegProcess, 5000);
    framesProcess.kill();
    vlcProcess.kill();
    await Promise.all([waitExit(framesProcess, 2000), waitExit(vlcProcess, 2000)]);
    execFileSync('pactl', ['unload-module', sinkModule]);
    log(`virtual sink removed; output: ${args.out}`);
}

process.once('SIGINT', () => void cleanup().then(() => process.exit(0)));
ffmpegProcess.once('exit', code => {
    if (!cleaningUp) {
        log(`ffmpeg exited early (code ${code}), see ${path.dirname(args.out)}/ffmpeg.log`);
        void cleanup().then(() => process.exit(1));
    }
});

async function main(): Promise<void> {
    // wait for VLC's RC interface
    for (let i = 0; ; ++i) {
        try {
            await vlc.getStatus();
            break;
        } catch (err) {
            if (i >= 20) throw err;
            await sleep(250);
        }
    }

    player.events.on(EVENTS.EVENT_NEW_SONG, ({ title, file, remainingTime }: { title: string; file: string; remainingTime: number }) => {
        log(`now playing: ${title || path.basename(file)} (${remainingTime}s)`);
        framesProcess.stdin!.write(JSON.stringify({ title, file, elapsed: 0, duration: remainingTime }) + '\n');
    });

    const program = new Program();
    program.addFolder(args.music, { shuffle: true, recursive: true });

    log(`recording ${args.duration}s to ${args.out}`);
    const timer = setTimeout(() => void cleanup().then(() => process.exit(0)), Number(args.duration) * 1000);
    await player.playProgram(program);
    clearTimeout(timer);
    await cleanup();
}

main().catch(async err => {
    console.error('[poc] failed:', err);
    await cleanup();
    process.exit(1);
});
