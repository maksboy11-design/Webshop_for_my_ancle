import { expect, test, type Page } from '@playwright/test'
import { createLogger } from '../server/max/logger'
import { handleAdminPagesRequest } from '../server/max/pagesHttp'
import { createMemoryPagesStore } from '../server/max/pagesStore'
import { signWebAppInitDataForTests } from '../server/max/webAppInitData'

/** Редактор страниц на моках: настоящий обработчик API поверх памяти, без БД и Blob. */
const BRIDGE_URL = 'https://st.max.ru/js/max-web-app.js'
const TOKEN = 'e2e-pages-token'

async function setup(page: Page) {
  const store = createMemoryPagesStore()
  const initData = signWebAppInitDataForTests({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 42 }) }, TOKEN)
  const deps = {
    botToken: TOKEN,
    moderators: new Set(['42']),
    moderatorsConfigured: true,
    now: () => new Date(),
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
  return store
}

const blocks = (page: Page) => page.getByTestId('page-block')

test('редактор: вставка, контекстное меню, ширина/выравнивание, undo/redo, версии, превью', async ({ page }) => {
  const store = await setup(page)
  // «+» вставка
  await page.getByRole('button', { name: '+ Добавить элемент' }).click()
  await page
    .getByTestId('page-menu')
    .getByRole('menuitem', { name: /Заголовок/ })
    .click()
  await expect(blocks(page)).toHaveCount(1)
  await page.getByTestId('page-insert').last().click()
  await page
    .getByTestId('page-menu')
    .getByRole('menuitem', { name: /Кнопка/ })
    .click()
  await expect(blocks(page)).toHaveCount(2)
  await expect(blocks(page).nth(1)).toHaveAttribute('data-type', 'button')

  // контекстное меню по правому клику
  await blocks(page).nth(0).click({ button: 'right' })
  const menu = page.getByTestId('page-menu')
  await expect(menu).toBeVisible()
  await menu.getByRole('menuitem', { name: /Дублировать/ }).click()
  await expect(blocks(page)).toHaveCount(3)
  await page.keyboard.press('Escape')

  // ширина и выравнивание
  await blocks(page).nth(2).click()
  const settings = page.getByTestId('block-settings')
  await settings.getByRole('button', { name: 'Широкая' }).click()
  await settings.getByRole('button', { name: 'По центру' }).click()
  await expect(blocks(page).nth(2)).toHaveAttribute('data-width', 'wide')
  await expect(blocks(page).nth(2)).toHaveAttribute('data-align', 'center')

  // undo / redo
  await page.getByRole('button', { name: 'Отменить' }).click()
  await expect(blocks(page).nth(2)).toHaveAttribute('data-align', 'left')
  await page.getByRole('button', { name: 'Повторить' }).click()
  await expect(blocks(page).nth(2)).toHaveAttribute('data-align', 'center')

  // ручное сохранение → версия
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(page.getByTestId('page-save-status')).toContainText(/Черновик сохранён/)
  expect([...store.pages.values()][0]!.draft.blocks.length).toBe(3)
  await page.getByRole('button', { name: 'Версии', exact: true }).click()
  await expect(page.getByTestId('page-version').first()).toBeVisible()

  // превью с переключением устройств
  await page.getByRole('button', { name: 'Предпросмотр' }).click()
  const preview = page.getByTestId('page-preview')
  await expect(preview).toBeVisible()
  await preview.getByRole('button', { name: 'Телефон' }).click()
  await expect.poll(async () => Math.round((await page.getByTestId('preview-frame').boundingBox())?.width ?? 0)).toBeLessThanOrEqual(392)
  await expect(page.frameLocator('[data-testid="preview-frame"]').getByRole('heading').first()).toBeVisible()
})

test.describe('телефон', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })
  test('двойной тап по кнопке открывает редактирование текста', async ({ page }) => {
    await setup(page)
    await page.getByRole('button', { name: '+ Добавить элемент' }).tap()
    await page
      .getByTestId('page-menu')
      .getByRole('menuitem', { name: /Кнопка/ })
      .tap()
    const btn = blocks(page).first()
    await btn.tap()
    await btn.tap()
    const input = page.getByLabel('Текст кнопки')
    await expect(input).toBeVisible()
    await input.fill('Подробнее')
    await input.press('Enter')
    await expect(btn).toContainText('Подробнее')
    // меню не выходит за экран
    await page.getByRole('button', { name: /Кнопка 1: действия/ }).tap()
    const box = (await page.getByTestId('page-menu').boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
  })
})

test('«Научные факты»: без таблицы страниц показывается исходный контент', async ({ page }) => {
  await page.route('**/api/pages**', (r) => r.fulfill({ status: 503, json: { error: 'pages_unavailable' } }))
  await page.goto('/#science')
  await expect(page.getByTestId('science-article')).toBeVisible()
})

const listDoc = {
  type: 'page', version: 1,
  blocks: [
    {
      id: 't1', type: 'text', width: 'normal', align: 'left', card: false, label: '',
      doc: {
        type: 'doc', version: 1,
        content: [
          { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', attrs: { autoBold: false }, content: [{ type: 'text', text: 'Первый пункт' }] }] }] },
          { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph', attrs: { autoBold: false }, content: [{ type: 'text', text: 'Шаг' }] }] }] },
        ],
      },
    },
    { id: 'b1', type: 'button', width: 'normal', align: 'center', text: 'Дальше', variant: 'primary', target: { kind: 'page', pageId: '11111111-1111-4111-8111-111111111111' } },
  ],
}

for (const vp of [{ name: 'mobile', width: 390, height: 844 }, { name: 'desktop', width: 1280, height: 900 }]) {
  test(`опубликованная страница (${vp.name}): маркеры списков и кнопка видны`, async ({ page }) => {
    await page.setViewportSize(vp)
    await page.route('**/api/pages**', (r) =>
      r.fulfill({
        json: {
          page: { id: 'x', slug: 'test-list', title: 'Тест', doc: listDoc },
          links: { '11111111-1111-4111-8111-111111111111': { slug: 'dalshe', title: 'Дальше' } },
        },
      }),
    )
    await page.goto('/#page/test-list')
    const ul = page.locator('ul', { hasText: 'Первый пункт' })
    await expect(ul).toBeVisible({ timeout: 15_000 })
    expect(await ul.evaluate((e) => getComputedStyle(e).listStyleType)).toBe('disc')
    expect(await ul.evaluate((e) => getComputedStyle(e).listStylePosition)).toBe('outside')
    expect(await page.locator('ol', { hasText: 'Шаг' }).evaluate((e) => getComputedStyle(e).listStyleType)).toBe('decimal')
    const li = ul.locator('li').first()
    expect(await li.evaluate((e) => e.getBoundingClientRect().left > 0)).toBe(true)
    const btn = page.getByRole('link', { name: 'Дальше' })
    await expect(btn).toBeVisible()
    await expect(btn).toHaveAttribute('href', /dalshe/)
  })
}
