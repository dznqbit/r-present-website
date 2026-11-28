export type JsonSchema = {
  type?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  anyOf?: JsonSchema[]
  format?: string
}

export type Collection = {
  name: string
  schema: JsonSchema
  /** Fields the server sets once on create (e.g. createdAt); never shown in forms. */
  writeOnce: string[]
  /** Entries back fixed site pages: editable, but no New or Delete. */
  fixed: boolean
}
export type EntryData = Record<string, unknown>
export type Entry = { id: string; data: EntryData }
export type FieldError = { field: string; message: string }

export type PreviewStatus = {
  state: 'none' | 'building' | 'ready' | 'failed'
  startedAt: string | null
  finishedAt: string | null
  stale: boolean
  port: number
  /** Full preview address when the server has one configured. */
  url: string | null
  log: string[] | null
}

export type Change = {
  collection: string
  id: string
  change: 'modified' | 'added' | 'deleted'
}

export type PublishStatus = {
  state: 'idle' | 'publishing' | 'published' | 'failed'
  step: string | null
  startedAt: string | null
  finishedAt: string | null
  commit: { sha: string; url: string | null } | null
  error: string | null
  log: string[] | null
}

export class ApiError extends Error {
  readonly errors: FieldError[]
  constructor(message: string, errors: FieldError[] = []) {
    super(message)
    this.errors = errors
  }
}

export type Uploaded = { url: string; width: number; height: number; bytes: number }

/**
 * Collections whose photos are cropped to a fixed shape (width / height). The
 * backend's src/uploads.ts (PHOTO_ASPECT) lists the same shapes and enforces
 * them; keep the two in sync.
 */
export const PHOTO_ASPECT: Record<string, number> = {
  products: 3 / 4,
}

/**
 * How to cut a photo: turn it `rotation` degrees clockwise (quarter turns),
 * then keep the box, as percentages (0–100) of the turned photo.
 */
export type Crop = { x: number; y: number; width: number; height: number; rotation: Rotation }
export type Rotation = 0 | 90 | 180 | 270

/**
 * The kept original behind a photo the site shows, which is what re-crops
 * start from (see the storage layout in the backend's src/uploads.ts):
 * …/products/a2BcF19x/Q7mZp2.jpg -> …/originals/products/a2BcF19x.jpg.
 * Photos from before originals were kept are their own original.
 */
export function originalUrl(displayUrl: string): string {
  const m = /^(.*\/)([a-z0-9-]+)\/([0-9A-Za-z]{8})\/[0-9A-Za-z]{6}\.jpg$/.exec(displayUrl)
  return m ? `${m[1]}originals/${m[2]}/${m[3]}.jpg` : displayUrl
}

/**
 * Upload one photo. Uses XHR rather than fetch because fetch can't report
 * upload progress, and phone photos on home Wi-Fi to a Pi take a moment.
 */
export function uploadImage(
  collection: string,
  file: File,
  onProgress: (fraction: number) => void,
  crop: Crop | null = null,
): Promise<Uploaded> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `/api/uploads?collection=${encodeURIComponent(collection)}`)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total)
    }
    xhr.onload = () => {
      let body: { error?: string } & Partial<Uploaded> = {}
      try {
        body = JSON.parse(xhr.responseText) as typeof body
      } catch {
        // fall through to the status check
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.url) resolve(body as Uploaded)
      else reject(new ApiError(body.error ?? `Upload failed (HTTP ${xhr.status})`))
    }
    xhr.onerror = () => reject(new ApiError("Couldn't reach the server"))
    const form = new FormData()
    form.append('file', file)
    if (crop) form.append('crop', JSON.stringify(crop))
    xhr.send(form)
  })
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })
  const body = (await res.json().catch(() => ({}))) as {
    error?: string
    errors?: FieldError[]
  }
  if (!res.ok) throw new ApiError(body.error ?? `HTTP ${res.status}`, body.errors)
  return body as T
}

export const api = {
  collections: () => request<Collection[]>('/collections'),
  entries: (collection: string) =>
    request<Entry[]>(`/collections/${encodeURIComponent(collection)}/entries`),
  save: (collection: string, id: string, data: EntryData) =>
    request<Entry>(
      `/collections/${encodeURIComponent(collection)}/entries/${encodeURIComponent(id)}`,
      { method: 'PUT', body: JSON.stringify(data) },
    ),
  create: (collection: string, id: string, data: EntryData) =>
    request<Entry>(`/collections/${encodeURIComponent(collection)}/entries`, {
      method: 'POST',
      body: JSON.stringify({ id, data }),
    }),
  remove: (collection: string, id: string) =>
    request<null>(
      `/collections/${encodeURIComponent(collection)}/entries/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    ),
  changes: () => request<Change[]>('/changes'),
  publishStatus: () => request<PublishStatus>('/publish'),
  startPublish: () => request<PublishStatus>('/publish', { method: 'POST' }),
  discard: () => request<{ discarded: unknown[] }>('/discard', { method: 'POST' }),
  previewStatus: () => request<PreviewStatus>('/preview'),
  startPreview: () => request<PreviewStatus>('/preview', { method: 'POST' }),
  /** Crop an already-uploaded photo; returns a new photo (the original stays). */
  recrop: (collection: string, url: string, crop: Crop) =>
    request<Uploaded>('/uploads/recrop', {
      method: 'POST',
      body: JSON.stringify({ collection, url, crop }),
    }),
}
