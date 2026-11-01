import { expect, test } from '@playwright/test'
import { productBySlug } from '../src/data/products'

/** Сайт: секции описания (документ из опубликованного контента) — белые карточки, нумерация по флагу. Только моки. */
const FLAGSHIP = productBySlug('flagship-device')!
const t = (text: string) => ({ type: 'text', text })
const doc = (numbered: boolean) => ({
  type: 'doc',
  ...(numbered ? { numbered: true } : {}),
  content: [
    { type: 'heading', attrs: { level: 3 }, content: [t('TEST-SEC-A')] },
    { type: 'paragraph', content: [t('TEST-PAR-A')] },
    { type: 'heading', attrs: { level: 3 }, content: [t('TEST-SEC-B')] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [t('TEST-ITEM-B')] }] }] },
  ],
})

for (const numbered of [true, false]) {
  test(`секции описания — белые карточки, нумерация ${numbered ? 'включена' : 'выключена'}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.route('**/api/products**', (route) =>
      route.fulfill({
        json: {
          products: [{ id: FLAGSHIP.id, name: FLAGSHIP.name, pack: FLAGSHIP.pack, price: FLAGSHIP.price, image: FLAGSHIP.image, gallery: FLAGSHIP.gallery, description: doc(numbered) }],
        },
      }),
    )
    await page.goto(`/#product/${FLAGSHIP.slug}`)
    const article = page.locator('article').filter({ has: page.getByRole('heading', { level: 1, name: FLAGSHIP.name }) })
    const cards = article.getByTestId('desc-doc-section')
    await expect(cards).toHaveCount(2)
    await expect(cards.nth(0)).toContainText('TEST-PAR-A')
    await expect(cards.nth(1)).toContainText('TEST-ITEM-B')
    const style = await cards.nth(0).evaluate((el) => {
      const cs = getComputedStyle(el)
      return { bg: cs.backgroundColor, radius: parseFloat(cs.borderTopLeftRadius) }
    })
    expect(style.bg).toBe('rgb(255, 255, 255)')
    expect(style.radius).toBeGreaterThan(0)
    if (numbered) await expect(article.getByTestId('desc-doc-number')).toHaveText(['01', '02'])
    else await expect(article.getByTestId('desc-doc-number')).toHaveCount(0)
  })
}
