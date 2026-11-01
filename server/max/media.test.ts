import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, it } from 'node:test'
import { checkMediaFile, mediaPathname, mimeOf, parseMediaPathname, safeFileName, sniffMatches, sniffMime } from '../../src/cms/mediaTypes'
import { PRODUCT_BLOB_HOST } from '../../src/cms/productMerge'
import { createLogger } from './logger'
import { handleAdminMediaRequest, type MediaBlob, type VariantEncoder } from './mediaHttp'
import { createMemoryMediaStore } from './mediaStore'
import { isKnownProductId } from './productOverrides'
import { createMemoryProductOverrideStore } from './productOverrideStore'
import { handlePublicProductsRequest } from './productsHttp'
import { signWebAppInitDataForTests } from './webAppInitData'

/** Медиатека на моках: Blob и sharp — фейки, в настоящий Blob ничего не грузится. */
const TOKEN = 'media-test-token'
const MOD = '42'
const NOW = new Date('2026-11-01T12:00:00.000Z')
const init = (id: string) =>
  signWebAppInitDataForTests({ auth_date: String(Math.floor(NOW.getTime() / 1000)), user: JSON.stringify({ id: Number(id) }) }, TOKEN)

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)])
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(100, 1)])
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(64)])
const ID1 = '11111111-1111-4111-8111-111111111111'
const ID2 = '22222222-2222-4222-8222-222222222222'
const ID3 = '33333333-3333-4333-8333-333333333333'
const blobUrl = (path: string) => `https://${PRODUCT_BLOB_HOST}/${path}`

function setup() {
  const media = createMemoryMediaStore()
  const files = new Map<string, Buffer>()
  const deleted: string[] = []
  const tokens: { pathname: string; mime: string; max: number }[] = []
  const blob: MediaBlob = {
    async clientToken(pathname, mime, max) {
      tokens.push({ pathname, mime, max })
      return `vercel_blob_client_test_${tokens.length}`
    },
    async head(url, n) {
      return new Uint8Array(files.get(url)!.subarray(0, n))
    },
    async sha256(url) {
      return createHash('sha256').update(files.get(url)!).digest('hex')
    },
    async read(url) {
      return files.get(url)!
    },
    async put(pathname, data) {
      files.set(blobUrl(pathname), data)
      return blobUrl(pathname)
    },
    async del(urls) {
      for (const u of urls) {
        deleted.push(u)
        files.delete(u)
      }
    },
  }
  let failEncode = false
  const encoder: VariantEncoder = {
    async variants() {
      if (failEncode) throw new Error('Input buffer contains unsupported image format')
      return {
        width: 3000,
        height: 2000,
        variants: [
          { name: 'thumb', data: Buffer.from('t'), width: 320, height: 213 },
          { name: 'medium', data: Buffer.from('m'), width: 960, height: 640 },
          { name: 'large', data: Buffer.from('l'), width: 1920, height: 1280 },
        ],
      }
    },
  }
  const deps = {
    botToken: TOKEN,
    moderators: new Set([MOD]),
    moderatorsConfigured: true,
    now: () => NOW,
    media,
    blob,
    encoder,
    log: createLogger(),
    isProduct: isKnownProductId,
  }
  const call = async (q: string, method = 'GET', body?: unknown, user = MOD) => {
    const r = await handleAdminMediaRequest(
      new Request(`https://x.test/api/admin/media${q}`, {
        method,
        headers: { 'x-max-init-data': init(user), ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      }),
      deps,
    )
    return { status: r.status, json: (await r.json()) as Record<string, any> } // eslint-disable-line @typescript-eslint/no-explicit-any
  }
  /** Имитация загрузки клиентом: файл «лежит» в Blob, затем complete. */
  const upload = async (id: string, name: string, mime: string, data: Buffer) => {
    const url = blobUrl(mediaPathname(id, name, mime))
    files.set(url, data)
    return call('?complete=1', 'POST', { id, url, name, size: data.length, mime })
  }
  return { media, files, deleted, tokens, call, upload, setFail: (v: boolean) => (failEncode = v) }
}

describe('медиа: типы и сигнатуры', () => {
  it('magic bytes, MIME по расширению, лимиты, безопасное имя', () => {
    assert.equal(sniffMime(JPEG), 'image/jpeg')
    assert.equal(sniffMime(PDF), 'application/pdf')
    assert.equal(sniffMime(MP4), 'video/mp4')
    assert.equal(sniffMime(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])), 'video/webm')
    assert.equal(sniffMime(Buffer.from('hello')), null)
    assert.ok(sniffMatches('video/quicktime', 'video/mp4'))
    assert.ok(!sniffMatches('image/png', 'image/jpeg'))
    assert.equal(mimeOf('IMG_1.HEIC', ''), null)
    assert.equal(mimeOf('Фото.JPG', ''), 'image/jpeg')
    assert.equal(checkMediaFile('image/jpeg', 30 * 1024 * 1024), 'file_too_large')
    assert.equal(checkMediaFile('text/html', 10), 'unsupported_type')
    assert.equal(checkMediaFile('application/pdf', 0), 'empty_file')
    assert.equal(safeFileName('Инструкция к прибору (1).PDF', 'application/pdf'), 'instruktsiya-k-priboru-1.pdf')
    assert.match(safeFileName('../../etc/passwd', 'image/png'), /^[a-z0-9-]+\.png$/)
    assert.deepEqual(parseMediaPathname(mediaPathname(ID1, 'a.jpg', 'image/jpeg')), { id: ID1, file: 'a.jpg' })
    assert.equal(parseMediaPathname(`products/library/${ID1}/../x.jpg`), null)
  })
})

describe('медиа: API', () => {
  it('только модератор; токен — с allowlist типа и лимитом', async () => {
    const { call, tokens } = setup()
    assert.equal((await call('?list=1', 'GET', undefined, '7')).status, 403)
    const payload = (o: Record<string, unknown>, pathname?: string) => ({
      type: 'blob.generate-client-token',
      payload: { pathname: pathname ?? mediaPathname(ID1, 'a.jpg', 'image/jpeg'), clientPayload: JSON.stringify(o), multipart: false },
    })
    const ok = await call('?token=1', 'POST', payload({ id: ID1, name: 'a.jpg', mime: 'image/jpeg', size: 1000 }))
    assert.equal(ok.status, 200)
    assert.equal(ok.json.type, 'blob.generate-client-token')
    assert.deepEqual(tokens[0], { pathname: mediaPathname(ID1, 'a.jpg', 'image/jpeg'), mime: 'image/jpeg', max: 1000 })
    assert.equal(
      (await call('?token=1', 'POST', payload({ id: ID1, name: 'a.exe', mime: 'application/x-msdownload', size: 10 }))).status,
      415,
    )
    assert.equal((await call('?token=1', 'POST', payload({ id: ID1, name: 'a.jpg', mime: 'image/jpeg', size: 99e6 }))).status, 413)
    assert.equal(
      (await call('?token=1', 'POST', payload({ id: ID1, name: 'a.jpg', mime: 'image/jpeg', size: 10 }, 'products/flagship/evil.jpg')))
        .status,
      400,
    )
  })

  it('complete: сигнатура, идемпотентность, дедупликация по sha256', async () => {
    const { upload, deleted, media } = setup()
    const fake = await upload(ID1, 'fake.jpg', 'image/jpeg', PDF)
    assert.equal(fake.status, 422)
    assert.equal(fake.json.error, 'signature_mismatch')
    assert.equal(deleted.length, 1, 'файл с чужой сигнатурой удалён из Blob')
    const r = await upload(ID2, 'doc.pdf', 'application/pdf', PDF)
    assert.equal(r.status, 201)
    assert.equal(r.json.media.status, 'ready')
    assert.equal(r.json.media.kind, 'document')
    assert.match(r.json.media.url, /^\/product-media\/library\//)
    const again = await upload(ID2, 'doc.pdf', 'application/pdf', PDF)
    assert.equal(again.status, 200, 'повтор с тем же ключом — та же запись')
    assert.equal(again.json.media.id, ID2)
    const dup = await upload(ID3, 'copy.pdf', 'application/pdf', PDF)
    assert.equal(dup.json.duplicate, true)
    assert.equal(dup.json.media.id, ID2)
    assert.equal(media.rows.size, 1)
  })

  it('изображение: processing → варианты WebP; ошибка обработки → failed', async () => {
    const { upload, call, setFail } = setup()
    const r = await upload(ID1, 'photo.jpg', 'image/jpeg', JPEG)
    assert.equal(r.json.media.status, 'processing')
    const p = await call(`?process=${ID1}`, 'POST', {})
    assert.equal(p.json.media.status, 'ready')
    assert.deepEqual(Object.keys(p.json.media.variants).sort(), ['large', 'medium', 'thumb'])
    assert.equal(p.json.media.width, 3000)
    assert.match(p.json.media.thumb, /\/product-media\/library\/.+\/thumb\.webp$/)
    setFail(true)
    const jpeg2 = Buffer.concat([JPEG, Buffer.from([1])])
    await upload(ID2, 'bad.jpg', 'image/jpeg', jpeg2)
    const f = await call(`?process=${ID2}`, 'POST', {})
    assert.equal(f.json.media.status, 'failed')
    assert.equal(f.json.media.error, 'image_decode_failed')
  })

  it('список: поиск, фильтр, сортировка, страницы', async () => {
    const { upload, call } = setup()
    await upload(ID1, 'photo.jpg', 'image/jpeg', JPEG)
    await upload(ID2, 'manual.pdf', 'application/pdf', PDF)
    await upload(ID3, 'clip.mp4', 'video/mp4', MP4)
    assert.equal((await call('?list=1')).json.total, 3)
    assert.equal((await call('?list=1&kind=video')).json.items[0].id, ID3)
    assert.equal((await call('?list=1&q=MANU')).json.items[0].id, ID2)
    const bySize = (await call('?list=1&sort=size&dir=desc')).json.items.map((m: { id: string }) => m.id)
    assert.equal(bySize[0], ID1)
    const page2 = (await call('?list=1&limit=2&page=2')).json
    assert.equal(page2.items.length, 1)
    assert.equal(page2.total, 3)
  })

  it('галерея товара и безопасное удаление: используется → только отвязать; физически — из корзины', async () => {
    const { upload, call, deleted } = setup()
    await upload(ID1, 'a.jpg', 'image/jpeg', JPEG)
    await call(`?process=${ID1}`, 'POST', {})
    await upload(ID2, 'b.jpg', 'image/jpeg', Buffer.concat([JPEG, Buffer.from([2])]))
    await call(`?process=${ID2}`, 'POST', {})
    await upload(ID3, 'c.pdf', 'application/pdf', PDF)
    assert.equal((await call('?product=flagship', 'PUT', { items: [{ mediaId: ID3, role: 'gallery' }] })).json.error, 'not_image')
    assert.equal(
      (
        await call('?product=flagship', 'PUT', {
          items: [
            { mediaId: ID1, role: 'main' },
            { mediaId: ID2, role: 'main' },
          ],
        })
      ).json.error,
      'one_main_only',
    )
    assert.equal((await call('?product=nope', 'GET')).status, 404)
    const saved = await call('?product=flagship', 'PUT', {
      items: [
        { mediaId: ID1, role: 'main' },
        { mediaId: ID2, role: 'gallery' },
        { mediaId: ID1, role: 'gallery' },
      ],
    })
    assert.equal(saved.status, 200)
    assert.deepEqual(
      saved.json.items.map((i: { role: string }) => i.role),
      ['main', 'gallery', 'gallery'],
    )
    const info = await call(`?id=${ID1}`)
    assert.equal(info.json.usage.length, 2)
    // Используется — обычное удаление запрещено, физическое тоже.
    assert.equal((await call(`?id=${ID1}`, 'DELETE')).status, 409)
    assert.equal((await call(`?id=${ID1}&purge=1`, 'DELETE')).json.error, 'not_trashed')
    // Отвязать и в корзину.
    assert.equal((await call(`?id=${ID1}&unlink=1`, 'DELETE')).status, 200)
    assert.equal((await call('?list=1&trash=1')).json.total, 1)
    assert.equal((await call(`?restore=${ID1}`, 'POST', {})).status, 200)
    assert.equal((await call(`?id=${ID1}`, 'DELETE')).status, 200)
    assert.equal((await call(`?id=${ID1}&purge=1`, 'DELETE')).status, 200)
    assert.ok(
      deleted.some((u) => u.endsWith('/thumb.webp')),
      'варианты удалены из Blob',
    )
    assert.equal((await call(`?id=${ID1}`)).status, 404)
  })

  it('сайт: srcset из медиатеки, без связей — прежние поля', async () => {
    const { upload, call, media } = setup()
    const overrides = createMemoryProductOverrideStore()
    const pub = async () =>
      (
        (await (
          await handlePublicProductsRequest(new Request('https://x.test/api/products'), { overrides, media, log: createLogger() })
        ).json()) as {
          products: { id: string; image: { src: string; srcSet?: string; thumb?: string }; gallery: unknown[] }[]
        }
      ).products.find((p) => p.id === 'flagship')!
    const before = await pub()
    assert.equal(before.image.srcSet, undefined)
    await upload(ID1, 'a.jpg', 'image/jpeg', JPEG)
    await call('?product=flagship', 'PUT', { items: [{ mediaId: ID1, role: 'main' }] })
    assert.deepEqual((await pub()).image, before.image, 'пока изображение обрабатывается — сайт показывает прежнее')
    await call(`?process=${ID1}`, 'POST', {})
    const after = await pub()
    assert.match(after.image.src, /^\/product-media\/library\/.+\/large\.webp$/)
    assert.match(after.image.srcSet!, /thumb\.webp 320w, .+medium\.webp 960w, .+large\.webp 1920w$/)
    assert.deepEqual(after.gallery, before.gallery, 'галерея без связей — прежняя')
  })

  it('документы товара: подпись, порядок, отдельно от фото; на сайте — список', async () => {
    const { upload, call, media } = setup()
    const D2 = '44444444-4444-4444-8444-444444444444'
    await upload(ID1, 'a.jpg', 'image/jpeg', JPEG)
    await call(`?process=${ID1}`, 'POST', {})
    await upload(ID2, 'manual.pdf', 'application/pdf', PDF)
    await upload(D2, 'cert.pdf', 'application/pdf', Buffer.concat([PDF, Buffer.from('x')]))
    await call('?product=flagship', 'PUT', { items: [{ mediaId: ID1, role: 'main' }] })
    assert.equal((await call('?product=flagship&documents=1', 'PUT', { items: [{ mediaId: ID1 }] })).json.error, 'not_document')
    const r = await call('?product=flagship&documents=1', 'PUT', { items: [{ mediaId: D2 }, { mediaId: ID2 }] })
    assert.equal(r.status, 200)
    assert.deepEqual(
      r.json.items.map((i: { role: string }) => i.role),
      ['main', 'document', 'document'],
      'фото не затронуты',
    )
    assert.equal(
      (await call(`?id=${ID2}`, 'PATCH', { title: '  Инструкция   по применению ' })).json.media.title,
      'Инструкция по применению',
    )
    // Сохранение фото не трогает документы.
    await call('?product=flagship', 'PUT', {
      items: [
        { mediaId: ID1, role: 'main' },
        { mediaId: ID1, role: 'gallery' },
      ],
    })
    const pub = (await (
      await handlePublicProductsRequest(new Request('https://x.test/api/products'), {
        overrides: createMemoryProductOverrideStore(),
        media,
        log: createLogger(),
      })
    ).json()) as {
      products: { id: string; documents?: { title: string; url: string }[] }[]
    }
    const docs = pub.products.find((p) => p.id === 'flagship')!.documents!
    assert.deepEqual(
      docs.map((d) => d.title),
      ['cert.pdf', 'Инструкция по применению'],
    )
    assert.match(docs[0]!.url, /^\/product-media\/library\//)
    assert.equal(pub.products.find((p) => p.id !== 'flagship')!.documents, undefined)
  })
})
