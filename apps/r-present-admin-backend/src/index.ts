import { serve } from '@hono/node-server'
import { Hono, type Context } from 'hono'
import { logger } from 'hono/logger'
import { listChanges } from './changes.js'
import { config } from './config.js'
import { initPublishedRef } from './git.js'
import {
  createEntry,
  deleteEntry,
  listCollections,
  listEntries,
  loadSchemas,
  NotFoundError,
  saveEntry,
  ValidationError,
} from './content.js'
import { getPreviewStatus, initPreview, startPreview } from './preview.js'
import { getPublishStatus, isPublishing, startPublish } from './publish.js'

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

const busy = 'Publishing is in progress. Try again in a moment.'

async function jsonObject(c: Context): Promise<Record<string, unknown>> {
  const body: unknown = await c.req.json()
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ValidationError([{ field: '(root)', message: 'Body must be a JSON object' }])
  }
  return body as Record<string, unknown>
}

app.put('/collections/:collection/entries/:id', async (c) => {
  if (isPublishing()) return c.json({ error: busy }, 409)
  const entry = await saveEntry(c.req.param('collection'), c.req.param('id'), await jsonObject(c))
  return c.json(entry)
})

// Body: { id, data }
app.post('/collections/:collection/entries', async (c) => {
  if (isPublishing()) return c.json({ error: busy }, 409)
  const body = await jsonObject(c)
  const { id, data } = body
  if (typeof id !== 'string' || typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new ValidationError([{ field: '(root)', message: 'Body must be { id, data }' }])
  }
  const entry = await createEntry(c.req.param('collection'), id, data as Record<string, unknown>)
  return c.json(entry, 201)
})

app.delete('/collections/:collection/entries/:id', async (c) => {
  if (isPublishing()) return c.json({ error: busy }, 409)
  await deleteEntry(c.req.param('collection'), c.req.param('id'))
  return c.body(null, 204)
})

app.get('/changes', async (c) => c.json(await listChanges()))

app.get('/publish', (c) => c.json(getPublishStatus()))

app.post('/publish', (c) => c.json(startPublish(), 202))

app.get('/preview', async (c) => c.json(await getPreviewStatus()))

app.post('/preview', async (c) => c.json(await startPreview(), 202))

await loadSchemas()
await initPublishedRef()
await initPreview()

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`r-present-admin-backend listening on :${info.port}`)
  console.log(`editing site at ${config.siteDir}`)
})
