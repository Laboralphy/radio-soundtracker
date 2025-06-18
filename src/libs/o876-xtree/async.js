const fs = require('fs/promises');
const path = require('path');

class TreeAsync {
    static async exists (sPath) {
        try {
            return !!await fs.stat(sPath);
        } catch (e) {
            return false;
        }
    }

    static async ls (sPath) {
        const list = await fs.readdir(sPath, {
            withFileTypes: true
        });
        return list.map(f => ({
            name: f.name,
            dir: f.isDirectory()
        }));
    }

    static async tree (sPath) {
        const aFiles = await TreeAsync.ls(sPath);
        const aEntries = [];
        for (let i = 0, l = aFiles.length; i < l; ++i) {
            const { name, dir } = aFiles[i];
            if (dir) {
                const sDirName = path.join(sPath, name);
                const aSubList = await TreeAsync.tree(sDirName);
                aEntries.push(...aSubList.map(f => path.join(name, f)));
            } else {
                aEntries.push(name);
            }
        }
        return aEntries;
    }
}

module.exports = TreeAsync;
