import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { publicProductFromEntry } from '../server/max/cmsEntries'
import { readAddedProduct } from '../src/cms/addedProducts'
import { applyLiveProducts } from '../src/cms/liveProducts'
import { PRODUCTS } from '../src/data/products'

const entry = {
  id: '0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b',
  kind: 'product' as const,
  status: 'published' as const,
  data: { name: 'Новый товар', brandId: 'silkway', category: 'care', priceRub: '1500', imageUrl: 'https://example.com/a.jpg', description: 'Текст.' },
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
  updatedByUserId: '42',
}

describe('новые товары из Mini App на сайте', () => {
  it('ответ сервера проходит проверку клиента и добавляется в конец каталога', () => {
    const wire = JSON.parse(JSON.stringify(publicProductFromEntry(entry)))
    const p = readAddedProduct(wire)
    assert.equal(p?.name, 'Новый товар')
    const live = applyLiveProducts([], [wire])
    assert.equal(live.length, PRODUCTS.length + 1)
    assert.equal(live.at(-1)?.slug, 'custom-0f1e2d3c4b5a')
  })

  it('чужие id, небезопасные картинки и неизвестные бренды отбрасываются', () => {
    const wire = JSON.parse(JSON.stringify(publicProductFromEntry(entry)))
    assert.equal(readAddedProduct({ ...wire, id: PRODUCTS[0]!.id, slug: PRODUCTS[0]!.id }), null)
    assert.equal(readAddedProduct({ ...wire, image: { src: 'javascript:alert(1)' } }), null)
    assert.equal(readAddedProduct({ ...wire, brandId: 'evil' }), null)
    assert.equal(applyLiveProducts('bad', 'bad'), PRODUCTS)
  })
})
