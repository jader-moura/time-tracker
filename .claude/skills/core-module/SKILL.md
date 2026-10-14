---
name: core-module
description: Add or change a pure module in src/core/ with co-located Vitest tests. Use whenever work touches session math, activity blocks, the screenshot scheduler, or any other logic that must stay free of Electron, Node, and React.
---

# Adding a core module

`src/core/` is the only tested layer. Keep it pure.

## Rules
1. No imports from `electron`, `node:*`, `react`, or anything in `main/`, `preload/`,
   `renderer/`. Only other `core/` modules.
2. Time enters as a parameter (`now: number`) or an injected `now: () => number`.
   Never call `Date.now()`. `new Date(ts)` for calendar math is fine — the timestamp
   is still an argument.
3. Exported functions get explicit return types. No `any`, no `@ts-ignore`.
4. Small named functions over clever ones. If a function needs a comment to explain
   *what* it does, rename it instead.
5. No new runtime dependency without asking the user first.

## Test file
Co-locate: `scheduler.ts` → `scheduler.test.ts`.

Assert concrete values. Never recompute the expected answer with the same arithmetic the
implementation uses — that test passes even when the formula is wrong.

```ts
// good
expect(blockStartFor(at('09:09:59.999'), TEN_MIN)).toBe(at('09:00'));
// bad
expect(blockStartFor(ts, TEN_MIN)).toBe(Math.floor(ts / TEN_MIN) * TEN_MIN);
```

Build timestamps from readable helpers (`at('09:10')`), and cover the boundary on both
sides: the last millisecond before it and the first millisecond on it.

## Done when
`npm run lint && npm run typecheck && npm test` all pass, and the new behaviour appears
in the acceptance table in `docs/SPEC.md` (add a row if it is missing).
