import { useMemo, useState } from 'react'
import { ApiError, api, type Entry, type EntryData, type JsonSchema } from './api'
import { fieldsFor, fromDraft, toDraft, type Draft, type Field } from './fields'

type Props = {
  collection: string
  schema: JsonSchema
  /** null = creating a new entry. */
  entry: Entry | null
  onSaved: (entry: Entry, created: boolean) => void
  onDeleted: (id: string) => void
  onDirtyChange: (dirty: boolean) => void
}

type Status =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string }

/** "Columbia City Market!" → "columbia-city-market" (also what the backend accepts as an id). */
const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

/** Sensible starting values for a brand-new entry. */
function defaultsFor(schema: JsonSchema): EntryData {
  const data: EntryData = {}
  const props = schema.properties ?? {}
  if (props.available?.type === 'boolean') data.available = true
  if ('createdAt' in props) data.createdAt = new Date().toISOString().slice(0, 10)
  return data
}

const singular = (collection: string) => collection.replace(/s$/, '')

export function EntryEditor({
  collection,
  schema,
  entry,
  onSaved,
  onDeleted,
  onDirtyChange,
}: Props) {
  const creating = entry === null
  const startData = useMemo(() => entry?.data ?? defaultsFor(schema), [entry, schema])
  const fields = useMemo(() => fieldsFor(schema, startData), [schema, startData])
  const initial = useMemo(() => toDraft(fields, startData), [fields, startData])
  const hasSku = fields.some((f) => f.name === 'sku')

  const [draft, setDraft] = useState<Draft>(initial)
  const [id, setId] = useState(entry?.id ?? '')
  // Until she types in these herself, the id follows the name and the sku follows the id.
  const [idTouched, setIdTouched] = useState(false)
  const [skuTouched, setSkuTouched] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  const dirty = creating || JSON.stringify(draft) !== JSON.stringify(initial)

  const apply = (next: Draft, nextId: string) => {
    setDraft(next)
    setId(nextId)
    setStatus({ kind: 'idle' })
    onDirtyChange(creating || JSON.stringify(next) !== JSON.stringify(initial))
  }

  const syncSku = (next: Draft, nextId: string): Draft =>
    creating && hasSku && !skuTouched ? { ...next, sku: nextId } : next

  const clearError = (name: string) =>
    setErrors((errs) => {
      if (!(name in errs)) return errs
      const { [name]: _cleared, ...rest } = errs
      return rest
    })

  const update = (name: string, value: string | boolean) => {
    clearError(name)
    if (name === 'sku') setSkuTouched(true)
    let next = { ...draft, [name]: value }
    let nextId = id
    if (creating && name === 'name' && !idTouched && typeof value === 'string') {
      nextId = slugify(value)
      next = syncSku(next, nextId)
    }
    apply(next, nextId)
  }

  const updateId = (value: string) => {
    clearError('id')
    setIdTouched(true)
    // Light-touch cleanup while typing (slugify would eat a trailing dash mid-word).
    const nextId = value.toLowerCase().replace(/[^a-z0-9_-]/g, '-')
    apply(syncSku(draft, nextId), nextId)
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    const result = fromDraft(fields, draft, entry?.data ?? {})
    const clientErrors = 'errors' in result ? { ...result.errors } : {}
    if (creating && !id) clientErrors.id = 'needs a name'
    if (Object.keys(clientErrors).length > 0 || 'errors' in result) {
      setErrors(clientErrors)
      setStatus({ kind: 'error', message: 'Fix the highlighted fields.' })
      return
    }
    setErrors({})
    setStatus({ kind: 'saving' })
    try {
      const saved = creating
        ? await api.create(collection, id, result.data)
        : await api.save(collection, id, result.data)
      setStatus({ kind: 'saved' })
      onDirtyChange(false)
      onSaved(saved, creating)
    } catch (err) {
      if (err instanceof ApiError && err.errors.length > 0) {
        setErrors(Object.fromEntries(err.errors.map((fe) => [fe.field, fe.message])))
        setStatus({ kind: 'error', message: 'Fix the highlighted fields.' })
      } else {
        setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
      }
    }
  }

  const remove = async () => {
    if (!entry) return
    const label = typeof entry.data.name === 'string' ? entry.data.name : entry.id
    const ok = window.confirm(
      `Delete "${label}"?\n\nIt stays on r-present.com until you publish.`,
    )
    if (!ok) return
    try {
      await api.remove(collection, entry.id)
      onDirtyChange(false)
      onDeleted(entry.id)
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  const title = creating
    ? (typeof draft.name === 'string' && draft.name) || `New ${singular(collection)}`
    : typeof entry.data.name === 'string'
      ? entry.data.name
      : entry.id

  return (
    <form className="editor" onSubmit={save}>
      <header className="editor-header">
        <h2>{title}</h2>
        {!creating && <code>{entry.id}.json</code>}
      </header>

      {creating && (
        <div className={`field${errors.id ? ' has-error' : ''}`}>
          <label htmlFor="field-id">File name</label>
          <input
            id="field-id"
            type="text"
            value={id}
            placeholder="fills in from the name"
            onChange={(e) => updateId(e.target.value)}
          />
          <p className="hint">
            {id ? <code>{id}.json</code> : 'Lowercase letters, numbers and dashes.'} Can't be
            changed later.
          </p>
          {errors.id && <p className="err">{errors.id}</p>}
        </div>
      )}

      {fields.map((f) => (
        <FieldInput
          key={f.name}
          field={f}
          value={draft[f.name] ?? ''}
          error={errors[f.name]}
          onChange={(v) => update(f.name, v)}
        />
      ))}

      <footer className="editor-footer">
        <button type="submit" disabled={!dirty || status.kind === 'saving'}>
          {status.kind === 'saving' ? 'Saving…' : creating ? `Create ${singular(collection)}` : 'Save'}
        </button>
        {!creating && dirty && status.kind === 'idle' && <span className="muted">Unsaved changes</span>}
        {status.kind === 'saved' && <span className="ok">Saved</span>}
        {status.kind === 'error' && <span className="err">{status.message}</span>}
        {!creating && (
          <button type="button" className="danger" onClick={remove}>
            Delete
          </button>
        )}
      </footer>
    </form>
  )
}

type FieldInputProps = {
  field: Field
  value: string | boolean
  error: string | undefined
  onChange: (value: string | boolean) => void
}

function FieldInput({ field, value, error, onChange }: FieldInputProps) {
  const id = `field-${field.name}`
  const text = typeof value === 'string' ? value : ''

  if (field.kind === 'boolean') {
    return (
      <div className="field field-checkbox">
        <label htmlFor={id}>
          <input
            id={id}
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
          />
          {field.label}
        </label>
        {error && <p className="err">{error}</p>}
      </div>
    )
  }

  const multiline = field.kind === 'longtext' || field.kind === 'lines' || field.kind === 'json'
  const rows = Math.min(12, Math.max(3, text.split('\n').length + 1))

  return (
    <div className={`field${error ? ' has-error' : ''}`}>
      <label htmlFor={id}>
        {field.label}
        {!field.required && <span className="muted"> (optional)</span>}
      </label>
      {multiline ? (
        <textarea
          id={id}
          rows={rows}
          value={text}
          spellCheck={field.kind === 'longtext'}
          className={field.kind === 'json' ? 'mono' : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          id={id}
          type="text"
          inputMode={field.kind === 'number' ? 'decimal' : undefined}
          value={text}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {field.hint && <p className="hint">{field.hint}</p>}
      {error && <p className="err">{error}</p>}
    </div>
  )
}
