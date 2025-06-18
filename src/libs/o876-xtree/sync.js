const fs = require('fs');
const path = require('path');

class TreeSync {
    static exists (sPath) {
        try {
            return !!fs.statSync(sPath);
        } catch (e) {
            return false;
        }
    }

    static ls (sPath) {
        const list = fs.readdirSync(sPath, {
            withFileTypes: true
        });
        return list.map(f => ({
            name: f.name,
            dir: f.isDirectory()
        }));
    }

    static tree (sPath) {
        const aFiles = TreeSync.ls(sPath);
        const aEntries = [];
        for (let i = 0, l = aFiles.length; i < l; ++i) {
            const { name, dir } = aFiles[i];
            if (dir) {
                const sDirName = path.join(sPath, name);
                const aSubList = TreeSync.tree(sDirName);
                aEntries.push(...aSubList.map(f => path.join(name, f)));
            } else {
                aEntries.push(name);
            }
        }
        return aEntries;
    }
}

module.exports = TreeSync;
