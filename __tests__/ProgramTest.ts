import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Program } from '../src/libs/vlc-control/Program.js';
import { ProgramLibrary } from '../src/libs/vlc-control/ProgramLibrary.js';
import { ScheduleConfigSchema } from '../src/libs/vlc-control/program-definition.js';

let root = '';
const file = (...parts: string[]) => path.join(root, ...parts);

beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'radio-program-'));
    await mkdir(file('mods', 'sub'), { recursive: true });
    await mkdir(file('empty'));
    for (const name of ['a.mod', 'b.XM', 'c.s3m', 'readme.txt', 'sub/d.it', 'sub/e.mod']) {
        await writeFile(file('mods', name), '');
    }
});

afterAll(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('Program.renderList', () => {
    it('lists the songs of a folder, ignoring other files and sub folders', async () => {
        const program = new Program();
        program.addFolder(file('mods'));
        expect((await program.renderList()).sort()).toEqual([file('mods', 'a.mod'), file('mods', 'b.XM'), file('mods', 'c.s3m')]);
    });

    it('includes sub folders when recursive', async () => {
        const program = new Program();
        program.addFolder(file('mods'), { recursive: true });
        expect((await program.renderList()).sort()).toEqual([
            file('mods', 'a.mod'), file('mods', 'b.XM'), file('mods', 'c.s3m'),
            file('mods', 'sub', 'd.it'), file('mods', 'sub', 'e.mod'),
        ]);
    });

    it('limits the number of songs', async () => {
        const program = new Program();
        program.addFolder(file('mods'), { recursive: true, shuffle: true, limit: 2 });
        const list = await program.renderList();
        expect(list).toHaveLength(2);
        expect(new Set(list).size).toBe(2);
    });

    it('keeps the same songs when shuffled', async () => {
        const program = new Program();
        program.addFolder(file('mods'), { recursive: true, shuffle: true });
        expect(await program.renderList()).toHaveLength(5);
    });

    it('keeps entries in order and flattens nested programs', async () => {
        const intro = new Program();
        intro.addSong(file('jingle.mp3'));
        const main = new Program();
        main.addProgram(intro);
        main.addFolder(file('mods'));
        main.addSong(file('outro.mod'));
        const list = await main.renderList();
        expect(list[0]).toBe(file('jingle.mp3'));
        expect(list.at(-1)).toBe(file('outro.mod'));
        expect(list).toHaveLength(5);
    });

    it('returns an empty list for an empty folder', async () => {
        const program = new Program();
        program.addFolder(file('empty'));
        expect(await program.renderList()).toEqual([]);
    });

    it('rejects for a missing folder', async () => {
        const program = new Program();
        program.addFolder(file('missing'));
        await expect(program.renderList()).rejects.toThrow();
    });
});

describe('ProgramLibrary', () => {
    it('builds programs from a schedule config', async () => {
        const config = ScheduleConfigSchema.parse({
            programs: {
                jingles: { entries: [{ type: 'song', location: file('jingle.mp3') }] },
                main: {
                    entries: [
                        { type: 'program', name: 'jingles' },
                        { type: 'folder', location: file('mods'), recursive: true },
                    ],
                },
                night: { cron: '0 22 * * *', entries: [{ type: 'folder', location: file('mods'), limit: 1 }] },
            },
        });
        const library = new ProgramLibrary();
        for (const [name, definition] of Object.entries(config.programs)) {
            library.define(name, definition);
        }
        expect(await library.get('main')!.renderList()).toHaveLength(6);
        expect(await library.get('night')!.renderList()).toHaveLength(1);
        expect(library.get('night')!.cron).toBe('0 22 * * *');
    });

    it('rejects a reference to a program defined later', () => {
        const library = new ProgramLibrary();
        expect(() => library.define('main', { cron: '', entries: [{ type: 'program', name: 'later' }] })).toThrow(/later/);
    });
});
