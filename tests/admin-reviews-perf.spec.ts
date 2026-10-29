import { expect, test, type Page, type Request } from '@playwright/test'

/**
 * Поведение Mini App на медленной сети: асинхронный bridge, резерв initData из URL,
 * отсутствие лишних запросов, ленивые медиа. Всё на моках: production-данные не трогаются.
 */
const BRIDGE_URL = 'https://st.max.ru/js/max-web-app.js'
const BLOB = 'https://nixktcrzq4krmovs.public.blob.vercel-storage.com/reviews'
const PIXEL = Buffer.from('UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=', 'base64')

const bridgeStub = (initData: string) => `
  window.__calls = { ready: 0, expand: 0, disableClosingConfirmation: 0 };
  window.WebApp = {
    initData: ${JSON.stringify(initData)}, initDataUnsafe: {}, platform: 'test', version: '1',
    ready() { window.__calls.ready++ },
    expand() { window.__calls.expand++ },
    disableClosingConfirmation() { window.__calls.disableClosingConfirmation++ },
    BackButton: { isVisible: false, onClick() {}, offClick() {}, show() {}, hide() {} },
  };`

function card(i: number, full = false) {
  const media = [
    { type: 'image', src: `${BLOB}/c/${i}/0.jpg`, thumbnailSrc: `${BLOB}/c/${i}/0.thumb.webp`, poster: null, alt: null },
    { type: 'video', src: `${BLOB}/c/${i}/1.mp4`, poster: null, alt: null },
  ]
  const base = {
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    productId: 'p1',
    productName: `Товар ${i}`,
    author: `Автор ${i}`,
    photosCount: 1,
    videosCount: 1,
    mediaCount: 2,
    publishedAt: '2026-10-01T00:00:00Z',
  }
  return full ? { ...base, text: `Полный текст ${i}`, media } : { ...base, textPreview: `Текст ${i}`, media }
}

interface Mock {
  listRequests: Request[]
  initDataSeen: string[]
}

async function mockApi(page: Page, opts: { listDelay?: (q: string) => number } = {}): Promise<Mock> {
  const mock: Mock = { listRequests: [], initDataSeen: [] }
  await page.route('**/api/admin/reviews**', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    mock.initDataSeen.push(req.headers()['x-max-init-data'] ?? '')
    const id = url.searchParams.get('id')
    if (req.method() === 'DELETE') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
    if (id) {
      const i = Number(id.slice(-12))
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ review: card(i, true) }) })
    }
    mock.listRequests.push(req)
    const q = url.searchParams.get('q') ?? ''
    const delay = opts.listDelay?.(q) ?? 0
    if (delay) await new Promise((r) => setTimeout(r, delay))
    const reviews = q ? [card(q.length + 100)] : [card(1), card(2)]
    try {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ total: reviews.length, reviews }) })
    } catch {
      /* запрос отменён клиентом */
    }
  })
  await page.route('**/review-media/**', (route) => route.fulfill({ status: 200, contentType: 'image/webp', body: PIXEL }))
  return mock
}

test.describe('Mini App отзывов: слабая сеть', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
  })

  test('сразу показывает оболочку, bridge с задержкой: ready/expand/disable ровно один раз, один запрос списка', async ({ page }) => {
    await page.route(BRIDGE_URL, async (route) => {
      await new Promise((r) => setTimeout(r, 1500))
      await route.fulfill({ status: 200, contentType: 'application/javascript', body: bridgeStub('signed-bridge') })
    })
    const mock = await mockApi(page)
    await page.goto('/admin-reviews.html', { waitUntil: 'commit' })
    await expect(page.getByRole('status').first()).toBeVisible({ timeout: 1000 })
    await expect(page.getByRole('heading', { name: 'Товар 1' })).toBeVisible({ timeout: 15_000 })
    const calls = await page.evaluate(() => (window as unknown as { __calls: Record<string, number> }).__calls)
    expect(calls).toEqual({ ready: 1, expand: 1, disableClosingConfirmation: 1 })
    await page.waitForTimeout(600)
    expect(mock.listRequests).toHaveLength(1)
    expect(mock.initDataSeen.every((v) => v === 'signed-bridge')).toBe(true)
    expect(mock.listRequests[0].url()).not.toContain('signed-bridge')
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('signed-bridge')
  })

  test('bridge не загрузился, но initData есть в URL — список работает без «падения»', async ({ page }) => {
    await page.route(BRIDGE_URL, (route) => route.abort('failed'))
    const mock = await mockApi(page)
    await page.goto('/admin-reviews.html#WebAppData=signed-from-url')
    await expect(page.getByRole('heading', { name: 'Товар 1' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/Ошибка/)).toHaveCount(0)
    expect(mock.initDataSeen[0]).toBe('signed-from-url')
  })

  test('ошибка загрузки bridge без initData — понятное сообщение и рабочая кнопка «Повторить»', async ({ page }) => {
    let fail = true
    await page.route(BRIDGE_URL, (route) =>
      fail ? route.abort('failed') : route.fulfill({ status: 200, contentType: 'application/javascript', body: bridgeStub('signed-retry') }),
    )
    await mockApi(page)
    await page.goto('/admin-reviews.html')
    await expect(page.getByText(/Не удалось загрузить модуль MAX/)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/Ошибка загрузки приложения/)).toHaveCount(0)
    fail = false
    await page.getByRole('button', { name: 'Повторить' }).click()
    await expect(page.getByRole('heading', { name: 'Товар 1' })).toBeVisible({ timeout: 15_000 })
  })

  test('список — миниатюры lazy/async, детали — оригинал, видео без предзагрузки', async ({ page }) => {
    await page.route(BRIDGE_URL, (route) =>
      route.fulfill({ status: 200, contentType: 'application/javascript', body: bridgeStub('signed') }),
    )
    await mockApi(page)
    await page.goto('/admin-reviews.html')
    const thumb = page.locator('article').first().locator('img').first()
    await expect(thumb).toBeVisible({ timeout: 15_000 })
    await expect(thumb).toHaveAttribute('loading', 'lazy')
    await expect(thumb).toHaveAttribute('decoding', 'async')
    await expect(thumb).toHaveAttribute('src', '/review-media/c/1/0.thumb.webp')
    await page.getByRole('button', { name: 'Подробнее' }).first().click()
    const original = page.locator('img[src="/review-media/c/1/0.jpg"]')
    await expect(original).toBeVisible({ timeout: 15_000 })
    await expect(original).toHaveAttribute('loading', 'lazy')
    await expect(page.locator('video')).toHaveAttribute('preload', 'none')
    await page.getByRole('button', { name: 'Редактировать' }).click()
    await expect(page.getByText('Текст отзыва')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('img[src="/review-media/c/1/0.jpg"]')).toBeVisible()
    await expect(page.locator('video')).toHaveAttribute('preload', 'none')
  })

  test('после удаления из списка — ровно один повторный запрос списка', async ({ page }) => {
    await page.route(BRIDGE_URL, (route) =>
      route.fulfill({ status: 200, contentType: 'application/javascript', body: bridgeStub('signed') }),
    )
    const mock = await mockApi(page)
    await page.goto('/admin-reviews.html')
    await expect(page.getByRole('heading', { name: 'Товар 1' })).toBeVisible({ timeout: 15_000 })
    const before = mock.listRequests.length
    await page.getByRole('button', { name: 'Удалить' }).first().click()
    await expect(page.getByText('Отзыв удалён с сайта.')).toBeVisible()
    await page.waitForTimeout(800)
    expect(mock.listRequests.length - before).toBe(1)
  })

  test('устаревший поиск отменяется, ошибка не показывается, побеждает последний запрос', async ({ page }) => {
    await page.route(BRIDGE_URL, (route) =>
      route.fulfill({ status: 200, contentType: 'application/javascript', body: bridgeStub('signed') }),
    )
    const mock = await mockApi(page, { listDelay: (q) => (q === 'аб' ? 3000 : 0) })
    const failed: string[] = []
    page.on('requestfailed', (r) => {
      if (r.url().includes('/api/admin/reviews')) failed.push(new URL(r.url()).searchParams.get('q') ?? '')
    })
    await page.goto('/admin-reviews.html')
    await expect(page.getByRole('heading', { name: 'Товар 1' })).toBeVisible({ timeout: 15_000 })
    const search = page.getByPlaceholder('Поиск по ключевым словам...')
    await search.fill('аб')
    await expect.poll(() => mock.listRequests.some((r) => new URL(r.url()).searchParams.get('q') === 'аб')).toBe(true)
    await search.fill('абвгд')
    await expect(page.getByRole('heading', { name: 'Товар 105' })).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => failed).toContain('аб')
    await page.waitForTimeout(3200)
    await expect(page.getByRole('heading', { name: 'Товар 105' })).toBeVisible()
    await expect(page.getByText(/Нет связи|Не удалось выполнить/)).toHaveCount(0)
  })
})
