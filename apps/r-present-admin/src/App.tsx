import { useCallback, useEffect, useState } from 'react'
import { api, type Collection, type Entry } from './api'
import { EntryEditor } from './EntryEditor'
import { PreviewButton } from './PreviewButton'

const UNSAVED_PROMPT = 'You have unsaved changes. Discard them?'

function App() {
  const [collections, setCollections] = useState<Collection[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [contentVersion, setContentVersion] = useState(0)
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

  const onSaved = useCallback((saved: Entry) => {
    setEntries((es) => es.map((e) => (e.id === saved.id ? saved : e)))
    setContentVersion((v) => v + 1)
  }, [])

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
                  setActive(c.name)
                })
              }
            >
              {c.name}
            </button>
          ))}
        </nav>
        <PreviewButton contentVersion={contentVersion} />
      </header>

      {error && <p className="banner err">{error}</p>}

      <div className="layout">
        <aside className="list">
          {entries.map((e) => (
            <button
              key={e.id}
              type="button"
              className={e.id === selectedId ? 'list-item active' : 'list-item'}
              onClick={() => e.id !== selectedId && guard(() => setSelectedId(e.id))}
            >
              <span>{typeof e.data.name === 'string' ? e.data.name : e.id}</span>
              {e.data.available === false && <span className="badge">sold</span>}
            </button>
          ))}
        </aside>

        <main className="detail">
          {collection && selected ? (
            <EntryEditor
              // Remount per entry so form state resets cleanly.
              key={`${collection.name}/${selected.id}`}
              collection={collection.name}
              schema={collection.schema}
              entry={selected}
              onSaved={onSaved}
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

export default App
