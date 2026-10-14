import { powerMonitor } from 'electron'
import type { InputCounter } from './tracker'

// How often the fallback asks whether the machine has been touched.
const IDLE_SAMPLE_MS = 5000

type Uiohook = {
  on: (event: 'mousedown', listener: () => void) => void
  off: (event: 'mousedown', listener: () => void) => void
  start: () => void
  stop: () => void
}

const createUiohookCounter = (hook: Uiohook): InputCounter => {
  let listener: (() => void) | null = null

  return {
    source: 'clicks',

    start: (onInput) => {
      if (listener !== null) return

      listener = () => onInput(Date.now())
      hook.on('mousedown', listener)
      hook.start()
    },

    // The native hook runs on its own thread, so it has to be stopped explicitly
    // on session stop as well as on quit.
    stop: () => {
      if (listener === null) return

      hook.off('mousedown', listener)
      listener = null
      try {
        hook.stop()
      } catch (error) {
        console.error(`Could not stop the click hook: ${describe(error)}`)
      }
    }
  }
}

// Counts intervals in which the machine was touched at all, which is presence
// rather than clicks. The UI labels it differently for that reason.
export const createIdleInputCounter = (sampleMs: number = IDLE_SAMPLE_MS): InputCounter => {
  let timer: NodeJS.Timeout | null = null

  return {
    source: 'idle',

    start: (onInput) => {
      if (timer !== null) return

      timer = setInterval(() => {
        // getSystemIdleTime is in seconds. Idle for less than one sample window
        // means there was input inside it.
        if (powerMonitor.getSystemIdleTime() * 1000 < sampleMs) onInput(Date.now())
      }, sampleMs)
    },

    stop: () => {
      if (timer === null) return

      clearInterval(timer)
      timer = null
    }
  }
}

// Prefers real click counts, falls back to idle sampling. The native module is
// probed here rather than on first use, so the renderer can be told which signal
// it is actually showing before a session starts.
export const createInputCounter = async (): Promise<InputCounter> => {
  try {
    const module: unknown = await import('uiohook-napi')
    const hook = (module as { uIOhook?: Uiohook }).uIOhook
    if (hook === undefined) throw new Error('uIOhook missing from the module')

    hook.start()
    hook.stop()

    return createUiohookCounter(hook)
  } catch (error) {
    console.error(
      `Global click hook unavailable, counting activity from idle time instead: ${describe(error)}`
    )
    return createIdleInputCounter()
  }
}

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : 'unknown error'
