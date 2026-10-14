import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Block } from '../core/activity'
import { normaliseJob } from '../core/session'
import type { Session } from '../core/session'

export type Shot = {
  sessionId: string
  takenAt: number
  fileName: string
}

export type TrackerData = {
  version: 1
  sessions: Session[]
  blocks: Block[]
  shots: Shot[]
}

export interface Storage {
  load: () => Promise<TrackerData>
  save: (data: TrackerData) => Promise<void>
}

export const emptyData = (): TrackerData => ({
  version: 1,
  sessions: [],
  blocks: [],
  shots: []
})

// Written as a char code rather than an escape so it survives tooling that
// rewrites string escapes, and so it cannot sit invisibly in the source.
export const BYTE_ORDER_MARK = String.fromCharCode(0xfeff)

const stripBom = (raw: string): string =>
  raw.startsWith(BYTE_ORDER_MARK) ? raw.slice(BYTE_ORDER_MARK.length) : raw

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

// Builds a clean Session rather than asserting the shape of whatever is on disk,
// so older files are upgraded on read instead of being rejected.
const toSession = (value: unknown): Session | null => {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string') return null
  if (typeof value.startedAt !== 'number') return null
  if (value.endedAt !== null && typeof value.endedAt !== 'number') return null

  return {
    id: value.id,
    startedAt: value.startedAt,
    endedAt: typeof value.endedAt === 'number' ? value.endedAt : null,
    // Files written before jobs existed have no job field. Treating a missing
    // job as untitled upgrades them; requiring it would discard every one.
    job: typeof value.job === 'string' ? normaliseJob(value.job) : ''
  }
}

const isBlock = (value: unknown): value is Block =>
  isRecord(value) &&
  typeof value.sessionId === 'string' &&
  typeof value.startedAt === 'number' &&
  typeof value.clicks === 'number'

const isShot = (value: unknown): value is Shot =>
  isRecord(value) &&
  typeof value.sessionId === 'string' &&
  typeof value.takenAt === 'number' &&
  typeof value.fileName === 'string'

// The file is user-editable and survives upgrades, so treat it as untrusted:
// keep the rows that parse and drop the rest rather than crashing on startup.
const parseData = (raw: string): TrackerData => {
  // Notepad and PowerShell write UTF-8 with a byte order mark, and JSON.parse
  // throws on it. Without this, saving the file from an editor quarantines it and
  // the app starts empty.
  const parsed: unknown = JSON.parse(stripBom(raw))
  if (!isRecord(parsed)) return emptyData()

  return {
    version: 1,
    sessions: Array.isArray(parsed.sessions)
      ? parsed.sessions.map(toSession).filter((session): session is Session => session !== null)
      : [],
    blocks: Array.isArray(parsed.blocks) ? parsed.blocks.filter(isBlock) : [],
    shots: Array.isArray(parsed.shots) ? parsed.shots.filter(isShot) : []
  }
}

export const createFileStorage = (filePath: string): Storage => {
  // Saves are serialised and each write gets its own temp file. Two overlapping
  // saves - a tick flush and a screenshot flush landing together - otherwise
  // share one temp name, and the second rename fails because the first already
  // moved it. Serialising also keeps the newest snapshot last.
  let pending: Promise<void> = Promise.resolve()
  let writes = 0

  const writeOnce = async (data: TrackerData): Promise<void> => {
    await mkdir(dirname(filePath), { recursive: true })
    writes += 1
    const temp = `${filePath}.${process.pid}.${writes}.tmp`
    await writeFile(temp, JSON.stringify(data, null, 2), 'utf8')
    await rename(temp, filePath)
  }

  return {
    load: async (): Promise<TrackerData> => {
      try {
        return parseData(await readFile(filePath, 'utf8'))
      } catch (error) {
        if (isRecord(error) && error.code === 'ENOENT') return emptyData()

        // Keep the unreadable file instead of overwriting it, so nothing is lost.
        const quarantine = `${filePath}.corrupt-${Date.now()}`
        console.error(`Could not read ${filePath}, moving it to ${quarantine}`)
        await rename(filePath, quarantine).catch(() => undefined)
        return emptyData()
      }
    },

    // Write to a temp file and rename it into place: a crash partway through a
    // write then leaves the previous file intact rather than a truncated one.
    save: (data: TrackerData): Promise<void> => {
      const result = pending.then(
        () => writeOnce(data),
        () => writeOnce(data)
      )
      // Keep the chain usable after a failed write without swallowing the error
      // from the caller that owns this save.
      pending = result.catch(() => undefined)
      return result
    }
  }
}

export const dataFilePath = (userDataPath: string): string =>
  join(userDataPath, 'work-tracker.json')

export const screenshotDirPath = (userDataPath: string): string => join(userDataPath, 'screenshots')
