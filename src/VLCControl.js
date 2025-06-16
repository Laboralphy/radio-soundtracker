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
        this._timeoutId = 0;
        this._timeoutHandler = null;
        this._response = [];
    }

    sendTransaction (sMessage) {
        return new Promise((resolve, reject) => {
            const client = new net.Socket();
            this._client = client;
            client.setTimeout(this._timeout);
            client.on('timeout', () => {
                this.disconnect();
            });
            client.connect(this._port, this._host, () => {
                return this.write(sMessage + '\n');
            });
            client.on('data', (data) => {
                this._response.push(data);
            });
            client.on('close', () => {
                resolve(this._response);
            });
            client.on('error', (err) => {
                reject(err);
            });
        });
    }

    disconnect () {
        if (this._client) {
            this._client.end();
        }
        this._client = null;
    }

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
}

module.exports = VLCControl;
