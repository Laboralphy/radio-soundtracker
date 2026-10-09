import path from 'node:path';
import type { Argv, ArgumentsCamelCase } from 'yargs';
import { VLCControl } from '../libs/vlc-control/VLCControl.js';
import { ProgramPlayer, type NewSongEvent } from '../libs/vlc-control/ProgramPlayer.js';
import { ProgramScheduler } from '../libs/vlc-control/ProgramScheduler.js';
import { EVENTS } from '../libs/vlc-control/consts.js';
import { Broadcast, BROADCAST_EVENTS } from '../libs/broadcast/Broadcast.js';
import { parseSize } from '../libs/broadcast/encoder.js';
import { StandbyMonitor } from '../libs/broadcast/StandbyMonitor.js';
import { config } from '../libs/config/index.js';
import { logger } from '../libs/logger/index.js';
import { t } from '../libs/i18n/index.js';
import { withVLCOptions, type VLCOptions } from './vlc-options.js';
import { loadSchedule } from './schedule-file.js';

interface BroadcastCommandOptions extends VLCOptions {
    config: string;
    output: string | undefined;
    sink: string;
    size: string;
    fps: number;
    'video-bitrate': string;
    'audio-bitrate': string;
    'external-vlc': boolean;
}

async function handler(argv: ArgumentsCamelCase<BroadcastCommandOptions>): Promise<void> {
    const library = await loadSchedule(argv.config);
    const { width, height } = parseSize(argv.size);

    const vlc = new VLCControl({ host: argv.host, port: argv.port, timeout: argv.timeout });
    const broadcast = new Broadcast({
        sink: argv.sink,
        width,
        height,
        fps: argv.fps,
        videoBitrate: argv.videoBitrate,
        audioBitrate: argv.audioBitrate,
        // demandOption makes yargs reject a missing output
        output: argv.output!,
        vlc,
        vlcHost: argv.host,
        vlcPort: argv.port,
        startVlc: !argv.externalVlc,
        ffmpegLog: path.join(config.logDir, 'ffmpeg.log'),
    });
    const player = new ProgramPlayer({ vlc });
    const scheduler = new ProgramScheduler(library, player);
    const standby = new StandbyMonitor({
        events: player.events,
        nextScheduled: () => scheduler.nextScheduled(),
        onSong: ({ title, file, elapsed, duration, next, program }) => {
            broadcast.setSong({ title, file, elapsed, duration, next, program });
        },
        onStandby: info => {
            logger.info(t('broadcast.standby', { reason: info.reason }));
            broadcast.setStandby(info);
        },
    });
    let started = false;

    let stopping = false;
    const shutdown = async (exitCode: number) => {
        if (stopping) {
            return;
        }
        stopping = true;
        logger.info(t('broadcast.stopping'));
        standby.stop();
        if (started) {
            try {
                await scheduler.stop();
            } catch (err) {
                logger.error(t('schedule.stopError', { err }));
            }
        }
        await broadcast.stop().catch(err => logger.error(t('broadcast.stopError', { err })));
        process.exit(exitCode);
    };

    broadcast.events.on(BROADCAST_EVENTS.EVENT_FATAL, (reason: string) => {
        logger.error(t('broadcast.fatal', { reason }));
        void shutdown(1);
    });
    player.events.on(EVENTS.EVENT_NEW_SONG, ({ title, remainingTime }: NewSongEvent) => {
        logger.info(t('play.newSong', { title, duration: remainingTime }));
    });
    player.events.on(EVENTS.EVENT_ERROR, (err: unknown) => {
        logger.error(`Playback error: ${err}`);
    });
    process.once('SIGINT', () => void shutdown(0));
    process.once('SIGTERM', () => void shutdown(0));

    try {
        await broadcast.start();
    } catch (err) {
        logger.error(t('broadcast.startError', { err }));
        await shutdown(1);
        return;
    }
    if (!stopping) {
        started = true;
        standby.start();
        scheduler.start();
    }
}

export function createCommand() {
    const b = config.broadcast;
    return {
        command: 'broadcast',
        describe: t('broadcast.describe'),
        builder(yargs: Argv): Argv<BroadcastCommandOptions> {
            return withVLCOptions(yargs)
                .option('config', { alias: 'c', type: 'string', demandOption: true, describe: t('schedule.options.config') })
                .option('output', {
                    alias: 'o',
                    type: 'string',
                    demandOption: b.output === undefined,
                    default: b.output,
                    // the default may hold the stream key: do not print it in --help
                    defaultDescription: b.output === undefined ? undefined : 'RADIO_OUTPUT',
                    describe: t('broadcast.options.output'),
                })
                .option('sink', { type: 'string', default: b.sink, describe: t('broadcast.options.sink') })
                .option('size', { type: 'string', default: b.size, describe: t('broadcast.options.size') })
                .option('fps', { type: 'number', default: b.fps, describe: t('broadcast.options.fps') })
                .option('video-bitrate', { type: 'string', default: b.videoBitrate, describe: t('broadcast.options.videoBitrate') })
                .option('audio-bitrate', { type: 'string', default: b.audioBitrate, describe: t('broadcast.options.audioBitrate') })
                .option('external-vlc', { type: 'boolean', default: false, describe: t('broadcast.options.externalVlc') });
        },
        handler
    };
}
