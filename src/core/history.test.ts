import { describe, expect, it } from 'vitest'
import { recentDays, totalsByJobForDay } from './history'
import type { Session } from './session'
import { startOfLocalDay } from './time'

// Tests run with TZ=UTC (pinned in vitest.config.ts), so local time is UTC here.
const at = (iso: string): number => Date.parse(iso)
const day = (iso: string): number => startOfLocalDay(at(iso))

let nextId = 0
const session = (job: string, startedAt: string, endedAt: string | null): Session => ({
  id: `s${(nextId += 1)}`,
  startedAt: at(startedAt),
  endedAt: endedAt === null ? null : at(endedAt),
  job
})

describe('totalsByJobForDay', () => {
  const now = at('2026-01-15T23:00:00Z')

  it('is empty with no sessions', () => {
    expect(totalsByJobForDay([], day('2026-01-15T12:00:00Z'), now)).toEqual([])
  })

  it('totals one job', () => {
    const sessions = [session('invoice', '2026-01-15T09:00:00Z', '2026-01-15T09:30:00Z')]

    expect(totalsByJobForDay(sessions, day('2026-01-15T12:00:00Z'), now)).toEqual([
      { job: 'invoice', totalMs: 1800000 }
    ])
  })

  it('adds up separate sessions on the same job', () => {
    const sessions = [
      session('invoice', '2026-01-15T09:00:00Z', '2026-01-15T09:30:00Z'),
      session('invoice', '2026-01-15T14:00:00Z', '2026-01-15T14:15:00Z')
    ]

    expect(totalsByJobForDay(sessions, day('2026-01-15T12:00:00Z'), now)).toEqual([
      { job: 'invoice', totalMs: 2700000 }
    ])
  })

  it('keeps jobs apart and puts the longest first', () => {
    const sessions = [
      session('review', '2026-01-15T09:00:00Z', '2026-01-15T09:15:00Z'),
      session('invoice', '2026-01-15T10:00:00Z', '2026-01-15T11:00:00Z'),
      session('standup', '2026-01-15T12:00:00Z', '2026-01-15T12:30:00Z')
    ]

    expect(totalsByJobForDay(sessions, day('2026-01-15T12:00:00Z'), now)).toEqual([
      { job: 'invoice', totalMs: 3600000 },
      { job: 'standup', totalMs: 1800000 },
      { job: 'review', totalMs: 900000 }
    ])
  })

  it('keeps untitled work under an empty job name', () => {
    const sessions = [session('', '2026-01-15T09:00:00Z', '2026-01-15T09:30:00Z')]

    expect(totalsByJobForDay(sessions, day('2026-01-15T12:00:00Z'), now)).toEqual([
      { job: '', totalMs: 1800000 }
    ])
  })

  it('ignores sessions from other days', () => {
    const sessions = [
      session('invoice', '2026-01-14T09:00:00Z', '2026-01-14T17:00:00Z'),
      session('review', '2026-01-15T09:00:00Z', '2026-01-15T09:30:00Z')
    ]

    expect(totalsByJobForDay(sessions, day('2026-01-15T12:00:00Z'), now)).toEqual([
      { job: 'review', totalMs: 1800000 }
    ])
  })

  // The headline case: one session, two days, credited to each by the part it spent there.
  it('splits a job that runs past midnight across both days', () => {
    const sessions = [session('invoice', '2026-01-15T23:50:00Z', '2026-01-16T00:20:00Z')]
    const later = at('2026-01-16T09:00:00Z')

    expect(totalsByJobForDay(sessions, day('2026-01-15T12:00:00Z'), later)).toEqual([
      { job: 'invoice', totalMs: 600000 }
    ])
    expect(totalsByJobForDay(sessions, day('2026-01-16T12:00:00Z'), later)).toEqual([
      { job: 'invoice', totalMs: 1200000 }
    ])
  })

  it('counts a running session up to now', () => {
    const sessions = [session('invoice', '2026-01-15T09:00:00Z', null)]

    expect(
      totalsByJobForDay(sessions, day('2026-01-15T12:00:00Z'), at('2026-01-15T09:45:00Z'))
    ).toEqual([{ job: 'invoice', totalMs: 2700000 }])
  })

  it('sorts equal totals by job name so the order is stable', () => {
    const sessions = [
      session('beta', '2026-01-15T10:00:00Z', '2026-01-15T10:30:00Z'),
      session('alpha', '2026-01-15T11:00:00Z', '2026-01-15T11:30:00Z')
    ]

    expect(totalsByJobForDay(sessions, day('2026-01-15T12:00:00Z'), now).map((e) => e.job)).toEqual(
      ['alpha', 'beta']
    )
  })
})

describe('recentDays', () => {
  const now = at('2026-01-15T18:00:00Z')

  it('is empty with no sessions', () => {
    expect(recentDays([], now, 7)).toEqual([])
  })

  it('returns the newest day first', () => {
    const sessions = [
      session('invoice', '2026-01-13T09:00:00Z', '2026-01-13T10:00:00Z'),
      session('review', '2026-01-15T09:00:00Z', '2026-01-15T09:30:00Z')
    ]

    expect(recentDays(sessions, now, 7).map((entry) => entry.dayStart)).toEqual([
      day('2026-01-15T00:00:00Z'),
      day('2026-01-13T00:00:00Z')
    ])
  })

  it('leaves out days with no tracked time', () => {
    const sessions = [session('invoice', '2026-01-15T09:00:00Z', '2026-01-15T10:00:00Z')]

    expect(recentDays(sessions, now, 7)).toEqual([
      {
        dayStart: day('2026-01-15T00:00:00Z'),
        totalMs: 3600000,
        jobs: [{ job: 'invoice', totalMs: 3600000 }]
      }
    ])
  })

  it('carries the per-job split and a total that matches it', () => {
    const sessions = [
      session('invoice', '2026-01-15T09:00:00Z', '2026-01-15T10:00:00Z'),
      session('review', '2026-01-15T11:00:00Z', '2026-01-15T11:30:00Z')
    ]

    const [today] = recentDays(sessions, now, 7)
    expect(today?.totalMs).toBe(5400000)
    expect(today?.jobs).toEqual([
      { job: 'invoice', totalMs: 3600000 },
      { job: 'review', totalMs: 1800000 }
    ])
  })

  it('stops at the window it was given', () => {
    const sessions = [
      session('old', '2026-01-10T09:00:00Z', '2026-01-10T10:00:00Z'),
      session('recent', '2026-01-15T09:00:00Z', '2026-01-15T10:00:00Z')
    ]

    expect(recentDays(sessions, now, 3).map((entry) => entry.jobs[0]?.job)).toEqual(['recent'])
    expect(recentDays(sessions, now, 7).map((entry) => entry.jobs[0]?.job)).toEqual([
      'recent',
      'old'
    ])
  })

  it('counts a session that spans midnight on both of its days', () => {
    const sessions = [session('invoice', '2026-01-14T23:50:00Z', '2026-01-15T00:20:00Z')]

    expect(recentDays(sessions, now, 7)).toEqual([
      {
        dayStart: day('2026-01-15T00:00:00Z'),
        totalMs: 1200000,
        jobs: [{ job: 'invoice', totalMs: 1200000 }]
      },
      {
        dayStart: day('2026-01-14T00:00:00Z'),
        totalMs: 600000,
        jobs: [{ job: 'invoice', totalMs: 600000 }]
      }
    ])
  })
})

describe('recentDays across a daylight-saving change', () => {
  const withTimeZone = (zone: string, run: () => void): void => {
    const previous = process.env.TZ
    process.env.TZ = zone
    try {
      run()
    } finally {
      process.env.TZ = previous
    }
  }

  // Stepping back a calendar day, not 24 hours. On the day after the clocks go
  // forward, subtracting 24 hours would land inside the wrong day and merge two
  // days' work into one row.
  it('steps back by calendar days, not by 24 hours', () => {
    withTimeZone('America/New_York', () => {
      // 2026-03-08 is the 23-hour day in New York; now is the next afternoon.
      const now = Date.parse('2026-03-09T18:00:00.000Z')
      const sessions: Session[] = [
        {
          id: 'a',
          startedAt: Date.parse('2026-03-08T15:00:00.000Z'),
          endedAt: Date.parse('2026-03-08T16:00:00.000Z'),
          job: 'short day'
        },
        {
          id: 'b',
          startedAt: Date.parse('2026-03-09T14:00:00.000Z'),
          endedAt: Date.parse('2026-03-09T15:00:00.000Z'),
          job: 'next day'
        }
      ]

      const days = recentDays(sessions, now, 7)

      expect(days.map((entry) => entry.jobs.map((job) => job.job))).toEqual([
        ['next day'],
        ['short day']
      ])
      expect(days.map((entry) => new Date(entry.dayStart).getDate())).toEqual([9, 8])
    })
  })
})
