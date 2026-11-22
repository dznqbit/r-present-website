import { useEffect, useRef, useState } from 'react'
import { uploadImage } from './api'
import type { CaptionedImage } from './fields'

type Props = {
  id: string
  label: string
  required: boolean
  /** Which collection the photos belong to (decides their folder). */
  collection: string
  /** JSON text: string[] for plain galleries, CaptionedImage[] when captioned. */
  value: string
  captioned: boolean
  error: string | undefined
  onChange: (value: string) => void
  /** Reports whether uploads are in flight, so Save can wait for them. */
  onBusyChange: (busy: boolean) => void
}

type Item = CaptionedImage
type Pending = { key: number; name: string; progress: number; error: string | null }

// iPhones hand over HEIC unless the page only accepts these; then iOS converts to JPEG.
const ACCEPT = 'image/jpeg,image/png,image/webp'

function parse(value: string, captioned: boolean): Item[] {
  const raw = value ? (JSON.parse(value) as unknown[]) : []
  return raw.map((v) =>
    captioned ? (v as Item) : { url: typeof v === 'string' ? v : '', description: '' },
  )
}

function serialize(items: Item[], captioned: boolean): string {
  return JSON.stringify(captioned ? items : items.map((i) => i.url))
}

export function ImageGallery({
  id,
  label,
  required,
  collection,
  value,
  captioned,
  error,
  onChange,
  onBusyChange,
}: Props) {
  const items = parse(value, captioned)
  const [pending, setPending] = useState<Pending[]>([])
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const nextKey = useRef(0)

  // Uploads finish one after another; always build on the latest list.
  const latest = useRef(items)
  useEffect(() => {
    latest.current = items
  })

  const busy = pending.some((p) => p.error === null)
  useEffect(() => onBusyChange(busy), [busy, onBusyChange])

  const commit = (next: Item[]) => onChange(serialize(next, captioned))

  const addFiles = async (files: File[]) => {
    const jobs = files.map((file) => ({ key: nextKey.current++, file }))
    setPending((p) => [
      ...p,
      ...jobs.map(({ key, file }) => ({ key, name: file.name, progress: 0, error: null })),
    ])
    // One at a time: the Pi resizes each photo and has little memory to spare.
    for (const { key, file } of jobs) {
      try {
        const uploaded = await uploadImage(collection, file, (progress) =>
          setPending((p) => p.map((j) => (j.key === key ? { ...j, progress } : j))),
        )
        commit([...latest.current, { url: uploaded.url, description: '' }])
        setPending((p) => p.filter((j) => j.key !== key))
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setPending((p) => p.map((j) => (j.key === key ? { ...j, error: message } : j)))
      }
    }
  }

  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length) return
    const next = [...items]
    const [moved] = next.splice(from, 1)
    if (moved) next.splice(to, 0, moved)
    commit(next)
  }

  const remove = (index: number) => commit(items.filter((_, i) => i !== index))

  const setCaption = (index: number, description: string) =>
    commit(items.map((item, i) => (i === index ? { ...item, description } : item)))

  return (
    <div className={`field${error ? ' has-error' : ''}`}>
      <span className="label" id={`${id}-label`}>
        {label}
        {!required && <span className="muted"> (optional)</span>}
      </span>

      <div
        className={`gallery${dragging ? ' dragging' : ''}`}
        role="group"
        aria-labelledby={`${id}-label`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'))
          if (files.length > 0) void addFiles(files)
        }}
      >
        {items.map((item, i) => (
          <figure className="tile" key={`${item.url}-${i}`}>
            <div className="tile-img">
              <img src={item.url} alt={item.description || `Photo ${i + 1}`} loading="lazy" />
              {i === 0 && <span className="cover-badge">Cover</span>}
              <div className="tile-actions">
                <button
                  type="button"
                  aria-label={`Move photo ${i + 1} earlier`}
                  disabled={i === 0}
                  onClick={() => move(i, i - 1)}
                >
                  ←
                </button>
                <button
                  type="button"
                  aria-label={`Move photo ${i + 1} later`}
                  disabled={i === items.length - 1}
                  onClick={() => move(i, i + 1)}
                >
                  →
                </button>
                <button
                  type="button"
                  className="tile-remove"
                  aria-label={`Remove photo ${i + 1}`}
                  onClick={() => remove(i)}
                >
                  ✕
                </button>
              </div>
            </div>
            {captioned && (
              <figcaption className="tile-caption">
                <label htmlFor={`${id}-caption-${i}`}>Caption</label>
                <textarea
                  id={`${id}-caption-${i}`}
                  rows={2}
                  value={item.description}
                  onChange={(e) => setCaption(i, e.target.value)}
                />
              </figcaption>
            )}
          </figure>
        ))}

        {pending.map((p) => (
          <figure className="tile" key={`pending-${p.key}`}>
            <div className={`tile-img tile-pending${p.error ? ' tile-failed' : ''}`}>
              {p.error ? (
                <>
                  <span className="err">Upload failed</span>
                  <span className="small">{p.error}</span>
                  <button
                    type="button"
                    className="text-btn"
                    onClick={() => setPending((all) => all.filter((j) => j.key !== p.key))}
                  >
                    Dismiss
                  </button>
                </>
              ) : (
                <>
                  <span className="spinner" aria-hidden="true" />
                  <span className="small">
                    {p.progress < 1 ? `Uploading ${Math.round(p.progress * 100)}%` : 'Processing…'}
                  </span>
                  <progress max={1} value={p.progress} aria-label={`Uploading ${p.name}`} />
                </>
              )}
            </div>
          </figure>
        ))}

        <button
          type="button"
          id={id}
          className="tile tile-add"
          onClick={() => inputRef.current?.click()}
        >
          <span className="tile-add-plus" aria-hidden="true">
            +
          </span>
          <span>Add photos</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])]
            e.target.value = '' // allow picking the same file again later
            if (files.length > 0) void addFiles(files)
          }}
        />
      </div>

      {error && <p className="err">{error}</p>}
    </div>
  )
}
