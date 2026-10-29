import { expect, test } from '@playwright/test'

test.describe('Mini App опубликованных отзывов', () => {
  test('вне MAX показывает заглушку и не грузит отзывы', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    let adminApiHits = 0
    await page.route('**/api/admin/reviews**', async (route) => {
      adminApiHits += 1
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'missing_init_data' }) })
    })
    await page.goto('/admin-reviews.html')
    await expect(page.getByRole('heading', { name: 'Опубликованные отзывы' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/Откройте этот интерфейс из MAX/i)).toBeVisible()
    await expect(page.getByPlaceholder('Поиск по ключевым словам...')).toHaveCount(0)
    expect(adminApiHits).toBe(0)
  })

  test('на широком экране вне MAX тоже заглушка без горизонтального скролла', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/admin-reviews.html')
    await expect(page.locator('body')).toBeVisible()
    const overflow = await page.evaluate(() => {
      const el = document.documentElement
      return el.scrollWidth > el.clientWidth + 1
    })
    expect(overflow).toBe(false)
  })
})
