import { describe, expect, it } from 'vitest'
import { formatDuration, startOfLocalDay } from './time'

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
