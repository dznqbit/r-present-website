export type JsonSchema = {
  type?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  anyOf?: JsonSchema[]
  format?: string
}

export type Collection = { name: string; schema: JsonSchema }
export type EntryData = Record<string, unknown>
export type Entry = { id: string; data: EntryData }
export type FieldError = { field: string; message: string }

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
}
