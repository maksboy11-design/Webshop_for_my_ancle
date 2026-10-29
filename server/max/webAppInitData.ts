/**
 * Проверка стартовых данных MAX Mini App по официальной схеме validation:
 * https://dev.max.ru/docs/webapps/validation/
 * secret_key = HMAC_SHA256(key="WebAppData", data=bot_token);
 * hash = hex(HMAC_SHA256(secret_key, data_check_string)).
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

const DEFAULT_MAX_AGE_SEC = 3600

export type InitDataOk = { ok: true; userId: string; authDate: number }
export type InitDataFail = { ok: false; reason: 'missing' | 'bad_hash' | 'expired' | 'bad_user' | 'bad_auth_date' }

function hmacHex(key: Buffer | string, data: string): string {
  return createHmac('sha256', key).update(data).digest('hex')
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, 'hex')
    const bb = Buffer.from(b, 'hex')
    if (ba.length === 0 || ba.length !== bb.length) return false
    return timingSafeEqual(ba, bb)
  } catch {
    return false
  }
}

/** Нормализует строку initData и проверяет подпись + срок + user.id. */
export function validateWebAppInitData(
  initData: string,
  botToken: string,
  nowSec: number,
  maxAgeSec = DEFAULT_MAX_AGE_SEC,
): InitDataOk | InitDataFail {
  if (!initData || typeof initData !== 'string' || !botToken) return { ok: false, reason: 'missing' }
  let params: URLSearchParams
  try {
    params = new URLSearchParams(initData)
  } catch {
    return { ok: false, reason: 'missing' }
  }
  const hash = params.get('hash')
  if (!hash || !/^[0-9a-f]+$/i.test(hash)) return { ok: false, reason: 'bad_hash' }
  params.delete('hash')
  const pairs = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join('\n')
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest()
  const computed = hmacHex(secretKey, dataCheckString)
  if (!safeEqualHex(computed, hash.toLowerCase())) return { ok: false, reason: 'bad_hash' }

  const authRaw = params.get('auth_date')
  if (!authRaw || !/^\d+$/.test(authRaw)) return { ok: false, reason: 'bad_auth_date' }
  const authDate = Number(authRaw)
  if (!Number.isSafeInteger(authDate) || authDate <= 0) return { ok: false, reason: 'bad_auth_date' }
  if (nowSec - authDate > maxAgeSec || authDate > nowSec + 60) return { ok: false, reason: 'expired' }

  const userRaw = params.get('user')
  if (!userRaw) return { ok: false, reason: 'bad_user' }
  let user: unknown
  try {
    user = JSON.parse(userRaw)
  } catch {
    return { ok: false, reason: 'bad_user' }
  }
  if (!user || typeof user !== 'object') return { ok: false, reason: 'bad_user' }
  const id = (user as { id?: unknown }).id
  if (typeof id !== 'number' && typeof id !== 'string') return { ok: false, reason: 'bad_user' }
  const userId = String(id)
  if (!/^[1-9][0-9]{0,15}$/.test(userId) || !Number.isSafeInteger(Number(userId))) {
    return { ok: false, reason: 'bad_user' }
  }
  return { ok: true, userId, authDate }
}

/** Собирает подписанный initData для unit-тестов (не для production). */
export function signWebAppInitDataForTests(
  fields: Record<string, string>,
  botToken: string,
): string {
  const params = new URLSearchParams(fields)
  const pairs = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join('\n')
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest()
  const hash = hmacHex(secretKey, dataCheckString)
  params.set('hash', hash)
  return params.toString()
}
