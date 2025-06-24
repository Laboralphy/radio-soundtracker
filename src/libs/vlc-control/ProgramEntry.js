const TreeAsync = require('../o876-xtree/async');
const path = require('node:path');
const { PROGRAM_ENTRY_TYPES, SONG_FILE_EXTENSIONS } = require('./consts');
const {shuffleArray} = require('../shuffle-array');
const crypto = require('crypto');

class ProgramEntry {
    constructor ({
        type,
        location = '',
        program = null,
        shuffle = false,
        limit = Infinity,
    }) {
        this._id = crypto.randomUUID();
        this._type = type;
        this._location = location;
        this._program = program;
        this._shuffle = shuffle;
        this._limit = limit;
    }

    get id () {
        return this._id;
    }

    /**
     *
     * @param sBasePath {string}
     * @param aExtensions {string[]}
     * @returns {Promise<string[]>}
     */
    getFolderContent (sBasePath, aExtensions = []) {
        const aLowerExts = aExtensions.map(s => '.' + s.toLowerCase());
        return TreeAsync
            .tree(sBasePath)
            .then(aFiles => aFiles
                .filter(s => aLowerExts.length === 0 || aLowerExts.includes(path.extname(s).toLowerCase()))
                .map(s => path.resolve(sBasePath, s))
            );
    }

    /**
     *
     * @returns {Promise<string[]>}
     */
    async renderList () {
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
            return this._program.renderList();
        }
        default: {
            return [];
        }
        }
    }
}

module.exports = ProgramEntry;
