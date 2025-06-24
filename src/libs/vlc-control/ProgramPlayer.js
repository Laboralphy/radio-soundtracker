const VLCControl = require('./VLCControl');
const { EVENTS } = require('./consts');
const Events = require('node:events');

class ProgramPlayer {
    constructor ({ vlc = undefined } = {}) {
        this._vlcctl = null;
        if (vlc) {
            this.vlc = vlc;
        }
        this._remainingTime = 0;
        this._doomLoopTimerId = 0;
        this._events = new Events();
        this._lastPlayedFile  = '';
    }

    get vlc () {
        return this._vlcctl;
    }

    set vlc (value) {
        if (value instanceof VLCControl) {
            this._vlcctl = value;
        }
    }

    /**
     * @returns {EventEmitter}
     */
    get events () {
        return this._events;
    }

    async getSongFile () {
        const status = await this.vlc.getStatus();
        const sFirstLine = status.split('\n').shift();
        const r = sFirstLine.match(/\(\s+new input:\s+(.*)\s*\)$/);
        if (r) {
            const sSongFileFullName = r[1];
            const oParsedFileName = URL.parse(sSongFileFullName);
            return oParsedFileName ? oParsedFileName.pathname : sSongFileFullName;
        } else {
            console.log(status);
            return '';
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
        if (this._lastPlayedFile !== sFileName) {
            this._lastPlayedFile = sFileName;
            this._events.emit(EVENTS.EVENT_NEW_SONG, {
                title: sTitle,
                remainingTime: remaining,
                file: sFileName
            });
        }
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
        }
    }

    stopDoomLoop () {
        if (this._doomLoopTimerId > 0) {
            this._remainingTime = 0;
            clearInterval(this._doomLoopTimerId);
            this._doomLoopTimerId = 0;
            this._events.emit(EVENTS.EVENT_PLAYLIST_END);
        }
    }

    startDoomLoop () {
        this.stopDoomLoop();
        this._doomLoopTimerId = setInterval(() => this.doomLoop(), 1000);
    }

    /**
     *
     * @param oProgram {Program}
     * @returns {Promise<unknown>}
     */
    playProgram (oProgram) {
        return new Promise(resolve => {
            this._events.once(EVENTS.EVENT_PLAYLIST_END, () => resolve());
            return this
                .vlc
                .doPlayProgram(oProgram)
                .then(() => this.triggerNewSong())
                .then(() => this.startDoomLoop());
        });
    }
}

module.exports = ProgramPlayer;
