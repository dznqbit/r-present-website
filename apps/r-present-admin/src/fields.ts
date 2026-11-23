import type { EntryData, JsonSchema } from './api'

/**
 * How a schema property is edited:
 * - text / longtext: a string input
 * - date: a calendar day (YYYY-MM-DD) picked with the browser's date picker
 * - number: numeric input
 * - boolean: checkbox
 * - images: list of photo URLs, edited as a gallery with uploads
 * - captionedImages: list of { url, description }, a gallery with a caption per photo
 * - lines: list of strings, one per line
 * - json: anything else (e.g. arrays of objects), edited as raw JSON
 */
export type FieldKind =
  | 'text'
  | 'longtext'
  | 'date'
  | 'number'
  | 'boolean'
  | 'images'
  | 'captionedImages'
  | 'lines'
  | 'json'

export type CaptionedImage = { url: string; description: string }

export type Field = {
  name: string
  label: string
  kind: FieldKind
  required: boolean
  hint?: string
}

export type DraftValue = string | boolean
export type Draft = Record<string, DraftValue>

const LONG_TEXT_FIELDS = new Set(['description'])

const isString = (s: JsonSchema) => s.type === 'string'
const formatsOf = (s: JsonSchema) => s.anyOf?.map((x) => x.format) ?? [s.format]
const isDateSchema = (s: JsonSchema) =>
  formatsOf(s).some((f) => f === 'date' || f === 'date-time')
const DAY = /^\d{4}-\d{2}-\d{2}$/
const allowsString = (s: JsonSchema | undefined) =>
  !!s && (isString(s) || (s.anyOf?.some(isString) ?? false))

const isUri = (s: JsonSchema | undefined) => !!s && s.type === 'string' && s.format === 'uri'

function kindFor(name: string, schema: JsonSchema, value: unknown): FieldKind {
  if (schema.type === 'boolean') return 'boolean'
  if (schema.type === 'number' || schema.type === 'integer') return 'number'
  if (schema.type === 'array' && name.toLowerCase().includes('image')) {
    const list = Array.isArray(value) ? value : []
    if (isUri(schema.items) && list.every((v) => typeof v === 'string')) return 'images'
    const props = schema.items?.properties
    const objectsOk = list.every(
      (v) => typeof v === 'object' && v !== null && typeof (v as CaptionedImage).url === 'string',
    )
    if (props && isUri(props.url) && props.description?.type === 'string' && objectsOk) {
      return 'captionedImages'
    }
  }
  if (schema.type === 'array' && allowsString(schema.items)) {
    // Only use the simple list editor when every current value is a plain string.
    const ok = value === undefined || (Array.isArray(value) && value.every((v) => typeof v === 'string'))
    if (ok) return 'lines'
  }
  // Calendar days get a date picker. Full timestamps stay plain text so a save
  // can't quietly chop off their time.
  if (isDateSchema(schema) && (value === undefined || (typeof value === 'string' && DAY.test(value)))) {
    return 'date'
  }
  if (allowsString(schema) && (value === undefined || typeof value === 'string')) {
    return LONG_TEXT_FIELDS.has(name) ? 'longtext' : 'text'
  }
  return 'json'
}

function hintFor(schema: JsonSchema, kind: FieldKind): string | undefined {
  if (kind === 'images' || kind === 'captionedImages') return undefined
  if (kind === 'lines') return 'One per line'
  if (kind === 'json') return 'JSON'
  if (kind === 'date') return undefined
  if (kind === 'longtext') return 'Markdown works: **bold**, *italic*, [link](https://…), - lists. Blank line = new paragraph.'
  const formats = formatsOf(schema)
  if (formats.includes('date') || formats.includes('date-time')) return 'Date, e.g. 2026-03-14'
  if (formats.includes('uri')) return 'Full URL, starting with https://'
  return undefined
}

/** "createdAt" → "Created at" */
function humanize(name: string): string {
  const words = name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function fieldsFor(schema: JsonSchema, data: EntryData): Field[] {
  const required = new Set(schema.required ?? [])
  return Object.entries(schema.properties ?? {}).map(([name, prop]) => {
    const kind = kindFor(name, prop, data[name])
    const hint = hintFor(prop, kind)
    return {
      name,
      label: humanize(name),
      kind,
      required: required.has(name),
      ...(hint ? { hint } : {}),
    }
  })
}

export function toDraft(fields: Field[], data: EntryData): Draft {
  const draft: Draft = {}
  for (const f of fields) {
    const v = data[f.name]
    switch (f.kind) {
      case 'boolean':
        draft[f.name] = v === true
        break
      case 'lines':
        draft[f.name] = Array.isArray(v) ? v.join('\n') : ''
        break
      case 'images':
      case 'captionedImages':
        // Galleries keep their list as JSON text so Draft stays string | boolean.
        draft[f.name] = JSON.stringify(Array.isArray(v) ? v : [])
        break
      case 'json':
        draft[f.name] = v === undefined ? '' : JSON.stringify(v, null, 2)
        break
      default:
        draft[f.name] = v === undefined || v === null ? '' : String(v)
    }
  }
  return draft
}

/**
 * Turn the form back into entry data. Empty optional fields are dropped so the
 * JSON file doesn't fill up with blanks. Returns per-field parse errors
 * instead of data when the form can't be converted.
 */
export function fromDraft(
  fields: Field[],
  draft: Draft,
  original: EntryData,
): { data: EntryData } | { errors: Record<string, string> } {
  const data: EntryData = {}
  const errors: Record<string, string> = {}

  // Keep any keys the schema doesn't know about, untouched.
  const known = new Set(fields.map((f) => f.name))
  for (const [k, v] of Object.entries(original)) if (!known.has(k)) data[k] = v

  for (const f of fields) {
    const raw = draft[f.name]
    if (f.kind === 'boolean') {
      data[f.name] = raw === true
      continue
    }
    const text = typeof raw === 'string' ? raw : ''

    if (f.kind === 'images' || f.kind === 'captionedImages') {
      const list = text ? (JSON.parse(text) as unknown[]) : []
      // No photos is fine (the site shows an empty box). Required galleries
      // still need the key, so save an empty list rather than leaving it out.
      if (list.length === 0) {
        if (f.required) data[f.name] = []
        continue
      }
      data[f.name] = list
      continue
    }

    const empty = text.trim() === ''
    if (empty) {
      // The schema happily accepts "" for a required string, but a market with
      // a blank location is never what she meant.
      if (f.required) errors[f.name] = f.kind === 'lines' ? 'needs at least one' : 'is required'
      continue
    }

    switch (f.kind) {
      case 'number': {
        const n = Number(text)
        if (Number.isNaN(n)) errors[f.name] = 'must be a number'
        else data[f.name] = n
        break
      }
      case 'lines':
        data[f.name] = text
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean)
        break
      case 'json':
        try {
          data[f.name] = JSON.parse(text)
        } catch {
          errors[f.name] = 'is not valid JSON'
        }
        break
      default:
        data[f.name] = text
    }
  }

  return Object.keys(errors).length > 0 ? { errors } : { data }
}
