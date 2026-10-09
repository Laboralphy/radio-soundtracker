import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { StandbyMonitor, type StandbyInfo } from '../src/libs/broadcast/StandbyMonitor.js';
import { EVENTS } from '../src/libs/vlc-control/consts.js';
import type { NewSongEvent } from '../src/libs/vlc-control/ProgramPlayer.js';

const SONG: NewSongEvent = { title: 'Song', file: '/a.mod', remainingTime: 60, elapsed: 0, duration: 60, next: null, program: 'main' };
const NIGHT = { name: 'night', at: new Date('2026-10-09T20:00:00Z') };

let events: EventEmitter;
let songs: NewSongEvent[];
let standbys: StandbyInfo[];
let next: { name: string; at: Date } | null;
let monitor: StandbyMonitor;

beforeEach(() => {
    vi.useFakeTimers();
    events = new EventEmitter();
    songs = [];
    standbys = [];
    next = null;
    monitor = new StandbyMonitor({
        events,
        nextScheduled: () => next,
        onSong: song => songs.push(song),
        onStandby: info => standbys.push(info),
    });
    monitor.start();
});

afterEach(() => {
    monitor.stop();
    vi.useRealTimers();
});

describe('StandbyMonitor', () => {
    it('shows the standby screen when no song starts after the broadcast starts', () => {
        vi.advanceTimersByTime(3000);
        expect(standbys).toEqual([{ reason: 'idle', next: null }]);
    });

    it('passes songs on, and stays quiet while programs follow each other', () => {
        events.emit(EVENTS.EVENT_NEW_SONG, SONG);
        events.emit(EVENTS.EVENT_PLAYLIST_END);
        vi.advanceTimersByTime(500);
        events.emit(EVENTS.EVENT_NEW_SONG, SONG);
        vi.advanceTimersByTime(10000);
        expect(songs).toHaveLength(2);
        expect(standbys).toEqual([]);
    });

    it('reports trouble after a playback error, with the next scheduled program', () => {
        next = NIGHT;
        events.emit(EVENTS.EVENT_NEW_SONG, SONG);
        events.emit(EVENTS.EVENT_ERROR, new Error('VLC is gone'));
        vi.advanceTimersByTime(3000);
        expect(standbys).toEqual([{ reason: 'trouble', next: { program: 'night', at: '2026-10-09T20:00:00.000Z' } }]);
    });

    it('counts from when the music stopped, even if errors keep coming', () => {
        events.emit(EVENTS.EVENT_NEW_SONG, SONG);
        events.emit(EVENTS.EVENT_PLAYLIST_END);
        vi.advanceTimersByTime(1000);
        events.emit(EVENTS.EVENT_ERROR, new Error('missing folder'));
        vi.advanceTimersByTime(1000);
        events.emit(EVENTS.EVENT_ERROR, new Error('missing folder'));
        vi.advanceTimersByTime(1000);
        expect(standbys).toEqual([{ reason: 'trouble', next: null }]);
    });

    it('stops listening once stopped', () => {
        monitor.stop();
        events.emit(EVENTS.EVENT_NEW_SONG, SONG);
        vi.advanceTimersByTime(3000);
        expect(songs).toEqual([]);
        expect(standbys).toEqual([]);
    });
});
