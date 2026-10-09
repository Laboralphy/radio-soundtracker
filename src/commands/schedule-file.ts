import { readFile } from 'node:fs/promises';
import { ProgramLibrary } from '../libs/vlc-control/ProgramLibrary.js';
import { ScheduleConfigSchema } from '../libs/vlc-control/program-definition.js';

/**
 * Reads and validates a schedule file, and returns its programs.
 */
export async function loadSchedule(file: string): Promise<ProgramLibrary> {
    const raw: unknown = JSON.parse(await readFile(file, 'utf-8'));
    const config = ScheduleConfigSchema.parse(raw);

    const library = new ProgramLibrary();
    for (const [name, definition] of Object.entries(config.programs)) {
        library.define(name, definition);
    }
    return library;
}
