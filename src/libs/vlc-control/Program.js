const ProgramEntry = require('./ProgramEntry');
const {PROGRAM_ENTRY_TYPES} = require('./consts');

class Program {
    /**
     *
     * @param programs {ProgramEntry[]}
     */
    constructor ({
        programs = [],
    } = {}) {
        /**
         * @type {ProgramEntry[]}
         * @private
         */
        this._entries = programs;
    }

    get entries () {
        return this._entries;
    }

    addEntry ({
        type,
        location = '',
        program = null,
        shuffle = false,
        limit = Infinity,
    }) {
        this.entries.push(new ProgramEntry({
            type,
            location,
            program,
            shuffle,
            limit
        }));
    }

    addFolder (sLocation, { shuffle = false, limit = Infinity } = {}) {
        this.addEntry({
            type: PROGRAM_ENTRY_TYPES.FOLDER,
            location: sLocation,
            shuffle,
            limit
        });
    }

    addSong (sFile) {
        this.addEntry({
            type: PROGRAM_ENTRY_TYPES.SONG,
            location: sFile
        });
    }

    /**
     * @param oProgram {Program}
     */
    addProgram (oProgram) {
        if (oProgram instanceof Program) {
            this.addEntry({
                type: PROGRAM_ENTRY_TYPES.PROGRAM,
                program: oProgram
            });
        }
    }

    /**
     *
     * @returns {Promise<string[]>}
     */
    async renderList () {
        return Promise
            .all(this._entries.map(p => p.renderList()))
            .then(p => p.flat());
    }
}

module.exports = Program;
