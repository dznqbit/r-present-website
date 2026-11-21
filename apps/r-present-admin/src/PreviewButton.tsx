import { useEffect, useState } from 'react'
import { api, type PreviewStatus } from './api'

const POLL_MS = 1500
const CLOCK_MS = 30_000

/** "just now", "4 min ago", "2 hr ago", or a date for anything older than a day. */
function timeAgo(iso: string, now: number): string {
  const seconds = Math.max(0, (now - Date.parse(iso)) / 1000)
  if (seconds < 45) return 'just now'
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`
  if (seconds < 86400) return `${Math.round(seconds / 3600)} hr ago`
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

type Props = {
  /** Bumped whenever content is saved, so we re-check whether the preview is stale. */
  contentVersion: number
}

export function PreviewButton({ contentVersion }: Props) {
  const [status, setStatus] = useState<PreviewStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  // Load status on mount and after every save.
  useEffect(() => {
    api
      .previewStatus()
      .then(setStatus)
      .catch((err: unknown) => setError(String(err)))
  }, [contentVersion])

  // While building, poll for completion and tick the elapsed-time counter.
  const building = status?.state === 'building'
  useEffect(() => {
    if (!building) return
    const timer = window.setInterval(() => {
      setNow(Date.now())
      api
        .previewStatus()
        .then(setStatus)
        .catch((err: unknown) => setError(String(err)))
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [building])

  // Keep "built N min ago" current while a preview is showing.
  const ready = status?.state === 'ready'
  useEffect(() => {
    if (!ready) return
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_MS)
    return () => window.clearInterval(timer)
  }, [ready])

  const start = () => {
    setError(null)
    setNow(Date.now())
    api
      .startPreview()
      .then(setStatus)
      .catch((err: unknown) => setError(String(err)))
  }

  if (error) {
    return (
      <div className="preview">
        <span className="err">Preview unavailable</span>
        <button type="button" className="preview-btn" onClick={start}>
          Try again
        </button>
      </div>
    )
  }

  if (!status) return <div className="preview" />

  if (status.state === 'building') {
    const elapsed = status.startedAt
      ? Math.max(0, Math.round((now - Date.parse(status.startedAt)) / 1000))
      : 0
    return (
      <div className="preview" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <span>Building preview… {elapsed}s</span>
      </div>
    )
  }

  if (status.state === 'ready') {
    // The preview is served at the root of its own port on the same host.
    const url = new URL(`${window.location.protocol}//${window.location.hostname}:${status.port}/`)
    // Bust any cached index.html from a previous build.
    if (status.finishedAt) url.searchParams.set('v', String(Date.parse(status.finishedAt)))
    return (
      <div className="preview">
        <a className="preview-link" href={url.toString()} target="_blank" rel="noreferrer">
          View preview ↗
        </a>
        {status.finishedAt && (
          <time
            className="muted built-at"
            dateTime={status.finishedAt}
            title={new Date(status.finishedAt).toLocaleString()}
          >
            built {timeAgo(status.finishedAt, now)}
          </time>
        )}
        {status.stale && <span className="muted">Out of date</span>}
        <button
          type="button"
          className={status.stale ? 'preview-btn' : 'preview-btn subtle'}
          onClick={start}
        >
          Rebuild
        </button>
      </div>
    )
  }

  if (status.state === 'failed') {
    return (
      <div className="preview">
        <details className="preview-failure">
          <summary className="err">Preview failed</summary>
          <pre>{status.log?.join('\n')}</pre>
        </details>
        <button type="button" className="preview-btn" onClick={start}>
          Try again
        </button>
      </div>
    )
  }

  return (
    <div className="preview">
      <button type="button" className="preview-btn" onClick={start}>
        Build preview
      </button>
    </div>
  )
}
