# Radio Soundtracker — Roadmap

**Goal:** a 24/7 YouTube Live channel playing Amiga tracker music (MOD/S3M/XM/IT) on a schedule, with no one watching over it.

This file tracks progress. Tick boxes as work lands. Keep the newest decisions in the "Decisions log" at the bottom.

---

## 1. Where we are (review of 2026-10-08)

### What exists

| Area | State |
|---|---|
| VLC RC control (`VLCConnection`, `VLCControl`) | Works. Opens one TCP connection per command. |
| Program model (`Program`, `ProgramEntry`, `ProgramLibrary`) | Works. Supports song, folder (shuffle, limit, recursive), and nested program entries. Programs are defined in JSON and checked with zod. |
| Playback (`ProgramPlayer`) | Works. A "doom loop" polls VLC only at song boundaries and emits `EVENT_NEW_SONG` and `EVENT_PLAYLIST_END`. |
| Scheduling (`ProgramScheduler`) | Works. One default program loops forever, and cron programs interrupt it, then hand back to it. |
| CLI | `check`, `play`, `schedule` (yargs, i18n en/fr, winston daily logs) |
| Tests | 59 passing: `parseTime`, VLC connection (fake RC server), Program/ProgramLibrary, ProgramPlayer (fake VLC + fake timers), ProgramScheduler (fake player). |
| Type check | `npm run typecheck` (sources and tests) is clean. |
| Lint | `npm run lint` is clean. |
| Streaming to YouTube | **Not started** |

All the tools the next phases need are already on the dev machine: VLC 3.0.23, `ffmpeg` built with `libopenmpt`, `libx264` and `aac`, and `openmpt123`.

### Bugs and risks found in the current code

Ordered by how much they threaten 24/7 operation.

- [x] **A slow VLC reply is treated as "playlist finished".** In `VLCConnection.ts:40`, a socket timeout ends the connection and resolves with `''` instead of rejecting. Then `isPlaying()` returns `false` (`ProgramPlayer.ts:90`), the player emits `EVENT_PLAYLIST_END`, and the scheduler restarts the default program from the top. One VLC hiccup longer than 1 s restarts the playlist. *Fix:* reject on timeout, and retry a few times before deciding that playback stopped. *(Phase 0, done)*
- [x] **Any error in the default loop kills the process.** `_runDefaultLoop` (`ProgramScheduler.ts:64`) is started with `void` and has no `try/catch`. If `playProgram` rejects (VLC unreachable, missing folder → `TreeAsync.ls` throws), the result is an unhandled rejection, and Node exits. *Fix:* catch the error, log it, back off (1 s, 2 s, 5 s…), then retry. *(Phase 0, done)*
- [x] **`recursive` is silently dropped.** `Program.addEntry` (`Program.ts:45`) does not destructure or forward `recursive`, so `{ "recursive": true }` in a schedule file never takes effect. *(Phase 0, done)*
- [x] **Doom-loop ticks can overlap.** `setInterval(() => this.doomLoop(), 1000)` (`ProgramPlayer.ts:119`) does not wait for the async body. Combined with the 1 s socket timeout, two polls can run at once and both call `triggerNewSong`. *Fix:* use a self-scheduling `setTimeout`, or a "busy" flag. *(Phase 0, done)*
- [x] **Stopping does not stop VLC.** `stopDoomLoop()` only stops polling. With `play --time` or after SIGINT on `schedule`, VLC keeps playing. *Fix:* call `vlc.doStop()` on shutdown or time limit. *(Phase 0, done)*
- [x] **An empty program spins.** If a program resolves to 0 files (empty folder, typo in path), the default loop plays nothing, sees "not playing", and starts again every second, forever. *Fix:* detect an empty `renderList()` and log an error or back off. *(Phase 0, done)*
- [x] **Large `enqueue` batches are fragile.** `doEnqueue([...])` sends N commands through `sendTransaction`, which closes the socket after the *first* prompt. VLC probably still reads the buffered lines, but this is untested for long lists. *Fix:* use `sendBatch` (it waits for N prompts), or enqueue in chunks, then check with `playlist`. *(Phase 0, done)*
- [ ] **Song length from libmodplug is unreliable.** VLC uses libmodplug for MODs, and pattern-jump loops can report a wrong or infinite length. libopenmpt is much better at this (see the decision in §2).
- [x] **ESLint config is broken.** `eslint.config.js` uses `module.exports` while `package.json` sets `"type": "module"`. *Fix:* switch to `export default [...]` (or rename the file to `.cjs`). *(Phase 0, done)*
- [x] **The production build would not find translations.** `npm run build` emits `dist/` but does not copy `src/locales`, and i18n loads `../../locales` relative to the compiled file. In addition, `package.json` `main` points to a nonexistent `index.js`. *Fix:* copy locales in the build step and set `main`/`bin` to `dist/index.js`. *(Phase 0, done)*
- [x] **The tests are not type-checked.** `__tests__` is outside `tsconfig.include`, and `VLCControlTest.ts` calls the private `parseResponse`. That is fine at runtime but hides type errors. *Fix:* add a `tsconfig.test.json`, or make `parseResponse` a pure exported function. *(Phase 0, done)*

- [x] **Responses were cut short, so song lengths were `NaN`.** Found while fixing the above. The April logs showed `remaining=NaN` for almost every poll (over 900 times). VLC prints a prompt each time it waits for input, not after each command, and the old code closed the socket as soon as the first line of output arrived, so `get_length` was often lost. Without a length, the player polled every second instead of once per song. *(Phase 0, done: commands are now sent one at a time, each waiting for its prompt.)*

Housekeeping:
- [x] `bin/resume.sh` contains a Claude session ID. It is personal tooling, so remove it from the repo or add it to `.gitignore`. *(removed)*
- [x] The doc comment in `ProgramLibrary.ts:32` describes `createFromDefinition` but sits above `entries()`. *(done)*
- [x] `program` entries must reference programs defined *earlier* in the JSON (object key order). Document this, or resolve references in two passes. *(documented in `doc/schedule-format.md`)*
- [x] Host, port and timeout are hard-coded in `play` and `schedule` (only `check` accepts options). Move them to a shared config, either environment variables or the schedule file. *(done: env vars + `--host/--port/--timeout` on every command)*

---

## 2. Target architecture

YouTube Live accepts **video only** over RTMP(S). An audio-only stream is rejected, so the audio has to be wrapped in a video track, even if that track is a still image.

```
           schedule.json
                │
        ┌───────▼────────┐  now-playing.txt / events
        │  Node.js core  │──────────────────────────────┐
        │  (scheduler)   │                              │
        └───────┬────────┘                              │
                │ controls                              │
        ┌───────▼────────┐  continuous PCM audio  ┌─────▼──────────────────┐
        │ Audio source   │───────────────────────►│ ffmpeg encoder         │
        │ VLC or         │                        │ + background/visualizer│
        │ libopenmpt     │                        │ + drawtext overlay     │
        └────────────────┘                        │ H.264 + AAC → FLV      │
                                                  └─────┬──────────────────┘
                                                        │ rtmps://a.rtmp.youtube.com/live2/<key>
                                                        ▼
                                                   YouTube Live
```

**The key requirement:** the ffmpeg → YouTube connection must **never restart between songs**. A restart makes YouTube show "stream offline" and can end the live event. The encoder must be one long-running process fed by a continuous audio stream, and song changes happen *upstream* of it.

### Decision to make: how audio reaches ffmpeg

| Option | How | Pros | Cons |
|---|---|---|---|
| **A. Keep VLC, output to a pipe** | `cvlc --sout '#transcode{acodec=s16l,samplerate=48000,channels=2}:std{access=file,mux=wav,dst=/tmp/radio.fifo}' --sout-keep` → ffmpeg reads the FIFO | Keeps all current code | Fragile: `--sout-keep` quirks, WAV header per item, and the RC timing issues above remain |
| **B. Keep VLC, use a virtual sound card** | VLC plays to a PulseAudio/PipeWire null sink (or ALSA loopback), and ffmpeg captures `-f pulse -i radio.monitor` | Very robust and common for headless radios, and VLC stays unchanged | Needs a sound server in the container or VM. Gaps and silences are captured as-is. |
| **C. Drop VLC: Node decodes with libopenmpt** | For each track, Node spawns `ffmpeg -i song.mod -f s16le -` (libopenmpt demuxer) or `openmpt123 --stdout`, and **writes the PCM into the stdin** of one persistent ffmpeg encoder | Full control: exact song boundaries, accurate lengths, crossfade or jingles possible, no RC socket, now-playing is known *exactly* | Rewrites `ProgramPlayer`. Node must keep the PCM pipe fed in real time (back-pressure, or insert silence on underrun). |

**Recommendation:** to get on air quickly, use **B**. For the long-term engine, move to **C**. `Program`, `ProgramLibrary` and `ProgramScheduler` survive in both cases. Only the "player" behind them changes, so define a `Player` interface now (`playProgram`, `stop`, `events`) and make `ProgramPlayer` (VLC) one implementation of it.

---

## 3. Phases

### Phase 0 — Fix the foundation (before streaming)
- [x] Fix the bugs listed in §1, especially the timeout and the unhandled rejection in the default loop.
- [x] Repair ESLint, and add `npm run typecheck` (`tsc --noEmit`).
- [x] Unit tests for `Program.renderList` (folder, shuffle, limit, recursive, nested), using a temp folder fixture.
- [x] Scheduler tests with a fake player and fake timers: default loop, cron interrupt, return to default, error recovery.
- [x] One config source (`config.json` or `.env`): VLC host/port/timeout, music root, log dir, stream key path. *(done for VLC host/port/timeout and log dir: `.env.example`. Music root and stream key come with Phases 1–2.)*
- [x] Commit an example `schedule.example.json` and document its format (currently only zod defines it).

### Phase 1 — Local audio → video pipeline (no YouTube yet)
- [ ] Choose option A, B or C (§2) and write the decision down below.
- [ ] Get a continuous audio stream into ffmpeg that does not break across song changes.
- [ ] Video track:
  - [ ] Start with a static 1280×720 image (`-loop 1 -framerate 30 -i bg.png`).
  - [ ] Add a "Now playing: <title>" overlay with `drawtext=textfile=now-playing.txt:reload=1`. Node writes the file atomically (write to a temp file, then rename) on `EVENT_NEW_SONG`.
  - [ ] Later, add an audio visualizer (`showwaves` / `showspectrum` / `avectorscope`) composited over the background.
- [ ] Encode to the settings YouTube expects: H.264 (`-preset veryfast -tune stillimage`, CBR-ish `-b:v 1500k -maxrate 1500k -bufsize 3000k`), **keyframe every 2 s** (`-g 60` at 30 fps), `-pix_fmt yuv420p`, AAC 128–192 kbps 44.1/48 kHz stereo, `-f flv`.
- [ ] Test by writing to a local file or a local RTMP server (`nginx-rtmp` or `mediamtx`), and play it back with `ffplay`/VLC.
- [ ] Soak test: run 24 h locally, then check for A/V drift, memory growth in Node and ffmpeg, and gaps at song changes.

### Phase 2 — First YouTube broadcast
- [ ] On the YouTube channel, enable live streaming (it can take 24 h the first time) and create a **persistent stream key**.
- [ ] Store the key outside git (`.env` is already ignored). Never log the full RTMP URL.
- [ ] Use `rtmps://a.rtmp.youtube.com/live2/<key>`, and configure the backup ingest URL shown in YouTube Studio for redundancy later.
- [ ] Set the event to "auto-start" and "auto-stop off" so a short reconnect does not end the broadcast.
- [ ] Check the stream health in YouTube Studio: resolution, bitrate and keyframe warnings.
- [ ] **Rights and Content ID:** MOD files have authors. Prefer modules whose licence allows redistribution (many on The Mod Archive state a licence per file), keep a credits list, and expect some Content ID claims on famous tunes (game and demo soundtracks that were later re-released commercially).

### Phase 3 — Unattended 24/7 operation
- [ ] **Process supervision:** `systemd` units, or `docker compose` with `restart: unless-stopped`, for each of: VLC (if kept), the Node scheduler and the ffmpeg encoder.
- [ ] **ffmpeg watchdog:** if ffmpeg exits or its output stalls (parse `-progress pipe:1`, or watch `out_time` stop moving), restart it immediately. Reconnects should take a few seconds, not minutes.
- [ ] **Audio-silence watchdog:** if no new song arrives for longer than the longest track plus a margin, or the audio level stays at silence (ffmpeg `silencedetect`), alert and restart the audio source.
- [ ] **Fallback audio:** if the scheduler crashes, ffmpeg should keep streaming a fallback (a looped jingle or "technical difficulties" track) instead of dropping the stream, for example through an `amix`/`azmq` input switch or a small relay.
- [ ] **Health endpoint and alerts:** `/health` returns the current song, uptime and last ffmpeg progress. Send a push notification (ntfy, Discord or Telegram webhook) on restarts and failures.
- [ ] **Logs:** keep the existing winston rotation, also rotate ffmpeg stderr, and add a play history (`timestamp, file, title, program`), useful for credits and Content ID disputes.
- [ ] **Hosting:** a small VPS is enough (option C with a static image: about 1 vCPU, 1–2 GB RAM). Upload is around 2 Mbps sustained, roughly 650 GB per month. A visualizer costs more CPU, so measure it.
- [ ] **Docker image:** Node, ffmpeg (with libopenmpt) and VLC/Pulse if kept, the music library as a mounted volume, and secrets from env.
- [ ] Plan for YouTube's limits: a single very long live stream is not fully archived. Consider a scheduled **daily or weekly restart of the broadcast** at a quiet time, decided by us rather than by a crash.

### Phase 4 — Live management
- [ ] HTTP API on the Node process: `GET /now-playing`, `GET /schedule`, `POST /skip`, `POST /program/:name/play`, `PUT /schedule` (hot reload with no restart and no stream drop).
- [ ] Hot-reload `schedule.json` when it changes on disk (zod-validate first, and keep the old config if the new one is invalid).
- [ ] Simple web dashboard: now playing, next scheduled programs, recent history, stream health.

### Phase 5 — Polish and community
- [ ] Rich overlay: title, author (read from the module's sample names / metadata via libopenmpt), format (MOD/XM/IT…), elapsed and remaining time, and next track.
- [ ] Jingles, station IDs and program intros (already possible with `song` entries; add "every N songs" insertion).
- [ ] Gapless playback and crossfade (easy with option C).
- [ ] Loudness normalisation (`loudnorm` or a per-track ReplayGain pre-pass). MODs vary a lot in volume.
- [ ] Update the YouTube title and description through the YouTube Data API (`liveBroadcasts.update`) when a themed program starts.
- [ ] Live-chat commands or song requests (YouTube Data API `liveChatMessages`, which has a quota).
- [ ] Also stream to Twitch, Owncast or Icecast (an ffmpeg `tee` muxer or a relay like `mediamtx`).

---

## 4. Definition of done for "24/7"

- [ ] The stream runs **7 days** with no manual action.
- [ ] Killing any single process (Node, ffmpeg, VLC) recovers within **≤ 30 s** without ending the YouTube broadcast.
- [ ] Rebooting the host brings the stream back automatically.
- [ ] Cron programs start within a few seconds of their scheduled time, and the default program resumes afterwards.
- [ ] Each failure triggers a notification, and every played track is recorded in the history log.

---

## 5. Decisions log

| Date | Decision | Why |
|---|---|---|
| 2026-10-08 | Roadmap created | Review of the playback/scheduling core |
| 2026-10-08 | Phase 0 done | 59 tests; lint, typecheck and build fixed; checked live against VLC 3.0.23 (VLC crash and restart, broken cron program, SIGINT) |
| 2026-10-08 | Scheduler depends on a `Player` interface (`src/libs/vlc-control/Player.ts`) | Lets option C (libopenmpt) replace VLC without touching the scheduler |
| | Audio path: A / B / C? | *to decide in Phase 1* |
