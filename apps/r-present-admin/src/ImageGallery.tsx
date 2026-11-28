import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { api, originalUrl, PHOTO_ASPECT, uploadImage, type Crop } from './api'
import { CropDialog } from './CropDialog'
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
/** A picked photo waiting in the crop tool, with a preview URL for it. */
type ToCrop = { file: File; preview: string }

// iPhones hand over HEIC unless the page only accepts these; then iOS converts to JPEG.
const ACCEPT = 'image/jpeg,image/png,image/webp'

/** 0.75 -> "3:4" */
function aspectLabel(aspect: number): string {
  for (let h = 1; h <= 20; h++) {
    const w = aspect * h
    if (Math.abs(w - Math.round(w)) < 0.001) return `${Math.round(w)}:${h}`
  }
  return aspect.toFixed(2)
}

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
  // Collections with a fixed photo shape get the crop tool.
  const aspect = PHOTO_ASPECT[collection]
  const [cropQueue, setCropQueue] = useState<ToCrop[]>([])
  // An uploaded photo being re-cropped, and URLs whose re-crop is in flight.
  const [recropping, setRecropping] = useState<string | null>(null)
  const [recropBusy, setRecropBusy] = useState<string[]>([])
  const [recropError, setRecropError] = useState<string | null>(null)
  // Uploads run one after another (see runUpload), even when started separately.
  const uploadChain = useRef<Promise<void>>(Promise.resolve())

  // Uploads finish one after another; always build on the latest list.
  const latest = useRef(items)
  useEffect(() => {
    latest.current = items
  })

  const busy = pending.some((p) => p.error === null) || cropQueue.length > 0 || recropBusy.length > 0
  useEffect(() => onBusyChange(busy), [busy, onBusyChange])

  const commit = (next: Item[]) => onChange(serialize(next, captioned))

  // One at a time: the Pi resizes each photo and has little memory to spare.
  const runUpload = (file: File, crop: Crop | null) => {
    const key = nextKey.current++
    setPending((p) => [...p, { key, name: file.name, progress: 0, error: null }])
    uploadChain.current = uploadChain.current.then(async () => {
      try {
        const uploaded = await uploadImage(
          collection,
          file,
          (progress) => setPending((p) => p.map((j) => (j.key === key ? { ...j, progress } : j))),
          crop,
        )
        commit([...latest.current, { url: uploaded.url, description: '' }])
        setPending((p) => p.filter((j) => j.key !== key))
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setPending((p) => p.map((j) => (j.key === key ? { ...j, error: message } : j)))
      }
    })
  }

  const addFiles = (files: File[]) => {
    if (!aspect) {
      files.forEach((file) => runUpload(file, null))
      return
    }
    setCropQueue((q) => [...q, ...files.map((file) => ({ file, preview: URL.createObjectURL(file) }))])
  }

  // Done with the photo at the front of the crop queue: upload it when it
  // was framed, or drop it when the crop was cancelled.
  const finishCrop = (crop: Crop | null) => {
    const [current, ...rest] = cropQueue
    if (!current) return
    URL.revokeObjectURL(current.preview)
    setCropQueue(rest)
    if (crop) runUpload(current.file, crop)
  }

  const recrop = async (url: string, crop: Crop) => {
    setRecropping(null)
    setRecropError(null)
    setRecropBusy((b) => [...b, url])
    try {
      const uploaded = await api.recrop(collection, url, crop)
      commit(latest.current.map((item) => (item.url === url ? { ...item, url: uploaded.url } : item)))
    } catch (err) {
      setRecropError(err instanceof Error ? err.message : String(err))
    } finally {
      setRecropBusy((b) => b.filter((u) => u !== url))
    }
  }

  // Don't leak previews if the editor closes with photos still waiting.
  const queueRef = useRef(cropQueue)
  useEffect(() => {
    queueRef.current = cropQueue
  })
  useEffect(() => () => queueRef.current.forEach((c) => URL.revokeObjectURL(c.preview)), [])

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

      {aspect && (
        <p className="muted small gallery-hint">
          Photos are cropped to a {aspectLabel(aspect)} shape. You'll frame each one after picking it.
        </p>
      )}

      <div
        className={`gallery${dragging ? ' dragging' : ''}`}
        role="group"
        aria-labelledby={`${id}-label`}
        style={aspect ? ({ '--tile-aspect': aspect } as CSSProperties) : undefined}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'))
          if (files.length > 0) addFiles(files)
        }}
      >
        {items.map((item, i) => (
          <figure className="tile" key={`${item.url}-${i}`}>
            <div className="tile-img">
              <img src={item.url} alt={item.description || `Photo ${i + 1}`} loading="lazy" />
              {i === 0 && <span className="cover-badge">Cover</span>}
              {recropBusy.includes(item.url) && (
                <div className="tile-overlay">
                  <span className="spinner" aria-hidden="true" />
                  <span className="small">Cropping…</span>
                </div>
              )}
              {aspect && (
                <button
                  type="button"
                  className="tile-crop"
                  aria-label={`Crop photo ${i + 1}`}
                  disabled={recropBusy.includes(item.url)}
                  onClick={() => setRecropping(item.url)}
                >
                  Crop
                </button>
              )}
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
            if (files.length > 0) addFiles(files)
          }}
        />
      </div>

      {recropError && <p className="err">Couldn't crop that photo: {recropError}</p>}
      {error && <p className="err">{error}</p>}

      {aspect && cropQueue[0] && (
        <CropDialog
          key={cropQueue[0].preview}
          src={cropQueue[0].preview}
          aspect={aspect}
          title="Frame this photo"
          note={cropQueue.length > 1 ? `${cropQueue.length - 1} more to go` : undefined}
          onConfirm={(crop) => finishCrop(crop)}
          onCancel={() => finishCrop(null)}
        />
      )}
      {aspect && !cropQueue[0] && recropping && (
        <CropDialog
          key={recropping}
          // The crop applies to the original, so frame the original.
          src={originalUrl(recropping)}
          aspect={aspect}
          title="Crop this photo"
          onConfirm={(crop) => void recrop(recropping, crop)}
          onCancel={() => setRecropping(null)}
        />
      )}
    </div>
  )
}
