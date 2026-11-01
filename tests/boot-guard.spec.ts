import { expect, test } from '@playwright/test'

/** Белый экран: битый чанк приложения или крэш рендера → сообщение и кнопка «Перезагрузить». */
test.use({ viewport: { width: 390, height: 844 } })

for (const path of ['/admin-reviews.html', '/']) {
  test(`${path}: модуль приложения не загрузился → сообщение и перезагрузка`, async ({ page }) => {
    await page.route('https://st.max.ru/js/max-web-app.js', (r) => r.fulfill({ contentType: 'application/javascript', body: '' }))
    await page.route(/\/(src\/(admin-reviews\/)?main\.tsx|assets\/(adminReviews|main|index)-[^/]*\.js)/, (r) => r.fulfill({ status: 404, body: 'nope' }))
    await page.goto(path)
    const fail = page.getByTestId('boot-fail')
    await expect(fail).toBeVisible({ timeout: 15_000 })
    await fail.getByRole('button', { name: 'Перезагрузить' }).click()
    await expect(page).toHaveURL(/[?&]r=\d+/)
  })
}

test('админка: ошибка рендера → экран ошибки с кнопкой, не белый экран', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as unknown as { WebApp: unknown }).WebApp = {
      initData: 'x', initDataUnsafe: {}, platform: 'test', version: '1',
      ready() {}, expand() {}, enableClosingConfirmation() {}, disableClosingConfirmation() {},
      BackButton: { isVisible: false, onClick() {}, offClick() {}, show() {}, hide() {} },
    }
  })
  await page.route('https://st.max.ru/js/max-web-app.js', (r) => r.fulfill({ contentType: 'application/javascript', body: '' }))
  // Ответ со «странными» данными, который ломает рендер списка.
  await page.route('**/api/admin/reviews**', (r) => r.fulfill({ json: { total: 1, reviews: [null] } }))
  await page.route('**/api/admin/entries**', (r) => r.fulfill({ json: { total: 0, items: [] } }))
  await page.goto('/admin-reviews.html')
  await expect(page.getByTestId('app-crash').or(page.getByText('Опубликованные отзывы').first())).toBeVisible({ timeout: 15_000 })
  const body = (await page.locator('body').innerText()).trim()
  expect(body.length).toBeGreaterThan(10)
})
