import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { StoredAttachment } from './attachments'
import { createLogger } from './logger'
import { createMemoryStore } from './memoryStore'
import { persistAttachmentList } from './mediaPersist'

const base: StoredAttachment = {
  type: 'image',
  token: 'img',
  photoId: '1',
  width: null,
  height: null,
  duration: null,
  size: 3,
  sourceUrl: 'https://i.okcdn.ru/photo.jpg',
  persistedSrc: null,
}

describe('mediaPersist', () => {
  it('strips sourceUrl when blob token is missing', async () => {
    const out = await persistAttachmentList([base], 'reviews/99/mid', {
      blobToken: null,
      max: null,
      store: createMemoryStore(),
      log: createLogger(),
      fetchBinary: async () => ({ bytes: Buffer.from([1, 2, 3]), contentType: 'image/jpeg' }),
    })
    assert.equal(out[0]?.sourceUrl, null)
    assert.equal(out[0]?.persistedSrc, null)
  })

  it('keeps already persisted src without re-download', async () => {
    const item: StoredAttachment = {
      ...base,
      sourceUrl: null,
      persistedSrc: 'https://store.blob.vercel-storage.com/reviews/99/mid/0.jpg',
    }
    let fetched = 0
    const out = await persistAttachmentList([item], 'reviews/99/mid', {
      blobToken: 'test-token',
      max: null,
      store: createMemoryStore(),
      log: createLogger(),
      fetchBinary: async () => {
        fetched += 1
        return { bytes: Buffer.from([1]), contentType: 'image/jpeg' }
      },
    })
    assert.equal(fetched, 0)
    assert.equal(out[0]?.persistedSrc, item.persistedSrc)
  })
})
