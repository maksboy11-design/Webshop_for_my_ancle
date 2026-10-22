export type EventType =
  | 'product.created'
  | 'product.updated'
  | 'review.created'
  | 'video.created'
  | 'webinar.created'
  | 'webinar.scheduled'
  | 'document.added'
  | 'category.updated'
  | 'contact.request.submitted'

export interface EventPayload {
  id: string
  type: EventType
  occurredAt: string
  entityId: string
  /** Короткий текст без лишних персональных данных. */
  summary: string
  data: Record<string, string | number | boolean | null>
}

export interface NotificationChannel {
  notify(event: EventPayload): Promise<void>
}

/** На какие события подписан канал. Пустой список = все типы. */
export interface Subscription {
  types: EventType[]
  entityId?: string
  category?: string
}
