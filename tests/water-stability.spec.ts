import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * Стресс-тест физической воды в блоке «Преимущества» (?water=diag: фон заморожен,
 * состояние поля публикуется в data-diag). Проверяет критерии C6/C7 из отчёта:
 * поле конечно, |h| ≤ 5 px, уклон ≤ 0.5, средний уровень ≈ 0, волны видны, поле гаснет само.
 */
test.use({
  launchOptions: {
    executablePath: process.env.PW_CHROME_PATH || undefined,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  },
})

interface Diag {
  active: boolean
  clears: number
  nanResets: number
  read: boolean
  maxH?: number
  mean?: number
  maxSlope?: number
  bad?: number
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function diag(page: Page): Promise<Diag | null> {
  const s = await page.locator('[data-testid=water-surface]').getAttribute('data-diag')
  return s ? (JSON.parse(s) as Diag) : null
}

async function sweep(page: Page, pts: [number, number][], speed: number, samples: Diag[]) {
  const seg: { l0: number; d: number; a: [number, number]; b: [number, number] }[] = []
  let total = 0
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
    seg.push({ l0: total, d, a: pts[i - 1], b: pts[i] })
    total += d
  }
  const t0 = Date.now()
  let k = 0
  for (;;) {
    const s = Math.min(((Date.now() - t0) / 1000) * speed, total)
    const g = seg.find((x) => s <= x.l0 + x.d) ?? seg[seg.length - 1]
    const f = g.d ? (s - g.l0) / g.d : 1
    await page.mouse.move(g.a[0] + (g.b[0] - g.a[0]) * f, g.a[1] + (g.b[1] - g.a[1]) * f)
    if (++k % 4 === 0) {
      const d = await diag(page)
      if (d) samples.push(d)
    }
    if (s >= total) break
  }
}

test('вода: резкие движения не дают дрейфа уровня, NaN и взрыва амплитуды; поле гаснет само', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/?water=diag', { waitUntil: 'networkidle' })
  const surface = page.locator('[data-testid=water-surface]')
  await surface.scrollIntoViewIfNeeded()
  await expect(surface).toHaveAttribute('data-ready', 'true', { timeout: 20_000 })
  const sim = await surface.getAttribute('data-sim')
  test.skip(!sim || sim === 'off', 'WebGL-симуляция недоступна в этом браузере (запасной режим)')
  const bx = await surface.boundingBox()
  if (!bx) throw new Error('нет bounding box у воды')
  const X = (f: number) => bx.x + bx.width * f
  const Y = (f: number) => bx.y + bx.height * f

  const samples: Diag[] = []
  // медленно → резко 1000 → 2400 → туда-обратно → зигзаг
  await sweep(page, [[X(0.2), Y(0.5)], [X(0.4), Y(0.5)]], 100, samples)
  await sweep(page, [[X(0.1), Y(0.4)], [X(0.9), Y(0.6)]], 1000, samples)
  await sweep(page, [[X(0.9), Y(0.3)], [X(0.1), Y(0.7)]], 2400, samples)
  const bf: [number, number][] = []
  for (let i = 0; i < 8; i++) bf.push([X(i % 2 ? 0.8 : 0.2), Y(0.5)])
  await sweep(page, bf, 2000, samples)
  const zz: [number, number][] = []
  for (let i = 0; i <= 10; i++) zz.push([X(0.1 + 0.08 * i), Y(i % 2 ? 0.25 : 0.75)])
  await sweep(page, zz, 1800, samples)
  await page.mouse.down()
  await page.mouse.up()
  for (let i = 0; i < 5; i++) {
    await sleep(100)
    const d = await diag(page)
    if (d) samples.push(d)
  }

  const read = samples.filter((d) => d.read && typeof d.maxH === 'number')
  test.skip(read.length === 0, 'считывание поля недоступно — проверка только запасного критерия')
  const maxH = Math.max(...read.map((d) => d.maxH ?? 0))
  const maxSlope = Math.max(...read.map((d) => d.maxSlope ?? 0))
  const maxMean = Math.max(...read.map((d) => Math.abs(d.mean ?? 0)))
  expect(read.every((d) => (d.bad ?? 0) === 0), 'NaN/Inf в поле').toBe(true)
  expect(Math.max(...samples.map((d) => d.nanResets))).toBe(0)
  expect(maxH, 'max|h|, px').toBeLessThanOrEqual(5)
  expect(maxH, 'волны видны').toBeGreaterThanOrEqual(0.8)
  expect(maxSlope, 'уклон').toBeLessThanOrEqual(0.5)
  expect(maxMean, 'средний уровень, px').toBeLessThanOrEqual(0.05)

  // Без ввода поле гаснет само и сбрасывается уже почти нулевым.
  const before = (await diag(page))?.clears ?? 0
  await page.mouse.move(bx.x + bx.width / 2, bx.y - 200)
  await expect
    .poll(async () => (await diag(page))?.clears ?? 0, { timeout: 25_000, intervals: [500] })
    .toBeGreaterThan(before)
  const end = await diag(page)
  expect(end?.active).toBe(false)
})
