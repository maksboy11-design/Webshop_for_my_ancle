import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createPostgresStore, type SqlClient, type SqlPool } from './postgresStore'

const HOSTILE = `'); DROP TABLE product_reviews; --`

function recorder() {
  const calls: { text: string; values?: readonly unknown[] }[] = []
  const client: SqlClient = {
    async query(text, values) {
      calls.push({ text, values })
      return { rows: [], rowCount: 0 }
    },
    release() {},
  }
  const pool: SqlPool = {
    async connect() {
      return client
    },
  }
  return { calls, pool }
}

describe('postgres review store', () => {
  it('передаёт текст отзыва и идентификатор товара параметрами, а не частью SQL', async () => {
    const { calls, pool } = recorder()
    const store = createPostgresStore(pool)
    await store.transaction(async (tx) => {
      await tx.insertPending({
        id: '11111111-1111-4111-8111-111111111111',
        productId: 'flagship',
        text: HOSTILE,
        author: null,
        receivedAt: '2026-10-24T08:00:00.000Z',
        consentAt: '2026-10-24T08:00:00.000Z',
        idempotencyKey: 'message_callback:1:cb',
        senderUserId: '7',
      })
    })
    await store.listPublished("flagship' OR '1'='1")
    const insert = calls.find((call) => call.text.includes('INSERT INTO product_reviews'))
    const select = calls.find((call) => call.text.includes('FROM product_reviews') && call.text.includes('published'))
    assert.ok(insert)
    assert.equal(insert.text.includes(HOSTILE), false)
    assert.equal(insert.text.includes('$3'), true)
    assert.equal(insert.values?.[2], HOSTILE)
    assert.ok(select)
    assert.equal(select.text.includes("OR '1'"), false)
    assert.equal(select.text.includes('sender_user_id'), false)
    assert.equal(select.text.includes('moderator_user_id'), false)
    assert.equal(select.values?.[0], "flagship' OR '1'='1")
    await store.transaction(async (tx) => {
      await tx.insertGroupMessage({
        id: '22222222-2222-4222-8222-222222222222',
        chatId: '99',
        messageMid: 'mid.1',
        receivedAt: '2026-10-24T08:00:00.000Z',
        kind: 'review',
        text: HOSTILE,
        publicText: HOSTILE,
        attachments: [{ type: 'image', token: 'img-token-test', photoId: '5', width: null, height: null, duration: null, size: null }],
        status: 'pending',
        idempotencyKey: 'group:99:mid.1',
      })
    })
    const groupInsert = calls.find((call) => call.text.includes('INSERT INTO incoming_content'))
    assert.ok(groupInsert)
    assert.equal(groupInsert.text.includes(HOSTILE), false)
    assert.equal(groupInsert.text.includes('img-token-test'), false)
    assert.equal(groupInsert.text.includes('http://'), false)
    assert.equal(groupInsert.values?.includes(HOSTILE), true)
  })
})
