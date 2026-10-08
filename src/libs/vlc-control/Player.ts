import type { EventEmitter } from 'node:events';
import type { Program } from './Program.js';

/**
 * What the scheduler needs from a player.
 * ProgramPlayer (VLC) is one implementation; a libopenmpt-based player could be another.
 */
export interface Player {
    readonly events: EventEmitter;

    /**
     * Replaces whatever is playing with the program.
     * Resolves when the program ends or is interrupted, rejects on error.
     */
    playProgram(oProgram: Program): Promise<void>;

    /**
     * Stops tracking the current program (its playProgram promise resolves), without stopping the audio.
     */
    stopDoomLoop(): void;

    /**
     * Stops tracking the current program and stops the audio.
     */
    stop(): Promise<void>;
}
