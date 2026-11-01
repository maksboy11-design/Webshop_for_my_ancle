import { expect, test } from '@playwright/test'

/** Этап 4: доп. блоки и «Видео о товаре» — на моках API, production не трогается. */
const BRIDGE_URL = 'https://st.max.ru/js/max-web-app.js'
const PIXEL = Buffer.from('UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=', 'base64')
const bridge = `window.WebApp = { initData: 'signed', initDataUnsafe: {}, platform: 'test', version: '1',
  ready() {}, expand() {}, enableClosingConfirmation() {}, disableClosingConfirmation() {},
  BackButton: { isVisible: false, onClick() {}, offClick() {}, show() {}, hide() {} } };`
const img = { src: '/products/device.png', width: 601, height: 873 }
const flagship = {
  id: 'flagship',
  name: 'Флагманский прибор SILKWAY',
  pack: null,
  price: { rub: 84000, pv: 1000 },
  image: img,
  gallery: [],
  description: null,
}
const listItem = {
  id: 'flagship',
  slug: 'flagship-device',
  brand: 'SILKWAY',
  category: 'devices',
  name: flagship.name,
  pack: null,
  price: flagship.price,
  image: img,
  overridden: [],
  updatedAt: null,
}
const YT = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'

test('админка: блок и видео-ссылка уходят в PUT ?extras=1 с ревизией', async ({ page }) => {
  const puts: { url: string; body: Record<string, unknown> }[] = []
  let view: Record<string, unknown> = {
    productId: 'flagship',
    draftDoc: null,
    hasDraft: false,
    publishedDoc: null,
    hasPublished: false,
    status: null,
    draftRev: 0,
    publishedRev: null,
    updatedAt: null,
    publishedAt: null,
    draftExtras: { blocks: [], showVideos: false, videos: [] },
  }
  await page.route(BRIDGE_URL, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: bridge }))
  await page.route('**/api/admin/reviews**', (r) => r.fulfill({ json: { total: 0, reviews: [] } }))
  await page.route('**/api/admin/webinars**', (r) => r.fulfill({ json: { total: 0, webinars: [] } }))
  await page.route('**/api/admin/media**', (r) => r.fulfill({ json: { total: 0, items: [] } }))
  await page.route('**/products/device.png', (r) => r.fulfill({ status: 200, contentType: 'image/webp', body: PIXEL }))
  await page.route('https://*.ytimg.com/**', (r) => r.fulfill({ status: 200, contentType: 'image/webp', body: PIXEL }))
  await page.route('**/api/admin/products**', (r) => {
    const req = r.request()
    const url = new URL(req.url())
    if (!url.searchParams.get('id')) return r.fulfill({ json: { editable: true, total: 1, products: [listItem] } })
    if (url.searchParams.get('content') === '1') {
      if (req.method() === 'PUT') {
        const body = req.postDataJSON() as Record<string, unknown>
        puts.push({ url: url.search, body })
        view = {
          ...view,
          hasDraft: true,
          draftRev: (view.draftRev as number) + 1,
          draftExtras: { blocks: body.blocks, showVideos: body.showVideos, videos: body.videos },
        }
      }
      return r.fulfill({ json: { content: view } })
    }
    return r.fulfill({ json: { editable: true, product: { ...listItem, merged: flagship, base: flagship } } })
  })
  await page.goto('/admin-reviews.html')
  await page.getByRole('navigation', { name: 'Разделы' }).getByRole('button', { name: 'Товары' }).click({ timeout: 15_000 })
  await page.getByText('Флагманский прибор SILKWAY').first().click()
  await page.getByTestId('videos-toggle').check()
  await page.getByLabel('Ссылка на видео', { exact: true }).fill('https://evil.example/watch?v=1')
  await page.getByRole('button', { name: 'Добавить ссылку' }).click()
  await expect(page.getByTestId('video-item')).toHaveCount(0)
  await page.getByLabel('Ссылка на видео', { exact: true }).fill('https://youtu.be/dQw4w9WgXcQ')
  await page.getByRole('button', { name: 'Добавить ссылку' }).click()
  await expect(page.getByTestId('video-item')).toHaveCount(1)
  await page.getByLabel('Название видео 1').fill('Обзор')
  await page.getByLabel('Тип нового блока').selectOption('info')
  await page.getByTestId('add-block').click()
  await page.getByTestId('add-block').click()
  await page.getByRole('button', { name: 'Дублировать блок 1' }).click()
  await expect(page.getByTestId('extra-block')).toHaveCount(3)
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: 'Удалить блок 3' }).click()
  await expect(page.getByTestId('extra-block')).toHaveCount(2)
  await page.getByTestId('extras-save').click()
  await expect.poll(() => puts.length).toBe(1)
  const { url, body } = puts[0]!
  expect(url).toContain('extras=1')
  expect(body.rev).toBe(0)
  expect(body.showVideos).toBe(true)
  expect((body.blocks as { type: string }[]).map((b) => b.type)).toEqual(['info', 'info'])
  expect(body.videos).toEqual([expect.objectContaining({ title: 'Обзор' })])
})

const video = {
  key: 'v1',
  provider: 'youtube',
  src: YT,
  title: 'Обзор прибора',
  description: 'Коротко',
  poster: { src: '/mock-media/p.webp' },
}
for (const on of [true, false]) {
  test(`сайт: видео ${on ? 'есть — iframe только по клику' : 'нет — секция скрыта'}`, async ({ page }) => {
    const frames: string[] = []
    await page.route('**/mock-media/**', (r) => r.fulfill({ status: 200, contentType: 'image/webp', body: PIXEL }))
    await page.route(
      'https://www.youtube-nocookie.com/**',
      (r) => (frames.push(r.request().url()), r.fulfill({ status: 200, contentType: 'text/html', body: '<p>v</p>' })),
    )
    const extras = { blocks: [{ id: 'i', type: 'info', tone: 'info', title: '', text: 'Важно знать' }], videos: on ? [video] : [] }
    await page.route('**/api/products**', (r) => r.fulfill({ json: { products: [{ ...flagship, extras }] } }))
    await page.goto('/#product/flagship-device')
    await expect(page.getByTestId('extra-info')).toContainText('Важно знать', { timeout: 15_000 })
    if (!on) return expect(page.getByTestId('product-videos')).toHaveCount(0)
    await expect(page.getByTestId('product-videos')).toContainText('Видео о товаре')
    await expect(page.getByTestId('video-iframe')).toHaveCount(0)
    expect(frames).toEqual([])
    await page.getByTestId('video-play').click()
    await expect(page.getByTestId('video-iframe')).toHaveAttribute('src', new RegExp('^' + YT))
  })
}
