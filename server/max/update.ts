export type ChatType = 'dialog' | 'chat' | 'channel'

interface BaseUpdate {
  key: string
  userId: string
}

export type SupportedUpdate =
  | (BaseUpdate & { type: 'bot_started'; chatId: string })
  | (BaseUpdate & {
      type: 'message_created'
      chatId: string | null
      chatType: ChatType
      text: string | null
      hasAttachments: boolean
    })
  | (BaseUpdate & {
      type: 'message_callback'
      chatId: string | null
      chatType: ChatType | null
      callbackId: string
      payload: string
    })

const SUPPORTED = new Set(['message_created', 'message_callback', 'bot_started'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readId(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return null
  return String(value)
}

function readTimestamp(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return null
  return String(value)
}

function isChatType(value: unknown): value is ChatType {
  return value === 'dialog' || value === 'chat' || value === 'channel'
}

function bounded(value: string, max = 300): string | null {
  if (value.length === 0 || value.length > max) return null
  return value
}

export function parseUpdate(value: unknown): { action: 'reject' } | { action: 'ignore' } | { action: 'accept'; update: SupportedUpdate } {
  if (!isRecord(value) || typeof value.update_type !== 'string') return { action: 'reject' }
  if (!SUPPORTED.has(value.update_type)) return { action: 'ignore' }
  const timestamp = readTimestamp(value.timestamp)
  if (!timestamp) return { action: 'reject' }
  if (value.update_type === 'bot_started') return parseStarted(value, timestamp)
  if (value.update_type === 'message_created') return parseMessage(value, timestamp)
  return parseCallback(value, timestamp)
}

function parseStarted(value: Record<string, unknown>, timestamp: string): ReturnType<typeof parseUpdate> {
  const chatId = readId(value.chat_id)
  if (!isRecord(value.user)) return { action: 'reject' }
  if (value.user.is_bot === true) return { action: 'ignore' }
  const userId = readId(value.user.user_id)
  if (!chatId || !userId) return { action: 'reject' }
  return { action: 'accept', update: { type: 'bot_started', key: `bot_started:${timestamp}:${chatId}:${userId}`, chatId, userId } }
}

function parseMessage(value: Record<string, unknown>, timestamp: string): ReturnType<typeof parseUpdate> {
  if (!isRecord(value.message)) return { action: 'reject' }
  const message = value.message
  if (message.sender == null) return { action: 'ignore' }
  if (!isRecord(message.sender)) return { action: 'reject' }
  if (message.sender.is_bot === true) return { action: 'ignore' }
  const userId = readId(message.sender.user_id)
  if (!userId) return { action: 'reject' }
  if (!isRecord(message.recipient) || !isChatType(message.recipient.chat_type)) return { action: 'reject' }
  if (!isRecord(message.body) || typeof message.body.mid !== 'string') return { action: 'reject' }
  const mid = bounded(message.body.mid)
  if (!mid) return { action: 'reject' }
  const text = typeof message.body.text === 'string' ? message.body.text : null
  const attachments = message.body.attachments
  const hasAttachments = attachments != null && (!Array.isArray(attachments) || attachments.length > 0)
  return {
    action: 'accept',
    update: {
      type: 'message_created',
      key: `message_created:${timestamp}:${mid}`,
      userId,
      chatId: readId(message.recipient.chat_id),
      chatType: message.recipient.chat_type,
      text,
      hasAttachments,
    },
  }
}

function parseCallback(value: Record<string, unknown>, timestamp: string): ReturnType<typeof parseUpdate> {
  if (!isRecord(value.callback)) return { action: 'reject' }
  if (!isRecord(value.callback.user)) return { action: 'reject' }
  if (value.callback.user.is_bot === true) return { action: 'ignore' }
  const userId = readId(value.callback.user.user_id)
  const callbackId = typeof value.callback.callback_id === 'string' ? bounded(value.callback.callback_id) : null
  if (!userId || !callbackId) return { action: 'reject' }
  const payload = typeof value.callback.payload === 'string' ? value.callback.payload.slice(0, 1024) : ''
  if (value.message == null) {
    return {
      action: 'accept',
      update: {
        type: 'message_callback',
        key: `message_callback:${timestamp}:${callbackId}`,
        userId,
        chatId: null,
        chatType: null,
        callbackId,
        payload,
      },
    }
  }
  if (!isRecord(value.message) || !isRecord(value.message.recipient) || !isChatType(value.message.recipient.chat_type)) {
    return { action: 'reject' }
  }
  return {
    action: 'accept',
    update: {
      type: 'message_callback',
      key: `message_callback:${timestamp}:${callbackId}`,
      userId,
      chatId: readId(value.message.recipient.chat_id),
      chatType: value.message.recipient.chat_type,
      callbackId,
      payload,
    },
  }
}

export function isPrivateDialog(update: SupportedUpdate): boolean {
  if (update.type === 'bot_started') return true
  return update.chatType === 'dialog'
}
