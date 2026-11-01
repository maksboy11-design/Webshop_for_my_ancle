import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { weakEtag, withCacheEtag } from './http'

describe('withCacheEtag', () => {
  it('ставит ETag и отдаёт 304 при совпадении If-None-Match', () => {
    const body = { ok: true, n: 1 }
    const r1 = withCacheEtag(new Request('https://x.test/p'), body, 'public, s-maxage=30')
    assert.equal(r1.status, 200)
    const etag = r1.headers.get('etag')
    assert.ok(etag?.startsWith('W/"'))
    assert.match(r1.headers.get('cache-control') ?? '', /s-maxage=30/)
    const r2 = withCacheEtag(
      new Request('https://x.test/p', { headers: { 'if-none-match': etag! } }),
      body,
      'public, s-maxage=30',
    )
    assert.equal(r2.status, 304)
    assert.equal(r2.headers.get('etag'), etag)
  })

  it('меняет ETag при смене тела (после publish)', () => {
    const a = withCacheEtag(new Request('https://x.test/'), { v: 1 }, 'public, max-age=0')
    const b = withCacheEtag(new Request('https://x.test/'), { v: 2 }, 'public, max-age=0')
    assert.notEqual(a.headers.get('etag'), b.headers.get('etag'))
    assert.notEqual(weakEtag('a'), weakEtag('b'))
  })
})
