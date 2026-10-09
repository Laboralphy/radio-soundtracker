/**
 * The "image program" of the broadcast.
 *
 * Writes raw RGBA frames to stdout, paced to real time, forever.
 * Reads song changes from stdin, one JSON object per line:
 *   {"title": "...", "file": "/path/song.mod", "duration": 123}
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

interface Song {
    title: string;
    file: string;
    duration: number;
    startedAt: number;
}

let song: Song = { title: 'Radio Soundtracker', file: '', duration: 0, startedAt: Date.now() };

readline.createInterface({ input: process.stdin }).on('line', line => {
    try {
        const data = JSON.parse(line) as Partial<Song>;
        song = {
            title: data.title || path.basename(data.file ?? '') || 'Unknown',
            file: data.file ?? '',
            duration: data.duration ?? 0,
            startedAt: Date.now(),
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

    // now playing panel
    const panelY = HEIGHT - 150;
    ctx.fillStyle = 'rgba(0, 0, 40, 0.85)';
    ctx.fillRect(0, panelY, WIDTH, 150);
    ctx.fillStyle = '#5555aa';
    ctx.fillRect(0, panelY, WIDTH, 2);

    ctx.fillStyle = '#aaaaff';
    ctx.font = `16px ${FONT}`;
    ctx.fillText('NOW PLAYING', 24, panelY + 16);

    // title: scrolls when too wide, otherwise slides in after a song change
    ctx.font = `bold 36px ${FONT}`;
    ctx.fillStyle = '#ffffff';
    const sinceChange = (Date.now() - song.startedAt) / 1000;
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
        const ratio = Math.min(sinceChange / song.duration, 1);
        ctx.fillStyle = '#333366';
        ctx.fillRect(24, panelY + 120, WIDTH - 48, 8);
        ctx.fillStyle = '#ffee00';
        ctx.fillRect(24, panelY + 120, (WIDTH - 48) * ratio, 8);
        ctx.fillStyle = '#aaaaff';
        const label = `${formatTime(sinceChange)} / ${formatTime(song.duration)}`;
        ctx.fillText(label, WIDTH - 24 - ctx.measureText(label).width, panelY + 90);
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
