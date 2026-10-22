import type { EventPayload, NotificationChannel, Subscription } from './events'

/**
 * Заглушка канала Telegram.
 * Токен и chat id читаются только на сервере, в браузер их не кладём.
 * TODO: заменить на server-side вызов Bot API, когда появятся TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID.
 */
export function createTelegramBotChannel(subscription: Subscription = { types: [] }): NotificationChannel {
  return {
    async notify(event) {
      const allowed = subscription.types.length === 0 || subscription.types.includes(event.type)
      const entityOk = !subscription.entityId || subscription.entityId === event.entityId
      if (!allowed || !entityOk) return
      if (import.meta.env.DEV) {
        console.info('[telegram stub]', event.type, event.summary)
      }
    },
  }
}

const channels: NotificationChannel[] = [createTelegramBotChannel()]

export async function publish(event: EventPayload) {
  await Promise.all(channels.map((channel) => channel.notify(event)))
}

/** Пример точки, из которой будущая админка сообщит о новом товаре. */
export async function notifyProductCreated(entityId: string, name: string) {
  await publish({
    id: crypto.randomUUID(),
    type: 'product.created',
    occurredAt: new Date().toISOString(),
    entityId,
    summary: `Новый товар: ${name}`,
    data: { name },
  })
}
