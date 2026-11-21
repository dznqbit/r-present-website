import { useEffect, useRef, useState } from 'react'
import { api, type Change, type PublishStatus } from './api'
import { timeAgo } from './time'

const POLL_MS = 1500

type Props = {
  /** Saved edits that aren't live yet. */
  changes: Change[]
  /** True when the open form has unsaved edits (they won't be published). */
  editorDirty: boolean
  /** Called when a publish finishes, so the app can refresh changes and preview. */
  onFinished: () => void
}

export function PublishControl({ changes, editorDirty, onFinished }: Props) {
  const [status, setStatus] = useState<PublishStatus | null>(null)
  const [requestError, setRequestError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  // Pick up an in-progress publish (e.g. started from another tab) on load.
  useEffect(() => {
    api
      .publishStatus()
      .then(setStatus)
      .catch((err: unknown) => setRequestError(String(err)))
  }, [])

  const publishing = status?.state === 'publishing'

  // Poll while publishing.
  useEffect(() => {
    if (!publishing) return
    const timer = window.setInterval(() => {
      api
        .publishStatus()
        .then(setStatus)
        .catch((err: unknown) => setRequestError(String(err)))
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [publishing])

  // Tell the app when a publish finishes so it refreshes the unpublished list.
  const wasPublishing = useRef(false)
  useEffect(() => {
    if (wasPublishing.current && !publishing) onFinished()
    wasPublishing.current = publishing
  }, [publishing, onFinished])

  // Keep "published N min ago" fresh.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const start = () => {
    const list = changes.map((c) => `• ${c.collection}/${c.id} (${c.change})`).join('\n')
    const noun = changes.length === 1 ? 'change' : 'changes'
    const unsaved = editorDirty ? "\n\nHeads up: the form you're editing has unsaved changes. They won't be included." : ''
    if (!window.confirm(`Publish ${changes.length} ${noun} to r-present.com?\n\n${list}${unsaved}`)) return
    setRequestError(null)
    api
      .startPublish()
      .then(setStatus)
      .catch((err: unknown) => setRequestError(String(err)))
  }

  if (publishing) {
    return (
      <div className="publish" role="status" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <span>Publishing… {status?.step ?? ''}</span>
      </div>
    )
  }

  const count = changes.length
  const failed = status?.state === 'failed'

  return (
    <div className="publish">
      {count > 0 && (
        <span
          className="unpublished"
          title={changes.map((c) => `${c.collection}/${c.id} (${c.change})`).join('\n')}
        >
          <span className="dot" aria-hidden="true" />
          {count} unpublished {count === 1 ? 'change' : 'changes'}
        </span>
      )}

      {failed && status.error && (
        <details className="popover">
          <summary className="err">Publish failed</summary>
          <div className="popover-body">
            <p>{status.error}</p>
            {status.log && status.log.length > 0 && <pre>{status.log.join('\n')}</pre>}
          </div>
        </details>
      )}

      {requestError && <span className="err">Couldn't reach the server</span>}

      {count > 0 && (
        <button type="button" className="publish-btn" onClick={start}>
          {failed ? 'Try again' : 'Publish'}
        </button>
      )}

      {count === 0 && status?.state === 'published' && status.finishedAt && (
        <span className="ok published">
          ✓ Published {timeAgo(status.finishedAt, now)}
          {status.commit?.url && (
            <>
              {' · '}
              <a href={status.commit.url} target="_blank" rel="noreferrer">
                details
              </a>
            </>
          )}
          <span className="muted"> · live on r-present.com in a few minutes</span>
        </span>
      )}
    </div>
  )
}
