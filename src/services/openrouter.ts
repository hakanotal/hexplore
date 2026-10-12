import { fetchJson } from './http'

// OpenRouter chat completions with JSON-schema output. Calls go straight from
// the browser with the owner's key; the key never leaves this device otherwise.

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface JsonRequest {
  model: string
  messages: ChatMessage[]
  /** Short identifier for the schema, required by the API. */
  name: string
  schema: Record<string, unknown>
  maxTokens?: number
  signal?: AbortSignal
}

interface CompletionResponse {
  choices?: { message?: { content?: string | null } }[]
  error?: { message?: string }
}

export interface JsonModel {
  json<T>(req: JsonRequest): Promise<T>
}

export class OpenRouterClient implements JsonModel {
  private readonly key: string

  constructor(key: string) {
    this.key = key
  }

  async json<T>(req: JsonRequest): Promise<T> {
    const res = await fetchJson<CompletionResponse>(OPENROUTER_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json', 'X-Title': 'Hexplore' },
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        temperature: 0,
        max_tokens: req.maxTokens,
        response_format: { type: 'json_schema', json_schema: { name: req.name, strict: true, schema: req.schema } },
      }),
      signal: req.signal,
      backoffMs: 2000,
    })
    const content = res.choices?.[0]?.message?.content
    if (!content) throw new Error(res.error?.message ?? 'OpenRouter returned no content')
    // Some providers still wrap JSON in a code fence.
    return JSON.parse(content.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '')) as T
  }
}
