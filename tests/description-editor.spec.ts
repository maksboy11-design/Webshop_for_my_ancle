import { expect, test, type Page } from '@playwright/test'

/** WYSIWYG-редактор описания (t124u) на моках API, viewport 375. Production не трогается. */
const BRIDGE_URL = 'https://st.max.ru/js/max-web-app.js'
const PIXEL = Buffer.from('UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=', 'base64')
const bridge = `window.WebApp = { initData: 'signed', initDataUnsafe: {}, platform: 'test', version: '1',
  ready() {}, expand() {}, enableClosingConfirmation() {}, disableClosingConfirmation() {},
  BackButton: { isVisible: false, onClick() {}, offClick() {}, show() {}, hide() {} } };`
const img = { src: '/products/device.png', width: 601, height: 873 }
const SHOTS = '/workspace/editor-shots'

type Opts = { description?: unknown; failPatch?: boolean }

async function setup(page: Page, opts: Opts = {}) {
  const base = { id: 'flagship', name: 'Флагманский прибор SILKWAY', pack: null, price: { rub: 84000, pv: 1000 }, image: img, gallery: [], description: opts.description ?? null }
  const listItem = (over: Record<string, unknown> = {}) => ({
    id: 'flagship', slug: 'flagship-device', brand: 'SILKWAY', category: 'devices', name: base.name, pack: null,
    price: base.price, image: img, overridden: [], updatedAt: null, ...over,
  })
  const patches: Record<string, unknown>[] = []
  /** Черновики описания (PUT ?content=1) и публикации (POST ?publish=1) — сайт меняется только публикацией. */
  const drafts: Record<string, unknown>[] = []
  const publishes: number[] = []
  let view = { productId: 'flagship', draftDoc: null as unknown, hasDraft: false, publishedDoc: null as unknown, hasPublished: false, status: null as string | null, draftRev: 0, publishedRev: null as number | null, updatedAt: null, publishedAt: null as string | null }
  let saved: Record<string, unknown> = {}
  const ctl = { failPatch: !!opts.failPatch }
  await page.route(BRIDGE_URL, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: bridge }))
  await page.route('**/api/admin/reviews**', (r) => r.fulfill({ json: { total: 0, reviews: [] } }))
  await page.route('**/api/admin/webinars**', (r) => r.fulfill({ json: { total: 0, webinars: [] } }))
  await page.route('**/products/device.png', (r) => r.fulfill({ status: 200, contentType: 'image/webp', body: PIXEL }))
  await page.route('**/api/admin/products**', async (r) => {
    const req = r.request()
    const url = new URL(req.url())
    if (!url.searchParams.get('id')) return r.fulfill({ json: { editable: true, total: 1, products: [listItem({ overridden: Object.keys(saved) })] } })
    if (url.searchParams.get('content') === '1' || url.searchParams.get('publish') === '1') {
      if (req.method() === 'PUT') {
        if (ctl.failPatch) return r.fulfill({ status: 503, json: { error: 'unavailable' } })
        const body = req.postDataJSON() as { doc: Record<string, unknown>; rev: number }
        if (body.rev !== view.draftRev) return r.fulfill({ status: 409, json: { error: 'conflict', content: view } })
        drafts.push(body.doc)
        view = { ...view, draftDoc: body.doc, hasDraft: true, draftRev: view.draftRev + 1, status: 'draft' }
      } else if (req.method() === 'POST') {
        const body = req.postDataJSON() as { rev: number }
        if (body.rev !== view.draftRev) return r.fulfill({ status: 409, json: { error: 'conflict', content: view } })
        publishes.push(body.rev)
        view = { ...view, publishedDoc: view.draftDoc, hasPublished: true, publishedRev: view.draftRev, status: 'published', publishedAt: '2026-11-01T12:00:00.000Z' }
      }
      return r.fulfill({ json: { content: view } })
    }
    if (req.method() === 'PATCH') {
      if (ctl.failPatch) return r.fulfill({ status: 503, json: { error: 'unavailable' } })
      const set = (req.postDataJSON() as { set: Record<string, unknown> }).set ?? {}
      patches.push(set)
      saved = { ...saved, ...set }
    }
    const merged = { ...base, ...saved }
    return r.fulfill({ json: { editable: true, product: { ...listItem({ ...saved, overridden: Object.keys(saved) }), merged, base } } })
  })
  await page.setViewportSize({ width: 375, height: 740 })
  await page.goto('/admin-reviews.html')
  await page.getByRole('navigation', { name: 'Разделы' }).getByRole('button', { name: 'Товары' }).click({ timeout: 15_000 })
  await page.getByText('Флагманский прибор SILKWAY').first().click()
  const editor = page.getByRole('textbox', { name: 'Описание товара' })
  await expect(editor).toBeVisible()
  return { patches, drafts, publishes, editor, ctl, saved: () => saved }
}

const tb = (page: Page, name: string) => page.getByRole('toolbar', { name: 'Форматирование описания' }).getByRole('button', { name, exact: true })

async function paste(page: Page, text: string) {
  await page.evaluate((t) => {
    const dt = new DataTransfer()
    dt.setData('text/plain', t)
    dt.setData('text/html', '<b style="color:red">мусор</b><script>window.__x=1</script>')
    document.querySelector('[aria-label="Описание товара"]')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, text)
}

test.describe('Редактор описания (WYSIWYG)', () => {
  test('автожирный, списки, нумерация, идемпотентность, отмена/повтор, автосохранение', async ({ page }) => {
    const { patches, drafts, editor } = await setup(page)
    await editor.click()
    await page.keyboard.type('Первый абзац')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Второй абзац')
    // 1–2: каждый новый абзац верхнего уровня жирный
    await expect(editor.locator('p > strong')).toHaveCount(2)
    await expect(tb(page, 'Жирный')).toHaveAttribute('aria-pressed', 'true')

    // 3: строки → «Автосписок» по выделению
    await page.keyboard.press('Enter')
    await page.keyboard.type('строка А')
    await page.keyboard.press('Enter')
    await page.keyboard.type('строка Б')
    await page.keyboard.press('Shift+ArrowUp')
    await page.keyboard.press('Shift+Home')
    await tb(page, 'Автосписок').click()
    await expect(editor.locator('ul > li')).toHaveCount(2)
    await expect(editor.locator('li strong')).toHaveCount(0) // пункты — обычный шрифт
    await expect(tb(page, 'Автосписок')).toHaveAttribute('aria-pressed', 'true')
    // 4–5: нумерация и повторное применение без дублей/вложенности
    await tb(page, 'Нумерация').click()
    await expect(editor.locator('ol > li')).toHaveCount(2)
    await expect(editor.locator('ul')).toHaveCount(0)
    await expect(editor.locator('ol ol, ol ul')).toHaveCount(0)
    await expect(editor.locator('ol')).not.toContainText('1.')
    // 6: отменить/повторить
    await tb(page, 'Отменить').click()
    await expect(editor.locator('ul > li')).toHaveCount(2)
    await tb(page, 'Повторить').click()
    await expect(editor.locator('ol > li')).toHaveCount(2)
    // повторное нажатие «Нумерация» снимает список
    await tb(page, 'Нумерация').click()
    await expect(editor.locator('ol')).toHaveCount(0)
    await page.keyboard.press('Control+z')
    await expect(editor.locator('ol > li')).toHaveCount(2)

    // 7: без выделения — «Автосписок» к текущему блоку
    await editor.locator('ol > li').last().click()
    await page.keyboard.press('End')
    await page.waitForTimeout(100) // ProseMirror читает DOM-выделение после selectionchange
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter') // пустой пункт → выход из списка
    await page.keyboard.type('Отдельная строка')
    await expect(editor.locator('p > strong', { hasText: 'Отдельная строка' })).toHaveCount(1)
    await tb(page, 'Автосписок').click()
    await expect(editor.locator('ul > li')).toHaveCount(1)
    await expect(editor.locator('ol > li')).toHaveCount(2)

    // 8: автосохранение со статусом
    await expect(page.getByTestId('desc-autosave')).toHaveText('Сохранено', { timeout: 10_000 })
    expect(drafts.length).toBeGreaterThan(0)
    expect(patches.length).toBe(0) // описание идёт в черновик, живые правки не трогаются
    const last = drafts.at(-1)! as { type: string; content: { type: string }[] }
    expect(last.type).toBe('doc')
    expect(last.content.map((b) => b.type)).toEqual(['paragraph', 'paragraph', 'orderedList', 'bulletList'])
    await page.screenshot({ path: `${SHOTS}/edit-375.png`, fullPage: false })

    // 9: предпросмотр = вид сайта
    await page.getByRole('tab', { name: 'Предпросмотр' }).click()
    const preview = page.getByTestId('desc-preview')
    await expect(preview.locator('strong', { hasText: 'Первый абзац' })).toBeVisible()
    await expect(preview.locator('ol li')).toHaveCount(2)
    await expect(preview.locator('ul li')).toHaveCount(1)
    await preview.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOTS}/preview-375.png`, fullPage: false })
    await page.getByRole('tab', { name: 'Редактирование' }).click()
    // история сохраняется после переключения режимов
    await expect(tb(page, 'Отменить')).toBeEnabled()

    // 10: сайт показывает тот же документ безопасно
    const description = last
    await page.route('**/api/products**', (route) =>
      route.fulfill({ json: { products: [{ id: 'flagship', name: 'Флагманский прибор SILKWAY', pack: null, price: { rub: 84000, pv: 1000 }, image: img, gallery: [img], description }] } }),
    )
    await page.goto('/#product/flagship-device')
    const article = page.locator('article').filter({ has: page.getByRole('heading', { level: 1, name: 'Флагманский прибор SILKWAY' }) })
    await expect(article.locator('#product-description')).toHaveCount(1)
    await expect(article.locator('section[aria-labelledby="product-description"] strong', { hasText: 'Первый абзац' })).toHaveCount(1)
    await expect(article.locator('section[aria-labelledby="product-description"] ol li')).toHaveCount(2)
    await article.locator('section[aria-labelledby="product-description"]').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOTS}/site-375.png`, fullPage: false })
  })

  test('B/I, снятие автожирного, вставка многострочного текста без HTML', async ({ page }) => {
    const { editor } = await setup(page)
    await editor.click()
    await page.keyboard.type('Абзац')
    await page.keyboard.press('Shift+Home')
    await tb(page, 'Жирный').click()
    await expect(editor.locator('strong')).toHaveCount(0)
    await expect(tb(page, 'Жирный')).toHaveAttribute('aria-pressed', 'false')
    await tb(page, 'Курсив').click()
    await expect(editor.locator('em')).toHaveText('Абзац')
    await expect(tb(page, 'Курсив')).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('End')
    await page.waitForTimeout(100) // ProseMirror читает DOM-выделение после selectionchange
    await page.keyboard.press('Enter')
    await paste(page, 'Заголовок вставки\n\n- раз\n- два\n1. три\n2. четыре\nКонец')
    await expect(editor.locator('ul > li')).toHaveCount(2)
    await expect(editor.locator('ol > li')).toHaveCount(2)
    await expect(editor.locator('p > strong', { hasText: 'Заголовок вставки' })).toHaveCount(1)
    await expect(editor.locator('[style], script')).toHaveCount(0)
    expect(await page.evaluate(() => (window as unknown as { __x?: number }).__x)).toBeUndefined()
    await expect(editor).not.toContainText('мусор')
    // одна отмена откатывает всю вставку
    await page.keyboard.press('Control+z')
    await expect(editor.locator('ul, ol')).toHaveCount(0)
    await page.keyboard.press('Control+y')
    await expect(editor.locator('ul > li')).toHaveCount(2)
  })

  test('счётчик, лимит без обрезания, черновик и ошибка автосохранения', async ({ page }) => {
    const { editor, ctl, drafts: patches } = await setup(page, { failPatch: true })
    await editor.click()
    await page.keyboard.type('Тест')
    await expect(page.getByTestId('desc-counter')).toContainText('4 / 20000')
    await expect(page.getByTestId('desc-autosave')).toContainText('Ошибка автосохранения', { timeout: 10_000 })
    // черновик на устройстве
    await page.waitForFunction(() => Object.keys(localStorage).some((k) => k.startsWith('silkway-admin:desc-draft:')))
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('signed')
    await page.reload()
    await page.getByRole('navigation', { name: 'Разделы' }).getByRole('button', { name: 'Товары' }).click()
    await page.getByText('Флагманский прибор SILKWAY').first().click()
    await expect(page.getByTestId('desc-draft')).toBeVisible()
    ctl.failPatch = false
    await page.getByRole('button', { name: 'Восстановить' }).click()
    await expect(editor).toContainText('Тест')
    await expect(page.getByTestId('desc-autosave')).toHaveText('Сохранено', { timeout: 10_000 })
    expect(patches.length).toBe(1)

    // длинный текст: предупреждение и запрет сохранения, текст не обрезан
    const long = Array.from({ length: 4 }, () => 'я'.repeat(5000)).join('\n') + '\nхвост'
    await page.keyboard.press('Control+End')
    await page.keyboard.press('Enter')
    await paste(page, long)
    await expect(page.getByTestId('desc-counter')).toContainText('превышено')
    await expect(page.getByTestId('desc-autosave')).toHaveText('Не сохраняется: превышен лимит')
    await expect(editor).toContainText('хвост')
    await expect(page.getByTestId('desc-publish')).toBeDisabled()
    expect(patches.length).toBe(1)
  })

  test('старое описание открывается и без правок не сохраняется', async ({ page }) => {
    const legacy = [{ heading: 'Состав', paragraphs: ['Обычный текст', { label: 'Важно:', text: 'пить воду' }], list: ['пункт'] }]
    const { editor, patches, drafts } = await setup(page, { description: legacy })
    await expect(editor.locator('h3, h4')).toContainText('Состав')
    await expect(editor.locator('p', { hasText: 'Обычный текст' }).locator('strong')).toHaveCount(0)
    await expect(editor.locator('ul > li')).toHaveText('пункт')
    await page.waitForTimeout(2500)
    expect(patches.length).toBe(0)
    expect(drafts.length).toBe(0)
    await expect(page.getByRole('button', { name: 'Сохранить' })).toBeDisabled()
  })

  test('заголовок секции, панель секций, нумерация и явная публикация', async ({ page }) => {
    const { editor, drafts, publishes, patches } = await setup(page)
    await editor.click()
    await page.keyboard.type('Вступление')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Состав')
    await tb(page, 'Заголовок секции').click()
    await expect(editor.locator('h3')).toHaveText('Состав')
    await expect(tb(page, 'Заголовок секции')).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Вода и травы')
    await page.keyboard.press('Enter')
    // выделение части абзаца → отдельный заголовок
    await page.keyboard.type('Применение утром')
    await page.keyboard.down('Shift')
    for (let i = 0; i < 'Применение утром'.length; i++) await page.keyboard.press('ArrowLeft')
    await page.keyboard.up('Shift')
    await page.waitForTimeout(100)
    await tb(page, 'Заголовок секции').click()
    await expect(editor.locator('h3')).toHaveCount(2)
    const rows = page.getByTestId('desc-section-row')
    await expect(rows).toHaveCount(2)
    // перемещение и отмена одним шагом
    await rows.nth(1).getByRole('button', { name: 'Секцию выше' }).click()
    await expect(editor.locator('h3').first()).toHaveText('Применение утром')
    await tb(page, 'Отменить').click()
    await expect(editor.locator('h3').first()).toHaveText('Состав')
    // дублирование/удаление
    await rows.nth(0).getByRole('button', { name: 'Дублировать секцию' }).click()
    await expect(editor.locator('h3')).toHaveCount(3)
    page.once('dialog', (d) => void d.accept())
    await page.getByTestId('desc-section-row').nth(1).getByRole('button', { name: 'Удалить секцию' }).click()
    await expect(editor.locator('h3')).toHaveCount(2)
    // свернуть — только вид в редакторе
    await rows.nth(0).getByRole('button', { name: 'Свернуть секцию' }).click()
    await expect(editor.locator('p', { hasText: 'Вода и травы' })).toBeHidden()
    await rows.nth(0).getByRole('button', { name: 'Развернуть секцию' }).click()
    await expect(editor.locator('p', { hasText: 'Вода и травы' })).toBeVisible()

    await page.getByTestId('desc-numbered').check()
    await expect(page.getByTestId('desc-autosave')).toHaveText('Сохранено', { timeout: 10_000 })
    const doc = drafts.at(-1)! as { numbered?: boolean; content: { type: string }[] }
    expect(doc.numbered).toBe(true)
    expect(doc.content.map((b) => b.type)).toEqual(['paragraph', 'heading', 'paragraph', 'heading'])
    expect(publishes.length).toBe(0)
    expect(patches.length).toBe(0)
    await expect(page.getByTestId('desc-publish-status')).toContainText('не опубликован')

    await page.getByRole('tab', { name: 'Предпросмотр' }).click()
    await expect(page.getByTestId('desc-preview').getByTestId('desc-doc-number')).toHaveText(['01', '02'])
    await page.getByRole('tab', { name: 'Редактирование' }).click()

    page.once('dialog', (d) => void d.accept())
    await page.getByTestId('desc-publish').click()
    await expect(page.getByTestId('desc-publish-status')).toContainText('Опубликовано')
    expect(publishes).toEqual([drafts.length])
    await expect(page.getByTestId('desc-publish')).toBeDisabled()
  })
})
