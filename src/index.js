const VLCControl = require('./VLCControl');


async function main () {
    const vlcctl = new VLCControl();
    const aMessages = await vlcctl.sendTransaction('status');
    console.log(aMessages);
}

main();

