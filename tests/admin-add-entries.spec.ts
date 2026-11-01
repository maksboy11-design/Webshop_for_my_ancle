import { expect, test, type Page } from '@playwright/test'

/** Кнопка «Добавить» в Mini App: черновик при пустых полях, публикация при полностью заполненных. Только моки API. */
const BRIDGE_URL = 'https://st.max.ru/js/max-web-app.js'
const bridge = `window.WebApp = { initData: 'signed', initDataUnsafe: {}, platform: 'test', version: '1',
  ready() {}, expand() {}, enableClosingConfirmation() {}, disableClosingConfirmation() {},
  BackButton: { isVisible: false, onClick() {}, offClick() {}, show() {}, hide() {} } };`

const REQUIRED: Record<string, string[]> = {
  product: ['name', 'brandId', 'category', 'priceRub', 'imageUrl', 'description'],
  review: ['productId', 'author', 'text'],
  webinar: ['title', 'youtubeUrl', 'category'],
}

async function setup(page: Page, opts: { migrated?: boolean } = {}) {
  const posts: { kind: string; data: Record<string, string> }[] = []
  const entries: Record<string, unknown>[] = []
  await page.route(BRIDGE_URL, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: bridge }))
  await page.route('**/api/admin/reviews**', (r) => r.fulfill({ json: { total: 0, reviews: [] } }))
  await page.route('**/api/admin/products**', (r) => r.fulfill({ json: { editable: true, total: 0, products: [] } }))
  await page.route('**/api/admin/webinars**', (r) => r.fulfill({ json: { total: 0, webinars: [] } }))
  await page.route('**/api/admin/entries**', async (r) => {
    const req = r.request()
    if (opts.migrated === false) return r.fulfill({ status: 503, json: { error: 'migration_pending' } })
    const url = new URL(req.url())
    if (req.headers()['x-max-init-data'] !== 'signed') return r.fulfill({ status: 401, json: { error: 'missing_init_data' } })
    if (req.method() === 'POST') {
      const body = req.postDataJSON() as { kind: string; data: Record<string, string> }
      posts.push(body)
      const data = Object.fromEntries(Object.entries(body.data).filter(([, v]) => v.trim()))
      const missing = REQUIRED[body.kind]!.filter((f) => !data[f])
      const entry = { id: `00000000-0000-4000-8000-00000000000${posts.length}`, kind: body.kind, status: missing.length ? 'draft' : 'published', data, missing, createdAt: 'x', updatedAt: 'x' }
      entries.unshift(entry)
      return r.fulfill({ status: 201, json: { entry } })
    }
    const kind = url.searchParams.get('kind')
    return r.fulfill({ json: { entries: entries.filter((e) => e.kind === kind) } })
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/admin-reviews.html')
  await expect(page.getByRole('navigation', { name: 'Разделы' })).toBeVisible({ timeout: 15_000 })
  return posts
}

test.describe('«Добавить» в Mini App', () => {
  test('отзыв: пустое поле — черновик, все поля — публикация', async ({ page }) => {
    const posts = await setup(page)
    const block = page.getByTestId('add-entries-review')
    await block.getByRole('button', { name: /Добавить отзыв/ }).click()
    const form = page.getByTestId('entry-form-review')
    await form.getByLabel('Имя автора').fill('Анна')
    await expect(form.getByTestId('entry-outcome')).toContainText('Сохранится черновиком. Не заполнено: Товар, Текст отзыва')
    await page.screenshot({ path: '/workspace/webinar-shots/miniapp-add-review.png', fullPage: true })
    await form.getByRole('button', { name: 'Сохранить черновик' }).click()
    await expect(block.getByTestId('entry-row').first()).toContainText('Черновик')
    expect(posts[0]).toEqual({ kind: 'review', data: { author: 'Анна' } })

    await block.getByRole('button', { name: /Добавить отзыв/ }).click()
    await form.getByLabel('Товар').selectOption('flagship')
    await form.getByLabel('Имя автора').fill('Борис')
    await form.getByLabel('Текст отзыва').fill('Пользуюсь месяц.')
    await expect(form.getByTestId('entry-outcome')).toContainText('будет опубликована')
    await form.getByRole('button', { name: 'Опубликовать' }).click()
    await expect(block.getByTestId('entry-row').first()).toContainText('Опубликован')
  })

  test('товар и вебинар: формы с обязательными полями', async ({ page }) => {
    const posts = await setup(page)
    const nav = page.getByRole('navigation', { name: 'Разделы' })
    await nav.getByRole('button', { name: 'Товары' }).click()
    await page.getByTestId('add-entries-product').getByRole('button', { name: /Добавить товар/ }).click()
    const pf = page.getByTestId('entry-form-product')
    await pf.getByLabel('Название').fill('Новый товар')
    await pf.getByLabel('Цена, ₽').fill('1500')
    await expect(pf.getByTestId('entry-outcome')).toContainText('Бренд, Категория, Ссылка на фото (https), Описание')
    await page.screenshot({ path: '/workspace/webinar-shots/miniapp-add-product.png', fullPage: true })
    await pf.getByRole('button', { name: 'Сохранить черновик' }).click()
    await expect(page.getByTestId('add-entries-product').getByTestId('entry-row')).toContainText('Не заполнено')

    await nav.getByRole('button', { name: 'Вебинары' }).click()
    await page.getByTestId('add-entries-webinar').getByRole('button', { name: /Добавить вебинар/ }).click()
    const wf = page.getByTestId('entry-form-webinar')
    await wf.getByLabel('Название').fill('Врач о сне')
    await wf.getByLabel('Ссылка YouTube').fill('https://youtu.be/dQw4w9WgXcQ')
    await wf.getByLabel('Категория').selectOption('doctors')
    await expect(wf.getByTestId('entry-outcome')).toContainText('будет опубликована')
    await page.screenshot({ path: '/workspace/webinar-shots/miniapp-add-webinar.png', fullPage: true })
    await wf.getByRole('button', { name: 'Опубликовать' }).click()
    await expect(page.getByTestId('add-entries-webinar').getByTestId('entry-row')).toContainText('Опубликован')
    expect(posts.at(-1)).toEqual({ kind: 'webinar', data: { title: 'Врач о сне', youtubeUrl: 'https://youtu.be/dQw4w9WgXcQ', category: 'doctors' } })
  })

  test('без миграции на сервере — понятное сообщение, разделы работают', async ({ page }) => {
    await setup(page, { migrated: false })
    await expect(page.getByTestId('add-entries-review')).toContainText('нужна миграция 006')
  })
})
