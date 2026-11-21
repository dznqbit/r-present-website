import { useEffect, useState } from 'react'

type Health = { ok: boolean; siteDir: string }

function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/health')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<Health>
      })
      .then(setHealth)
      .catch((err: unknown) => setError(String(err)))
  }, [])

  return (
    <main>
      <h1>R. Present Admin</h1>
      {error && <p>Backend unreachable: {error}</p>}
      {health && <p>Backend OK — editing site at <code>{health.siteDir}</code></p>}
      {!health && !error && <p>Checking backend…</p>}
    </main>
  )
}

export default App
