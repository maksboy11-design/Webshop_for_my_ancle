import { expect, test, type Page } from '@playwright/test'

const reviews = [
  {
    id: 'text-only',
    productId: 'flagship',
    author: null,
    text: 'Короткий текстовый отзыв без фотографий.',
  },
  {
    id: 'photos',
    productId: 'astaxanthin',
    author: 'Мария',
    text: 'О'.repeat(430),
    media: [
      { type: 'image', src: '/products/catalog/chan-astaxanthin.webp', alt: 'Первое фото отзыва' },
      { type: 'image', src: '/products/device.png', alt: 'Второе фото отзыва' },
    ],
  },
  {
    id: 'clip',
    productId: 'probiotic',
    author: null,
    text: null,
    media: [{ type: 'video', src: '/clips/review.mp4', poster: '/products/catalog/chan-probiotic.webp', alt: 'Видео отзыва' }],
  },
  {
    id: 'fourth',
    productId: 'reagent',
    author: null,
    text: 'Четвёртый отзыв, который виден после внешней стрелки.',
  },
]

async function openWithReviews(page: Page, path: string, width: number) {
  await page.route('**/api/reviews**', async (route) => {
    const url = new URL(route.request().url())
    const productId = url.searchParams.get('productId')
    const items = productId ? reviews.filter((item) => item.productId === productId) : reviews
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reviews: items }) })
  })
  await page.setViewportSize({ width, height: 900 })
  await page.goto(path)
  await page.evaluate(() => document.fonts.ready)
}

test('раздел отзывов показывает текст, фото и видео из одного источника', async ({ page }) => {
  await openWithReviews(page, '/', 1440)
  const home = page.getByRole('region', { name: 'Отзывы' }).first()
  await expect(home.getByRole('heading', { name: 'Отзывы' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Видео покупателей' })).toHaveCount(0)
  await expect(home.getByText('Короткий текстовый отзыв без фотографий.')).toBeVisible()
  await expect(home.getByRole('group', { name: 'Фото и видео отзыва' })).toHaveCount(2)
  const photos = home.getByRole('article', { name: 'Отзыв о товаре Растворимый напиток астаксантина «Чан Шэн Чжэ»' })
  await expect(photos.getByRole('img', { name: 'Первое фото отзыва' })).toBeVisible()
  await photos.getByRole('button', { name: 'Следующее фото или видео отзыва' }).click()
  await expect(photos.getByRole('img', { name: 'Второе фото отзыва' })).toBeVisible()
  await expect(photos.getByText('Короткий текстовый отзыв без фотографий.')).toHaveCount(0)
  await photos.getByRole('button', { name: 'Читать полностью' }).click()
  await expect(photos.getByText('О'.repeat(430))).toBeVisible()
  const clip = home.getByRole('article', { name: 'Отзыв о товаре Пробиотик «Чан Шэн Чжэ»' })
  const video = clip.locator('video')
  await expect(video).toHaveAttribute('controls', '')
  await expect(video).not.toHaveAttribute('autoplay', '')
  await expect(home.getByRole('button', { name: 'Следующие отзывы' })).toBeEnabled()
  await expect(home.getByRole('button', { name: 'Предыдущие отзывы' })).toBeDisabled()
  await home.getByRole('button', { name: 'Следующие отзывы' }).click()
  await expect(home.getByText('Четвёртый отзыв, который виден после внешней стрелки.')).toBeVisible()
  const box = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }))
  expect(box.scroll).toBeLessThanOrEqual(box.client + 1)
})

test('пустой источник не рисует фиктивные отзывы', async ({ page }) => {
  await page.route('**/api/reviews**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reviews: [] }) })
  })
  await page.setViewportSize({ width: 390, height: 800 })
  await page.goto('/#reviews')
  await expect(page.getByRole('heading', { level: 1, name: 'Отзывы' })).toBeVisible()
  await expect(page.getByText('Опубликованных отзывов пока нет.')).toBeVisible()
  await expect(page.getByText('Видео скоро появится')).toHaveCount(0)
  await expect(page.getByText('Место для видео')).toHaveCount(0)
  expect(new URL(page.url()).hash).toBe('#reviews')
})

test('карточки отзывов не раздвигают страницу на узкой и широкой ширине', async ({ page }) => {
  await page.route('**/api/reviews**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reviews }) })
  })
  for (const width of [320, 360, 390, 414, 600, 768, 840, 1024, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/#videos')
    await page.evaluate(() => document.fonts.ready)
    await expect(page.getByRole('heading', { level: 1, name: 'Отзывы' })).toBeVisible()
    const box = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }))
    expect(box.scroll, `overflow at ${width}`).toBeLessThanOrEqual(box.client + 1)
  }
})
