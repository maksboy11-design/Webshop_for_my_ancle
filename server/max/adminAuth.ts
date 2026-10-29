/**
 * Общая авторизация административных API Mini App (отзывы, товары, вебинары).
 * Единственное доказательство личности — подписанный initData MAX (HMAC от MAX_BOT_TOKEN, свежий auth_date)
 * + членство в MAX_REVIEW_MODERATOR_IDS. initDataUnsafe и user_id из тела запроса не принимаются.
 */
import { validateWebAppInitData } from './webAppInitData'

export interface AdminAuthDeps {
  botToken: string | null
  moderators: ReadonlySet<string>
  moderatorsConfigured: boolean
  now: () => Date
}

export type AdminAuthResult = { ok: true; userId: string } | { ok: false; status: number; error: string }

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
  const initData = readInitData(request)
  if (!initData) return { ok: false, status: 401, error: 'missing_init_data' }
  const nowSec = Math.floor(deps.now().getTime() / 1000)
  const checked = validateWebAppInitData(initData, deps.botToken, nowSec)
  if (!checked.ok) {
    if (checked.reason === 'expired') return { ok: false, status: 401, error: 'expired_init_data' }
    return { ok: false, status: 401, error: 'invalid_init_data' }
  }
  if (!deps.moderators.has(checked.userId)) return { ok: false, status: 403, error: 'forbidden' }
  return { ok: true, userId: checked.userId }
}
