import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CHUNK_RELOAD_KEY, isChunkLoadError, reloadOnce, RELOAD_WINDOW_MS } from '../src/chunkReload'

function mem() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }
}

test('распознаёт ошибки загрузки чанков', () => {
  assert.ok(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/WebinarsSection-CR2llJzD.js')))
  assert.ok(isChunkLoadError(new TypeError('Importing a module script failed.')))
  assert.ok(isChunkLoadError(new Error('Unable to preload CSS for /assets/a.css')))
  assert.ok(!isChunkLoadError(new Error('Cannot read properties of undefined')))
  assert.ok(!isChunkLoadError(null))
})

test('перезагружает один раз, затем не зацикливается', () => {
  const s = mem()
  let reloads = 0
  assert.equal(reloadOnce(s, () => reloads++, 1_000_000), true)
  assert.equal(s.m.get(CHUNK_RELOAD_KEY), '1000000')
  assert.equal(reloadOnce(s, () => reloads++, 1_000_000 + 5_000), false)
  assert.equal(reloads, 1)
  assert.equal(reloadOnce(s, () => reloads++, 1_000_000 + RELOAD_WINDOW_MS + 1), true)
  assert.equal(reloads, 2)
})

test('без sessionStorage всё равно перезагружает', () => {
  let reloads = 0
  const broken = { getItem: () => { throw new Error('denied') }, setItem: () => {} }
  assert.equal(reloadOnce(broken, () => reloads++), true)
  assert.equal(reloadOnce(null, () => reloads++), true)
  assert.equal(reloads, 2)
})
