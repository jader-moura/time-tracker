import { describe, expect, it } from 'vitest'
import { DEFAULT_INTERVAL_MS, parseIntervalMs } from './config'

describe('parseIntervalMs', () => {
  it('reads a valid interval', () => {
    expect(parseIntervalMs('300000')).toBe(300000)
  })

  it('tolerates surrounding whitespace', () => {
    expect(parseIntervalMs('  300000 ')).toBe(300000)
  })

  it('defaults to ten minutes when unset', () => {
    expect(parseIntervalMs(undefined)).toBe(600000)
    expect(DEFAULT_INTERVAL_MS).toBe(600000)
  })

  it('defaults when empty', () => {
    expect(parseIntervalMs('')).toBe(600000)
    expect(parseIntervalMs('   ')).toBe(600000)
  })

  // Each of these would otherwise divide into Infinity or NaN downstream.
  it('rejects zero', () => {
    expect(parseIntervalMs('0')).toBe(600000)
  })

  it('rejects a negative interval', () => {
    expect(parseIntervalMs('-600000')).toBe(600000)
  })

  it('rejects text', () => {
    expect(parseIntervalMs('ten minutes')).toBe(600000)
  })

  it('rejects a fractional interval', () => {
    expect(parseIntervalMs('600000.5')).toBe(600000)
  })

  it('rejects Infinity', () => {
    expect(parseIntervalMs('Infinity')).toBe(600000)
  })

  it('rejects a value beyond safe integer range', () => {
    expect(parseIntervalMs('9007199254740993')).toBe(600000)
  })
})
