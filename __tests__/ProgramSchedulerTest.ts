import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('../src/libs/logger/index.js', () => ({
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { Program } = await import('../src/libs/vlc-control/Program.js');
const { ProgramLibrary } = await import('../src/libs/vlc-control/ProgramLibrary.js');
const { ProgramScheduler } = await import('../src/libs/vlc-control/ProgramScheduler.js');
type ProgramT = InstanceType<typeof Program>;

/**
 * Player double: each playProgram stays pending until the test ends or fails it.
 */
class FakePlayer {
    readonly events = new EventEmitter();
    readonly played: ProgramT[] = [];
    stopped = false;
    failNext = 0;
    private pending: { resolve: () => void; reject: (err: unknown) => void } | null = null;

    playProgram(program: ProgramT): Promise<void> {
        this.stopDoomLoop();
        this.played.push(program);
        if (this.failNext > 0) {
            --this.failNext;
            return Promise.reject(new Error('boom'));
        }
        return new Promise((resolve, reject) => {
            this.pending = { resolve, reject };
        });
    }

    stopDoomLoop(): void {
        const pending = this.pending;
        this.pending = null;
        pending?.resolve();
    }

    async stop(): Promise<void> {
        this.stopped = true;
        this.stopDoomLoop();
    }

    endCurrent(): void {
        this.stopDoomLoop();
    }

    failCurrent(): void {
        const pending = this.pending;
        this.pending = null;
        pending?.reject(new Error('VLC is gone'));
    }
}

const wait = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

function setup(retryDelays = [5]) {
    const library = new ProgramLibrary();
    const main = new Program();
    const night = new Program({ cron: '0 0 1 1 *' });
    library.add('main', main);
    library.add('night', night);
    const player = new FakePlayer();
    const scheduler = new ProgramScheduler(library, player, { retryDelays });
    return { library, main, night, player, scheduler };
}

let current: ReturnType<typeof setup> | null = null;

afterEach(async () => {
    await current?.scheduler.stop();
    current = null;
});

describe('ProgramScheduler', () => {
    it('plays the default program again when it ends', async () => {
        current = setup();
        const { main, player, scheduler } = current;
        scheduler.start();
        await wait();
        player.endCurrent();
        await wait();
        player.endCurrent();
        await wait();
        expect(player.played).toEqual([main, main, main]);
    });

    it('retries the default program after a failure', async () => {
        current = setup();
        const { main, player, scheduler } = current;
        player.failNext = 2;
        scheduler.start();
        await wait(50);
        expect(player.played).toEqual([main, main, main]);
    });

    it('retries when the program fails while playing', async () => {
        current = setup();
        const { player, scheduler } = current;
        scheduler.start();
        await wait();
        player.failCurrent();
        await wait(50);
        expect(player.played).toHaveLength(2);
    });

    it('interrupts the default program for a scheduled one, then resumes it', async () => {
        current = setup();
        const { main, night, player, scheduler } = current;
        scheduler.start();
        await wait();
        const scheduled = scheduler.playScheduled('night');
        await wait();
        expect(player.played).toEqual([main, night]);
        player.endCurrent();
        await scheduled;
        await wait();
        expect(player.played).toEqual([main, night, main]);
    });

    it('does not start a second default loop when a scheduled program comes during a retry wait', async () => {
        current = setup([30]);
        const { main, night, player, scheduler } = current;
        player.failNext = 1;
        scheduler.start();
        await wait();
        const scheduled = scheduler.playScheduled('night');
        await wait();
        player.endCurrent();
        await scheduled;
        await wait(80);
        expect(player.played).toEqual([main, night, main]);
    });

    it('tells which scheduled program comes next', async () => {
        current = setup();
        const { library, scheduler } = current;
        library.add('hourly', new Program({ cron: '0 * * * *' }));
        expect(scheduler.nextScheduled()).toBeNull();
        scheduler.start();
        const next = scheduler.nextScheduled();
        expect(next?.name).toBe('hourly');
        expect(next!.at.getTime() - Date.now()).toBeLessThanOrEqual(3600 * 1000);
        await scheduler.stop();
        expect(scheduler.nextScheduled()).toBeNull();
    });

    it('stops the player and plays nothing more once stopped', async () => {
        current = setup();
        const { player, scheduler } = current;
        scheduler.start();
        await wait();
        await scheduler.stop();
        await wait(20);
        expect(player.stopped).toBe(true);
        expect(player.played).toHaveLength(1);
    });
});
