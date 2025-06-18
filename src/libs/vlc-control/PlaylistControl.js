const VLCControl = require('./VLCControl');
const EVENTS = require('./Events');
const Events = require('node:events');

class PlaylistControl {
    constructor ({ vlc = undefined } = {}) {
        this._vlcctl = null;
        if (vlc) {
            this.vlc = vlc;
        }
        this._remainingTime = 0;
        this._doomLoopTimerId = 0;
        this._events = new Events();
        this._lastFile  = '';
    }

    get vlc () {
        return this._vlcctl;
    }

    set vlc (value) {
        if (value instanceof VLCControl) {
            this._vlcctl = value;
        }
    }

    get events () {
        return this._events;
    }

    async getSongFile () {
        const status = await this.vlc.getStatus();
        const sFirstLine = status.split('\n').shift();
        const r = sFirstLine.match(/\(new input:\s+(.*)\)$/);
        if (r) {
            return r[1];
        }
    }

    async triggerNewSong () {
        const { remaining } = await this.vlc.getTime();
        if (isNaN(remaining)) {
            this._remainingTime = 0;
            return;
        }
        const sTitle = await this.vlc.getTitle();
        const sFileName = await this.getSongFile();
        this._remainingTime = remaining;
        this._events.emit(EVENTS.EVENT_NEW_SONG, {
            title: sTitle,
            remainingTime: remaining,
            file: sFileName
        });
    }

    async doomLoop () {
        --this._remainingTime;
        if (this._remainingTime > 0) {
            return;
        }
        const bPlaying = await this.vlc.isPlaying();
        if (bPlaying) {
            await this.triggerNewSong();
        } else {
            this.stopDoomLoop();
            this._events.emit(EVENTS.EVENT_PLAYLIST_END);
        }
    }

    stopDoomLoop () {
        if (this._doomLoopTimerId > 0) {
            clearInterval(this._doomLoopTimerId);
            this._doomLoopTimerId = 0;
        }
    }

    startDoomLoop () {
        this.stopDoomLoop();
        this._doomLoopTimerId = setInterval(() => this.doomLoop(), 1000);
    }

    playFolder (sPath) {
        return new Promise(resolve => {
            this._events.once(EVENTS.EVENT_PLAYLIST_END, () => resolve());
            return this
                .vlc
                .doPlayFolder(sPath)
                .then(() => this.triggerNewSong())
                .then(() => this.startDoomLoop());
        });
    }
}

module.exports = PlaylistControl;
