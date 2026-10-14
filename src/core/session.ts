import { startOfNextLocalDay } from './time'

export type Session = {
  id: string
  startedAt: number
  endedAt: number | null
  job: string
}

export const isActive = (session: Session): boolean => session.endedAt === null

// An active session is treated as running up to now.
export const endOf = (session: Session, now: number): number => session.endedAt ?? now

export const elapsedMs = (session: Session, now: number): number =>
  Math.max(0, endOf(session, now) - session.startedAt)

// Milliseconds the session spent inside the half-open window [from, to).
export const overlapMs = (session: Session, from: number, to: number, now: number): number => {
  const start = Math.max(session.startedAt, from)
  const end = Math.min(endOf(session, now), to)
  return Math.max(0, end - start)
}

export const totalForDay = (sessions: Session[], dayStart: number, now: number): number => {
  const dayEnd = startOfNextLocalDay(dayStart)
  return sessions.reduce((total, session) => total + overlapMs(session, dayStart, dayEnd, now), 0)
}

// Jobs are free text, so the only rules are cosmetic: no leading or trailing
// space, no runs of internal whitespace, and a length that cannot break the UI.
// Empty is allowed and means untitled - labelling work must never block starting it.
const MAX_JOB_LENGTH = 80

export const normaliseJob = (raw: string): string =>
  raw.replace(/\s+/g, ' ').trim().slice(0, MAX_JOB_LENGTH)

// The job to offer next, which is whatever was started most recently. Ordered by
// startedAt rather than by position, since storage order is not guaranteed.
export const lastUsedJob = (sessions: Session[]): string => {
  const latest = sessions.reduce<Session | null>(
    (newest, session) =>
      newest === null || session.startedAt > newest.startedAt ? session : newest,
    null
  )

  return latest?.job ?? ''
}
