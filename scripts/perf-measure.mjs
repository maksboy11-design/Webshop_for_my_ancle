import { chromium } from '@playwright/test'

const URL = process.env.PERF_URL || 'http://127.0.0.1:4173/'

async function run(label, { viewport, network, cpu, warm } = {}) {
  const browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--no-sandbox'] })
  const context = await browser.newContext({
    viewport: viewport || { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: (viewport?.width || 390) < 800,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
  })
  const page = await context.newPage()
  const client = await context.newCDPSession(page)
  if (cpu) await client.send('Emulation.setCPUThrottlingRate', { rate: cpu })
  if (network) {
    await client.send('Network.emulateNetworkConditions', {
      offline: false,
      downloadThroughput: network.download, // bytes/sec
      uploadThroughput: network.upload,
      latency: network.latency,
    })
  }

  const entries = []
  page.on('response', async (res) => {
    try {
      const req = res.request()
      if (req.resourceType() === 'websocket') return
      const headers = res.headers()
      let encoded = Number(headers['content-length'] || 0)
      try {
        const body = await res.body()
        encoded = body.length
      } catch {
        /* opaque */
      }
      entries.push({
        url: res.url(),
        status: res.status(),
        type: req.resourceType(),
        encoded,
        fromCache: res.fromServiceWorker() || (await res.request().sizes().catch(() => null))?.responseBodySize === 0,
      })
    } catch {
      /* ignore */
    }
  })

  if (warm) {
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 120_000 })
    entries.length = 0
  }

  const t0 = Date.now()
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180_000 })
  await page.waitForTimeout(warm ? 1500 : 4000)

  const metrics = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0]
    const paints = Object.fromEntries(performance.getEntriesByType('paint').map((p) => [p.name, p.startTime]))
    const lcpEntries = performance.getEntriesByType('largest-contentful-paint')
    const lcp = lcpEntries[lcpEntries.length - 1]
    const cls = performance
      .getEntriesByType('layout-shift')
      .filter((e) => !e.hadRecentInput)
      .reduce((s, e) => s + e.value, 0)
    return {
      ttfb: nav?.responseStart,
      dcl: nav?.domContentLoadedEventEnd,
      load: nav?.loadEventEnd,
      fp: paints['first-paint'],
      fcp: paints['first-contentful-paint'],
      lcp: lcp?.startTime,
      lcpUrl: lcp?.url || lcp?.element?.tagName || null,
      lcpSize: lcp?.size,
      cls,
      transferSize: nav?.transferSize,
      encodedBodySize: nav?.encodedBodySize,
    }
  })

  // Prefer CDP encoded lengths when available via Performance API resource entries
  const resources = await page.evaluate(() =>
    performance.getEntriesByType('resource').map((r) => ({
      name: r.name,
      type: r.initiatorType,
      transfer: r.transferSize,
      encoded: r.encodedBodySize,
      decoded: r.decodedBodySize,
    })),
  )

  const totalTransfer = resources.reduce((s, r) => s + (r.transfer || 0), 0)
  const byType = {}
  for (const r of resources) {
    const t = r.type || 'other'
    byType[t] = (byType[t] || 0) + (r.transfer || 0)
  }
  const top = [...resources].sort((a, b) => (b.transfer || 0) - (a.transfer || 0)).slice(0, 12)

  const elapsed = Date.now() - t0
  console.log('\n===', label, '===')
  console.log(JSON.stringify({ elapsedMs: elapsed, metrics, totalTransfer, byType, requests: resources.length, top }, null, 2))

  await browser.close()
  return { label, metrics, totalTransfer, byType, requests: resources.length, top }
}

const Mbps = (n) => Math.floor((n * 1024 * 1024) / 8)
const Kbps = (n) => Math.floor((n * 1024) / 8)

const results = []
results.push(await run('A mobile normal 390', {}))
results.push(
  await run('B weak 4G 1Mbps/256/400ms CPU4x', {
    network: { download: Mbps(1), upload: Kbps(256), latency: 400 },
    cpu: 4,
  }),
)
results.push(
  await run('C very weak 400Kbps/128/800ms CPU4x', {
    network: { download: Kbps(400), upload: Kbps(128), latency: 800 },
    cpu: 4,
  }),
)
results.push(await run('D warm cache revisit', { warm: true }))
results.push(await run('Desktop 1440', { viewport: { width: 1440, height: 900 } }))

console.log('\nSUMMARY')
for (const r of results) {
  console.log(
    r.label,
    'transferKB=',
    Math.round(r.totalTransfer / 1024),
    'LCP=',
    r.metrics.lcp?.toFixed?.(0),
    'FCP=',
    r.metrics.fcp?.toFixed?.(0),
    'CLS=',
    r.metrics.cls?.toFixed?.(3),
    'TTFB=',
    r.metrics.ttfb?.toFixed?.(0),
    'reqs=',
    r.requests,
  )
}
