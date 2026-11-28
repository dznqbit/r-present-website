import { useCallback, useEffect, useMemo, useState } from 'react'
import { ApiError, api, type Entry, type EntryData, type JsonSchema } from './api'
import { fieldsFor, fromDraft, toDraft, type Draft, type Field } from './fields'
import { ImageGallery } from './ImageGallery'

type Props = {
  collection: string
  schema: JsonSchema
  /** Fields the server manages (e.g. createdAt); kept out of the form. */
  hidden: string[]
  /** Fixed site page: no Delete button. */
  fixed: boolean
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
  return data
}

const singular = (collection: string) => collection.replace(/s$/, '')

export function EntryEditor({
  collection,
  schema,
  hidden,
  fixed,
  entry,
  onSaved,
  onDeleted,
  onDirtyChange,
}: Props) {
  const creating = entry === null
  const startData = useMemo(() => entry?.data ?? defaultsFor(schema), [entry, schema])
  const fields = useMemo(
    () => fieldsFor(schema, startData).filter((f) => !hidden.includes(f.name)),
    [schema, startData, hidden],
  )
  const initial = useMemo(() => toDraft(fields, startData), [fields, startData])
  const nameField = fields.find((f) => f.name === 'name')
  // Name always comes first; the rest keep schema order.
  const orderedFields = nameField ? [nameField, ...fields.filter((f) => f !== nameField)] : fields
  const hasSku = fields.some((f) => f.name === 'sku')

  const [draft, setDraft] = useState<Draft>(initial)
  // For new products the sku follows the name until she types in it herself.
  const [skuTouched, setSkuTouched] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  // The Save button reads "Saved" for a moment, then goes back to normal.
  useEffect(() => {
    if (status.kind !== 'saved') return
    const timer = setTimeout(() => setStatus({ kind: 'idle' }), 1000)
    return () => clearTimeout(timer)
  }, [status])
  // Galleries with uploads still in flight, keyed by field name.
  const [uploading, setUploading] = useState<Record<string, boolean>>({})
  const setBusy = useCallback(
    (field: string, busy: boolean) =>
      setUploading((u) => (Boolean(u[field]) === busy ? u : { ...u, [field]: busy })),
    [],
  )
  const anyUploading = Object.values(uploading).some(Boolean)

  const name = typeof draft.name === 'string' ? draft.name : ''
  // The file name is plumbing she never sees: new entries get it from the name.
  const id = entry?.id ?? slugify(name)
  const dirty = creating || JSON.stringify(draft) !== JSON.stringify(initial)

  const clearError = (field: string) =>
    setErrors((errs) => {
      if (!(field in errs)) return errs
      const { [field]: _cleared, ...rest } = errs
      return rest
    })

  const update = (field: string, value: string | boolean) => {
    clearError(field)
    if (field === 'sku') setSkuTouched(true)
    let next = { ...draft, [field]: value }
    if (creating && field === 'name' && hasSku && !skuTouched && typeof value === 'string') {
      next = { ...next, sku: slugify(value) }
    }
    setDraft(next)
    setStatus({ kind: 'idle' })
    onDirtyChange(creating || JSON.stringify(next) !== JSON.stringify(initial))
  }

  /** Server errors about the (hidden) id belong to the name field. */
  const toFieldErrors = (list: { field: string; message: string }[]) =>
    Object.fromEntries(list.map((fe) => [fe.field === 'id' ? 'name' : fe.field, fe.message]))

  /** Bring the first problem into view so "Fix the highlighted fields" isn't a hunt. */
  const showFirstError = () =>
    window.requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(
        '.editor .has-error input, .editor .has-error textarea',
      )
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el?.focus({ preventScroll: true })
    })

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    const result = fromDraft(fields, draft, entry?.data ?? {})
    const clientErrors = 'errors' in result ? { ...result.errors } : {}
    if (creating && name.trim() && !id) clientErrors.name = 'needs at least one letter or number'
    if ('errors' in result || Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors)
      setStatus({ kind: 'error', message: 'Fix the highlighted fields.' })
      showFirstError()
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
        setErrors(toFieldErrors(err.errors))
        setStatus({ kind: 'error', message: 'Fix the highlighted fields.' })
        showFirstError()
      } else {
        setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
      }
    }
  }

  const remove = async () => {
    if (!entry) return
    const label = typeof entry.data.name === 'string' ? entry.data.name : 'this'
    const ok = window.confirm(`Are you sure you want to delete ${label}?`)
    if (!ok) return
    try {
      await api.remove(collection, entry.id)
      onDirtyChange(false)
      onDeleted(entry.id)
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <form className="editor" onSubmit={save}>
      {orderedFields.map((f) => (
        <FieldInput
          key={f.name}
          field={f}
          value={draft[f.name] ?? ''}
          error={errors[f.name]}
          // A new entry starts with the cursor in the name.
          autoFocus={creating && f === nameField}
          collection={collection}
          onChange={(v) => update(f.name, v)}
          onBusyChange={(busy) => setBusy(f.name, busy)}
        />
      ))}

      <footer className="editor-footer">
        {!creating && !fixed && (
          <button type="button" className="danger" onClick={remove}>
            Delete
          </button>
        )}
        {/* Save and its status stay together in the lower right. */}
        <div className="save-group">
          {!creating && dirty && status.kind === 'idle' && <span className="muted">Unsaved changes</span>}
          {status.kind === 'error' && <span className="err">{status.message}</span>}
          <button type="submit" disabled={!dirty || status.kind === 'saving' || anyUploading}>
            {anyUploading
              ? 'Waiting for photos…'
              : status.kind === 'saving'
                ? 'Saving…'
                : status.kind === 'saved'
                  ? 'Saved'
                  : creating
                    ? `Create ${singular(collection)}`
                    : 'Save'}
          </button>
        </div>
      </footer>
    </form>
  )
}

type FieldInputProps = {
  field: Field
  value: string | boolean
  error: string | undefined
  autoFocus?: boolean
  collection: string
  onChange: (value: string | boolean) => void
  onBusyChange: (busy: boolean) => void
}

function FieldInput({
  field,
  value,
  error,
  autoFocus = false,
  collection,
  onChange,
  onBusyChange,
}: FieldInputProps) {
  const id = `field-${field.name}`
  const text = typeof value === 'string' ? value : ''

  if (field.kind === 'images' || field.kind === 'captionedImages') {
    return (
      <ImageGallery
        id={id}
        label={field.label}
        required={field.required}
        collection={collection}
        value={text}
        captioned={field.kind === 'captionedImages'}
        error={error}
        onChange={onChange}
        onBusyChange={onBusyChange}
      />
    )
  }

  if (field.kind === 'boolean') {
    return (
      <div className="field field-switch">
        <label htmlFor={id}>
          <input
            id={id}
            type="checkbox"
            role="switch"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span className="switch-track" aria-hidden="true" />
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
          type={field.kind === 'date' ? 'date' : 'text'}
          autoFocus={autoFocus}
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
