export const REVIEW_TEXT_MAX = 2000
export const AUTHOR_MAX = 80
export const OUTGOING_MAX = 4000

const CONTROLS = new RegExp(`[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]`)
const BIDI = /[\u202A-\u202E\u2066-\u2069]/g

export function codePointLength(value: string): number {
  return Array.from(value).length
}

export function fitMessage(text: string): string {
  const chars = Array.from(text)
  if (chars.length <= OUTGOING_MAX) return text
  return `${chars.slice(0, OUTGOING_MAX - 1).join('')}…`
}

function normalize(input: string): string {
  return input.replaceAll('\u0000', '').replace(BIDI, '').replace(/\n{3,}/g, '\n\n').trim()
}

export function reviewText(input: string): { ok: true; text: string } | { ok: false; reason: 'empty' | 'too_long' | 'controls' } {
  const withoutNul = input.replaceAll('\u0000', '')
  if (CONTROLS.test(withoutNul)) return { ok: false, reason: 'controls' }
  const text = normalize(input)
  const length = codePointLength(text)
  if (length === 0) return { ok: false, reason: 'empty' }
  if (length > REVIEW_TEXT_MAX) return { ok: false, reason: 'too_long' }
  return { ok: true, text }
}

export function authorName(input: string): { ok: true; text: string } | { ok: false; reason: 'empty' | 'too_long' | 'controls' } {
  const withoutNul = input.replaceAll('\u0000', '')
  if (CONTROLS.test(withoutNul)) return { ok: false, reason: 'controls' }
  const text = normalize(input)
  const length = codePointLength(text)
  if (length === 0) return { ok: false, reason: 'empty' }
  if (length > AUTHOR_MAX) return { ok: false, reason: 'too_long' }
  return { ok: true, text }
}

export type CommandName =
  | '/content_pending'
  | '/whoami'
  | '/moderator_id'
  | '/help'
  | '/menu'
  | '/moderate'
  | '/start'
  | '/review'
  | '/cancel'
  | '/reviews_pending'
  | '/review_approve'
  | '/review_reject'
  | '/unknown'

export interface Command {
  name: CommandName
  arg: string | null
}

export function parseCommand(text: string): Command | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) return null
  const [head, ...rest] = trimmed.split(/\s+/)
  const name = (head ?? '').toLowerCase()
  const arg = rest.join(' ').trim()
  if (name === '/start' || name === '/review' || name === '/cancel' || name === '/reviews_pending' || name === '/content_pending' || name === '/whoami' || name === '/moderator_id' || name === '/help' || name === '/menu' || name === '/moderate') {
    return { name, arg: null }
  }
  if (name === '/review_approve' || name === '/review_reject') {
    return { name, arg: arg || null }
  }
  return { name: '/unknown', arg: null }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function reviewId(value: string | null): string | null {
  if (!value || !UUID.test(value)) return null
  return value.toLowerCase()
}
