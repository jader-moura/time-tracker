// The contract between main and the renderer. Main implements it, preload exposes
// it, the renderer consumes it. Everything crossing the bridge is plain data.

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
  activitySource: ActivitySource
  intervalMs: number
}

export type WorkTrackerApi = {
  start: () => Promise<Status>
  stop: () => Promise<Status>
  status: () => Promise<Status>
  // Fetched only when lastShotAt changes, so the per-tick payload stays small.
  thumbnail: () => Promise<ShotView | null>
  // Returns the unsubscribe function, so the renderer can detach the listener.
  onChange: (listener: (status: Status) => void) => () => void
}

export const channels = {
  start: 'tracker:start',
  stop: 'tracker:stop',
  status: 'tracker:status',
  thumbnail: 'tracker:thumbnail',
  changed: 'tracker:changed'
} as const
