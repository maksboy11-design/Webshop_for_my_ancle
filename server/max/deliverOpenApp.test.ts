import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deliverOutbox, withoutOpenApp } from './deliver'
import { MaxPermanentError, MaxTemporaryError, type InlineKeyboard, type MaxClient } from './maxClient'
import type { Log } from './logger'
import type { OutboxJob, ReviewStore } from './store'

const kb: InlineKeyboard = {
  type: 'inline_keyboard',
  payload: { buttons: [[{ type: 'open_app', text: 'Опубликованные отзывы', contact_id: 532488092, payload: 'published_reviews' }], [{ type: 'callback', text: 'X', payload: 'x' }]] },
}

function setup(fail: (a: InlineKeyboard | null, n: number) => Error | null) {
  const sent: (InlineKeyboard | null)[] = []
  const deleted: string[] = []
  const released: string[] = []
  const logs: { event: string; fields: unknown }[] = []
  const send = async (a: InlineKeyboard | null) => {
    const err = fail(a, sent.length)
    sent.push(a)
    if (err) throw err
  }
  const max = { sendMessage: (i: { attachments: InlineKeyboard | null }) => send(i.attachments), answerCallback: (i: { attachments: InlineKeyboard | null }) => send(i.attachments), getMessage: async () => null } as unknown as MaxClient
  const store = { claimSend: async () => 'claimed', deleteOutbox: async (id: string) => void deleted.push(id), releaseOutbox: async (id: string) => void released.push(id) } as unknown as ReviewStore
  const log = { info: () => {}, warn: () => {}, error: (event: string, fields: unknown) => void logs.push({ event, fields }) } as unknown as Log
  return { sent, deleted, released, logs, run: (job: Partial<OutboxJob>) => deliverOutbox([{ id: 'j1', kind: 'message', chatId: null, userId: '1', text: 'hi', attachments: kb, ...job } as OutboxJob], store, max, log, () => new Date(), async () => {}, 60000) }
}

const hasOpenApp = (a: InlineKeyboard | null) => !!a?.payload.buttons.flat().some((b) => b.type === 'open_app')

test('withoutOpenApp replaces open_app with m:pl:0 callback, keeps others', () => {
  const r = withoutOpenApp(kb)!
  assert.deepEqual(r.payload.buttons[0][0], { type: 'callback', text: 'Опубликованные отзывы', payload: 'm:pl:0' })
  assert.deepEqual(r.payload.buttons[1][0], kb.payload.buttons[1][0])
  assert.equal(withoutOpenApp({ type: 'inline_keyboard', payload: { buttons: [[{ type: 'callback', text: 'a', payload: 'b' }]] } }), null)
})

test('400 on open_app message retries once with callback fallback and delivers', async () => {
  const s = setup((a) => (hasOpenApp(a) ? new MaxPermanentError(400) : null))
  assert.equal(await s.run({}), 'ok')
  assert.equal(s.sent.length, 2)
  assert.equal(hasOpenApp(s.sent[1]), false)
  assert.deepEqual(s.deleted, ['j1'])
  assert.equal(s.logs[0].event, 'max_open_app_rejected')
  assert.ok(!JSON.stringify(s.logs).includes('hi'))
})

test('400 on open_app callback answer also falls back', async () => {
  const s = setup((a) => (hasOpenApp(a) ? new MaxPermanentError(400) : null))
  assert.equal(await s.run({ kind: 'callback_answer', callbackId: 'cb' } as Partial<OutboxJob>), 'ok')
  assert.equal(s.sent.length, 2)
  assert.equal(s.logs.some((l) => l.event === 'max_delivery_failed'), false)
})

test('temporary error is not retried with fallback, job released', async () => {
  const s = setup(() => new MaxTemporaryError(503))
  assert.equal(await s.run({}), 'retry')
  assert.equal(s.sent.length, 1)
  assert.deepEqual(s.released, ['j1'])
})

test('400 without open_app is not retried', async () => {
  const s = setup(() => new MaxPermanentError(400))
  await s.run({ attachments: null } as Partial<OutboxJob>)
  assert.equal(s.sent.length, 1)
  assert.deepEqual(s.deleted, ['j1'])
})
