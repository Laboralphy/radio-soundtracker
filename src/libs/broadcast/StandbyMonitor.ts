import type { EventEmitter } from 'node:events';
import { EVENTS } from '../vlc-control/consts.js';
import type { NewSongEvent } from '../vlc-control/ProgramPlayer.js';

/**
 * Why nothing plays: "idle" between programs, "trouble" after a playback error.
 */
export type StandbyReason = 'idle' | 'trouble';

export interface StandbyInfo {
    reason: StandbyReason;
    /**
     * The next scheduled program, if any. "at" is an ISO date.
     */
    next: { program: string; at: string } | null;
}

export interface StandbyMonitorOptions {
    /**
     * The player's events.
     */
    events: EventEmitter;
    nextScheduled: () => { name: string; at: Date } | null;
    onSong: (song: NewSongEvent) => void;
    onStandby: (info: StandbyInfo) => void;
    /**
     * How long without a song before going to standby, in ms. Programs follow each other in well under a second.
     */
    delay?: number;
}

const DEFAULT_DELAY = 3000;

/**
 * Watches the player and tells the screen what to show: the song playing, or a standby screen when
 * no song starts for a few seconds after the broadcast starts, a program ends, or playback fails.
 */
export class StandbyMonitor {
    private readonly _options: StandbyMonitorOptions;
    private readonly _delay: number;
    private _timer: ReturnType<typeof setTimeout> | null = null;
    private _reason: StandbyReason = 'idle';

    private readonly _onSong = (song: NewSongEvent) => {
        this._clear();
        this._options.onSong(song);
    };
    private readonly _onEnd = () => this._arm('idle');
    private readonly _onError = () => this._arm('trouble');

    constructor(options: StandbyMonitorOptions) {
        this._options = options;
        this._delay = options.delay ?? DEFAULT_DELAY;
    }

    start(): void {
        const { events } = this._options;
        events.on(EVENTS.EVENT_NEW_SONG, this._onSong);
        events.on(EVENTS.EVENT_PLAYLIST_END, this._onEnd);
        events.on(EVENTS.EVENT_ERROR, this._onError);
        this._arm('idle');
    }

    stop(): void {
        const { events } = this._options;
        events.off(EVENTS.EVENT_NEW_SONG, this._onSong);
        events.off(EVENTS.EVENT_PLAYLIST_END, this._onEnd);
        events.off(EVENTS.EVENT_ERROR, this._onError);
        this._clear();
    }

    /**
     * Starts the countdown to the standby screen. If it already runs, it keeps its deadline (it started
     * when the music stopped), and an error only changes the reason.
     */
    private _arm(reason: StandbyReason): void {
        if (this._timer !== null) {
            if (reason === 'trouble') {
                this._reason = reason;
            }
            return;
        }
        this._reason = reason;
        this._timer = setTimeout(() => {
            this._timer = null;
            const next = this._options.nextScheduled();
            this._options.onStandby({
                reason: this._reason,
                next: next === null ? null : { program: next.name, at: next.at.toISOString() },
            });
        }, this._delay);
    }

    private _clear(): void {
        if (this._timer !== null) {
            clearTimeout(this._timer);
            this._timer = null;
        }
    }
}
