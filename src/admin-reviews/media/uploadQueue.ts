/**
 * Очередь загрузок медиатеки: ограниченная параллельность, отмена, повтор, прогресс.
 * Чистая логика без DOM/сети — шаги загрузки передаются функцией `run` (тестируется на моках).
 * Ключ идемпотентности = id медиа: при повторе тот же id, сервер не создаст дубль.
 */
import { checkMediaFile, kindOf, mimeOf, type MediaKind, type MediaLimits } from '../../cms/mediaTypes'

export type UploadStatus = 'queued' | 'hashing' | 'uploading' | 'verifying' | 'processing' | 'done' | 'duplicate' | 'error' | 'canceled'

/** Куда положить файл после загрузки: только медиатека или галерея товара. */
export type UploadTarget =
  | { type: 'library' }
  | {
      type: 'product'
      productId: string
      productName: string
      /** gallery — фото товара, documents — документы, block — файл для блока/видео (replace — куда именно); по умолчанию по типу файла. */
      slot?: 'gallery' | 'documents' | 'block'
      /** Заменить этот файл в галерее/документах (позиция и роль сохраняются). */
      replace?: string
    }
  /** Изображение для блока страницы (replace = id блока). */
  | { type: 'page'; pageId: string; pageName: string; replace: string }

export interface QueueMedia {
  id: string
  kind: MediaKind
  status: string
  thumb: string | null
  url: string
  name: string
}

export interface UploadItem<M extends QueueMedia = QueueMedia> {
  id: string
  file: File
  name: string
  mime: string
  kind: MediaKind | null
  size: number
  target: UploadTarget
  status: UploadStatus
  /** 0..1 */
  progress: number
  error: string | null
  attempts: number
  media: M | null
}

export interface RunContext {
  signal: AbortSignal
  setStatus: (s: 'hashing' | 'uploading' | 'verifying') => void
  setProgress: (p: number) => void
}

export interface RunResult<M> {
  media: M
  duplicate: boolean
  /** Фоновая обработка (изображения): не занимает слот очереди. */
  process?: () => Promise<M>
}

export interface QueueOptions<M extends QueueMedia> {
  run: (item: UploadItem<M>, ctx: RunContext) => Promise<RunResult<M>>
  /** Повтор только временных ошибок (сеть, 5xx, 429). */
  isTransient: (err: unknown) => boolean
  errorText: (err: unknown) => string
  concurrency?: number
  maxRetries?: number
  backoffMs?: (attempt: number) => number
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  newId?: () => string
  limits?: MediaLimits
  onChange?: () => void
  onDone?: (item: UploadItem<M>) => void
}

const ACTIVE: UploadStatus[] = ['hashing', 'uploading', 'verifying']
const FINISHED: UploadStatus[] = ['done', 'duplicate', 'error', 'canceled']

const defaultSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => (clearTimeout(t), reject(new DOMException('aborted', 'AbortError'))), { once: true })
  })

export class UploadQueue<M extends QueueMedia = QueueMedia> {
  items: UploadItem<M>[] = []
  concurrency: number
  private readonly o: QueueOptions<M>
  private readonly controllers = new Map<string, AbortController>()
  private running = 0

  constructor(options: QueueOptions<M>) {
    this.o = options
    this.concurrency = Math.max(1, options.concurrency ?? 3)
  }

  setConcurrency(n: number) {
    this.concurrency = Math.max(1, Math.min(10, Math.floor(n) || 1))
    this.pump()
  }

  add(files: Iterable<File>, target: UploadTarget): UploadItem<M>[] {
    const added: UploadItem<M>[] = []
    for (const file of files) {
      const mime = mimeOf(file.name, file.type)
      const bad = mime ? checkMediaFile(mime, file.size, this.o.limits) : 'unsupported_type'
      const item: UploadItem<M> = {
        id: (this.o.newId ?? (() => crypto.randomUUID()))(),
        file,
        name: file.name,
        mime: mime ?? (file.type || '—'),
        kind: mime ? kindOf(mime) : null,
        size: file.size,
        target,
        status: bad ? 'error' : 'queued',
        progress: 0,
        error: bad ? this.o.errorText({ code: bad }) : null,
        attempts: 0,
        media: null,
      }
      this.items.push(item)
      added.push(item)
    }
    this.changed()
    this.pump()
    return added
  }

  cancel(id: string) {
    const item = this.find(id)
    if (!item || FINISHED.includes(item.status) || item.status === 'processing') return
    this.controllers.get(id)?.abort()
    item.status = 'canceled'
    item.error = null
    this.changed()
  }

  cancelAll() {
    for (const i of this.items) this.cancel(i.id)
  }

  retry(id: string) {
    const item = this.find(id)
    if (!item || (item.status !== 'error' && item.status !== 'canceled') || !item.kind) return
    item.status = 'queued'
    item.error = null
    item.progress = 0
    item.attempts = 0
    this.changed()
    this.pump()
  }

  clearFinished() {
    this.items = this.items.filter((i) => !FINISHED.includes(i.status))
    this.changed()
  }

  /** Общий прогресс по байтам (отменённые не учитываются). */
  get overall(): { done: number; total: number; progress: number; active: boolean } {
    const list = this.items.filter((i) => i.status !== 'canceled' && !(i.status === 'error' && !i.kind))
    const total = list.reduce((s, i) => s + i.size, 0)
    const loaded = list.reduce((s, i) => s + i.size * (['done', 'duplicate', 'processing'].includes(i.status) ? 1 : i.progress), 0)
    return {
      done: list.filter((i) => i.status === 'done' || i.status === 'duplicate').length,
      total: list.length,
      progress: total ? loaded / total : 0,
      active: this.items.some((i) => i.status === 'queued' || i.status === 'processing' || ACTIVE.includes(i.status)),
    }
  }

  private find(id: string) {
    return this.items.find((i) => i.id === id)
  }

  private changed() {
    this.o.onChange?.()
  }

  private pump() {
    while (this.running < this.concurrency) {
      const next = this.items.find((i) => i.status === 'queued')
      if (!next) return
      this.running++
      next.status = 'hashing'
      void this.execute(next).finally(() => {
        this.running--
        this.pump()
      })
    }
  }

  private async execute(item: UploadItem<M>) {
    const ctrl = new AbortController()
    this.controllers.set(item.id, ctrl)
    const max = this.o.maxRetries ?? 3
    try {
      for (;;) {
        item.attempts++
        try {
          const r = await this.o.run(item, {
            signal: ctrl.signal,
            setStatus: (s) => {
              if (ctrl.signal.aborted) return
              item.status = s
              this.changed()
            },
            setProgress: (p) => {
              if (ctrl.signal.aborted) return
              item.progress = Math.max(0, Math.min(1, p))
              this.changed()
            },
          })
          if (ctrl.signal.aborted) return
          item.media = r.media
          item.progress = 1
          if (r.duplicate) {
            item.status = 'duplicate'
            this.changed()
            this.o.onDone?.(item)
            return
          }
          if (r.process) {
            item.status = 'processing'
            this.changed()
            const process = r.process
            void process()
              .then((m) => {
                item.media = m
                if (m.status === 'failed') {
                  item.status = 'error'
                  item.error = this.o.errorText({ code: 'image_decode_failed' })
                } else item.status = 'done'
              })
              .catch((err) => {
                // Файл загружен, обработку можно повторить позже из медиатеки.
                item.status = 'done'
                item.error = this.o.errorText(err)
              })
              .finally(() => {
                this.changed()
                if (item.media) this.o.onDone?.(item)
              })
            return
          }
          item.status = 'done'
          this.changed()
          this.o.onDone?.(item)
          return
        } catch (err) {
          if (ctrl.signal.aborted) return
          if (this.o.isTransient(err) && item.attempts <= max) {
            item.status = 'uploading'
            item.error = `${this.o.errorText(err)} Повтор ${item.attempts} из ${max}…`
            this.changed()
            try {
              await (this.o.sleep ?? defaultSleep)((this.o.backoffMs ?? ((n) => 1000 * 2 ** (n - 1)))(item.attempts), ctrl.signal)
            } catch {
              return
            }
            item.error = null
            continue
          }
          item.status = 'error'
          item.error = this.o.errorText(err)
          this.changed()
          return
        }
      }
    } finally {
      this.controllers.delete(item.id)
    }
  }
}
