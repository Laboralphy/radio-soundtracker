const net = require('net');

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
        this._outputBuffer = '';
        this._response = [];
    }

    /**
     * Sends a transaction to VLC
     * 1) Sends input command
     * 2) Collect responses
     * 3) Close connection when time out
     * @param sMessage {string}
     * @returns {Promise<string[]>}
     */
    sendTransaction (sMessage) {
        return new Promise((resolve, reject) => {
            const client = new net.Socket();
            this._client = client;
            client.setTimeout(this._timeout);
            client.once('timeout', () => {
                this.disconnect();
            });
            client.connect(this._port, this._host, () => {
                return this.write(sMessage + '\n');
            });
            client.on('data', (data) => {
                this._outputBuffer += data.toString().replace(/\r/g, '');
                if (this._outputBuffer.indexOf('> Bye-bye!\n')) {
                    this.disconnect();
                }
            });
            client.on('close', () => {
                this._response = this
                    ._outputBuffer
                    .split('\n')
                    .map(s => s.trim())
                    .filter(s => s !== '');
                resolve(this._response);
            });
            client.on('error', (err) => {
                reject(err);
            });
        });
    }

    /**
     * Close socket to vlc rc
     */
    disconnect () {
        if (this._client) {
            this._client.end();
        }
        this._client = null;
    }

    /**
     * Write something on vlc rc socket
     * @param sMessage {string}
     * @returns {Promise<void>}
     */
    write (sMessage) {
        return new Promise((resolve, reject) => {
            if (!this._client || this._client.destroyed) {
                reject(new Error('Client not connected'));
                return;
            }

            if (this._client.write(sMessage)) {
                resolve(); // L'écriture a réussi immédiatement
            } else {
                this._client.once('drain', () => {
                    resolve(); // Résolution après le vidage du buffer
                });
            }

            // Gestion des erreurs potentielles
            this._client.once('error', (err) => {
                reject(new Error(`Error during send: ${err.message}`));
            });
        });
    }

    /****** COMMANDS ****** COMMANDS ****** COMMANDS ****** COMMANDS ****** COMMANDS *******/
    /****** COMMANDS ****** COMMANDS ****** COMMANDS ****** COMMANDS ****** COMMANDS *******/
    /****** COMMANDS ****** COMMANDS ****** COMMANDS ****** COMMANDS ****** COMMANDS *******/

    /**
     * Make VLC terminate itself
     * @return {Promise<string[]>}
     */
    doQuit () {
        return this.sendTransaction('quit');
    }

    /**
     * Append a songfile to the current playlist without altering current play state
     * @param sFile {string} song file name to be added
     * @return {Promise<string[]>}
     */
    doEnqueue (sFile) {
        return this.sendTransaction('enqueue');
    }

    /**
     * Start playing
     * @returns {Promise<string[]>}
     */
    doPlay () {
        return this.sendTransaction('play');
    }

    /**
     * Stop playing
     * @returns {Promise<string[]>}
     */
    doStop () {
        return this.sendTransaction('stop');
    }

    /**
     * Pause playing
     * @returns {Promise<string[]>}
     */
    doPause () {
        return this.sendTransaction('pause');
    }

    /**
     * Play previous song in playlist
     * @returns {Promise<string[]>}
     */
    doPrev () {
        return this.sendTransaction('prev');
    }

    /**
     * Play next song in playlist
     * @returns {Promise<string[]>}
     */
    doNext () {
        return this.sendTransaction('next');
    }

    async isPlaying () {
        const a = await this.sendTransaction('is_playing');
        return a[2] === '> 1';
    }

    async getTime () {
        const a = await this.sendTransaction('get_time');
        const b = await this.sendTransaction('get_length');
        const nTime = parseInt(a[2].substring(2));
        const nLength = parseInt(b[2].substring(2));
        return {
            time: nTime,
            total: nLength
        };
    }

    async getTitle () {
        const a = await this.sendTransaction('get_title');
        return a[2].substring(2);
    }
}

module.exports = VLCControl;
