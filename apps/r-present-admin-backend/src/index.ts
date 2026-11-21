import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { config } from './config.js'
import {
  listCollections,
  listEntries,
  loadSchemas,
  NotFoundError,
  saveEntry,
  ValidationError,
} from './content.js'

const app = new Hono().basePath('/api')

app.use(logger())

app.onError((err, c) => {
  if (err instanceof ValidationError) return c.json({ error: err.message, errors: err.errors }, 400)
  if (err instanceof NotFoundError) return c.json({ error: err.message }, 404)
  console.error(err)
  return c.json({ error: 'Internal error' }, 500)
})

app.get('/health', (c) => c.json({ ok: true, siteDir: config.siteDir }))

app.get('/collections', (c) => c.json(listCollections()))

app.get('/collections/:collection/entries', async (c) =>
  c.json(await listEntries(c.req.param('collection'))),
)

app.put('/collections/:collection/entries/:id', async (c) => {
  const body: unknown = await c.req.json()
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ValidationError([{ field: '(root)', message: 'Body must be a JSON object' }])
  }
  const entry = await saveEntry(
    c.req.param('collection'),
    c.req.param('id'),
    body as Record<string, unknown>,
  )
  return c.json(entry)
})

await loadSchemas()

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`r-present-admin-backend listening on :${info.port}`)
  console.log(`editing site at ${config.siteDir}`)
})
