import { expect, test, type Page, type Route } from '@playwright/test'
import { COPY } from '../src/content/copy'
import { formatPv, formatRub } from '../src/data/price'
import type { ProductDescription } from '../src/data/productDescriptions'
import { PRODUCTS, productBySlug, type Product } from '../src/data/products'

const FLAGSHIP = productBySlug('flagship-device')!
const ASTAX = productBySlug('chan-astaxanthin')!
const PROBIOTIC = productBySlug('chan-probiotic')!
const GOODS = productBySlug('era-gel')!

const STUBS = ['Характеристики', 'Комплектация', 'Документы', 'Состав', 'Способ применения', 'Противопоказания'] as const

const GENERATOR_DESCRIPTION: ProductDescription = [
  {
    heading: 'TEST-GEN-SECTION-A',
    paragraphs: ['TEST-GEN-PARAGRAPH-A'],
  },
  {
    level: 'minor',
    number: '01',
    heading: 'TEST-GEN-SECTION-B',
    paragraphs: [{ label: 'TEST-GEN-LABEL', text: 'TEST-GEN-LABEL-TEXT' }],
    list: ['TEST-GEN-LIST-ITEM'],
  },
]

function publicProduct(product: Product, description: ProductDescription | null) {
  return {
    id: product.id,
    name: product.name,
    pack: product.pack,
    price: product.price,
    image: product.image,
    gallery: product.gallery,
    description,
  }
}

async function fulfillProducts(route: Route, products: ReturnType<typeof publicProduct>[]) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ products }),
  })
}

async function openProduct(page: Page, slug: string) {
  await page.goto(`/#product/${slug}`)
  const product = productBySlug(slug)!
  await expect(page.getByRole('heading', { level: 1, name: product.name })).toBeVisible()
  return page.locator('article').filter({ has: page.getByRole('heading', { level: 1, name: product.name }) })
}

function articleOf(page: Page, name: string) {
  return page.locator('article').filter({ has: page.getByRole('heading', { level: 1, name }) })
}

async function expectNoProductMenus(article: ReturnType<typeof articleOf>) {
  await expect(article.locator('button span[aria-hidden="true"]', { hasText: '+' })).toHaveCount(0)
  await expect(article.locator('button span[aria-hidden="true"]', { hasText: '–' })).toHaveCount(0)
  for (const title of STUBS) {
    await expect(article.getByRole('button', { name: title, exact: true })).toHaveCount(0)
  }
  await expect(article.getByText(COPY.deviceNote)).toHaveCount(0)
  await expect(article.getByText(COPY.supplementNote)).toHaveCount(0)
  await expect(article.getByText(COPY.valuePending)).toHaveCount(0)
  await expect(article.getByText(COPY.textPending)).toHaveCount(0)
  await expect(article.getByText(COPY.filePending)).toHaveCount(0)
}

test.describe('описание товара показывается один раз и без меню с плюсиками', () => {
  test('флагман с описанием: факты верны, описание одно, заглушки и плюсики отсутствуют', async ({ page }) => {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport)
      await page.route('**/api/products**', (route) =>
        fulfillProducts(route, [publicProduct(FLAGSHIP, GENERATOR_DESCRIPTION)]),
      )
      const article = await openProduct(page, FLAGSHIP.slug)
      await expect(article.locator('[data-price=rub]').first()).toHaveText(formatRub(FLAGSHIP.price!.rub))
      await expect(article.locator('[data-price=pv]').first()).toHaveText(formatPv(FLAGSHIP.price!.pv))
      await expect(article.getByRole('img', { name: FLAGSHIP.name })).toBeVisible()
      await expect(article.locator('#product-description')).toHaveCount(1)
      await expect(article.getByRole('heading', { level: 2, name: 'Описание' })).toHaveCount(1)
      await expect(article.getByText('TEST-GEN-PARAGRAPH-A')).toHaveCount(1)
      await expect(article.getByText('TEST-GEN-LABEL', { exact: true })).toHaveCount(1)
      await expect(article.getByText('TEST-GEN-LIST-ITEM')).toHaveCount(1)
      await expect(article.getByText('01', { exact: true })).toHaveCount(1)
      await expectNoProductMenus(article)
    }
  })

  test('описание из /api/products?changed=1 применяется один раз и не затрагивает другой товар', async ({ page }) => {
    const updated: ProductDescription = [
      { heading: 'TEST-LIVE-A', paragraphs: ['TEST-LIVE-PARAGRAPH-A'] },
      {
        heading: 'TEST-LIVE-B',
        paragraphs: [{ label: 'TEST-LIVE-LABEL', text: 'TEST-LIVE-TEXT' }],
        list: ['TEST-LIVE-ITEM'],
      },
    ]
    await page.route('**/api/products**', (route) => fulfillProducts(route, [publicProduct(FLAGSHIP, updated)]))
    const article = await openProduct(page, FLAGSHIP.slug)
    await expect(article.getByRole('heading', { name: 'TEST-LIVE-A' })).toHaveCount(1)
    await expect(article.getByRole('heading', { name: 'TEST-LIVE-B' })).toHaveCount(1)
    await expect(article.getByText('TEST-LIVE-PARAGRAPH-A')).toHaveCount(1)
    await expect(article.getByText('TEST-LIVE-LABEL', { exact: true })).toHaveCount(1)
    await expect(article.getByText('TEST-LIVE-ITEM')).toHaveCount(1)
    await expect(article.locator('#product-description')).toHaveCount(1)
    await expectNoProductMenus(article)

    await page.reload()
    const again = articleOf(page, FLAGSHIP.name)
    await expect(again.getByRole('heading', { level: 1, name: FLAGSHIP.name })).toBeVisible()
    await expect(again.getByText('TEST-LIVE-PARAGRAPH-A')).toHaveCount(1)
    await expect(again.locator('#product-description')).toHaveCount(1)
    await expectNoProductMenus(again)

    const other = await openProduct(page, ASTAX.slug)
    await expect(other.getByText('TEST-LIVE-PARAGRAPH-A')).toHaveCount(0)
    await expect(other.getByText('TEST-LIVE-A')).toHaveCount(0)
    await expect(other.getByRole('heading', { name: 'ДОЛГОЛЕТИЕ ВМЕСТЕ С РАСТВОРИМЫМ НАПИТКОМ АСТАКСАНТИН' })).toHaveCount(1)
  })

  test('БАД с описанием: текст один раз, предупреждение есть, плюсиков нет', async ({ page }) => {
    await page.route('**/api/products**', (route) => route.fulfill({ json: { products: [] } }))
    const article = await openProduct(page, ASTAX.slug)
    await expect(article.locator('#product-description')).toHaveCount(1)
    await expect(article.getByRole('heading', { name: 'ДОЛГОЛЕТИЕ ВМЕСТЕ С РАСТВОРИМЫМ НАПИТКОМ АСТАКСАНТИН' })).toHaveCount(1)
    await expect(article.getByText('СУПЕРМОЩНЫЙ АНТИОКСИДАНТ')).toHaveCount(1)
    await expect(article.getByText(COPY.disclaimer)).toHaveCount(1)
    await expect(article.getByText(ASTAX.pack!)).toBeVisible()
    await expectNoProductMenus(article)
  })

  test('товар без описания: пустой блок и заглушки не появляются', async ({ page }) => {
    await page.route('**/api/products**', (route) => route.fulfill({ json: { products: [] } }))
    const article = await openProduct(page, PROBIOTIC.slug)
    await expect(article.locator('#product-description')).toHaveCount(0)
    await expect(article.getByRole('heading', { name: 'Описание', exact: true })).toHaveCount(0)
    await expect(article.locator('[data-price=rub]').first()).toHaveText(formatRub(PROBIOTIC.price!.rub))
    await expect(article.locator('[data-price=pv]').first()).toHaveText(formatPv(PROBIOTIC.price!.pv))
    await expect(article.getByRole('img', { name: PROBIOTIC.name })).toBeVisible()
    await expect(article.getByText(COPY.disclaimer)).toHaveCount(1)
    await expectNoProductMenus(article)
  })

  test('пустой массив описания не рисует заголовок «Описание»', async ({ page }) => {
    await page.route('**/api/products**', (route) => fulfillProducts(route, [publicProduct(FLAGSHIP, [])]))
    const article = await openProduct(page, FLAGSHIP.slug)
    await expect(article.locator('#product-description')).toHaveCount(0)
    await expect(article.getByRole('heading', { name: 'Описание', exact: true })).toHaveCount(0)
    await expectNoProductMenus(article)
  })

  test('у каждого товара каталога нет продуктового меню с плюсиками', async ({ page }) => {
    test.setTimeout(180_000)
    await page.route('**/api/products**', (route) => route.fulfill({ json: { products: [] } }))
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    for (const product of PRODUCTS) {
      const article = await openProduct(page, product.slug)
      await expectNoProductMenus(article)
      if (product.description?.length) {
        await expect(article.locator('#product-description')).toHaveCount(1)
      } else {
        await expect(article.locator('#product-description')).toHaveCount(0)
      }
      if (product.kind === 'supplement') await expect(article.getByText(COPY.disclaimer)).toHaveCount(1)
      else await expect(article.getByText(COPY.disclaimer)).toHaveCount(0)
    }
    const goods = await openProduct(page, GOODS.slug)
    await expect(goods.locator('#product-description')).toHaveCount(0)
    await expectNoProductMenus(goods)
    expect(errors).toEqual([])
  })

  test('FAQ на главной сохраняет аккордеон', async ({ page }) => {
    await page.route('**/api/products**', (route) => route.fulfill({ json: { products: [] } }))
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Частые вопросы' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Как выбрать прибор?' })).toBeVisible()
  })
})
