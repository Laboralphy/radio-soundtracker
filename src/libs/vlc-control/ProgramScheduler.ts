import cron from 'node-cron';
import type { ProgramLibrary } from './ProgramLibrary.js';
import type { Player } from './Player.js';
import type { Program } from './Program.js';
import { logger } from '../logger/index.js';

export interface ProgramSchedulerOptions {
    /**
     * Delays (ms) between attempts when the default program fails; the last value repeats.
     */
    retryDelays?: number[];
}

const DEFAULT_RETRY_DELAYS = [1000, 2000, 5000, 10000, 30000];

export class ProgramScheduler {
    private readonly _library: ProgramLibrary;
    private readonly _player: Player;
    private readonly _retryDelays: number[];
    private _tasks: cron.ScheduledTask[] = [];
    private _stopped = false;
    private _playingScheduled = false;
    private _defaultProgram: Program | null = null;
    private _defaultLoopId = 0;
    private _wakeUp: (() => void) | null = null;

    constructor(library: ProgramLibrary, player: Player, { retryDelays = DEFAULT_RETRY_DELAYS }: ProgramSchedulerOptions = {}) {
        this._library = library;
        this._player = player;
        this._retryDelays = retryDelays;
    }

    start(): void {
        this._stopped = false;
        this._defaultProgram = this._findDefault();

        for (const [name, program] of this._library.entries()) {
            if (!program.cron) continue;
            if (!cron.validate(program.cron)) {
                logger.warn(`Program "${name}" has an invalid cron expression "${program.cron}"; skipping.`);
                continue;
            }
            const task = cron.schedule(program.cron, () => {
                void this.playScheduled(name);
            });
            this._tasks.push(task);
            logger.info(`Scheduled program "${name}" with cron "${program.cron}"`);
        }

        if (this._defaultProgram) {
            logger.info('Starting default program loop');
            void this._runDefaultLoop(this._defaultProgram);
        } else {
            logger.warn('No default program defined. Playback will only start on cron events.');
        }
    }

    /**
     * Stops the scheduler and the audio.
     */
    async stop(): Promise<void> {
        this._stopped = true;
        ++this._defaultLoopId;
        this._wakeUp?.();
        for (const task of this._tasks) task.stop();
        this._tasks = [];
        await this._player.stop();
    }

    /**
     * Interrupts the default program to play the named program, then resumes the default program.
     * Called by cron; can also be called directly.
     */
    async playScheduled(name: string): Promise<void> {
        const program = this._library.get(name);
        if (program === undefined) {
            logger.error(`Cannot play program "${name}": not found in library.`);
            return;
        }
        if (this._playingScheduled) {
            logger.warn(`Cron fired for "${name}" but a scheduled program is already playing; skipping.`);
            return;
        }
        logger.info(`Cron fired: starting program "${name}"`);
        this._playingScheduled = true;
        // invalidate the running default loop, including one waiting before a retry
        ++this._defaultLoopId;
        this._wakeUp?.();
        try {
            await this._player.playProgram(program);
        } catch (err) {
            logger.error(`Error playing scheduled program "${name}": ${err}`);
        } finally {
            this._playingScheduled = false;
            if (!this._stopped && this._defaultProgram) {
                void this._runDefaultLoop(this._defaultProgram);
            }
        }
    }

    private _findDefault(): Program | null {
        let defaultProgram: Program | null = null;
        for (const [, program] of this._library.entries()) {
            if (!program.cron) {
                if (defaultProgram !== null) {
                    logger.warn('Multiple default programs (empty cron) found; using the last one.');
                }
                defaultProgram = program;
            }
        }
        return defaultProgram;
    }

    /**
     * Plays the default program over and over, until stopped or replaced by a scheduled program.
     * Failures are retried with an increasing delay, so a missing folder or an unreachable VLC
     * does not end the radio.
     */
    private async _runDefaultLoop(program: Program): Promise<void> {
        const id = ++this._defaultLoopId;
        let nFailures = 0;
        while (id === this._defaultLoopId) {
            try {
                await this._player.playProgram(program);
                nFailures = 0;
            } catch (err) {
                if (id !== this._defaultLoopId) {
                    return;
                }
                const nDelay = this._retryDelays[Math.min(nFailures, this._retryDelays.length - 1)];
                ++nFailures;
                logger.error(`Default program failed (attempt ${nFailures}), retrying in ${nDelay}ms: ${err}`);
                await this._sleep(nDelay);
            }
        }
    }

    /**
     * Waits for the given time; stop() and playScheduled() cut the wait short.
     */
    private _sleep(ms: number): Promise<void> {
        return new Promise(resolve => {
            const done = () => {
                clearTimeout(timer);
                if (this._wakeUp === done) {
                    this._wakeUp = null;
                }
                resolve();
            };
            const timer = setTimeout(done, ms);
            this._wakeUp = done;
        });
    }
}
