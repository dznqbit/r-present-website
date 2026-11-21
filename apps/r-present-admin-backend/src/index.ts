import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { config } from './config.js'

const app = new Hono().basePath('/api')

app.use(logger())

app.get('/health', (c) => c.json({ ok: true, siteDir: config.siteDir }))

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`r-present-admin-backend listening on :${info.port}`)
  console.log(`editing site at ${config.siteDir}`)
})
