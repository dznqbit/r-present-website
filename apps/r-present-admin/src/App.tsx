import { useCallback, useEffect, useState } from 'react'
import { api, type Change, type Collection, type Entry } from './api'
import { EntryEditor } from './EntryEditor'
import { Home } from './Home'
import { PreviewButton } from './PreviewButton'
import { PublishControl } from './PublishControl'
import { Sidebar } from './Sidebar'

const UNSAVED_PROMPT = 'You have unsaved changes. Discard them?'

function App() {
  const [collections, setCollections] = useState<Collection[]>([])
  // null = the index page.
  const [active, setActive] = useState<string | null>(null)
  const [entriesBy, setEntriesBy] = useState<Record<string, Entry[] | undefined>>({})
  // Expanded sidebar sections. Navigating opens the target section; the user
  // can close it (or open others) freely afterwards.
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [contentVersion, setContentVersion] = useState(0)
  // Bumped when content changes underneath the form (discard), forcing a remount.
  const [resetVersion, setResetVersion] = useState(0)
  const [changes, setChanges] = useState<Change[]>([])
  const [error, setError] = useState<string | null>(null)

  const loadEntries = useCallback((names: string[]) => {
    for (const name of names) {
      api
        .entries(name)
        .then((es) => setEntriesBy((prev) => ({ ...prev, [name]: es })))
        .catch((err: unknown) => setError(String(err)))
    }
  }, [])

  useEffect(() => {
    api
      .collections()
      .then((cs) => {
        setCollections(cs)
        loadEntries(cs.map((c) => c.name))
      })
      .catch((err: unknown) => setError(`Couldn't reach the backend: ${String(err)}`))
  }, [loadEntries])

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

  const onSaved = useCallback(
    (saved: Entry, created: boolean) => {
      if (!active) return
      setEntriesBy((prev) => {
        const es = prev[active] ?? []
        return {
          ...prev,
          [active]: created
            ? [...es, saved].sort((a, b) => a.id.localeCompare(b.id))
            : es.map((e) => (e.id === saved.id ? saved : e)),
        }
      })
      if (created) {
        setCreating(false)
        setSelectedId(saved.id)
      }
      setContentVersion((v) => v + 1)
    },
    [active],
  )

  const onDeleted = useCallback(
    (id: string) => {
      if (!active) return
      setEntriesBy((prev) => ({ ...prev, [active]: (prev[active] ?? []).filter((e) => e.id !== id) }))
      setSelectedId(null)
      setContentVersion((v) => v + 1)
    },
    [active],
  )

  const reloadAll = useCallback(
    () => loadEntries(collections.map((c) => c.name)),
    [collections, loadEntries],
  )

  const onPublishFinished = useCallback(() => {
    // Refresh the unpublished list and the preview status (publish may have
    // rebuilt it and pulled down edits made on GitHub).
    setContentVersion((v) => v + 1)
    reloadAll()
  }, [reloadAll])

  const onDiscarded = useCallback(() => {
    // The form's draft is gone along with everything else; reload from disk.
    setDirty(false)
    setCreating(false)
    setResetVersion((v) => v + 1)
    setContentVersion((v) => v + 1)
    reloadAll()
  }, [reloadAll])

  /** Switch to a collection, optionally opening an entry or a blank new one. */
  const go = (collection: string | null, opts: { id?: string; create?: boolean } = {}) =>
    guard(() => {
      setActive(collection)
      setSelectedId(opts.id ?? null)
      setCreating(opts.create ?? false)
      if (collection) setOpen((prev) => (prev.has(collection) ? prev : new Set(prev).add(collection)))
    })

  const toggle = (collection: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(collection)) next.delete(collection)
      else next.add(collection)
      return next
    })

  const changed = (collection: string, id?: string) =>
    changes.some((c) => c.collection === collection && (id === undefined || c.id === id))

  const collection = collections.find((c) => c.name === active)
  const selected = active ? entriesBy[active]?.find((e) => e.id === selectedId) : undefined

  return (
    <div className="app">
      <header className="topbar">
        <h1>
          <button type="button" className="home-link" onClick={() => active !== null && go(null)}>
            R. Present Admin
          </button>
        </h1>
        <div className="topbar-right">
          <PreviewButton contentVersion={contentVersion} />
          {/* Publish is the final step, so it sits at the far right. */}
          <PublishControl
            changes={changes}
            editorDirty={dirty}
            onFinished={onPublishFinished}
            onDiscarded={onDiscarded}
          />
        </div>
      </header>

      {error && <p className="banner err">{error}</p>}

      <div className="layout">
        <aside className="list">
          <Sidebar
            collections={collections}
            entriesBy={entriesBy}
            open={open}
            onToggle={toggle}
            active={active}
            selectedId={selectedId}
            creating={creating}
            isChanged={changed}
            onOpen={(c, id) => go(c, { id })}
            onCreate={(c) => go(c, { create: true })}
          />
        </aside>

        {active === null ? (
          <main className="home-main">
            <Home
              contentVersion={contentVersion}
              isChanged={(c, id) => changed(c, id)}
              onOpen={(c, id) => go(c, { id })}
              onCreate={(c) => go(c, { create: true })}
            />
          </main>
        ) : (
          <main className="detail">
            {collection && (selected || creating) ? (
              <EntryEditor
                // Remount per entry so form state resets cleanly.
                key={`${collection.name}/${creating ? '+new' : selected?.id}/${resetVersion}`}
                collection={collection.name}
                schema={collection.schema}
                hidden={collection.writeOnce}
                fixed={collection.fixed}
                entry={creating ? null : (selected ?? null)}
                onSaved={onSaved}
                onDeleted={onDeleted}
                onDirtyChange={setDirty}
              />
            ) : (
              <p className="muted">Pick something on the left to edit.</p>
            )}
          </main>
        )}
      </div>
    </div>
  )
}

export default App
