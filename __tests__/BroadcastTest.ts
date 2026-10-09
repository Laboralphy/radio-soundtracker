import { describe, it, expect } from 'vitest';
import { buildEncoderArgs, parseSize, redactOutput, scaleBitrate } from '../src/libs/broadcast/encoder.js';
import { NullSink } from '../src/libs/broadcast/NullSink.js';
import { parseConfig } from '../src/libs/config/index.js';

const SETTINGS = {
    audioSource: 'radio.monitor',
    width: 854,
    height: 480,
    fps: 30,
    videoBitrate: '1500k',
    audioBitrate: '160k',
    output: 'out.flv',
};

/**
 * The value that follows a flag; for a flag given more than once, its nth occurrence.
 */
function valueOf(args: string[], flag: string, nth = 0): string | undefined {
    const indexes = args.flatMap((arg, i) => (arg === flag ? [i] : []));
    return args[indexes[nth] + 1];
}

describe('parseSize', () => {
    it('reads WIDTHxHEIGHT', () => {
        expect(parseSize('1280x720')).toEqual({ width: 1280, height: 720 });
    });

    it('rejects anything else', () => {
        expect(() => parseSize('1280*720')).toThrow();
        expect(() => parseSize('720p')).toThrow();
    });
});

describe('buildEncoderArgs', () => {
    const args = buildEncoderArgs(SETTINGS);

    it('records the sink monitor and the raw frames on stdin', () => {
        expect(valueOf(args, '-i', 0)).toBe('radio.monitor');
        expect(valueOf(args, '-i', 1)).toBe('pipe:0');
        expect(valueOf(args, '-s')).toBe('854x480');
        expect(valueOf(args, '-pix_fmt', 0)).toBe('rgba');
    });

    it('puts a keyframe every 2 seconds, and only then', () => {
        expect(valueOf(args, '-g')).toBe('60');
        expect(valueOf(args, '-keyint_min')).toBe('60');
        expect(valueOf(args, '-sc_threshold')).toBe('0');
    });

    it('caps the video bitrate', () => {
        expect(valueOf(args, '-maxrate')).toBe('1500k');
        expect(valueOf(args, '-bufsize')).toBe('3000k');
    });

    it('uses the bitrates and ends with the FLV output', () => {
        expect(valueOf(args, '-b:v')).toBe('1500k');
        expect(valueOf(args, '-b:a')).toBe('160k');
        expect(args.slice(-3)).toEqual(['-f', 'flv', 'out.flv']);
    });

    it('does not try to rewrite the header of a live stream', () => {
        expect(args).not.toContain('-flvflags');
        const live = buildEncoderArgs({ ...SETTINGS, output: 'rtmps://a.rtmp.youtube.com/live2/key' });
        expect(valueOf(live, '-flvflags')).toBe('no_duration_filesize');
    });
});

describe('scaleBitrate', () => {
    it('keeps the unit', () => {
        expect(scaleBitrate('1500k', 2)).toBe('3000k');
        expect(scaleBitrate('2M', 2)).toBe('4M');
        expect(scaleBitrate('800000', 2)).toBe('1600000');
    });

    it('rejects anything else', () => {
        expect(() => scaleBitrate('1.5M', 2)).toThrow();
    });
});

describe('redactOutput', () => {
    it('hides the stream key of an RTMP URL', () => {
        expect(redactOutput('rtmps://a.rtmp.youtube.com/live2/abcd-efgh-1234')).toBe('rtmps://a.rtmp.youtube.com/live2/***');
    });

    it('drops credentials and query strings', () => {
        expect(redactOutput('rtmp://user:secret@host:1935/app/key?token=x')).toBe('rtmp://host:1935/app/***');
    });

    it('leaves file paths alone', () => {
        expect(redactOutput('/tmp/out/test.flv')).toBe('/tmp/out/test.flv');
        expect(redactOutput('broadcast.flv')).toBe('broadcast.flv');
    });
});

describe('NullSink', () => {
    const SINKS = '54\talsa_output.pci-0000_00_1f.3.analog-stereo\tPipeWire\ts32le 2ch 48000Hz\tSUSPENDED\n';

    function fakePactl(sinks: string) {
        const calls: string[][] = [];
        const run = async (args: string[]) => {
            calls.push(args);
            if (args[0] === 'list') return sinks;
            if (args[0] === 'load-module') return '536870913\n';
            return '';
        };
        return { calls, run };
    }

    it('creates a missing sink, then removes it', async () => {
        const pactl = fakePactl(SINKS);
        const sink = new NullSink('radio', pactl.run);
        expect(await sink.acquire()).toBe(true);
        expect(pactl.calls[1]).toContain('sink_name=radio');
        await sink.release();
        expect(pactl.calls[2]).toEqual(['unload-module', '536870913']);
        // a second release does nothing
        await sink.release();
        expect(pactl.calls).toHaveLength(3);
    });

    it('reuses an existing sink and leaves it in place', async () => {
        const pactl = fakePactl(SINKS + '60\tradio\tPipeWire\tfloat32le 2ch 48000Hz\tRUNNING\n');
        const sink = new NullSink('radio', pactl.run);
        expect(await sink.acquire()).toBe(false);
        await sink.release();
        expect(pactl.calls.map(args => args[0])).toEqual(['list']);
    });

    it('does not match a sink whose name only starts the same', async () => {
        const pactl = fakePactl('60\tradio_poc\tPipeWire\tfloat32le 2ch 48000Hz\tRUNNING\n');
        expect(await new NullSink('radio', pactl.run).exists()).toBe(false);
    });

    it('names the monitor source', () => {
        expect(new NullSink('radio').monitor).toBe('radio.monitor');
    });
});

describe('parseConfig', () => {
    it('has broadcast defaults', () => {
        const { broadcast } = parseConfig({});
        expect(broadcast).toEqual({
            sink: 'radio',
            size: '854x480',
            fps: 30,
            videoBitrate: '1500k',
            audioBitrate: '160k',
            output: undefined,
        });
    });

    it('reads and checks the broadcast variables', () => {
        expect(parseConfig({ RADIO_FPS: '25', RADIO_OUTPUT: 'rtmps://x/live2/k' }).broadcast).toMatchObject({ fps: 25, output: 'rtmps://x/live2/k' });
        expect(() => parseConfig({ RADIO_VIDEO_SIZE: '720p' })).toThrow();
        expect(() => parseConfig({ RADIO_SINK: 'bad name' })).toThrow();
    });
});
