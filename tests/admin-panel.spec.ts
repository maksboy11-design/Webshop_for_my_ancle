import { expect, test, type Page } from '@playwright/test'

/** Админ-панель Mini App: разделы «Товары» и «Вебинары» на моках API. Production не трогается. */
const BRIDGE_URL = 'https://st.max.ru/js/max-web-app.js'
const PIXEL = Buffer.from('UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=', 'base64')
const bridge = `window.WebApp = { initData: 'signed', initDataUnsafe: {}, platform: 'test', version: '1',
  ready() {}, expand() {}, enableClosingConfirmation() {}, disableClosingConfirmation() {},
  BackButton: { isVisible: false, onClick() {}, offClick() {}, show() {}, hide() {} } };`

const img = { src: '/products/device.png', width: 601, height: 873 }
const flagship = { id: 'flagship', name: 'Флагманский прибор SILKWAY', pack: null, price: { rub: 84000, pv: 1000 }, image: img, gallery: [], description: null }
const listItem = (over: Record<string, unknown> = {}) => ({
  id: 'flagship', slug: 'flagship-device', brand: 'SILKWAY', category: 'devices', name: flagship.name, pack: null,
  price: flagship.price, image: img, overridden: [], updatedAt: null, ...over,
})

function webinar(id: string, status: string, title: string) {
  return {
    id, status, title, speaker: 'Анна', date: '2026-05-01', sourceType: 'youtube', youtubeVideoId: 'dQw4w9WgXcQ', startSeconds: null,
    recordingSrc: null, youtubeTitle: null, metadataStatus: 'ok', metadataText: 'YouTube: видео доступно.', createdAt: '2026-05-01T00:00:00Z',
    updatedAt: '2026-05-01T00:00:00Z', publishedAt: status === 'published' ? '2026-05-01T00:00:00Z' : null, withdrawnAt: null, fromGroup: true,
  }
}
const W1 = '00000000-0000-4000-8000-000000000001'
const W2 = '00000000-0000-4000-8000-000000000002'

async function setup(page: Page) {
  const calls: { method: string; url: string; body: unknown; initData: string }[] = []
  await page.route(BRIDGE_URL, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: bridge }))
  await page.route('**/api/admin/reviews**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"total":0,"reviews":[]}' }))
  await page.route('**/products/device.png', (r) => r.fulfill({ status: 200, contentType: 'image/webp', body: PIXEL }))
  let saved: Record<string, unknown> = {}
  await page.route('**/api/admin/products**', async (r) => {
    const req = r.request()
    const url = new URL(req.url())
    calls.push({ method: req.method(), url: req.url(), body: req.postDataJSON?.() ?? null, initData: req.headers()['x-max-init-data'] ?? '' })
    if (!url.searchParams.get('id')) {
      return r.fulfill({ json: { editable: true, total: 1, products: [listItem({ ...saved, overridden: Object.keys(saved) })] } })
    }
    if (req.method() === 'PATCH') saved = { ...saved, ...((req.postDataJSON() as { set: Record<string, unknown> }).set ?? {}) }
    const merged = { ...flagship, ...saved }
    return r.fulfill({ json: { editable: true, product: { ...listItem({ ...saved, overridden: Object.keys(saved) }), merged, base: flagship } } })
  })
  const state: Record<string, ReturnType<typeof webinar>> = {
    [W1]: webinar(W1, 'published', 'Вебинар о воде'),
    [W2]: webinar(W2, 'pending', 'Заявка из группы'),
  }
  await page.route('**/api/admin/webinars**', async (r) => {
    const req = r.request()
    const url = new URL(req.url())
    calls.push({ method: req.method(), url: req.url(), body: req.method() === 'PATCH' ? req.postDataJSON() : null, initData: req.headers()['x-max-init-data'] ?? '' })
    const id = url.searchParams.get('id')
    if (!id) {
      const status = url.searchParams.get('status') ?? 'all'
      const q = (url.searchParams.get('q') ?? '').toLowerCase()
      const items = Object.values(state).filter((w) => (status === 'all' || w.status === status) && (!q || w.title.toLowerCase().includes(q)))
      return r.fulfill({ json: { total: items.length, webinars: items } })
    }
    if (req.method() === 'DELETE') {
      const next = state[id]!.status === 'published' ? 'withdrawn' : 'rejected'
      state[id] = { ...state[id]!, status: next }
      return r.fulfill({ json: { ok: true, status: next, webinar: state[id] } })
    }
    if (req.method() === 'PATCH') {
      const body = req.postDataJSON() as { title: string }
      state[id] = { ...state[id]!, title: body.title, updatedAt: '2026-06-01T00:00:00Z' }
    }
    return r.fulfill({ json: { webinar: state[id] } })
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/admin-reviews.html')
  await expect(page.getByRole('navigation', { name: 'Разделы' })).toBeVisible({ timeout: 15_000 })
  return calls
}

test.describe('Админ-панель Mini App', () => {
  test('вкладки переключаются, отзывы остаются первым разделом', async ({ page }) => {
    await setup(page)
    const nav = page.getByRole('navigation', { name: 'Разделы' })
    await expect(nav.getByRole('button', { name: 'Отзывы' })).toHaveAttribute('aria-current', 'page')
    await nav.getByRole('button', { name: 'Товары' }).click()
    await expect(page.getByPlaceholder('Поиск товара...')).toBeVisible()
    await nav.getByRole('button', { name: 'Вебинары' }).click()
    await expect(page.getByText('Вебинар о воде')).toBeVisible()
    await nav.getByRole('button', { name: 'Отзывы' }).click()
    await expect(page.getByPlaceholder('Поиск по ключевым словам...')).toBeVisible()
  })

  test('товар: правка названия и цены, отправляются только изменённые поля', async ({ page }) => {
    const calls = await setup(page)
    await page.getByRole('navigation', { name: 'Разделы' }).getByRole('button', { name: 'Товары' }).click()
    await page.getByText('Флагманский прибор SILKWAY').first().click()
    const form = page.getByRole('form', { name: 'Редактирование товара' })
    await expect(form).toBeVisible()
    await form.getByLabel('Название').fill('Флагман новый')
    await form.getByLabel('PV').fill('10')
    await expect(form.getByLabel('Рубли')).toHaveValue('840')
    await form.getByRole('button', { name: 'Сохранить' }).click()
    await expect(page.getByText(/Сохранено\. На сайте изменения появятся/)).toBeVisible()
    const patch = calls.find((c) => c.method === 'PATCH')!
    expect(patch.body).toEqual({ set: { name: 'Флагман новый', price: { rub: 840, pv: 10 } } })
    expect(calls.every((c) => c.initData === 'signed')).toBe(true)
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('signed')
  })

  test('товар: несохранённые правки — подтверждение при выходе', async ({ page }) => {
    await setup(page)
    await page.getByRole('navigation', { name: 'Разделы' }).getByRole('button', { name: 'Товары' }).click()
    await page.getByText('Флагманский прибор SILKWAY').first().click()
    await page.getByRole('form', { name: 'Редактирование товара' }).getByLabel('Название').fill('Черновик')
    let asked = ''
    page.once('dialog', (d) => {
      asked = d.message()
      void d.dismiss()
    })
    await page.getByRole('button', { name: 'Назад к товарам' }).click()
    expect(asked).toMatch(/несохранённые/)
    await expect(page.getByRole('form', { name: 'Редактирование товара' }).getByLabel('Название')).toHaveValue('Черновик')
  })

  test('вебинары: фильтр, правка, снятие с подтверждением', async ({ page }) => {
    const calls = await setup(page)
    await page.getByRole('navigation', { name: 'Разделы' }).getByRole('button', { name: 'Вебинары' }).click()
    await page.getByRole('group', { name: 'Статус' }).getByRole('button', { name: 'Ожидают' }).click()
    await expect(page.getByText('Заявка из группы')).toBeVisible()
    await expect(page.getByText('Вебинар о воде')).toHaveCount(0)
    await page.getByRole('group', { name: 'Статус' }).getByRole('button', { name: 'Опубликованы' }).click()
    await page.getByText('Вебинар о воде').click()
    const form = page.getByRole('form', { name: 'Редактирование вебинара' })
    await form.getByLabel('Название').fill('Вебинар о водороде')
    await form.getByRole('button', { name: 'Сохранить' }).click()
    await expect(page.getByText(/Сохранено/)).toBeVisible()
    const patch = calls.find((c) => c.method === 'PATCH')!
    expect((patch.body as { title: string; expectedUpdatedAt: string }).title).toBe('Вебинар о водороде')
    await form.getByRole('button', { name: 'Снять с сайта' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Подтверждение' })
    await expect(dialog).toBeVisible()
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    await dialog.getByRole('button', { name: 'Да, снять с сайта' }).click()
    await expect(page.getByText(/Снят/).first()).toBeVisible()
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1)
  })
})

test.describe('Сайт: данные товаров из /api/products', () => {
  test('переопределение из API применяется в каталоге', async ({ page }) => {
    await page.route('**/api/products**', (r) =>
      r.fulfill({ json: { source: 'db', products: [{ ...flagship, name: 'Прибор из админки' }] } }),
    )
    await page.goto('/#/catalog')
    await expect(page.getByText('Прибор из админки').first()).toBeVisible({ timeout: 15_000 })
  })

  test('API недоступен — статический каталог и диагностика в консоли', async ({ page }) => {
    const warnings: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'warning') warnings.push(m.text())
    })
    await page.route('**/api/products**', (r) => r.fulfill({ status: 503, body: 'down' }))
    await page.goto('/#/catalog')
    await expect(page.getByText('Флагманский прибор SILKWAY').first()).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => warnings.some((w) => w.includes('[products]'))).toBe(true)
  })
})
