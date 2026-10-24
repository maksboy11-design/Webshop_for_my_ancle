import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  attachmentsForStorage,
  attachmentsNeedPersist,
  publicMediaOf,
  readAttachments,
} from './attachments'
import { isAllowedMaxMediaUrl, isAllowedPublicMediaSrc } from './mediaHosts'

describe('attachments media pipeline', () => {
  it('keeps allowlisted sourceUrl in memory and strips it for storage', () => {
    const items = readAttachments([
      {
        type: 'image',
        payload: { photo_id: 5, token: 'img', url: 'https://i.okcdn.ru/photo.jpg' },
      },
      {
        type: 'video',
        payload: { token: 'vid', url: 'https://vd.oneme.ru/clip.mp4', width: 320, height: 240, duration: 3 },
      },
      {
        type: 'image',
        payload: { token: 'evil', url: 'http://127.0.0.1/x.jpg' },
      },
    ])
    assert.equal(items[0]?.sourceUrl, 'https://i.okcdn.ru/photo.jpg')
    assert.equal(items[1]?.sourceUrl, 'https://vd.oneme.ru/clip.mp4')
    assert.equal(items[2]?.sourceUrl, null)
    assert.equal(attachmentsNeedPersist(items), true)
    const stored = attachmentsForStorage(items)
    assert.equal(stored[0]?.sourceUrl, null)
    assert.equal(JSON.stringify(stored).includes('okcdn'), false)
  })

  it('exposes only persisted public media', () => {
    const media = publicMediaOf([
      {
        type: 'image',
        token: 'a',
        photoId: '1',
        width: null,
        height: null,
        duration: null,
        size: null,
        sourceUrl: 'https://i.okcdn.ru/x.jpg',
        persistedSrc: 'https://abc.blob.vercel-storage.com/reviews/1.jpg',
      },
      {
        type: 'video',
        token: 'b',
        photoId: null,
        width: 1,
        height: 1,
        duration: 1,
        size: null,
        sourceUrl: null,
        persistedSrc: null,
      },
    ])
    assert.deepEqual(media, [
      {
        type: 'image',
        src: 'https://abc.blob.vercel-storage.com/reviews/1.jpg',
        poster: null,
        alt: null,
      },
    ])
  })

  it('allowlists MAX CDN and Vercel Blob hosts only', () => {
    assert.equal(isAllowedMaxMediaUrl('https://i.okcdn.ru/a.jpg'), true)
    assert.equal(isAllowedMaxMediaUrl('https://evil.example/a.jpg'), false)
    assert.equal(isAllowedPublicMediaSrc('/clips/a.mp4'), true)
    assert.equal(isAllowedPublicMediaSrc('https://abc.blob.vercel-storage.com/a.mp4'), true)
    assert.equal(isAllowedPublicMediaSrc('https://i.okcdn.ru/a.jpg'), false)
  })
})
