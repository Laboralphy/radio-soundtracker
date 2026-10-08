import type { Argv } from 'yargs';
import { config } from '../libs/config/index.js';
import { t } from '../libs/i18n/index.js';

export interface VLCOptions {
    host: string;
    port: number;
    timeout: number;
}

/**
 * Adds the VLC connection options shared by every command.
 */
export function withVLCOptions<T>(yargs: Argv<T>): Argv<T & VLCOptions> {
    return yargs
        .option('host', { alias: 'H', type: 'string', default: config.vlc.host, describe: t('vlc.options.host') })
        .option('port', { alias: 'p', type: 'number', default: config.vlc.port, describe: t('vlc.options.port') })
        .option('timeout', { type: 'number', default: config.vlc.timeout, describe: t('vlc.options.timeout') });
}
