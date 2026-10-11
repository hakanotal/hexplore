import { getDb } from '../db/db'

export class HttpError extends Error {
  readonly status: number
  readonly retryable: boolean
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.retryable = status === 429 || status >= 500
  }
}

/** Serializes calls so they start at least `intervalMs` apart (Nominatim: 1 per second). */
export class RateLimiter {
  private last = 0
  private chain: Promise<void> = Promise.resolve()
  private readonly intervalMs: number

  constructor(intervalMs: number) {
    this.intervalMs = intervalMs
  }

  schedule<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      const wait = this.last + this.intervalMs - Date.now()
      if (wait > 0) await sleep(wait)
      this.last = Date.now()
    })
    this.chain = run.catch(() => undefined)
    return run.then(fn)
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(signal.reason)
    })
  })
}

export interface FetchJsonOptions {
  retries?: number
  signal?: AbortSignal
  headers?: Record<string, string>
  method?: string
  body?: string
  /** Base backoff in ms; doubles each attempt. */
  backoffMs?: number
}

export async function fetchJson<T>(url: string, opts: FetchJsonOptions = {}): Promise<T> {
  const retries = opts.retries ?? 2
  const backoff = opts.backoffMs ?? 1000
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { method: opts.method, body: opts.body, headers: opts.headers, signal: opts.signal })
      if (!res.ok) throw new HttpError(res.status, `${res.status} ${res.statusText} from ${new URL(url).host}`)
      return (await res.json()) as T
    } catch (err) {
      const retryable = err instanceof HttpError ? err.retryable : err instanceof TypeError
      if (!retryable || attempt >= retries || opts.signal?.aborted) throw err
      await sleep(backoff * 2 ** attempt, opts.signal)
    }
  }
}

/** Caches JSON results in IndexedDB. Geocoder and Overpass results may be stored indefinitely. */
export async function cached<T>(key: string, load: () => Promise<T>, maxAgeMs = Infinity): Promise<T> {
  const db = getDb()
  const hit = await db.cache.get(key)
  if (hit && Date.now() - hit.createdAt < maxAgeMs) return hit.value as T
  const value = await load()
  await db.cache.put({ key, value, createdAt: Date.now() })
  return value
}
