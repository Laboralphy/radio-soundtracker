import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../logger/index.js';

/**
 * Runs pactl with the given arguments and resolves with its stdout.
 */
export type PactlRunner = (args: string[]) => Promise<string>;

const execFileAsync = promisify(execFile);

export const runPactl: PactlRunner = async args => (await execFileAsync('pactl', args)).stdout;

/**
 * A PulseAudio/PipeWire null sink: a virtual sound card that VLC plays into,
 * and whose ".monitor" source ffmpeg records.
 *
 * acquire() creates the sink only if it does not exist yet, and release() only removes
 * a sink that acquire() created, so a sink set up by the system (or another process) is left alone.
 */
export class NullSink {
    readonly name: string;
    private readonly _pactl: PactlRunner;
    private _moduleId: string | null = null;

    constructor(name: string, pactl: PactlRunner = runPactl) {
        this.name = name;
        this._pactl = pactl;
    }

    get monitor(): string {
        return `${this.name}.monitor`;
    }

    async exists(): Promise<boolean> {
        const sinks = await this._pactl(['list', 'short', 'sinks']);
        return sinks.split('\n').some(line => line.split('\t')[1] === this.name);
    }

    /**
     * Makes sure the sink exists. Resolves with true if it was created here.
     */
    async acquire(): Promise<boolean> {
        if (await this.exists()) {
            logger.info(`Using existing audio sink "${this.name}"`);
            return false;
        }
        const output = await this._pactl([
            'load-module', 'module-null-sink', `sink_name=${this.name}`, `sink_properties=device.description=${this.name}`,
        ]);
        this._moduleId = output.trim();
        logger.info(`Created audio sink "${this.name}" (module ${this._moduleId})`);
        return true;
    }

    /**
     * Removes the sink if acquire() created it.
     */
    async release(): Promise<void> {
        if (this._moduleId === null) {
            return;
        }
        const moduleId = this._moduleId;
        this._moduleId = null;
        await this._pactl(['unload-module', moduleId]);
        logger.info(`Removed audio sink "${this.name}"`);
    }
}
