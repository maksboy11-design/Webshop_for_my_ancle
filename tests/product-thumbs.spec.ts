import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'

/** Миниатюры галереи: фото обрезаются по кнопке, выбранная рамка видна, нет вертикальной прокрутки. */
const SHOTS = '/workspace/gallery-shots'
const BLOB = 'https://example.public.blob.vercel-storage.com/products'
const wide = fs.readFileSync('public/textures/' + fs.readdirSync('public/textures').find((f) => /\.(jpe?g|png|webp)$/.test(f))!)
const local = { src: '/products/catalog/flagship-device.webp', width: 601, height: 873 }
const maxPhotos = [1, 2, 3].map((n) => ({ src: `${BLOB}/max-${n}.jpg`, width: 1600, height: 900 }))

async function open(page: Page, width: number) {
  await page.route(`${BLOB}/**`, (r) => r.fulfill({ status: 200, contentType: 'image/jpeg', body: wide }))
  await page.route('**/api/products**', (r) =>
    r.fulfill({ json: { products: [{ id: 'flagship', name: 'Флагманский прибор SILKWAY', pack: null, price: { rub: 84000, pv: 1000 }, image: local, gallery: [local, ...maxPhotos], description: null }] } }),
  )
  await page.setViewportSize({ width, height: 900 })
  await page.goto('/#product/flagship-device')
  const thumbs = page.getByRole('button', { name: /^Фото \d+$/ })
  await expect(thumbs).toHaveCount(4, { timeout: 15_000 })
  return thumbs
}

for (const width of [375, 1440]) {
  test(`миниатюры обрезаются по кнопке (${width}px)`, async ({ page }) => {
    const thumbs = await open(page, width)
    await thumbs.nth(1).click()
    await expect(thumbs.nth(1)).toHaveAttribute('aria-current', 'true')
    for (let i = 0; i < 4; i++) {
      const button = thumbs.nth(i)
      const img = button.locator('img')
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true)
      const b = (await button.boundingBox())!
      const m = (await img.boundingBox())!
      expect(m.x).toBeGreaterThanOrEqual(b.x - 0.5)
      expect(m.y).toBeGreaterThanOrEqual(b.y - 0.5)
      expect(m.x + m.width).toBeLessThanOrEqual(b.x + b.width + 0.5)
      expect(m.y + m.height).toBeLessThanOrEqual(b.y + b.height + 0.5)
      expect(await button.evaluate((el) => getComputedStyle(el).overflow)).toBe('hidden')
      expect(await img.evaluate((el) => getComputedStyle(el).objectFit)).toBe('cover')
    }
    const strip = thumbs.first().locator('..')
    const { sh, ch } = await strip.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }))
    expect(sh).toBeLessThanOrEqual(ch)
    expect(await thumbs.nth(1).evaluate((el) => getComputedStyle(el, '::after').boxShadow)).toContain('inset')
    await strip.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOTS}/thumbs-${width}.png` })
  })
}
