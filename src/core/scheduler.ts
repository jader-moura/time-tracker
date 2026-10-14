export type ShotSchedule = {
  startedAt: number
  endedAt: number | null
  intervalMs: number
  lastShotAt: number | null
}

// Shots land on startedAt + n * intervalMs for n >= 1, so there is no capture at
// the moment the session starts.
const shotIndexAt = (schedule: ShotSchedule, ts: number): number =>
  Math.floor((ts - schedule.startedAt) / schedule.intervalMs)

// The next scheduled time after the last shot taken, or null once the session has
// stopped: stopping cancels everything still pending.
export const nextShotAt = (schedule: ShotSchedule): number | null => {
  if (schedule.endedAt !== null) return null

  const since = schedule.lastShotAt ?? schedule.startedAt
  return schedule.startedAt + (shotIndexAt(schedule, since) + 1) * schedule.intervalMs
}

// The shot to take right now, or null if none is owed yet.
//
// When several due times have passed - the machine slept through them - this
// returns only the most recent one. The missed captures are dropped rather than
// fired as a burst on wake, so a tick can never owe more than one screenshot.
export const dueShotAt = (schedule: ShotSchedule, now: number): number | null => {
  const next = nextShotAt(schedule)
  if (next === null || next > now) return null

  return schedule.startedAt + shotIndexAt(schedule, now) * schedule.intervalMs
}

// How long to wait before polling again. Zero when a shot is already owed, null
// once the session has stopped and the timer should be cleared.
export const msUntilNextShot = (schedule: ShotSchedule, now: number): number | null => {
  const next = nextShotAt(schedule)
  if (next === null) return null

  return Math.max(0, next - now)
}
