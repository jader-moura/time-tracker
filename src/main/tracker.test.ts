// storage.ts and tracker.ts hold real logic rather than a thin OS adapter, and
// neither imports Electron, so both are tested here. The clock and the tick timer
// are faked: nothing in this file waits on real time.
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BYTE_ORDER_MARK, createFileStorage, dataFilePath, emptyData } from './storage'
import type { TrackerData } from './storage'
import { createTrackerService } from './tracker'
import type { Capture, InputCounter, TrackerService } from './tracker'

const TEN_MIN = 600000
const at = (iso: string): number => Date.parse(iso)
const START = '2026-01-15T09:00:00Z'

const tempDir = (): Promise<string> => mkdtemp(join(tmpdir(), 'wt-test-'))

const readData = async (path: string): Promise<TrackerData> =>
  JSON.parse(await readFile(path, 'utf8')) as TrackerData

type FakeCounter = InputCounter & {
  fire: (ts: number) => void
  running: () => boolean
}

const fakeCounter = (): FakeCounter => {
  let listener: ((ts: number) => void) | null = null
  return {
    source: 'clicks',
    start: (onInput) => {
      listener = onInput
    },
    stop: () => {
      listener = null
    },
    fire: (ts) => listener?.(ts),
    running: () => listener !== null
  }
}

describe('file storage', () => {
  it('round-trips data', async () => {
    const storage = createFileStorage(dataFilePath(await tempDir()))

    await storage.save({
      ...emptyData(),
      sessions: [{ id: 'a', startedAt: 1000, endedAt: 2000, job: 'old work' }]
    })

    expect((await storage.load()).sessions).toEqual([
      { id: 'a', startedAt: 1000, endedAt: 2000, job: 'old work' }
    ])
  })

  it('returns empty data when the file is missing', async () => {
    const storage = createFileStorage(dataFilePath(await tempDir()))
    expect(await storage.load()).toEqual(emptyData())
  })

  it('quarantines an unreadable file instead of overwriting it', async () => {
    const dir = await tempDir()
    const path = dataFilePath(dir)
    await writeFile(path, '{ this is not json', 'utf8')

    expect(await createFileStorage(path).load()).toEqual(emptyData())
    expect((await readdir(dir)).some((name) => name.includes('.corrupt-'))).toBe(true)
  })

  it('drops malformed rows but keeps good ones', async () => {
    const path = dataFilePath(await tempDir())
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        sessions: [{ id: 'good', startedAt: 1, endedAt: null }, { id: 'bad' }, 'nonsense'],
        blocks: 'not an array',
        shots: []
      }),
      'utf8'
    )

    const loaded = await createFileStorage(path).load()
    expect(loaded.sessions).toEqual([{ id: 'good', startedAt: 1, endedAt: null, job: '' }])
    expect(loaded.blocks).toEqual([])
  })

  // Files written before jobs existed must survive the upgrade. Rejecting rows
  // without a job field would have deleted every session already recorded.
  it('upgrades sessions written before jobs existed', async () => {
    const path = dataFilePath(await tempDir())
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        sessions: [
          { id: 'before', startedAt: 1000, endedAt: 2000 },
          { id: 'after', startedAt: 3000, endedAt: 4000, job: 'invoice migration' }
        ],
        blocks: [],
        shots: []
      }),
      'utf8'
    )

    expect((await createFileStorage(path).load()).sessions).toEqual([
      { id: 'before', startedAt: 1000, endedAt: 2000, job: '' },
      { id: 'after', startedAt: 3000, endedAt: 4000, job: 'invoice migration' }
    ])
  })

  // Notepad on Windows saves UTF-8 with a BOM, and this file is meant to be
  // readable by hand, so a BOM must not look like corruption.
  it('reads a file saved with a byte order mark', async () => {
    const dir = await tempDir()
    const path = dataFilePath(dir)
    await writeFile(
      path,
      BYTE_ORDER_MARK +
        JSON.stringify({
          version: 1,
          sessions: [{ id: 'kept', startedAt: 1000, endedAt: 2000, job: 'editing by hand' }],
          blocks: [],
          shots: []
        }),
      'utf8'
    )

    const loaded = await createFileStorage(path).load()

    expect(loaded.sessions).toEqual([
      { id: 'kept', startedAt: 1000, endedAt: 2000, job: 'editing by hand' }
    ])
    // Nothing was quarantined, because nothing was wrong with it.
    expect((await readdir(dir)).some((name) => name.includes('.corrupt-'))).toBe(false)
  })

  it('normalises a job that was hand-edited in the file', async () => {
    const path = dataFilePath(await tempDir())
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        sessions: [{ id: 'a', startedAt: 1, endedAt: 2, job: '  spaced    out  ' }],
        blocks: [],
        shots: []
      }),
      'utf8'
    )

    expect((await createFileStorage(path).load()).sessions[0]?.job).toBe('spaced out')
  })
})

describe('tracker service', () => {
  let path: string
  let input: FakeCounter
  let captured: number[]
  let captureFails: boolean
  let captureAttempts: number
  let service: TrackerService

  const build = async (): Promise<void> => {
    path = dataFilePath(await tempDir())
    input = fakeCounter()
    captured = []
    captureFails = false
    captureAttempts = 0

    service = createTrackerService({
      storage: createFileStorage(path),
      screenshots: {
        capture: (takenAt: number): Promise<Capture> => {
          captureAttempts += 1
          if (captureFails) return Promise.reject(new Error('capture exploded'))
          captured.push(takenAt)
          return Promise.resolve({
            fileName: `${takenAt}.png`,
            dataUrl: 'data:image/png;base64,xx'
          })
        }
      },
      input,
      notify: () => undefined,
      now: () => Date.now(),
      intervalMs: TEN_MIN,
      saveEveryMs: 0
    })
  }

  // Running the timer forward also moves Date.now, so the service sees the clock
  // advance exactly as it would in a live session.
  const runFor = async (ms: number): Promise<void> => {
    await vi.advanceTimersByTimeAsync(ms)
  }

  // A suspended machine is the opposite: the clock jumps but no tick fires.
  const sleepFor = async (ms: number): Promise<void> => {
    vi.setSystemTime(Date.now() + ms)
    await vi.advanceTimersByTimeAsync(1000)
  }

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(at(START))
    await build()
  })

  afterEach(async () => {
    await service.dispose()
    vi.useRealTimers()
  })

  it('writes an active session to disk on start', async () => {
    await service.load()
    const status = await service.start('')

    expect(status.isTracking).toBe(true)
    expect(status.sessionStartedAt).toBe(at(START))

    const onDisk = await readData(path)
    expect(onDisk.sessions).toHaveLength(1)
    expect(onDisk.sessions[0]?.endedAt).toBeNull()
  })

  it('records the job against the session, normalised', async () => {
    await service.load()
    const status = await service.start('  invoice   migration  ')

    expect(status.job).toBe('invoice migration')
    expect((await readData(path)).sessions[0]?.job).toBe('invoice migration')
  })

  it('allows an untitled session', async () => {
    await service.load()
    const status = await service.start('')

    expect(status.isTracking).toBe(true)
    expect(status.job).toBe('')
  })

  it('reports no job once stopped, but offers it as the next one', async () => {
    await service.load()
    await service.start('invoice migration')
    await runFor(60000)
    const stopped = await service.stop()

    expect(stopped.job).toBe('')
    expect(stopped.lastJob).toBe('invoice migration')
  })

  it('offers the most recent job after a restart', async () => {
    await service.load()
    await service.start('first job')
    await runFor(60000)
    await service.stop()
    await service.start('second job')
    await runFor(60000)
    await service.stop()

    expect(service.status().lastJob).toBe('second job')
  })

  it('keeps each session job separate', async () => {
    await service.load()
    await service.start('morning job')
    await runFor(60000)
    await service.stop()
    await service.start('afternoon job')

    const sessions = (await readData(path)).sessions
    expect(sessions.map((session) => session.job)).toEqual(['morning job', 'afternoon job'])
  })

  it('ignores a second start while already tracking', async () => {
    await service.load()
    await service.start('')
    await runFor(60000)
    await service.start('')

    expect((await readData(path)).sessions).toHaveLength(1)
  })

  it('counts clicks into the right block and persists them', async () => {
    await service.load()
    await service.start('')

    expect(input.running()).toBe(true)
    input.fire(at('2026-01-15T09:03:00Z'))
    input.fire(at('2026-01-15T09:09:59.999Z'))
    await runFor(TEN_MIN + 30000)
    input.fire(at('2026-01-15T09:10:30Z'))
    await runFor(1000)

    const status = service.status()
    expect(status.totalClicks).toBe(3)
    expect(status.blocks).toEqual([
      { startedAt: at('2026-01-15T09:00:00Z'), clicks: 2 },
      { startedAt: at('2026-01-15T09:10:00Z'), clicks: 1 }
    ])

    // stop() awaits its own write, so the file is settled once it returns.
    await service.stop()
    expect((await readData(path)).blocks).toEqual([
      { sessionId: expect.any(String) as unknown as string, startedAt: at(START), clicks: 2 },
      {
        sessionId: expect.any(String) as unknown as string,
        startedAt: at('2026-01-15T09:10:00Z'),
        clicks: 1
      }
    ])
  })

  it('ignores clicks once the session has stopped', async () => {
    await service.load()
    await service.start('')
    await service.stop()

    input.fire(at('2026-01-15T09:05:00Z'))

    expect((await readData(path)).blocks).toEqual([])
  })

  it('captures one screenshot per interval and none at the start', async () => {
    await service.load()
    await service.start('')

    await runFor(TEN_MIN - 1000)
    expect(captured).toEqual([])

    await runFor(1000)
    expect(captured).toEqual([at('2026-01-15T09:10:00Z')])

    await runFor(TEN_MIN)
    expect(captured).toEqual([at('2026-01-15T09:10:00Z'), at('2026-01-15T09:20:00Z')])
  })

  it('records captured screenshots and exposes the last thumbnail', async () => {
    await service.load()
    await service.start('')
    await runFor(TEN_MIN)

    expect(service.status().lastShotAt).toBe(at('2026-01-15T09:10:00Z'))
    // The image itself is fetched on demand, not pushed with every tick.
    expect(service.thumbnail()).toEqual({
      takenAt: at('2026-01-15T09:10:00Z'),
      dataUrl: 'data:image/png;base64,xx'
    })

    await service.stop()
    expect((await readData(path)).shots).toEqual([
      {
        sessionId: expect.any(String) as unknown as string,
        takenAt: at('2026-01-15T09:10:00Z'),
        fileName: `${at('2026-01-15T09:10:00Z')}.png`
      }
    ])
  })

  it('does not fire a burst of captures after a long sleep', async () => {
    await service.load()
    await service.start('')

    await sleepFor(TEN_MIN * 5)

    expect(captured).toEqual([at('2026-01-15T09:50:00Z')])
  })

  it('stops cleanly: releases the hook, cancels shots, writes the end time', async () => {
    await service.load()
    await service.start('')
    await runFor(300000)

    const stopped = await service.stop()

    expect(stopped.isTracking).toBe(false)
    expect(input.running()).toBe(false)

    await runFor(TEN_MIN * 3)
    expect(captured).toEqual([])
    expect((await readData(path)).sessions[0]?.endedAt).toBe(at('2026-01-15T09:05:00Z'))
  })

  it('stopping twice is harmless', async () => {
    await service.load()
    await service.start('')
    await runFor(60000)
    await service.stop()
    const again = await service.stop()

    expect(again.isTracking).toBe(false)
    expect((await readData(path)).sessions[0]?.endedAt).toBe(at('2026-01-15T09:01:00Z'))
  })

  it('adds up today across two sessions', async () => {
    await service.load()
    await service.start('')
    await runFor(1800000)
    await service.stop()

    await runFor(1800000)
    await service.start('')
    await runFor(900000)
    const status = await service.stop()

    expect(status.todayTotalMs).toBe(2700000)
  })

  it('stops an active session when the app quits', async () => {
    await service.load()
    await service.start('')
    await runFor(TEN_MIN)

    await service.dispose()

    expect((await readData(path)).sessions[0]?.endedAt).toBe(at('2026-01-15T09:10:00Z'))
  })

  it('closes a session left open by a crash instead of letting it run', async () => {
    await createFileStorage(path).save({
      ...emptyData(),
      sessions: [{ id: 'crashed', startedAt: at(START), endedAt: null, job: 'interrupted' }]
    })
    vi.setSystemTime(at('2026-01-16T23:00:00Z'))

    await service.load()

    expect(service.status().isTracking).toBe(false)
    expect((await readData(path)).sessions[0]?.endedAt).toBe(at(START))
  })

  it('keeps tracking when a capture fails, and does not retry it every tick', async () => {
    captureFails = true
    await service.load()
    await service.start('')

    await runFor(TEN_MIN + 5000)

    expect(captureAttempts).toBe(1)
    expect(service.status().isTracking).toBe(true)
    expect((await readData(path)).shots).toEqual([])
  })

  it('resumes capturing at the next due time after a failure', async () => {
    captureFails = true
    await service.load()
    await service.start('')
    await runFor(TEN_MIN)

    captureFails = false
    await runFor(TEN_MIN)

    expect(captured).toEqual([at('2026-01-15T09:20:00Z')])
  })
})
