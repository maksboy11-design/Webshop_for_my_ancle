import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { toSameOriginMedia, REVIEW_BLOB_HOST } from '../src/admin-reviews/mediaUrl'

test('blob review media mapped to same-origin path', () => {
  assert.equal(
    toSameOriginMedia(`https://${REVIEW_BLOB_HOST}/reviews/-1/mid_a/0.webp`),
    '/review-media/-1/mid_a/0.webp',
  )
})
test('other urls untouched', () => {
  assert.equal(toSameOriginMedia('/x.png'), '/x.png')
  assert.equal(toSameOriginMedia('https://other.public.blob.vercel-storage.com/reviews/a.mp4'), 'https://other.public.blob.vercel-storage.com/reviews/a.mp4')
  assert.equal(toSameOriginMedia(null), undefined)
})
test('vercel.json has matching rewrite', () => {
  const cfg = JSON.parse(readFileSync('vercel.json', 'utf8'))
  const r = cfg.rewrites.find((x: { source: string }) => x.source === '/review-media/:path*')
  assert.equal(r?.destination, `https://${REVIEW_BLOB_HOST}/reviews/:path*`)
})
