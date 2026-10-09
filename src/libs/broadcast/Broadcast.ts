import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { NullSink } from './NullSink.js';
import { buildEncoderArgs, redactOutput } from './encoder.js';
import type { StandbyInfo } from './StandbyMonitor.js';
import type { VLCControl } from '../vlc-control/VLCControl.js';
import { logger } from '../logger/index.js';

export interface BroadcastOptions {
    sink: string;
    width: number;
    height: number;
    fps: number;
    videoBitrate: string;
    audioBitrate: string;
    output: string;
    /**
     * Used to check that VLC answers, and to start it if startVlc is set.
     */
    vlc: VLCControl;
    vlcHost: string;
    vlcPort: number;
    /**
     * Start a VLC that plays into the sink. Otherwise, VLC must already run with PULSE_SINK set to the sink.
     */
    startVlc: boolean;
    /**
     * Where ffmpeg's messages are appended.
     */
    ffmpegLog: string;
}

export interface SongInfo {
    title: string;
    file: string;
    elapsed: number;
    duration: number;
    next: string | null;
    program: string;
}

export const BROADCAST_EVENTS = {
    /**
     * A process the broadcast depends on exited on its own. Payload: a message.
     */
    EVENT_FATAL: 'EVENT_FATAL',
} as const;

const VLC_START_ATTEMPTS = 20;
const VLC_START_INTERVAL = 250;

// the image program sits next to this file; it is a .ts file under tsx and a .js file once built
const thisFile = fileURLToPath(import.meta.url);
const FRAMES_PROGRAM = path.join(path.dirname(thisFile), `frames${path.extname(thisFile)}`);

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Children get their own process group, so a Ctrl+C or a signal sent to our group does not reach them:
 * stop() stops them in order instead. A second SIGINT would make ffmpeg quit without finishing its output.
 */
const CHILD_OPTIONS = { detached: true } as const;

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

/**
 * Runs the processes that turn VLC's sound into a video stream:
 *
 *   VLC ──► null sink ──► ffmpeg input 0 (sink monitor)
 *   image program ──► raw RGBA on a pipe ──► ffmpeg input 1 ──► output (file or RTMP)
 *
 * ffmpeg is started once and must never restart between songs: song changes only reach the
 * image program, through setSong(). If any of these processes exits on its own, EVENT_FATAL is
 * emitted and the caller is expected to stop everything (a supervisor then restarts the radio).
 */
export class Broadcast {
    readonly events = new EventEmitter();
    private readonly _options: BroadcastOptions;
    private readonly _sink: NullSink;
    private _vlcProcess: ChildProcess | null = null;
    private _framesProcess: ChildProcess | null = null;
    private _ffmpegProcess: ChildProcess | null = null;
    private _ffmpegLog: WriteStream | null = null;
    private _stopping = false;

    constructor(options: BroadcastOptions) {
        this._options = options;
        this._sink = new NullSink(options.sink);
    }

    async start(): Promise<void> {
        const o = this._options;
        // children live in their own process group: do not leave them behind if Node exits without stop()
        process.once('exit', this._killChildren);
        await this._sink.acquire();
        if (o.startVlc) {
            await this._startVlc();
        } else {
            await o.vlc.getStatus();
            logger.warn(`Using a running VLC: it must play into the "${o.sink}" sink (PULSE_SINK=${o.sink} cvlc --aout pulse ...)`);
        }
        this._startEncoder();
        logger.info(`Broadcasting ${o.width}x${o.height} at ${o.fps} fps to ${redactOutput(o.output)}`);
    }

    /**
     * Tells the image program what is playing now.
     */
    setSong(song: SongInfo): void {
        this._send({ type: 'song', ...song });
    }

    /**
     * Tells the image program that nothing plays, and why.
     */
    setStandby(info: StandbyInfo): void {
        this._send({ type: 'standby', ...info });
    }

    private _send(message: object): void {
        const stdin = this._framesProcess?.stdin;
        if (stdin && stdin.writable) {
            stdin.write(JSON.stringify(message) + '\n');
        }
    }

    /**
     * Stops ffmpeg (letting it finish the output), the image program and the VLC it started,
     * then removes the sink if it was created by start(). Safe to call more than once.
     */
    async stop(): Promise<void> {
        if (this._stopping) {
            return;
        }
        this._stopping = true;
        if (this._framesProcess) {
            this._framesProcess.kill();
            await waitExit(this._framesProcess, 2000);
        }
        if (this._ffmpegProcess) {
            // ffmpeg ignores SIGINT while waiting for frames: closing its input first ends that wait.
            // SIGINT then lets it write the end of the file.
            this._ffmpegProcess.stdin?.destroy();
            this._ffmpegProcess.kill('SIGINT');
            await waitExit(this._ffmpegProcess, 5000);
        }
        if (this._vlcProcess) {
            this._vlcProcess.kill();
            await waitExit(this._vlcProcess, 2000);
        }
        const ffmpegLog = this._ffmpegLog;
        this._ffmpegLog = null;
        ffmpegLog?.end();
        await this._sink.release();
        process.off('exit', this._killChildren);
    }

    private readonly _killChildren = (): void => {
        for (const child of [this._ffmpegProcess, this._framesProcess, this._vlcProcess]) {
            if (child && child.exitCode === null && child.signalCode === null) {
                child.kill('SIGKILL');
            }
        }
    };

    private _watch(child: ChildProcess, name: string): void {
        child.once('exit', (code, signal) => {
            if (!this._stopping) {
                this.events.emit(BROADCAST_EVENTS.EVENT_FATAL, `${name} exited (${signal ?? `code ${code}`})`);
            }
        });
        child.once('error', err => {
            if (!this._stopping) {
                this.events.emit(BROADCAST_EVENTS.EVENT_FATAL, `${name} failed: ${err.message}`);
            }
        });
    }

    private async _startVlc(): Promise<void> {
        const o = this._options;
        // a VLC already on this port would answer instead of ours, and ours would not play into the sink
        const alreadyRunning = await o.vlc.getStatus().then(() => true, () => false);
        if (alreadyRunning) {
            throw new Error(`A VLC is already listening on ${o.vlcHost}:${o.vlcPort}. Stop it, or use --external-vlc.`);
        }
        this._vlcProcess = spawn('cvlc', ['--aout', 'pulse', '--extraintf', 'rc', '--rc-host', `${o.vlcHost}:${o.vlcPort}`], {
            ...CHILD_OPTIONS,
            env: { ...process.env, PULSE_SINK: o.sink },
            stdio: 'ignore',
        });
        this._watch(this._vlcProcess, 'VLC');
        for (let attempt = 1; ; ++attempt) {
            try {
                await o.vlc.getStatus();
                break;
            } catch (err) {
                if (attempt >= VLC_START_ATTEMPTS || this._vlcProcess.exitCode !== null) {
                    throw new Error(`VLC did not start: ${err}`);
                }
                await sleep(VLC_START_INTERVAL);
            }
        }
        logger.info(`Started VLC on ${o.vlcHost}:${o.vlcPort}, playing into "${o.sink}"`);
    }

    private _startEncoder(): void {
        const o = this._options;

        mkdirSync(path.dirname(o.ffmpegLog), { recursive: true });
        this._ffmpegLog = createWriteStream(o.ffmpegLog, { flags: 'a' });
        this._ffmpegProcess = spawn('ffmpeg', buildEncoderArgs({
            audioSource: this._sink.monitor,
            width: o.width,
            height: o.height,
            fps: o.fps,
            videoBitrate: o.videoBitrate,
            audioBitrate: o.audioBitrate,
            output: o.output,
        }), { ...CHILD_OPTIONS, stdio: ['pipe', 'ignore', 'pipe'] });
        this._watch(this._ffmpegProcess, 'ffmpeg');

        // the image program writes straight into ffmpeg's stdin: the frames (tens of MB/s) do not go through this process
        this._framesProcess = spawn(process.execPath, [...process.execArgv, FRAMES_PROGRAM, `${o.width}`, `${o.height}`, `${o.fps}`], {
            ...CHILD_OPTIONS,
            stdio: ['pipe', this._ffmpegProcess.stdin!, 'inherit'],
        });
        this._watch(this._framesProcess, 'Image program');
        this._framesProcess.stdin!.on('error', () => {});

        // ffmpeg quotes the output URL in its errors: hide the stream key before writing the log
        const redacted = redactOutput(o.output);
        readline.createInterface({ input: this._ffmpegProcess.stderr! }).on('line', line => {
            this._ffmpegLog?.write(`${new Date().toISOString()} ${line.replaceAll(o.output, redacted)}\n`);
        });
    }
}
