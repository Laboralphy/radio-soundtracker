const VLCControl = require('./libs/vlc-control/VLCControl');


async function main () {
    const vlcctl = new VLCControl({
        timeout: 250
    });
    const aMessages = await vlcctl.getTime();
    console.log(aMessages);
}

main();

