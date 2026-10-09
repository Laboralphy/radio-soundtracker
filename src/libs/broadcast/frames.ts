/**
 * The "image program" of the broadcast.
 *
 * Writes raw RGBA frames to stdout, paced to real time, forever.
 * Reads what to show from stdin, one JSON object per line:
 *   {"type": "song", "title": "...", "file": "/path/song.mod", "elapsed": 1, "duration": 123, "next": "/path/other.xm", "program": "main"}
 *   {"type": "standby", "reason": "idle" | "trouble", "next": {"program": "night", "at": "2026-10-09T20:00:00.000Z"} | null}
 * For a song only "file" or "title" is needed; "next" may be null. A line without "type" is a song.
 *
 * Usage: node [--import tsx] frames.(ts|js) [width] [height] [fps]
 */
import { createCanvas } from '@napi-rs/canvas';
import path from 'node:path';
import readline from 'node:readline';

const WIDTH = Number(process.argv[2] ?? 854);
const HEIGHT = Number(process.argv[3] ?? 480);
const FPS = Number(process.argv[4] ?? 30);
const FONT = 'DejaVu Sans Mono, monospace';

interface SongMessage {
    type: 'song';
    title: string;
    file: string;
    elapsed: number;
    duration: number;
    next: string | null;
    program: string;
}

interface Song {
    title: string;
    file: string;
    duration: number;
    next: string;
    program: string;
    /**
     * When the song started, for the progress bar.
     */
    startedAt: number;
    /**
     * When the message arrived, for the title animation.
     */
    changedAt: number;
}

interface StandbyMessage {
    type: 'standby';
    reason: 'idle' | 'trouble';
    next: { program: string; at: string } | null;
}

let song: Song = { title: 'Radio Soundtracker', file: '', duration: 0, next: '', program: '', startedAt: Date.now(), changedAt: Date.now() };

/**
 * Shown instead of the song while nothing plays.
 */
let standby: StandbyMessage | null = null;

/**
 * "/music/mods/Space Debris.mod" → "Space Debris"
 */
function songName(file: string): string {
    return path.basename(file, path.extname(file));
}

readline.createInterface({ input: process.stdin }).on('line', line => {
    try {
        const message = JSON.parse(line) as Partial<SongMessage> | StandbyMessage;
        if (message.type === 'standby') {
            standby = message;
            return;
        }
        const data = message;
        const now = Date.now();
        standby = null;
        song = {
            title: data.title || songName(data.file ?? '') || 'Unknown',
            file: data.file ?? '',
            duration: data.duration ?? 0,
            next: data.next ? songName(data.next) : '',
            program: data.program ?? '',
            startedAt: now - (data.elapsed ?? 0) * 1000,
            changedAt: now,
        };
    } catch {
        process.stderr.write(`frames: ignored bad line: ${line}\n`);
    }
});

const canvas = createCanvas(WIDTH, HEIGHT);
const ctx = canvas.getContext('2d');

const COPPER_COLORS = ['#ff0044', '#ff8800', '#ffee00', '#00dd66', '#00aaff', '#aa44ff'];

function formatTime(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * "Sat 22:00 CEST", or "22:00 CEST" for today, in the server's time zone.
 */
function formatStart(iso: string): string {
    const at = new Date(iso);
    const time = at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
    if (at.toDateString() === new Date().toDateString()) {
        return time;
    }
    return `${at.toLocaleDateString('en-GB', { weekday: 'short' })} ${time}`;
}

function drawFrame(t: number): void {
    // background
    const gradient = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    gradient.addColorStop(0, '#000022');
    gradient.addColorStop(1, '#000000');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Amiga-style copper bars bouncing on a sine
    COPPER_COLORS.forEach((color, i) => {
        const y = HEIGHT * 0.3 + Math.sin(t * 2 + i * 0.5) * HEIGHT * 0.18;
        const bar = ctx.createLinearGradient(0, y - 10, 0, y + 10);
        bar.addColorStop(0, 'transparent');
        bar.addColorStop(0.5, color);
        bar.addColorStop(1, 'transparent');
        ctx.fillStyle = bar;
        ctx.fillRect(0, y - 10, WIDTH, 20);
    });

    // header
    ctx.fillStyle = '#8888ff';
    ctx.font = `bold 22px ${FONT}`;
    ctx.textBaseline = 'top';
    ctx.fillText('RADIO SOUNDTRACKER', 24, 20);
    if (song.program && !standby) {
        ctx.fillStyle = '#aaaaff';
        ctx.font = `16px ${FONT}`;
        const label = song.program.toUpperCase();
        ctx.fillText(label, WIDTH - 24 - ctx.measureText(label).width, 25);
    }

    // now playing panel
    const panelHeight = 176;
    const panelY = HEIGHT - panelHeight;
    ctx.fillStyle = 'rgba(0, 0, 40, 0.85)';
    ctx.fillRect(0, panelY, WIDTH, panelHeight);
    ctx.fillStyle = '#5555aa';
    ctx.fillRect(0, panelY, WIDTH, 2);

    if (standby) {
        drawStandby(standby, panelY, t);
    } else {
        drawSong(panelY);
    }
}

function drawStandby(message: StandbyMessage, panelY: number, t: number): void {
    const trouble = message.reason === 'trouble';
    ctx.fillStyle = '#aaaaff';
    ctx.font = `16px ${FONT}`;
    ctx.fillText(trouble ? 'TECHNICAL DIFFICULTIES' : 'OFF AIR', 24, panelY + 16);

    // the headline pulses gently, so the picture shows the stream is alive
    ctx.font = `bold 36px ${FONT}`;
    ctx.fillStyle = `rgba(255, 255, 255, ${0.7 + 0.3 * Math.sin(t * 2)})`;
    ctx.fillText(trouble ? 'Back in a moment' : 'Back soon', 24, panelY + 42);

    ctx.font = `16px ${FONT}`;
    ctx.fillStyle = '#8888cc';
    ctx.fillText('Stay tuned for more tracker music', 24, panelY + 90);
    if (message.next) {
        ctx.fillText(`NEXT: ${message.next.program.toUpperCase()} at ${formatStart(message.next.at)}`, 24, panelY + 144);
    }
}

function drawSong(panelY: number): void {
    ctx.fillStyle = '#aaaaff';
    ctx.font = `16px ${FONT}`;
    ctx.fillText('NOW PLAYING', 24, panelY + 16);

    // title: scrolls when too wide, otherwise slides in after a song change
    ctx.font = `bold 36px ${FONT}`;
    ctx.fillStyle = '#ffffff';
    const sinceChange = (Date.now() - song.changedAt) / 1000;
    const titleWidth = ctx.measureText(song.title).width;
    let x = 24;
    if (titleWidth > WIDTH - 48) {
        const span = titleWidth + WIDTH;
        x = WIDTH - ((sinceChange * 120) % span);
    } else if (sinceChange < 0.6) {
        const k = 1 - sinceChange / 0.6;
        x = 24 + k * k * WIDTH;
    }
    ctx.fillText(song.title, x, panelY + 42);

    // file name and progress
    ctx.font = `16px ${FONT}`;
    ctx.fillStyle = '#8888cc';
    ctx.fillText(path.basename(song.file), 24, panelY + 90);
    if (song.duration > 0) {
        const elapsed = Math.min((Date.now() - song.startedAt) / 1000, song.duration);
        const ratio = elapsed / song.duration;
        ctx.fillStyle = '#333366';
        ctx.fillRect(24, panelY + 120, WIDTH - 48, 8);
        ctx.fillStyle = '#ffee00';
        ctx.fillRect(24, panelY + 120, (WIDTH - 48) * ratio, 8);
        ctx.fillStyle = '#aaaaff';
        const label = `${formatTime(elapsed)} / ${formatTime(song.duration)}`;
        ctx.fillText(label, WIDTH - 24 - ctx.measureText(label).width, panelY + 90);
    }

    if (song.next) {
        ctx.fillStyle = '#8888cc';
        ctx.fillText(`NEXT: ${song.next}`, 24, panelY + 144);
    }
}

function waitDrain(): Promise<void> {
    return new Promise(resolve => process.stdout.once('drain', resolve));
}

let running = true;
process.stdout.on('error', () => {
    // ffmpeg went away
    running = false;
});

async function main(): Promise<void> {
    const interval = 1000 / FPS;
    const start = Date.now();
    let frame = 0;
    while (running) {
        drawFrame((Date.now() - start) / 1000);
        const pixels = ctx.getImageData(0, 0, WIDTH, HEIGHT).data;
        if (!process.stdout.write(Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength))) {
            await waitDrain();
        }
        ++frame;
        const late = Date.now() - (start + frame * interval);
        if (late > interval) {
            // too slow: skip frames rather than drift; ffmpeg repeats the last one
            frame = Math.floor((Date.now() - start) / interval);
        }
        const wait = start + frame * interval - Date.now();
        if (wait > 0) {
            await new Promise(resolve => setTimeout(resolve, wait));
        }
    }
}

void main();
