import { describe, it, expect } from 'vitest';
import { parseTime } from '../src/libs/time-parser/index.js';

describe('parseTime', () => {
    describe('plain numbers', () => {
        it('parses integer input as seconds', () => expect(parseTime(15)).toBe(15));
        it('parses string integer as seconds', () => expect(parseTime('15')).toBe(15));
    });

    describe('unit-based', () => {
        it('parses minutes',              () => expect(parseTime('5min')).toBe(300));
        it('parses hours',                () => expect(parseTime('1h')).toBe(3600));
        it('parses seconds',              () => expect(parseTime('30s')).toBe(30));
        it('parses combined h and min',   () => expect(parseTime('1h 2min')).toBe(3720));
        it('parses combined h, min, s',   () => expect(parseTime('1h 2min 30s')).toBe(3750));
        it('accepts long unit names',     () => expect(parseTime('2 hours 30 minutes')).toBe(9000));
    });

    describe('colon-separated', () => {
        it('parses mm:ss',   () => expect(parseTime('05:30')).toBe(330));
        it('parses hh:mm:ss', () => expect(parseTime('01:02:00')).toBe(3720));
        it('parses hh:mm:ss with seconds', () => expect(parseTime('01:02:30')).toBe(3750));
    });

    describe('large values', () => {
        it('parses 999h',               () => expect(parseTime('999h')).toBe(3596400));
        it('parses 999h as number',     () => expect(parseTime(999 * 3600)).toBe(3596400));
        it('parses 9999min',            () => expect(parseTime('9999min')).toBe(599940));
        it('parses 999:59:59',          () => expect(parseTime('999:59:59')).toBe(3599999));
        it('parses 999h 59min 59s',     () => expect(parseTime('999h 59min 59s')).toBe(3599999));
    });

    describe('bad input', () => {
        it('throws on letters only',            () => expect(() => parseTime('abc')).toThrow());
        it('throws on mixed junk like xfgh54es',() => expect(() => parseTime('xfgh54es')).toThrow());
        it('throws on empty string',            () => expect(() => parseTime('')).toThrow());
        it('throws on symbols only',            () => expect(() => parseTime('!@#$')).toThrow());
        it('throws on partial colon',           () => expect(() => parseTime('5:')).toThrow());
        it('throws on letters around number',   () => expect(() => parseTime('x15x')).toThrow());
    });

    describe('edge cases', () => {
        it('floors decimal seconds',      () => expect(parseTime('1.5min')).toBe(90));
        it('parses 0',                    () => expect(parseTime(0)).toBe(0));
        it('parses 0s',                   () => expect(parseTime('0s')).toBe(0));
        it('parses 00:00',                () => expect(parseTime('00:00')).toBe(0));
        it('trims surrounding whitespace',() => expect(parseTime('  5min  ')).toBe(300));
    });
});
