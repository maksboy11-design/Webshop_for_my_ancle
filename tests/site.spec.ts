import { expect, test } from '@playwright/test'

async function open(page: import('@playwright/test').Page, path: string, width: number) {
  await page.setViewportSize({ width, height: 900 })
  await page.goto(path)
  await page.evaluate(() => document.fonts.ready)
}

test('каталог: фильтр категории попадает в URL и открывает товар', async ({ page }) => {
  await open(page, '/#catalog', 1440)
  await page.locator('a[href*="category=supplements"]').first().click()
  await expect.poll(() => new URL(page.url()).hash).toContain('category=supplements')
  await page.getByRole('link', { name: 'Подробнее' }).first().click()
  await expect.poll(() => new URL(page.url()).hash).toContain('#product/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByText('Цена уточняется').first()).toBeVisible()
})

test('аккордеон FAQ открывается с клавиатуры', async ({ page }) => {
  await open(page, '/', 1280)
  const button = page.getByRole('button', { name: 'Как оформить заказ?' })
  await button.focus()
  await page.keyboard.press('Enter')
  await expect(button).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Enter')
  await expect(button).toHaveAttribute('aria-expanded', 'false')
})

test('согласие не отмечено и блокирует отправку', async ({ page }) => {
  await open(page, '/#contacts', 1280)
  const consent = page.getByRole('checkbox', { name: /обработку персональных данных/ })
  await expect(consent).not.toBeChecked()
  const submit = page.getByRole('button', { name: 'Отправить' })
  await expect(submit).toBeDisabled()
  await page.getByRole('textbox', { name: 'Имя' }).fill('Анна')
  await page.getByRole('textbox', { name: 'Телефон или ник в Telegram' }).fill('@anna')
  await page.getByRole('textbox', { name: 'Ваш вопрос' }).fill('Вопрос')
  await expect(submit).toBeDisabled()
  await consent.check()
  await expect(submit).toBeEnabled()
})

for (const [path, width] of [
  ['/', 390],
  ['/#catalog', 390],
  ['/#catalog', 1440],
  ['/#product/flagship-device', 390],
  ['/#about', 1440],
  ['/#contacts', 320],
  ['/#videos', 768],
] as const) {
  test(`${path} @ ${width}px без горизонтального скролла`, async ({ page }) => {
    await open(page, path, width)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
  })
}

test('главная по-прежнему показывает Hero', async ({ page }) => {
  await open(page, '/', 1440)
  await expect(page.locator('[data-testid=hero-bg]')).toBeVisible()
  await expect(page.locator('[data-testid=device]')).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ваше здоровье- наш приоритет')
})
