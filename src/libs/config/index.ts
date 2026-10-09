import { existsSync } from 'node:fs';
import { z } from 'zod';

const VideoSizeSchema = z.string().regex(/^\d+x\d+$/, 'expected WIDTHxHEIGHT, e.g. 854x480');
const BitrateSchema = z.string().regex(/^\d+[kM]?$/, 'expected a bitrate, e.g. 1500k');

/**
 * Settings read from environment variables, or from a .env file in the working directory.
 * Command line options override them.
 */
const ConfigSchema = z.object({
    RADIO_VLC_HOST: z.string().default('localhost'),
    RADIO_VLC_PORT: z.coerce.number().int().positive().default(1234),
    RADIO_VLC_TIMEOUT: z.coerce.number().int().positive().default(1000),
    RADIO_LOG_DIR: z.string().default('logs'),
    RADIO_SINK: z.string().regex(/^[\w.-]+$/).default('radio'),
    RADIO_VIDEO_SIZE: VideoSizeSchema.default('854x480'),
    RADIO_FPS: z.coerce.number().int().positive().default(30),
    RADIO_VIDEO_BITRATE: BitrateSchema.default('1500k'),
    RADIO_AUDIO_BITRATE: BitrateSchema.default('160k'),
    RADIO_OUTPUT: z.string().optional(),
});

export type Config = ReturnType<typeof parseConfig>;

export function parseConfig(source: Record<string, string | undefined>) {
    const env = ConfigSchema.parse(source);
    return {
        vlc: {
            host: env.RADIO_VLC_HOST,
            port: env.RADIO_VLC_PORT,
            timeout: env.RADIO_VLC_TIMEOUT,
        },
        logDir: env.RADIO_LOG_DIR,
        broadcast: {
            sink: env.RADIO_SINK,
            size: env.RADIO_VIDEO_SIZE,
            fps: env.RADIO_FPS,
            videoBitrate: env.RADIO_VIDEO_BITRATE,
            audioBitrate: env.RADIO_AUDIO_BITRATE,
            /**
             * A file path or an rtmp(s):// URL. May contain the stream key: never log it as is.
             */
            output: env.RADIO_OUTPUT,
        },
    };
}

if (existsSync('.env')) {
    process.loadEnvFile('.env');
}

export const config = parseConfig(process.env);
