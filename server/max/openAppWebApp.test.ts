import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { withOpenAppWebApp } from './deliver'
import { createMaxClient, MaxPermanentError } from './maxClient'
import type { InlineKeyboard } from './maxClient'

const kb: InlineKeyboard = {
  type: 'inline_keyboard',
  payload: { buttons: [[{ type: 'open_app', text: 'Опубликованные отзывы', contact_id: 1, payload: 'x' }]] },
}

describe('open_app web_app', () => {
  it('fills web_app with bot username (MAX docs: username or link required)', () => {
    const out = withOpenAppWebApp(kb, 'silk_bot')
    assert.deepEqual(out?.payload.buttons[0][0], { type: 'open_app', text: 'Опубликованные отзывы', contact_id: 1, payload: 'x', web_app: 'silk_bot' })
  })
  it('keeps explicit web_app and no-ops without username', () => {
    assert.equal(withOpenAppWebApp(kb, null), kb)
    const explicit: InlineKeyboard = { type: 'inline_keyboard', payload: { buttons: [[{ type: 'open_app', text: 't', web_app: 'own' }]] } }
    assert.equal(withOpenAppWebApp(explicit, 'silk_bot'), explicit)
  })
  it('getBotUsername reads /me once and caches', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      return new Response(JSON.stringify({ user_id: 1, username: 'silk_bot' }), { headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch
    const client = createMaxClient('t', fetchImpl)
    assert.equal(await client.getBotUsername?.(), 'silk_bot')
    assert.equal(await client.getBotUsername?.(), 'silk_bot')
    assert.equal(calls, 1)
  })
  it('400 error exposes sanitized MAX code/message', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ code: 'proto.payload', message: 'Invalid button <x>' }), { status: 400 })) as unknown as typeof fetch
    const client = createMaxClient('t', fetchImpl)
    const err = await client.sendMessage({ chatId: null, userId: '5', text: 'hi', attachments: null }).catch((e) => e)
    assert.ok(err instanceof MaxPermanentError)
    assert.equal(err.apiCode, 'proto.payload')
    assert.equal(err.apiMessage, 'Invalid button x')
  })
})
