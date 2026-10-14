import { useCallback, useEffect, useState } from 'react'
import { formatDuration } from '../../core/time'
import type { ActivitySource, ShotView, Status } from '../../preload/api'

const formatClock = (ts: number): string =>
  new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

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

  useEffect(() => {
    void window.workTracker.status().then(setStatus)
    return window.workTracker.onChange(setStatus)
  }, [])

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
      setStatus(status?.isTracking === true ? await tracker.stop() : await tracker.start())
    } finally {
      setBusy(false)
    }
  }, [status?.isTracking])

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
