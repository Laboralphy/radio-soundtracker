import net from 'node:net';

export interface VLCConnectionOptions {
    host?: string;
    port?: number;
    timeout?: number;
}

interface ParseAccumulator {
    current: string[] | null;
    heap: string[][] | null;
}

export class VLCConnection {
    private _host: string;
    private _port: number;
    private _timeout: number;

    constructor({
        host = 'localhost',
        port = 1234,
        timeout = 1000
    }: VLCConnectionOptions = {}) {
        this._host = host;
        this._port = port;
        this._timeout = timeout;
    }

    /**
     * Sends a transaction to VLC
     * 1) Sends input command
     * 2) Collect responses
     * 3) Close connection when time out
     */
    sendTransaction(sMessage: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const client = new net.Socket();
            const outputBuffer: string[] = [];
            client.setTimeout(this._timeout);
            client.once('timeout', () => {
                client.end();
            });
            client.connect(this._port, this._host, () => {
                return this.write(client, sMessage + '\n');
            });
            client.on('data', (data: Buffer) => {
                const sData = data.toString().replace(/\r/g, '');
                outputBuffer.push(sData);
                const response = outputBuffer
                    .join('')
                    .split('\n')
                    .map(s => s.trim())
                    .filter(s => s !== '');
                if (this.parseResponse(response).length >= 1) {
                    client.end();
                }
            });
            client.on('close', () => {
                const response = outputBuffer
                    .join('')
                    .split('\n')
                    .map(s => s.trim())
                    .filter(s => s !== '');
                resolve(this.parseResponse(response).map(s => s.join('\n')).at(0) ?? '');
            });
            client.on('error', (err: Error) => {
                reject(err);
            });
        });
    }

    /**
     * Sends multiple commands in a single TCP connection and returns all responses
     */
    sendBatch(commands: string[]): Promise<string[]> {
        return new Promise((resolve, reject) => {
            const client = new net.Socket();
            const outputBuffer: string[] = [];
            client.setTimeout(this._timeout);
            client.once('timeout', () => {
                client.end();
            });
            client.connect(this._port, this._host, () => {
                return this.write(client, commands.join('\n') + '\n');
            });
            client.on('data', (data: Buffer) => {
                const sData = data.toString().replace(/\r/g, '');
                outputBuffer.push(sData);
                const response = outputBuffer
                    .join('')
                    .split('\n')
                    .map(s => s.trim())
                    .filter(s => s !== '');
                if (this.parseResponse(response).length >= commands.length) {
                    client.end();
                }
            });
            client.on('close', () => {
                const response = outputBuffer
                    .join('')
                    .split('\n')
                    .map(s => s.trim())
                    .filter(s => s !== '');
                resolve(this.parseResponse(response).map(s => s.join('\n')));
            });
            client.on('error', (err: Error) => {
                reject(err);
            });
        });
    }

    /**
     * Write something on vlc rc socket
     */
    private write(client: net.Socket, sMessage: string): Promise<void> {
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
                resolve();
            } else {
                client.once('drain', () => {
                    resolve();
                });
            }
            client.once('error', (err: Error) => {
                reject(new Error(`Error during send: ${err.message}`));
            });
        });
    }

    /**
     * Extract useful data from response
     */
    private parseResponse(aResponse: string[]): string[][] {
        const data = aResponse.reduce<ParseAccumulator>((prev, curr) => {
            if (curr.startsWith('> ')) {
                if (Array.isArray(prev.heap)) {
                    prev.heap.push(prev.current!);
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
            data.heap.push(data.current!);
        }
        return data.heap;
    }
}
