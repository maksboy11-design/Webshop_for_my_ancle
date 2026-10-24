import { readFileSync } from 'node:fs'
import https from 'node:https'
import { getCACertificates } from 'node:tls'

export interface InlineKeyboard {
  type: 'inline_keyboard'
  payload: {
    buttons: { type: 'callback'; text: string; payload: string }[][]
  }
}

export class MaxTemporaryError extends Error {
  readonly status: number
  constructor(status: number) {
    super('max_temporary')
    this.name = 'MaxTemporaryError'
    this.status = status
  }
}

export class MaxPermanentError extends Error {
  readonly status: number
  constructor(status: number) {
    super('max_permanent')
    this.name = 'MaxPermanentError'
    this.status = status
  }
}

export interface MaxClient {
  sendMessage(input: {
    chatId: string | null
    userId: string | null
    text: string
    attachments: InlineKeyboard | null
  }): Promise<void>
  answerCallback(input: {
    callbackId: string
    text: string | null
    attachments: InlineKeyboard | null
    notification: string | null
  }): Promise<void>
}

const API_ORIGIN = 'https://platform-api2.max.ru'
const USER_ID_PATTERN = /^[1-9][0-9]{0,15}$/
const CHAT_ID_PATTERN = /^-?[1-9][0-9]{0,15}$/
const rootCa = readFileSync(new URL('./russian_trusted_root_ca.pem', import.meta.url))
const trustedCas = [...getCACertificates(), rootCa.toString('utf8')]

function trustedFetch(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  const method = init?.method ?? 'GET'
  const headerBag = new Headers(init?.headers)
  const headers: Record<string, string> = {}
  headerBag.forEach((value, key) => {
    headers[key] = value
  })
  const payload = typeof init?.body === 'string' ? init.body : null
  if (payload != null && headers['content-length'] == null) headers['content-length'] = String(Buffer.byteLength(payload))
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method,
        headers,
        ca: trustedCas,
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => {
          const body = Buffer.concat(chunks)
          const responseHeaders = new Headers()
          for (const [key, value] of Object.entries(response.headers)) {
            if (typeof value === 'string') responseHeaders.set(key, value)
            else if (Array.isArray(value)) responseHeaders.set(key, value.join(', '))
          }
          resolve(new Response(body, { status: response.statusCode ?? 500, headers: responseHeaders }))
        })
      },
    )
    request.on('error', reject)
    if (payload != null) request.write(payload)
    request.end()
  })
}

function endpoint(path: string, query: URLSearchParams): string {
  const url = new URL(path, API_ORIGIN)
  url.search = query.toString()
  if (url.origin !== API_ORIGIN) throw new MaxPermanentError(400)
  return url.toString()
}

function numericUserId(value: string | null): string | null {
  if (!value || !USER_ID_PATTERN.test(value)) return null
  return value
}

function numericChatId(value: string | null): string | null {
  if (!value || !CHAT_ID_PATTERN.test(value)) return null
  return value
}

async function classify(response: Response): Promise<void> {
  if (response.ok) {
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.toLowerCase().includes('json')) {
      await response.arrayBuffer().catch(() => undefined)
      return
    }
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      return
    }
    if (payload && typeof payload === 'object' && 'success' in payload && payload.success === false) {
      throw new MaxPermanentError(response.status)
    }
    return
  }
  await response.arrayBuffer().catch(() => undefined)
  if (response.status === 401 || response.status === 408 || response.status === 429 || response.status >= 500) {
    throw new MaxTemporaryError(response.status)
  }
  throw new MaxPermanentError(response.status)
}

export function createMaxClient(token: string, fetchImpl: typeof fetch = trustedFetch): MaxClient {
  async function post(url: string, body: unknown): Promise<void> {
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(2500),
        headers: {
          authorization: token,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      })
      await classify(response)
    } catch (error) {
      if (error instanceof MaxTemporaryError || error instanceof MaxPermanentError) throw error
      throw new MaxTemporaryError(0)
    }
  }

  return {
    async sendMessage({ chatId, userId, text, attachments }) {
      const params = new URLSearchParams()
      const chat = numericChatId(chatId)
      const user = numericUserId(userId)
      if (chat) params.set('chat_id', chat)
      else if (user) params.set('user_id', user)
      else throw new MaxPermanentError(400)
      params.set('disable_link_preview', 'true')
      await post(endpoint('/messages', params), {
        text,
        ...(attachments ? { attachments: [attachments] } : {}),
      })
    },
    async answerCallback({ callbackId, text, attachments, notification }) {
      if (!callbackId.trim()) throw new MaxPermanentError(400)
      const params = new URLSearchParams({ callback_id: callbackId, disable_link_preview: 'true' })
      const body: { notification?: string; message?: { text: string; attachments?: InlineKeyboard[] } } = {}
      if (notification) body.notification = notification
      if (text) body.message = { text, ...(attachments ? { attachments: [attachments] } : {}) }
      await post(endpoint('/answers', params), body)
    },
  }
}
