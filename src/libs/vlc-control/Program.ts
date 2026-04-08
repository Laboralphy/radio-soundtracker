import { ProgramEntry } from './ProgramEntry.js';
import { PROGRAM_ENTRY_TYPES, ProgramEntryType } from './consts.js';

interface AddEntryOptions {
    type: ProgramEntryType;
    location?: string;
    program?: Program | null;
    shuffle?: boolean;
    limit?: number;
    recursive?: boolean;
}

interface AddFolderOptions {
    shuffle?: boolean;
    limit?: number;
    recursive?: boolean;
}

interface ProgramOptions {
    programs?: ProgramEntry[];
    cron?: string;
}

export class Program {
    private readonly _entries: ProgramEntry[];
    private _cron: string;

    constructor({ programs = [], cron = '' }: ProgramOptions = {}) {
        this._entries = programs;
        this._cron = cron;
    }

    get  cron(): string {
        return this._cron;
    }

    set cron(s: string) {
        this._cron = s;
    }

    get entries(): ProgramEntry[] {
        return this._entries;
    }

    addEntry({
        type,
        location = '',
        program = null,
        shuffle = false,
        limit = Infinity,
    }: AddEntryOptions): void {
        this.entries.push(new ProgramEntry({
            type,
            location,
            program,
            shuffle,
            limit
        }));
    }

    addFolder(sLocation: string, { shuffle = false, limit = Infinity, recursive = false }: AddFolderOptions = {}): void {
        this.addEntry({
            type: PROGRAM_ENTRY_TYPES.FOLDER,
            location: sLocation,
            shuffle,
            limit,
            recursive
        });
    }

    addSong(sFile: string): void {
        this.addEntry({
            type: PROGRAM_ENTRY_TYPES.SONG,
            location: sFile
        });
    }

    addProgram(oProgram: Program): void {
        this.addEntry({
            type: PROGRAM_ENTRY_TYPES.PROGRAM,
            program: oProgram
        });
    }

    async renderList(): Promise<string[]> {
        return Promise
            .all(this._entries.map(p => p.renderList()))
            .then(p => p.flat());
    }
}
