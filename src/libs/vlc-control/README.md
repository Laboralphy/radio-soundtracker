# vlc-control

This library controls a running VLC instance via its RC (remote control) telnet interface and provides a higher-level playlist/program abstraction on top.

## Class overview

```
VLCConnection          low-level TCP socket to VLC RC interface
    └── VLCControl     typed command methods (play, stop, enqueue, getTime…)
            └── ProgramPlayer   program lifecycle + doom loop

Program                playlist descriptor (ordered list of entries)
    └── ProgramEntry   a single entry: song file, folder, or nested program
```

---

### VLCConnection

Handles raw TCP communication with VLC's RC interface (`--intf rc` / `--rc-host`).

Each call to `sendTransaction(command)` opens a new TCP socket, sends the command string, waits for VLC to echo back the `> ` prompt (which marks the end of a response), then closes the socket and resolves with the response text.

Multiple commands can be sent in a single connection by joining them with `\n`:
```ts
sendTransaction('get_time\nget_length')  // returns two response lines
```

`sendBatch(commands: string[])` is the array variant; it waits until as many `> ` prompts as commands have been received before closing.

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

`getTime()` sends `get_time\nget_length` in a single transaction because VLC's RC interface only returns one value per command. It returns:
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

**`playProgram(program)`** — starts playback and returns a `Promise<void>` that resolves when the playlist ends or rejects on error. Internally it:
1. Stops VLC and clears the current playlist
2. Calls `program.renderList()` to resolve all file paths
3. Enqueues the full list and starts playback
4. Triggers `EVENT_NEW_SONG` for the first track
5. Starts the doom loop

**Doom loop** — a `setInterval` that ticks every second. It counts down `_remainingTime` (seeded from the current song's remaining duration). When it reaches zero it polls VLC:
- If still playing → calls `triggerNewSong()` to check whether the track changed
- If stopped → emits `EVENT_PLAYLIST_END` and stops the loop
- On error → emits `EVENT_ERROR` and stops the loop

This avoids polling VLC every second at steady state; it only polls at song boundaries.

**`triggerNewSong()`** — fetches the current title from VLC. If the title changed since the last call it emits `EVENT_NEW_SONG`. Either way it updates `_remainingTime` from the current song's remaining duration.

**Events** (from `CONSTS.EVENTS`):

| Event | Payload | When |
|---|---|---|
| `EVENT_NEW_SONG` | `{ title, remainingTime, file }` | Track changed |
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
