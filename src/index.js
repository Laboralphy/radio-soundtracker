const { Program, ProgramPlayer, VLCControl } = require('./libs/vlc-control');
const { EVENTS } = require('./libs/vlc-control/consts');



async function main () {
    const plc = new ProgramPlayer({
        vlc: new VLCControl({ timeout: 150 })
    });
    plc.events.on(EVENTS.EVENT_NEW_SONG, ({ title, remainingTime, file }) => {
        console.log(`Now playing "${title}" (${remainingTime} s) - file: ${file}`);
    });
    plc.events.on(EVENTS.EVENT_PLAYLIST_END, () => {
        console.log('End of playlist');
    });
    const oProgram = new Program();
    oProgram.addFolder('../../Musique/mods/FX');
    oProgram.addFolder('../../Musique/mods/CLASS');
    return plc.playProgram(oProgram);
}

main().then(() => {
    console.log('done.');
});
