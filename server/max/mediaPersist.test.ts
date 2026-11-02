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
it('resolves video download URL via GET /videos/{token} when webhook had no url', async () => {
    const item: StoredAttachment = {
      type: 'video',
      token: 'tok-vid',
      photoId: null,
      width: 640,
      height: 360,
      duration: 5,
      size: 40 * 1024 * 1024,
      sourceUrl: null,
      persistedSrc: null,
    }
    let fetchedUrl: string | null = null
    const out = await persistAttachmentList([item], 'reviews/1/mid', {
      blobToken: 'test-token',
      max: {
        sendMessage: async () => {},
        answerCallback: async () => {},
        getMessage: async () => null,
        getVideoDownload: async (token) => {
          assert.equal(token, 'tok-vid')
          return { downloadUrl: 'https://vd.oneme.ru/clip.mp4', thumbnailUrl: null }
        },
      },
      store: createMemoryStore(),
      log: createLogger(),
      fetchBinary: async (url, limit) => {
        fetchedUrl = url
        assert.ok(limit >= 40 * 1024 * 1024)
        return { bytes: Buffer.from('mp4data'), contentType: 'video/mp4' }
      },
    })
    assert.equal(fetchedUrl, 'https://vd.oneme.ru/clip.mp4')
    // put() без реального Blob-токена падает — важен сам факт resolve+download, не загрузка.
    assert.equal(out[0]?.sourceUrl, null)
  })

  it('does not mark video-without-url as skipped when max client missing', async () => {
    const item: StoredAttachment = {
      type: 'video',
      token: 'tok',
      photoId: null,
      width: 1,
      height: 1,
      duration: 1,
      size: 1000,
      sourceUrl: null,
      persistedSrc: null,
    }
    let fetched = 0
    const out = await persistAttachmentList([item], 'reviews/1/mid', {
      blobToken: 'test-token',
      max: null,
      store: createMemoryStore(),
      log: createLogger(),
      fetchBinary: async () => {
        fetched += 1
        return { bytes: Buffer.from([1]), contentType: 'video/mp4' }
      },
    })
    assert.equal(fetched, 0)
    assert.equal(out[0]?.persistedSrc, null)
  })
})

