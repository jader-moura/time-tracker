import type { InputCounter, ScreenshotService } from './tracker'

// Placeholders until step 6 of docs/PLAN.md. They satisfy the interfaces so the
// tracker service is complete and runnable, and report themselves honestly.

export const nullScreenshotService: ScreenshotService = {
  capture: () => Promise.reject(new Error('screenshot service not installed yet'))
}

export const nullInputCounter: InputCounter = {
  source: 'none',
  start: () => undefined,
  stop: () => undefined
}
