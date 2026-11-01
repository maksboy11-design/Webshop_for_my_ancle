import { expect, test, type Page } from '@playwright/test'

/** Медиатека, галерея и документы товара на моках API: настоящий Blob и production не трогаются. */
const BRIDGE_URL = 'https://st.max.ru/js/max-web-app.js'
const PIXEL = Buffer.from('UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=', 'base64')
const bridge = `window.WebApp = { initData: 'signed', initDataUnsafe: {}, platform: 'test', version: '1',
  ready() {}, expand() {}, enableClosingConfirmation() {}, disableClosingConfirmation() {},
  BackButton: { isVisible: false, onClick() {}, offClick() {}, show() {}, hide() {} } };`
const img = { src: '/products/device.png', width: 601, height: 873 }
const flagship = { id: 'flagship', name: 'Флагманский прибор SILKWAY', pack: null, price: { rub: 84000, pv: 1000 }, image: img, gallery: [], description: null }
const listItem = { id: 'flagship', slug: 'flagship-device', brand: 'SILKWAY', category: 'devices', name: flagship.name, pack: null, price: flagship.price, image: img, overridden: [], updatedAt: null }

const media = (id: string, name: string, kind: 'image' | 'document', over: Record<string, unknown> = {}) => ({
  id, kind, mime: kind === 'image' ? 'image/webp' : 'application/pdf', size: 2048, name,
  url: `/mock-media/${name}`, thumb: (kind === 'image' ? `/mock-media/${name}` : null) as string | null, title: null as string | null, variants: {}, width: 10, height: 10,
  status: 'ready', error: null, sha256: id.repeat(2), createdAt: '2026-10-01T00:00:00Z', deletedAt: null, ...over,
})
const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const D = '00000000-0000-4000-8000-00000000000d'

async function setup(page: Page) {
  const calls: { method: string; url: string; body: unknown }[] = []
  const lib: Record<string, ReturnType<typeof media>> = { [A]: media(A, 'a.webp', 'image'), [B]: media(B, 'b.webp', 'image'), [D]: media(D, 'manual.pdf', 'document') }
  let links: { role: string; position: number; media: ReturnType<typeof media> }[] = [
    { role: 'main', position: 0, media: lib[A]! },
    { role: 'gallery', position: 0, media: lib[A]! },
    { role: 'gallery', position: 1, media: lib[B]! },
    { role: 'document', position: 0, media: lib[D]! },
  ]
  await page.route(BRIDGE_URL, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: bridge }))
  await page.route('**/api/admin/reviews**', (r) => r.fulfill({ json: { total: 0, reviews: [] } }))
  await page.route('**/products/device.png', (r) => r.fulfill({ status: 200, contentType: 'image/webp', body: PIXEL }))
  await page.route('**/mock-media/**', (r) => r.fulfill({ status: 200, contentType: 'image/webp', body: PIXEL }))
  await page.route('https://vercel.com/api/blob/**', (r) => r.abort())
  await page.route('**/api/admin/products**', (r) => {
    const url = new URL(r.request().url())
    if (!url.searchParams.get('id')) return r.fulfill({ json: { editable: true, total: 1, products: [listItem] } })
    return r.fulfill({ json: { editable: true, product: { ...listItem, merged: flagship, base: flagship } } })
  })
  await page.route('**/api/admin/media**', (r) => {
    const req = r.request()
    const url = new URL(req.url())
    const body = ['POST', 'PUT', 'PATCH'].includes(req.method()) ? req.postDataJSON() : null
    calls.push({ method: req.method(), url: req.url(), body })
    const q = url.searchParams
    const pid = q.get('product')
    if (pid && req.method() === 'PUT') {
      const items = (body as { items: { mediaId: string; role?: string }[] }).items
      const scope = q.get('documents') === '1' ? ['document'] : ['main', 'gallery']
      links = links.filter((l) => !scope.includes(l.role))
      items.forEach((it, i) => links.push({ role: it.role ?? 'document', position: i, media: lib[it.mediaId]! }))
      return r.fulfill({ json: { items: links } })
    }
    if (pid) return r.fulfill({ json: { items: links } })
    if (q.get('check') === '1') return r.fulfill({ json: { media: lib[B] } })
    if (req.method() === 'PATCH') {
      const id = q.get('id')!
      lib[id] = { ...lib[id]!, title: (body as { title: string }).title }
      return r.fulfill({ json: { media: lib[id] } })
    }
    if (q.get('id')) return r.fulfill({ json: { media: lib[q.get('id')!], usage: [{ productId: 'flagship', role: 'gallery', blockId: '', position: 0 }] } })
    const term = (q.get('q') ?? '').toLowerCase()
    const items = Object.values(lib).filter((m) => (!q.get('kind') || m.kind === q.get('kind')) && m.name.includes(term))
    return r.fulfill({ json: { total: items.length, page: 1, limit: 24, items, limits: { image: 26214400, video: 524288000, document: 52428800 } } })
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/admin-reviews.html')
  await expect(page.getByRole('navigation', { name: 'Разделы' })).toBeVisible({ timeout: 15_000 })
  return { calls }
}

test.describe('Медиатека и галерея товара', () => {
  test('медиатека: список, поиск, сведения и места использования', async ({ page }) => {
    const { calls } = await setup(page)
    await page.getByRole('navigation', { name: 'Разделы' }).getByRole('button', { name: 'Медиатека' }).click()
    await expect(page.getByTestId('media-tile')).toHaveCount(3)
    await page.getByTestId('media-tile').first().click()
    await expect(page.getByTestId('media-usage')).toContainText('Флагманский прибор SILKWAY — галерея')
    await page.getByLabel('Поиск по имени файла').fill('manual')
    await expect(page.getByTestId('media-tile')).toHaveCount(1)
    expect(calls.some((c) => c.url.includes('q=manual'))).toBe(true)
  })

  test('очередь: повторный файл находится по sha256 без загрузки в Blob', async ({ page }) => {
    await setup(page)
    await page.getByRole('navigation', { name: 'Разделы' }).getByRole('button', { name: 'Медиатека' }).click()
    await page.getByLabel(/выбрать файлы/).first().setInputFiles({ name: 'same.webp', mimeType: 'image/webp', buffer: PIXEL })
    const queue = page.getByTestId('upload-queue')
    await expect(queue).toContainText('same.webp')
    await expect(queue).toContainText('Уже есть в медиатеке')
  })

  test('галерея: главное фото, порядок; документы: подпись, порядок, удаление', async ({ page }) => {
    const { calls } = await setup(page)
    await page.getByRole('navigation', { name: 'Разделы' }).getByRole('button', { name: 'Товары' }).click()
    await page.getByText('Флагманский прибор SILKWAY').first().click()
    const gallery = page.getByTestId('product-gallery')
    await expect(gallery.getByTestId('gallery-item')).toHaveCount(2)
    await expect(gallery.getByTestId('gallery-item').first()).toContainText('Главное')
    await gallery.getByRole('button', { name: 'Сделать фото 2 главным' }).click()
    await expect(gallery.getByTestId('gallery-item').first()).toContainText('b.webp')
    await expect
      .poll(() => calls.filter((c) => c.method === 'PUT' && !c.url.includes('documents')).at(-1)?.body)
      .toEqual({ items: [{ mediaId: B, role: 'main' }, { mediaId: B, role: 'gallery' }, { mediaId: A, role: 'gallery' }] })
    await gallery.getByRole('button', { name: 'Открыть фото 1' }).click()
    await expect(page.getByTestId('lightbox')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('lightbox')).toHaveCount(0)

    const docs = page.getByTestId('product-documents')
    const title = docs.getByLabel('Подпись документа manual.pdf')
    await title.fill('Инструкция')
    await title.press('Enter')
    await expect.poll(() => calls.find((c) => c.method === 'PATCH')?.body).toEqual({ title: 'Инструкция' })
    await docs.getByRole('button', { name: 'Убрать документ 1' }).click()
    await expect(docs.getByTestId('product-doc')).toHaveCount(0)
    await expect.poll(() => calls.filter((c) => c.url.includes('documents=1')).at(-1)?.body).toEqual({ items: [] })
  })
})

test('сайт: srcset из медиатеки и список документов на странице товара', async ({ page }) => {
  const photo = { src: '/mock-media/l.webp', width: 1600, height: 1200, srcSet: '/mock-media/m.webp 800w, /mock-media/l.webp 1600w', thumb: '/mock-media/t.webp' }
  await page.route('**/mock-media/**', (r) => r.fulfill({ status: 200, contentType: 'image/webp', body: PIXEL }))
  await page.route('**/api/products**', (r) =>
    r.fulfill({
      json: {
        products: [{ ...flagship, image: photo, gallery: [photo], documents: [{ title: 'Инструкция по применению', url: '/mock-media/manual.pdf', size: 1572864, mime: 'application/pdf' }] }],
      },
    }),
  )
  await page.goto('/#product/flagship-device')
  const link = page.getByRole('link', { name: 'Инструкция по применению' })
  await expect(link).toBeVisible({ timeout: 15_000 })
  await expect(link).toHaveAttribute('href', '/mock-media/manual.pdf')
  await expect(page.getByText('PDF, 1,5 МБ')).toBeVisible()
  await expect(page.locator('img[srcset*="800w"]').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Фото 1' }).locator('img')).toHaveAttribute('src', '/mock-media/t.webp')
})
