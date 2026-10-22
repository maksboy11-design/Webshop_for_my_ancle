export interface ContactPayload {
  name: string
  contact: string
  question: string
}

export type ContactResult = { ok: false; reason: 'not-connected' }

/**
 * Приёма заявок на сервере нет.
 * TODO: заменить на запрос к реальному endpoint, когда он появится.
 * Не сообщает об успешной отправке.
 */
export async function submitContact(payload: ContactPayload): Promise<ContactResult> {
  void payload
  return { ok: false, reason: 'not-connected' }
}
