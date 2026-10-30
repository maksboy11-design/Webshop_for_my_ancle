import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { BENEFITS } from '../src/data/hero'
import { productHref } from '../src/config/hashRoute'
import { ROUTES } from '../src/config/routes'
import { productBySlug } from '../src/data/products'

const EXPECTED = [
  { title: 'Водородная ванна', href: productHref('flagship-device'), hash: '#product/flagship-device', kind: 'product' as const, slug: 'flagship-device' },
  { title: 'Водородная бутылка', href: productHref('silkway-filter'), hash: '#product/silkway-filter', kind: 'product' as const, slug: 'silkway-filter' },
  { title: 'Научные факты', href: ROUTES.webinars, hash: '#webinars', kind: 'page' as const, heading: 'Вебинары' },
  { title: 'Отзывы', href: ROUTES.videos, hash: '#videos', kind: 'page' as const, heading: 'Отзывы' },
]

async function openHome(page: Page, width = 1440, height = 900) {
  await page.setViewportSize({ width, height })
  await page.goto('/')
  await page.evaluate(() => document.fonts.ready)
  await expect(page.locator('#benefits')).toBeVisible()
}

test.describe('Hero Benefits: четыре навигационных блока на воде', () => {
  test('данные: ровно четыре блока с заданными названиями', () => {
    expect(BENEFITS).toHaveLength(4)
    expect(BENEFITS.map((b) => b.title)).toEqual(EXPECTED.map((e) => e.title))
    expect(productBySlug('silkway-filter')?.id).toBe('filter')
    expect(productBySlug('flagship-device')).toBeTruthy()
  })

  test('на странице: четыре ссылки, точные title и href, WaterSurface на месте', async ({ page }) => {
    await openHome(page)
    const nav = page.locator('#benefits [aria-label="Разделы"]')
    await expect(nav).toBeVisible()
    const links = nav.getByRole('link')
    await expect(links).toHaveCount(4)
    for (const item of EXPECTED) {
      const link = nav.getByRole('link', { name: item.title, exact: true })
      await expect(link).toHaveAttribute('href', item.href)
    }
    // Физическая вода: canvas либо data-water=webgl/fallback/pending на панели.
    const panel = page.locator('#benefits')
    const mode = await panel.getAttribute('data-water')
    expect(['pending', 'webgl', 'fallback']).toContain(mode)
    await expect(panel.locator('canvas, [class*="water"]').first()).toBeAttached()
    await expect(page.locator('[data-testid=water-spread]')).toHaveCount(0)
    await expect(page.locator('[data-water-spread]')).toHaveCount(0)
  })

  for (const item of EXPECTED) {
    test(`клик по «${item.title}» → ${item.hash} без растекания`, async ({ page }) => {
      await openHome(page)
      const link = page.locator('#benefits').getByRole('link', { name: item.title, exact: true })
      await expect(link).toHaveAttribute('href', item.href)

      const probe = await page.evaluate(async (title) => {
        const a = Array.from(document.querySelectorAll<HTMLAnchorElement>('#benefits a')).find(
          (el) => el.textContent?.trim() === title,
        )
        if (!a) throw new Error(`нет ссылки ${title}`)
        let bursts = 0
        const on = () => {
          bursts += 1
        }
        window.addEventListener('silkway:water-spread', on)
        const t0 = performance.now()
        let hashAt = -1
        window.addEventListener(
          'hashchange',
          () => {
            hashAt = performance.now() - t0
          },
          { once: true },
        )
        a.dispatchEvent(
          new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }),
        )
        a.click()
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
        window.removeEventListener('silkway:water-spread', on)
        return { bursts, hashAt, hash: location.hash }
      }, item.title)

      expect(probe.bursts).toBe(0)
      expect(probe.hash).toBe(item.hash)
      expect(probe.hashAt).toBeGreaterThanOrEqual(0)
      expect(probe.hashAt).toBeLessThan(150)
      await expect(page.locator('[data-testid=water-spread]')).toHaveCount(0)

      if (item.kind === 'product') {
        const product = productBySlug(item.slug)!
        await expect(page.getByRole('heading', { level: 1, name: product.name })).toBeVisible()
      } else {
        await expect(page.getByRole('heading', { level: 1, name: item.heading })).toBeVisible()
      }

      await page.goBack()
      await expect.poll(() => new URL(page.url()).hash).not.toBe(item.hash)
    })
  }

  test('клавиатура: Tab доходит до блоков, focus-visible, Enter открывает маршрут', async ({ page }) => {
    await openHome(page)
    const first = page.locator('#benefits').getByRole('link', { name: 'Водородная ванна', exact: true })
    let focused = false
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab')
      if (await first.evaluate((el) => el === document.activeElement).catch(() => false)) {
        focused = true
        break
      }
    }
    expect(focused).toBe(true)
    const outline = await first.evaluate((el) => getComputedStyle(el).outlineStyle)
    expect(outline).not.toBe('none')
    await page.keyboard.press('Enter')
    await expect.poll(() => new URL(page.url()).hash).toBe('#product/flagship-device')
  })

  test('клик по иконке и свободной области ячейки ведёт на тот же href', async ({ page }) => {
    await openHome(page)
    const link = page.locator('#benefits').getByRole('link', { name: 'Научные факты', exact: true })
    const icon = link.locator('span').first()
    await icon.click()
    await expect.poll(() => new URL(page.url()).hash).toBe('#webinars')
    await page.goto('/')
    await page.evaluate(() => document.fonts.ready)
    const link2 = page.locator('#benefits').getByRole('link', { name: 'Отзывы', exact: true })
    const box = await link2.boundingBox()
    if (!box) throw new Error('нет box')
    // свободная область справа/внизу от иконки, всё ещё внутри ссылки
    await page.mouse.click(box.x + box.width - 8, box.y + box.height / 2)
    await expect.poll(() => new URL(page.url()).hash).toBe('#videos')
  })

  for (const [width, height] of [
    [390, 844],
    [768, 1024],
  ] as const) {
    test(`${width}px: нет горизонтального переполнения, ссылки кликабельны`, async ({ page }) => {
      await openHome(page, width, height)
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }))
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1)
      await expect(page.locator('#benefits').getByRole('link')).toHaveCount(4)
      await page.locator('#benefits').getByRole('link', { name: 'Водородная бутылка', exact: true }).click()
      await expect.poll(() => new URL(page.url()).hash).toBe('#product/silkway-filter')
      await expect(page.getByRole('heading', { level: 1, name: 'Фильтр SILKWAY' })).toBeVisible()
    })
  }
})
