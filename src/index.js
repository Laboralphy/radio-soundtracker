const { PlaylistControl, VLCControl } = require('./libs/vlc-control');
const EVENTS = require('./libs/vlc-control/Events');



async function main () {
    const plc = new PlaylistControl({
        vlc: new VLCControl({ timeout: 150 })
    });
    plc.events.on(EVENTS.EVENT_NEW_SONG, ({ title, remainingTime, file }) => {
        console.log(`Now playing "${title}" (${remainingTime} s) - file: ${file}`);
    });
    plc.events.on(EVENTS.EVENT_PLAYLIST_END, () => {
        console.log('End of playlist');
    });
    return plc.playFolder('../../Musique/mods/FX');
}

main().then(() => {
    console.log('done.');
});
