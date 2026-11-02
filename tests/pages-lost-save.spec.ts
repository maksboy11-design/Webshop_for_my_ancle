import { expect, test, type Page } from '@playwright/test'
import { createLogger } from '../server/max/logger'
import { handleAdminPagesRequest } from '../server/max/pagesHttp'
import { createMemoryPagesStore } from '../server/max/pagesStore'
import { signWebAppInitDataForTests } from '../server/max/webAppInitData'

/** Потеря правок: перезагрузка посреди автосохранения и истёкшая сессия MAX (401). */
const BRIDGE_URL = 'https://st.max.ru/js/max-web-app.js'
const TOKEN = 'e2e-pages-token'

async function setup(page: Page, authAgeSec = 0) {
  const store = createMemoryPagesStore()
  const clock = { shift: 0 }
  const puts: number[] = []
  const initData = signWebAppInitDataForTests(
    { auth_date: String(Math.floor(Date.now() / 1000) - authAgeSec), user: JSON.stringify({ id: 42 }) },
    TOKEN,
  )
  const deps = {
    botToken: TOKEN,
    moderators: new Set(['42']),
    moderatorsConfigured: true,
    now: () => new Date(Date.now() + clock.shift),
    pages: store,
    media: null,
    log: { info() {}, warn() {}, error() {} } as unknown as ReturnType<typeof createLogger>,
  }
  const bridge = `window.WebApp = { initData: ${JSON.stringify(initData)}, initDataUnsafe: {}, platform: 'test', version: '1',
    ready() {}, expand() {}, enableClosingConfirmation() {}, disableClosingConfirmation() {},
    BackButton: { isVisible: false, onClick() {}, offClick() {}, show() {}, hide() {} } };`
  await page.route(BRIDGE_URL, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: bridge }))
  await page.route('**/api/admin/entries**', (r) => r.fulfill({ json: { total: 0, items: [] } }))
  await page.route('**/api/admin/reviews**', (r) => r.fulfill({ json: { total: 0, reviews: [] } }))
  await page.route('**/api/admin/media**', (r) => r.fulfill({ json: { total: 0, items: [] } }))
  await page.route('**/api/admin/pages**', async (r) => {
    const req = r.request()
    if (req.method() === 'PUT') puts.push(Date.now())
    const body = req.postData()
    const res = await handleAdminPagesRequest(
      new Request(req.url(), { method: req.method(), headers: req.headers(), body: body && req.method() !== 'GET' ? body : undefined }),
      deps,
    )
    await r.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() })
  })
  const open = async () => {
    await page.goto('/admin-reviews.html')
    await page.getByRole('navigation', { name: 'Разделы' }).getByRole('button', { name: 'Страницы' }).click({ timeout: 15_000 })
  }
  await open()
  await page.getByRole('button', { name: '+ Создать страницу' }).click()
  await expect(page.getByTestId('page-empty')).toBeVisible()
  const reopen = async () => {
    await open()
    await page.getByTestId('page-row').first().getByRole('button', { name: 'Изменить' }).click()
    await expect(page.getByTestId('page-save-status')).toBeVisible()
  }
  return { store, clock, puts, reopen }
}

const addHeading = async (page: Page) => {
  await page.getByRole('button', { name: '+ Добавить элемент' }).click()
  await page.getByTestId('page-menu').getByRole('menuitem', { name: /Заголовок/ }).click()
  await expect(page.getByTestId('page-block')).toHaveCount(1)
}

test('перезагрузка посреди паузы автосохранения: правка не теряется', async ({ page }) => {
  const { store, reopen } = await setup(page)
  await addHeading(page)
  await expect(page.getByTestId('page-save-status')).toHaveText(/^Не сохранено/)
  // перезагрузка раньше 2 с автосохранения (как при деплое/обновлении webview)
  page.on('dialog', (d) => void d.accept())
  await reopen()
  const onServer = [...store.pages.values()][0]!.draft.blocks.length === 1
  if (!onServer) {
    // если keepalive не успел — правка обязана быть в локальной копии
    await expect(page.getByTestId('page-backup')).toBeVisible()
    await page.getByTestId('page-backup').getByRole('button', { name: 'Восстановить' }).click()
  }
  await expect(page.getByTestId('page-block')).toHaveCount(1)
})

test('сессия: работает дольше initData; после 12 ч — без шквала 401, правки восстанавливаются после переоткрытия', async ({ page }) => {
  const { store, clock, puts, reopen } = await setup(page, 3300)
  // initData MAX протух (>1 ч), но админ-сессия продлевает работу: правка сохраняется
  clock.shift = 30 * 60_000
  await addHeading(page)
  await expect(page.getByTestId('page-save-status')).toHaveText(/^Сохранено/, { timeout: 10_000 })
  expect([...store.pages.values()][0]!.draft.blocks.length).toBe(1)
  clock.shift = 13 * 3600_000 // предел 12 ч пройден — сессия истекла
  await page.getByTestId('page-insert').last().click()
  await page.getByTestId('page-menu').getByRole('menuitem', { name: /Заголовок/ }).click()
  await expect(page.getByTestId('page-auth-lost')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('page-save-status')).toHaveText(/^Не сохранено/)
  const n = puts.length
  await page.waitForTimeout(5_000)
  expect(puts.length).toBe(n) // повторов нет
  expect([...store.pages.values()][0]!.draft.blocks.length).toBe(1)

  // переоткрыли админку со свежей сессией
  clock.shift = 0
  page.on('dialog', (d) => void d.accept())
  await reopen()
  await expect(page.getByTestId('page-block')).toHaveCount(1)
  await expect(page.getByTestId('page-backup')).toBeVisible()
  // даже правка до решения не стирает спасённую копию
  await page.reload()
  await page.getByRole('navigation', { name: 'Разделы' }).getByRole('button', { name: 'Страницы' }).click({ timeout: 15_000 })
  await page.getByTestId('page-row').first().getByRole('button', { name: 'Изменить' }).click()
  await page.getByTestId('page-backup').getByRole('button', { name: 'Восстановить' }).click()
  await expect(page.getByTestId('page-block')).toHaveCount(2)
  await expect(page.getByTestId('page-save-status')).toHaveText(/^Сохранено/, { timeout: 10_000 })
  expect([...store.pages.values()][0]!.draft.blocks.length).toBe(2)
})
