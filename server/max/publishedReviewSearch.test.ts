import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  countMediaByType,
  matchesSearchCorpus,
  parseAdminReviewListParams,
  previewText,
  searchWords,
} from './publishedReviewSearch'

describe('publishedReviewSearch helpers', () => {
  it('нормализует слова и требует совпадения всех', () => {
    assert.deepEqual(searchWords('  Foo   BAR '), ['foo', 'bar'])
    assert.equal(
      matchesSearchCorpus({ text: 'Foo baz', author: null, productId: 'flagship', words: ['foo', 'bar'] }),
      false,
    )
    assert.equal(
      matchesSearchCorpus({ text: 'Foo', author: 'Bar', productId: 'flagship', words: ['foo', 'bar'] }),
      true,
    )
  })

  it('считает photos/videos по типу и отбрасывает чужие URL', () => {
    const counted = countMediaByType([
      { type: 'image', src: '/ok.png', poster: null, alt: null },
      { type: 'video', src: 'https://evil.test/v.mp4', poster: null, alt: null },
      { type: 'video', src: 'https://blob.vercel-storage.com/v.mp4', poster: null, alt: null },
    ])
    assert.equal(counted.photosCount, 1)
    assert.equal(counted.videosCount, 1)
    assert.equal(counted.safeMedia.length, 2)
  })

  it('парсит фильтры: пусто / 0 / ошибка', () => {
    const ok = parseAdminReviewListParams(new URL('https://x.test/api/admin/reviews?photos=0&videos='))
    assert.equal(ok.ok, true)
    if (ok.ok) {
      assert.equal(ok.query.photos, 0)
      assert.equal(ok.query.videos, null)
    }
    const bad = parseAdminReviewListParams(new URL('https://x.test/api/admin/reviews?photos=-1'))
    assert.equal(bad.ok, false)
    assert.equal(previewText('абвгдеёжзийклмнопрст', 5), 'абвгд…')
  })
})
