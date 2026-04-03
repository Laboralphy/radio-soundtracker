import { TreeAsync } from '../o876-xtree/async.js';
import path from 'node:path';
import { PROGRAM_ENTRY_TYPES, SONG_FILE_EXTENSIONS, ProgramEntryType } from './consts.js';
import { shuffleArray } from '../shuffle-array/index.js';
import crypto from 'crypto';
import type { Program } from './Program.js';

interface ProgramEntryOptions {
    type: ProgramEntryType;
    location?: string;
    program?: Program | null;
    shuffle?: boolean;
    limit?: number;
    recursive?: boolean;
}

export class ProgramEntry {
    private _id: string;
    private _type: ProgramEntryType;
    private _location: string;
    private _program: Program | null;
    private _shuffle: boolean;
    private _limit: number;
    private _recursive: boolean;

    constructor({
        type,
        location = '',
        program = null,
        shuffle = false,
        limit = Infinity,
        recursive = false,
    }: ProgramEntryOptions) {
        this._id = crypto.randomUUID();
        this._type = type;
        this._location = location;
        this._program = program;
        this._shuffle = shuffle;
        this._limit = limit;
        this._recursive = recursive;
    }

    get id(): string {
        return this._id;
    }

    async getFolderContent(sBasePath: string, aExtensions: string[] = []): Promise<string[]> {
        const aLowerExts = aExtensions.map(s => '.' + s.toLowerCase());
        if (this._recursive) {
            const aFiles = await TreeAsync.tree(sBasePath);
            return aFiles
                .filter(s => aLowerExts.length === 0 || aLowerExts.includes(path.extname(s).toLowerCase()))
                .map(s => path.resolve(sBasePath, s));
        } else {
            const aFiles = await TreeAsync.ls(sBasePath);
            return aFiles
                .filter(e => !e.dir && (aLowerExts.length === 0 || aLowerExts.includes(path.extname(e.name).toLowerCase())))
                .map(e => path.resolve(sBasePath, e.name));
        }
    }

    async renderList(): Promise<string[]> {
        switch (this._type) {
        case PROGRAM_ENTRY_TYPES.FOLDER: {
            return this
                .getFolderContent(path.resolve(this._location), SONG_FILE_EXTENSIONS)
                .then(aList => this._shuffle ? shuffleArray(aList) : aList)
                .then(aList => aList.slice(0, this._limit));
        }
        case PROGRAM_ENTRY_TYPES.SONG: {
            return [path.resolve(this._location)];
        }
        case PROGRAM_ENTRY_TYPES.PROGRAM: {
            return this._program!.renderList();
        }
        default: {
            return [];
        }
        }
    }
}
