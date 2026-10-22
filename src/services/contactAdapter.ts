export interface ContactPayload {
  name: string
  contact: string
  question: string
}

export type ContactResult = { ok: false; reason: 'not-connected' }

import { publish } from '../integrations/telegram/bus'

/**
 * Приёма заявок на сервере нет.
 * TODO: заменить на запрос к реальному endpoint, когда он появится.
 * Не сообщает об успешной отправке.
 */
export async function submitContact(payload: ContactPayload): Promise<ContactResult> {
  await publish({
    id: crypto.randomUUID(),
    type: 'contact.request.submitted',
    occurredAt: new Date().toISOString(),
    entityId: 'contact-form',
    summary: 'Новая заявка с формы вопросов',
    data: { questionLength: payload.question.trim().length },
  })
  return { ok: false, reason: 'not-connected' }
}
