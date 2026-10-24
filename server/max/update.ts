import { readAttachments, type StoredAttachment } from './attachments'

export type ChatType = 'dialog' | 'chat' | 'channel'

interface BaseUpdate {
  key: string
  userId: string
}

type GroupableMessage = BaseUpdate & {
  chatId: string | null
  chatType: ChatType
  messageMid: string
  text: string | null
  hasAttachments: boolean
  attachments: StoredAttachment[]
}

export type SupportedUpdate =
  | (BaseUpdate & { type: 'bot_started'; chatId: string })
  | (GroupableMessage & { type: 'message_created' })
  | (GroupableMessage & { type: 'message_edited' })
  | (BaseUpdate & {
      type: 'message_callback'
      chatId: string | null
      chatType: ChatType | null
      callbackId: string
      payload: string
    })
  | (BaseUpdate & {
      type: 'message_removed'
      chatId: string
      messageMid: string
    })

const SUPPORTED = new Set(['message_created', 'message_callback', 'message_edited', 'message_removed', 'bot_started'])

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
  if (value.update_type === 'message_removed') return parseRemoved(value, timestamp)
  if (value.update_type === 'message_created' || value.update_type === 'message_edited') {
    return parseMessage(value, timestamp, value.update_type)
  }
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

function parseRemoved(value: Record<string, unknown>, timestamp: string): ReturnType<typeof parseUpdate> {
  const chatId = readId(value.chat_id)
  const userId = readId(value.user_id)
  const messageMid = typeof value.message_id === 'string' ? bounded(value.message_id) : readId(value.message_id)
  if (!chatId || !userId || !messageMid) return { action: 'reject' }
  return {
    action: 'accept',
    update: {
      type: 'message_removed',
      key: `message_removed:${timestamp}:${chatId}:${messageMid}`,
      userId,
      chatId,
      messageMid,
    },
  }
}

function parseMessage(
  value: Record<string, unknown>,
  timestamp: string,
  type: 'message_created' | 'message_edited',
): ReturnType<typeof parseUpdate> {
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
  const rawAttachments = message.body.attachments
  const attachments = readAttachments(rawAttachments)
  const hasAttachments = attachments.length > 0 || (rawAttachments != null && !Array.isArray(rawAttachments))
  return {
    action: 'accept',
    update: {
      type,
      key: `${type}:${timestamp}:${mid}`,
      userId,
      messageMid: mid,
      chatId: readId(message.recipient.chat_id),
      chatType: message.recipient.chat_type,
      text,
      hasAttachments,
      attachments,
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
  if (update.type === 'message_removed' || update.type === 'message_edited') return false
  return update.chatType === 'dialog'
}
