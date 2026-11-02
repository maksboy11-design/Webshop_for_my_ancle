import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hasUnsavedWork, registerUnsavedGuard, tryReloadForChunkError } from '../src/chunkReload'
import { initDataSecondsLeft, isAuthLost, saveLabel } from '../src/admin-reviews/pages/editorOps'

test('деплой во время правок: chunkReload не перезагружает «грязный» редактор', () => {
  let dirty = true
  const off = registerUnsavedGuard(() => dirty)
  assert.equal(hasUnsavedWork(), true)
  // window нет — если бы guard не сработал, тут упала бы попытка reload
  assert.equal(tryReloadForChunkError(new TypeError('Failed to fetch dynamically imported module: /assets/x.js')), false)
  dirty = false
  assert.equal(hasUnsavedWork(), false)
  off()
  dirty = true
  assert.equal(hasUnsavedWork(), false)
})

test('срок сессии MAX читается из auth_date', () => {
  const now = 1_800_000_000_000
  const auth = Math.floor(now / 1000) - 3000
  assert.equal(initDataSecondsLeft(`auth_date=${auth}&hash=x`, now), 600)
  assert.equal(initDataSecondsLeft('hash=x', now), null)
  assert.equal(initDataSecondsLeft('', now), null)
})

test('потеря сессии и статус сохранения', () => {
  assert.ok(isAuthLost('expired_init_data'))
  assert.ok(!isAuthLost('conflict'))
  assert.equal(saveLabel({ saving: true, dirty: true, error: false }), 'Сохраняю…')
  assert.equal(saveLabel({ saving: false, dirty: true, error: false }), 'Не сохранено')
  assert.equal(saveLabel({ saving: false, dirty: false, error: true }), 'Не сохранено')
  assert.equal(saveLabel({ saving: false, dirty: false, error: false }), 'Сохранено')
})

import { authorizeAdmin, issueAdminSession, verifyAdminSession, ADMIN_SESSION_MAX_SEC } from '../server/max/adminAuth'
import { signWebAppInitDataForTests } from '../server/max/webAppInitData'

test('админ-сессия: продление до 12 ч, подпись, модератор на каждом запросе', () => {
  const BOT = 'bot-secret'
  const t0 = 1_800_000_000
  let now = t0
  const deps = { botToken: BOT, moderators: new Set(['42']), moderatorsConfigured: true, now: () => new Date(now * 1000) }
  const init = signWebAppInitDataForTests({ auth_date: String(t0), user: JSON.stringify({ id: 42 }) }, BOT)
  const req = (h: Record<string, string>) => new Request('https://x.test/', { headers: h })
  const a = authorizeAdmin(req({ 'x-max-init-data': init }), deps)
  assert.ok(a.ok)
  let s = issueAdminSession(BOT, '42', t0, now)
  assert.ok(!s.token.includes(BOT))
  // через 2 ч initData протух, но сессия (продлеваемая) работает
  for (now = t0; now < t0 + 11 * 3600; now += 1800) {
    const r = authorizeAdmin(req({ 'x-max-init-data': init, 'x-admin-session': s.token }), deps)
    assert.ok(r.ok, `at +${now - t0}`)
    assert.equal(r.ok && r.orig, t0)
    s = issueAdminSession(BOT, '42', t0, now)
  }
  // абсолютный предел 12 ч
  now = t0 + ADMIN_SESSION_MAX_SEC
  assert.deepEqual(verifyAdminSession(s.token, BOT, now), { ok: false, reason: 'expired' })
  assert.equal(issueAdminSession(BOT, '42', t0, now).exp, t0 + ADMIN_SESSION_MAX_SEC)
  const r = authorizeAdmin(req({ 'x-max-init-data': init, 'x-admin-session': s.token }), deps)
  assert.ok(!r.ok && r.status === 401 && r.error === 'expired_init_data')
  // подделка и чужой ключ
  now = t0 + 60
  const good = issueAdminSession(BOT, '42', t0, now).token
  const [p] = good.split('.')
  const forged = Buffer.from(JSON.stringify({ v: 1, u: '42', o: now, e: now + 3600 })).toString('base64url') + '.' + good.split('.')[1]
  assert.equal(verifyAdminSession(forged, BOT, now).ok, false)
  assert.equal(verifyAdminSession(good, 'other', now).ok, false)
  assert.equal(verifyAdminSession(p + '.x', BOT, now).ok, false)
  // снятый модератор теряет доступ сразу
  const r403 = authorizeAdmin(req({ 'x-admin-session': good }), { ...deps, moderators: new Set(['7']) })
  assert.ok(!r403.ok && r403.status === 403)
})
