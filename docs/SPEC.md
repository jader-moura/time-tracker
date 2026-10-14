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
type Session = { id: string; startedAt: number; endedAt: number | null };
type Block = { sessionId: string; startedAt: number; clicks: number };
type Shot = { sessionId: string; takenAt: number; fileName: string };
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
- Primary display only. PNG, written straight to disk; the renderer never receives
  image bytes beyond the last thumbnail.
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
2. `idleInputCounter` — fallback when the native hook cannot install. It samples
   `powerMonitor.getSystemIdleTime()` on a fixed tick and counts *active samples*, not
   clicks. The UI must label the number as "activity" in this mode, because the units
   differ. Which implementation is live is part of the status main sends to the renderer.

## 4. Core API (pure, `src/core/`)

```ts
// time.ts
startOfLocalDay(ts: number): number;
startOfNextLocalDay(ts: number): number;      // local midnight after ts
formatDuration(ms: number): string;             // "01:02:03"

// session.ts
elapsedMs(session: Session, now: number): number;
overlapMs(session: Session, from: number, to: number, now: number): number;
totalForDay(sessions: Session[], dayStart: number, now: number): number;

// activity.ts
blockStartFor(ts: number, intervalMs: number): number;
addClick(blocks: Block[], sessionId: string, ts: number, intervalMs: number): Block[];
blocksForSession(blocks: Block[], sessionId: string): Block[];
totalClicks(blocks: Block[], sessionId: string): number;
blockSeries(blocks: Block[], sessionId: string, from: number, to: number, intervalMs: number): Block[];

// scheduler.ts
nextShotAt(startedAt: number, intervalMs: number, lastShotAt: number | null): number;
dueShotAt(startedAt: number, now: number, intervalMs: number, lastShotAt: number | null): number | null;
```

Time is always a parameter. No `Date.now()`, no Electron, no Node, no React in `core/`.

## 5. Acceptance tests (`core/`, concrete values, fake clock)

| Case | Expectation |
| --- | --- |
| start 09:00, interval 10 min | shots due at 09:10, 09:20, 09:30 |
| no shot at session start | `dueShotAt(09:00, 09:00, …)` is `null` |
| stop cancels | no further due times once `endedAt` is set |
| asleep past two boundaries | one shot fires, the skipped one is not backfilled |
| click 09:09:59.999 | block `09:00` |
| click 09:10:00.000 | block `09:10` |
| clicks in one block | counter increments, no second row |
| session 23:50→00:20 | 10 min on day 1, 20 min on day 2 |
| active session, now 09:30 | elapsed 30 min, today's total includes it |
| two sessions same day | totals add |
| `formatDuration(3723000)` | `"01:02:03"` |
| local day that springs forward | 23 h long, so a full day of tracking totals 23 h |
| local day that falls back | 25 h long |
| session covering a whole middle day | that day total is the full day |
| window end touched exactly | counts nothing, windows are half-open |
| clicks at UTC+05:45 | blocks stay on :00, :10, :20 of the wall clock |
| gap between recorded blocks | series fills it with zero, nothing is stored |
| addClick on existing blocks | input array is not mutated |

`main/` adapters are not unit tested — they are thin and verified by hand. The README
says so and lists the manual checks.

## 6. Deviations from CLAUDE.md worth knowing

1. **Windows is the dev machine.** `CLAUDE.md` documents macOS and Linux only. Windows
   needs no permission grants for either capability; noted in the README.
2. **The fallback is not a click count.** Idle-time sampling measures presence, so it is
   surfaced as "activity", with the active counter named in the status payload.
3. **Block alignment is anchored to local midnight**, not to the epoch, so the wall-clock
   examples in `CLAUDE.md` hold in every timezone.
