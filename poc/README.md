# Proof of concept: VLC sound + separate image program → ffmpeg

Records a few minutes of "radio" to a local FLV file, using the architecture planned for Phase 1 (see `doc/ROADMAP.md`).

```
VLC ──► PulseAudio null sink "radio_poc" ──► ffmpeg input 0 (radio_poc.monitor)
poc/frames.ts ──► raw RGBA frames on a pipe ──► ffmpeg input 1 ──► poc/out/test.flv
```

- `run.ts` creates the virtual sink, starts VLC (RC port 4322, so it does not clash with a VLC on 1234), the frame program and ffmpeg, then plays a shuffled folder with the project's `ProgramPlayer`. On every `EVENT_NEW_SONG` it sends a JSON line to the frame program. When it finishes, it stops everything and removes the sink.
- `frames.ts` is the image program: 854×480 RGBA at 30 fps, paced to the real clock, drawn with `@napi-rs/canvas`. It shows copper bars, the title (sliding in, or scrolling if it is too long), the file name and a progress bar.

## Run

```bash
npm run poc -- --music ~/Musique/mods --duration 60 --out poc/out/test.flv
vlc poc/out/test.flv
```

Requirements: `pactl` (PulseAudio or PipeWire), `cvlc`, `ffmpeg` with `libx264`. ffmpeg's log is written next to the output file (`poc/out/ffmpeg.log`).

## Results (2026-10-08)

- 40 s run: 1201 frames at a steady 30 fps (`speed=0.998x`); H.264 854×480 + AAC 44.1 kHz stereo, about 475 kb/s.
- Real audio: mean level −17 dB, no silence longer than 0.5 s, including across the song change.
- Sync: the test tone ended at 4.35 s in the recording, and the new title appeared at about 4.4 s.
- CPU: one Node process drawing frames, plus x264 `veryfast` at 480p.

## Going to YouTube

Replace the output file with `rtmps://a.rtmp.youtube.com/live2/<stream key>` (the muxer is already `-f flv`). Read the key from the environment and never log it.
