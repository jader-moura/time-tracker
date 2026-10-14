import { useCallback, useEffect, useState } from 'react'
import { formatDuration, startOfLocalDay } from '../../core/time'
import type { ActivitySource, DayTotal, ShotView, Status } from '../../preload/api'

// How often the history list is refreshed while a session is running. The list
// changes slowly, so it is fetched rather than pushed with every tick.
const HISTORY_REFRESH_MS = 30000

const formatClock = (ts: number): string =>
  new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

const formatDayLabel = (dayStart: number, now: number): string => {
  const today = startOfLocalDay(now)
  if (dayStart === today) return 'Today'
  if (dayStart === startOfLocalDay(today - 1)) return 'Yesterday'

  return new Date(dayStart).toLocaleDateString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  })
}

const activityLabel = (source: ActivitySource): string => {
  if (source === 'clicks') return 'Clicks'
  // Idle sampling measures presence, not clicks, so it must not claim to be a click
  // count. 'none' means no counter could be installed at all.
  if (source === 'idle') return 'Active samples'
  return 'Counting unavailable'
}

export const App = (): React.JSX.Element => {
  const [status, setStatus] = useState<Status | null>(null)
  const [shot, setShot] = useState<ShotView | null>(null)
  const [busy, setBusy] = useState(false)
  const [job, setJob] = useState('')
  // Pre-fill once from the last job used, then leave the field alone so a tick
  // arriving mid-typing cannot overwrite what is being typed.
  const [jobPrefilled, setJobPrefilled] = useState(false)

  useEffect(() => {
    void window.workTracker.status().then(setStatus)
    return window.workTracker.onChange(setStatus)
  }, [])

  useEffect(() => {
    if (status === null || jobPrefilled) return

    setJob(status.isTracking ? status.job : status.lastJob)
    setJobPrefilled(true)
  }, [status, jobPrefilled])

  const [history, setHistory] = useState<DayTotal[]>([])
  const tracking = status?.isTracking ?? false

  // Refetched when tracking starts or stops, and slowly while it runs so today's
  // row keeps up without putting the whole list on the one-second tick.
  useEffect(() => {
    const refresh = (): void => void window.workTracker.history().then(setHistory)
    refresh()

    if (!tracking) return

    const timer = setInterval(refresh, HISTORY_REFRESH_MS)
    return () => clearInterval(timer)
  }, [tracking])

  const lastShotAt = status?.lastShotAt ?? null

  // Only fetch the image when a new one exists, which is why the tick payload
  // carries the timestamp rather than the picture.
  useEffect(() => {
    if (lastShotAt === null) {
      setShot(null)
      return
    }
    void window.workTracker.thumbnail().then(setShot)
  }, [lastShotAt])

  const toggle = useCallback(async () => {
    setBusy(true)
    try {
      const tracker = window.workTracker
      const next = status?.isTracking === true ? await tracker.stop() : await tracker.start(job)
      setStatus(next)
      // Main normalises the job, so show what was actually recorded.
      setJob(next.isTracking ? next.job : next.lastJob)
    } finally {
      setBusy(false)
    }
  }, [status?.isTracking, job])

  if (status === null) {
    return (
      <main className="app">
        <p className="muted">Loading…</p>
      </main>
    )
  }

  const blocks = [...status.blocks].reverse()
  const busiest = Math.max(1, ...status.blocks.map((block) => block.clicks))

  return (
    <main className="app">
      <header>
        <h1>Work Tracker</h1>
        {status.isTracking && (
          <span className="badge" role="status">
            <span className="dot" aria-hidden="true" />
            Tracking
          </span>
        )}
      </header>

      <label className="job">
        <span className="label">Job</span>
        <input
          type="text"
          value={job}
          placeholder="What are you working on?"
          maxLength={80}
          disabled={status.isTracking || busy}
          onChange={(event) => setJob(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !status.isTracking) void toggle()
          }}
        />
      </label>

      <section className="times">
        <div>
          <span className="label">This session</span>
          <span className="elapsed">{formatDuration(status.sessionElapsedMs)}</span>
        </div>
        <div>
          <span className="label">Today</span>
          <span className="total">{formatDuration(status.todayTotalMs)}</span>
        </div>
      </section>

      <button className={status.isTracking ? 'stop' : 'start'} onClick={toggle} disabled={busy}>
        {status.isTracking ? 'Stop' : 'Start'}
      </button>

      <section>
        <h2>
          {activityLabel(status.activitySource)}
          <span className="muted"> · {status.totalClicks} this session</span>
        </h2>
        {blocks.length === 0 ? (
          <p className="muted">No activity yet.</p>
        ) : (
          <ul className="blocks">
            {blocks.map((block) => (
              <li key={block.startedAt}>
                <span className="time">{formatClock(block.startedAt)}</span>
                <span className="bar" style={{ width: `${(block.clicks / busiest) * 100}%` }} />
                <span className="count">{block.clicks}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Last 7 days</h2>
        {history.length === 0 ? (
          <p className="muted">Nothing tracked yet.</p>
        ) : (
          <ul className="history">
            {history.map((entry) => (
              <li key={entry.dayStart}>
                <div className="day">
                  <span>{formatDayLabel(entry.dayStart, Date.now())}</span>
                  <span className="dayTotal">{formatDuration(entry.totalMs)}</span>
                </div>
                <ul>
                  {entry.jobs.map((jobTotal) => (
                    <li key={jobTotal.job} className="jobRow">
                      <span className={jobTotal.job === '' ? 'muted' : undefined}>
                        {jobTotal.job === '' ? 'untitled' : jobTotal.job}
                      </span>
                      <span className="jobTotal">{formatDuration(jobTotal.totalMs)}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Last screenshot</h2>
        {shot === null ? (
          <p className="muted">
            {status.sessionStartedAt === null
              ? 'None this session.'
              : `First capture at ${formatClock(status.sessionStartedAt + status.intervalMs)}.`}
          </p>
        ) : (
          <figure>
            <img src={shot.dataUrl} alt="Most recent screenshot" />
            <figcaption className="muted">Taken at {formatClock(shot.takenAt)}</figcaption>
          </figure>
        )}
      </section>
    </main>
  )
}
