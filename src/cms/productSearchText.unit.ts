import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildProductSearchText } from './productSearchText'
import { emptyContent } from './blocks'
import { applyCardPatch } from './productCard'

describe('buildProductSearchText', () => {
  it('включает id, имя, бренд, теги', () => {
    const c = {
      ...emptyContent(),
      meta: applyCardPatch({}, { name: 'Астаксантин', brandId: 'chan', category: 'supplements', tags: ['антиоксидант'] }),
    }
    const t = buildProductSearchText('astaxanthin', c)
    assert.match(t, /astaxanthin/)
    assert.match(t, /Астаксантин/)
    assert.match(t, /антиоксидант/)
    assert.match(t, /chan/i)
  })
})
