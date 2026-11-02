import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { createLogger } from '../server/max/logger'
import { handleAdminPagesRequest } from '../server/max/pagesHttp'
import { createMemoryPagesStore } from '../server/max/pagesStore'
import type { MediaStore } from '../server/max/mediaStore'
import { signWebAppInitDataForTests } from '../server/max/webAppInitData'

/** Видео-блок страниц на моках: API страниц поверх памяти, медиатека — фейк, файл видео отдаёт route. */
const BRIDGE_URL = 'https://st.max.ru/js/max-web-app.js'
const TOKEN = 'e2e-pages-video'
const VID = '11111111-1111-4111-8111-111111111111'
const CLIP = 'https://blob.test/clip.webm'
const clip = readFileSync(new URL('./fixtures/clip.webm', import.meta.url))

const videoItem = {
  id: VID,
  kind: 'video',
  mime: 'video/webm',
  size: clip.length,
  name: 'clip.webm',
  title: null,
  url: CLIP,
  thumb: null,
  variants: {},
  width: 160,
  height: 90,
  status: 'ready',
  error: null,
  sha256: null,
  createdAt: '2026-11-01T12:00:00.000Z',
  deletedAt: null,
}

async function setup(page: Page) {
  const store = createMemoryPagesStore()
  const media = {
    get: async (id: string) =>
      id === VID ? { ...videoItem, blobUrl: CLIP, deletedAt: null, status: 'ready', kind: 'video', mime: 'video/webm' } : null,
  } as unknown as MediaStore
  const initData = signWebAppInitDataForTests({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 42 }) }, TOKEN)
  const deps = {
    botToken: TOKEN,
    moderators: new Set(['42']),
    moderatorsConfigured: true,
    now: () => new Date(),
    pages: store,
    media,
    log: { info() {}, warn() {}, error() {} } as unknown as ReturnType<typeof createLogger>,
  }
  const bridge = `window.WebApp = { initData: ${JSON.stringify(initData)}, initDataUnsafe: {}, platform: 'test', version: '1',
    ready() {}, expand() {}, enableClosingConfirmation() {}, disableClosingConfirmation() {},
    BackButton: { isVisible: false, onClick() {}, offClick() {}, show() {}, hide() {} } };`
  let videoRequests = 0
  await page.route(BRIDGE_URL, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: bridge }))
  await page.route('https://blob.test/**', (r) => {
    videoRequests++
    return r.fulfill({ status: 200, contentType: 'video/webm', body: clip, headers: { 'access-control-allow-origin': '*' } })
  })
  await page.route('**/api/admin/entries**', (r) => r.fulfill({ json: { total: 0, items: [] } }))
  await page.route('**/api/admin/reviews**', (r) => r.fulfill({ json: { total: 0, reviews: [] } }))
  await page.route('**/api/admin/media**', (r) =>
    r.fulfill({ json: r.request().url().includes('kind=video') ? { total: 1, items: [videoItem] } : { total: 0, items: [] } }),
  )
  await page.route('**/api/admin/pages**', async (r) => {
    const req = r.request()
    const body = req.postData()
    const res = await handleAdminPagesRequest(
      new Request(req.url(), { method: req.method(), headers: req.headers(), body: body && req.method() !== 'GET' ? body : undefined }),
      deps,
    )
    await r.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() })
  })
  await page.goto('/admin-reviews.html')
  await page.getByRole('navigation', { name: 'Разделы' }).getByRole('button', { name: 'Страницы' }).click({ timeout: 15_000 })
  await page.getByRole('button', { name: '+ Создать страницу' }).click()
  await expect(page.getByTestId('page-empty')).toBeVisible()
  return { store, videoRequests: () => videoRequests }
}

const blocks = (page: Page) => page.getByTestId('page-block')

async function addVideo(page: Page, viaInsert: boolean) {
  if (viaInsert) await page.getByTestId('page-insert').last().click()
  else await page.getByRole('button', { name: '+ Добавить элемент' }).click()
  await page.getByTestId('page-menu').getByRole('menuitem', { name: 'Видео' }).click()
  // Сразу открывается медиатека с видео.
  const dlg = page.getByRole('dialog')
  await expect(dlg).toBeVisible()
  await dlg.getByText('clip.webm').first().click()
  const choose = dlg.getByRole('button', { name: /Выбрать|Добавить|Готово/ }).last()
  if (await choose.isVisible().catch(() => false)) await choose.click()
}

test('видео-блок: меню и «+», медиатека, настройки, сохранение, один плеер за раз', async ({ page }) => {
  const { store, videoRequests } = await setup(page)
  await addVideo(page, false)
  await expect(blocks(page).first()).toHaveAttribute('data-type', 'video')
  await expect(page.getByTestId('page-video-card')).toHaveCount(1)
  // До запуска — только обложка, файл не запрашивается.
  await expect(page.locator('[data-testid="page-video-card"] video')).toHaveCount(0)
  expect(videoRequests()).toBe(0)

  // Настройки: ширина, пропорции, выравнивание.
  const settings = page.getByTestId('block-settings')
  await settings.getByRole('button', { name: 'Узкая' }).click()
  await settings.getByLabel('Пропорции видео').selectOption('9:16')
  await settings.getByRole('button', { name: 'По центру' }).click()
  await expect(blocks(page).first()).toHaveAttribute('data-width', 'narrow')
  await expect(page.getByTestId('page-video')).toHaveAttribute('data-aspect', '9:16')
  await expect(page.getByTestId('video-poster-tools')).toBeVisible()

  // Второе видео через «+» и дубль через меню.
  await addVideo(page, true)
  await expect(blocks(page)).toHaveCount(2)

  // Сохранение: сервер подставил url из медиатеки, бинарных данных нет.
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(page.getByTestId('page-save-status')).toContainText(/Черновик сохранён/)
  const saved = [...store.pages.values()][0]!.draft.blocks as unknown as Record<string, unknown>[]
  expect(saved.map((b) => [b.type, b.mediaId, b.url])).toEqual([
    ['video', VID, CLIP],
    ['video', VID, CLIP],
  ])
  expect(JSON.stringify(saved)).not.toContain('base64')
  expect(saved[0]!.aspect).toBe('9:16')

  // Запуск второго ставит первый на паузу (общий плеер).
  await blocks(page).nth(0).click()
  await page.getByTestId('page-video-card').nth(0).getByTestId('video-play').click()
  const v1 = page.getByTestId('page-video-card').nth(0).locator('video')
  await expect(v1).toHaveAttribute('preload', 'none')
  await v1.evaluate((v: HTMLVideoElement) => {
    v.muted = true
    return v.play().catch(() => undefined)
  })
  await expect.poll(() => v1.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false)
  await blocks(page).nth(1).click()
  await page.getByTestId('page-video-card').nth(1).getByTestId('video-play').click()
  const v2 = page.getByTestId('page-video-card').nth(1).locator('video')
  await v2.evaluate((v: HTMLVideoElement) => {
    v.muted = true
    return v.play().catch(() => undefined)
  })
  await expect.poll(() => v1.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true)

  // Удаление блока не трогает файл медиатеки (запросов на удаление медиа нет).
  const deletes: string[] = []
  page.on('request', (r) => r.method() === 'DELETE' && r.url().includes('/api/admin/media') && deletes.push(r.url()))
  await blocks(page).nth(1).click({ button: 'right' })
  await page.getByTestId('page-menu').getByRole('menuitem', { name: 'Удалить' }).click()
  await expect(blocks(page)).toHaveCount(1)
  expect(deletes).toEqual([])
})

test('видео-блок: битый файл отклоняется с понятной ошибкой', async ({ page }) => {
  await setup(page)
  await page.getByRole('button', { name: '+ Добавить элемент' }).click()
  await page.getByTestId('page-menu').getByRole('menuitem', { name: 'Видео' }).click()
  await page.keyboard.press('Escape')
  const dlgClose = page.getByRole('dialog').getByRole('button', { name: /Закрыть|Отмена|×/ }).first()
  if (await dlgClose.isVisible().catch(() => false)) await dlgClose.click()
  await blocks(page).first().click()
  const input = page.getByLabel(/перетащите видео сюда.*выбрать файлы/i)
  await input.setInputFiles({ name: 'broken.mp4', mimeType: 'video/mp4', buffer: Buffer.from('not a video at all') })
  await expect(page.getByRole('alert').first()).toContainText(/повреждён|переименован/)
})

test.describe('телефон', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  test('видео на всю ширину без горизонтальной прокрутки', async ({ page }) => {
    await setup(page)
    await addVideo(page, false)
    const card = page.getByTestId('page-video-card')
    await expect(card).toBeVisible()
    const noScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
    expect(noScroll).toBe(true)
    const w = (await card.boundingBox())!.width
    expect(w).toBeGreaterThan(250)
  })
})
