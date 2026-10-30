import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fetchGetWithRetry } from '../src/lib/fetchRetry'

describe('fetchGetWithRetry', () => {
  it('returns on first ok', async () => {
    let calls = 0
    const original = globalThis.fetch
    globalThis.fetch = (async () => {
      calls += 1
      return new Response('ok', { status: 200 })
    }) as typeof fetch
    try {
      const res = await fetchGetWithRetry('/x', {}, { attempts: 3, baseDelayMs: 1, timeoutMs: 1000 })
      assert.equal(res.status, 200)
      assert.equal(calls, 1)
    } finally {
      globalThis.fetch = original
    }
  })

  it('retries 503 then succeeds', async () => {
    let calls = 0
    const original = globalThis.fetch
    globalThis.fetch = (async () => {
      calls += 1
      if (calls < 3) return new Response('no', { status: 503 })
      return new Response('ok', { status: 200 })
    }) as typeof fetch
    try {
      const res = await fetchGetWithRetry('/x', {}, { attempts: 3, baseDelayMs: 5, timeoutMs: 1000 })
      assert.equal(res.status, 200)
      assert.equal(calls, 3)
    } finally {
      globalThis.fetch = original
    }
  })

  it('does not retry 404', async () => {
    let calls = 0
    const original = globalThis.fetch
    globalThis.fetch = (async () => {
      calls += 1
      return new Response('no', { status: 404 })
    }) as typeof fetch
    try {
      const res = await fetchGetWithRetry('/x', {}, { attempts: 3, baseDelayMs: 5, timeoutMs: 1000 })
      assert.equal(res.status, 404)
      assert.equal(calls, 1)
    } finally {
      globalThis.fetch = original
    }
  })
})
