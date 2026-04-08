import { readFile } from 'node:fs/promises';
import type { Argv, ArgumentsCamelCase } from 'yargs';
import { VLCControl } from '../libs/vlc-control/VLCControl.js';
import { ProgramPlayer } from '../libs/vlc-control/ProgramPlayer.js';
import { ProgramLibrary } from '../libs/vlc-control/ProgramLibrary.js';
import { ProgramScheduler } from '../libs/vlc-control/ProgramScheduler.js';
import { ScheduleConfigSchema } from '../libs/vlc-control/program-definition.js';
import { EVENTS } from '../libs/vlc-control/consts.js';
import { logger } from '../libs/logger/index.js';
import { t } from '../libs/i18n/index.js';

interface ScheduleOptions {
    config: string;
}

async function handler(argv: ArgumentsCamelCase<ScheduleOptions>): Promise<void> {
    const raw: unknown = JSON.parse(await readFile(argv.config, 'utf-8'));
    const config = ScheduleConfigSchema.parse(raw);

    const library = new ProgramLibrary();
    for (const [name, definition] of Object.entries(config.programs)) {
        library.define(name, definition);
    }

    const vlc = new VLCControl();
    const player = new ProgramPlayer({ vlc });

    player.events.on(EVENTS.EVENT_NEW_SONG, ({ title, remainingTime }: { title: string; remainingTime: number; file: string }) => {
        logger.info(t('play.newSong', { title, duration: remainingTime }));
    });
    player.events.on(EVENTS.EVENT_ERROR, (err: unknown) => {
        logger.error(`Playback error: ${err}`);
    });

    const scheduler = new ProgramScheduler(library, player);
    scheduler.start();

    const shutdown = () => {
        logger.info(t('schedule.stopping'));
        scheduler.stop();
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

export function createCommand() {
    return {
        command: 'schedule',
        describe: t('schedule.describe'),
        builder(yargs: Argv): Argv<ScheduleOptions> {
            return yargs
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
