import { expect, test, type Page } from '@playwright/test'

const webinars = [
  {
    id: 'w-1',
    title: 'Как выбрать шёлк',
    speaker: 'Анна Петрова',
    date: '2026-11-05',
    sourceType: 'youtube',
    youtubeVideoId: 'dQw4w9WgXcQ',
    startSeconds: 45,
    recordingSrc: null,
    secretField: 'не должно попасть на страницу',
  },
  { id: 'bad', title: 'Чужой хост', sourceType: 'hosted', recordingSrc: 'https://evil.example/a.mp4' },
]

async function open(page: Page, body: unknown, width = 1440, status = 200) {
  await page.route('**/api/webinars**', (route) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }))
  // Не ходим во внешнюю сеть: отдаём пустую страницу вместо плеера YouTube.
  await page.route('https://www.youtube-nocookie.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' }))
  await page.setViewportSize({ width, height: 900 })
  await page.goto('/#webinars')
}

test('пустой список и ошибка API показывают пустое состояние', async ({ page }) => {
  await open(page, { webinars: [] })
  await expect(page.getByRole('heading', { level: 1, name: 'Вебинары' })).toBeVisible()
  await expect(page.getByTestId('webinars-empty')).toContainText('Записей пока нет')
  await expect(page.getByTestId('webinar-card')).toHaveCount(0)
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await open(page, { error: 'unavailable' }, 1440, 503)
  await page.reload()
  await expect(page.getByTestId('webinars-empty')).toContainText('Записей пока нет')
})

test('опубликованный вебинар встраивается через youtube-nocookie без автозапуска', async ({ page }) => {
  await open(page, { webinars })
  const cards = page.getByTestId('webinar-card')
  await expect(cards).toHaveCount(1)
  const card = cards.first()
  await expect(card.getByRole('heading', { name: 'Как выбрать шёлк' })).toBeVisible()
  await expect(card).toContainText('05.11.2026 · Спикер: Анна Петрова')
  await expect(page.getByText('не должно попасть на страницу')).toHaveCount(0)
  const frame = card.locator('iframe')
  await expect(frame).toHaveAttribute('title', 'Вебинар: Как выбрать шёлк')
  await expect(frame).toHaveAttribute('loading', 'lazy')
  await expect(frame).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin')
  const src = (await frame.getAttribute('src')) ?? ''
  expect(src.startsWith('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?')).toBe(true)
  expect(src).toContain('start=45')
  expect(src).not.toContain('autoplay')
  expect((await frame.getAttribute('allow')) ?? '').not.toContain('autoplay')
  await frame.scrollIntoViewIfNeeded()
  const box = await frame.boundingBox()
  expect(box && Math.abs(box.width / box.height - 16 / 9) < 0.02).toBe(true)
  const link = card.getByRole('link', { name: 'Смотреть на YouTube' })
  await expect(link).toHaveAttribute('href', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=45s')
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
})

test('на 390 px карточка вебинара не даёт горизонтального скролла', async ({ page }) => {
  await open(page, { webinars }, 390)
  await expect(page.getByTestId('webinar-card')).toHaveCount(1)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})
