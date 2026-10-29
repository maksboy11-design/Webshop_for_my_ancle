import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { PRODUCTS } from '../../src/data/products'
import { PV_TO_RUB } from '../../src/data/price'
import { mergeProduct, PRODUCT_BLOB_HOST } from '../../src/cms/productMerge'
import { authorizeAdmin } from './adminAuth'
import { createLogger } from './logger'
import { applyProductPatch, normalizeProductImageSrc, sanitizeStoredOverride } from './productOverrides'
import { createMemoryProductOverrideStore } from './productOverrideStore'
import { processProductImage, sniffImage, UPLOAD_MAX_BYTES, type ImageEncoder } from './productImages'
import { handleAdminProductsRequest, handlePublicProductsRequest } from './productsHttp'
import { signWebAppInitDataForTests } from './webAppInitData'

const TOKEN = 'admin-products-test-token'
const MOD = '42'
const NOW = new Date('2024-06-01T12:00:00.000Z')
const BLOB = `https://${PRODUCT_BLOB_HOST}`

function initData(userId: string, authDate = Math.floor(NOW.getTime() / 1000)) {
  return signWebAppInitDataForTests({ auth_date: String(authDate), user: JSON.stringify({ id: Number(userId) }) }, TOKEN)
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const fakeEncoder: ImageEncoder = {
  async encode(_input, box) {
    return { data: Buffer.from('webp'), width: box, height: Math.round(box / 2) }
  },
}

function deps(over: Partial<Parameters<typeof handleAdminProductsRequest>[1]> = {}) {
  const puts: string[] = []
  return {
    puts,
    d: {
      botToken: TOKEN,
      moderators: new Set([MOD]),
      moderatorsConfigured: true,
      now: () => NOW,
      overrides: createMemoryProductOverrideStore(),
      log: createLogger(),
      encoder: fakeEncoder,
      putBlob: async (path: string) => {
        puts.push(path)
        return `${BLOB}/${path}`
      },
      ...over,
    },
  }
}

const auth = { 'x-max-init-data': initData(MOD) }
const url = (q = '') => `https://x.test/api/admin/products${q}`

describe('каталог: инварианты', () => {
  it('id товаров подходят под CHECK миграции 005', () => {
    for (const p of PRODUCTS) assert.match(p.id, /^[a-z0-9-]{1,60}$/)
  })
  it('курс 1 PV = 84 ₽ не изменён', () => assert.equal(PV_TO_RUB, 84))
})

describe('mergeProduct: null ≠ отсутствие поля', () => {
  const base = PRODUCTS.find((p) => p.pack && p.price)!
  it('отсутствующее поле — из каталога', () => {
    const m = mergeProduct(base, { name: 'Новое' })
    assert.equal(m.name, 'Новое')
    assert.equal(m.pack, base.pack)
    assert.deepEqual(m.price, base.price)
  })
  it('явный null перекрывает значение', () => {
    const m = mergeProduct(base, { pack: null, price: null })
    assert.equal(m.pack, null)
    assert.equal(m.price, null)
  })
})

describe('applyProductPatch', () => {
  it('валидирует цену и не трогает текст', () => {
    const ok = applyProductPatch({}, { set: { name: '  Имя с пробелами ', price: { rub: 3528, pv: 42 } } })
    assert.equal(ok.ok, true)
    assert.equal(ok.override?.name, '  Имя с пробелами ')
    assert.equal(applyProductPatch({}, { set: { price: { rub: 1.5, pv: 1 } } }).ok, false)
    assert.equal(applyProductPatch({}, { set: { price: { rub: 1, pv: 1.234 } } }).ok, false)
    assert.equal(applyProductPatch({}, { set: { price: { rub: -1, pv: 1 } } }).ok, false)
  })
  it('пустое имя, управляющие символы и неизвестные поля отклоняются', () => {
    assert.equal(applyProductPatch({}, { set: { name: '' } }).ok, false)
    assert.equal(applyProductPatch({}, { set: { name: 'a\u0000b' } }).ok, false)
    assert.equal(applyProductPatch({}, { set: { slug: 'x' } }).ok, false)
  })
  it('reset убирает поле, null сохраняется явно', () => {
    const r = applyProductPatch({ name: 'X', pack: 'Y' }, { set: { pack: null }, reset: ['name'] })
    assert.equal(r.ok, true)
    assert.equal('name' in r.override!, false)
    assert.equal(r.override!.pack, null)
  })
  it('описание: секции проверяются, текст сохраняется дословно', () => {
    const description = [{ heading: 'ЗАГОЛОВОК ', paragraphs: ['абзац\nвторая строка', { label: 'Состав:', text: ' вода' }], list: ['a'] }]
    const r = applyProductPatch({}, { set: { description } })
    assert.equal(r.ok, true)
    assert.deepEqual(r.override!.description, description)
    assert.equal(applyProductPatch({}, { set: { description: [{}] } }).ok, false)
    assert.equal(applyProductPatch({}, { set: { description: [{ level: 'huge', heading: 'x' }] } }).ok, false)
  })
  it('изображения: только свои пути, без base64 и внешних URL', () => {
    assert.equal(normalizeProductImageSrc('data:image/png;base64,AAAA'), null)
    assert.equal(normalizeProductImageSrc('https://evil.example/products/a.webp'), null)
    assert.equal(normalizeProductImageSrc(`http://${PRODUCT_BLOB_HOST}/products/flagship/abc.webp`), null)
    assert.equal(normalizeProductImageSrc('/product-media/flagship/0123abcd.webp'), `${BLOB}/products/flagship/0123abcd.webp`)
    assert.equal(normalizeProductImageSrc('/product-media/../x.webp'), null)
    const tooMany = Array.from({ length: 13 }, () => ({ src: PRODUCTS[0]!.image.src, width: 10, height: 10 }))
    assert.equal(applyProductPatch({}, { set: { gallery: tooMany } }).ok, false)
  })
  it('мусор из БД отбрасывается при чтении', () => {
    const s = sanitizeStoredOverride({ name: 5, pack: null, price: { rub: 'x' }, evil: 1 })
    assert.deepEqual(s, { pack: null })
  })
})

describe('productImages', () => {
  it('sniffImage по сигнатуре', () => {
    assert.equal(sniffImage(PNG), 'png')
    assert.equal(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'jpeg')
    assert.equal(sniffImage(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')), 'webp')
    assert.equal(sniffImage(Buffer.from('<svg></svg>')), null)
  })
  it('лимиты и ошибки декодирования', async () => {
    const put = async (p: string) => `${BLOB}/${p}`
    assert.equal((await processProductImage('flagship', Buffer.alloc(0), fakeEncoder, put)).ok, false)
    const big = await processProductImage('flagship', Buffer.concat([PNG, Buffer.alloc(UPLOAD_MAX_BYTES)]), fakeEncoder, put)
    assert.deepEqual(big, { ok: false, status: 413, error: 'file_too_large' })
    const svg = await processProductImage('flagship', Buffer.from('<svg/>'), fakeEncoder, put)
    assert.deepEqual(svg, { ok: false, status: 415, error: 'unsupported_image_type' })
    const pixels: ImageEncoder = { encode: async () => Promise.reject(new Error('Input image exceeds pixel limit')) }
    assert.equal((await processProductImage('flagship', PNG, pixels, put)).ok, false)
    const ok = await processProductImage('flagship', PNG, fakeEncoder, put)
    assert.equal(ok.ok, true)
    if (ok.ok) {
      assert.match(ok.image.src, /\/products\/flagship\/[0-9a-f]{32}\.webp$/)
      assert.match(ok.image.thumb!, /\.thumb\.webp$/)
    }
  })
})

describe('adminAuth', () => {
  const base = { botToken: TOKEN, moderators: new Set([MOD]), moderatorsConfigured: true, now: () => NOW }
  it('401 без initData, 403 не модератору, 401 просроченному', () => {
    assert.equal(authorizeAdmin(new Request('https://x.test/'), base).ok, false)
    const r403 = authorizeAdmin(new Request('https://x.test/', { headers: { 'x-max-init-data': initData('7') } }), base)
    assert.deepEqual(r403.ok ? null : r403.status, 403)
    const old = authorizeAdmin(new Request('https://x.test/', { headers: { 'x-max-init-data': initData(MOD, 1) } }), base)
    assert.deepEqual(old.ok ? null : old.status, 401)
    const ok = authorizeAdmin(new Request('https://x.test/', { headers: auth }), base)
    assert.equal(ok.ok, true)
  })
  it('userId из тела запроса не используется', async () => {
    const { d } = deps()
    const r = await handleAdminProductsRequest(
      new Request(url('?id=flagship'), { method: 'PATCH', body: JSON.stringify({ userId: MOD, set: { name: 'x' } }) }),
      d,
    )
    assert.equal(r.status, 401)
  })
})

describe('admin products API', () => {
  it('список, деталь, PATCH и публичный /api/products', async () => {
    const { d } = deps()
    const list = await handleAdminProductsRequest(new Request(url(), { headers: auth }), d)
    assert.equal(list.status, 200)
    const lb = (await list.json()) as { editable: boolean; total: number }
    assert.equal(lb.editable, true)
    assert.equal(lb.total, PRODUCTS.length)

    const patch = await handleAdminProductsRequest(
      new Request(url('?id=flagship'), {
        method: 'PATCH',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ set: { name: 'Флагман 2', price: { rub: 84, pv: 1 } } }),
      }),
      d,
    )
    assert.equal(patch.status, 200)
    const pb = (await patch.json()) as { product: { name: string; overridden: string[] } }
    assert.equal(pb.product.name, 'Флагман 2')
    assert.deepEqual(pb.product.overridden.sort(), ['name', 'price'])

    const pub = await handlePublicProductsRequest(new Request('https://x.test/api/products?changed=1'), { overrides: d.overrides, log: d.log })
    assert.equal(pub.status, 200)
    assert.match(pub.headers.get('cache-control') ?? '', /s-maxage=30.*stale-while-revalidate/)
    const body = (await pub.json()) as { source: string; products: Record<string, unknown>[] }
    assert.equal(body.source, 'db')
    assert.equal(body.products.length, 1)
    assert.deepEqual(Object.keys(body.products[0]!).sort(), ['description', 'gallery', 'id', 'image', 'name', 'pack', 'price'])
  })

  it('400 с полем при ошибке валидации, 404 на неизвестный id', async () => {
    const { d } = deps()
    const bad = await handleAdminProductsRequest(
      new Request(url('?id=flagship'), { method: 'PATCH', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ set: { price: { rub: 1, pv: 'x' } } }) }),
      d,
    )
    assert.equal(bad.status, 400)
    assert.equal(((await bad.json()) as { field: string }).field, 'price')
    const missing = await handleAdminProductsRequest(new Request(url('?id=nope'), { headers: auth }), d)
    assert.equal(missing.status, 404)
  })

  it('нет таблицы: публичный — статика, админ — editable=false и 503 на запись', async () => {
    const { d } = deps({ overrides: createMemoryProductOverrideStore({ missingTable: true }) })
    const pub = await handlePublicProductsRequest(new Request('https://x.test/api/products'), { overrides: d.overrides, log: d.log })
    assert.equal(pub.status, 200)
    const pb = (await pub.json()) as { source: string; products: unknown[] }
    assert.equal(pb.source, 'static')
    assert.equal(pb.products.length, PRODUCTS.length)
    const list = await handleAdminProductsRequest(new Request(url(), { headers: auth }), d)
    assert.equal(((await list.json()) as { editable: boolean }).editable, false)
    const w = await handleAdminProductsRequest(new Request(url('?id=flagship'), { method: 'PATCH', headers: { ...auth, 'content-type': 'application/json' }, body: '{"set":{"name":"x"}}' }), d)
    assert.equal(w.status, 503)
  })

  it('загрузка: тип, сигнатура, путь в Blob, ответ same-origin', async () => {
    const { d, puts } = deps()
    const wrongType = await handleAdminProductsRequest(
      new Request(url('?id=flagship&upload=1'), { method: 'POST', headers: { ...auth, 'content-type': 'image/svg+xml' }, body: '<svg/>' }),
      d,
    )
    assert.equal(wrongType.status, 415)
    const fake = await handleAdminProductsRequest(
      new Request(url('?id=flagship&upload=1'), { method: 'POST', headers: { ...auth, 'content-type': 'image/png' }, body: 'not a png' }),
      d,
    )
    assert.equal(fake.status, 415)
    const ok = await handleAdminProductsRequest(
      new Request(url('?id=flagship&upload=1'), { method: 'POST', headers: { ...auth, 'content-type': 'image/png' }, body: PNG }),
      d,
    )
    assert.equal(ok.status, 201)
    const img = ((await ok.json()) as { image: { src: string; thumb: string } }).image
    assert.match(img.src, /^\/product-media\/flagship\/[0-9a-f]{32}\.webp$/)
    assert.equal(puts.length, 2)
    const noStorage = deps({ putBlob: null })
    const r = await handleAdminProductsRequest(
      new Request(url('?id=flagship&upload=1'), { method: 'POST', headers: { ...auth, 'content-type': 'image/png' }, body: PNG }),
      noStorage.d,
    )
    assert.equal(r.status, 503)
  })
})
