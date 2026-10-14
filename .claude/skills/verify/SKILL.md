---
name: verify
description: Run the full gate (lint, typecheck, test, build) and report honestly before calling a task done, then suggest the conventional commit message for the step. Use at the end of every step in docs/PLAN.md.
---

# Verify before done

No task counts as done until this passes. CI runs the same four on Ubuntu.

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Run them in that order and stop at the first failure — later stages hide earlier causes.

## Reporting
State the real outcome. If something fails, paste the failing output and say the step is
not done. Never describe a step as green on the strength of an unrun command, and never
skip a stage quietly — if a stage was skipped, say which and why.

A test that was changed to make it pass is a regression unless the expected value was
genuinely wrong. Explain which it was.

## Commit message
Suggest one conventional commit per step, matching `docs/PLAN.md`:

`feat:` behaviour the user can see · `fix:` a defect · `test:` tests only ·
`chore:` tooling and config · `docs:` README and specs

Subject in the imperative, under ~72 characters, no trailing period. End the message with:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

Commit only when the user asks.
