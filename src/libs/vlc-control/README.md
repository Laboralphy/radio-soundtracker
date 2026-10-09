# vlc-control

This library controls a running VLC instance via its RC (remote control) telnet interface and provides a higher-level playlist/program abstraction on top.

## Class overview

```
VLCConnection          low-level TCP socket to VLC RC interface
    └── VLCControl     typed command methods (play, stop, enqueue, getTime…)
            └── ProgramPlayer   program lifecycle + doom loop (implements Player)

Program                playlist descriptor (ordered list of entries)
    └── ProgramEntry   a single entry: song file, folder, or nested program

ProgramLibrary         named programs, built from the JSON schedule file
ProgramScheduler       default program loop + cron programs, on top of any Player
```

---

### VLCConnection

Handles raw TCP communication with VLC's RC interface (`--intf rc` / `--rc-host`).

`sendBatch(commands: string[])` opens a TCP socket, skips the welcome banner, then sends the commands **one at a time**: each command is written only after VLC has answered the previous one with its `> ` prompt. It resolves with one response per command. `sendTransaction(command)` is the single-command variant.

Commands must not be sent all at once: VLC prints a prompt each time it waits for input, not after each command, so the responses to commands received in the same read come back without prompts between them and cannot be told apart.

Batches are queued, so two callers never use the RC interface at the same time.

Errors reject the promise: VLC not reachable, connection closed early, or no answer within `timeout` ms (idle time between two pieces of data).

Default connection parameters: `host=localhost`, `port=1234`, `timeout=1000ms`.

---

### VLCControl

Wraps `VLCConnection` and exposes typed methods for every supported VLC RC command.

| Method | VLC command |
|---|---|
| `doPlay()` | `play` |
| `doStop()` | `stop` |
| `doPause()` | `pause` |
| `doNext()` | `next` |
| `doPrev()` | `prev` |
| `doEnqueue(file \| file[])` | `enqueue <path>` |
| `doClearPlaylist()` | `clear` |
| `doQuit()` | `quit` |
| `doVolume(n)` | `volume <n>` |
| `doRandom(bool)` | `random on/off` |
| `doLoop(bool)` | `loop on/off` |
| `doRepeat(bool)` | `repeat on/off` |
| `isPlaying()` | `is_playing` → `boolean` |
| `getTime()` | `get_time` + `get_length` → `TimeInfo` |
| `getTitle()` | `get_title` |
| `getStatus()` | `status` |
| `getPlaylist()` | `playlist` |
| `getVolume()` | `volume` |

`getTime()` sends `get_time` and `get_length` in a single batch because VLC's RC interface only returns one value per command. It returns:
```ts
interface TimeInfo {
    time: number;       // elapsed seconds
    total: number;      // total duration in seconds
    remaining: number;  // total - time
}
```

---

### ProgramEntry

A single item inside a `Program`. Has a `type` (from `PROGRAM_ENTRY_TYPES`) and a set of options:

| Type | Constant | What it resolves to |
|---|---|---|
| `SONG` | `1` | A single audio file path |
| `FOLDER` | `2` | All audio files in a directory |
| `PROGRAM` | `3` | Another `Program` instance (nested) |

**FOLDER options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `shuffle` | `boolean` | `false` | Randomise the file order |
| `limit` | `number` | `Infinity` | Maximum number of files to include (file count, not duration) |
| `recursive` | `boolean` | `false` | Recurse into sub-directories |

Recognised audio file extensions (applied as filter when scanning a folder):
`mid`, `mp3`, `mod`, `s3m`, `stm`, `xm`, `it`

---

### Program

A container for an ordered list of `ProgramEntry` objects.

`renderList()` resolves all entries in order and returns a flat `string[]` of absolute file paths, ready to pass to `doEnqueue()`. Nested programs are resolved recursively.

**Helper methods:**

```ts
program.addSong('/path/to/song.mod')

program.addFolder('/path/to/folder', {
    shuffle: true,
    limit: 10,
    recursive: true
})

program.addProgram(anotherProgram)
```

---

### ProgramPlayer

Orchestrates the full playback lifecycle for a `Program`.

Requires an injected `VLCControl` instance (set via constructor option `vlc` or the `vlc` setter).

**`playProgram(program)`** — starts playback and returns a `Promise<void>` that resolves when the playlist ends or is interrupted, and rejects on error. Internally it:
1. Interrupts the program currently playing, if any (its promise resolves)
2. Calls `program.renderList()` to resolve all file paths; rejects if the list is empty
3. Stops VLC, clears the playlist, enqueues the full list and starts playback
4. Triggers `EVENT_NEW_SONG` for the first track
5. Starts the doom loop

**Doom loop** — a timer set to fire when the current song should end (at least 1 s, at most 60 s later). When it fires it polls VLC:
- If still playing → calls `triggerNewSong()` to check whether the track changed, then sets the next timer
- If not playing twice in a row → emits `EVENT_PLAYLIST_END` and resolves (VLC can report "not playing" for a moment between two songs)
- Around the end of the **last** song of the program it polls every 0.25 s, only asking VLC whether it still plays, and a single "not playing" ends the program. The next program then starts after about 0.3 s of silence instead of 1–2 s.
- On error → retries after 1 s; after 3 failures in a row, emits `EVENT_ERROR` and rejects

This avoids polling VLC every second at steady state; it only polls at song boundaries.

**`stopDoomLoop()`** — interrupts the current program (its promise resolves) without stopping VLC.
**`stop()`** — same, and also stops VLC.

**`triggerNewSong()`** — fetches the current title and file from VLC. If either changed since the last call it emits `EVENT_NEW_SONG` (the file matters: modules in a row often share an empty title). Either way it updates `_remainingTime` from the current song's remaining duration.

**Events** (from `CONSTS.EVENTS`):

| Event | Payload | When |
|---|---|---|
| `EVENT_NEW_SONG` | `{ title, file, remainingTime, elapsed, duration, next, program }` (`NewSongEvent`): times in seconds, `next` is the following file in the program or `null`, `program` the program's name or `''` | Track changed |
| `EVENT_PLAYLIST_END` | — | VLC stopped playing |
| `EVENT_ERROR` | `Error` | VLC unreachable or threw |

---

## Adding a program — example

```ts
import { VLCControl, Program, ProgramPlayer } from './index.js';

// 1. Connect to VLC
const vlc = new VLCControl({ host: 'localhost', port: 1234 });

// 2. Build a program
const program = new Program();
program.addSong('/music/jingle.mp3');
program.addFolder('/music/amiga-mods', { shuffle: true, limit: 20, recursive: true });
program.addSong('/music/outro.mod');

// 3. Play it
const player = new ProgramPlayer({ vlc });

player.events.on('EVENT_NEW_SONG', ({ title, remainingTime, file }) => {
    console.log(`Now playing: ${title} (${remainingTime}s remaining)`);
});

player.events.on('EVENT_PLAYLIST_END', () => {
    console.log('Program finished.');
});

await player.playProgram(program);
```

### Nesting programs

Programs can be nested arbitrarily. Entries are resolved in order and the result is always a flat file list:

```ts
const intro = new Program();
intro.addSong('/music/intro.mod');

const main = new Program();
main.addProgram(intro);                              // plays intro first
main.addFolder('/music/mods', { shuffle: true });   // then all mods shuffled
```
