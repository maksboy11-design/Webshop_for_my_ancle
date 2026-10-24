import type { StoredAttachment } from './attachments'

export type ContentKind = 'review' | 'text' | 'image' | 'video' | 'mixed' | 'unsupported' | 'empty'

export interface Classification {
  kind: ContentKind
  review: boolean
  /** Текст без начального маркера. null, если после маркера текста не осталось. */
  publicText: string | null
  text: string | null
}

const MARKER = /^\s*отзыв(?=$|[\s:=,.;!?—–-])/iu
const STRIP = /^\s*отзыв[\s:=,.;!?—–-]*/iu

function normalizedText(value: string | null): string | null {
  if (value == null) return null
  return value.normalize('NFKC')
}

function kindsOf(attachments: readonly StoredAttachment[]): { images: number; videos: number; unsupported: number } {
  let images = 0
  let videos = 0
  let unsupported = 0
  for (const item of attachments) {
    if (item.type === 'image') images += 1
    else if (item.type === 'video') videos += 1
    else unsupported += 1
  }
  return { images, videos, unsupported }
}

function mediaKind(images: number, videos: number, unsupported: number, hasText: boolean): ContentKind {
  const mediaTypes = Number(images > 0) + Number(videos > 0)
  if (hasText && (mediaTypes > 0 || unsupported > 0)) return 'mixed'
  if (mediaTypes > 1) return 'mixed'
  if (images > 0) return 'image'
  if (videos > 0) return 'video'
  if (unsupported > 0) return 'unsupported'
  if (hasText) return 'text'
  return 'empty'
}

/** Классификация одного сообщения. Маркер «Отзыв» — отдельное первое слово, без учёта регистра. */
export function classifyMessage(text: string | null, attachments: readonly StoredAttachment[]): Classification {
  const normalized = normalizedText(text)
  const { images, videos, unsupported } = kindsOf(attachments)
  const substantiveMedia = images + videos > 0
  if (normalized != null && MARKER.test(normalized)) {
    const stripped = normalized.replace(STRIP, '').trim()
    if (stripped.length === 0 && !substantiveMedia) {
      return { kind: 'empty', review: false, publicText: null, text: normalized }
    }
    return {
      kind: 'review',
      review: true,
      publicText: stripped.length > 0 ? stripped : null,
      text: normalized,
    }
  }
  const hasText = normalized != null && normalized.trim().length > 0
  return {
    kind: mediaKind(images, videos, unsupported, hasText),
    review: false,
    publicText: hasText ? normalized.trim() : null,
    text: normalized,
  }
}
