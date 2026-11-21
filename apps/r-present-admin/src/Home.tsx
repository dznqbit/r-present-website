import { useEffect, useState } from 'react'
import { api, type Entry } from './api'
import { UnpublishedDot } from './UnpublishedDot'

type Props = {
  /** Bumped after saves/publishes so the lists stay current. */
  contentVersion: number
  isChanged: (collection: string, id: string) => boolean
  onOpen: (collection: string, id: string) => void
  onCreate: (collection: string) => void
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

/**
 * "2027-01-16" is a calendar day, not an instant, so parse it as local midnight.
 * Exactly-midnight-UTC timestamps ("2024-11-10T00:00:00.000Z", as the older
 * products have) are the same thing written differently. Read as instants
 * they'd show as the day before in Seattle.
 */
function parseDay(value: unknown): Date | null {
  const s = str(value)
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T00:00:00(?:\.0+)?Z)?$/.exec(s)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

const startOfToday = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function relativeDay(day: Date): string {
  const days = Math.round((day.getTime() - startOfToday().getTime()) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days < 7) return `In ${days} days`
  if (days < 14) return 'Next week'
  return `In ${Math.round(days / 7)} weeks`
}

const formatDay = (d: Date, withWeekday = true) =>
  d.toLocaleDateString(undefined, {
    ...(withWeekday ? { weekday: 'short' as const } : {}),
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

export function Home({ contentVersion, isChanged, onOpen, onCreate }: Props) {
  const [markets, setMarkets] = useState<Entry[] | null>(null)
  const [products, setProducts] = useState<Entry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([api.entries('markets'), api.entries('products')])
      .then(([m, p]) => {
        setMarkets(m)
        setProducts(p)
      })
      .catch((err: unknown) => setError(String(err)))
  }, [contentVersion])

  if (error) return <p className="err">{error}</p>

  const today = startOfToday()
  const upcoming = (markets ?? [])
    .map((e) => ({ entry: e, day: parseDay(e.data.date) }))
    .filter((m): m is { entry: Entry; day: Date } => m.day !== null && m.day >= today)
    .sort((a, b) => a.day.getTime() - b.day.getTime())

  const newestFirst = [...(products ?? [])].sort(
    (a, b) => (parseDay(b.data.createdAt)?.getTime() ?? 0) - (parseDay(a.data.createdAt)?.getTime() ?? 0),
  )

  return (
    <div className="home">
      <section className="home-section">
        <header className="home-section-header">
          <h2>Upcoming Markets</h2>
          <button type="button" className="text-btn" onClick={() => onCreate('markets')}>
            + New market
          </button>
        </header>
        {markets === null ? (
          <p className="muted">Loading…</p>
        ) : upcoming.length === 0 ? (
          <p className="muted">No upcoming markets.</p>
        ) : (
          <ul className="home-list">
            {upcoming.map(({ entry, day }) => (
              <li key={entry.id}>
                <button type="button" className="home-row" onClick={() => onOpen('markets', entry.id)}>
                  <span className="market-date">
                    <span className="market-when">{relativeDay(day)}</span>
                    <span className="muted">{formatDay(day)}</span>
                  </span>
                  <span className="home-row-main">
                    <span className="home-row-title">
                      {str(entry.data.name) || entry.id}
                      {isChanged('markets', entry.id) && <UnpublishedDot />}
                    </span>
                    <span className="muted">
                      {[str(entry.data.timeDescription), str(entry.data.location)].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="home-section">
        <header className="home-section-header">
          <h2>Products</h2>
          <button type="button" className="text-btn" onClick={() => onCreate('products')}>
            + New product
          </button>
        </header>
        {products === null ? (
          <p className="muted">Loading…</p>
        ) : newestFirst.length === 0 ? (
          <p className="muted">No products yet.</p>
        ) : (
          <ul className="home-list">
            {newestFirst.map((entry) => {
              const images = Array.isArray(entry.data.images) ? entry.data.images : []
              const thumb = typeof images[0] === 'string' ? images[0] : null
              const price = typeof entry.data.price === 'number' ? `$${entry.data.price}` : null
              const added = parseDay(entry.data.createdAt)
              return (
                <li key={entry.id}>
                  <button type="button" className="home-row" onClick={() => onOpen('products', entry.id)}>
                    {thumb ? (
                      <img className="thumb" src={thumb} alt="" loading="lazy" />
                    ) : (
                      <span className="thumb thumb-empty" aria-hidden="true" />
                    )}
                    <span className="home-row-main">
                      <span className="home-row-title">
                        {str(entry.data.name) || entry.id}
                        {isChanged('products', entry.id) && <UnpublishedDot />}
                      </span>
                      <span className="muted">
                        {[str(entry.data.category), price].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className="home-row-end">
                      {entry.data.available === false && <span className="badge">sold</span>}
                      {added && <span className="muted small">Added {formatDay(added, false)}</span>}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
