import { useCallback, useEffect, useState } from 'react'
import { api, type Change, type Collection, type Entry } from './api'
import { EntryEditor } from './EntryEditor'
import { PreviewButton } from './PreviewButton'
import { PublishControl } from './PublishControl'

const UNSAVED_PROMPT = 'You have unsaved changes. Discard them?'

function App() {
  const [collections, setCollections] = useState<Collection[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [contentVersion, setContentVersion] = useState(0)
  const [changes, setChanges] = useState<Change[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .collections()
      .then((cs) => {
        setCollections(cs)
        setActive(cs.find((c) => c.name === 'products')?.name ?? cs[0]?.name ?? null)
      })
      .catch((err: unknown) => setError(`Couldn't reach the backend: ${String(err)}`))
  }, [])

  useEffect(() => {
    if (!active) return
    api
      .entries(active)
      .then(setEntries)
      .catch((err: unknown) => setError(String(err)))
  }, [active])

  // Saved-but-unpublished edits, refreshed after every save.
  useEffect(() => {
    api
      .changes()
      .then(setChanges)
      .catch((err: unknown) => setError(String(err)))
  }, [contentVersion])

  // Warn before closing the tab with unsaved edits.
  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  const guard = (action: () => void) => {
    if (dirty && !window.confirm(UNSAVED_PROMPT)) return
    setDirty(false)
    action()
  }

  const onSaved = useCallback((saved: Entry, created: boolean) => {
    setEntries((es) =>
      created
        ? [...es, saved].sort((a, b) => a.id.localeCompare(b.id))
        : es.map((e) => (e.id === saved.id ? saved : e)),
    )
    if (created) {
      setCreating(false)
      setSelectedId(saved.id)
    }
    setContentVersion((v) => v + 1)
  }, [])

  const onDeleted = useCallback((id: string) => {
    setEntries((es) => es.filter((e) => e.id !== id))
    setSelectedId(null)
    setContentVersion((v) => v + 1)
  }, [])

  const onPublishFinished = useCallback(() => {
    // Refresh the unpublished list and the preview status (publish may have
    // rebuilt it and pulled down edits made on GitHub).
    setContentVersion((v) => v + 1)
    if (active) api.entries(active).then(setEntries).catch(() => {})
  }, [active])

  const changed = (collection: string, id?: string) =>
    changes.some((c) => c.collection === collection && (id === undefined || c.id === id))

  const collection = collections.find((c) => c.name === active)
  const selected = entries.find((e) => e.id === selectedId)

  return (
    <div className="app">
      <header className="topbar">
        <h1>R. Present Admin</h1>
        <nav className="tabs">
          {collections.map((c) => (
            <button
              key={c.name}
              type="button"
              className={c.name === active ? 'tab active' : 'tab'}
              onClick={() =>
                c.name !== active &&
                guard(() => {
                  setEntries([])
                  setSelectedId(null)
                  setCreating(false)
                  setActive(c.name)
                })
              }
            >
              {c.name}
              {changed(c.name) && <UnpublishedDot />}
            </button>
          ))}
        </nav>
        <div className="topbar-right">
          <PublishControl changes={changes} editorDirty={dirty} onFinished={onPublishFinished} />
          <PreviewButton contentVersion={contentVersion} />
        </div>
      </header>

      {error && <p className="banner err">{error}</p>}

      <div className="layout">
        <aside className="list">
          {collection && (
            <button
              type="button"
              className={creating ? 'list-item new-item active' : 'list-item new-item'}
              onClick={() =>
                !creating &&
                guard(() => {
                  setSelectedId(null)
                  setCreating(true)
                })
              }
            >
              + New {collection.name.replace(/s$/, '')}
            </button>
          )}
          {entries.map((e) => (
            <button
              key={e.id}
              type="button"
              className={e.id === selectedId ? 'list-item active' : 'list-item'}
              onClick={() =>
                e.id !== selectedId &&
                guard(() => {
                  setCreating(false)
                  setSelectedId(e.id)
                })
              }
            >
              <span className="list-item-name">
                {typeof e.data.name === 'string' ? e.data.name : e.id}
                {active && changed(active, e.id) && <UnpublishedDot />}
              </span>
              {e.data.available === false && <span className="badge">sold</span>}
            </button>
          ))}
        </aside>

        <main className="detail">
          {collection && (selected || creating) ? (
            <EntryEditor
              // Remount per entry so form state resets cleanly.
              key={`${collection.name}/${creating ? '+new' : selected?.id}`}
              collection={collection.name}
              schema={collection.schema}
              hidden={collection.writeOnce}
              entry={creating ? null : (selected ?? null)}
              onSaved={onSaved}
              onDeleted={onDeleted}
              onDirtyChange={setDirty}
            />
          ) : (
            <p className="muted">Pick something on the left to edit.</p>
          )}
        </main>
      </div>
    </div>
  )
}

function UnpublishedDot() {
  return <span className="dot" title="Edited, not published yet" aria-label="unpublished changes" />
}

export default App
