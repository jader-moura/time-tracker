import { describe, expect, it } from 'vitest'
import { dueShotAt, msUntilNextShot, nextShotAt } from './scheduler'
import type { ShotSchedule } from './scheduler'

// Tests run with TZ=UTC (pinned in vitest.config.ts), so local time is UTC here.
const at = (iso: string): number => Date.parse(iso)
const TEN_MIN = 600000

const running = (lastShotAt: number | null = null): ShotSchedule => ({
  startedAt: at('2026-01-15T09:00:00Z'),
  endedAt: null,
  intervalMs: TEN_MIN,
  lastShotAt
})

describe('nextShotAt', () => {
  it('schedules the first shot one interval in, not at the start', () => {
    expect(nextShotAt(running())).toBe(at('2026-01-15T09:10:00Z'))
  })

  it('schedules 09:20 after the 09:10 shot', () => {
    expect(nextShotAt(running(at('2026-01-15T09:10:00Z')))).toBe(at('2026-01-15T09:20:00Z'))
  })

  it('schedules 09:30 after the 09:20 shot', () => {
    expect(nextShotAt(running(at('2026-01-15T09:20:00Z')))).toBe(at('2026-01-15T09:30:00Z'))
  })

  it('stays on the original grid after a skipped shot', () => {
    expect(nextShotAt(running(at('2026-01-15T09:30:00Z')))).toBe(at('2026-01-15T09:40:00Z'))
  })

  it('is null once the session has stopped', () => {
    const stopped: ShotSchedule = { ...running(), endedAt: at('2026-01-15T09:05:00Z') }
    expect(nextShotAt(stopped)).toBeNull()
  })
})

describe('dueShotAt', () => {
  it('owes nothing at the moment the session starts', () => {
    expect(dueShotAt(running(), at('2026-01-15T09:00:00Z'))).toBeNull()
  })

  it('owes nothing one millisecond before the first due time', () => {
    expect(dueShotAt(running(), at('2026-01-15T09:09:59.999Z'))).toBeNull()
  })

  it('owes the 09:10 shot exactly on the boundary', () => {
    expect(dueShotAt(running(), at('2026-01-15T09:10:00.000Z'))).toBe(at('2026-01-15T09:10:00Z'))
  })

  it('still owes the 09:10 shot partway through the next block', () => {
    expect(dueShotAt(running(), at('2026-01-15T09:15:00Z'))).toBe(at('2026-01-15T09:10:00Z'))
  })

  it('owes nothing once that shot has been taken', () => {
    const taken = running(at('2026-01-15T09:10:00Z'))
    expect(dueShotAt(taken, at('2026-01-15T09:15:00Z'))).toBeNull()
  })

  it('owes the next shot after the following boundary', () => {
    const taken = running(at('2026-01-15T09:10:00Z'))
    expect(dueShotAt(taken, at('2026-01-15T09:25:00Z'))).toBe(at('2026-01-15T09:20:00Z'))
  })

  it('owes nothing after the session stops, even when overdue', () => {
    const stopped: ShotSchedule = { ...running(), endedAt: at('2026-01-15T09:05:00Z') }
    expect(dueShotAt(stopped, at('2026-01-15T11:00:00Z'))).toBeNull()
  })
})

describe('dueShotAt after the machine has slept', () => {
  // 09:20 and 09:30 both came due while asleep. Waking at 09:35 owes 09:30 only:
  // the missed 09:20 is dropped rather than fired as a burst.
  const sleptThroughTwo = running(at('2026-01-15T09:10:00Z'))

  it('owes only the most recent due time', () => {
    expect(dueShotAt(sleptThroughTwo, at('2026-01-15T09:35:00Z'))).toBe(at('2026-01-15T09:30:00Z'))
  })

  it('does not backfill the skipped one on the next tick', () => {
    const afterWakeShot = running(at('2026-01-15T09:30:00Z'))
    expect(dueShotAt(afterWakeShot, at('2026-01-15T09:35:00Z'))).toBeNull()
  })

  it('owes one shot per tick however long the sleep was', () => {
    expect(dueShotAt(sleptThroughTwo, at('2026-01-15T17:04:00Z'))).toBe(at('2026-01-15T17:00:00Z'))
  })
})

describe('msUntilNextShot', () => {
  it('waits a full interval at the start', () => {
    expect(msUntilNextShot(running(), at('2026-01-15T09:00:00Z'))).toBe(600000)
  })

  it('waits the remainder partway through a block', () => {
    expect(msUntilNextShot(running(), at('2026-01-15T09:05:00Z'))).toBe(300000)
  })

  it('is zero when a shot is already owed', () => {
    expect(msUntilNextShot(running(), at('2026-01-15T09:15:00Z'))).toBe(0)
  })

  it('is null once the session has stopped', () => {
    const stopped: ShotSchedule = { ...running(), endedAt: at('2026-01-15T09:05:00Z') }
    expect(msUntilNextShot(stopped, at('2026-01-15T09:15:00Z'))).toBeNull()
  })
})

describe('a session from 09:00 captures at 09:10, 09:20 and 09:30', () => {
  it('walks the schedule one shot at a time', () => {
    const taken: number[] = []
    let schedule = running()

    for (const tick of ['09:10', '09:20', '09:30']) {
      const due = dueShotAt(schedule, at(`2026-01-15T${tick}:00Z`))
      if (due !== null) {
        taken.push(due)
        schedule = { ...schedule, lastShotAt: due }
      }
    }

    expect(taken).toEqual([
      at('2026-01-15T09:10:00Z'),
      at('2026-01-15T09:20:00Z'),
      at('2026-01-15T09:30:00Z')
    ])
  })

  it('takes nothing more once stopped mid-schedule', () => {
    const stopped: ShotSchedule = {
      ...running(at('2026-01-15T09:10:00Z')),
      endedAt: at('2026-01-15T09:22:00Z')
    }

    expect(dueShotAt(stopped, at('2026-01-15T09:30:00Z'))).toBeNull()
    expect(msUntilNextShot(stopped, at('2026-01-15T09:30:00Z'))).toBeNull()
  })
})
