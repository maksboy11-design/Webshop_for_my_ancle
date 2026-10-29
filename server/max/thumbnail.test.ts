import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import sharp from 'sharp'
import { publicMediaOf, type StoredAttachment } from './attachments'
import { isThumbnailableImage, makeThumbnail, THUMB_BOX, thumbnailPathFor } from './thumbnail'
import { imagesNeedingThumbnail, withThumbnails } from './thumbnailBackfill'

const BLOB = 'https://abc.public.blob.vercel-storage.com'

describe('thumbnail', () => {
  it('stable thumbnail path next to the original', () => {
    assert.equal(thumbnailPathFor('reviews/1/m/0.jpg'), 'reviews/1/m/0.thumb.webp')
    assert.equal(thumbnailPathFor('/reviews/1/m/2'), 'reviews/1/m/2.thumb.webp')
  })

  it('only images within size limit are thumbnailed', () => {
    assert.equal(isThumbnailableImage('image/jpeg', 10), true)
    assert.equal(isThumbnailableImage('video/mp4', 10), false)
    assert.equal(isThumbnailableImage('image/png', 0), false)
    assert.equal(isThumbnailableImage('image/png', 30 * 1024 * 1024), false)
  })

  it('makes a small WebP inside 160px box without enlarging', async () => {
    const big = await sharp({ create: { width: 1600, height: 900, channels: 3, background: '#7a5' } }).jpeg().toBuffer()
    const out = await makeThumbnail(big, 'image/jpeg')
    assert.ok(out)
    const meta = await sharp(out).metadata()
    assert.equal(meta.format, 'webp')
    assert.equal(meta.width, THUMB_BOX)
    assert.ok((meta.height ?? 0) <= THUMB_BOX)
    assert.ok(out.length < big.length)
    const tiny = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#000' } }).png().toBuffer()
    const meta2 = await sharp((await makeThumbnail(tiny, 'image/png'))!).metadata()
    assert.equal(meta2.width, 40)
  })

  it('broken image yields null instead of throwing', async () => {
    assert.equal(await makeThumbnail(Buffer.from('not an image'), 'image/jpeg'), null)
  })

  it('publicMediaOf keeps thumbnailSrc for images only and stays compatible without it', () => {
    const base: StoredAttachment = {
      type: 'image', token: 't', photoId: null, width: null, height: null, duration: null, size: null,
      sourceUrl: null, persistedSrc: `${BLOB}/reviews/1/m/0.jpg`,
    }
    const withThumb = publicMediaOf([{ ...base, thumbnailSrc: `${BLOB}/reviews/1/m/0.thumb.webp` }])
    assert.equal(withThumb[0]?.thumbnailSrc, `${BLOB}/reviews/1/m/0.thumb.webp`)
    assert.equal(withThumb[0]?.src, `${BLOB}/reviews/1/m/0.jpg`)
    assert.deepEqual(publicMediaOf([base])[0], { type: 'image', src: `${BLOB}/reviews/1/m/0.jpg`, poster: null, alt: null })
  })
})

describe('thumbnail backfill planning', () => {
  const media = [
    { type: 'image', src: `${BLOB}/reviews/1/m/0.jpg`, poster: null, alt: null },
    { type: 'image', src: `${BLOB}/reviews/1/m/1.jpg`, thumbnailSrc: `${BLOB}/reviews/1/m/1.thumb.webp`, poster: null, alt: null },
    { type: 'video', src: `${BLOB}/reviews/1/m/2.mp4`, poster: null, alt: null },
    { type: 'image', src: 'https://evil.example.com/reviews/x.jpg', poster: null, alt: null },
    { type: 'image', src: `${BLOB}/other/x.jpg`, poster: null, alt: null },
  ]

  it('selects only own blob images without thumbnails', () => {
    assert.deepEqual(imagesNeedingThumbnail(media), [{ src: `${BLOB}/reviews/1/m/0.jpg`, pathname: 'reviews/1/m/0.jpg' }])
    assert.deepEqual(imagesNeedingThumbnail(null), [])
  })

  it('is idempotent: applying twice changes nothing the second time', () => {
    const map = new Map([[`${BLOB}/reviews/1/m/0.jpg`, `${BLOB}/reviews/1/m/0.thumb.webp`]])
    const first = withThumbnails(media, map)
    assert.equal(first.changed, 1)
    assert.equal((first.media[0] as { thumbnailSrc: string }).thumbnailSrc, `${BLOB}/reviews/1/m/0.thumb.webp`)
    assert.deepEqual(first.media.slice(1), media.slice(1))
    assert.equal(withThumbnails(first.media, map).changed, 0)
    assert.deepEqual(imagesNeedingThumbnail(first.media), [])
  })
})
