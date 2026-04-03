const UNIT_PATTERN = /(\d+(?:\.\d+)?)\s*(h(?:ours?|r)?|min(?:utes?)?|m(?!s)|s(?:ec(?:onds?)?)?)/gi;
const COLON_PATTERN = /^(\d+):(\d{2})(?::(\d{2}))?$/;

/**
 * Parses a human-readable time string into a number of seconds.
 *
 * Supported formats:
 *   15          → 15s
 *   5min        → 300s
 *   1h 2min     → 3720s
 *   05:30       → 330s  (mm:ss)
 *   01:02:00    → 3720s (hh:mm:ss)
 */
export function parseTime(input: string | number): number {
    if (typeof input === 'number') {
        return Math.floor(input);
    }

    const s = input.trim();

    if (/^\d+$/.test(s)) {
        return parseInt(s, 10);
    }

    const colonMatch = COLON_PATTERN.exec(s);
    if (colonMatch) {
        const a = parseInt(colonMatch[1], 10);
        const b = parseInt(colonMatch[2], 10);
        const c = colonMatch[3] !== undefined ? parseInt(colonMatch[3], 10) : null;
        return c !== null
            ? a * 3600 + b * 60 + c   // hh:mm:ss
            : a * 60 + b;              // mm:ss
    }

    let total = 0;
    let matched = false;
    let match: RegExpExecArray | null;
    UNIT_PATTERN.lastIndex = 0;
    while ((match = UNIT_PATTERN.exec(s)) !== null) {
        matched = true;
        const value = parseFloat(match[1]);
        const unit = match[2].toLowerCase();
        if (unit.startsWith('h')) {
            total += value * 3600;
        } else if (unit.startsWith('m')) {
            total += value * 60;
        } else if (unit.startsWith('s')) {
            total += value;
        }
    }
    if (matched) {
        return Math.floor(total);
    }

    throw new Error(`Cannot parse time: "${input}"`);
}
