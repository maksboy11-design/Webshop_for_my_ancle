import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { signWebAppInitDataForTests, validateWebAppInitData } from './webAppInitData'

const TOKEN = 'test-bot-token-for-hmac'

describe('validateWebAppInitData', () => {
  it('принимает корректную подпись и user.id', () => {
    const now = 1_700_000_000
    const initData = signWebAppInitDataForTests(
      {
        auth_date: String(now),
        user: JSON.stringify({ id: 42, first_name: 'Mod' }),
      },
      TOKEN,
    )
    const result = validateWebAppInitData(initData, TOKEN, now)
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.userId, '42')
  })

  it('отклоняет подделанный hash', () => {
    const now = 1_700_000_000
    const initData = signWebAppInitDataForTests(
      { auth_date: String(now), user: JSON.stringify({ id: 42 }) },
      TOKEN,
    )
    const tampered = initData.replace(/hash=[0-9a-f]+/i, 'hash=' + 'ab'.repeat(32))
    const result = validateWebAppInitData(tampered, TOKEN, now)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.reason, 'bad_hash')
  })

  it('отклоняет просроченные данные', () => {
    const auth = 1_700_000_000
    const initData = signWebAppInitDataForTests(
      { auth_date: String(auth), user: JSON.stringify({ id: 42 }) },
      TOKEN,
    )
    const result = validateWebAppInitData(initData, TOKEN, auth + 3601)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.reason, 'expired')
  })

  it('отклоняет отсутствие user', () => {
    const now = 1_700_000_000
    const initData = signWebAppInitDataForTests({ auth_date: String(now) }, TOKEN)
    const result = validateWebAppInitData(initData, TOKEN, now)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.reason, 'bad_user')
  })
})
