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
 * Upload one photo. Uses XHR rather than fetch because fetch can't report
 * upload progress, and phone photos on home Wi-Fi to a Pi take a moment.
 */
export function uploadImage(
  collection: string,
  file: File,
  onProgress: (fraction: number) => void,
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
}
