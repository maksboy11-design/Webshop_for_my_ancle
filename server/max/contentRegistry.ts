export interface ContentTypeHandler {
  kind: string
  permission: 'dialog-participant' | 'moderator'
  publication: 'explicit-consent-and-moderator'
  acceptsAttachments: boolean
}

/**
 * Реестр типов контента. Сейчас подключён только отзыв.
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
} as const satisfies Record<string, ContentTypeHandler>

export function implementedContentKinds(): string[] {
  return Object.keys(contentHandlers)
}
