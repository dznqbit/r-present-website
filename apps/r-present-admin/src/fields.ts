import type { EntryData, JsonSchema } from './api'

/**
 * How a schema property is edited:
 * - text / longtext: a string input
 * - number: numeric input
 * - boolean: checkbox
 * - lines: list of strings, one per line
 * - json: anything else (e.g. arrays of objects), edited as raw JSON
 */
export type FieldKind = 'text' | 'longtext' | 'number' | 'boolean' | 'lines' | 'json'

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
const allowsString = (s: JsonSchema | undefined) =>
  !!s && (isString(s) || (s.anyOf?.some(isString) ?? false))

function kindFor(name: string, schema: JsonSchema, value: unknown): FieldKind {
  if (schema.type === 'boolean') return 'boolean'
  if (schema.type === 'number' || schema.type === 'integer') return 'number'
  if (schema.type === 'array' && allowsString(schema.items)) {
    // Only use the simple list editor when every current value is a plain string.
    const ok = value === undefined || (Array.isArray(value) && value.every((v) => typeof v === 'string'))
    if (ok) return 'lines'
  }
  if (allowsString(schema) && (value === undefined || typeof value === 'string')) {
    return LONG_TEXT_FIELDS.has(name) ? 'longtext' : 'text'
  }
  return 'json'
}

function hintFor(schema: JsonSchema, kind: FieldKind): string | undefined {
  if (kind === 'lines') return 'One per line'
  if (kind === 'json') return 'JSON'
  const formats = schema.anyOf?.map((s) => s.format) ?? [schema.format]
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
    const empty = text.trim() === ''
    if (empty && !f.required) continue

    switch (f.kind) {
      case 'number': {
        const n = Number(text)
        if (empty || Number.isNaN(n)) errors[f.name] = 'must be a number'
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
