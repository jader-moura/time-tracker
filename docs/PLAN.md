# Build plan

Seven steps. Each ends green (`lint && typecheck && test && build`) and gets its own commit.

| # | Step | Deliverable | Commit |
| --- | --- | --- | --- |
| 1 | Scaffold | electron-vite + React + TS strict, ESLint/Prettier, Vitest, CI workflow, empty window | `chore: scaffold electron-vite app` |
| 2 | `core/time` + `core/session` | `startOfLocalDay`, `formatDuration`, elapsed, overlap, `totalForDay` + tests (midnight split) | `feat: add session math` |
| 3 | `core/activity` | block alignment, click accumulation + tests (boundary cases) | `feat: add activity blocks` |
| 4 | `core/scheduler` | due-time logic + tests (09:10/09:20/09:30, no backfill, cancel) | `feat: add screenshot scheduler` |
| 5 | Storage + tracker service | JSON load/save, `TrackerService` wiring core to timers, IPC + typed preload | `feat: add tracker service and storage` |
| 6 | Screenshots + input counter | `ScreenshotService`, `uiohookInputCounter`, `idleInputCounter` fallback | `feat: capture screenshots and count clicks` |
| 7 | UI + README | start/stop, timers, indicator, block list, thumbnail; README with OS notes and manual test list | `feat: add tracker UI` / `docs: add README` |

Order is core → main → renderer, per `CLAUDE.md`.

## Risks
- `uiohook-napi` native build on Windows. Time-boxed to ~10 minutes; past that we ship
  the idle fallback and say so in the README (`CLAUDE.md` rule).
- CI is Ubuntu and headless. `core/` tests must not touch Electron so `npm test` stays
  pure; `npm run build` is the only step that needs the Electron toolchain.
- Vitest runs with `TZ=UTC` pinned in config so date-sensitive tests are stable in CI.

## Status

- **Step 1 done.** Scaffold green on all four stages; the window opens and stays up.
  `core/time.ts` (`startOfLocalDay`, `formatDuration`) landed here rather than in step 2,
  because a scaffold with no test cannot show that the test runner works.
- Step 2 therefore starts at `core/session.ts`.
- **Step 2 done.** `core/session.ts` (`isActive`, `endOf`, `elapsedMs`, `overlapMs`,
  `totalForDay`) plus `startOfNextLocalDay`. 34 tests green.
  Day length is derived from local midnights, not from adding 24 hours, so days that
  cross a daylight-saving change stay correct; both directions are tested by swapping
  `process.env.TZ` to `America/New_York`.
- **Step 3 done.** `core/activity.ts` (`blockStartFor`, `addClick`, `blocksForSession`,
  `totalClicks`, `blockSeries`). 57 tests green.
  `blockSeries` zero-fills gaps so the UI gets a continuous series without empty blocks
  being stored. The local-midnight anchoring is pinned by a `Asia/Kathmandu` (UTC+05:45)
  test: it is the only case that distinguishes it from flooring the epoch, and it fails
  if the anchoring is dropped.
- **Step 4 done.** `core/scheduler.ts` (`nextShotAt`, `dueShotAt`, `msUntilNextShot`).
  78 tests green; `core/` is complete.
  These take a `ShotSchedule` record rather than the positional arguments the spec first
  sketched, so `endedAt` is part of the input and "stopping cancels pending shots"
  is a core test instead of behaviour that only exists in `main/`.
- Added `.gitattributes` (`* text=auto eol=lf`) to stop the CRLF warnings, since CI is Ubuntu.

## Environment notes

- `vite` is pinned to `^7`: `electron-vite@5` peers `vite ^5 || ^6 || ^7`, and npm now
  resolves `vite` to 8 by default, which fails `npm install` outright.
- The `electron` binary did not download during `npm install` on this machine. Fix:
  `node node_modules/electron/install.js`. `npm run build` and `npm test` work without
  it; `npm run dev` does not. Watch for the same thing in CI after `npm ci`.

## Carried into step 5

- `SCREENSHOT_INTERVAL_MS` must be validated where the env var is read. `core/` divides
  by `intervalMs`, so a `0` or unparseable value would yield `Infinity` or `NaN` and
  stall the schedule. Validation belongs at that boundary, not in `core/`.

- **Step 5 done.** `core/config.ts` (interval validation), `main/storage.ts`,
  `main/tracker.ts`, `main/adapters.ts` (placeholders for step 6), the preload bridge
  (`src/preload/api.ts` holds the contract both sides share) and the main wiring with
  quit cleanup. 106 tests green; the app boots clean.
  Two bugs were caught by driving the real code rather than by reading it:
  the status payload could report a click total that disagreed with the block list, and
  two overlapping saves raced on a single temp filename and lost a write.
  `tracker.ts` and `storage.ts` are now unit tested, which `CLAUDE.md` originally said
  `main/` would not be; that rule was written for thin adapters and these are not thin.

## Still open for step 6

- `lastShot` lives in memory, so the thumbnail is blank after a restart until the next
  capture. Reading the last PNG back from disk on load would close that.
- `nullInputCounter` reports `activitySource: 'none'`; the real counters replace it.
- `screenshotDirPath` is defined but unused until the capture service exists.

- **Step 6 done.** `main/screenshots.ts` (`desktopCapturer`, primary display) and
  `main/input.ts` (`uiohook-napi`, with the `powerMonitor` fallback). Placeholders gone.
  The native hook was the risk in this plan and it cost nothing: `uiohook-napi` ships
  prebuilt binaries including `win32-x64`, so the install took 2 seconds with no
  compiler. Verified in Electron with a throwaway probe: a 231 kB PNG on disk, a
  `data:image/png` thumbnail, `activitySource: 'clicks'`, and the hook attaching and
  detaching without throwing. The time-box was never reached.
  The probe also showed the thumbnail is about 61 kB, which the tick was about to push
  every second, so the image moved behind a `thumbnail()` call.

## Known issues

- `vitest@3.2.7` carries three advisories (one moderate, two critical) via `tinypool`
  and `@vitest/mocker`. 3.2.7 is the newest 3.x and the fix is a major bump, which would
  pull `vite` 8 and break the `electron-vite` peer range. It is a dev-only test runner,
  never shipped, so it is left pinned and recorded here rather than fixed by forcing the
  dependency tree apart.
- The thumbnail is held in memory, so after a restart the preview is blank until the
  next capture even though the PNG is on disk.
