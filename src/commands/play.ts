import type { Argv, ArgumentsCamelCase } from 'yargs';
import { VLCControl } from '../libs/vlc-control/VLCControl.js';
import { ProgramPlayer } from '../libs/vlc-control/ProgramPlayer.js';
import { Program } from '../libs/vlc-control/Program.js';
import { EVENTS } from '../libs/vlc-control/consts.js';
import { logger } from '../libs/logger/index.js';
import { t } from '../libs/i18n/index.js';
import { parseTime } from '../libs/time-parser/index.js';

interface PlayOptions {
    location: string;
    recursive: boolean;
    shuffle: boolean;
    count?: number;
    time?: string;
}

async function handler(argv: ArgumentsCamelCase<PlayOptions>): Promise<void> {
    const vlc = new VLCControl();
    const plc = new ProgramPlayer({ vlc });

    plc.events.on(EVENTS.EVENT_NEW_SONG, ({ title, remainingTime }: { title: string; remainingTime: number; file: string }) => {
        logger.info(t('play.nowPlaying', { title, remaining: remainingTime }));
    });
    plc.events.on(EVENTS.EVENT_ERROR, (err: unknown) => {
        logger.error(`Playback error: ${err}`);
    });

    const oProgram = new Program();
    oProgram.addFolder(argv.location, {
        shuffle: argv.shuffle,
        limit: argv.count ?? Infinity,
        recursive: argv.recursive,
    });

    let timeLimitId: ReturnType<typeof setTimeout> | null = null;
    if (argv.time) {
        const seconds = parseTime(argv.time);
        timeLimitId = setTimeout(() => {
            logger.info(t('play.timeLimitReached', { time: argv.time }));
            plc.stopDoomLoop();
        }, seconds * 1000);
    }

    try {
        await plc.playProgram(oProgram);
        logger.info(t('play.done'));
    } finally {
        if (timeLimitId !== null) {
            clearTimeout(timeLimitId);
        }
    }
}

export function createCommand() {
    return {
        command: 'play',
        describe: t('play.describe'),
        builder(yargs: Argv): Argv<PlayOptions> {
            return yargs
                .option('location', { alias: 'l', type: 'string', demandOption: true, describe: t('play.options.location') })
                .option('recursive', { alias: 'r', type: 'boolean', default: false, describe: t('play.options.recursive') })
                .option('shuffle',   { alias: 's', type: 'boolean', default: false, describe: t('play.options.shuffle') })
                .option('count',     { alias: 'n', type: 'number',  describe: t('play.options.count') })
                .option('time',      { alias: 't', type: 'string',  describe: t('play.options.time') });
        },
        handler
    };
}
