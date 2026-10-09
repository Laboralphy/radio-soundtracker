import { fileURLToPath } from 'node:url';
import { VLCControl } from './VLCControl.js';
import { EVENTS } from './consts.js';
import Events, { EventEmitter } from 'node:events';
import type { Program } from './Program.js';
import type { Player } from './Player.js';
import { logger } from '../logger/index.js';

export interface NewSongEvent {
    title: string;
    file: string;
    /**
     * Seconds left in the song when the event was emitted.
     */
    remainingTime: number;
    /**
     * Seconds already played when the event was emitted.
     */
    elapsed: number;
    /**
     * Length of the song in seconds.
     */
    duration: number;
    /**
     * File of the song that follows in the program, or null for the last one.
     */
    next: string | null;
    /**
     * Name of the program being played, '' if it has none.
     */
    program: string;
}

interface ProgramPlayerOptions {
    vlc?: VLCControl;
}

interface Run {
    id: number;
    resolve: () => void;
    reject: (err: unknown) => void;
}

/**
 * Number of consecutive failed polls tolerated before the program is aborted with EVENT_ERROR.
 */
const MAX_CONSECUTIVE_ERRORS = 3;

/**
 * Number of consecutive "not playing" polls needed to consider the playlist finished.
 * VLC can briefly report "not playing" while switching to the next song; after the last song
 * there is no next song, so one poll is enough there.
 */
const NOT_PLAYING_CONFIRMATIONS = 2;

/**
 * Longest wait between two polls, in seconds. Bounds the damage of a wrong song length
 * and catches song changes made outside this player.
 */
const MAX_POLL_INTERVAL = 60;

/**
 * Wait between two polls, in seconds, around the end of the last song of a program,
 * so the next program starts with as little silence as possible.
 */
const END_POLL_INTERVAL = 0.25;

export class ProgramPlayer implements Player {
    private _vlcctl: VLCControl | null = null;
    private _remainingTime: number;
    private _doomLoopTimerId: ReturnType<typeof setTimeout> | null;
    private _events: EventEmitter;
    private _lastSong: string;
    private _playlist: string[] = [];
    private _position = -1;
    private _programName = '';
    private _run: Run | null = null;
    private _runCount = 0;
    private _consecutiveErrors = 0;
    private _notPlayingCount = 0;

    constructor({vlc = undefined}: ProgramPlayerOptions = {}) {
        if (vlc) {
            this.vlc = vlc;
        }
        this._remainingTime = 0;
        this._doomLoopTimerId = null;
        this._events = new Events();
        this._lastSong = '';
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
        const r = /\(\s+new input:\s+(.*?)\s*\)$/.exec(sFirstLine);
        if (r) {
            const sSongFileFullName = r[1];
            if (!sSongFileFullName.startsWith('file://')) {
                return sSongFileFullName;
            }
            try {
                return fileURLToPath(sSongFileFullName);
            } catch {
                // VLC prints the path unescaped: a "%" in a file name is not a valid escape
                return sSongFileFullName.substring('file://'.length);
            }
        } else {
            logger.debug(`getSongFile: unexpected status format: ${status}`);
            return '';
        }
    }

    async triggerNewSong(): Promise<void> {
        const { time, total, remaining } = await this.vlc.getTime();
        logger.debug(`triggerNewSong: remaining=${remaining}`);
        if (Number.isNaN(remaining)) {
            this._remainingTime = 0;
            return;
        }
        const sTitle = await this.vlc.getTitle();
        const sFileName = await this.getSongFile();
        logger.debug(`triggerNewSong: title="${sTitle}" file="${sFileName}"`);
        this._remainingTime = remaining;
        // songs in a row may share a title (often empty in modules): the file tells them apart
        const sSong = sFileName + '\0' + sTitle;
        if (this._lastSong !== sSong) {
            this._lastSong = sSong;
            this._events.emit(EVENTS.EVENT_NEW_SONG, {
                title: sTitle,
                file: sFileName,
                remainingTime: remaining,
                elapsed: time,
                duration: total,
                next: this.findNext(sFileName),
                program: this._programName,
            } satisfies NewSongEvent);
        }
    }

    /**
     * Finds the song after the given one in the playlist sent to VLC.
     * Searches forward from the previous song first, as a file may appear more than once.
     */
    private findNext(sFile: string): string | null {
        let index = this._playlist.indexOf(sFile, this._position + 1);
        if (index < 0) {
            index = this._playlist.indexOf(sFile);
        }
        this._position = index;
        return index >= 0 ? this._playlist[index + 1] ?? null : null;
    }

    private isCurrentRun(id: number): boolean {
        return this._run !== null && this._run.id === id;
    }

    private clearTimer(): void {
        if (this._doomLoopTimerId !== null) {
            clearTimeout(this._doomLoopTimerId);
            this._doomLoopTimerId = null;
        }
    }

    /**
     * Ends the run: emits EVENT_PLAYLIST_END (or EVENT_ERROR) and settles its playProgram promise.
     * Does nothing if the run is no longer the current one.
     */
    private finishRun(id: number, err?: unknown): void {
        const run = this._run;
        if (run === null || run.id !== id) {
            return;
        }
        this._run = null;
        this._remainingTime = 0;
        this.clearTimer();
        if (err === undefined) {
            this._events.emit(EVENTS.EVENT_PLAYLIST_END);
            run.resolve();
        } else {
            this._events.emit(EVENTS.EVENT_ERROR, err);
            run.reject(err);
        }
    }

    private isLastSong(): boolean {
        return this._position >= 0 && this._position === this._playlist.length - 1;
    }

    /**
     * Seconds until the next poll: at the end of the current song, or, for the last song of the
     * program, shortly before its end and then often.
     */
    private nextPollDelay(): number {
        if (this.isLastSong()) {
            return Math.min(Math.max(this._remainingTime - 1, END_POLL_INTERVAL), MAX_POLL_INTERVAL);
        }
        return Math.min(Math.max(this._remainingTime, 1), MAX_POLL_INTERVAL);
    }

    /**
     * Schedules the next poll, by default at the end of the current song.
     */
    private scheduleDoomLoop(id: number, nDelay: number = this.nextPollDelay()): void {
        this.clearTimer();
        this._doomLoopTimerId = setTimeout(() => void this.doomLoop(id), nDelay * 1000);
    }

    private async doomLoop(id: number): Promise<void> {
        this._doomLoopTimerId = null;
        if (!this.isCurrentRun(id)) {
            return;
        }
        try {
            const bPlaying = await this.vlc.isPlaying();
            if (!this.isCurrentRun(id)) {
                return;
            }
            this._consecutiveErrors = 0;
            if (bPlaying) {
                this._notPlayingCount = 0;
                // in the last second of the program nothing can change: only wait for the end, with cheap polls
                if (!(this.isLastSong() && this._remainingTime <= 1)) {
                    await this.triggerNewSong();
                }
            } else if (++this._notPlayingCount >= NOT_PLAYING_CONFIRMATIONS || this.isLastSong()) {
                this.finishRun(id);
                return;
            } else {
                this._remainingTime = 1;
            }
        } catch (err) {
            if (++this._consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                this.finishRun(id, err);
                return;
            }
            logger.warn(`VLC poll failed (${this._consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}): ${err}`);
            if (this.isCurrentRun(id)) {
                this.scheduleDoomLoop(id, 1);
            }
            return;
        }
        if (this.isCurrentRun(id)) {
            this.scheduleDoomLoop(id);
        }
    }

    /**
     * Stops tracking the current program: its playProgram promise resolves.
     * VLC keeps playing; use stop() to also stop the audio.
     */
    stopDoomLoop(): void {
        if (this._run !== null) {
            this.finishRun(this._run.id);
        }
    }

    async stop(): Promise<void> {
        this.stopDoomLoop();
        await this.vlc.doStop();
    }

    private async startRun(id: number, oProgram: Program): Promise<void> {
        const aList = await oProgram.renderList();
        if (aList.length === 0) {
            throw new Error('Program has no playable file');
        }
        if (!this.isCurrentRun(id)) {
            return;
        }
        await this.vlc.doStop();
        await this.vlc.doClearPlaylist();
        await this.vlc.doEnqueue(aList);
        await this.vlc.doPlay();
        if (!this.isCurrentRun(id)) {
            return;
        }
        this._lastSong = '';
        this._playlist = aList;
        this._position = -1;
        this._programName = oProgram.name;
        this._consecutiveErrors = 0;
        this._notPlayingCount = 0;
        await this.triggerNewSong();
        if (this.isCurrentRun(id)) {
            this.scheduleDoomLoop(id);
        }
    }

    /**
     * Replaces the VLC playlist with the program and plays it.
     * Resolves when the playlist ends or when interrupted (stopDoomLoop, stop, or another playProgram).
     * Rejects if the program cannot be started or VLC stops answering.
     */
    playProgram(oProgram: Program): Promise<void> {
        this.stopDoomLoop();
        const id = ++this._runCount;
        return new Promise((resolve, reject) => {
            this._run = { id, resolve, reject };
            this.startRun(id, oProgram).catch(err => this.finishRun(id, err));
        });
    }
}
