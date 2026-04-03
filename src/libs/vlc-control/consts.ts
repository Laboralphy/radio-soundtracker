export const EVENTS = {
    EVENT_PLAYLIST_END: 'EVENT_PLAYLIST_END',
    EVENT_NEW_SONG: 'EVENT_NEW_SONG',
    EVENT_PLAYLIST_DURATION_EXPIRED: 'EVENT_PLAYLIST_DURATION_EXPIRED',
    EVENT_PLAYLIST_DURATION_EXPIRED_SONG: 'EVENT_PLAYLIST_DURATION_EXPIRED_SONG',
    EVENT_ERROR: 'EVENT_ERROR',
} as const;

export type EventName = typeof EVENTS[keyof typeof EVENTS];

export const SONG_FILE_EXTENSIONS: string[] = [
    'mid',
    'mp3',
    'mod',
    's3m',
    'stm',
    'xm',
    'it'
];

export const PROGRAM_ENTRY_TYPES = {
    NONE: 0,
    SONG: 1,
    FOLDER: 2,
    PROGRAM: 3
} as const;

export type ProgramEntryType = typeof PROGRAM_ENTRY_TYPES[keyof typeof PROGRAM_ENTRY_TYPES];
