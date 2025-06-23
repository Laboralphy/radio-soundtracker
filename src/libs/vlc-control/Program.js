const TreeAsync = require('../o876-xtree/async');
const path = require('node:path');
const fs = require('node:fs/promises');

const SONGFILE_EXTENSIONS = [
    'mid',
    'mp3',
    'mod',
    's3m',
    'stm',
    'xm',
    'it'
];

class Program {
    constructor () {
        this._program = [];
    }

    async addResource (sResource) {
        const bFolder = await this.isFolder(sResource);
        if (bFolder) {
            this._program.push({
                folder: true,
                location: sResource
            });
        } else {
            this._program.push({
                folder: false,
                location: sResource
            });
        }
    }

    addFolder (sLocation, { shuffle = false, limit = Infinity } = {}) {
        this._program.push({
            folder: true,
            location: sLocation,
            shuffle,
            limit
        });
    }

    addSong (sSongFile) {
        this._program.push({
            folder: true,
            location: sSongFile
        });
    }

    async isFolder (sLocation) {
        const oStat = await fs.stat(sLocation);
        return oStat.isDirectory();
    }

    getFolderContent (sBasePath, aExtensions = []) {
        const aLowerExts = aExtensions.map(s => '.' + s.toLowerCase());
        return TreeAsync
            .tree(sBasePath)
            .then(aFiles => aFiles
                .filter(s => aLowerExts.length === 0 || aLowerExts.includes(path.extname(s).toLowerCase()))
                .map(s => path.resolve(sBasePath, s))
            );
    }
}
