import { expect, test } from '@playwright/test'
import { SCIENCE_SECTIONS } from '../src/data/scienceFacts'

const CARD_COUNT = SCIENCE_SECTIONS.reduce((n, s) => n + s.cards.length, 0)

test.describe('Страница «Научные факты»', () => {
  test('кнопка на главной ведёт на внутреннюю страницу, не в Telegram', async ({ page }) => {
    await page.goto('/')
    const link = page.locator('#benefits').getByRole('link', { name: 'Научные факты', exact: true })
    await expect(link).toHaveAttribute('href', '#science')
    await link.click()
    await expect.poll(() => new URL(page.url()).hash).toBe('#science')
    await expect(page.getByRole('heading', { level: 1, name: 'Научные факты' })).toBeVisible()
    const tg = await page.locator('a[href*="t.me"]').count()
    expect(tg).toBe(0)
  })

  test('контент: карточки, статья, без автора сообщений', async ({ page }) => {
    await page.goto('/#science')
    await expect(page.getByTestId('science-card')).toHaveCount(CARD_COUNT)
    expect(CARD_COUNT).toBeGreaterThan(20)
    const article = page.getByTestId('science-article')
    await expect(article).toContainText('ННГУ им. Н.И. Лобачевского')
    const ext = article.getByRole('link', { name: 'Подробнее на наука.рф' })
    await expect(ext).toHaveAttribute('rel', /noopener/)
    await expect(ext).toHaveAttribute('target', '_blank')
    const text = await page.locator('body').innerText()
    expect(text).not.toContain('Тетя Таня')
    expect(text).not.toContain('Фотография')
    expect(text).not.toMatch(/\[\d{2}\.\d{2}\.\d{4}/)
  })

  test('навигация по разделам прокручивает к разделу, маршрут сохраняется', async ({ page }) => {
    await page.goto('/#science')
    await page.getByRole('navigation', { name: 'Разделы страницы' }).getByRole('link', { name: 'Заключение' }).click()
    await expect(page.locator('#science-conclusion')).toBeInViewport()
    expect(new URL(page.url()).hash).toBe('#science')
  })

  test('кнопка «На главную» возвращает на главную', async ({ page }) => {
    await page.goto('/#science')
    await page.getByRole('link', { name: '← На главную' }).first().click()
    await expect(page.locator('#benefits')).toBeVisible()
  })

  for (const [width, height] of [
    [375, 812],
    [768, 1024],
    [1440, 900],
  ] as const) {
    test(`${width}px: без горизонтального переполнения + скриншот`, async ({ page }) => {
      await page.setViewportSize({ width, height })
      await page.goto('/#science')
      await expect(page.getByTestId('science-card').first()).toBeVisible()
      await page.evaluate(() => document.fonts.ready)
      const o = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth,
      }))
      expect(o.sw).toBeLessThanOrEqual(o.cw + 1)
      if (process.env.SCIENCE_SHOTS) {
        await page.screenshot({ path: `${process.env.SCIENCE_SHOTS}/science-${width}.png`, fullPage: false })
        await page.screenshot({ path: `${process.env.SCIENCE_SHOTS}/science-${width}-full.png`, fullPage: true })
      }
    })
  }
})
