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

test('в конце страниц одна подпись без формы и мессенджеров', async ({ page }) => {
  const line = 'Остались вопросы — обратитесь к тому, кто вас пригласил.'
  for (const path of ['/', '/#catalog', '/#product/flagship-device', '/#about', '/#contacts', '/#videos', '/#webinars']) {
    await open(page, path, 390)
    const invite = page.getByText(line)
    await expect(invite).toBeVisible()
    const size = await invite.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
    expect(size).toBeGreaterThanOrEqual(16)
  }
  await expect(page.getByRole('heading', { name: 'Остались вопросы?' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Отправить' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Написать в Telegram' })).toHaveCount(0)
  await expect(page.getByRole('checkbox', { name: /персональных данных/ })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Политика конфиденциальности' })).toBeVisible()
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

test('страница товара показывает опубликованный отзыв текстом', async ({ page }) => {
  await page.route('**/api/reviews**', async (route) => {
    expect(route.request().method()).toBe('GET')
    expect(new URL(route.request().url()).searchParams.get('productId')).toBe('flagship')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        reviews: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            productId: 'flagship',
            author: 'Анна',
            text: '<script>alert(1)</script>',
          },
        ],
      }),
    })
  })
  await open(page, '/#product/flagship-device', 1280)
  const section = page.getByTestId('product-reviews')
  await expect(section.getByText('<script>alert(1)</script>')).toBeVisible()
  await expect(section.locator('script')).toHaveCount(0)
})

test('страница товара честно показывает пустые и недоступные отзывы', async ({ page }) => {
  await page.route('**/api/reviews**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reviews: [] }) })
  })
  await open(page, '/#product/flagship-device', 390)
  await expect(page.getByText('Опубликованных отзывов пока нет.')).toBeVisible()
  await page.unroute('**/api/reviews**')
  await page.route('**/api/reviews**', async (route) => {
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'unavailable' }) })
  })
  await page.reload()
  await expect(page.getByText('Отзывы временно недоступны.')).toBeVisible()
})

test('главная по-прежнему показывает Hero', async ({ page }) => {
  await open(page, '/', 1440)
  await expect(page.locator('[data-testid=hero-bg]')).toBeVisible()
  await expect(page.locator('[data-testid=device]')).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ваше здоровье- наш приоритет')
})
