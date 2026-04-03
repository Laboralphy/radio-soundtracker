import fs from 'fs/promises';
import path from 'path';

interface FileEntry {
    name: string;
    dir: boolean;
}

export class TreeAsync {
    static async exists(sPath: string): Promise<boolean> {
        try {
            return !!await fs.stat(sPath);
        } catch {
            return false;
        }
    }

    static async ls(sPath: string): Promise<FileEntry[]> {
        const list = await fs.readdir(sPath, { withFileTypes: true });
        return list.map(f => ({
            name: f.name,
            dir: f.isDirectory()
        }));
    }

    static async tree(sPath: string): Promise<string[]> {
        const aFiles = await TreeAsync.ls(sPath);
        const aEntries: string[] = [];
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
