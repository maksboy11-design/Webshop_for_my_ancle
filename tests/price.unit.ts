import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatPrice, formatPv, formatRub, PV_TO_RUB } from '../src/data/price'
import { PRICE_LIST, priceListItem } from '../src/data/priceList'
import { PRODUCTS } from '../src/data/products'

const NBSP = '\u00A0'

describe('форматирование цен', () => {
  it('рубли: неразрывные пробелы между разрядами и перед ₽', () => {
    assert.equal(formatRub(3528), `3${NBSP}528${NBSP}₽`)
    assert.equal(formatRub(352800), `352${NBSP}800${NBSP}₽`)
    assert.equal(formatRub(252), `252${NBSP}₽`)
  })

  it('PV: тот же разделитель тысяч, суффикс PV', () => {
    assert.equal(formatPv(42), `42${NBSP}PV`)
    assert.equal(formatPv(4200), `4${NBSP}200${NBSP}PV`)
  })

  it('обычного пробела в ценах нет', () => {
    for (const text of [formatRub(352800), formatPv(4200), formatPrice({ rub: 3528, pv: 42 })]) {
      assert.ok(!/ /.test(text.replace(' / ', '')), text)
    }
  })
})

describe('прайс-лист', () => {
  it('46 позиций (по числу строк прайса), ID уникальны', () => {
    assert.equal(PRICE_LIST.length, 46)
    assert.equal(new Set(PRICE_LIST.map((item) => item.id)).size, 46)
  })

  it('рубли = PV × 84 для каждой позиции', () => {
    const bad = PRICE_LIST.filter((item) => item.pv * PV_TO_RUB !== item.rub).map((item) => item.id)
    assert.deepEqual(bad, [])
  })

  it('цены товаров берутся из прайса по priceListId', () => {
    for (const product of PRODUCTS) {
      if (product.priceListId === null) {
        assert.equal(product.price, null, product.id)
        continue
      }
      const item = priceListItem(product.priceListId)
      assert.ok(item, `${product.id}: нет ${product.priceListId} в прайсе`)
      assert.deepEqual(product.price, { rub: item.rub, pv: item.pv }, product.id)
    }
  })

  it('на один ID прайса указывает не больше одного товара', () => {
    const ids = PRODUCTS.map((product) => product.priceListId).filter((id) => id !== null)
    assert.equal(new Set(ids).size, ids.length)
  })

  it('флагман: 4 200 PV и 352 800 ₽', () => {
    const flagship = PRODUCTS.find((product) => product.id === 'flagship')
    assert.equal(flagship?.price ? formatPrice(flagship.price) : null, `352${NBSP}800${NBSP}₽ / 4${NBSP}200${NBSP}PV`)
  })
})
