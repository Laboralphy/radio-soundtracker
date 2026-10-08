import type { Argv, ArgumentsCamelCase } from 'yargs';
import { VLCControl } from '../libs/vlc-control/VLCControl.js';
import { logger } from '../libs/logger/index.js';
import { t } from '../libs/i18n/index.js';
import { withVLCOptions, type VLCOptions } from './vlc-options.js';

type CheckOptions = VLCOptions;

async function handler(argv: ArgumentsCamelCase<CheckOptions>): Promise<void> {
    const vlc = new VLCControl({ host: argv.host, port: argv.port, timeout: argv.timeout });
    try {
        const status = await vlc.getStatus();
        logger.info(t('check.reachable', { status: status.split('\n')[0] }));
    } catch (err) {
        logger.error(t('check.unreachable', { err }));
        process.exit(1);
    }
}

export function createCommand() {
    return {
        command: 'check',
        describe: t('check.describe'),
        builder(yargs: Argv): Argv<CheckOptions> {
            return withVLCOptions(yargs);
        },
        handler
    };
}
