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
  previewStatus: () => request<PreviewStatus>('/preview'),
  startPreview: () => request<PreviewStatus>('/preview', { method: 'POST' }),
}
