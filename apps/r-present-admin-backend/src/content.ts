import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv'
import addFormatsModule from 'ajv-formats'
import { config } from './config.js'

// ajv-formats ships CJS; under NodeNext its default export is the module object.
const addFormats = addFormatsModule as unknown as typeof addFormatsModule.default

const run = promisify(execFile)

export type JsonSchema = Record<string, unknown>
export type Entry = { id: string; data: Record<string, unknown> }
export type FieldError = { field: string; message: string }

const contentDir = () => path.join(config.siteDir, 'src', 'content')
const schemaDir = () => path.join(config.siteDir, '.astro', 'collections')

// Entry ids become filenames, so keep them boring.
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i

export class NotFoundError extends Error {}
export class ValidationError extends Error {
  constructor(public readonly errors: FieldError[]) {
    super('Validation failed')
  }
}

const ajv = new Ajv({ allErrors: true, strict: false })
addFormats(ajv)
// Astro emits this for z.coerce.date() accepting epoch numbers.
ajv.addFormat('unix-time', true)

type Collection = { name: string; schema: JsonSchema; validate: ValidateFunction }
let collections = new Map<string, Collection>()

/**
 * Astro writes a JSON Schema per data collection to .astro/collections/ during
 * `astro sync` (also run by dev/build). We use those so the admin never
 * duplicates the site's schema definitions.
 */
export async function loadSchemas(): Promise<void> {
  if (!existsSync(schemaDir())) {
    console.log('No generated schemas found; running `astro sync`…')
    await run('npx', ['astro', 'sync'], { cwd: config.siteDir })
  }

  const next = new Map<string, Collection>()
  for (const file of await fs.readdir(schemaDir())) {
    if (!file.endsWith('.schema.json')) continue
    const name = file.replace(/\.schema\.json$/, '')
    const raw = JSON.parse(await fs.readFile(path.join(schemaDir(), file), 'utf8')) as JsonSchema
    const schema = resolveRoot(raw, name)
    next.set(name, { name, schema, validate: ajv.compile(schema) })
  }
  collections = next
}

/** Astro wraps each schema as { $ref: "#/definitions/<name>", definitions: {...} }. */
function resolveRoot(raw: JsonSchema, name: string): JsonSchema {
  const defs = raw.definitions as Record<string, JsonSchema> | undefined
  const def = defs?.[name]
  if (!def) return raw
  // Drop the $schema helper property Astro adds for editor support.
  const props = { ...(def.properties as Record<string, unknown>) }
  delete props.$schema
  return { ...def, properties: props }
}

function getCollection(name: string): Collection {
  const c = collections.get(name)
  if (!c) throw new NotFoundError(`Unknown collection: ${name}`)
  return c
}

function entryPath(collection: string, id: string): string {
  if (!ID_PATTERN.test(id)) throw new ValidationError([{ field: 'id', message: 'Invalid id' }])
  return path.join(contentDir(), collection, `${id}.json`)
}

export function listCollections(): {
  name: string
  schema: JsonSchema
  writeOnce: string[]
}[] {
  return [...collections.values()].map(({ name, schema }) => ({
    name,
    schema,
    // Tells the admin which fields to keep out of the form.
    writeOnce: WRITE_ONCE.filter((k) => hasProperty(schema, k)),
  }))
}

export async function listEntries(collection: string): Promise<Entry[]> {
  getCollection(collection)
  const dir = path.join(contentDir(), collection)
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json')).sort()
  return Promise.all(
    files.map(async (f) => ({
      id: f.replace(/\.json$/, ''),
      data: JSON.parse(await fs.readFile(path.join(dir, f), 'utf8')) as Record<string, unknown>,
    })),
  )
}

export async function saveEntry(
  collection: string,
  id: string,
  data: Record<string, unknown>,
): Promise<Entry> {
  const c = getCollection(collection)
  const file = entryPath(collection, id)
  if (!existsSync(file)) throw new NotFoundError(`No ${collection} entry "${id}"`)

  const existing = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>
  const merged = { ...data }
  // Write-once fields always keep what's on disk, whatever the client sent.
  for (const key of WRITE_ONCE) {
    if (key in existing) merged[key] = existing[key]
    else delete merged[key]
  }
  validate(c, merged)
  return writeEntry(id, file, orderKeys(merged, Object.keys(existing), c.schema))
}

export async function createEntry(
  collection: string,
  id: string,
  data: Record<string, unknown>,
): Promise<Entry> {
  const c = getCollection(collection)
  const file = entryPath(collection, id)
  if (existsSync(file)) {
    throw new ValidationError([{ field: 'id', message: "Something with this name already exists. Try a different name." }])
  }

  const stamped = { ...data }
  // Stamp write-once fields now; they're never editable afterwards.
  if (hasProperty(c.schema, 'createdAt')) stamped.createdAt = new Date().toISOString()
  validate(c, stamped)
  return writeEntry(id, file, orderKeys(stamped, [], c.schema))
}

/** Fields set once by the server on create and never changed by edits. */
const WRITE_ONCE = ['createdAt'] as const

function hasProperty(schema: JsonSchema, key: string): boolean {
  return key in ((schema.properties as Record<string, unknown> | undefined) ?? {})
}

export async function deleteEntry(collection: string, id: string): Promise<void> {
  getCollection(collection)
  const file = entryPath(collection, id)
  if (!existsSync(file)) throw new NotFoundError(`No ${collection} entry "${id}"`)
  await fs.rm(file)
}

function validate(c: Collection, data: Record<string, unknown>): void {
  if (!c.validate(data)) throw new ValidationError((c.validate.errors ?? []).map(toFieldError))
}

async function writeEntry(
  id: string,
  file: string,
  data: Record<string, unknown>,
): Promise<Entry> {
  const text = await format(JSON.stringify(data, null, 2) + '\n', file)
  await fs.mkdir(path.dirname(file), { recursive: true })
  // Write-then-rename so a crash never leaves a half-written file behind.
  const tmp = `${file}.tmp`
  await fs.writeFile(tmp, text)
  await fs.rename(tmp, file)
  return { id, data }
}

function toFieldError(e: ErrorObject): FieldError {
  const missing = e.keyword === 'required' ? (e.params as { missingProperty: string }).missingProperty : null
  const field = missing ?? (e.instancePath.split('/')[1] || '(root)')
  return { field, message: e.message ?? 'is invalid' }
}

/**
 * Keep the file's existing key order so diffs only show real changes; newly
 * added fields slot in by schema order.
 */
function orderKeys(
  data: Record<string, unknown>,
  existingOrder: string[],
  schema: JsonSchema,
): Record<string, unknown> {
  const schemaOrder = Object.keys((schema.properties as Record<string, unknown>) ?? {})
  const out: Record<string, unknown> = {}
  for (const k of [...existingOrder, ...schemaOrder]) if (k in data && !(k in out)) out[k] = data[k]
  for (const k of Object.keys(data)) if (!(k in out)) out[k] = data[k]
  return out
}

type Prettier = {
  format: (src: string, opts: Record<string, unknown>) => Promise<string>
  resolveConfig: (file: string) => Promise<Record<string, unknown> | null>
}
let prettier: Prettier | null | undefined

/** Format with the site's own Prettier so CI's format:check stays green. */
async function format(text: string, file: string): Promise<string> {
  if (prettier === undefined) {
    try {
      const req = createRequire(path.join(config.siteDir, 'package.json'))
      // require.resolve lands on prettier's CJS entry, whose API sits on .default.
      const mod = (await import(pathToFileURL(req.resolve('prettier')).href)) as
        | Prettier
        | { default: Prettier }
      prettier = 'default' in mod ? mod.default : mod
    } catch {
      console.warn('Site prettier not found; writing unformatted JSON.')
      prettier = null
    }
  }
  if (!prettier) return text
  // We only format JSON, so skip the site's plugins (e.g. prettier-plugin-astro):
  // prettier resolves them from our cwd, where they aren't installed.
  const { plugins: _plugins, ...opts } = (await prettier.resolveConfig(file)) ?? {}
  return prettier.format(text, { ...opts, filepath: file })
}
