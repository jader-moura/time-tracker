import { randomUUID } from 'node:crypto'
import { addClick, blockSeries, blocksForSession, totalClicks } from '../core/activity'
import { elapsedMs, isActive } from '../core/session'
import type { Session } from '../core/session'
import { dueShotAt } from '../core/scheduler'
import type { ShotSchedule } from '../core/scheduler'
import { startOfLocalDay } from '../core/time'
import { totalForDay } from '../core/session'
import type { ActivitySource, ShotView, Status } from '../preload/api'
import type { Storage, TrackerData } from './storage'
import { emptyData } from './storage'

export type Capture = {
  fileName: string
  dataUrl: string
}

export interface ScreenshotService {
  capture: (takenAt: number) => Promise<Capture>
}

export interface InputCounter {
  readonly source: ActivitySource
  start: (onInput: (ts: number) => void) => void
  stop: () => void
}

export type TrackerOptions = {
  storage: Storage
  screenshots: ScreenshotService
  input: InputCounter
  notify: (status: Status) => void
  now: () => number
  intervalMs: number
  tickMs?: number
  saveEveryMs?: number
}

export type TrackerService = {
  load: () => Promise<void>
  start: () => Promise<Status>
  stop: () => Promise<Status>
  status: () => Status
  thumbnail: () => ShotView | null
  dispose: () => Promise<void>
}

const TICK_MS = 1000
const SAVE_EVERY_MS = 10000

export const createTrackerService = (options: TrackerOptions): TrackerService => {
  const { storage, screenshots, input, notify, now, intervalMs } = options
  const tickMs = options.tickMs ?? TICK_MS
  const saveEveryMs = options.saveEveryMs ?? SAVE_EVERY_MS

  let data: TrackerData = emptyData()
  let timer: NodeJS.Timeout | null = null
  let lastShot: ShotView | null = null
  let dirty = false
  let lastSavedAt = 0
  let capturing = false
  // A failed capture is remembered here rather than written to the file, so the
  // next tick does not retry it in a tight loop.
  let lastAttemptAt: number | null = null

  const activeSession = (): Session | undefined => data.sessions.find(isActive)

  const save = async (): Promise<void> => {
    await storage.save(data)
    dirty = false
    lastSavedAt = now()
  }

  const status = (): Status => {
    const at = now()
    const session = activeSession()

    // The series normally runs to now, but a click timestamped slightly ahead of
    // the clock would then be counted in totalClicks and missing from the list.
    // Cover whatever has actually been recorded so the two always agree.
    const seriesEnd = (candidate: Session): number => {
      const recorded = blocksForSession(data.blocks, candidate.id)
      const latest = recorded.at(-1)?.startedAt ?? at
      return Math.max(at, latest)
    }

    return {
      isTracking: session !== undefined,
      sessionStartedAt: session?.startedAt ?? null,
      sessionElapsedMs: session ? elapsedMs(session, at) : 0,
      todayTotalMs: totalForDay(data.sessions, startOfLocalDay(at), at),
      blocks: session
        ? blockSeries(
            data.blocks,
            session.id,
            session.startedAt,
            seriesEnd(session),
            intervalMs
          ).map((block) => ({
            startedAt: block.startedAt,
            clicks: block.clicks
          }))
        : [],
      totalClicks: session ? totalClicks(data.blocks, session.id) : 0,
      lastShotAt: lastShot?.takenAt ?? null,
      activitySource: input.source,
      intervalMs
    }
  }

  const onInput = (ts: number): void => {
    const session = activeSession()
    if (!session) return

    data = { ...data, blocks: addClick(data.blocks, session.id, ts, intervalMs) }
    dirty = true
  }

  const lastShotAtFor = (sessionId: string): number | null => {
    const taken = data.shots
      .filter((shot) => shot.sessionId === sessionId)
      .map((shot) => shot.takenAt)
    const latest = taken.length > 0 ? Math.max(...taken) : null

    if (latest === null) return lastAttemptAt
    if (lastAttemptAt === null) return latest
    return Math.max(latest, lastAttemptAt)
  }

  const scheduleFor = (session: Session): ShotSchedule => ({
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    intervalMs,
    lastShotAt: lastShotAtFor(session.id)
  })

  const maybeCapture = async (session: Session, at: number): Promise<void> => {
    if (capturing) return

    const due = dueShotAt(scheduleFor(session), at)
    if (due === null) return

    capturing = true
    try {
      const capture = await screenshots.capture(due)
      data = {
        ...data,
        shots: [...data.shots, { sessionId: session.id, takenAt: due, fileName: capture.fileName }]
      }
      lastShot = { takenAt: due, dataUrl: capture.dataUrl }
      dirty = true
    } catch (error) {
      // Message only. Never the image.
      lastAttemptAt = due
      console.error(`Screenshot at ${due} failed: ${describe(error)}`)
      return
    } finally {
      capturing = false
    }

    // Outside the try: a storage failure is its own problem and must not be
    // reported as a failed screenshot, nor make the shot look un-taken.
    await save().catch((error: unknown) => console.error(`Save failed: ${describe(error)}`))
  }

  const tick = async (): Promise<void> => {
    const session = activeSession()
    if (!session) return

    const at = now()
    await maybeCapture(session, at)

    if (dirty && at - lastSavedAt >= saveEveryMs) {
      await save().catch((error: unknown) => console.error(`Save failed: ${describe(error)}`))
    }

    notify(status())
  }

  const startTicking = (): void => {
    if (timer !== null) return
    timer = setInterval(() => void tick(), tickMs)
  }

  const stopTicking = (): void => {
    if (timer === null) return
    clearInterval(timer)
    timer = null
  }

  const load = async (): Promise<void> => {
    data = await storage.load()
    // A session left open by a crash cannot be resumed meaningfully, so close it
    // at its last known point rather than letting it run to now.
    const stale = data.sessions.filter(isActive)
    if (stale.length > 0) {
      data = {
        ...data,
        sessions: data.sessions.map((session) =>
          isActive(session) ? { ...session, endedAt: session.startedAt } : session
        )
      }
      await save()
    }
  }

  const start = async (): Promise<Status> => {
    if (activeSession()) return status()

    const at = now()
    lastAttemptAt = null
    data = {
      ...data,
      sessions: [...data.sessions, { id: randomUUID(), startedAt: at, endedAt: null }]
    }

    input.start(onInput)
    startTicking()
    await save()

    return status()
  }

  const stop = async (): Promise<Status> => {
    const session = activeSession()
    if (!session) return status()

    const at = now()
    data = {
      ...data,
      sessions: data.sessions.map((candidate) =>
        candidate.id === session.id ? { ...candidate, endedAt: at } : candidate
      )
    }

    // Order matters: release the OS hooks and timers before the write, so nothing
    // keeps running if the write throws.
    input.stop()
    stopTicking()
    lastAttemptAt = null
    await save()

    return status()
  }

  const dispose = async (): Promise<void> => {
    if (activeSession()) {
      await stop()
      return
    }

    input.stop()
    stopTicking()
    if (dirty) await save()
  }

  return { load, start, stop, status, thumbnail: () => lastShot, dispose }
}

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : 'unknown error'
