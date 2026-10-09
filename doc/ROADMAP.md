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

### How audio reaches ffmpeg (decided: B for Phase 1, C later)

| Option | How | Pros | Cons |
|---|---|---|---|
| **A. Keep VLC, output to a pipe** | `cvlc --sout '#transcode{acodec=s16l,samplerate=48000,channels=2}:std{access=file,mux=wav,dst=/tmp/radio.fifo}' --sout-keep` → ffmpeg reads the FIFO | Keeps all current code | Fragile: `--sout-keep` quirks, WAV header per item, and the RC timing issues above remain |
| **B. Keep VLC, use a virtual sound card** | VLC plays to a PulseAudio/PipeWire null sink (or ALSA loopback), and ffmpeg captures `-f pulse -i radio.monitor` | Very robust and common for headless radios, and VLC stays unchanged | Needs a sound server in the container or VM. Gaps and silences are captured as-is. |
| **C. Drop VLC: Node decodes with libopenmpt** | For each track, Node spawns `ffmpeg -i song.mod -f s16le -` (libopenmpt demuxer) or `openmpt123 --stdout`, and **writes the PCM into the stdin** of one persistent ffmpeg encoder | Full control: exact song boundaries, accurate lengths, crossfade or jingles possible, no RC socket, now-playing is known *exactly* | Rewrites `ProgramPlayer`. Node must keep the PCM pipe fed in real time (back-pressure, or insert silence on underrun). |

**Decision (2026-10-08):** Phase 1 uses **B**, with the video drawn by a separate image program (§2.1). It keeps all the VLC code and was validated by the proof of concept in `poc/`. **C** stays the long-term engine: accurate MOD lengths, gapless playback, and one clock for audio and video. The scheduler already depends only on the `Player` interface, so moving to C means writing a second `Player`.

### 2.1 Notes from the design discussion (2026-10-08)

**OBS Studio or ffmpeg?** Both can encode and send to YouTube; OBS is a desktop app with a visual scene editor, ffmpeg a command-line tool. For a server running unattended 24/7, ffmpeg is the better fit: no graphical session needed, light, and easy to start and supervise from Node. OBS uses the same kinds of encoders internally (x264, AAC).

**YouTube needs video.** It does not accept audio alone: the stream must be H.264 video + AAC audio in FLV over RTMPS (`rtmps://a.rtmp.youtube.com/live2/<key>`), with a keyframe every 2 s.

**One ffmpeg that never restarts.** Running one ffmpeg per song would drop the stream at each song change (viewers see buffering, YouTube may end the event). ffmpeg runs once, and song changes happen upstream of it.

**Two ways to make the picture:**

| | How | Good for |
|---|---|---|
| ffmpeg filters | `drawtext=textfile=now-playing.txt:reload=1` with expressions on `x`, `y`, `alpha` (scrolling, fades); `showwaves`, `showspectrum` for visualizers | Simple layouts, least CPU and code |
| Separate image program | Any program writes raw RGBA frames to ffmpeg's stdin (`-f rawvideo -pix_fmt rgba -s WxH -r FPS -i pipe:0`). In Node, draw with `@napi-rs/canvas`. | Custom graphics: copper bars, VU meters, scrolling pattern data… |

**VLC for sound, another program for images.** This is what `poc/` implements:

```
                 Node.js (scheduler)
                 │  RC commands      │ JSON line per song change
                 ▼                   ▼
            ┌────────┐         ┌──────────────┐
            │  VLC   │         │ image program│
            └───┬────┘         └──────┬───────┘
     plays into │                     │ raw RGBA frames (stdin)
 null sink      ▼                     ▼
          ┌───────────────────────────────────┐
          │ ffmpeg: -f pulse -i radio.monitor │
          │         -f rawvideo -i pipe:0     │──► YouTube
          └───────────────────────────────────┘
```

- **Sound path:** a PulseAudio/PipeWire **null sink** (`pactl load-module module-null-sink sink_name=radio`). VLC plays into it (`PULSE_SINK=radio cvlc --aout pulse …`), and ffmpeg records its monitor (`-f pulse -i radio.monitor`). VLC behaves exactly as before, and gaps are recorded as silence. On a headless server the sound server must run as a service. Alternatives: ALSA loopback (`snd-aloop`, often not loadable on VPS or containers), or VLC `--sout … --sout-keep` into a pipe (fiddly, avoid).
- **Two clocks:** audio capture follows the real clock, while a raw frame pipe follows the frame count, so a slow image program would make the video drift behind. The fix is to put both on the real clock and let ffmpeg even things out:
  - `-use_wallclock_as_timestamps 1` on the frame input stamps each frame with its arrival time.
  - `-fps_mode cfr -r 30` repeats or drops frames to keep exactly 30 fps, so the image program may send fewer frames while the picture is still.
  - `-af aresample=async=1` corrects slow audio drift.
  
  The result is sync within a fraction of a second, which is fine for titles and animations (not for lip sync).
- **Image program rules:**
  - Pace frames to the real clock.
  - Skip frames rather than fall behind.
  - Never stop writing, or the picture freezes.
  - Mind the data rate: 1280×720 RGBA at 30 fps is about 110 MB/s. Prefer 854×480, or draw only an animated strip and let ffmpeg `overlay` it on a static background.

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
- [x] Choose option A, B or C (§2): **B + separate image program** (see §2.1 and the decisions log).
- [x] Proof of concept in `poc/` (`npm run poc`), with results in `poc/README.md`:
  - [x] Continuous audio from VLC through a null sink, with no break across song changes.
  - [x] Image program (`poc/frames.ts`): copper bars, title sliding in or scrolling, file name, progress bar; fed by `EVENT_NEW_SONG`.
  - [x] Output H.264 854×480 30 fps (keyframe every 2 s) + AAC 160k in FLV. Steady 30 fps; title change within about 0.1–0.2 s of the audio.
- [x] Turn the PoC into real code:
  - [x] A `broadcast` command (or an option of `schedule`) that runs scheduler, image program and ffmpeg together. *(done: `broadcast -c schedule.json -o out.flv`; starts its own VLC on the sink, or `--external-vlc`. If ffmpeg, VLC or the image program exits, everything stops with exit code 1 for a supervisor to restart.)*
  - [x] Settings in config: sink name, resolution, fps, bitrates, output URL (file for tests, RTMPS for YouTube). *(done: `RADIO_SINK`, `RADIO_VIDEO_SIZE`, `RADIO_FPS`, `RADIO_VIDEO_BITRATE`, `RADIO_AUDIO_BITRATE`, `RADIO_OUTPUT` in `.env.example`, each with a command line option. The stream key is hidden in logs, including ffmpeg's (`logs/ffmpeg.log`).)*
  - [x] Create the null sink if missing, and do not unload it if it already existed. *(done: `NullSink`)*
  - [x] Send the image program richer song info: total length (not just remaining time), program name, next song. *(done: `EVENT_NEW_SONG` carries `elapsed`, `duration`, `next` and `program`. It also fires when two songs in a row share a title, which used to be missed.)*
- [x] Final encoder settings: CBR-ish (`-maxrate` = `-b:v`, `-bufsize` = 2×), `-tune stillimage` if the picture stays mostly still, AAC 128–192 kbps. Check the CPU cost at 720p vs 480p. *(done: capped bitrate, keyframes exactly every 2 s (`-keyint_min`, `-sc_threshold 0`), AAC at 48 kHz like the sink. No `-tune stillimage`, because the copper bars move all the time. Measured CPU on a Xeon E3-1240 v5, in % of one core: 480p@1500k uses ffmpeg 78, image program 20, VLC 1, Node 0; 720p@3000k uses ffmpeg 86, image program 24. No dropped frames at either size, so 720p is affordable. The picture is simple, so x264 uses only about 0.5 Mb/s of the 1.5 Mb/s allowed; YouTube may warn about a low bitrate, which is harmless.)*
- [x] Test through a local RTMP server (`mediamtx` or `nginx-rtmp`) and watch with `ffplay`, to match YouTube's real input. *(done with mediamtx over RTMPS: procedure and results in `doc/testing-rtmp.md`. The stream is clean, with keyframes every 2 s, no dropped frames, and no gap at song changes.)*
- [x] **2 s of silence when a program ends and the next one starts** (found by the RTMP test). The player waits for two "not playing" polls one second apart, then rebuilds the playlist. Possible fixes: poll more often near the end of the last song, or enqueue the next program before the current one ends. Option C would remove the gap entirely. *(done: near the end of a program's last song the player polls every 0.25 s with only `is_playing`, and one "not playing" ends the program. Measured over four restarts: 0.23–0.31 s of silence, down from 1.25–2 s. The rest is VLC loading the next playlist; gapless playback (Phase 5, option C) removes it.)*
- [ ] Soak test: run 24 h locally, then check for A/V drift, memory growth in Node and ffmpeg, and gaps at song changes. *(in progress since 2026-10-09 17:12: RTMPS to mediamtx, a viewer recording everything, the whole library shuffled 30 songs at a time, a cron program every hour at :30, memory and CPU sampled every minute. It runs from a frozen copy of the code in `poc/out/soak/code`, taken before the standby screen and the i18n fix. Tools: `tools/soak/soak.sh` runs a soak, and `tools/soak/report.py` summarises it: restarts, memory and CPU per process, songs with no length, audio/video gap, and silences at song changes after removing the silence inside the modules. First 8 minutes: no restart, at most 0.11 s of extra silence at song changes, audio and video within 80 ms.)*
- [x] Song titles were HTML-escaped in logs (`&#39;infinity&#39; - necros&#x2F;khyron`), because i18next escapes values by default. Turned off: the messages go to a terminal and log files. *(found by the soak test)*
- [x] Decide what to show when VLC is down or between programs (the image program keeps running, so it can display "back soon"). *(done: `StandbyMonitor`. If no song starts within 3 s of the start, a program's end, or a playback error, the screen switches to "OFF AIR / Back soon", or "TECHNICAL DIFFICULTIES / Back in a moment" after an error. It names the next cron program and its time when there is one, and the copper bars and a pulsing headline keep the picture alive. Programs that follow each other (about 0.3 s apart) never trigger it. Checked with a cron-only schedule and a missing music folder.)*

### Phase 2 — First YouTube broadcast
- [ ] On the YouTube channel, enable live streaming (it can take 24 h the first time) and create a **persistent stream key**.
- [ ] Store the key outside git (`.env` is already ignored). Never log the full RTMP URL.
- [ ] Use `rtmps://a.rtmp.youtube.com/live2/<key>`, and configure the backup ingest URL shown in YouTube Studio for redundancy later.
- [ ] Set the event to "auto-start" and "auto-stop off" so a short reconnect does not end the broadcast.
- [ ] Check the stream health in YouTube Studio: resolution, bitrate and keyframe warnings.
- [ ] **Rights and Content ID:** MOD files have authors. Prefer modules whose licence allows redistribution (many on The Mod Archive state a licence per file), keep a credits list, and expect some Content ID claims on famous tunes (game and demo soundtracks that were later re-released commercially).

### Phase 3 — Unattended 24/7 operation
- [ ] **Process supervision:** `systemd` units, or `docker compose` with `restart: unless-stopped`, for each of: the sound server (PulseAudio/PipeWire), VLC, the Node scheduler, the image program and the ffmpeg encoder.
- [ ] **ffmpeg watchdog:** if ffmpeg exits or its output stalls (parse `-progress pipe:1`, or watch `out_time` stop moving), restart it immediately. Reconnects should take a few seconds, not minutes. *Today, losing the RTMP connection makes ffmpeg exit and `broadcast` stop entirely (exit code 1), which restarts VLC and the playlist too. Restart only ffmpeg and the image program, and leave the music playing. A silent network hang, where no error comes back, needs the stall check.*
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
| 2026-10-08 | Encode and send with **ffmpeg**, not OBS Studio | Headless, light, scriptable from Node; OBS needs a graphical session |
| 2026-10-08 | Audio path **B** (VLC → PulseAudio null sink → ffmpeg) for Phase 1; **C** (libopenmpt in Node) as the later engine | Keeps the existing VLC code; validated by `poc/` |
| 2026-10-08 | Video drawn by a **separate image program** (`@napi-rs/canvas`) piping raw RGBA frames; both ffmpeg inputs on the real clock | Free-form graphics; sync within about 0.2 s measured |
| 2026-10-09 | `broadcast` command; the image program moves to `src/libs/broadcast/frames.ts` | PoC turned into real code; checked with a 3 min run (no silence, clean FLV on Ctrl+C) and by killing ffmpeg mid-run |
| 2026-10-09 | The image program writes **straight into ffmpeg's stdin** (an OS pipe), not through Node | Copying the frames cost Node about 15% of a core, and a busy Node would have stalled the picture |
| 2026-10-09 | Stop order: image program, then ffmpeg (input closed, then SIGINT), then VLC | ffmpeg ignores SIGINT while waiting for frames; it was killed after 5 s and left an unfinished file |
| 2026-10-09 | Silences are judged **after removing the silence inside the modules** (measured with libopenmpt) | Many modules start or end with seconds of silence; counting those as gaps would hide the real ones |
| 2026-10-09 | Standby screen after **3 s** without a song | Programs follow each other in about 0.3 s, so they never trigger it; a failing program or an empty schedule shows it quickly |
| 2026-10-09 | Child processes (VLC, ffmpeg, image program) run in **their own process group** | Ctrl+C reached ffmpeg twice (terminal + our stop), so it quit without finishing the output. Under systemd (Phase 3), use `KillMode=mixed` so only Node gets SIGTERM and stops the others in order. |
