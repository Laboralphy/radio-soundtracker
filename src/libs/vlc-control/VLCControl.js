const net = require('node:net');
const path = require('node:path');
const TreeAsync = require('../o876-xtree/async');

const CHECK_EOB = 'Bye-bye!';

class VLCControl {
    constructor ({
        host = 'localhost',
        port = 1234,
        timeout = 1000
    } = {}) {
        this._client = null;
        this._host = host;
        this._port = port;
        this._timeout = timeout;
    }

    /**
     * Sends a transaction to VLC
     * 1) Sends input command
     * 2) Collect responses
     * 3) Close connection when time out
     * @param sMessage {string}
     * @returns {Promise<string>}
     */
    sendTransaction (sMessage) {
        return new Promise((resolve, reject) => {
            const nTS = Math.random().toString(36).substring(2);
            const TS_LABEL = 'VLC-TIME-' + nTS;
            const client = new net.Socket();
            const outputBuffer = [];
            client.setTimeout(this._timeout);
            client.once('timeout', () => {
                client.end();
            });
            client.connect(this._port, this._host, () => {
                return this.write(client, sMessage + '\n');
            });
            client.on('data', (data) => {
                const sData = data.toString().replace(/\r/g, '');
                outputBuffer.push(sData);
                const response = outputBuffer
                    .join('')
                    .split('\n')
                    .map(s => s.trim())
                    .filter(s => s !== '');
                if (this.parseResponse(response).map(s => s.join('\n').length > 0)) {
                    client.end();
                }
            });
            client.on('close', () => {
                const response = outputBuffer
                    .join('')
                    .split('\n')
                    .map(s => s.trim())
                    .filter(s => s !== '');
                resolve(this.parseResponse(response).map(s => s.join('\n')).at(0));
            });
            client.on('error', (err) => {
                reject(err);
            });
        });
    }

    /**
     * Write something on vlc rc socket
     * @param client {net.Socket}
     * @param sMessage {string}
     * @returns {Promise<void>}
     */
    write (client, sMessage) {
        return new Promise((resolve, reject) => {
            if (!client) {
                reject(new Error('Client socket not created'));
                return;
            }
            if (client.destroyed) {
                reject(new Error('Client not connected (destroyed = true)'));
                return;
            }

            if (client.write(sMessage)) {
                resolve(); // L'écriture a réussi immédiatement
            } else {
                client.once('drain', () => {
                    resolve(); // Résolution après le vidage du buffer
                });
            }

            // Gestion des erreurs potentielles
            client.once('error', (err) => {
                reject(new Error(`Error during send: ${err.message}`));
            });
        });
    }

    /**
     * Extract useful data from response
     */
    parseResponse (aResponse) {
        const data = aResponse.reduce((prev, curr) => {
            if (curr.startsWith('> ')) {
                if (Array.isArray(prev.heap)) {
                    prev.heap.push(prev.current);
                } else {
                    prev.heap = [];
                }
                prev.current = [curr.substring(2)];
            } else if (Array.isArray(prev.current)) {
                prev.current.push(curr);
            }
            return prev;
        }, { current: null, heap: null });
        if (data.heap === null) {
            return [];
        }
        const nLength = data.current?.length ?? 0;
        if (nLength > 0) {
            data.heap.push(data.current);
        }
        return data.heap;
    }

    shuffleArray (aArray) {
        // Créer une copie du tableau pour éviter de modifier l'original
        const shuffled = [...aArray];

        // Parcourir le tableau à l'envers
        for (let i = shuffled.length - 1; i > 0; i--) {
            // Générer un index aléatoire entre 0 et i (inclus)
            const j = Math.floor(Math.random() * (i + 1));

            // Échanger les éléments aux indices i et j
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }

        return shuffled;
    }

    getFolderContent(sBasePath, aExtensions = []) {
        const aLowerExts = aExtensions.map(s => '.' + s.toLowerCase());
        return TreeAsync
            .tree(sBasePath)
            .then(aFiles => aFiles
                .filter(s => aLowerExts.length === 0 || aLowerExts.includes(path.extname(s).toLowerCase()))
                .map(s => path.resolve(sBasePath, s))
            );
    }

    renderSwitchValue (sSwitch, b) {
        return sSwitch + ' ' + (b ? 'on' : 'off');
    }

    /****** COMMANDS ****** COMMANDS ****** COMMANDS ****** COMMANDS ****** COMMANDS *******/
    /****** COMMANDS ****** COMMANDS ****** COMMANDS ****** COMMANDS ****** COMMANDS *******/
    /****** COMMANDS ****** COMMANDS ****** COMMANDS ****** COMMANDS ****** COMMANDS *******/

    /**
     * Make VLC terminate itself
     * @return {Promise<string>}
     */
    doQuit () {
        return this.sendTransaction('quit');
    }

    /**
     * Append a songfile to the current playlist without altering current play state
     * @param xFile {string | string[]} song file name to be added
     * @return {Promise<string>}
     */
    doEnqueue (xFile) {
        if (Array.isArray(xFile)) {
            return this.sendTransaction(xFile.map(s => 'enqueue ' + s).join('\n'));
        } else if (typeof xFile === 'string') {
            return this.sendTransaction('enqueue ' + xFile);
        }
    }

    doClearPlaylist () {
        return this.sendTransaction('clear');
    }

    /**
     *
     * @param oProgram {Program}
     * @returns {Promise<string>}
     */
    async doPlayProgram (oProgram) {
        await this.doStop();
        await this.doClearPlaylist();
        const aList = await oProgram.renderList();
        await this.doEnqueue(aList);
        return this.doPlay();
    }

    /**
     * Start playing
     * @returns {Promise<string>}
     */
    doPlay () {
        return this.sendTransaction('play');
    }

    doRandom (b) {
        return this.sendTransaction(this.renderSwitchValue('random', b));
    }

    doLoop (b) {
        return this.sendTransaction(this.renderSwitchValue('loop', b));
    }

    doRepeat (b) {
        return this.sendTransaction(this.renderSwitchValue('repeat', b));
    }

    doVolume (n) {
        return this.sendTransaction('volume ' + n.toString());
    }

    /**
     * Stop playing
     * @returns {Promise<string>}
     */
    doStop () {
        return this.sendTransaction('stop');
    }

    /**
     * Pause playing
     * @returns {Promise<string>}
     */
    doPause () {
        return this.sendTransaction('pause');
    }

    /**
     * Play previous song in playlist
     * @returns {Promise<string>}
     */
    doPrev () {
        return this.sendTransaction('prev');
    }

    /**
     * Play next song in playlist
     * @returns {Promise<string>}
     */
    doNext () {
        return this.sendTransaction('next');
    }

    async isPlaying () {
        const a = await this.sendTransaction('is_playing');
        return a === '1';
    }

    async getTime () {
        const a = await this.sendTransaction('get_time');
        const b = await this.sendTransaction('get_length');
        const nTime = parseInt(a);
        const nLength = parseInt(b);
        return {
            time: nTime,
            total: nLength,
            remaining: !isNaN(nTime) && !isNaN(nLength) ? nLength - nTime : NaN
        };
    }

    getTitle () {
        return this.sendTransaction('get_title');
    }

    getStatus () {
        return this.sendTransaction('status');
    }

    getPlaylist () {
        return this.sendTransaction('playlist');
    }

    getVolume () {
        return this.sendTransaction('volume');
    }
}

module.exports = VLCControl;
