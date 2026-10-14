# Work Tracker

A small desktop app that tracks my own work sessions. Everything stays on this machine.

- Start and stop a work session, with elapsed time for the session and a running total
  for today
- Labels each session with the job you are working on, pre-filled with the last one used
- Counts mouse clicks per 10-minute block as a rough activity signal
- Takes a screenshot of the primary display every 10 minutes while a session runs
- Stores sessions, blocks and screenshots locally; nothing is uploaded anywhere

## Running it

Requires Node 22.

```bash
npm install
npm run dev
```

If `npm install` finishes but `npm run dev` cannot find Electron, the binary download was
skipped. Fetch it with `node node_modules/electron/install.js`.

| Command             | What it does                                  |
| ------------------- | --------------------------------------------- |
| `npm run dev`       | Run the app with hot reload                   |
| `npm run lint`      | ESLint                                        |
| `npm run typecheck` | `tsc --noEmit` for main, preload and renderer |
| `npm test`          | Vitest                                        |
| `npm run build`     | Build to `out/` (no installers)               |

CI runs lint, typecheck, test and build on Ubuntu for every push and pull request.

## Configuration

| Variable                 | Default  | Meaning                                              |
| ------------------------ | -------- | ---------------------------------------------------- |
| `SCREENSHOT_INTERVAL_MS` | `600000` | Capture interval, and the width of an activity block |

An invalid value — zero, negative, fractional, text — falls back to the default rather
than propagating as `Infinity` or `NaN` through the schedule.

Useful for trying it out without waiting ten minutes:

```bash
SCREENSHOT_INTERVAL_MS=15000 npm run dev
```

## Where the data lives

Under Electron's `userData` directory (`%APPDATA%\work-tracker` on Windows,
`~/Library/Application Support/work-tracker` on macOS,
`~/.config/work-tracker` on Linux):

```
work-tracker.json     sessions, activity blocks, screenshot index
screenshots/<ms>.png  one full-resolution PNG per capture
```

The JSON file is written to a temp file and renamed into place, so an interrupted write
cannot truncate it. Saves are serialised. Clicks are flushed at most every 10 seconds, so
a hard kill can lose up to 10 seconds of clicks; starting, stopping and each screenshot
flush immediately.

Screenshots and click counts are never logged and never leave the machine. The renderer
only ever receives a 320px-wide preview of the most recent capture, and only when it asks
for it.

## How it is put together

```
src/
  core/       pure TypeScript: session maths, activity blocks, scheduler, config parsing
  main/       Electron main: tracker service, storage, screenshots, input counter
  preload/    the contract between main and the renderer, fully typed
  renderer/   React UI, presentational only
```

`core/` is pure and deterministic: time arrives as a parameter, never read from the
clock. That is enforced by ESLint, not just by convention — `src/core/` cannot import
Electron, Node, React or a sibling layer, and `Date.now()` there is an error.

The renderer reaches main only through the preload bridge, with `contextIsolation: true`
and `nodeIntegration: false`. `src/preload/api.ts` is the single source of truth for the
shape of that bridge: main imports the types, preload implements them, the renderer
consumes them.

A single one-second tick drives the clock display, the screenshot schedule and the
periodic flush, so there is one timer to clean up and sleeping or waking needs no special
handling. Status pushed on that tick carries `lastShotAt`, not the image: the thumbnail is
around 61 kB and changes once every ten minutes, so pushing it every second would have
cost roughly 3.6 MB a minute and a PNG decode per tick.

## What is tested, and what is not

`npm test` covers everything that decides something, with a fake clock throughout:

- All of `core/` — session maths including sessions that span midnight, block boundaries,
  the capture schedule, interval parsing.
- `main/tracker.ts` and `main/storage.ts` — session lifecycle, click attribution, capture
  scheduling, crash recovery, atomic writes, malformed input. Neither imports Electron, so
  both run in plain Node with Vitest fake timers and a temp directory.

Not unit tested, because they are thin wrappers that need a real desktop:
`ScreenshotService` (`desktopCapturer`), `InputCounter` (`uiohook-napi`, `powerMonitor`),
and the window and IPC wiring in `main/index.ts`. These are covered by the manual checks
below, which were run against the built app.

### Manual checks

With `SCREENSHOT_INTERVAL_MS=15000` so captures are quick to see:

1. Type a job, then Start — the button becomes Stop, the Tracking badge appears, and the
   job field becomes a fixed label for the rest of the session.
2. The session clock and today's total both advance once a second.
3. Click inside the window a few times — the count rises and lands in the current block.
4. Wait one interval — a thumbnail appears with its timestamp, and a PNG shows up in
   `screenshots/`.
5. Stop — the badge disappears, the session clock resets, today's total is kept, and the
   job field is editable again, pre-filled with the job just used.
6. Reopen `work-tracker.json` — the session has an `endedAt`, and the blocks are there.
7. Close the window mid-session and reopen — the session was closed on quit rather than
   left open.
8. Launch the app a second time while it is running — the second one exits and focuses
   the window already open.
9. Open `work-tracker.json` in Notepad and save it — it still loads. Notepad adds a byte
   order mark, which an earlier version treated as corruption.

## Operating system notes

- **Windows**: works as is. No permission prompts for screen capture or global clicks, and
  `uiohook-napi` installs from a prebuilt binary, so no compiler is needed.
- **macOS**: needs Screen Recording permission for screenshots and Accessibility
  permission for global clicks, both under System Settings → Privacy & Security. Without
  Accessibility, the app falls back to idle-time sampling and says so.
- **Linux**: X11 works. Wayland blocks global input and screen capture, so clicks fall
  back to idle sampling and captures will fail. These are platform restrictions and are
  documented rather than worked around.

When the native click hook is unavailable, the fallback samples
`powerMonitor.getSystemIdleTime()` instead. That measures presence, not clicks, so the UI
labels it "Active samples" rather than "Clicks" — the number means something different and
should not be read as a click count.

## Known issues and limits

- The thumbnail is held in memory, so after a restart the preview is blank until the next
  capture, even though the PNG is already on disk.
- Block labels show hours and minutes, so an interval under a minute makes consecutive
  blocks look identically labelled. Only affects short intervals used for testing.
- The activity list shows the current session, so it empties when you stop.
- A session's job is fixed once started. Changing job means stopping and starting, which
  is what keeps every block and screenshot owned by exactly one job.
- `vitest` 3.2.7 carries three advisories via `tinypool` and `@vitest/mocker`. 3.2.7 is the
  newest 3.x and the fix is a major bump that pulls in `vite` 8, which breaks
  `electron-vite`'s peer range. It is a dev-only test runner and is never shipped, so it is
  pinned deliberately.

Deliberately out of scope: installers, code signing, auto-update, accounts, cloud sync,
export, reports, projects, tags, notes, keyboard counting, screenshot blurring or
retention policy, and multi-monitor selection.
