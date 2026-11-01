import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { UploadQueue, type QueueMedia, type RunContext, type UploadItem } from '../src/admin-reviews/media/uploadQueue'

const file = (name: string, size = 10, type = '') => new File([new Uint8Array(size)], name, { type })
const tick = () => new Promise((r) => setTimeout(r, 0))
const media = (id: string, status = 'ready'): QueueMedia => ({ id, kind: 'image', status, thumb: null, url: '/x', name: id })
let n = 0
const newId = () => `id-${++n}`

function deferred() {
  let resolve!: () => void
  let reject!: (e: unknown) => void
  const promise = new Promise<void>((a, b) => ((resolve = a), (reject = b)))
  return { promise, resolve, reject }
}

describe('очередь загрузок', () => {
  it('параллельность ограничена (по умолчанию 3), прогресс общий', async () => {
    const gates = new Map<string, ReturnType<typeof deferred>>()
    let peak = 0
    let active = 0
    const q = new UploadQueue({
      newId,
      isTransient: () => false,
      errorText: () => 'err',
      run: async (item: UploadItem, ctx: RunContext) => {
        active++
        peak = Math.max(peak, active)
        ctx.setStatus('uploading')
        ctx.setProgress(0.5)
        const g = deferred()
        gates.set(item.id, g)
        await g.promise
        active--
        return { media: media(item.id), duplicate: false }
      },
    })
    q.add([1, 2, 3, 4, 5].map((i) => file(`${i}.jpg`)), { type: 'library' })
    await tick()
    assert.equal(peak, 3)
    assert.equal(q.items.filter((i) => i.status === 'queued').length, 2)
    assert.equal(q.overall.progress, 0.3)
    for (const g of gates.values()) g.resolve()
    await tick()
    await tick()
    for (const g of gates.values()) g.resolve()
    await tick()
    await tick()
    assert.equal(peak, 3)
    assert.deepEqual(q.items.map((i) => i.status), ['done', 'done', 'done', 'done', 'done'])
    assert.equal(q.overall.progress, 1)
  })

  it('неподдерживаемый тип — сразу ошибка, без запросов', () => {
    let runs = 0
    const q = new UploadQueue({ newId, isTransient: () => false, errorText: (e) => (e as { code: string }).code, run: async () => (runs++, { media: media('x'), duplicate: false }) })
    const [a] = q.add([file('virus.exe', 5)], { type: 'library' })
    assert.equal(a!.status, 'error')
    assert.equal(a!.error, 'unsupported_type')
    assert.equal(runs, 0)
  })

  it('временные ошибки повторяются с backoff тем же id; постоянные — нет', async () => {
    const ids: string[] = []
    const waits: number[] = []
    let fails = 2
    const q = new UploadQueue({
      newId,
      isTransient: (e) => (e as { transient?: boolean }).transient === true,
      errorText: () => 'err',
      sleep: async (ms) => void waits.push(ms),
      backoffMs: (a) => a * 100,
      run: async (item) => {
        ids.push(item.id)
        if (fails-- > 0) throw { transient: true }
        return { media: media(item.id), duplicate: false }
      },
    })
    const [a] = q.add([file('a.png')], { type: 'library' })
    await new Promise((r) => setTimeout(r, 10))
    assert.equal(a!.status, 'done')
    assert.deepEqual(ids, [a!.id, a!.id, a!.id], 'ключ идемпотентности не меняется')
    assert.deepEqual(waits, [100, 200])

    let calls = 0
    const q2 = new UploadQueue({ newId, isTransient: () => false, errorText: () => 'bad', run: async () => (calls++, Promise.reject({ status: 422 })) })
    const [b] = q2.add([file('b.png')], { type: 'library' })
    await tick()
    assert.equal(b!.status, 'error')
    assert.equal(calls, 1)
    q2.retry(b!.id)
    await tick()
    assert.equal(calls, 2)
  })

  it('отмена прерывает загрузку через AbortSignal', async () => {
    let signal: AbortSignal | null = null
    const q = new UploadQueue({
      newId,
      isTransient: () => true,
      errorText: () => 'err',
      run: (_item, ctx) =>
        new Promise((_, reject) => {
          signal = ctx.signal
          ctx.signal.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    })
    const [a] = q.add([file('a.webp')], { type: 'library' })
    await tick()
    q.cancel(a!.id)
    await tick()
    assert.equal(signal!.aborted, true)
    assert.equal(a!.status, 'canceled')
    assert.equal(q.overall.active, false)
  })

  it('обработка изображения в фоне не занимает слот; дубль помечается', async () => {
    const proc = deferred()
    const done: string[] = []
    const q = new UploadQueue({
      newId,
      concurrency: 1,
      isTransient: () => false,
      errorText: () => 'err',
      onDone: (i) => done.push(i.status),
      run: async (item) =>
        item.name === 'dup.jpg'
          ? { media: media('old'), duplicate: true }
          : { media: media(item.id, 'processing'), duplicate: false, process: async () => (await proc.promise, media(item.id)) },
    })
    const [a, b] = q.add([file('a.jpg'), file('dup.jpg')], { type: 'library' })
    await tick()
    await tick()
    assert.equal(a!.status, 'processing')
    assert.equal(b!.status, 'duplicate', 'второй файл пошёл, пока первый обрабатывается')
    proc.resolve()
    await tick()
    await tick()
    assert.equal(a!.status, 'done')
    assert.deepEqual(done.sort(), ['done', 'duplicate'])
  })
})
