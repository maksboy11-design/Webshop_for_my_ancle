/**
 * Общая авторизация административных API Mini App (отзывы, товары, вебинары).
 * Единственное доказательство личности — подписанный initData MAX (HMAC от MAX_BOT_TOKEN, свежий auth_date)
 * + членство в MAX_REVIEW_MODERATOR_IDS. initDataUnsafe и user_id из тела запроса не принимаются.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { validateWebAppInitData } from './webAppInitData'

/** Админ-сессия: продлевается, пока админка открыта, но не дольше 12 ч от входа из MAX. */
export const ADMIN_SESSION_MAX_SEC = 12 * 3600
/** Срок одного токена; клиент обновляет его заранее. */
export const ADMIN_SESSION_TOKEN_SEC = 3600
export const ADMIN_SESSION_HEADER = 'x-admin-session'

// Ключ подписи выводится из секрета бота и НЕ раскрывает его (HMAC с отдельной меткой).
const sessionKey = (botToken: string) => createHmac('sha256', 'silkway-admin-session-v1').update(botToken).digest()
const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url')

export function issueAdminSession(botToken: string, userId: string, origSec: number, nowSec: number): { token: string; exp: number } {
  const exp = Math.min(origSec + ADMIN_SESSION_MAX_SEC, nowSec + ADMIN_SESSION_TOKEN_SEC)
  const payload = b64(JSON.stringify({ v: 1, u: userId, o: origSec, e: exp }))
  const sig = b64(createHmac('sha256', sessionKey(botToken)).update(payload).digest())
  return { token: `${payload}.${sig}`, exp }
}

export type SessionCheck = { ok: true; userId: string; orig: number } | { ok: false; reason: 'bad' | 'expired' }

export function verifyAdminSession(token: string, botToken: string, nowSec: number): SessionCheck {
  const m = /^([A-Za-z0-9_-]{1,512})\.([A-Za-z0-9_-]{43})$/.exec(token)
  if (!m) return { ok: false, reason: 'bad' }
  const want = createHmac('sha256', sessionKey(botToken)).update(m[1]!).digest()
  const got = Buffer.from(m[2]!, 'base64url')
  if (got.length !== want.length || !timingSafeEqual(got, want)) return { ok: false, reason: 'bad' }
  let p: { v?: unknown; u?: unknown; o?: unknown; e?: unknown }
  try {
    p = JSON.parse(Buffer.from(m[1]!, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, reason: 'bad' }
  }
  if (p.v !== 1 || typeof p.u !== 'string' || !/^\d{1,20}$/.test(p.u) || !Number.isSafeInteger(p.o) || !Number.isSafeInteger(p.e))
    return { ok: false, reason: 'bad' }
  const o = p.o as number
  const e = p.e as number
  if (e > o + ADMIN_SESSION_MAX_SEC || o > nowSec + 60) return { ok: false, reason: 'bad' }
  if (nowSec >= e) return { ok: false, reason: 'expired' }
  return { ok: true, userId: p.u, orig: o }
}

export interface AdminAuthDeps {
  botToken: string | null
  moderators: ReadonlySet<string>
  moderatorsConfigured: boolean
  now: () => Date
}

export type AdminAuthResult = { ok: true; userId: string; orig: number } | { ok: false; status: number; error: string }

export function readInitData(request: Request): string | null {
  const header = request.headers.get('x-max-init-data')
  if (header && header.trim()) return header.trim()
  const auth = request.headers.get('authorization')
  if (auth) {
    const m = /^tma\s+(.+)$/i.exec(auth.trim())
    if (m?.[1]) return m[1].trim()
  }
  return null
}

export function authorizeAdmin(request: Request, deps: AdminAuthDeps): AdminAuthResult {
  if (!deps.botToken) return { ok: false, status: 503, error: 'bot_not_configured' }
  if (!deps.moderatorsConfigured) return { ok: false, status: 503, error: 'moderators_not_configured' }
  const nowSec = Math.floor(deps.now().getTime() / 1000)
  // 1) Свежий initData MAX — основной вход.
  const initData = readInitData(request)
  if (initData) {
    const checked = validateWebAppInitData(initData, deps.botToken, nowSec)
    if (checked.ok) {
      if (!deps.moderators.has(checked.userId)) return { ok: false, status: 403, error: 'forbidden' }
      return { ok: true, userId: checked.userId, orig: checked.authDate }
    }
    if (checked.reason !== 'expired') return { ok: false, status: 401, error: 'invalid_init_data' }
  }
  // 2) Админ-сессия (выдана после валидного initData), модератор проверяется на каждом запросе.
  const token = request.headers.get(ADMIN_SESSION_HEADER)?.trim()
  if (token) {
    const s = verifyAdminSession(token, deps.botToken, nowSec)
    if (s.ok) {
      if (!deps.moderators.has(s.userId)) return { ok: false, status: 403, error: 'forbidden' }
      return { ok: true, userId: s.userId, orig: s.orig }
    }
    return { ok: false, status: 401, error: 'expired_init_data' }
  }
  if (!initData) return { ok: false, status: 401, error: 'missing_init_data' }
  return { ok: false, status: 401, error: 'expired_init_data' }
}
