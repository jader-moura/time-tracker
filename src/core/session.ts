import { startOfNextLocalDay } from './time'

export type Session = {
  id: string
  startedAt: number
  endedAt: number | null
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
