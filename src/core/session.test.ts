import { describe, expect, it } from 'vitest'
import { elapsedMs, endOf, isActive, overlapMs, totalForDay } from './session'
import type { Session } from './session'
import { startOfLocalDay } from './time'

// Tests run with TZ=UTC (pinned in vitest.config.ts), so local time is UTC here.
const at = (iso: string): number => Date.parse(iso)

const finished = (startedAt: string, endedAt: string): Session => ({
  id: 's1',
  startedAt: at(startedAt),
  endedAt: at(endedAt)
})

const active = (startedAt: string): Session => ({
  id: 's2',
  startedAt: at(startedAt),
  endedAt: null
})

describe('isActive', () => {
  it('is true while the session has no end', () => {
    expect(isActive(active('2026-01-15T09:00:00Z'))).toBe(true)
  })

  it('is false once the session has ended', () => {
    expect(isActive(finished('2026-01-15T09:00:00Z', '2026-01-15T09:30:00Z'))).toBe(false)
  })
})

describe('endOf', () => {
  it('uses the recorded end for a finished session', () => {
    const session = finished('2026-01-15T09:00:00Z', '2026-01-15T09:30:00Z')
    expect(endOf(session, at('2026-01-15T11:00:00Z'))).toBe(at('2026-01-15T09:30:00Z'))
  })

  it('uses now for an active session', () => {
    expect(endOf(active('2026-01-15T09:00:00Z'), at('2026-01-15T09:30:00Z'))).toBe(
      at('2026-01-15T09:30:00Z')
    )
  })
})

describe('elapsedMs', () => {
  it('measures a finished session', () => {
    const session = finished('2026-01-15T09:00:00Z', '2026-01-15T09:30:00Z')
    expect(elapsedMs(session, at('2026-01-15T23:00:00Z'))).toBe(1800000)
  })

  it('measures an active session up to now', () => {
    expect(elapsedMs(active('2026-01-15T09:00:00Z'), at('2026-01-15T09:30:00Z'))).toBe(1800000)
  })

  it('is zero at the moment of starting', () => {
    expect(elapsedMs(active('2026-01-15T09:00:00Z'), at('2026-01-15T09:00:00Z'))).toBe(0)
  })

  it('clamps to zero when now precedes the start', () => {
    expect(elapsedMs(active('2026-01-15T09:00:00Z'), at('2026-01-15T08:00:00Z'))).toBe(0)
  })
})

describe('overlapMs', () => {
  const now = at('2026-01-15T23:00:00Z')

  it('counts a session wholly inside the window', () => {
    const session = finished('2026-01-15T09:00:00Z', '2026-01-15T09:30:00Z')
    expect(overlapMs(session, at('2026-01-15T08:00:00Z'), at('2026-01-15T10:00:00Z'), now)).toBe(
      1800000
    )
  })

  it('counts only the part inside when the session starts earlier', () => {
    const session = finished('2026-01-15T08:00:00Z', '2026-01-15T09:30:00Z')
    expect(overlapMs(session, at('2026-01-15T09:00:00Z'), at('2026-01-15T10:00:00Z'), now)).toBe(
      1800000
    )
  })

  it('counts only the part inside when the session ends later', () => {
    const session = finished('2026-01-15T09:00:00Z', '2026-01-15T11:00:00Z')
    expect(overlapMs(session, at('2026-01-15T08:00:00Z'), at('2026-01-15T09:45:00Z'), now)).toBe(
      2700000
    )
  })

  it('is zero for a session entirely before the window', () => {
    const session = finished('2026-01-15T07:00:00Z', '2026-01-15T08:00:00Z')
    expect(overlapMs(session, at('2026-01-15T09:00:00Z'), at('2026-01-15T10:00:00Z'), now)).toBe(0)
  })

  it('is zero for a session entirely after the window', () => {
    const session = finished('2026-01-15T11:00:00Z', '2026-01-15T12:00:00Z')
    expect(overlapMs(session, at('2026-01-15T09:00:00Z'), at('2026-01-15T10:00:00Z'), now)).toBe(0)
  })

  it('excludes the window end, so touching it counts nothing', () => {
    const session = finished('2026-01-15T10:00:00Z', '2026-01-15T11:00:00Z')
    expect(overlapMs(session, at('2026-01-15T09:00:00Z'), at('2026-01-15T10:00:00Z'), now)).toBe(0)
  })
})

describe('totalForDay', () => {
  const day = (iso: string): number => startOfLocalDay(at(iso))

  it('splits a session that spans midnight across both days', () => {
    const overnight = [finished('2026-01-15T23:50:00Z', '2026-01-16T00:20:00Z')]
    const now = at('2026-01-16T09:00:00Z')

    expect(totalForDay(overnight, day('2026-01-15T12:00:00Z'), now)).toBe(600000)
    expect(totalForDay(overnight, day('2026-01-16T12:00:00Z'), now)).toBe(1200000)
  })

  it('adds up several sessions on the same day', () => {
    const sessions = [
      finished('2026-01-15T09:00:00Z', '2026-01-15T09:30:00Z'),
      finished('2026-01-15T10:00:00Z', '2026-01-15T10:15:00Z')
    ]
    expect(totalForDay(sessions, day('2026-01-15T12:00:00Z'), at('2026-01-15T23:00:00Z'))).toBe(
      2700000
    )
  })

  it('counts an active session up to now', () => {
    const sessions = [
      finished('2026-01-15T09:00:00Z', '2026-01-15T09:30:00Z'),
      active('2026-01-15T10:00:00Z')
    ]
    expect(totalForDay(sessions, day('2026-01-15T12:00:00Z'), at('2026-01-15T10:10:00Z'))).toBe(
      2400000
    )
  })

  it('ignores sessions from other days', () => {
    const sessions = [finished('2026-01-14T09:00:00Z', '2026-01-14T17:00:00Z')]
    expect(totalForDay(sessions, day('2026-01-15T12:00:00Z'), at('2026-01-15T23:00:00Z'))).toBe(0)
  })

  it('is zero with no sessions', () => {
    expect(totalForDay([], day('2026-01-15T12:00:00Z'), at('2026-01-15T23:00:00Z'))).toBe(0)
  })

  it('counts a three-day session as a full middle day', () => {
    const sessions = [finished('2026-01-14T22:00:00Z', '2026-01-16T02:00:00Z')]
    expect(totalForDay(sessions, day('2026-01-15T12:00:00Z'), at('2026-01-16T09:00:00Z'))).toBe(
      86400000
    )
  })
})
