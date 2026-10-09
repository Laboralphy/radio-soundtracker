"""Summarises a soak run (see soak.sh): python3 tools/soak/report.py OUTDIR"""
import csv, glob, json, os, re, subprocess, sys
from collections import defaultdict
from datetime import datetime

out = sys.argv[1]

print('== Events')
print(open(f'{out}/events.log').read().strip())

# memory and CPU per long-lived process (short-lived ones caught once by the sampler are ignored)
print('\n== Memory (RSS) and CPU per process')
rows = defaultdict(list)
for r in csv.DictReader(open(f'{out}/samples.csv')):
    rows[(r['proc'], r['pid'])].append((int(r['time']), int(r['rss_kb']), int(r['cpu_ticks'])))
hz = os.sysconf('SC_CLK_TCK')
for (proc, pid), s in sorted(rows.items()):
    if len(s) < 5:
        continue
    hours = (s[-1][0] - s[0][0]) / 3600
    # growth: compare the median of the first and last hour, to ignore short spikes
    n = max(1, min(60, len(s) // 4))
    first = sorted(x[1] for x in s[:n])[n // 2]
    last = sorted(x[1] for x in s[-n:])[n // 2]
    cpu = (s[-1][2] - s[0][2]) / hz / max(1, s[-1][0] - s[0][0]) * 100
    print(f'{proc:9} pid {pid:>7}: {hours:5.1f} h, RSS {first/1024:7.1f} -> {last/1024:7.1f} MB '
          f'(max {max(x[1] for x in s)/1024:.1f}), CPU {cpu:5.1f}% of a core')

# songs, from the broadcast's own JSON log: the player logs every poll, keep the changes only
print('\n== Songs')
changes = []          # (unix time, file)
zero = set()
levels = defaultdict(int)
last_song, remaining = None, None
for f in sorted(glob.glob(f'{out}/logs/radio-*.log')):
    for line in open(f):
        d = json.loads(line)
        levels[d['level']] += 1
        msg = d['message']
        if msg.startswith('triggerNewSong: remaining='):
            remaining = msg.split('=', 1)[1]
            continue
        m = re.match(r'triggerNewSong: title="(.*)" file="(.*)"$', msg)
        if m and (m.group(2), m.group(1)) != last_song:
            last_song = (m.group(2), m.group(1))
            changes.append((datetime.fromisoformat(d['timestamp'].replace('Z', '+00:00')).timestamp(), m.group(2)))
            if remaining == '0':
                zero.add(m.group(2))
print(f'{len(changes)} song changes, {len(set(f for _, f in changes))} different files')
print(f'{len(zero)} files reported a length of 0 s (no progress bar, polled every second):')
for f in sorted(zero)[:15]:
    print('   ', f)
print('log lines per level:', dict(levels))
change_times = [t for t, _ in changes]

_module_cache = {}
def module_silence(path, where):
    """Seconds of silence at the start or the end of a module, as libopenmpt renders it."""
    key = (path, where)
    if key not in _module_cache:
        args = ['-t', '15'] if where == 'start' else ['-sseof', '-15']
        r = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', *args, '-i', path, '-af', 'silencedetect=n=-50dB:d=0.1',
                            '-f', 'null', '-'], capture_output=True, text=True)
        starts = [float(x) for x in re.findall(r'silence_start: ([\d.]+)', r.stderr)]
        ends = [(float(e), float(d)) for e, d in re.findall(r'silence_end: ([\d.]+) \| silence_duration: ([\d.]+)', r.stderr)]
        total = re.findall(r'time=(\d+):(\d+):([\d.]+)', r.stderr)
        length = int(total[-1][0]) * 3600 + int(total[-1][1]) * 60 + float(total[-1][2]) if total else 15
        if where == 'start':
            value = next((d for e, d in ends if abs(e - d) < 0.05), 0.0)
        else:
            # a silence still running at the end has a start but no end
            value = length - starts[-1] if len(starts) > len(ends) else next((d for e, d in ends if abs(e - length) < 0.2), 0.0)
        _module_cache[key] = value
    return _module_cache[key]

# silences and drift in what the viewer received
print('\n== Viewer recordings')
def probe(args):
    return subprocess.run(['ffprobe', '-v', 'error', *args], capture_output=True, text=True).stdout
for f in sorted(glob.glob(f'{out}/viewer-*.flv')):
    if os.path.getsize(f) < 100_000:
        continue
    duration = float(probe(['-show_entries', 'format=duration', '-of', 'csv=p=0', f]) or 'nan')
    def last_ts(stream):
        ts = probe(['-select_streams', stream, '-read_intervals', f'{max(0, duration - 10)}%',
                    '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', f]).split()
        ts = [float(x.strip(',')) for x in ts if x.strip(',') not in ('', 'N/A')]
        return max(ts) if ts else float('nan')
    v, a = last_ts('v'), last_ts('a')
    born = os.stat(f).st_birthtime if hasattr(os.stat(f), 'st_birthtime') else float(subprocess.run(['stat', '-c', '%W', f], capture_output=True, text=True).stdout)
    r = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', f, '-vn', '-af', 'silencedetect=n=-50dB:d=0.5',
                        '-f', 'null', '-'], capture_output=True, text=True)
    sil = [(float(e) - float(d), float(d)) for e, d in re.findall(r'silence_end: ([\d.]+) \| silence_duration: ([\d.]+)', r.stderr)]
    print(f'{os.path.basename(f)}: {os.path.getsize(f)/1e9:.2f} GB, {duration/3600:.2f} h; '
          f'last video {v:.3f} s, last audio {a:.3f} s, A/V gap at the end {abs(v-a)*1000:.0f} ms')
    # a silence that starts or ends within 3 s of a song change may be ours; others are in the music
    near = [(t, d) for t, d in sil if any(abs(born + t - c) < 3 or abs(born + t + d - c) < 3 for c in change_times)]
    print(f'  {len(sil)} silences over 0.5 s, {len(sil) - len(near)} of them inside songs (in the music itself)')
    print(f'  {len(near)} near a song change; "extra" is what remains once the silence inside the modules is removed:')
    extras = []
    for t, d in near:
        # the song change closest to this silence, and the songs on both sides of it
        i = min(range(len(changes)), key=lambda k: abs(changes[k][0] - (born + t + d / 2)))
        before = changes[i - 1][1] if i > 0 else None
        after = changes[i][1]
        own = (module_silence(before, 'end') if before else 0) + module_silence(after, 'start')
        extra = max(0.0, d - own)
        extras.append(extra)
        if extra > 0.5:
            print(f'    {datetime.fromtimestamp(born + t):%H:%M:%S} ({t:9.1f} s in), {d:.2f} s, extra {extra:.2f} s: '
                  f'{os.path.basename(before or "-")} -> {os.path.basename(after)}')
    if extras:
        print(f'  extra silence at song changes: max {max(extras):.2f} s, '
              f'{sum(1 for e in extras if e > 0.5)} of {len(extras)} over 0.5 s')
