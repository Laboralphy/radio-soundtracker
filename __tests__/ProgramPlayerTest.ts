import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/libs/logger/index.js', () => ({
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { Program } = await import('../src/libs/vlc-control/Program.js');
const { ProgramPlayer } = await import('../src/libs/vlc-control/ProgramPlayer.js');
const { EVENTS } = await import('../src/libs/vlc-control/consts.js');
import type { VLCControl } from '../src/libs/vlc-control/VLCControl.js';

/**
 * VLCControl double: songs of a fixed length, played one after the other on a fake clock.
 */
class FakeVLC {
    playlist: string[] = [];
    startedAt = 0;
    songLength = 10;
    stopped = true;
    failures = 0;
    commands: string[] = [];

    private index(): number {
        return Math.floor((Date.now() - this.startedAt) / (this.songLength * 1000));
    }

    private check(): void {
        if (this.failures > 0) {
            --this.failures;
            throw new Error('VLC RC timeout');
        }
    }

    async doStop() { this.commands.push('stop'); this.stopped = true; return ''; }
    async doClearPlaylist() { this.playlist = []; return ''; }
    async doEnqueue(list: string[]) { this.playlist.push(...list); return ''; }
    async doPlay() { this.commands.push('play'); this.stopped = false; this.startedAt = Date.now(); return ''; }

    async isPlaying() {
        this.check();
        return !this.stopped && this.index() < this.playlist.length;
    }

    async getTime() {
        const elapsed = Math.floor((Date.now() - this.startedAt) / 1000) % this.songLength;
        return { time: elapsed, total: this.songLength, remaining: this.songLength - elapsed };
    }

    async getTitle() { return this.playlist[this.index()] ?? ''; }
    async getStatus() { return `( new input: file://${this.playlist[this.index()]} )`; }
}

function programOf(...songs: string[]) {
    const program = new Program();
    songs.forEach(s => program.addSong(s));
    return program;
}

let vlc: FakeVLC;
let player: InstanceType<typeof ProgramPlayer>;

beforeEach(() => {
    vi.useFakeTimers();
    vlc = new FakeVLC();
    player = new ProgramPlayer({ vlc: vlc as unknown as VLCControl });
});

afterEach(() => {
    vi.useRealTimers();
});

describe('ProgramPlayer', () => {
    it('announces each song and resolves when the playlist ends', async () => {
        const titles: string[] = [];
        player.events.on(EVENTS.EVENT_NEW_SONG, ({ title }: { title: string }) => titles.push(title));
        let done = false;
        const playing = player.playProgram(programOf('/a.mod', '/b.mod')).then(() => { done = true; });
        await vi.advanceTimersByTimeAsync(15000);
        expect(titles).toEqual(['/a.mod', '/b.mod']);
        expect(done).toBe(false);
        await vi.advanceTimersByTimeAsync(10000);
        await playing;
        expect(done).toBe(true);
    });

    it('reports the file path of the song', async () => {
        const files: string[] = [];
        player.events.on(EVENTS.EVENT_NEW_SONG, ({ file }: { file: string }) => files.push(file));
        void player.playProgram(programOf('/music/my song.mod'));
        await vi.advanceTimersByTimeAsync(0);
        expect(files).toEqual(['/music/my song.mod']);
        player.stopDoomLoop();
    });

    it('tolerates a few failed polls', async () => {
        let done = false;
        const playing = player.playProgram(programOf('/a.mod', '/b.mod')).then(() => { done = true; });
        await vi.advanceTimersByTimeAsync(0);
        vlc.failures = 2;
        await vi.advanceTimersByTimeAsync(15000);
        expect(done).toBe(false);
        await vi.advanceTimersByTimeAsync(10000);
        await playing;
        expect(done).toBe(true);
    });

    it('rejects when VLC keeps failing', async () => {
        const playing = player.playProgram(programOf('/a.mod'));
        const result = expect(playing).rejects.toThrow(/timeout/);
        await vi.advanceTimersByTimeAsync(0);
        vlc.failures = 3;
        await vi.advanceTimersByTimeAsync(15000);
        await result;
    });

    it('rejects a program without any song', async () => {
        await expect(player.playProgram(new Program())).rejects.toThrow(/no playable file/);
        expect(vlc.commands).toEqual([]);
    });

    it('resolves the previous program when a new one starts', async () => {
        const first = player.playProgram(programOf('/a.mod'));
        await vi.advanceTimersByTimeAsync(0);
        const second = player.playProgram(programOf('/b.mod'));
        await first;
        await vi.advanceTimersByTimeAsync(0);
        expect(await vlc.getTitle()).toBe('/b.mod');
        player.stopDoomLoop();
        await second;
    });

    it('stop() stops VLC', async () => {
        const playing = player.playProgram(programOf('/a.mod'));
        await vi.advanceTimersByTimeAsync(0);
        await player.stop();
        await playing;
        expect(vlc.commands.at(-1)).toBe('stop');
    });
});
