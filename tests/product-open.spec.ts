import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { RIPPLE_ARTISTIC } from '../src/components/Hero/water/waterParams'
import { productBySlug } from '../src/data/products'

const ASTAX = productBySlug('chan-astaxanthin')!
const HREF = `#product/${ASTAX.slug}`

async function spread(page: Page) {
  return page.locator('[data-testid=water-spread]').evaluate((el) => ({
    spread: el.getAttribute('data-spread'),
    opacity: Number(getComputedStyle(el).opacity),
    pointerEvents: getComputedStyle(el).pointerEvents,
  }))
}

test.describe('открытие товара не перекрывается водой', () => {
  test('вспышка воды короче 500 мс и не становится непрозрачной', () => {
    expect(RIPPLE_ARTISTIC.floodVisualMs).toBeLessThanOrEqual(450)
    expect(RIPPLE_ARTISTIC.floodVisualMs).toBeGreaterThanOrEqual(300)
    expect(RIPPLE_ARTISTIC.floodPeakOpacity).toBeLessThan(0.5)
  })

  for (const [width, height] of [
    [390, 844],
    [768, 1024],
    [1024, 768],
    [1200, 800],
    [1440, 900],
  ] as const) {
    test(`${width}px: карточка каталога открывает страницу товара сразу`, async ({ page }) => {
      await page.setViewportSize({ width, height })
      await page.goto('/#catalog')
      await expect(page.getByRole('heading', { level: 1, name: 'Каталог' })).toBeVisible()

      const elapsed = await page.evaluate(async (href) => {
        const link = document.querySelector<HTMLAnchorElement>(`a[href="${href}"]`)
        if (!link) throw new Error(`нет ссылки ${href}`)
        const started = performance.now()
        let hashAt = started
        window.addEventListener('hashchange', () => {
          hashAt = performance.now()
        }, { once: true })
        const appeared = new Promise<number>((resolve) => {
          const ready = () => document.querySelector('h1')?.textContent?.includes('астаксантина')
          const finish = () => resolve(performance.now() - started)
          if (ready()) {
            finish()
            return
          }
          const obs = new MutationObserver(() => {
            if (!ready()) return
            obs.disconnect()
            finish()
          })
          obs.observe(document.getElementById('root') ?? document.body, { childList: true, subtree: true, characterData: true })
        })
        link.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 24, clientY: 24 }))
        link.click()
        const elapsed = await appeared
        return { elapsed, hash: hashAt - started }
      }, HREF)

      expect(elapsed.hash, 'маршрут не должен ждать воду').toBeLessThan(100)
      await expect(page).toHaveURL(new RegExp(`product/${ASTAX.slug}`))
      const title = page.getByRole('heading', { level: 1, name: ASTAX.name })
      await expect(title).toBeVisible()
      const price = page.locator('article').filter({ has: page.getByRole('heading', { level: 1, name: ASTAX.name }) }).locator('[data-testid=price]').first()
      await expect(price.locator('[data-price=rub]')).toContainText('5')
      await expect(price.locator('[data-price=pv]')).toContainText('70')
      await expect(page.getByText(ASTAX.pack!)).toBeVisible()

      const veil = await spread(page)
      expect(veil.pointerEvents).toBe('none')
      expect(veil.opacity).toBeLessThan(0.5)
      await expect.poll(async () => (await spread(page)).spread, { timeout: 1000 }).toBe('idle')
      expect((await spread(page)).opacity).toBe(0)
      await expect(title).toBeVisible()
    })
  }

  test('повторное нажатие не запускает вторую вспышку', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/#catalog')
    await expect(page.locator(`a[href="${HREF}"]`).first()).toBeVisible()
    const count = await page.evaluate(async (href) => {
      let bursts = 0
      window.addEventListener('silkway:water-spread', () => {
        bursts += 1
      })
      const link = document.querySelector<HTMLAnchorElement>(`a[href="${href}"]`)
      if (!link) throw new Error('нет ссылки')
      const down = () =>
        link.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 30, clientY: 40 }))
      down()
      down()
      link.click()
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      return bursts
    }, HREF)
    expect(count).toBeLessThanOrEqual(1)
    await expect(page.getByRole('heading', { level: 1, name: ASTAX.name })).toBeVisible()
  })

  test('назад возвращает в каталог', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/#catalog')
    await page.locator(`a[href="${HREF}"]`).first().click()
    await expect(page.getByRole('heading', { level: 1, name: ASTAX.name })).toBeVisible()
    await page.goBack()
    await expect(page.getByRole('heading', { level: 1, name: 'Каталог' })).toBeVisible()
  })

  test('1440px: карточка прибора в Hero открывается не позднее 500 мс', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    const device = page.locator('[data-testid=device]')
    await expect(device).toBeVisible()
    const elapsed = await page.evaluate(async () => {
      const button = document.querySelector<HTMLButtonElement>('[data-testid=device]')
      if (!button) throw new Error('нет прибора')
      const started = performance.now()
      button.click()
      const deadline = started + 500
      while (performance.now() < deadline) {
        const card = document.querySelector('[data-testid=card-slot]')
        const article = card?.querySelector('article')
        const opacity = article ? Number(getComputedStyle(article).opacity) : 0
        const title = article?.querySelector('h2')
        if (card?.getAttribute('data-open') === 'true' && opacity > 0.99 && title?.textContent?.includes('водородом')) {
          return performance.now() - started
        }
        await new Promise((resolve) => requestAnimationFrame(resolve))
      }
      return performance.now() - started
    })
    const card = page.locator('[data-testid=card-slot]')
    await expect(card).toBeVisible()
    await expect(card.getByRole('heading', { name: 'Прибор для обогащения воды водородом' })).toBeVisible()
    await expect(card.locator('[data-price=rub]')).toBeVisible()
    await expect(card.locator('[data-price=pv]')).toBeVisible()
    expect(elapsed).toBeLessThan(500)
    expect((await spread(page)).opacity).toBeLessThan(0.5)
  })
})

test.describe('страница товара не ждёт /api/products', () => {
  test('задержка API на 2 с: сначала статика, затем обновление названия', async ({ page }) => {
    const updated = `${ASTAX.name} (правка)`
    await page.route('**/api/products?changed=1', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2000))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          products: [
            {
              id: ASTAX.id,
              name: updated,
              pack: ASTAX.pack,
              price: ASTAX.price,
              image: ASTAX.image,
              gallery: ASTAX.gallery,
              description: ASTAX.description,
            },
          ],
        }),
      })
    })
    const started = Date.now()
    await page.goto(`/${HREF}`)
    await expect(page.getByRole('heading', { level: 1, name: ASTAX.name })).toBeVisible()
    expect(Date.now() - started).toBeLessThan(1500)
    await expect(page.getByRole('heading', { level: 1, name: updated })).toBeVisible({ timeout: 8000 })
    await expect(page.locator('[data-testid=price]').first().locator('[data-price=rub]')).toBeVisible()
  })

  test('ошибка API оставляет статический товар', async ({ page }) => {
    await page.route('**/api/products?changed=1', (route) => route.abort('failed'))
    await page.goto(`/${HREF}`)
    await expect(page.getByRole('heading', { level: 1, name: ASTAX.name })).toBeVisible()
    await expect(page.locator('[data-testid=price]').first()).toBeVisible()
    await expect(page.getByText('Товар не найден')).toHaveCount(0)
  })

  test('слабый 4G: заголовок и цена видны без ожидания картинок', async ({ page }) => {
    const client = await page.context().newCDPSession(page)
    await client.send('Network.enable')
    await client.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 400,
      downloadThroughput: (1024 * 1024) / 8,
      uploadThroughput: (256 * 1024) / 8,
    })
    await page.goto(`/${HREF}`)
    await expect(page.getByRole('heading', { level: 1, name: ASTAX.name })).toBeVisible()
    await expect(page.locator('[data-testid=price]').first().locator('[data-price=pv]')).toContainText('70')
  })

  test('очень слабое соединение и CPU 4×: статика всё равно на экране', async ({ page }) => {
    const client = await page.context().newCDPSession(page)
    await client.send('Network.enable')
    await client.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 800,
      downloadThroughput: (400 * 1024) / 8,
      uploadThroughput: (128 * 1024) / 8,
    })
    await client.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    await page.route('**/api/products?changed=1', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2000))
      await route.abort('timedout')
    })
    await page.goto(`/${HREF}`)
    await expect(page.getByRole('heading', { level: 1, name: ASTAX.name })).toBeVisible()
    await expect(page.locator('[data-testid=price]').first().locator('[data-price=rub]')).toBeVisible()
    await expect(page.getByRole('img', { name: ASTAX.name })).toBeVisible()
  })
})
