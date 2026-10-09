export interface EncoderSettings {
    /**
     * PulseAudio source to record, e.g. "radio.monitor".
     */
    audioSource: string;
    width: number;
    height: number;
    fps: number;
    videoBitrate: string;
    audioBitrate: string;
    /**
     * A file path or an rtmp(s):// URL.
     */
    output: string;
}

/**
 * Parses "854x480" into { width, height }.
 */
export function parseSize(size: string): { width: number; height: number } {
    const match = /^(\d+)x(\d+)$/.exec(size);
    if (!match) {
        throw new Error(`Invalid video size "${size}", expected WIDTHxHEIGHT`);
    }
    return { width: Number(match[1]), height: Number(match[2]) };
}

/**
 * ffmpeg arguments for the single, long-running encoder.
 *
 * Input 0 is the sound card monitor, input 1 the raw RGBA frames of the image program on stdin.
 * Both are stamped with the real clock, then ffmpeg repeats or drops frames to keep a constant
 * frame rate and resamples the audio to absorb slow drift (see doc/ROADMAP.md §2.1).
 */
export function buildEncoderArgs(s: EncoderSettings): string[] {
    return [
        '-hide_banner', '-nostats', '-loglevel', 'warning', '-y',
        '-thread_queue_size', '1024', '-f', 'pulse', '-i', s.audioSource,
        '-thread_queue_size', '64', '-use_wallclock_as_timestamps', '1',
        '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${s.width}x${s.height}`, '-r', `${s.fps}`, '-i', 'pipe:0',
        '-map', '1:v', '-map', '0:a',
        '-fps_mode', 'cfr', '-r', `${s.fps}`,
        '-af', 'aresample=async=1',
        // keyframe every 2 s, as YouTube requires
        '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-g', `${s.fps * 2}`, '-b:v', s.videoBitrate,
        '-c:a', 'aac', '-b:a', s.audioBitrate, '-ar', '44100',
        '-f', 'flv', s.output,
    ];
}

/**
 * Hides the stream key in an output URL, so it can be logged.
 * "rtmps://a.rtmp.youtube.com/live2/abcd-1234" → "rtmps://a.rtmp.youtube.com/live2/***"
 * File paths are returned unchanged.
 */
export function redactOutput(output: string): string {
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(output)) {
        return output;
    }
    try {
        const url = new URL(output);
        const segments = url.pathname.split('/');
        if (segments.length > 1 && segments[segments.length - 1] !== '') {
            segments[segments.length - 1] = '***';
        }
        return `${url.protocol}//${url.host}${segments.join('/')}`;
    } catch {
        return '***';
    }
}
