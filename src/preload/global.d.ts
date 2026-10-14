import type { WorkTrackerApi } from './api'

declare global {
  interface Window {
    workTracker: WorkTrackerApi
  }
}
