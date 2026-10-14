import { overlapMs } from './session'
import type { Session } from './session'
import { startOfLocalDay, startOfNextLocalDay } from './time'

export type JobTotal = {
  job: string
  totalMs: number
}

export type DayTotal = {
  dayStart: number
  totalMs: number
  jobs: JobTotal[]
}

// Time spent per job inside one local day. A session is credited to each day it
// touches, so one that runs past midnight is split rather than counted twice.
// Untitled work keeps its empty job name; labelling it is the UI's business.
export const totalsByJobForDay = (
  sessions: Session[],
  dayStart: number,
  now: number
): JobTotal[] => {
  const dayEnd = startOfNextLocalDay(dayStart)
  const byJob = new Map<string, number>()

  for (const session of sessions) {
    const ms = overlapMs(session, dayStart, dayEnd, now)
    if (ms === 0) continue

    byJob.set(session.job, (byJob.get(session.job) ?? 0) + ms)
  }

  return [...byJob.entries()]
    .map(([job, totalMs]) => ({ job, totalMs }))
    .sort((a, b) => b.totalMs - a.totalMs || a.job.localeCompare(b.job))
}

// The local midnight before this one. Stepping back a millisecond and flooring
// again is daylight-saving safe, unlike subtracting 24 hours.
const previousDayStart = (dayStart: number): number => startOfLocalDay(dayStart - 1)

// The most recent days that have any tracked time, newest first, looking back
// dayCount calendar days. Empty days are left out rather than padding the list.
export const recentDays = (sessions: Session[], now: number, dayCount: number): DayTotal[] => {
  const days: DayTotal[] = []
  let dayStart = startOfLocalDay(now)

  for (let index = 0; index < dayCount; index += 1) {
    const jobs = totalsByJobForDay(sessions, dayStart, now)
    const totalMs = jobs.reduce((sum, entry) => sum + entry.totalMs, 0)

    if (totalMs > 0) days.push({ dayStart, totalMs, jobs })

    dayStart = previousDayStart(dayStart)
  }

  return days
}
