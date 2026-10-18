import { defineConfig } from '@playwright/test'

const PORT = 4173

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  // Мало памяти на машине — PW_WORKERS=1
  workers: Number(process.env.PW_WORKERS ?? 2),
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Свой viewport задаётся в каждом тесте.
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        launchOptions: {
          // PW_CHROME_PATH — путь к установленному Chrome/Chromium (вместо браузера Playwright)
          executablePath: process.env.PW_CHROME_PATH || undefined,
          args: [
            // На части Windows-машин GPU-процесс headless-Chromium падает; для тестов GPU не нужен
            '--disable-gpu',
            // PW_NO_SANDBOX=1 — для контейнеров/Linux-окружений без user namespaces
            ...(process.env.PW_NO_SANDBOX ? ['--no-sandbox'] : []),
          ],
        },
      },
    },
  ],
  webServer: {
    // Проверяем именно production-сборку.
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
