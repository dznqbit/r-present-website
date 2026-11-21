import { useMemo, useState } from 'react'
import { ApiError, api, type Entry, type JsonSchema } from './api'
import { fieldsFor, fromDraft, toDraft, type Draft, type Field } from './fields'

type Props = {
  collection: string
  schema: JsonSchema
  entry: Entry
  onSaved: (entry: Entry) => void
  onDirtyChange: (dirty: boolean) => void
}

type Status =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string }

export function EntryEditor({ collection, schema, entry, onSaved, onDirtyChange }: Props) {
  const fields = useMemo(() => fieldsFor(schema, entry.data), [schema, entry.data])
  const initial = useMemo(() => toDraft(fields, entry.data), [fields, entry.data])

  const [draft, setDraft] = useState<Draft>(initial)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)

  const update = (name: string, value: string | boolean) => {
    const next = { ...draft, [name]: value }
    setDraft(next)
    setStatus({ kind: 'idle' })
    onDirtyChange(JSON.stringify(next) !== JSON.stringify(initial))
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    const result = fromDraft(fields, draft, entry.data)
    if ('errors' in result) {
      setErrors(result.errors)
      setStatus({ kind: 'error', message: 'Fix the highlighted fields.' })
      return
    }
    setErrors({})
    setStatus({ kind: 'saving' })
    try {
      const saved = await api.save(collection, entry.id, result.data)
      setStatus({ kind: 'saved' })
      onDirtyChange(false)
      onSaved(saved)
    } catch (err) {
      if (err instanceof ApiError && err.errors.length > 0) {
        setErrors(Object.fromEntries(err.errors.map((fe) => [fe.field, fe.message])))
        setStatus({ kind: 'error', message: 'Fix the highlighted fields.' })
      } else {
        setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
      }
    }
  }

  return (
    <form className="editor" onSubmit={save}>
      <header className="editor-header">
        <h2>{typeof entry.data.name === 'string' ? entry.data.name : entry.id}</h2>
        <code>{entry.id}.json</code>
      </header>

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
          {status.kind === 'saving' ? 'Saving…' : 'Save'}
        </button>
        {dirty && status.kind === 'idle' && <span className="muted">Unsaved changes</span>}
        {status.kind === 'saved' && <span className="ok">Saved</span>}
        {status.kind === 'error' && <span className="err">{status.message}</span>}
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
