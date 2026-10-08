import { existsSync } from 'node:fs';
import { z } from 'zod';

/**
 * Settings read from environment variables, or from a .env file in the working directory.
 * Command line options override them.
 */
const ConfigSchema = z.object({
    RADIO_VLC_HOST: z.string().default('localhost'),
    RADIO_VLC_PORT: z.coerce.number().int().positive().default(1234),
    RADIO_VLC_TIMEOUT: z.coerce.number().int().positive().default(1000),
    RADIO_LOG_DIR: z.string().default('logs'),
});

if (existsSync('.env')) {
    process.loadEnvFile('.env');
}

const env = ConfigSchema.parse(process.env);

export const config = {
    vlc: {
        host: env.RADIO_VLC_HOST,
        port: env.RADIO_VLC_PORT,
        timeout: env.RADIO_VLC_TIMEOUT,
    },
    logDir: env.RADIO_LOG_DIR,
};
