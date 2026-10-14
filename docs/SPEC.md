# Work Tracker — Spec

Derived from `CLAUDE.md`. This is the contract the code and tests implement.
Anything not listed here is out of scope.

## 1. Vocabulary

- **Session** — one continuous tracked stretch. At most one is active at a time.
- **Interval** — `SCREENSHOT_INTERVAL_MS`, default `600000` (10 min). Used for both
  screenshot cadence and activity block width.
- **Block** — an interval-wide bucket that holds a click count.
- **Day** — a local calendar day, from local midnight to local midnight.

## 2. Data model

```ts
type Session = { id: string; startedAt: number; endedAt: number | null; job: string }
type Block = { sessionId: string; startedAt: number; clicks: number }
type Shot = { sessionId: string; takenAt: number; fileName: string }
```

Persisted as one JSON file under `app.getPath('userData')`:

```jsonc
{ "version": 1, "sessions": [], "blocks": [], "shots": [] }
```

PNGs live in `<userData>/screenshots/<takenAt>.png`. `fileName` is the basename only,
so the folder can move.

## 3. Behaviour

### 3.1 Session

- `start` when idle: creates a session with `startedAt = now`, `endedAt = null`.
- `start` when a session is active: no-op (the UI disables the button).
- `stop` when active: sets `endedAt = now`, flushes state to disk, cancels pending
  screenshots, releases the input hook.
- `stop` when idle: no-op.
- App quit with an active session: stop it first (`endedAt = now`), then quit.
- Session elapsed = `(endedAt ?? now) - startedAt`.

### 3.1a Jobs

What you are working on, recorded against the session.

- A job is free text. There is no job list, no management UI, and no validation beyond
  normalising the text: trim the ends, collapse internal whitespace runs, cap at 80
  characters.
- It is set when the session starts and is fixed for that session's lifetime. Changing
  job means stopping and starting again, which keeps one-active-session-at-a-time intact
  and keeps every block and screenshot unambiguously owned by one job.
- An empty job is allowed and means untitled. Tracking time is the point; labelling it
  is optional and must never block Start.
- The field pre-fills with the job of the most recently started session, because the
  common case is carrying on with the same work.

**Migration.** Sessions written before this feature have no `job` field. They load as
untitled rather than being discarded: the storage guard treats a missing `job` as `''`.
Requiring the field would have silently dropped every existing session on first load.

### 3.1b History

The last 7 calendar days, newest first, each with a total and a per-job split.

- A day with no tracked time is left out rather than shown as zero.
- A session is credited to each day it touches, by the part it spent there, so one that
  runs past midnight appears on both days and is not double counted.
- Within a day, jobs are ordered longest first, then by name so the order is stable.
- Untitled work keeps its empty job name in the data; the UI labels it.
- Stepping back a day means the previous local midnight, not 24 hours earlier. On a
  daylight-saving boundary, subtracting 24 hours lands in the wrong day and merges two
  days into one row.
- Fetched on demand, not pushed with the tick: it changes far more slowly than the clock.

### 3.2 Today's total

Sum over all sessions of the overlap between the session and today's local-midnight
window. A session that spans midnight contributes to each day separately:
`23:50 → 00:20` gives 10 min to the first day and 20 min to the second.
An active session counts up to `now`.

### 3.3 Activity blocks

- Block boundaries are multiples of the interval measured **from local midnight**, so
  a 10-minute interval produces `…09:00, 09:10, 09:20…` on the wall clock regardless of
  timezone offset.
- Boundaries are half-open `[start, start + interval)`: a click at `09:09:59.999` lands
  in the `09:00` block, a click at `09:10:00.000` lands in the `09:10` block.
- Clicks are only counted while a session is active, and are attributed to that session.
- A block row is created on its first click; empty blocks are not stored but are rendered
  as zero.

### 3.4 Screenshots

- While a session runs, a shot is due at `startedAt + n * interval` for `n = 1, 2, 3…`.
  No shot at `startedAt` itself.
- Primary display only. The full-resolution PNG goes straight to disk. The renderer
  gets a 320px-wide thumbnail, and only when it asks: `Status` carries `lastShotAt`,
  and `thumbnail()` returns the image. Pushing the image with every tick would have
  meant about 61 kB a second over the bridge and a PNG decode per tick in the UI.
- Stopping cancels every pending shot. A due time that passed while the machine was
  asleep is skipped, not backfilled — at most one shot per tick.
- A capture failure is logged (message only, never image data) and the schedule continues.

### 3.5 UI

Single window, one CSS file:

- Start / Stop button reflecting the real state.
- Session elapsed and today's total, both `HH:MM:SS`, ticking each second.
- A visible "tracking" indicator while active.
- Clicks for the current session, per block.
- Last screenshot thumbnail and its timestamp.
- The renderer holds no business logic; it renders what main sends.

### 3.6 Click counting and its fallback

`InputCounter` is an interface with two implementations:

1. `uiohookInputCounter` — real mouse-click counts via `uiohook-napi`.
2. `idleInputCounter` - fallback when the native hook cannot install. On Windows the
   native hook loads from a prebuilt binary and needs no compiler, so this is the
   path for Wayland and for macOS without Accessibility permission. It samples
   `powerMonitor.getSystemIdleTime()` on a fixed tick and counts _active samples_, not
   clicks. The UI must label the number as "activity" in this mode, because the units
   differ. Which implementation is live is part of the status main sends to the renderer.

## 4. Core API (pure, `src/core/`)

```ts
// time.ts
startOfLocalDay(ts: number): number;
startOfNextLocalDay(ts: number): number;      // local midnight after ts
formatDuration(ms: number): string;             // "01:02:03"

// session.ts
normaliseJob(raw: string): string;
lastUsedJob(sessions: Session[]): string;
elapsedMs(session: Session, now: number): number;
overlapMs(session: Session, from: number, to: number, now: number): number;
totalForDay(sessions: Session[], dayStart: number, now: number): number;

// activity.ts
blockStartFor(ts: number, intervalMs: number): number;
addClick(blocks: Block[], sessionId: string, ts: number, intervalMs: number): Block[];
blocksForSession(blocks: Block[], sessionId: string): Block[];
totalClicks(blocks: Block[], sessionId: string): number;
blockSeries(blocks: Block[], sessionId: string, from: number, to: number, intervalMs: number): Block[];

// history.ts
type JobTotal = { job; totalMs };
type DayTotal = { dayStart; totalMs; jobs };

totalsByJobForDay(sessions: Session[], dayStart: number, now: number): JobTotal[];
recentDays(sessions: Session[], now: number, dayCount: number): DayTotal[];

// scheduler.ts
type ShotSchedule = { startedAt; endedAt; intervalMs; lastShotAt };

nextShotAt(schedule: ShotSchedule): number | null;
dueShotAt(schedule: ShotSchedule, now: number): number | null;
msUntilNextShot(schedule: ShotSchedule, now: number): number | null;
```

Time is always a parameter. No `Date.now()`, no Electron, no Node, no React in `core/`.

## 5. Acceptance tests (`core/`, concrete values, fake clock)

| Case                                | Expectation                                        |
| ----------------------------------- | -------------------------------------------------- |
| start 09:00, interval 10 min        | shots due at 09:10, 09:20, 09:30                   |
| no shot at session start            | `dueShotAt(09:00, 09:00, …)` is `null`             |
| stop cancels                        | no further due times once `endedAt` is set         |
| asleep past two boundaries          | one shot fires, the skipped one is not backfilled  |
| click 09:09:59.999                  | block `09:00`                                      |
| click 09:10:00.000                  | block `09:10`                                      |
| clicks in one block                 | counter increments, no second row                  |
| session 23:50→00:20                 | 10 min on day 1, 20 min on day 2                   |
| active session, now 09:30           | elapsed 30 min, today's total includes it          |
| two sessions same day               | totals add                                         |
| `formatDuration(3723000)`           | `"01:02:03"`                                       |
| local day that springs forward      | 23 h long, so a full day of tracking totals 23 h   |
| local day that falls back           | 25 h long                                          |
| session covering a whole middle day | that day total is the full day                     |
| window end touched exactly          | counts nothing, windows are half-open              |
| clicks at UTC+05:45                 | blocks stay on :00, :10, :20 of the wall clock     |
| gap between recorded blocks         | series fills it with zero, nothing is stored       |
| addClick on existing blocks         | input array is not mutated                         |
| job `  invoice   migration  `       | stored as `invoice migration`                      |
| job of 200 characters               | capped at 80                                       |
| session row with no `job` field     | loads as untitled, is not discarded                |
| last used job                       | taken from the latest `startedAt`, not array order |
| job running 23:30 to 00:45          | 30 min on the first day, 45 min on the second      |
| day with no sessions                | left out of the history list                       |
| day after the clocks go forward     | the previous row is the previous calendar day      |
| two jobs with equal totals          | ordered by name, so the list does not jitter       |
| session stopped mid-schedule        | nextShotAt and msUntilNextShot are both null       |
| woken after two missed due times    | the latest is owed, the earlier is dropped         |

## 5a. What in `main/` is tested

The original rule was that nothing in `main/` is tested because it is all thin adapters.
That holds for the parts that only wrap an OS call, and not for the two that carry logic:

- **Tested** (`main/tracker.test.ts`, no Electron imported): `tracker.ts` — session
  lifecycle, click attribution, capture scheduling, crash recovery, failure handling —
  and `storage.ts` — atomic writes, quarantine, row validation.
- **Not tested, manual only**: `ScreenshotService` (`desktopCapturer`), `InputCounter`
  (`uiohook-napi`, `powerMonitor`), and the window/IPC wiring in `index.ts`. These are
  genuinely thin and need a real desktop. The README lists the manual checks.

The line is whether a file decides anything. The first version of the tracker shipped a
bug the compiler accepted — the block list and the click total could disagree — so the
decisions get tests.

## 5b. Durability rules

- Saves are serialised and each write uses its own temp file. Two overlapping saves
  otherwise share one temp name and the second rename fails.
- Clicks are flushed at most every 10 s, so a hard kill can lose up to 10 s of clicks.
  Session start, session stop and each screenshot flush immediately.
- A session found still open at startup was left by a crash. It is closed at its own
  `startedAt` rather than being credited the time the machine was off.
- A leading byte order mark is stripped before parsing. Notepad and PowerShell both
  write UTF-8 with a BOM, and `JSON.parse` throws on it, so without this a file saved
  from an editor is quarantined and the app starts with no history.
- Only one instance may run. Two would both own the file and the last writer would win,
  discarding the other's sessions. A second launch focuses the first window and exits.
- A capture failure is remembered in memory only, so the next tick does not retry it in
  a loop, and the schedule resumes at the following due time.

## 6. Deviations from CLAUDE.md worth knowing

1. **Windows is the dev machine.** `CLAUDE.md` documents macOS and Linux only. Windows
   needs no permission grants for either capability; noted in the README.
2. **The fallback is not a click count.** Idle-time sampling measures presence, so it is
   surfaced as "activity", with the active counter named in the status payload.
3. **Block alignment is anchored to local midnight**, not to the epoch, so the wall-clock
   examples in `CLAUDE.md` hold in every timezone.
