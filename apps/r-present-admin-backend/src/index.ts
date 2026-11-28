import { serve } from '@hono/node-server'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { logger } from 'hono/logger'
import fs from 'node:fs/promises'
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
import { discardChanges, getPublishStatus, isBusy, PublishError, startPublish } from './publish.js'
import {
  localUploadPath,
  parseCrop,
  recropImage,
  UnsupportedImageError,
  uploadImage,
  usingLocalUploads,
} from './uploads.js'

const app = new Hono().basePath('/api')

app.use(logger())

app.onError((err, c) => {
  if (err instanceof ValidationError) return c.json({ error: err.message, errors: err.errors }, 400)
  if (err instanceof NotFoundError) return c.json({ error: err.message }, 404)
  if (err instanceof UnsupportedImageError) return c.json({ error: err.message }, 400)
  if (err instanceof PublishError) return c.json({ error: err.message, detail: err.detail }, 409)
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
  if (isBusy()) return c.json({ error: busy }, 409)
  const entry = await saveEntry(c.req.param('collection'), c.req.param('id'), await jsonObject(c))
  return c.json(entry)
})

// Body: { id, data }
app.post('/collections/:collection/entries', async (c) => {
  if (isBusy()) return c.json({ error: busy }, 409)
  const body = await jsonObject(c)
  const { id, data } = body
  if (typeof id !== 'string' || typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new ValidationError([{ field: '(root)', message: 'Body must be { id, data }' }])
  }
  const entry = await createEntry(c.req.param('collection'), id, data as Record<string, unknown>)
  return c.json(entry, 201)
})

app.delete('/collections/:collection/entries/:id', async (c) => {
  if (isBusy()) return c.json({ error: busy }, 409)
  await deleteEntry(c.req.param('collection'), c.req.param('id'))
  return c.body(null, 204)
})

// Multipart form with a "file" field and an optional "crop" field (JSON crop
// box, percentages). ?collection=products decides the folder and the shape.
app.post(
  '/uploads',
  bodyLimit({
    maxSize: config.uploads.maxBytes,
    onError: (c) => c.json({ error: 'That photo is too big (30MB max).' }, 413),
  }),
  async (c) => {
    const collection = c.req.query('collection') ?? ''
    const form = await c.req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return c.json({ error: 'No file was sent.' }, 400)
    const rawCrop = form.get('crop')
    const crop = typeof rawCrop === 'string' && rawCrop ? parseCrop(rawCrop) : null
    const uploaded = await uploadImage(collection, Buffer.from(await file.arrayBuffer()), crop)
    return c.json(uploaded, 201)
  },
)

// Re-crop a photo that's already uploaded: { collection, url, crop }. Stores
// the result as a new photo and returns it; the original is left alone.
app.post('/uploads/recrop', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { collection?: unknown; url?: unknown; crop?: unknown } | null
  if (!body || typeof body.collection !== 'string' || typeof body.url !== 'string') {
    return c.json({ error: 'Body must be { collection, url, crop }' }, 400)
  }
  return c.json(await recropImage(body.collection, body.url, parseCrop(body.crop)), 201)
})

// Serves locally stored uploads (development only, when S3 isn't configured).
app.get('/media/*', async (c) => {
  if (!usingLocalUploads()) return c.notFound()
  const file = localUploadPath(c.req.path.replace(/^\/api\/media\//, ''))
  if (!file) return c.notFound()
  try {
    return c.body(await fs.readFile(file), 200, { 'Content-Type': 'image/jpeg' })
  } catch {
    return c.notFound()
  }
})

app.get('/changes', async (c) => c.json(await listChanges()))

app.get('/publish', (c) => c.json(getPublishStatus()))

app.post('/publish', (c) => {
  if (isBusy() && getPublishStatus().state !== 'publishing') return c.json({ error: busy }, 409)
  return c.json(startPublish(), 202)
})

// Throw away all unpublished edits and match what's live on GitHub.
app.post('/discard', async (c) => c.json(await discardChanges()))

app.get('/preview', async (c) => c.json(await getPreviewStatus()))

app.post('/preview', async (c) => c.json(await startPreview(), 202))

await loadSchemas()
await initPublishedRef()
await initPreview()

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`r-present-admin-backend listening on :${info.port}`)
  console.log(`editing site at ${config.siteDir}`)
})
