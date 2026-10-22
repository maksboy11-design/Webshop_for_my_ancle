import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { HERO_IMAGE } from '../src/config/heroLayout'

/**
 * e2e первого экрана HALOS (production-сборка: npm run test:e2e).
 * Скриншоты — в .screenshots/ или в папку из SHOTS_DIR.
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

function overlaps(a: Rect, b: Rect): boolean {
  const pad = 2
  return (
    a.x + pad < b.x + b.width &&
    b.x + pad < a.x + a.width &&
    a.y + pad < b.y + b.height &&
    b.y + pad < a.y + a.height
  )
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

const PRODUCT_LAYERS = ['bottle-magnesium', 'bottle-vitamin', 'bottle-omega', 'glass', 'capsules'] as const

test.describe('фон: исходный файл природы без изменений', () => {
  test('файл фона в public/ и в dist/ совпадает с оригиналом по SHA-256', () => {
    for (const path of ['public/hero-nature.jpg', 'dist/hero-nature.jpg']) {
      const hash = createHash('sha256').update(readFileSync(path)).digest('hex')
      expect(hash, path).toBe(HERO_IMAGE.sha256)
    }
  })

  test('пропорции из реального файла, на фоне и его предках нет эффектов', async ({ page }) => {
    await openPage(page, 1440, 900)
    const bg = page.locator('[data-testid=hero-bg]')
    await expect(bg).toHaveAttribute('src', HERO_IMAGE.src)
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
          if (s.objectFit !== 'fill' && s.objectFit !== 'cover') problems.push(`${tag}: object-fit ${s.objectFit}`)
          if (s.maskImage !== 'none' && s.maskImage !== '') problems.push(`${tag}: mask`)
        }
        if (node !== el && s.backgroundImage !== 'none') problems.push(`${tag}: background-image`)
      }
      return problems
    })
    expect(effects).toEqual([])

    const bgBox = await box(bg)
    expect(Math.abs(bgBox.width / bgBox.height - HERO_IMAGE.width / HERO_IMAGE.height)).toBeLessThan(0.01)
  })
})

for (const [width, height] of WIDTHS) {
  test.describe(`ширина ${width}px`, () => {
    test('нет горизонтального скролла, читаемость, слои продукции и размеры зон', async ({ page }) => {
      await openPage(page, width, height)

      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }))
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1)

      const bg = page.locator('[data-testid=hero-bg]')
      const bgBox = await box(bg)
      if (width >= 1024) {
        expect(Math.abs(bgBox.width / bgBox.height - HERO_IMAGE.width / HERO_IMAGE.height)).toBeLessThan(0.01)
      } else {
        await expect(bg).toHaveCSS('object-fit', 'cover')
      }

      const stage = await box(page.locator('[data-testid=stage]'))
      const device = await box(page.locator('[data-testid=device]'))
      if (width >= 1024) expect(device.x).toBeGreaterThan(stage.x + stage.width * 0.45)
      expect(device.x + device.width).toBeLessThanOrEqual(stage.x + stage.width + 1)
      expect(device.y + device.height).toBeLessThanOrEqual(stage.y + stage.height + 1)
      expect(device.width).toBeGreaterThanOrEqual(44)
      expect(device.height).toBeGreaterThanOrEqual(44)

      for (const id of PRODUCT_LAYERS) {
        const layer = page.locator(`[data-testid=${id}]`)
        await expect(layer).toBeVisible()
        const img = layer.locator('img')
        await expect(img).toHaveAttribute('src', /\/products\//)
        const rect = await box(layer)
        expect(rect.x).toBeGreaterThanOrEqual(stage.x - 1)
        expect(rect.x + rect.width).toBeLessThanOrEqual(stage.x + stage.width + 1)
      }
      await expect(page.locator('[data-testid=device] img')).toHaveAttribute('src', /\/products\/device\.png/)

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
          if (r.width <= 2 || r.height <= 2) continue
          const px = parseFloat(style.fontSize)
          const interactive = el.closest('a, button, input, label, h1, h2')
          const limit = interactive ? 16 : 14
          if (px < limit) problems.push(`${el.className}: ${px}px < ${limit}px`)
        }
        return problems
      })
      expect(tooSmall).toEqual([])

      const smallTargets = await page.evaluate(() => {
        const problems: string[] = []
        for (const el of document.querySelectorAll<HTMLElement>('a, button, input')) {
          const r = el.getBoundingClientRect()
          if (r.width === 0 || r.height === 0) continue
          if (r.width <= 2 || r.height <= 2) continue
          if (el.closest('.visually-hidden')) continue
          if (r.width < 43.5 || r.height < 43.5) {
            problems.push(`${el.tagName}.${el.className} ${Math.round(r.width)}x${Math.round(r.height)}`)
          }
        }
        return problems
      })
      expect(smallTargets).toEqual([])

      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ваше здоровье- наш приоритет')
      await expect(page.locator('[data-testid=lead]')).toHaveText(
        'Инновационные решения для дома и здорового образа жизни',
      )
      await expect(page.locator('header')).toBeVisible()

      const copyBox = await box(page.locator('[data-testid=copy]'))
      if (width < 1024) {
        expect(copyBox.y).toBeGreaterThanOrEqual(stage.y + stage.height - 1)
        expect(copyBox.width).toBeGreaterThan(200)
      } else {
        expect(copyBox.y).toBeGreaterThanOrEqual(stage.y)
        expect(copyBox.y + copyBox.height).toBeLessThanOrEqual(stage.y + stage.height + 1)
        expect(overlaps(copyBox, device)).toBe(false)
      }

      await page.screenshot({ path: `${SHOTS_DIR}/hero-${width}.png`, fullPage: true })
    })
  })
}

const CARD = '[data-testid=card-slot] > article'

async function guardedBoxes(page: Page): Promise<Record<string, Rect>> {
  const result: Record<string, Rect> = {
    copy: await box(page.locator('[data-testid=copy]')),
    device: await box(page.locator('[data-testid=device]')),
    benefits: await box(page.locator('#benefits')),
    header: await box(page.locator('header')),
  }
  for (const id of PRODUCT_LAYERS) {
    result[id] = await box(page.locator(`[data-testid=${id}]`))
  }
  return result
}

test.describe('overlay-режим: живая карточка у прибора (hover, ≥1280px)', () => {
  const OVERLAY: Array<[number, number]> = [
    [1280, 800],
    [1440, 900],
    [1920, 1080],
  ]

  for (const [width, height] of OVERLAY) {
    test(`${width}px: карточка проявляется без сдвига и не перекрывает текст и продукцию`, async ({ page }) => {
      await openPage(page, width, height)
      await expect(page.locator('[data-card-mode]')).toHaveAttribute('data-card-mode', 'overlay')

      const card = page.locator(CARD)
      await expect(card).toBeHidden()

      await page.evaluate(() => {
        ;(window as unknown as { __cls: number }).__cls = 0
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean }
            if (!shift.hadRecentInput) (window as unknown as { __cls: number }).__cls += shift.value
          }
        }).observe({ type: 'layout-shift', buffered: false })
      })

      await page.locator('[data-testid=device]').scrollIntoViewIfNeeded()
      const before = await guardedBoxes(page)
      const stageBefore = await box(page.locator('[data-testid=stage]'))
      const pageHeightBefore = await page.evaluate(() => document.documentElement.scrollHeight)

      await page.locator('[data-testid=device]').hover()
      await expect(card).toBeVisible()
      await expect(card).toHaveCSS('opacity', '1')
      await page.waitForTimeout(400)

      const after = await guardedBoxes(page)
      expect(after).toEqual(before)
      expect(await box(page.locator('[data-testid=stage]'))).toEqual(stageBefore)
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(pageHeightBefore)
      expect(await page.evaluate(() => (window as unknown as { __cls: number }).__cls)).toBe(0)

      const cardBox = await box(card)
      for (const [name, rect] of Object.entries(after)) {
        expect(overlaps(cardBox, rect), `карточка пересекает ${name}`).toBe(false)
      }
      expect(cardBox.x).toBeGreaterThanOrEqual(stageBefore.x)
      expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(stageBefore.x + stageBefore.width + 1)
      expect(cardBox.y).toBeGreaterThanOrEqual(stageBefore.y)

      const overflow = await card.evaluate((el) => ({
        sh: el.scrollHeight - el.clientHeight,
        sw: el.scrollWidth - el.clientWidth,
      }))
      expect(overflow.sh).toBeLessThanOrEqual(1)
      expect(overflow.sw).toBeLessThanOrEqual(1)

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

    await page.mouse.move(from.x + from.width * 0.2, from.y + 8)
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 40 })
    expect(await page.evaluate(() => (window as unknown as { __minOpacity: number }).__minOpacity)).toBeGreaterThan(
      0.95,
    )
    expect(await page.evaluate(() => (window as unknown as { __hidden: boolean }).__hidden)).toBe(false)
    await page.waitForTimeout(500)
    await expect(card).toHaveCSS('opacity', '1')

    await page.locator('[data-testid=card-slot] button').hover()
    await expect(card).toHaveCSS('opacity', '1')

    await page.getByRole('heading', { level: 1 }).hover()
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
    await expect(card).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(card).toBeHidden()
    await expect(device).toHaveAttribute('aria-expanded', 'false')
  })

  test('prefers-reduced-motion: переходы карточки сокращены, пульс прибора выключен', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openPage(page, 1440, 900)
    const duration = await page
      .locator(CARD)
      .evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration.split(',')[0]))
    expect(duration).toBeLessThan(0.01)
    await expect(page.locator('[data-testid=device-glow]')).toHaveCSS('animation-name', 'none')
  })
})

test.describe('сигнал интерактивности прибора', () => {
  test('яркость слоя прибора плавно поднимается до 1.1 раз в 8 секунд', async ({ page }) => {
    await openPage(page, 1440, 900)
    const glow = page.locator('[data-testid=device-glow]')
    const timing = await glow.evaluate((el) => {
      const style = getComputedStyle(el)
      return { name: style.animationName, duration: style.animationDuration }
    })
    expect(timing.name).not.toBe('none')
    expect(timing.duration).toBe('8s')

    const frames = await page.evaluate(() => {
      const chunks: string[] = []
      for (const sheet of document.styleSheets) {
        let rules: CSSRuleList
        try {
          rules = sheet.cssRules
        } catch {
          continue
        }
        for (const rule of rules) {
          if (rule instanceof CSSKeyframesRule && rule.name.includes('device-signal')) chunks.push(rule.cssText)
        }
      }
      return chunks.join('\n')
    })
    expect(frames).toContain('brightness(1.1)')
    expect(frames).not.toContain('scale(')

    const bgFilter = await page.locator('[data-testid=hero-bg]').evaluate((el) => getComputedStyle(el).filter)
    expect(bgFilter).toBe('none')
    const bottleFilter = await page
      .locator('[data-testid=bottle-magnesium]')
      .evaluate((el) => getComputedStyle(el).animationName)
    expect(bottleFilter).toBe('none')
  })
})

test.describe('flow-режим: карточка в потоке под сценой', () => {
  const FLOW: Array<[number, number]> = [
    [320, 640],
    [390, 844],
    [768, 1024],
    [1024, 768],
    [1200, 800],
  ]

  for (const [width, height] of FLOW) {
    test(`${width}px: тап по прибору открывает карточку под сценой`, async ({ browser }) => {
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
      const stageAfter = await box(page.locator('[data-testid=stage]'))
      expect(stageAfter).toEqual(stageBefore)
      expect(cardBox.y).toBeGreaterThanOrEqual(stageAfter.y + stageAfter.height - 1)
      expect(cardBox.x).toBeGreaterThanOrEqual(0)
      expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(width + 1)
      expect(overlaps(cardBox, await box(page.locator('[data-testid=copy]')))).toBe(false)

      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
      ).toBe(true)

      await card.scrollIntoViewIfNeeded()
      await page.screenshot({ path: `${SHOTS_DIR}/hero-${width}-card-open.png`, fullPage: true })

      const toggle = page.locator('button', { hasText: 'Скрыть карточку товара' })
      await toggle.tap()
      await expect(card).toBeHidden()
      await page.locator('button', { hasText: 'Показать карточку товара' }).tap()
      await expect(card).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(card).toBeHidden()

      await context.close()
    })
  }
})

test.describe('функциональность', () => {
  test('данные карточки: название, демо-цена 49 990 ₽, ровно шесть слов, кнопка', async ({ page }) => {
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

  test('кнопка «Перейти в карточку» без адреса: aria-disabled и честное сообщение', async ({ page }) => {
    await openPage(page, 1440, 900)
    const card = page.locator(CARD)
    await page.locator('[data-testid=device]').hover()
    const button = card.getByRole('button', { name: /Перейти в карточку/ })
    await expect(button).toHaveAttribute('aria-disabled', 'true')
    const before = await box(card)
    await button.click({ force: true })
    await expect(card.getByRole('status')).toHaveText('Страница товара пока не подключена')
    const after = await box(card)
    expect(Math.abs(after.width - before.width)).toBeLessThan(1)
    expect(Math.abs(after.height - before.height)).toBeLessThan(1)
    expect(page.url()).not.toContain('#product')
  })

  test('поиск в шапке: одна кнопка «Найти», Enter и клик ведут в каталог', async ({ page }) => {
    await openPage(page, 1440, 900)
    const search = page.getByRole('search')
    await expect(search).toHaveCount(1)
    const input = search.getByRole('searchbox', { name: 'Поиск продукции' })
    const bg = await search.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(bg).not.toBe('rgba(0, 0, 0, 0)')

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
  })

  test('навигация, CTA и иконки шапки на десктопе', async ({ page }) => {
    await openPage(page, 1440, 900)
    const nav = page.getByRole('navigation', { name: 'Основная навигация' })
    await expect(nav.getByRole('link')).toHaveText(['Главная', 'Каталог', 'Видео', 'Вебинары', 'О бренде'])
    await expect(nav.getByRole('link', { name: 'Главная' })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('link', { name: 'Профиль' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Корзина' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'HALOS — на главную' })).toBeVisible()
    await expect(page.getByRole('button', { name: /меню/ })).toBeHidden()
    await expect(page.locator('[data-hotspot=logo]')).toHaveCount(0)
    await expect(page.locator('[data-testid=device]')).toHaveCSS('cursor', 'pointer')

    await nav.getByRole('link', { name: 'Каталог' }).click()
    expect(new URL(page.url()).hash).toBe('#catalog')
    await page.goto('/')
    await page.getByRole('link', { name: 'Узнать больше' }).click()
    expect(new URL(page.url()).hash).toBe('#about')
  })

  test('мобильная шапка и меню-бургер', async ({ page }) => {
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

    const logo = await box(page.getByRole('link', { name: 'HALOS — на главную' }))
    expect(logo.width).toBeGreaterThanOrEqual(120)
    await page.getByRole('link', { name: 'Узнать больше' }).click()
    expect(new URL(page.url()).hash).toBe('#about')

    await page.goto('/')
    await page.getByRole('button', { name: 'Открыть меню' }).click()
    await page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: 'Видео' }).click()
    expect(new URL(page.url()).hash).toBe('#videos')
    await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeHidden()
  })

  test('шапка: на 768 бургер, на 1024 строка навигации', async ({ page }) => {
    await openPage(page, 768, 1024)
    const logo = await box(page.getByRole('link', { name: 'HALOS — на главную' }))
    const search = await box(page.getByRole('search'))
    expect(Math.abs(logo.y + logo.height / 2 - (search.y + search.height / 2))).toBeLessThan(8)
    await expect(page.getByRole('button', { name: 'Открыть меню' })).toBeVisible()
    await expect(page.locator('[data-testid=device]')).toBeVisible()

    await openPage(page, 1024, 768)
    await expect(page.getByRole('button', { name: /меню/ })).toBeHidden()
    await expect(page.locator('header')).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible()
    await expect(
      page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link', { name: 'Каталог', exact: true }),
    ).toBeVisible()
  })

  test('фокус виден у CTA, поиска и прибора', async ({ page }) => {
    await openPage(page, 1440, 900)
    const cta = page.getByRole('link', { name: 'Узнать больше' })
    await cta.focus()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Shift+Tab')
    await expect(cta).toBeFocused()
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
