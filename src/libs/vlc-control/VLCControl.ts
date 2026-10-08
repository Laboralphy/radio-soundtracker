import { VLCConnection, VLCConnectionOptions } from './VLCConnection.js';

export interface TimeInfo {
    time: number;
    total: number;
    remaining: number;
}

export class VLCControl {
    private _connection: VLCConnection;

    constructor({
        host = 'localhost',
        port = 1234,
        timeout = 1000
    }: VLCConnectionOptions = {}) {
        this._connection = new VLCConnection({ host, port, timeout });
    }

    private renderSwitchValue(sSwitch: string, b: boolean): string {
        return sSwitch + ' ' + (b ? 'on' : 'off');
    }

    /****** COMMANDS ****** COMMANDS ****** COMMANDS ****** COMMANDS ****** COMMANDS *******/

    doQuit(): Promise<string> {
        return this._connection.sendTransaction('quit');
    }

    doEnqueue(xFile: string | string[]): Promise<string> {
        if (Array.isArray(xFile)) {
            return this._connection
                .sendBatch(xFile.map(s => 'enqueue ' + s))
                .then(aResponses => aResponses.join('\n'));
        } else {
            return this._connection.sendTransaction('enqueue ' + xFile);
        }
    }

    doClearPlaylist(): Promise<string> {
        return this._connection.sendTransaction('clear');
    }

    doPlay(): Promise<string> {
        return this._connection.sendTransaction('play');
    }

    doRandom(b: boolean): Promise<string> {
        return this._connection.sendTransaction(this.renderSwitchValue('random', b));
    }

    doLoop(b: boolean): Promise<string> {
        return this._connection.sendTransaction(this.renderSwitchValue('loop', b));
    }

    doRepeat(b: boolean): Promise<string> {
        return this._connection.sendTransaction(this.renderSwitchValue('repeat', b));
    }

    doVolume(n: number): Promise<string> {
        return this._connection.sendTransaction('volume ' + n.toString());
    }

    doStop(): Promise<string> {
        return this._connection.sendTransaction('stop');
    }

    doPause(): Promise<string> {
        return this._connection.sendTransaction('pause');
    }

    doPrev(): Promise<string> {
        return this._connection.sendTransaction('prev');
    }

    doNext(): Promise<string> {
        return this._connection.sendTransaction('next');
    }

    async isPlaying(): Promise<boolean> {
        const a = await this._connection.sendTransaction('is_playing');
        return a === '1';
    }

    async getTime(): Promise<TimeInfo> {
        const [timePart = '', lengthPart = ''] = await this._connection.sendBatch(['get_time', 'get_length']);
        const nTime = Number.parseInt(timePart);
        const nLength = Number.parseInt(lengthPart);
        return {
            time: nTime,
            total: nLength,
            remaining: !Number.isNaN(nTime) && !Number.isNaN(nLength) ? nLength - nTime : Number.NaN
        };
    }

    getTitle(): Promise<string> {
        return this._connection.sendTransaction('get_title');
    }

    getStatus(): Promise<string> {
        return this._connection.sendTransaction('status');
    }

    getPlaylist(): Promise<string> {
        return this._connection.sendTransaction('playlist');
    }

    getVolume(): Promise<string> {
        return this._connection.sendTransaction('volume');
    }
}
