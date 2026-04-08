import cron from 'node-cron';
import type { ProgramLibrary } from './ProgramLibrary.js';
import type { ProgramPlayer } from './ProgramPlayer.js';
import type { Program } from './Program.js';
import { logger } from '../logger/index.js';

export class ProgramScheduler {
    private readonly _library: ProgramLibrary;
    private readonly _player: ProgramPlayer;
    private _tasks: cron.ScheduledTask[] = [];
    private _stopped = false;
    private _playingScheduled = false;

    constructor(library: ProgramLibrary, player: ProgramPlayer) {
        this._library = library;
        this._player = player;
    }

    start(): void {
        this._stopped = false;
        const defaultProgram = this._findDefault();

        for (const [name, program] of this._library.entries()) {
            if (!program.cron) continue;
            if (!cron.validate(program.cron)) {
                logger.warn(`Program "${name}" has an invalid cron expression "${program.cron}"; skipping.`);
                continue;
            }
            const task = cron.schedule(program.cron, () => {
                void this._onCronFired(name, program, defaultProgram);
            });
            this._tasks.push(task);
            logger.info(`Scheduled program "${name}" with cron "${program.cron}"`);
        }

        if (defaultProgram) {
            logger.info('Starting default program loop');
            void this._runDefaultLoop(defaultProgram);
        } else {
            logger.warn('No default program defined. Playback will only start on cron events.');
        }
    }

    stop(): void {
        this._stopped = true;
        for (const task of this._tasks) task.stop();
        this._tasks = [];
        this._player.stopDoomLoop();
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

    private async _runDefaultLoop(program: Program): Promise<void> {
        while (!this._stopped && !this._playingScheduled) {
            await this._player.playProgram(program);
        }
    }

    private async _onCronFired(name: string, program: Program, defaultProgram: Program | null): Promise<void> {
        if (this._playingScheduled) {
            logger.warn(`Cron fired for "${name}" but a scheduled program is already playing; skipping.`);
            return;
        }
        logger.info(`Cron fired: starting program "${name}"`);
        this._playingScheduled = true;
        this._player.stopDoomLoop();
        // Wait one microtask cycle for the stopDoomLoop to resolve any pending playProgram promise
        await Promise.resolve();
        try {
            await this._player.playProgram(program);
        } catch (err) {
            logger.error(`Error playing scheduled program "${name}": ${err}`);
        } finally {
            this._playingScheduled = false;
            if (!this._stopped && defaultProgram) {
                void this._runDefaultLoop(defaultProgram);
            }
        }
    }
}
