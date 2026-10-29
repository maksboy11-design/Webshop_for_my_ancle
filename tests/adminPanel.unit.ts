import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { PRODUCTS } from '../src/data/products'
import { toPublicProductData } from '../src/cms/productMerge'
import { applyLiveProducts, loadLiveProducts, resetLiveProductsForTests } from '../src/cms/liveProducts'
import { buildSet, initialState, isDirty, move, parsePv, parseRub, rubFromPv } from '../src/admin-reviews/productFormModel'
import { formatStart, looksLikeYoutube } from '../src/admin-reviews/webinarFormModel'

const base = PRODUCTS.find((p) => p.price && p.pack && p.description)!
const original = toPublicProductData(base)

describe('productFormModel', () => {
  it('цены: 1 PV = 84 ₽, разбор PV и рублей', () => {
    assert.equal(rubFromPv(1), 84)
    assert.equal(rubFromPv(42.5), 3570)
    assert.equal(parsePv('12,5'), 12.5)
    assert.equal(parsePv('1.234'), null)
    assert.equal(parseRub('3 528'), 3528)
    assert.equal(parseRub('1.5'), null)
  })
  it('без изменений — пустой set и форма не грязная', () => {
    const s = initialState(original)
    const r = buildSet(s, original)
    assert.deepEqual(r, { ok: true, set: {} })
    assert.equal(isDirty(s, original), false)
  })
  it('отправляет только изменённые поля, null явно', () => {
    const s = { ...initialState(original), name: original.name + ' X', packNone: true }
    const r = buildSet(s, original)
    assert.equal(r.ok, true)
    if (r.ok) assert.deepEqual(r.set, { name: original.name + ' X', pack: null })
  })
  it('ошибки валидации', () => {
    assert.equal(buildSet({ ...initialState(original), name: '  ' }, original).ok, false)
    assert.equal(buildSet({ ...initialState(original), pv: 'abc' }, original).ok, false)
  })
  it('move', () => {
    assert.deepEqual(move([1, 2, 3], 0, 1), [2, 1, 3])
    assert.deepEqual(move([1, 2, 3], 0, -1), [1, 2, 3])
  })
})

describe('webinarFormModel', () => {
  it('formatStart и looksLikeYoutube', () => {
    assert.equal(formatStart(null), '')
    assert.equal(formatStart(3723), '1:02:03')
    assert.equal(looksLikeYoutube('https://youtu.be/dQw4w9WgXcQ'), true)
    assert.equal(looksLikeYoutube('https://evil.example/x'), false)
  })
})

describe('liveProducts', () => {
  it('применяет переопределения и игнорирует мусор', () => {
    const live = applyLiveProducts([{ ...original, name: 'Живое имя', price: null }, { id: 'nope' }, 5])
    const p = live.find((x) => x.id === base.id)!
    assert.equal(p.name, 'Живое имя')
    assert.equal(p.price, null)
    assert.equal(p.slug, base.slug)
    assert.equal(live.length, PRODUCTS.length)
    assert.equal(applyLiveProducts('bad'), PRODUCTS)
  })
  it('ошибка сети — статический каталог и диагностика', async () => {
    resetLiveProductsForTests()
    const warn = console.warn
    const msgs: unknown[] = []
    console.warn = (...a: unknown[]) => msgs.push(a[0])
    try {
      await loadLiveProducts((async () => {
        throw new Error('offline')
      }) as unknown as typeof fetch)
    } finally {
      console.warn = warn
    }
    assert.match(String(msgs[0]), /статический каталог/)
    resetLiveProductsForTests()
  })
})
