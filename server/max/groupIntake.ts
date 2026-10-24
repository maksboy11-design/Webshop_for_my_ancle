import { randomUUID } from 'node:crypto'
import { attachmentsForStorage } from './attachments'
import { classifyMessage } from './classify'
import type { HandlerDeps } from './webhookHandler'
import type { NewContent, StoreTx } from './store'
import type { SupportedUpdate } from './update'

export class IntakeDeferred extends Error {
  constructor() {
    super('intake_deferred')
    this.name = 'IntakeDeferred'
  }
}

export function isGroupTraffic(update: SupportedUpdate): boolean {
  if (update.type === 'message_removed') return true
  return (update.type === 'message_created' || update.type === 'message_edited') && update.chatType === 'chat'
}

function allowed(chatId: string | null, deps: HandlerDeps): chatId is string {
  return chatId != null && deps.allowedChatsConfigured && deps.allowedChatIds.has(chatId)
}

function contentOf(
  update: Extract<SupportedUpdate, { type: 'message_created' | 'message_edited' }>,
  chatId: string,
  receivedAt: string,
): NewContent {
  const classified = classifyMessage(update.text, update.attachments)
  return {
    id: randomUUID(),
    chatId,
    messageMid: update.messageMid,
    receivedAt,
    kind: classified.kind,
    text: classified.text,
    publicText: classified.publicText,
    attachments: attachmentsForStorage(update.attachments),
    status: classified.kind === 'empty' ? 'empty' : 'pending',
    idempotencyKey: `group:${chatId}:${update.messageMid}`,
  }
}

/** Сохраняет сообщение разрешённой группы. В чат ничего не отправляет. */
export async function planGroupUpdate(update: SupportedUpdate, tx: StoreTx, deps: HandlerDeps): Promise<void> {
  const chatId = update.chatId
  if (!allowed(chatId, deps)) {
    deps.log.info('group_rejected', { configured: deps.allowedChatsConfigured })
    return
  }
  if (update.type === 'message_removed') {
    await tx.removeGroupMessage(chatId, update.messageMid)
    return
  }
  if (update.type !== 'message_created' && update.type !== 'message_edited') return
  const content = contentOf(update, chatId, deps.now().toISOString())
  if (update.type === 'message_edited') {
    const edited = await tx.replaceGroupMessage(content, content.receivedAt)
    if (edited === 'missing') await tx.insertGroupMessage(content)
    return
  }
  const existing = await tx.findGroupMessage(chatId, update.messageMid)
  if (existing) return
  await tx.insertGroupMessage(content)
  deps.log.info('group_stored', { updateType: content.kind })
}
