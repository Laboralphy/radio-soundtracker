import type { Argv, ArgumentsCamelCase } from 'yargs';
import { VLCControl } from '../libs/vlc-control/VLCControl.js';
import { ProgramPlayer } from '../libs/vlc-control/ProgramPlayer.js';
import { ProgramScheduler } from '../libs/vlc-control/ProgramScheduler.js';
import { EVENTS } from '../libs/vlc-control/consts.js';
import { logger } from '../libs/logger/index.js';
import { t } from '../libs/i18n/index.js';
import { withVLCOptions, type VLCOptions } from './vlc-options.js';
import { loadSchedule } from './schedule-file.js';

interface ScheduleOptions extends VLCOptions {
    config: string;
}

async function handler(argv: ArgumentsCamelCase<ScheduleOptions>): Promise<void> {
    const library = await loadSchedule(argv.config);

    const vlc = new VLCControl({ host: argv.host, port: argv.port, timeout: argv.timeout });
    const player = new ProgramPlayer({ vlc });

    player.events.on(EVENTS.EVENT_NEW_SONG, ({ title, remainingTime }: { title: string; remainingTime: number; file: string }) => {
        logger.info(t('play.newSong', { title, duration: remainingTime }));
    });
    player.events.on(EVENTS.EVENT_ERROR, (err: unknown) => {
        logger.error(`Playback error: ${err}`);
    });

    const scheduler = new ProgramScheduler(library, player);
    scheduler.start();

    const shutdown = async () => {
        logger.info(t('schedule.stopping'));
        try {
            await scheduler.stop();
        } catch (err) {
            logger.error(t('schedule.stopError', { err }));
        }
        process.exit(0);
    };
    process.once('SIGINT', () => void shutdown());
    process.once('SIGTERM', () => void shutdown());
}

export function createCommand() {
    return {
        command: 'schedule',
        describe: t('schedule.describe'),
        builder(yargs: Argv): Argv<ScheduleOptions> {
            return withVLCOptions(yargs)
                .option('config', {
                    alias: 'c',
                    type: 'string',
                    demandOption: true,
                    describe: t('schedule.options.config'),
                });
        },
        handler
    };
}
