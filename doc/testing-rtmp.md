# Testing the stream with a local RTMP server

YouTube receives the stream over RTMPS. To check what it would get without going live, send the broadcast to [mediamtx](https://github.com/bluenviron/mediamtx), a single-binary media server, and read it back.

## Set up mediamtx

Download `mediamtx_<version>_linux_amd64.tar.gz` from its releases page, compare its SHA-256 with `checksums.sha256`, and extract it into a folder outside the project. Then, in `mediamtx.yml`:

```yaml
rtsp: false
hls: false
webrtc: false
srt: false
rtmp: true
rtmpEncryption: "optional"      # plain RTMP on 1935 and RTMPS on 1936, like YouTube
rtmpAddress: 127.0.0.1:1935
rtmpsAddress: 127.0.0.1:1936
rtmpServerKey: server.key
rtmpServerCert: server.crt
```

Make a throwaway certificate next to it:

```bash
openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj /CN=localhost -keyout server.key -out server.crt
```

## Run

```bash
./mediamtx                                         # in the mediamtx folder
RADIO_OUTPUT=rtmps://127.0.0.1:1936/live2/test-key npm run dev -- broadcast -c schedule.json
```

Watch it with `ffplay rtmp://127.0.0.1:1935/live2/test-key`, or record what a viewer gets:

```bash
ffmpeg -i rtmp://127.0.0.1:1935/live2/test-key -c copy -t 120 viewer.flv
```

## What to check in the recording

```bash
# codecs, size, sample rate
ffprobe -v error -show_entries stream=codec_name,width,height,sample_rate,r_frame_rate -of compact viewer.flv
# keyframe spacing: should be 2000 ms
ffprobe -v error -select_streams v -skip_frame nokey -show_entries frame=pts_time -of csv=p=0 viewer.flv
# silences longer than 0.5 s
ffmpeg -i viewer.flv -af silencedetect=n=-50dB:d=0.5 -f null - 2>&1 | grep silence_
# dropped video frames: the copper bars move every frame, so every frame should be distinct
ffmpeg -i viewer.flv -vf mpdecimate=hi=1:lo=1:frac=0 -fps_mode vfr -f null - 2>&1 | grep frame=
```

## Results (2026-10-09, mediamtx v1.21.1)

- 110 s read back over RTMP while publishing over RTMPS: H.264 854×480 30 fps + AAC 48 kHz, keyframes every 2000 ms, 3241 frames and none repeated. One connection for the whole run, across three song changes and a program restart.
- No silence at song changes inside a program. **A 2 s silence when the program ended and the default loop restarted it:** the player needs two "not playing" polls one second apart before it calls the program finished, then the playlist is rebuilt.
- The viewer's ffmpeg printed a few "Negative cts" warnings while reading from mediamtx. Our own output has no packet with pts < dts, so they come from the server's remuxing.
- The stream key appears nowhere in our logs (mediamtx logs it, but that is the server's side).
- Killing the server: ffmpeg exits at once ("Broken pipe"), and the broadcast stops cleanly with exit code 1 within a second.
