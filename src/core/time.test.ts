import { describe, expect, it } from 'vitest'
import { formatDuration, startOfLocalDay, startOfNextLocalDay } from './time'

// Tests run with TZ=UTC (pinned in vitest.config.ts), so local time is UTC here.
const at = (iso: string): number => Date.parse(iso)

describe('startOfLocalDay', () => {
  it('rolls back to midnight', () => {
    expect(startOfLocalDay(at('2026-01-15T09:30:45.123Z'))).toBe(at('2026-01-15T00:00:00.000Z'))
  })

  it('is unchanged at midnight', () => {
    expect(startOfLocalDay(at('2026-01-15T00:00:00.000Z'))).toBe(at('2026-01-15T00:00:00.000Z'))
  })

  it('keeps the earlier day one millisecond before midnight', () => {
    expect(startOfLocalDay(at('2026-01-15T23:59:59.999Z'))).toBe(at('2026-01-15T00:00:00.000Z'))
  })
})

describe('formatDuration', () => {
  it('formats hours, minutes and seconds', () => {
    expect(formatDuration(3723000)).toBe('01:02:03')
  })

  it('formats zero', () => {
    expect(formatDuration(0)).toBe('00:00:00')
  })

  it('truncates partial seconds', () => {
    expect(formatDuration(1999)).toBe('00:00:01')
  })

  it('passes 24 hours without wrapping', () => {
    expect(formatDuration(90000000)).toBe('25:00:00')
  })

  it('clamps negative input to zero', () => {
    expect(formatDuration(-5000)).toBe('00:00:00')
  })
})

describe('startOfNextLocalDay', () => {
  it('moves to the following midnight', () => {
    expect(startOfNextLocalDay(at('2026-01-15T09:30:00.000Z'))).toBe(at('2026-01-16T00:00:00.000Z'))
  })

  it('moves a full day forward when already at midnight', () => {
    expect(startOfNextLocalDay(at('2026-01-15T00:00:00.000Z'))).toBe(at('2026-01-16T00:00:00.000Z'))
  })

  it('crosses a month boundary', () => {
    expect(startOfNextLocalDay(at('2026-01-31T18:00:00.000Z'))).toBe(at('2026-02-01T00:00:00.000Z'))
  })

  it('crosses a leap day', () => {
    expect(startOfNextLocalDay(at('2028-02-28T18:00:00.000Z'))).toBe(at('2028-02-29T00:00:00.000Z'))
  })
})

describe('local day length across a daylight-saving change', () => {
  const withTimeZone = (zone: string, run: () => void): void => {
    const previous = process.env.TZ
    process.env.TZ = zone
    try {
      run()
    } finally {
      process.env.TZ = previous
    }
  }

  it('is 23 hours on the day the clocks go forward', () => {
    withTimeZone('America/New_York', () => {
      const noon = Date.parse('2026-03-08T16:00:00.000Z')
      expect(startOfNextLocalDay(noon) - startOfLocalDay(noon)).toBe(23 * 3600000)
    })
  })

  it('is 25 hours on the day the clocks go back', () => {
    withTimeZone('America/New_York', () => {
      const noon = Date.parse('2026-11-01T16:00:00.000Z')
      expect(startOfNextLocalDay(noon) - startOfLocalDay(noon)).toBe(25 * 3600000)
    })
  })
})
