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
  ['/', 320],
  ['/', 360],
  ['/', 390],
  ['/', 430],
  ['/', 768],
  ['/#catalog', 320],
  ['/#catalog', 390],
  ['/#catalog', 430],
  ['/#catalog', 768],
  ['/#catalog', 1440],
  ['/#product/flagship-device', 320],
  ['/#product/flagship-device', 390],
  ['/#product/flagship-device', 768],
  ['/#about', 390],
  ['/#about', 1440],
  ['/#contacts', 320],
  ['/#contacts', 390],
  ['/#videos', 360],
  ['/#videos', 768],
  ['/#webinars', 390],
] as const) {
  test(`${path} @ ${width}px без горизонтального скролла`, async ({ page }) => {
    await open(page, path, width)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
    const offenders = await page.evaluate(() => {
      const view = document.documentElement.clientWidth
      const problems: string[] = []
      const contained = (el: Element) => {
        for (let node = el.parentElement; node; node = node.parentElement) {
          const style = getComputedStyle(node)
          const clips = style.overflowX === 'auto' || style.overflowX === 'scroll'
          if (!clips) continue
          const box = node.getBoundingClientRect()
          if (box.width > 0 && box.left >= -1 && box.right <= view + 1) return true
        }
        return false
      }
      for (const el of document.querySelectorAll<HTMLElement>('body *')) {
        const style = getComputedStyle(el)
        if (style.display === 'none' || style.visibility === 'hidden') continue
        if (style.position === 'fixed') continue
        const rect = el.getBoundingClientRect()
        if (rect.width < 2 || rect.height < 2) continue
        if (rect.left >= -1 && rect.right <= view + 1) continue
        if (contained(el)) continue
        const name = `${el.tagName}.${String(el.className).slice(0, 80)}`
        problems.push(`${name} L${Math.round(rect.left)} R${Math.round(rect.right)}`)
        if (problems.length >= 8) break
      }
      return problems
    })
    expect(offenders).toEqual([])
  })
}

test('главная по-прежнему показывает Hero', async ({ page }) => {
  await open(page, '/', 1440)
  await expect(page.locator('[data-testid=hero-bg]')).toBeVisible()
  await expect(page.locator('[data-testid=device]')).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ваше здоровье- наш приоритет')
})
