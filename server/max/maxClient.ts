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
const ID_PATTERN = /^[1-9][0-9]{0,15}$/

function endpoint(path: string, query: URLSearchParams): string {
  const url = new URL(path, API_ORIGIN)
  url.search = query.toString()
  if (url.origin !== API_ORIGIN) throw new MaxPermanentError(400)
  return url.toString()
}

function numericId(value: string | null): string | null {
  if (!value || !ID_PATTERN.test(value)) return null
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

export function createMaxClient(token: string, fetchImpl: typeof fetch = fetch): MaxClient {
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
      const chat = numericId(chatId)
      const user = numericId(userId)
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
