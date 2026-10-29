export interface ContentTypeHandler {
  kind: string
  permission: 'dialog-participant' | 'moderator'
  publication: 'explicit-consent-and-moderator' | 'moderator-only'
  acceptsAttachments: boolean
}

/**
 * Реестр типов контента. Подключены отзыв и вебинар.
 * Следующий тип добавляется отдельным обработчиком со своей проверкой,
 * правом и правилом публикации, без приёма вложений «по умолчанию».
 */
export const contentHandlers = {
  review: {
    kind: 'review',
    permission: 'dialog-participant',
    publication: 'explicit-consent-and-moderator',
    acceptsAttachments: false,
  },
  /** Вебинар: YouTube-ссылка из разрешённой группы. Публикует только модератор, видео не скачивается. */
  webinar: {
    kind: 'webinar',
    permission: 'moderator',
    publication: 'moderator-only',
    acceptsAttachments: false,
  },
} as const satisfies Record<string, ContentTypeHandler>

export function implementedContentKinds(): string[] {
  return Object.keys(contentHandlers)
}
