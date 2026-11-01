import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  applyCardPatch,
  cardToOverridePatch,
  duplicateProductId,
  isBulkOp,
  readCardFields,
  readDuplicateParts,
  BULK_MAX_IDS,
} from '../src/cms/productCard'

describe('productCard', () => {
  it('readCardFields мягко игнорирует мусор', () => {
    const c = readCardFields({
      name: '  A  ',
      tags: ['x', '', 'x', 1],
      category: 'nope',
      brandId: 'chan',
      price: { rub: 10.4, pv: 1.239 },
    } as never)
    assert.equal(c.name, 'A')
    assert.deepEqual(c.tags, ['x'])
    assert.equal(c.category, undefined)
    assert.equal(c.brandId, 'chan')
    assert.deepEqual(c.price, { rub: 10, pv: 1.24 })
  })
  it('applyCardPatch + cardToOverridePatch', () => {
    const meta = applyCardPatch({}, { name: 'N', category: 'bath', tags: ['a'] })
    const patch = cardToOverridePatch(readCardFields(meta))
    assert.equal(patch.name, 'N')
    assert.equal(patch.category, 'bath')
  })
  it('duplicateProductId стабилен по формату', () => {
    const id = duplicateProductId('flagship', () => 0)
    assert.match(id, /^copy-flagship-0000$/)
    assert.ok(id.length <= 60)
  })
  it('bulk helpers', () => {
    assert.equal(BULK_MAX_IDS, 50)
    assert.equal(isBulkOp('trash'), true)
    assert.equal(isBulkOp('nope'), false)
    assert.deepEqual(readDuplicateParts({ media: false }), { card: true, content: true, media: false, documents: true })
  })
})
