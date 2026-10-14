# CLAUDE.md

Guidance for Claude when working in this repo. Read this before writing code.

## Project

**Work Tracker**: a small desktop app to track my own work sessions.

- Start / Stop a work session and see elapsed time (session and today)
- Count mouse clicks per 10-minute block as a simple activity signal
- Take a screenshot every 10 minutes while a session is running
- Everything stays local on this machine

This is a time-boxed take-home (~1 hour). Small, finished, and readable beats big and clever.

## Stack

- Electron via electron-vite (main / preload / renderer)
- React + TypeScript (strict) in the renderer
- Vitest for unit tests
- ESLint + Prettier
- GitHub Actions for CI

Do not suggest switching frameworks, adding a backend, or adding a database.

## Structure

```
src/
  core/       # pure TS: session math, activity buckets, scheduler. No Electron, no Node APIs, no React.
  main/       # Electron main process: tracker service, screenshots, input counter, storage
  preload/    # contextBridge: the only API the renderer can call, fully typed
  renderer/   # React UI, presentational
```

- `core/` must stay pure and deterministic. Time is injected (`now: () => number`), never read from `Date.now()` directly.
- `main/` adapts the OS to `core/`. Keep each adapter small and behind an interface:
  - `ScreenshotService` (uses `desktopCapturer`)
  - `InputCounter` (uses `uiohook-napi`; fallback: idle time via `powerMonitor.getSystemIdleTime()`)
  - `Storage` (JSON file + PNG folder under `app.getPath('userData')`)
- Renderer talks to main only through the preload API. `contextIsolation: true`, `nodeIntegration: false`.
- Co-locate tests: `scheduler.ts` -> `scheduler.test.ts`.

## Scope

**In scope**
- One active session at a time; start, stop, elapsed time
- Today's total across sessions
- Click count per 10-minute block for the current session
- Screenshot every 10 minutes while running (interval from `SCREENSHOT_INTERVAL_MS`, default 600000)
- Show last screenshot thumbnail and timestamp
- Persist sessions and blocks to a local JSON file
- Visible indicator while tracking

**Out of scope (do not implement unless asked)**
- Installers, code signing, notarization, auto-update
- Accounts, cloud sync, export, reports
- Projects, tags, notes, keyboard counting
- Screenshot blurring, deletion UI, retention policy
- Multi-monitor selection (capture the primary display)

## Rules

- **Ask before adding any runtime dependency.** `uiohook-napi` is pre-approved; nothing else.
- If the native click hook fails to install or needs more than ~10 minutes of fixing, stop and say so. We switch to the idle-time fallback instead of fighting it.
- TypeScript strict. No `any`, no `@ts-ignore`. Explicit return types on exported functions.
- Small pure functions with descriptive names.
- Never log or send screenshots or click data anywhere. Local disk only.
- Clean up timers and native hooks on stop and on app quit.
- Keep styling minimal: one CSS file, no UI library.
- Don't add features, config, or abstractions beyond what the task needs.

## Testing

- Unit tests for everything in `core/`. This is where coverage matters.
- Use a fake clock (injected `now`, or Vitest fake timers). Never depend on real time.
- Assert behavior with concrete values, not by recomputing the answer the way the code does. Examples:
  - starting at 09:00 with a 10-minute interval schedules shots at 09:10, 09:20, 09:30
  - a click at 09:09:59 lands in the 09:00 block; one at 09:10:00 lands in the 09:10 block
  - stopping a session cancels pending screenshots
  - a session spanning midnight splits correctly into each day's total
- `main/` adapters are not unit tested; they are thin and covered by manual testing. Say so in the README.
- No E2E tests.

## Commands

```bash
npm run dev        # run the app with hot reload
npm run lint       # eslint
npm run typecheck  # tsc --noEmit for main, preload, renderer
npm test           # vitest run
npm run build      # electron-vite build (no installers)
```

CI runs lint, typecheck, test, build on every push and PR (Ubuntu). All must pass before a task counts as done.

## OS notes

- macOS: needs Screen Recording (screenshots) and Accessibility (global clicks) permissions.
- Linux Wayland blocks global input and screen capture; X11 works.
- Document these in the README rather than working around them in code.

## How to work

1. For anything non-trivial, propose a short plan first and wait for approval.
2. Build `core/` with tests first, then the `main/` adapters, then the UI.
3. Work in small steps that each leave the build green.
4. Run `npm run lint && npm run typecheck && npm test` before saying a task is done.
5. Suggest a concise conventional commit message (`feat:`, `fix:`, `test:`, `chore:`, `docs:`) per step.
6. If something in this file seems wrong for the task, say so instead of silently working around it.