// The contract between main and the renderer. Main implements it, preload exposes
// it, the renderer consumes it. Everything crossing the bridge is plain data.

import type { DayTotal } from '../core/history'

// Re-exported so the renderer has one place to import the bridge's types from.
export type { DayTotal, JobTotal } from '../core/history'

export type ActivitySource = 'clicks' | 'idle' | 'none'

export type BlockView = {
  startedAt: number
  clicks: number
}

export type ShotView = {
  takenAt: number
  dataUrl: string
}

export type Status = {
  isTracking: boolean
  sessionStartedAt: number | null
  sessionElapsedMs: number
  todayTotalMs: number
  blocks: BlockView[]
  totalClicks: number
  lastShotAt: number | null
  job: string
  // The job to offer next time, carried so the input can pre-fill while idle.
  lastJob: string
  activitySource: ActivitySource
  intervalMs: number
}

export type WorkTrackerApi = {
  start: (job: string) => Promise<Status>
  stop: () => Promise<Status>
  status: () => Promise<Status>
  // Fetched only when lastShotAt changes, so the per-tick payload stays small.
  thumbnail: () => Promise<ShotView | null>
  // Fetched on demand rather than pushed, since it changes far slower than the tick.
  history: () => Promise<DayTotal[]>
  // Returns the unsubscribe function, so the renderer can detach the listener.
  onChange: (listener: (status: Status) => void) => () => void
}

export const channels = {
  start: 'tracker:start',
  stop: 'tracker:stop',
  status: 'tracker:status',
  thumbnail: 'tracker:thumbnail',
  history: 'tracker:history',
  changed: 'tracker:changed'
} as const
