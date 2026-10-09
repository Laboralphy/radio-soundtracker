#!/bin/bash
# Soak test: runs the broadcast for a long time, the way production would, and records what a viewer gets.
#
# usage: MEDIAMTX_DIR=/path/to/mediamtx tools/soak/soak.sh SECONDS OUTDIR SCHEDULE.json
#
# - Freezes a copy of the code in OUTDIR/code, so editing the project does not change the run.
# - Starts mediamtx (configured as in doc/testing-rtmp.md), and the broadcast over RTMPS, restarting it
#   like systemd would; every restart goes to OUTDIR/events.log.
# - A viewer ffmpeg records the stream to OUTDIR/viewer-N.flv (about 4.5 GB per day at 480p).
# - Memory and CPU of each process are sampled every minute into OUTDIR/samples.csv.
# Stop early with: touch OUTDIR/STOP. Then summarise with: python3 tools/soak/report.py OUTDIR
set -u
DURATION=${1:?seconds}; OUT=$(readlink -f "${2:?output folder}"); SCHEDULE=$(readlink -f "${3:?schedule file}")
: "${MEDIAMTX_DIR:?set MEDIAMTX_DIR to the folder holding mediamtx and mediamtx.yml}"
ROOT=$(cd "$(dirname "$0")/../.." && pwd); CODE=$OUT/code; KEY=soak-key
mkdir -p "$OUT"
if [ ! -d "$CODE" ]; then
  mkdir "$CODE" && cp -r "$ROOT/src" "$ROOT/package.json" "$ROOT/tsconfig.json" "$CODE/" && ln -s "$ROOT/node_modules" "$CODE/node_modules"
  echo "HEAD $(git -C "$ROOT" rev-parse --short HEAD), uncommitted diff sha256 $(git -C "$ROOT" diff | sha256sum | cut -c1-12)" > "$CODE/VERSION"
fi
cp "$SCHEDULE" "$OUT/soak.json"
rm -f "$OUT/STOP"
END=$(( $(date +%s) + DURATION ))
event() { echo "$(date '+%F %T') $*" >> $OUT/events.log; }
alive() { [ "$(date +%s)" -lt "$END" ] && [ ! -e $OUT/STOP ]; }
event "soak start, $DURATION s, code: $(cat $CODE/VERSION)"

(cd "$MEDIAMTX_DIR" && exec ./mediamtx > $OUT/mediamtx.log 2>&1) &
MTX=$!; sleep 2

# supervisor: restart the broadcast like systemd would
(
  cd $CODE
  while alive; do
    RADIO_LOG_DIR=$OUT/logs RADIO_OUTPUT=rtmps://127.0.0.1:1936/live2/$KEY setsid node --import tsx src/index.ts broadcast -c $OUT/soak.json -p 4324 --sink radio_soak >> $OUT/broadcast.log 2>&1 &
    echo $! > $OUT/broadcast.pid; wait $!; code=$?
    alive && event "broadcast exited with code $code, restarting" ; sleep 2
  done
) &
SUP=$!

# viewer: record what YouTube would receive; a new file after each interruption
(
  n=0
  while alive; do
    sleep 3
    ffmpeg -hide_banner -nostats -loglevel warning -i rtmp://127.0.0.1:1935/live2/$KEY -c copy -y $OUT/viewer-$n.flv >> $OUT/viewer.log 2>&1 &
    echo $! > $OUT/viewer.pid; wait $!; code=$?
    alive && event "viewer-$n ended with code $code"
    n=$((n+1))
  done
) &
VIEW=$!

# sampler: rss in kB and cumulative CPU ticks per process, every minute
echo "time,proc,pid,rss_kb,cpu_ticks" > $OUT/samples.csv
sample() {
  for spec in "node:index.ts [b]roadcast" "frames:broadcast/[f]rames" "ffmpeg:[f]fmpeg .*radio_soak.monitor" "vlc:[r]c-host localhost:4324" "mediamtx:^[.]/mediamtx"; do
    name=${spec%%:*}; pat=${spec#*:}
    for p in $(pgrep -f "$pat"); do
      rss=$(awk '/VmRSS/ {print $2}' /proc/$p/status 2>/dev/null); ticks=$(awk '{print $14+$15}' /proc/$p/stat 2>/dev/null)
      [ -n "$rss" ] && echo "$(date +%s),$name,$p,$rss,$ticks" >> $OUT/samples.csv
    done
  done
}
while alive; do sample; sleep 60; done

event "soak end, stopping"
touch $OUT/STOP
kill -INT -- -$(cat $OUT/broadcast.pid) 2>/dev/null; wait $SUP
kill -INT $(cat $OUT/viewer.pid) 2>/dev/null; wait $VIEW
kill $MTX; wait $MTX 2>/dev/null
pactl list short sinks | grep -q radio_soak && event "sink radio_soak left behind"
event "soak stopped"
