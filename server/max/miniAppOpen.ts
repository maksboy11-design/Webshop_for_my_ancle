/**
 * Открытие Mini App «Опубликованные отзывы» документированной кнопкой open_app
 * (NewMessageBody / POST /messages). Fallback — link на зарегистрированный HTTPS URL.
 */
import type { InlineKeyboard, KeyboardButton } from './maxClient'

export interface MiniAppOpenConfig {
  /** user_id бота (contact_id для open_app). */
  contactId: number | null
  /** Идентификатор web_app из кабинета MAX, если выдан. */
  webApp: string | null
  /** Публичный HTTPS URL страницы Mini App (для link-fallback и инструкции). */
  publicUrl: string | null
}

export function readMiniAppOpenConfig(env: NodeJS.ProcessEnv = process.env): MiniAppOpenConfig {
  const contactRaw = env.MAX_BOT_CONTACT_ID?.trim() ?? ''
  let contactId: number | null = null
  if (/^[1-9][0-9]{0,15}$/.test(contactRaw) && Number.isSafeInteger(Number(contactRaw))) {
    contactId = Number(contactRaw)
  }
  const webApp = env.MAX_WEB_APP_ID?.trim() || null
  const publicUrl = env.MAX_MINI_APP_URL?.trim() || null
  return { contactId, webApp, publicUrl: publicUrl && /^https:\/\//i.test(publicUrl) ? publicUrl : null }
}

export function publishedReviewsOpenButton(cfg: MiniAppOpenConfig): KeyboardButton {
  if (cfg.contactId != null) {
    const button: KeyboardButton = {
      type: 'open_app',
      text: 'Опубликованные отзывы',
      contact_id: cfg.contactId,
    }
    if (cfg.webApp) button.web_app = cfg.webApp
    button.payload = 'published_reviews'
    return button
  }
  if (cfg.publicUrl) {
    return { type: 'link', text: 'Опубликованные отзывы', url: cfg.publicUrl }
  }
  // Конфиг ещё не задан: кнопка-заглушка через callback с подсказкой (откроет сообщение-инструкцию).
  return { type: 'callback', text: 'Опубликованные отзывы', payload: 'm:pl:0' }
}

export function publishedReviewsOpenKeyboard(cfg: MiniAppOpenConfig): InlineKeyboard {
  return {
    type: 'inline_keyboard',
    payload: { buttons: [[publishedReviewsOpenButton(cfg)]] },
  }
}

export const PUBLISHED_REVIEWS_OPEN_TEXT =
  'Опубликованные отзывы открываются в мини-приложении MAX: поиск по словам, фильтры по числу фото и видео, карточки и снятие с сайта. Нажмите кнопку ниже.'
