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

## Environment notes

- `vite` is pinned to `^7`: `electron-vite@5` peers `vite ^5 || ^6 || ^7`, and npm now
  resolves `vite` to 8 by default, which fails `npm install` outright.
- The `electron` binary did not download during `npm install` on this machine. Fix:
  `node node_modules/electron/install.js`. `npm run build` and `npm test` work without
  it; `npm run dev` does not. Watch for the same thing in CI after `npm ci`.
