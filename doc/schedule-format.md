# Schedule file format

The `schedule` command reads a JSON file that defines named programs:

```bash
npm run dev -- schedule -c schedule.json
```

See [`schedule.example.json`](../schedule.example.json) for a complete example. The format is checked at startup by `ScheduleConfigSchema` (`src/libs/vlc-control/program-definition.ts`); an invalid file stops the command with an error.

## Programs

```json
{ "programs": { "<name>": { "cron": "<cron expression>", "entries": [ ... ] } } }
```

| Field | Default | Meaning |
|---|---|---|
| `entries` | (required) | Played in order. All entries are resolved into one playlist when the program starts. |
| `cron` | `""` | When to start the program. Empty means the program is the **default program**. |

- **Default program** (no `cron`): starts when the scheduler starts and loops forever. If several programs have no `cron`, the last one is used and a warning is logged.
- **Scheduled program** (with `cron`): at each cron time, it interrupts the default program, plays once, then the default program starts again from the beginning. If a scheduled program is already playing, the new cron event is skipped.
- Cron syntax is [node-cron](https://github.com/node-cron/node-cron): 5 fields (`min hour day month weekday`), or 6 with seconds first. Invalid expressions are skipped with a warning.

## Entries

| `type` | Fields | Resolves to |
|---|---|---|
| `song` | `location` | One file. |
| `folder` | `location`, `shuffle` (default `false`), `limit` (default no limit), `recursive` (default `false`) | Files with a song extension (`mod`, `s3m`, `stm`, `xm`, `it`, `mid`, `mp3`). `shuffle` is applied before `limit`. |
| `program` | `name` | The entries of another program. |

A `program` entry can only reference a program written **earlier** in the file; otherwise the scheduler stops with `Program "<name>" not found in library`.

Relative `location` paths are resolved from the directory where the command is started.

## Failures

- If the default program fails (missing folder, no playable file, VLC unreachable), it is retried after 1 s, 2 s, 5 s, 10 s, then every 30 s.
- If a scheduled program fails, the error is logged and the default program starts again.
