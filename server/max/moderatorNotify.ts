import type { StoredAttachment } from './attachments'
import type { InlineKeyboard, MediaRef } from './maxClient'
import type { IncomingContent, NewJob } from './store'
import { fitMessage } from './text'

/** Сколько медиа прикладываем к одному сообщению (MAX допускает до 12 видео в запросе; запас под клавиатуру). */
export const NOTIFY_MEDIA_MAX = 9

const HEADING = '==НОВЫЙ ОТЗЫВ В ГРУППЕ=='
const CONTENT_HEADING = '==КОНТЕНТ (ИЗОБРАЖЕНИЯ И ВИДЕО)=='
const TEXT_HEADING = '==ТЕКСТ ОТЗЫВА=='

/** Медиа, которые можно приложить: фото по постоянному URL или token, видео только по token (URL для видео API не принимает). */
export function mediaRefsOf(items: readonly StoredAttachment[]): MediaRef[] {
  const refs: MediaRef[] = []
  for (const item of items) {
    if (item.type === 'image' && (item.persistedSrc || item.token)) {
      refs.push({ type: 'image', token: item.token, url: item.persistedSrc })
    } else if (item.type === 'video' && item.token) {
      refs.push({ type: 'video', token: item.token, url: item.persistedSrc })
    }
  }
  return refs.slice(0, NOTIFY_MEDIA_MAX)
}

function counts(items: readonly StoredAttachment[]): { images: number; videos: number; total: number } {
  const images = items.filter((item) => item.type === 'image').length
  const videos = items.filter((item) => item.type === 'video').length
  return { images, videos, total: items.length }
}

function contentLine(items: readonly StoredAttachment[], media: readonly MediaRef[]): string {
  const all = counts(items)
  if (all.total === 0) return 'Изображений и видео нет.'
  const attached = {
    images: media.filter((item) => item.type === 'image').length,
    videos: media.filter((item) => item.type === 'video').length,
  }
  const parts: string[] = []
  if (attached.images + attached.videos > 0) {
    parts.push(`Приложено к сообщению: фото — ${attached.images}, видео — ${attached.videos}.`)
  }
  const missed = all.total - attached.images - attached.videos
  if (missed > 0) parts.push(`Не удалось приложить вложений: ${missed}.`)
  return parts.join(' ')
}

function linksBlock(items: readonly StoredAttachment[]): string {
  const lines: string[] = []
  let photo = 0
  let video = 0
  for (const item of items) {
    if (item.type === 'image') photo += 1
    else if (item.type === 'video') video += 1
    else continue
    if (!item.persistedSrc) continue
    lines.push(`${item.type === 'image' ? `Фото ${photo}` : `Видео ${video}`}: ${item.persistedSrc}`)
  }
  const total = counts(items).images + counts(items).videos
  if (lines.length === 0) return `Не удалось приложить медиа (${total}). Ссылок нет, откройте сообщение в группе.`
  return `Не удалось приложить медиа к сообщению, ссылки:\n${lines.join('\n')}`
}

function assemble(content: string, review: string): string {
  return fitMessage(`${HEADING}\n\n${CONTENT_HEADING}\n\n${content}\n\n${TEXT_HEADING}\n\n${review}`)
}

export function notificationText(content: IncomingContent, media: readonly MediaRef[]): string {
  return assemble(contentLine(content.attachments, media), content.publicText ?? '(текста нет)')
}

/** Тот же формат, но без вложений: медиа даны ссылками. Используется, если MAX отклонил сообщение с вложениями. */
export function notificationFallbackText(content: IncomingContent): string {
  return assemble(linksBlock(content.attachments), content.publicText ?? '(текста нет)')
}

/** Ровно две кнопки: «Отклонить» и «Опубликовать» (те же m:r / m:a, что в меню модератора). */
export function notificationKeyboard(id: string): InlineKeyboard {
  return {
    type: 'inline_keyboard',
    payload: {
      buttons: [
        [
          { type: 'callback', text: 'Отклонить', payload: `m:r:${id}` },
          { type: 'callback', text: 'Опубликовать', payload: `m:a:${id}` },
        ],
      ],
    },
  }
}

export function moderatorNotificationJobs(content: IncomingContent, moderators: Iterable<string>): NewJob[] {
  const media = mediaRefsOf(content.attachments)
  const text = notificationText(content, media)
  const keyboard = notificationKeyboard(content.id)
  const attachments: InlineKeyboard =
    media.length > 0 ? { ...keyboard, media, fallbackText: notificationFallbackText(content) } : keyboard
  return [...moderators].map(
    (userId): NewJob => ({
      kind: 'message',
      chatId: null,
      userId,
      callbackId: null,
      text,
      attachments,
      notification: null,
    }),
  )
}