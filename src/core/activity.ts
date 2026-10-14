import { startOfLocalDay } from './time'

export type Block = {
  sessionId: string
  startedAt: number
  clicks: number
}

// Blocks are anchored to local midnight, not to the epoch, so a 10-minute
// interval always lands on :00, :10, :20 of the wall clock whatever the
// timezone offset. Half-open: [startedAt, startedAt + intervalMs).
export const blockStartFor = (ts: number, intervalMs: number): number => {
  const dayStart = startOfLocalDay(ts)
  return dayStart + Math.floor((ts - dayStart) / intervalMs) * intervalMs
}

export const addClick = (
  blocks: Block[],
  sessionId: string,
  ts: number,
  intervalMs: number
): Block[] => {
  const startedAt = blockStartFor(ts, intervalMs)
  const isTarget = (block: Block): boolean =>
    block.sessionId === sessionId && block.startedAt === startedAt

  if (!blocks.some(isTarget)) {
    return [...blocks, { sessionId, startedAt, clicks: 1 }]
  }

  return blocks.map((block) => (isTarget(block) ? { ...block, clicks: block.clicks + 1 } : block))
}

export const blocksForSession = (blocks: Block[], sessionId: string): Block[] =>
  blocks.filter((block) => block.sessionId === sessionId).sort((a, b) => a.startedAt - b.startedAt)

export const totalClicks = (blocks: Block[], sessionId: string): number =>
  blocksForSession(blocks, sessionId).reduce((total, block) => total + block.clicks, 0)

// Every block the window touches, gaps filled with zero, so the UI can render a
// continuous series without storing empty blocks.
export const blockSeries = (
  blocks: Block[],
  sessionId: string,
  from: number,
  to: number,
  intervalMs: number
): Block[] => {
  const recorded = new Map(
    blocksForSession(blocks, sessionId).map((block) => [block.startedAt, block.clicks])
  )
  const series: Block[] = []

  for (let startedAt = blockStartFor(from, intervalMs); startedAt <= to;) {
    series.push({ sessionId, startedAt, clicks: recorded.get(startedAt) ?? 0 })
    startedAt = blockStartFor(startedAt + intervalMs, intervalMs)
  }

  return series
}
