import { describe, expect, it } from 'vitest'
import { addClick, blockSeries, blockStartFor, blocksForSession, totalClicks } from './activity'
import type { Block } from './activity'

// Tests run with TZ=UTC (pinned in vitest.config.ts), so local time is UTC here.
const at = (iso: string): number => Date.parse(iso)
const TEN_MIN = 600000

describe('blockStartFor', () => {
  it('keeps the earlier block one millisecond before the boundary', () => {
    expect(blockStartFor(at('2026-01-15T09:09:59.999Z'), TEN_MIN)).toBe(at('2026-01-15T09:00:00Z'))
  })

  it('moves to the next block exactly on the boundary', () => {
    expect(blockStartFor(at('2026-01-15T09:10:00.000Z'), TEN_MIN)).toBe(at('2026-01-15T09:10:00Z'))
  })

  it('is unchanged at its own start', () => {
    expect(blockStartFor(at('2026-01-15T09:00:00.000Z'), TEN_MIN)).toBe(at('2026-01-15T09:00:00Z'))
  })

  it('handles the first block of the day', () => {
    expect(blockStartFor(at('2026-01-15T00:04:00Z'), TEN_MIN)).toBe(at('2026-01-15T00:00:00Z'))
  })

  it('handles the last block of the day', () => {
    expect(blockStartFor(at('2026-01-15T23:59:59.999Z'), TEN_MIN)).toBe(at('2026-01-15T23:50:00Z'))
  })

  it('honours a different interval', () => {
    expect(blockStartFor(at('2026-01-15T09:07:00Z'), 300000)).toBe(at('2026-01-15T09:05:00Z'))
  })
})

describe('blockStartFor across a daylight-saving change', () => {
  const withTimeZone = (zone: string, run: () => void): void => {
    const previous = process.env.TZ
    process.env.TZ = zone
    try {
      run()
    } finally {
      process.env.TZ = previous
    }
  }

  // The clocks jump a whole hour, a multiple of the interval, so blocks stay on the
  // wall clock marks of :00, :10, :20 either side of the change.
  it('stays aligned to the wall clock after the clocks go forward', () => {
    withTimeZone('America/New_York', () => {
      // 09:23 local, after that morning's spring forward.
      const blockStart = blockStartFor(Date.parse('2026-03-08T13:23:00.000Z'), TEN_MIN)

      expect(new Date(blockStart).getHours()).toBe(9)
      expect(new Date(blockStart).getMinutes()).toBe(20)
    })
  })

  it('stays aligned to the wall clock after the clocks go back', () => {
    withTimeZone('America/New_York', () => {
      // 09:23 local, after that morning's fall back.
      const blockStart = blockStartFor(Date.parse('2026-11-01T14:23:00.000Z'), TEN_MIN)

      expect(new Date(blockStart).getHours()).toBe(9)
      expect(new Date(blockStart).getMinutes()).toBe(20)
    })
  })
})

describe('blockStartFor in a timezone offset by part of an hour', () => {
  const withTimeZone = (zone: string, run: () => void): void => {
    const previous = process.env.TZ
    process.env.TZ = zone
    try {
      run()
    } finally {
      process.env.TZ = previous
    }
  }

  // This is what local-midnight anchoring buys. Kathmandu is UTC+05:45, so flooring
  // the epoch to a 10-minute multiple would put blocks on the wall clock's :05, :15,
  // :25 marks. Anchoring to local midnight keeps them on :00, :10, :20.
  it('keeps blocks on the wall clock at UTC+05:45', () => {
    withTimeZone('Asia/Kathmandu', () => {
      const blockStart = blockStartFor(Date.parse('2026-01-15T03:38:00.000Z'), TEN_MIN)

      expect(new Date(blockStart).getHours()).toBe(9)
      expect(new Date(blockStart).getMinutes()).toBe(20)
    })
  })

  it('keeps blocks on the wall clock at UTC+05:30', () => {
    withTimeZone('Asia/Kolkata', () => {
      const blockStart = blockStartFor(Date.parse('2026-01-15T03:53:00.000Z'), TEN_MIN)

      expect(new Date(blockStart).getHours()).toBe(9)
      expect(new Date(blockStart).getMinutes()).toBe(20)
    })
  })
})

describe('addClick', () => {
  it('creates a block on the first click', () => {
    const blocks = addClick([], 's1', at('2026-01-15T09:03:00Z'), TEN_MIN)

    expect(blocks).toEqual([{ sessionId: 's1', startedAt: at('2026-01-15T09:00:00Z'), clicks: 1 }])
  })

  it('increments an existing block instead of adding a row', () => {
    let blocks: Block[] = []
    blocks = addClick(blocks, 's1', at('2026-01-15T09:03:00Z'), TEN_MIN)
    blocks = addClick(blocks, 's1', at('2026-01-15T09:04:00Z'), TEN_MIN)
    blocks = addClick(blocks, 's1', at('2026-01-15T09:09:59.999Z'), TEN_MIN)

    expect(blocks).toEqual([{ sessionId: 's1', startedAt: at('2026-01-15T09:00:00Z'), clicks: 3 }])
  })

  it('opens a new block once the boundary is crossed', () => {
    let blocks: Block[] = []
    blocks = addClick(blocks, 's1', at('2026-01-15T09:09:59.999Z'), TEN_MIN)
    blocks = addClick(blocks, 's1', at('2026-01-15T09:10:00.000Z'), TEN_MIN)

    expect(blocks).toEqual([
      { sessionId: 's1', startedAt: at('2026-01-15T09:00:00Z'), clicks: 1 },
      { sessionId: 's1', startedAt: at('2026-01-15T09:10:00Z'), clicks: 1 }
    ])
  })

  it('keeps sessions apart within the same block', () => {
    let blocks: Block[] = []
    blocks = addClick(blocks, 's1', at('2026-01-15T09:03:00Z'), TEN_MIN)
    blocks = addClick(blocks, 's2', at('2026-01-15T09:04:00Z'), TEN_MIN)

    expect(blocks).toEqual([
      { sessionId: 's1', startedAt: at('2026-01-15T09:00:00Z'), clicks: 1 },
      { sessionId: 's2', startedAt: at('2026-01-15T09:00:00Z'), clicks: 1 }
    ])
  })

  it('does not mutate the blocks it is given', () => {
    const original: Block[] = [
      { sessionId: 's1', startedAt: at('2026-01-15T09:00:00Z'), clicks: 1 }
    ]
    addClick(original, 's1', at('2026-01-15T09:05:00Z'), TEN_MIN)

    expect(original).toEqual([
      { sessionId: 's1', startedAt: at('2026-01-15T09:00:00Z'), clicks: 1 }
    ])
  })
})

describe('blocksForSession', () => {
  const blocks: Block[] = [
    { sessionId: 's1', startedAt: at('2026-01-15T09:20:00Z'), clicks: 2 },
    { sessionId: 's2', startedAt: at('2026-01-15T09:00:00Z'), clicks: 9 },
    { sessionId: 's1', startedAt: at('2026-01-15T09:00:00Z'), clicks: 5 }
  ]

  it('returns only that session, oldest first', () => {
    expect(blocksForSession(blocks, 's1')).toEqual([
      { sessionId: 's1', startedAt: at('2026-01-15T09:00:00Z'), clicks: 5 },
      { sessionId: 's1', startedAt: at('2026-01-15T09:20:00Z'), clicks: 2 }
    ])
  })

  it('is empty for an unknown session', () => {
    expect(blocksForSession(blocks, 'nope')).toEqual([])
  })

  it('sums the clicks of a session', () => {
    expect(totalClicks(blocks, 's1')).toBe(7)
  })

  it('sums to zero for an unknown session', () => {
    expect(totalClicks(blocks, 'nope')).toBe(0)
  })
})

describe('blockSeries', () => {
  const blocks: Block[] = [
    { sessionId: 's1', startedAt: at('2026-01-15T09:00:00Z'), clicks: 5 },
    { sessionId: 's1', startedAt: at('2026-01-15T09:20:00Z'), clicks: 2 }
  ]

  it('fills the gap between recorded blocks with zero', () => {
    const series = blockSeries(
      blocks,
      's1',
      at('2026-01-15T09:00:00Z'),
      at('2026-01-15T09:25:00Z'),
      TEN_MIN
    )

    expect(series).toEqual([
      { sessionId: 's1', startedAt: at('2026-01-15T09:00:00Z'), clicks: 5 },
      { sessionId: 's1', startedAt: at('2026-01-15T09:10:00Z'), clicks: 0 },
      { sessionId: 's1', startedAt: at('2026-01-15T09:20:00Z'), clicks: 2 }
    ])
  })

  it('starts at the block containing the window start', () => {
    const series = blockSeries(
      blocks,
      's1',
      at('2026-01-15T09:07:00Z'),
      at('2026-01-15T09:12:00Z'),
      TEN_MIN
    )

    expect(series).toEqual([
      { sessionId: 's1', startedAt: at('2026-01-15T09:00:00Z'), clicks: 5 },
      { sessionId: 's1', startedAt: at('2026-01-15T09:10:00Z'), clicks: 0 }
    ])
  })

  it('returns a single block for a window inside one block', () => {
    const series = blockSeries(
      blocks,
      's1',
      at('2026-01-15T09:01:00Z'),
      at('2026-01-15T09:02:00Z'),
      TEN_MIN
    )

    expect(series).toEqual([{ sessionId: 's1', startedAt: at('2026-01-15T09:00:00Z'), clicks: 5 }])
  })

  it('crosses midnight', () => {
    const series = blockSeries(
      [],
      's1',
      at('2026-01-15T23:50:00Z'),
      at('2026-01-16T00:05:00Z'),
      TEN_MIN
    )

    expect(series).toEqual([
      { sessionId: 's1', startedAt: at('2026-01-15T23:50:00Z'), clicks: 0 },
      { sessionId: 's1', startedAt: at('2026-01-16T00:00:00Z'), clicks: 0 }
    ])
  })
})
