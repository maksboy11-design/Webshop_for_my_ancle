import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, it } from 'node:test'

/**
 * Регрессия: бандл api/max/webhook.js падал при загрузке на Vercel
 * («Dynamic require of "node:buffer" is not supported»), и все доставки MAX получали 500.
 * Проверка идёт в отдельном процессе из файла: у `node -e` есть глобальный require и ошибка не воспроизводится.
 */
describe('собранные функции api/*.js', () => {
  it('webhook загружается как ESM и отвечает 405 на GET', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bundle-smoke-'))
    try {
      const target = pathToFileURL(resolve('api/max/webhook.js')).href
      const script = join(dir, 'smoke.mjs')
      writeFileSync(
        script,
        `const m = await import(${JSON.stringify(target)})\nconst r = await m.default.fetch(new Request('https://x.test/api/max/webhook'))\nconsole.log(r.status)\n`,
      )
      const out = execFileSync(process.execPath, [script], { encoding: 'utf8' }).trim()
      assert.equal(out, '405')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('webhook без секрета отвечает 401 на POST', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bundle-smoke-'))
    try {
      const target = pathToFileURL(resolve('api/max/webhook.js')).href
      const script = join(dir, 'smoke.mjs')
      writeFileSync(
        script,
        `const m = await import(${JSON.stringify(target)})\nconst r = await m.default.fetch(new Request('https://x.test/api/max/webhook', { method: 'POST', body: '{}' }))\nconsole.log(r.status)\n`,
      )
      const out = execFileSync(process.execPath, [script], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '' } }).trim()
      assert.equal(out, '401')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reviews загружается как ESM', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bundle-smoke-'))
    try {
      const target = pathToFileURL(resolve('api/reviews.js')).href
      const script = join(dir, 'smoke.mjs')
      writeFileSync(script, `const m = await import(${JSON.stringify(target)})\nconsole.log(typeof m.default.fetch)\n`)
      assert.equal(execFileSync(process.execPath, [script], { encoding: 'utf8' }).trim(), 'function')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('webinars загружается как ESM и отвечает 405 на POST', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bundle-smoke-'))
    try {
      const target = pathToFileURL(resolve('api/webinars.js')).href
      const script = join(dir, 'smoke.mjs')
      writeFileSync(
        script,
        `const m = await import(${JSON.stringify(target)})\nconst r = await m.default.fetch(new Request('https://x.test/api/webinars', { method: 'POST' }))\nconsole.log(r.status)\n`,
      )
      assert.equal(execFileSync(process.execPath, [script], { encoding: 'utf8' }).trim(), '405')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
