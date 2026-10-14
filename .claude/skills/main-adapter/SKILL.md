---
name: main-adapter
description: Add or change an Electron main-process adapter (ScreenshotService, InputCounter, Storage, tracker service, IPC, preload API). Use for anything that touches the OS, the filesystem, timers, native hooks, or the renderer bridge.
---

# Adding a main-process adapter

`src/main/` adapts the OS to `src/core/`. Adapters stay thin: they carry no business
logic, so they need no unit tests — they are covered by the manual checks in the README.

## Shape
Declare the interface first, in terms `core/` could consume, then implement it:

```ts
export interface ScreenshotService {
  capture(takenAt: number): Promise<string>; // resolves to the file name
}
```

One adapter per concern. If an adapter starts making decisions about *when* or *whether*,
that decision belongs in `core/`.

## Rules
1. Every timer and native hook is released on stop **and** on app quit. A `stop()` that
   leaves an interval running is a bug.
2. `contextIsolation: true`, `nodeIntegration: false`. The renderer reaches main only
   through the typed `contextBridge` API in `src/preload/`.
3. IPC payloads are plain serialisable data with a declared type shared by preload and
   renderer. No functions, no `Buffer`s, no node handles across the bridge.
4. Screenshots and click data go to local disk and nowhere else. Never log image bytes,
   never log a click stream, never send either anywhere.
5. Writes go through `Storage` under `app.getPath('userData')`. Write the JSON file
   atomically (temp file, then rename) so a crash mid-write cannot truncate it.
6. A failing adapter degrades, it does not crash the app: log the message, keep tracking.
7. `uiohook-napi` is the only pre-approved runtime dependency. Ask before any other.
   If the native hook costs more than ~10 minutes, stop and switch to the
   `powerMonitor.getSystemIdleTime()` fallback — say so rather than fighting it.

## Done when
`npm run lint && npm run typecheck && npm test && npm run build` pass, and the manual
check for the new adapter is listed in the README.
