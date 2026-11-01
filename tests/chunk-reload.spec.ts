import { expect, test, type Page } from '@playwright/test'

/** Устаревший чанк после деплоя: страница перезагружается один раз и не зацикливается. Только моки API. */
const BRIDGE_URL = 'https://st.max.ru/js/max-web-app.js'
const bridge = `window.WebApp = { initData: 'signed', initDataUnsafe: {}, platform: 'test', version: '1',
  ready() {}, expand() {}, enableClosingConfirmation() {}, disableClosingConfirmation() {},
  BackButton: { isVisible: false, onClick() {}, offClick() {}, show() {}, hide() {} } };`

async function setup(page: Page, failures: number) {
  let left = failures
  await page.route(BRIDGE_URL, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: bridge }))
  await page.route('**/api/admin/reviews**', (r) => r.fulfill({ json: { total: 0, reviews: [] } }))
  await page.route('**/api/admin/products**', (r) => r.fulfill({ json: { editable: true, total: 0, products: [] } }))
  await page.route('**/api/admin/webinars**', (r) => r.fulfill({ json: { total: 0, webinars: [] } }))
  await page.route('**/api/admin/entries**', (r) => r.fulfill({ json: { entries: [], categories: {} } }))
  await page.route(/\/assets\/WebinarsSection-[^/]+\.js$/, (r) => (left-- > 0 ? r.fulfill({ status: 404, body: 'gone' }) : r.continue()))
  let loads = 0
  page.on('load', () => loads++)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/admin-reviews.html')
  const nav = page.getByRole('navigation', { name: 'Разделы' })
  await expect(nav).toBeVisible({ timeout: 15_000 })
  return { nav, loads: () => loads }
}

test('устаревший чанк Mini App: одна перезагрузка, затем раздел открывается', async ({ page }) => {
  const { nav, loads } = await setup(page, 1)
  await nav.getByRole('button', { name: 'Вебинары' }).click()
  await expect.poll(loads).toBe(2)
  await expect(nav).toBeVisible({ timeout: 15_000 })
  await nav.getByRole('button', { name: 'Вебинары' }).click()
  await expect(page.getByTestId('app-crash')).toHaveCount(0)
  await expect(page.getByTestId('add-entries-webinar')).toBeVisible({ timeout: 15_000 })
})

test('чанк битый постоянно: без цикла перезагрузок, показывается ошибка', async ({ page }) => {
  const { nav, loads } = await setup(page, 100)
  await nav.getByRole('button', { name: 'Вебинары' }).click()
  await expect.poll(loads).toBe(2)
  await page.getByRole('navigation', { name: 'Разделы' }).getByRole('button', { name: 'Вебинары' }).click()
  await expect(page.getByTestId('app-crash')).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(1500)
  expect(loads()).toBe(2)
})
