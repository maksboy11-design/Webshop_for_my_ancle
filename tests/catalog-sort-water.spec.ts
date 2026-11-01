import { expect, test, type Page } from '@playwright/test'

const sortButton = (page: Page) => page.getByRole('button', { name: /^Сортировка:/ })
const titles = (page: Page) =>
  page.locator('main a[href^="#product/"] img[alt]').evaluateAll((els) => els.map((e) => (e as HTMLImageElement).alt))

test.describe('сортировка каталога — водяной список', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#/catalog')
    await expect(sortButton(page)).toBeVisible()
  })

  test('открытие, вытекание воды и выбор сортирует по названию', async ({ page }) => {
    const btn = sortButton(page)
    await expect(btn).toHaveAttribute('aria-haspopup', 'listbox')
    await expect(btn).toHaveAttribute('aria-expanded', 'false')
    await btn.click()
    await expect(btn).toHaveAttribute('aria-expanded', 'true')
    const list = page.getByRole('listbox', { name: 'Сортировка' })
    await expect(list).toBeFocused()
    await expect(page.locator('[data-phase="open"]')).toHaveCount(1, { timeout: 3000 })
    const alpha = await page.getByTestId('water-canvas').evaluate((c: HTMLCanvasElement) => {
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
      let max = 0
      for (let i = 3; i < d.length; i += 4) max = Math.max(max, d[i])
      return max
    })
    expect(alpha).toBeGreaterThan(80)
    expect(alpha).toBeLessThan(230)
    await page.getByRole('option', { name: 'По названию' }).click()
    await expect.poll(() => page.url()).toContain('sort=name')
    await expect(btn).toHaveAttribute('aria-expanded', 'false')
    await expect(sortButton(page)).toHaveAccessibleName('Сортировка: По названию')
    await expect(page.locator('[data-phase="closed"]')).toHaveCount(1, { timeout: 3000 })
    const t = await titles(page)
    expect(t.length).toBeGreaterThan(1)
    expect([...t].sort((a, b) => a.localeCompare(b, 'ru'))).toEqual(t)
  })

  test('клавиатура: стрелки, Enter, Esc, Tab', async ({ page }) => {
    const btn = sortButton(page)
    await btn.focus()
    await page.keyboard.press('ArrowDown')
    await expect(btn).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Escape')
    await expect(btn).toHaveAttribute('aria-expanded', 'false')
    await expect(btn).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(btn).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('option', { name: 'По названию' })).toHaveAttribute('data-active', 'true')
    await page.keyboard.press('Enter')
    await expect.poll(() => page.url()).toContain('sort=name')
    await expect(sortButton(page)).toBeFocused()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Tab')
    await expect(sortButton(page)).toHaveAttribute('aria-expanded', 'false')
  })

  test('закрытие кликом снаружи и повторным нажатием', async ({ page }) => {
    const btn = sortButton(page)
    await btn.click()
    await page.mouse.click(5, 5)
    await expect(btn).toHaveAttribute('aria-expanded', 'false')
    await btn.click()
    await btn.click()
    await expect(btn).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('[data-phase="closed"]')).toHaveCount(1, { timeout: 3000 })
  })

  test('prefers-reduced-motion: без симуляции, простое затухание', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.reload()
    await sortButton(page).click()
    await expect(page.getByTestId('water-canvas')).toHaveCount(0)
    await expect(page.locator('[data-reduced="true"]')).toBeVisible()
    await page.getByRole('option', { name: 'По названию' }).click()
    await expect.poll(() => page.url()).toContain('sort=name')
  })
})
