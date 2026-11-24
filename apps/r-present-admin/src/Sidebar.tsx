import type { Collection, Entry } from './api'
import { UnpublishedDot } from './UnpublishedDot'

/** Sidebar order; anything not listed (a future collection) goes last, A–Z. */
const ORDER = ['products', 'projects', 'markets', 'pages']

const rank = (name: string) => {
  const i = ORDER.indexOf(name)
  return i === -1 ? ORDER.length : i
}

export const sortCollections = (cs: Collection[]) =>
  [...cs].sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name))

type Props = {
  collections: Collection[]
  entriesBy: Record<string, Entry[] | undefined>
  /** Sections the user has expanded. */
  open: Set<string>
  onToggle: (collection: string) => void
  active: string | null
  selectedId: string | null
  creating: boolean
  isChanged: (collection: string, id?: string) => boolean
  onOpen: (collection: string, id: string) => void
  onCreate: (collection: string) => void
}

export function Sidebar({
  collections,
  entriesBy,
  open,
  onToggle,
  active,
  selectedId,
  creating,
  isChanged,
  onOpen,
  onCreate,
}: Props) {
  return (
    <nav className="sidebar" aria-label="Content">
      {sortCollections(collections).map((c) => {
        const expanded = open.has(c.name)
        const entries = entriesBy[c.name]
        const bodyId = `section-${c.name}`
        return (
          <section key={c.name} className="sidebar-section">
            <button
              type="button"
              className={c.name === active ? 'section-header current' : 'section-header'}
              aria-expanded={expanded}
              aria-controls={bodyId}
              onClick={() => onToggle(c.name)}
            >
              <span className="chevron" aria-hidden="true">
                ›
              </span>
              <span className="section-title">{c.name}</span>
              {isChanged(c.name) && <UnpublishedDot />}
              {entries && <span className="section-count muted">{entries.length}</span>}
            </button>

            {expanded && (
              <div id={bodyId} className="section-body">
                {!c.fixed && (
                  <button
                    type="button"
                    className={
                      c.name === active && creating ? 'list-item new-item active' : 'list-item new-item'
                    }
                    onClick={() => !(c.name === active && creating) && onCreate(c.name)}
                  >
                    + New {c.name.replace(/s$/, '')}
                  </button>
                )}
                {entries === undefined ? (
                  <p className="muted small section-note">Loading…</p>
                ) : entries.length === 0 ? (
                  <p className="muted small section-note">Nothing here yet.</p>
                ) : (
                  entries.map((e) => {
                    const current = c.name === active && e.id === selectedId
                    return (
                      <button
                        key={e.id}
                        type="button"
                        className={current ? 'list-item active' : 'list-item'}
                        aria-current={current ? 'page' : undefined}
                        onClick={() => !current && onOpen(c.name, e.id)}
                      >
                        <span className="list-item-name">
                          {typeof e.data.name === 'string' ? e.data.name : e.id}
                          {isChanged(c.name, e.id) && <UnpublishedDot />}
                        </span>
                        {e.data.available === false && <span className="badge">sold</span>}
                      </button>
                    )
                  })
                )}
              </div>
            )}
          </section>
        )
      })}
    </nav>
  )
}
