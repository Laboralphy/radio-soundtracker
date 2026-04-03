import fs from 'fs';
import path from 'path';

interface FileEntry {
    name: string;
    dir: boolean;
}

export class TreeSync {
    static exists(sPath: string): boolean {
        try {
            return !!fs.statSync(sPath);
        } catch {
            return false;
        }
    }

    static ls(sPath: string): FileEntry[] {
        const list = fs.readdirSync(sPath, { withFileTypes: true });
        return list.map(f => ({
            name: f.name,
            dir: f.isDirectory()
        }));
    }

    static tree(sPath: string): string[] {
        const aFiles = TreeSync.ls(sPath);
        const aEntries: string[] = [];
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
