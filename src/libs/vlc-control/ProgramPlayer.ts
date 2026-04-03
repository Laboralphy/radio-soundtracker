import { VLCControl } from './VLCControl.js';
import { EVENTS } from './consts.js';
import Events, { EventEmitter } from 'node:events';
import type { Program } from './Program.js';
import { logger } from '../logger/index.js';

interface NewSongEvent {
    title: string;
    remainingTime: number;
    file: string;
}

interface ProgramPlayerOptions {
    vlc?: VLCControl;
}

export class ProgramPlayer {
    private _vlcctl: VLCControl | null = null;
    private _remainingTime: number;
    private _doomLoopTimerId: ReturnType<typeof setInterval> | null;
    private _events: EventEmitter;
    private _lastTitle: string;

    constructor({vlc = undefined}: ProgramPlayerOptions = {}) {
        if (vlc) {
            this.vlc = vlc;
        }
        this._remainingTime = 0;
        this._doomLoopTimerId = null;
        this._events = new Events();
        this._lastTitle = '';
    }

    get vlc(): VLCControl {
        if (!this._vlcctl) {
            throw new Error('VLCControl not initialized');
        }
        return this._vlcctl;
    }

    set vlc(value: VLCControl) {
        this._vlcctl = value;
    }

    get events(): EventEmitter {
        return this._events;
    }

    async getSongFile(): Promise<string> {
        const status = await this.vlc.getStatus();
        const sFirstLine = status.split('\n').shift() ?? '';
        const r = /\(\s+new input:\s+(.*)\s*\)$/.exec(sFirstLine);
        if (r) {
            const sSongFileFullName = r[1];
            const oParsedFileName = URL.parse(sSongFileFullName);
            return oParsedFileName ? oParsedFileName.pathname ?? sSongFileFullName : sSongFileFullName;
        } else {
            logger.debug(`getSongFile: unexpected status format: ${status}`);
            return '';
        }
    }

    async triggerNewSong(): Promise<void> {
        const { remaining } = await this.vlc.getTime();
        logger.debug(`triggerNewSong: remaining=${remaining}`);
        if (Number.isNaN(remaining)) {
            this._remainingTime = 0;
            return;
        }
        const sTitle = await this.vlc.getTitle();
        const sFileName = await this.getSongFile();
        logger.debug(`triggerNewSong: title="${sTitle}" lastTitle="${this._lastTitle}" file="${sFileName}"`);
        this._remainingTime = remaining;
        if (this._lastTitle !== sTitle) {
            this._lastTitle = sTitle;
            this._events.emit(EVENTS.EVENT_NEW_SONG, {
                title: sTitle,
                remainingTime: remaining,
                file: sFileName
            } satisfies NewSongEvent);
        }
    }

    async doomLoop(): Promise<void> {
        --this._remainingTime;
        if (this._remainingTime > 0) {
            return;
        }
        try {
            const bPlaying = await this.vlc.isPlaying();
            if (bPlaying) {
                await this.triggerNewSong();
            } else {
                this.stopDoomLoop();
            }
        } catch (err) {
            this.cleanupLoop();
            this._events.emit(EVENTS.EVENT_ERROR, err);
        }
    }

    private cleanupLoop(): void {
        if (this._doomLoopTimerId !== null) {
            this._remainingTime = 0;
            clearInterval(this._doomLoopTimerId);
            this._doomLoopTimerId = null;
        }
    }

    stopDoomLoop(): void {
        if (this._doomLoopTimerId !== null) {
            this.cleanupLoop();
            this._events.emit(EVENTS.EVENT_PLAYLIST_END);
        }
    }

    startDoomLoop(): void {
        this.stopDoomLoop();
        this._doomLoopTimerId = setInterval(() => this.doomLoop(), 1000);
    }

    playProgram(oProgram: Program): Promise<void> {
        return new Promise((resolve, reject) => {
            const onEnd = () => {
                this._events.removeListener(EVENTS.EVENT_ERROR, onError);
                resolve();
            };
            const onError = (err: unknown) => {
                this._events.removeListener(EVENTS.EVENT_PLAYLIST_END, onEnd);
                reject(err);
            };
            this._events.once(EVENTS.EVENT_PLAYLIST_END, onEnd);
            this._events.once(EVENTS.EVENT_ERROR, onError);
            this.vlc.doStop()
                .then(() => this.vlc.doClearPlaylist())
                .then(() => oProgram.renderList())
                .then(aList => this.vlc.doEnqueue(aList))
                .then(() => this.vlc.doPlay())
                .then(() => this.triggerNewSong())
                .then(() => this.startDoomLoop())
                .catch(err => {
                    this._events.removeListener(EVENTS.EVENT_PLAYLIST_END, onEnd);
                    this._events.removeListener(EVENTS.EVENT_ERROR, onError);
                    reject(err);
                });
        });
    }
}
