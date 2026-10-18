import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { BAKED_CARD, BAKED_TEXT, HERO_IMAGE } from '../src/config/heroLayout'

/**
 * e2e-проверки первого экрана HALOS (запускаются на production-сборке: npm run test:e2e).
 * Скриншоты пишутся в .screenshots/ (в .gitignore) или в папку из SHOTS_DIR.
 */
const SHOTS_DIR = process.env.SHOTS_DIR ?? '.screenshots'
mkdirSync(SHOTS_DIR, { recursive: true })

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

async function box(locator: Locator): Promise<Rect> {
  const rect = await locator.boundingBox()
  if (!rect) throw new Error(`нет bounding box: ${locator}`)
  return rect
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/** Прямоугольник из координат исходного изображения → CSS-пиксели страницы. */
function toPage(stage: Rect, r: { x: number; y: number; w: number; h: number }): Rect {
  const s = stage.width / HERO_IMAGE.width
  return { x: stage.x + r.x * s, y: stage.y + r.y * s, width: r.w * s, height: r.h * s }
}

/** Защищённые области: все hotspot-зоны, слои флаконов/стакана, вшитые в фон тексты. */
async function protectedBoxes(page: Page): Promise<Record<string, Rect>> {
  const result: Record<string, Rect> = {}
  const stage = await box(page.locator('[data-testid=stage]'))
  const hotspots = page.locator('[data-hotspot]')
  for (let i = 0; i < (await hotspots.count()); i++) {
    const el = hotspots.nth(i)
    const rect = await el.boundingBox()
    if (rect) result[`hotspot:${await el.getAttribute('data-hotspot')}`] = rect
  }
  for (const id of ['bottle-omega', 'bottle-vitamin', 'bottle-magnesium', 'glass']) {
    result[id] = await box(page.locator(`[data-testid=${id}]`))
  }
  for (const [name, r] of Object.entries(BAKED_TEXT)) result[`baked:${name}`] = toPage(stage, r)
  return result
}

async function openPage(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height })
  await page.goto('/')
  await page.evaluate(() => document.fonts.ready)
  await expect(page.locator('[data-testid=hero-bg]')).toHaveJSProperty('complete', true)
  await page.mouse.move(2, 2)
}

const WIDTHS: Array<[number, number]> = [
  [320, 640],
  [360, 740],
  [390, 844],
  [768, 1024],
  [1024, 768],
  [1440, 900],
  [1920, 1080],
]

test.describe('фон: исходный файл без изменений', () => {
  test('файл фона в public/ и в dist/ совпадает с оригиналом по SHA-256', () => {
    for (const path of ['public/halos-hero-reference.png', 'dist/halos-hero-reference.png']) {
      const hash = createHash('sha256').update(readFileSync(path)).digest('hex')
      expect(hash, path).toBe(HERO_IMAGE.sha256)
    }
  })

  test('пропорции из реального файла, на фоне и его предках нет эффектов', async ({ page }) => {
    await openPage(page, 1440, 900)
    const bg = page.locator('[data-testid=hero-bg]')
    expect(await bg.evaluate((el: HTMLImageElement) => [el.naturalWidth, el.naturalHeight])).toEqual([
      HERO_IMAGE.width,
      HERO_IMAGE.height,
    ])
    const effects = await bg.evaluate((el) => {
      const problems: string[] = []
      for (let node: Element | null = el; node && node !== document.documentElement; node = node.parentElement) {
        const s = getComputedStyle(node)
        const tag = `${node.tagName}.${node.className}`
        if (s.filter !== 'none') problems.push(`${tag}: filter ${s.filter}`)
        if (s.backdropFilter !== 'none' && s.backdropFilter !== '') problems.push(`${tag}: backdrop-filter`)
        if (s.opacity !== '1') problems.push(`${tag}: opacity ${s.opacity}`)
        if (s.mixBlendMode !== 'normal') problems.push(`${tag}: mix-blend-mode`)
        if (node === el) {
          if (s.objectFit !== 'fill') problems.push(`${tag}: object-fit ${s.objectFit}`)
          if (s.maskImage !== 'none' && s.maskImage !== '') problems.push(`${tag}: mask`)
        }
        if (node !== el && s.backgroundImage !== 'none') problems.push(`${tag}: background-image`)
      }
      return problems
    })
    expect(effects).toEqual([])
  })

  for (const [width, height] of [
    [390, 844],
    [1024, 768],
    [1440, 900],
    [1920, 1080],
  ] as const) {
    test(`${width}px: в покое картинка в сцене совпадает с исходным файлом попиксельно (hotspot-слои невидимы)`, async ({
      page,
      baseURL,
    }) => {
      await openPage(page, width, height)
      const stage = page.locator('[data-testid=stage]')
      const stageBox = await box(stage)

      // Все слои сцены, кроме фона, в покое прозрачны
      const visible = await stage.evaluate((root) => {
        const problems: string[] = []
        const img = root.querySelector('img')
        for (const el of root.querySelectorAll<HTMLElement>('*')) {
          if (el === img || el.closest('.visually-hidden')) continue
          let opacity = 1
          for (let n: Element | null = el; n && n !== root; n = n.parentElement) {
            opacity *= parseFloat(getComputedStyle(n).opacity)
          }
          const s = getComputedStyle(el)
          if (opacity === 0 || s.display === 'none' || s.visibility === 'hidden') continue
          const painted =
            (s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent') ||
            s.backgroundImage !== 'none' ||
            s.boxShadow !== 'none' ||
            (s.borderTopWidth !== '0px' && s.borderTopColor !== 'rgba(0, 0, 0, 0)') ||
            s.backdropFilter !== 'none'
          if (painted) problems.push(`${el.tagName}.${el.className}`)
        }
        return problems
      })
      expect(visible).toEqual([])

      const shot = (await stage.screenshot()).toString('base64')
      const ref = await page.context().newPage()
      await ref.setViewportSize({ width: Math.ceil(stageBox.width), height: Math.ceil(stageBox.height) + 4 })
      await ref.setContent(
        `<body style="margin:0"><img id="i" src="${baseURL}${HERO_IMAGE.src}" style="display:block;width:${stageBox.width}px;height:auto"></body>`,
      )
      await ref.waitForFunction(() => (document.getElementById('i') as HTMLImageElement).complete)
      const refShot = (await ref.locator('#i').screenshot()).toString('base64')
      const diff = await ref.evaluate(
        async ([a, b]) => {
          const load = async (b64: string) => {
            const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob()
            const bmp = await createImageBitmap(blob)
            const c = new OffscreenCanvas(bmp.width, bmp.height)
            const ctx = c.getContext('2d')!
            ctx.drawImage(bmp, 0, 0)
            return ctx.getImageData(0, 0, bmp.width, bmp.height)
          }
          const [A, B] = await Promise.all([load(a), load(b)])
          const w = Math.min(A.width, B.width)
          const h = Math.min(A.height, B.height)
          let sum = 0
          let bad = 0
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const i = (y * A.width + x) * 4
              const j = (y * B.width + x) * 4
              const d =
                (Math.abs(A.data[i] - B.data[j]) +
                  Math.abs(A.data[i + 1] - B.data[j + 1]) +
                  Math.abs(A.data[i + 2] - B.data[j + 2])) /
                3
              sum += d
              if (d > 6) bad++
            }
          }
          return { mean: sum / (w * h), badShare: bad / (w * h), sizeA: [A.width, A.height], sizeB: [B.width, B.height] }
        },
        [shot, refShot],
      )
      await ref.close()
      expect(Math.abs(diff.sizeA[0] - diff.sizeB[0])).toBeLessThanOrEqual(1)
      expect(Math.abs(diff.sizeA[1] - diff.sizeB[1])).toBeLessThanOrEqual(1)
      expect(diff.mean).toBeLessThan(0.5)
      expect(diff.badShare).toBeLessThan(0.002)
    })
  }
})

for (const [width, height] of WIDTHS) {
  test.describe(`ширина ${width}px`, () => {
    test('нет горизонтального скролла, пропорции фона, читаемость и размеры интерактивных зон', async ({
      page,
    }) => {
      await openPage(page, width, height)

      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }))
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth)

      // Фон показан целиком и без искажения: пропорции отрисованного изображения = пропорции файла
      const bgBox = await box(page.locator('[data-testid=hero-bg]'))
      expect(Math.abs(bgBox.width / bgBox.height - HERO_IMAGE.width / HERO_IMAGE.height)).toBeLessThan(0.01)
      expect(bgBox.width).toBeGreaterThanOrEqual(Math.min(width, 1920) - 1)

      // Размеры шрифтов видимого живого текста: подписи ≥ 14px, интерактивные и основной текст ≥ 16px
      const tooSmall = await page.evaluate(() => {
        const problems: string[] = []
        const walker = document.createTreeWalker(document.getElementById('root')!, NodeFilter.SHOW_TEXT)
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.textContent?.trim()) continue
          const el = node.parentElement!
          if (el.closest('[hidden], .visually-hidden')) continue
          const style = getComputedStyle(el)
          if (style.display === 'none' || style.visibility === 'hidden') continue
          const r = el.getBoundingClientRect()
          if (r.width <= 2 || r.height <= 2) continue // скрытый визуально дубль вшитого текста
          const px = parseFloat(style.fontSize)
          const interactive = el.closest('a, button, input, label, h1, h2')
          const limit = interactive ? 16 : 14
          if (px < limit) problems.push(`${el.className}: ${px}px < ${limit}px`)
        }
        return problems
      })
      expect(tooSmall).toEqual([])

      // Минимальные интерактивные зоны 44px (все видимые кнопки, ссылки, поля)
      const smallTargets = await page.evaluate(() => {
        const problems: string[] = []
        for (const el of document.querySelectorAll<HTMLElement>('a, button, input')) {
          const r = el.getBoundingClientRect()
          if (r.width === 0 || r.height === 0) continue
          if (r.width <= 2 || r.height <= 2) continue // скрытые визуально
          if (el.closest('.visually-hidden')) continue
          if (r.width < 43.5 || r.height < 43.5) {
            problems.push(`${el.tagName}.${el.className} ${Math.round(r.width)}x${Math.round(r.height)}`)
          }
        }
        return problems
      })
      expect(smallTargets).toEqual([])

      // Живой текст есть в DOM на любой ширине (доступность и индексация), заголовок один
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Вода, которая заботится о вас')
      await expect(page.locator('[data-testid=lead]')).toContainText('Прибор для обогащения воды водородом')

      // Узкие экраны: настоящий HTML под сценой виден; широкие: скрыт визуально
      const copyBox = await box(page.locator('[data-testid=copy]'))
      const stageBox = await box(page.locator('[data-testid=stage]'))
      if (width < 1024) {
        expect(copyBox.y).toBeGreaterThanOrEqual(stageBox.y + stageBox.height - 1)
        expect(copyBox.width).toBeGreaterThan(200)
      } else {
        expect(copyBox.width).toBeLessThanOrEqual(2)
      }

      await page.screenshot({ path: `${SHOTS_DIR}/hero-${width}.png`, fullPage: true })
    })
  })
}

const CARD = '[data-testid=card-slot] > article'

test.describe('overlay-режим: живая карточка поверх вшитой (hover, ≥1280px)', () => {
  const OVERLAY: Array<[number, number]> = [
    [1280, 720],
    [1440, 900],
    [1920, 1080],
  ]

  for (const [width, height] of OVERLAY) {
    test(`${width}px: карточка проявляется без сдвига, накрывает вшитую и не перекрывает защищённое`, async ({
      page,
    }) => {
      await openPage(page, width, height)
      await expect(page.locator('[data-card-mode]')).toHaveAttribute('data-card-mode', 'overlay')

      const card = page.locator(CARD)
      await expect(card).toBeHidden() // в покое видна только вшитая в фон карточка

      await page.evaluate(() => {
        ;(window as unknown as { __cls: number }).__cls = 0
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean }
            if (!shift.hadRecentInput) (window as unknown as { __cls: number }).__cls += shift.value
          }
        }).observe({ type: 'layout-shift', buffered: false })
      })

      const before = await protectedBoxes(page)
      const stageBefore = await box(page.locator('[data-testid=stage]'))
      const pageHeightBefore = await page.evaluate(() => document.documentElement.scrollHeight)

      await page.locator('[data-testid=device]').hover()
      await expect(card).toBeVisible()
      await expect(card).toHaveCSS('opacity', '1')
      await page.waitForTimeout(400)

      const after = await protectedBoxes(page)
      expect(after).toEqual(before) // ни одна зона не сдвинулась и не изменила размер
      expect(await box(page.locator('[data-testid=stage]'))).toEqual(stageBefore)
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(pageHeightBefore)
      expect(await page.evaluate(() => (window as unknown as { __cls: number }).__cls)).toBe(0)

      const cardBox = await box(card)
      for (const [name, rect] of Object.entries(after)) {
        expect(intersects(cardBox, rect), `карточка пересекает ${name}`).toBe(false)
      }

      // Живая карточка полностью накрывает вшитую (нет двоения), и лежит внутри сцены и окна
      const baked = toPage(stageBefore, BAKED_CARD)
      expect(cardBox.x, 'слева').toBeLessThanOrEqual(baked.x + 1)
      expect(cardBox.y, 'сверху').toBeLessThanOrEqual(baked.y + 1)
      expect(cardBox.x + cardBox.width, 'справа').toBeGreaterThanOrEqual(baked.x + baked.width - 1)
      expect(cardBox.y + cardBox.height, 'снизу').toBeGreaterThanOrEqual(baked.y + baked.height - 1)
      expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(stageBefore.x + stageBefore.width)
      expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(stageBefore.y + stageBefore.height)

      // Содержимое карточки не вылезает за её границы (текст и кнопка помещаются в зону)
      const overflow = await card.evaluate((el) => ({
        sh: el.scrollHeight - el.clientHeight,
        sw: el.scrollWidth - el.clientWidth,
      }))
      expect(overflow.sh).toBeLessThanOrEqual(1)
      expect(overflow.sw).toBeLessThanOrEqual(1)
      const button = await box(card.getByRole('button'))
      expect(button.y + button.height).toBeLessThanOrEqual(cardBox.y + cardBox.height + 0.5)

      await page.screenshot({ path: `${SHOTS_DIR}/hero-${width}-card-hover.png`, fullPage: false })
    })
  }

  test('курсор переходит с прибора на карточку — карточка не исчезает; уход курсора закрывает её', async ({
    page,
  }) => {
    await openPage(page, 1440, 900)
    const device = page.locator('[data-testid=device]')
    const card = page.locator(CARD)

    await device.hover()
    await expect(card).toHaveCSS('opacity', '1')

    const from = await box(device)
    const to = await box(card)
    const startX = from.x + from.width * 0.85
    const startY = from.y + from.height * 0.1
    const endX = to.x + to.width / 2
    const endY = to.y + to.height / 2

    // Сэмплер в самой странице (каждый кадр): минимальная opacity карточки за время перехода курсора
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid=card-slot] > article')!
      const w = window as unknown as { __minOpacity: number; __hidden: boolean }
      w.__minOpacity = 1
      w.__hidden = false
      const tick = () => {
        const style = getComputedStyle(el)
        w.__minOpacity = Math.min(w.__minOpacity, parseFloat(style.opacity))
        if (style.visibility === 'hidden') w.__hidden = true
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })

    await page.mouse.move(startX, startY)
    await page.mouse.move(endX, endY, { steps: 40 })
    expect(
      await page.evaluate(() => (window as unknown as { __minOpacity: number }).__minOpacity),
    ).toBeGreaterThan(0.95)
    expect(await page.evaluate(() => (window as unknown as { __hidden: boolean }).__hidden)).toBe(false)
    await page.waitForTimeout(500)
    await expect(card).toHaveCSS('opacity', '1') // курсор на карточке — остаётся

    await page.locator('[data-testid=card-slot] button').hover()
    await expect(card).toHaveCSS('opacity', '1')

    // Уходим в пустую область (поле заголовка) — карточка скрывается
    await page.mouse.move(700, 250, { steps: 5 })
    await expect(card).toBeHidden()
  })

  test('клавиатура: Tab доходит до прибора, фокус показывает карточку, Tab — до кнопки, Escape закрывает', async ({
    page,
  }) => {
    await openPage(page, 1440, 900)
    const card = page.locator(CARD)
    const device = page.locator('[data-testid=device]')

    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab')
      if (await device.evaluate((el) => el === document.activeElement)) break
    }
    await expect(device).toBeFocused()
    await expect(device).toHaveAttribute('aria-expanded', 'true')
    await expect(card).toBeVisible()
    await expect(card).toHaveCSS('opacity', '1')

    await page.keyboard.press('Tab')
    await expect(page.locator('[data-testid=card-slot] button')).toBeFocused()
    await expect(card).toBeVisible() // фокус внутри карточки — остаётся открытой

    await page.keyboard.press('Escape')
    await expect(card).toBeHidden()
    await expect(device).toHaveAttribute('aria-expanded', 'false')
    await expect(card).toHaveAttribute('aria-labelledby', /.+/)
  })

  test('prefers-reduced-motion: переходы карточки сокращены', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openPage(page, 1440, 900)
    const duration = await page
      .locator(CARD)
      .evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration.split(',')[0]))
    expect(duration).toBeLessThan(0.01)
  })
})

test.describe('flow-режим: карточка в потоке под сценой (тач, планшеты, телефоны, <1280px)', () => {
  const FLOW: Array<[number, number]> = [
    [320, 640],
    [390, 844],
    [768, 1024],
    [1024, 768],
    [1200, 800],
  ]

  for (const [width, height] of FLOW) {
    test(`${width}px: тап по прибору открывает карточку под сценой, ничего не перекрывая`, async ({
      browser,
    }) => {
      const context = await browser.newContext({
        viewport: { width, height },
        hasTouch: true,
        isMobile: width < 768,
      })
      const page = await context.newPage()
      await page.goto('/')
      await page.evaluate(() => document.fonts.ready)

      await expect(page.locator('[data-card-mode]')).toHaveAttribute('data-card-mode', 'flow')
      const card = page.locator(CARD)
      await expect(card).toBeHidden()
      const stageBefore = await box(page.locator('[data-testid=stage]'))

      await page.locator('[data-testid=device]').tap()
      await expect(card).toBeVisible()
      await expect(page.locator('[data-testid=device]')).toHaveAttribute('aria-expanded', 'true')

      const cardBox = await box(card)
      const boxes = await protectedBoxes(page)
      for (const [name, rect] of Object.entries(boxes)) {
        expect(intersects(cardBox, rect), `карточка пересекает ${name}`).toBe(false)
      }
      const stageAfter = await box(page.locator('[data-testid=stage]'))
      expect(stageAfter).toEqual(stageBefore) // сцена не двигается
      expect(cardBox.y).toBeGreaterThanOrEqual(stageAfter.y + stageAfter.height - 1)
      expect(cardBox.x).toBeGreaterThanOrEqual(0)
      expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(width)

      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
      ).toBe(true)

      await card.scrollIntoViewIfNeeded()
      await page.screenshot({ path: `${SHOTS_DIR}/hero-${width}-card-open.png`, fullPage: true })

      const toggle = page.locator('button', { hasText: 'Скрыть карточку товара' })
      await toggle.tap()
      await expect(card).toBeHidden()
      await expect(page.locator('button', { hasText: 'Показать карточку товара' })).toBeVisible()

      await page.locator('button', { hasText: 'Показать карточку товара' }).tap()
      await expect(card).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(card).toBeHidden()

      await context.close()
    })
  }
})

test.describe('функциональность', () => {
  test('данные карточки: название, демо-цена 49 990 ₽, ровно шесть слов в описании, кнопка', async ({
    page,
  }) => {
    await openPage(page, 1440, 900)
    const card = page.locator(CARD)
    await page.locator('[data-testid=device]').hover()
    await expect(card).toBeVisible()
    await expect(card.getByRole('heading', { name: 'Прибор для обогащения воды водородом' })).toBeVisible()
    await expect(card).toContainText(/49\s?990\s?₽/)
    await expect(card).toContainText('Демо-цена')
    const description = (await card.locator('p').nth(1).innerText()).trim()
    expect(description).toBe('Компактный прибор для обогащения воды водородом')
    expect(description.split(/\s+/)).toHaveLength(6)
    await expect(card.getByRole('button', { name: /Перейти в карточку/ })).toBeVisible()
  })

  test('кнопка «Перейти в карточку» без адреса страницы: aria-disabled, честное сообщение, без смены высоты', async ({
    page,
  }) => {
    await openPage(page, 1440, 900)
    const card = page.locator(CARD)
    await page.locator('[data-testid=device]').hover()
    const button = card.getByRole('button', { name: /Перейти в карточку/ })
    await expect(button).toHaveAttribute('aria-disabled', 'true')
    await expect(card).toHaveCSS('opacity', '1')
    await page.waitForTimeout(500)
    const before = await box(card)
    await button.click({ force: true }) // aria-disabled: Playwright считает её неактивной, пользователь кликнуть может
    await expect(card.getByRole('status')).toHaveText('Страница товара пока не подключена')
    expect(await box(card)).toEqual(before)
    expect(page.url()).not.toContain('#product')
  })

  test('поиск над вшитой строкой: в покое прозрачный, при вводе собственная заливка, Enter и кнопка работают', async ({
    page,
  }) => {
    await openPage(page, 1440, 900)
    const search = page.getByRole('search')
    const input = search.getByRole('searchbox', { name: 'Поиск продукции' })
    await expect(search).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await input.click()
    await expect(input).toBeFocused()
    await expect(search).toHaveCSS('background-color', 'rgb(255, 255, 255)') // ждём конца перехода

    // Отдельная кнопка «Найти» (над вшитой иконкой): одна, пустая отправка возвращает фокус в поле
    const submit = page.getByRole('button', { name: 'Найти' })
    await expect(submit).toHaveCount(1)
    await submit.click()
    await expect(input).toBeFocused()
    expect(new URL(page.url()).hash).toBe('')

    await input.fill('вода')
    await input.press('Enter')
    await expect.poll(() => new URL(page.url()).hash).toBe(`#catalog?q=${encodeURIComponent('вода')}`)

    await input.fill('минерал')
    await submit.click()
    await expect.poll(() => new URL(page.url()).hash).toBe(`#catalog?q=${encodeURIComponent('минерал')}`)

    await input.focus()
    await page.keyboard.press('Tab')
    await expect(submit).toBeFocused()
  })

  test('навигация и CTA над вшитой шапкой (десктоп)', async ({ page }) => {
    await openPage(page, 1440, 900)
    const nav = page.getByRole('navigation', { name: 'Основная навигация' })
    await expect(nav.getByRole('link')).toHaveText(['Главная', 'Каталог', 'Видео', 'Вебинары', 'О бренде'])
    await expect(nav.getByRole('link', { name: 'Главная' })).toHaveAttribute('aria-current', 'page')
    await nav.getByRole('link', { name: 'Каталог' }).click()
    expect(new URL(page.url()).hash).toBe('#catalog')

    await page.getByRole('link', { name: 'Узнать больше' }).click()
    expect(new URL(page.url()).hash).toBe('#about')

    await expect(page.getByRole('link', { name: 'Профиль' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Корзина' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'HALOS — на главную' })).toBeVisible()
    await expect(page.getByRole('button', { name: /меню/ })).toBeHidden()

    // Hover по hotspot даёт обратную связь, в покое слой прозрачен
    const catalog = page.locator('[data-hotspot=nav-catalog]')
    await catalog.hover()
    await expect(catalog).toHaveCSS('cursor', 'pointer')
    const cta = page.locator('[data-hotspot=cta]')
    await cta.hover()
    expect(await cta.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe('none')
  })

  test('мобильная шапка и меню-бургер: открывается кнопкой/клавиатурой, Escape закрывает, ссылки работают', async ({
    page,
  }) => {
    await openPage(page, 390, 844)
    const burger = page.getByRole('button', { name: 'Открыть меню' })
    const nav = page.getByRole('navigation', { name: 'Основная навигация' })
    await expect(nav).toBeHidden()
    await burger.focus()
    await page.keyboard.press('Enter')
    await expect(nav).toBeVisible()
    await expect(page.getByRole('button', { name: 'Закрыть меню' })).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Escape')
    await expect(nav).toBeHidden()
    await expect(burger).toBeFocused()

    await burger.click()
    await nav.getByRole('link', { name: 'Видео' }).click()
    expect(new URL(page.url()).hash).toBe('#videos')
    await expect(nav).toBeHidden()

    const logo = await box(page.getByRole('link', { name: /HALOS/ }))
    expect(logo.width).toBeGreaterThanOrEqual(120)

    // CTA в живом HTML под сценой
    await page.getByRole('link', { name: 'Узнать больше' }).click()
    expect(new URL(page.url()).hash).toBe('#about')
  })

  test('шапка: на 768 живая в одну строку с бургером, на 1024 заменена hotspot-зонами над вшитой', async ({
    page,
  }) => {
    await openPage(page, 768, 1024)
    const logo = await box(page.getByRole('link', { name: /HALOS/ }))
    const search = await box(page.getByRole('search'))
    expect(Math.abs(logo.y + logo.height / 2 - (search.y + search.height / 2))).toBeLessThan(8)
    await expect(page.getByRole('button', { name: 'Открыть меню' })).toBeVisible()
    await expect(page.locator('[data-hotspot=device]')).toBeVisible() // hotspot прибора есть на любой ширине
    await expect(page.locator('[data-hotspot=logo]')).toBeHidden()

    await openPage(page, 1024, 768)
    await expect(page.getByRole('button', { name: 'Открыть меню' })).toBeHidden()
    await expect(page.locator('[data-hotspot=logo]')).toBeVisible()
    await expect(page.locator('header')).toBeHidden()
  })

  test('hotspot-зоны стоят на вшитых элементах: центр зоны над логотипом, CTA и прибором реагирует на hover', async ({
    page,
  }) => {
    await openPage(page, 1440, 900)
    const stage = await box(page.locator('[data-testid=stage]'))
    const cta = await box(page.locator('[data-hotspot=cta]'))
    const s = stage.width / HERO_IMAGE.width
    // Вшитая кнопка: x 80–334, y 528–586 (в координатах изображения)
    expect(Math.abs(cta.x - (stage.x + 80 * s))).toBeLessThan(3)
    expect(Math.abs(cta.y - (stage.y + 528 * s))).toBeLessThan(3)
    const device = await box(page.locator('[data-testid=device]'))
    expect(device.x).toBeGreaterThan(stage.x + 800 * s)
    expect(device.x + device.width).toBeLessThan(stage.x + 1130 * s)
  })

  test('фокус виден: у hotspot CTA, у прибора и у поля поиска есть контур', async ({ page }) => {
    await openPage(page, 1440, 900)
    const cta = page.getByRole('link', { name: 'Узнать больше' })
    await cta.focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    expect(await cta.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid')
    const searchBox = page.getByRole('search')
    await searchBox.getByRole('searchbox').focus()
    expect(await searchBox.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid')
    const device = page.locator('[data-testid=device]')
    await device.focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    expect(await device.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid')
  })
})
