import net from 'node:net';

export interface VLCConnectionOptions {
    host?: string;
    port?: number;
    timeout?: number;
}

const PROMPT = '> ';

/**
 * Extracts a complete response from the data received since the last prompt.
 * VLC prints a prompt ("> ", no newline) each time it waits for input,
 * so a response is complete when the buffer ends with a prompt.
 * Returns null while the buffer does not end with a prompt yet.
 */
export function extractResponse(sBuffer: string): string | null {
    const s = sBuffer.replace(/\r/g, '');
    if (!s.endsWith(PROMPT)) {
        return null;
    }
    const sBody = s.slice(0, -PROMPT.length);
    if (sBody !== '' && !sBody.endsWith('\n')) {
        // "> " appears in the middle of a line: not a prompt
        return null;
    }
    return sBody.replace(/\n$/, '');
}

export class VLCConnection {
    private _host: string;
    private _port: number;
    private _timeout: number;
    private _queue: Promise<unknown> = Promise.resolve();

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
     * Sends a single command to VLC and resolves with its response.
     */
    async sendTransaction(sCommand: string): Promise<string> {
        const [sResponse] = await this.sendBatch([sCommand]);
        return sResponse;
    }

    /**
     * Sends several commands over one TCP connection and resolves with one response per command.
     * Commands are sent one at a time: the next one is only written once VLC has answered
     * the previous one with a prompt. Batches are serialized, so two callers never share
     * the RC interface at the same time.
     * Rejects if VLC does not answer within the timeout.
     */
    sendBatch(aCommands: string[]): Promise<string[]> {
        const p = this._queue.then(() => this.runBatch(aCommands));
        this._queue = p.catch(() => undefined);
        return p;
    }

    private runBatch(aCommands: string[]): Promise<string[]> {
        return new Promise((resolve, reject) => {
            const client = new net.Socket();
            const aResponses: string[] = [];
            let sBuffer = '';
            let bBannerSkipped = false;
            let bDone = false;

            const finish = (err: Error | null) => {
                if (bDone) {
                    return;
                }
                bDone = true;
                client.destroy();
                if (err) {
                    reject(err);
                } else {
                    resolve(aResponses);
                }
            };

            const sendNext = () => {
                const sCommand = aCommands[aResponses.length];
                if (sCommand === undefined) {
                    finish(null);
                } else {
                    client.write(sCommand + '\n');
                }
            };

            client.setTimeout(this._timeout);
            client.on('timeout', () => {
                const sPending = aCommands[aResponses.length] ?? '(connection)';
                finish(new Error(`VLC RC timeout after ${this._timeout}ms waiting for "${sPending}"`));
            });
            client.on('error', (err: NodeJS.ErrnoException) => {
                finish(new Error(`VLC RC error at ${this._host}:${this._port}: ${err.code ?? err.message}`, { cause: err }));
            });
            client.on('close', () => {
                finish(new Error('VLC RC connection closed before all responses were received'));
            });
            client.on('data', (data: Buffer) => {
                sBuffer += data.toString();
                const sResponse = extractResponse(sBuffer);
                if (sResponse === null) {
                    return;
                }
                sBuffer = '';
                if (bBannerSkipped) {
                    aResponses.push(sResponse);
                } else {
                    // the first prompt follows the welcome banner
                    bBannerSkipped = true;
                }
                sendNext();
            });
            client.connect(this._port, this._host);
        });
    }
}
