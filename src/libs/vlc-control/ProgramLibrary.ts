import { Program } from './Program.js';
import type { ProgramDefinition } from './program-definition.js';

export class ProgramLibrary {
    private _programs: Map<string, Program> = new Map();

    add(name: string, program: Program): void {
        this._programs.set(name, program);
    }

    get(name: string): Program | undefined {
        return this._programs.get(name);
    }

    has(name: string): boolean {
        return this._programs.has(name);
    }

    remove(name: string): boolean {
        return this._programs.delete(name);
    }

    /**
     * Creates a Program from a ProgramDefinition and registers it under the given name.
     */
    define(name: string, definition: ProgramDefinition): Program {
        const program = this.createFromDefinition(definition);
        this._programs.set(name, program);
        return program;
    }

    /**
     * Creates a Program from a ProgramDefinition without registering it.
     * Program-type entries must reference names already registered in this library.
     */
    createFromDefinition(definition: ProgramDefinition): Program {
        const program = new Program();
        for (const entry of definition.entries) {
            switch (entry.type) {
                case 'song':
                    program.addSong(entry.location);
                    break;
                case 'folder':
                    program.addFolder(entry.location, {
                        shuffle: entry.shuffle,
                        limit: entry.limit,
                        recursive: entry.recursive,
                    });
                    break;
                case 'program': {
                    const ref = this._programs.get(entry.name);
                    if (ref === undefined) {
                        throw new Error(`Program "${entry.name}" not found in library`);
                    }
                    program.addProgram(ref);
                    break;
                }
            }
        }
        return program;
    }
}
