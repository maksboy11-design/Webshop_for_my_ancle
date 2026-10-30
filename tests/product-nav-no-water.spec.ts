import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { productBySlug, PRODUCTS } from '../src/data/products'
import { productHref } from '../src/config/hashRoute'

const ASTAX = productBySlug('chan-astaxanthin')!
const FLAGSHIP = productBySlug('flagship-device')!
const PROBIOTIC = productBySlug('chan-probiotic')!
const SOSSYUREYA = productBySlug('chan-sossyureya')!

async function assertNoWaterSpread(page: Page) {
  await expect(page.locator('[data-water-spread]')).toHaveCount(0)
  await expect(page.locator('[data-testid=water-spread]')).toHaveCount(0)
  const bursts = await page.evaluate(() => {
    let n = 0
    const on = () => {
      n += 1
    }
    window.addEventListener('silkway:water-spread', on)
    // probe: any leftover listeners would fire only on pointerdown of marked nodes
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
    window.removeEventListener('silkway:water-spread', on)
    return n
  })
  expect(bursts).toBe(0)
}

async function clickAndExpectProduct(page: Page, slug: string, how: 'image' | 'title' | 'link') {
  const href = productHref(slug)
  const product = productBySlug(slug)!
  const card = page.locator(`article a[href="${href}"]`).first()
  await expect(card).toBeVisible()

  const started = await page.evaluate(async ({ href: h, how: mode }) => {
    const link = document.querySelector<HTMLAnchorElement>(`a[href="${h}"]`)
    if (!link) throw new Error(`нет ссылки ${h}`)
    let bursts = 0
    const onSpread = () => {
      bursts += 1
    }
    window.addEventListener('silkway:water-spread', onSpread)
    const t0 = performance.now()
    let hashAt = -1
    window.addEventListener(
      'hashchange',
      () => {
        hashAt = performance.now() - t0
      },
      { once: true },
    )
    const target =
      mode === 'image'
        ? link.querySelector('img') ?? link
        : mode === 'title'
          ? link.querySelector('h2, h3') ?? link
          : link
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }))
    if (target instanceof HTMLElement) target.click()
    else link.click()
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    window.removeEventListener('silkway:water-spread', onSpread)
    return { hashAt, bursts, hash: location.hash }
  }, { href, how })

  expect(started.bursts, 'событие растекания не должно срабатывать').toBe(0)
  expect(started.hash).toBe(href)
  expect(started.hashAt, 'hash должен смениться сразу').toBeGreaterThanOrEqual(0)
  expect(started.hashAt).toBeLessThan(100)
  await expect(page).toHaveURL(new RegExp(`product/${slug}`))
  await expect(page.getByRole('heading', { level: 1, name: product.name })).toBeVisible()
  await expect(page.locator('[data-testid=water-spread]')).toHaveCount(0)
}

test.describe('карточка товара: прямой переход без растекания воды', () => {
  for (const [width, height] of [
    [390, 844],
    [768, 1024],
  ] as const) {
    test.describe(`${width}px`, () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width, height })
        await page.goto('/#catalog')
        await expect(page.getByRole('heading', { level: 1, name: 'Каталог' })).toBeVisible()
      })

      test('A: нажатие на изображение открывает товар', async ({ page }) => {
        await clickAndExpectProduct(page, ASTAX.slug, 'image')
      })

      test('B: нажатие на название открывает товар', async ({ page }) => {
        await clickAndExpectProduct(page, ASTAX.slug, 'title')
      })

      test('C: нажатие на область ссылки карточки открывает товар', async ({ page }) => {
        await clickAndExpectProduct(page, ASTAX.slug, 'link')
      })

      test('D: нет canvas растекания и data-water-spread', async ({ page }) => {
        await assertNoWaterSpread(page)
        const href = productHref(ASTAX.slug)
        await page.locator(`a[href="${href}"]`).first().click()
        await expect(page.getByRole('heading', { level: 1, name: ASTAX.name })).toBeVisible()
        await assertNoWaterSpread(page)
      })
    })
  }

  test('E: водородный генератор в Hero ведёт на #product/flagship-device', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    const device = page.locator('[data-testid=device]')
    await expect(device).toBeVisible()
    await device.hover()
    const card = page.locator('[data-testid=card-slot]')
    await expect(card).toBeVisible()
    const cta = card.getByRole('link', { name: /Перейти в карточку/ })
    await expect(cta).toHaveAttribute('href', productHref(FLAGSHIP.slug))
    await cta.click()
    await expect(page).toHaveURL(/product\/flagship-device/)
    await expect(page.getByRole('heading', { level: 1, name: FLAGSHIP.name })).toBeVisible()
    await expect(page.locator('[data-testid=water-spread]')).toHaveCount(0)
  })

  test('F: разные товары открывают свои страницы', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 })
    for (const product of [FLAGSHIP, ASTAX, SOSSYUREYA, PROBIOTIC]) {
      await page.goto('/#catalog')
      await expect(page.getByRole('heading', { level: 1, name: 'Каталог' })).toBeVisible()
      await clickAndExpectProduct(page, product.slug, 'link')
    }
  })

  test('H: статические водные фоны на месте, интерактивное растекание отключено', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    await expect(page.locator('[data-testid=water-spread]')).toHaveCount(0)
    const tile = await page.evaluate(() => {
      const main = document.querySelector('main')
      if (!main) return null
      const cs = getComputedStyle(main)
      return cs.getPropertyValue('--water-tile').trim()
    })
    expect(tile).toMatch(/water-tile/)
    await expect(page.locator('[data-testid=water-surface]')).toHaveCount(1)
    // каталог тоже без WaterSpread
    await page.goto('/#catalog')
    await expect(page.locator('[data-testid=water-spread]')).toHaveCount(0)
    const catalogTile = await page.evaluate(() =>
      getComputedStyle(document.querySelector('main')!).getPropertyValue('--water-tile').trim(),
    )
    expect(catalogTile).toMatch(/water-tile/)
    // sanity: каталог содержит реальные товары
    expect(PRODUCTS.length).toBeGreaterThan(5)
  })
})
