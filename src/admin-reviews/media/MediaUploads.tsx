/* eslint-disable react-refresh/only-export-components -- провайдер, хук и константы загрузчика живут вместе */
/** Загрузки медиатеки: общий провайдер очереди, глобальная зона перетаскивания, локальные зоны и панель очереди. */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { formatBytes, MEDIA_TYPES } from '../../cms/mediaTypes'
import styles from '../App.module.css'
import m from './Media.module.css'
import { isTransientUploadError, mediaUploadRunner, uploadErrorText, type MediaItem } from './mediaApi'
import { UploadQueue, type UploadItem, type UploadStatus, type UploadTarget } from './uploadQueue'

export const MEDIA_ACCEPT = Object.keys(MEDIA_TYPES).join(',')
export const IMAGE_ACCEPT = Object.entries(MEDIA_TYPES)
  .filter(([, t]) => t.kind === 'image')
  .map(([mime]) => mime)
  .join(',')

type DoneListener = (item: UploadItem<MediaItem>) => void

interface UploadsValue {
  queue: UploadQueue<MediaItem>
  version: number
  enqueue: (files: Iterable<File>, target: UploadTarget) => void
  /** Назначение, которое предлагается при перетаскивании (открытый товар или медиатека). */
  suggested: UploadTarget
  setSuggested: (t: UploadTarget | null) => void
  onDone: (fn: DoneListener) => () => void
}

const Ctx = createContext<UploadsValue | null>(null)

export function useMediaUploads(): UploadsValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('MediaUploadProvider missing')
  return v
}

const CONCURRENCY_KEY = 'silkway-admin-upload-concurrency'

export function MediaUploadProvider({ initData, children }: { initData: string; children: ReactNode }) {
  const [version, bump] = useReducer((n: number) => n + 1, 0)
  const [listeners] = useState(() => new Set<DoneListener>())
  const [suggested, setSuggestedState] = useState<UploadTarget | null>(null)
  const [queue] = useState(() => {
    let saved = 3
    try {
      saved = Number(localStorage.getItem(CONCURRENCY_KEY)) || 3
    } catch {
      /* без localStorage — по умолчанию */
    }
    return new UploadQueue<MediaItem>({
      run: mediaUploadRunner(initData),
      isTransient: isTransientUploadError,
      errorText: uploadErrorText,
      concurrency: saved,
      onChange: bump,
      onDone: (item) => listeners.forEach((fn) => fn(item)),
    })
  })
  const enqueue = useCallback((files: Iterable<File>, target: UploadTarget) => void queue.add(files, target), [queue])
  const onDone = useCallback(
    (fn: DoneListener) => {
      listeners.add(fn)
      return () => void listeners.delete(fn)
    },
    [listeners],
  )
  const setSuggested = useCallback((t: UploadTarget | null) => setSuggestedState(t), [])
  const value = useMemo<UploadsValue>(
    () => ({ queue, version, enqueue, suggested: suggested ?? { type: 'library' }, setSuggested, onDone }),
    [queue, version, enqueue, suggested, setSuggested, onDone],
  )
  return (
    <Ctx.Provider value={value}>
      {children}
      <GlobalDropOverlay />
      <UploadQueuePanel />
    </Ctx.Provider>
  )
}

export const targetLabel = (t: UploadTarget) =>
  t.type === 'library'
    ? 'Медиатека'
    : t.type === 'page'
      ? `Страница: ${t.pageName}`
      : `${t.slot === 'documents' ? 'Документы' : t.slot === 'gallery' ? 'Галерея' : t.slot === 'block' ? 'Блоки' : 'Товар'}: ${t.productName}`

const DROP_END = 'silkway-media-drop-end'
const hasFiles = (e: DragEvent | React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')

/** Перетаскивание файлов в любое место окна: подсветка и выбор назначения (подставлено автоматически, можно сменить). */
function GlobalDropOverlay() {
  const { enqueue, suggested } = useMediaUploads()
  const [active, setActive] = useState(false)
  const [target, setTarget] = useState<'suggested' | 'library'>('suggested')
  const depth = useRef(0)
  const chosenRef = useRef<UploadTarget>(suggested)
  // Новое предложенное назначение (открыли другой товар) — снова выбрано по умолчанию.
  const [seenSuggested, setSeenSuggested] = useState(suggested)
  if (seenSuggested !== suggested) {
    setSeenSuggested(suggested)
    setTarget('suggested')
  }
  useEffect(() => {
    chosenRef.current = target === 'suggested' ? suggested : { type: 'library' }
  }, [target, suggested])
  useEffect(() => {
    const reset = () => {
      depth.current = 0
      setActive(false)
    }
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth.current++
      setActive(true)
    }
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth.current = Math.max(0, depth.current - 1)
      if (!depth.current) setActive(false)
    }
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault()
    }
    // Сюда доходит бросок мимо локальных зон (они останавливают всплытие) — грузим в выбранное назначение.
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      reset()
      if (e.dataTransfer?.files.length) enqueue(Array.from(e.dataTransfer.files), chosenRef.current)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    window.addEventListener(DROP_END, reset)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
      window.removeEventListener(DROP_END, reset)
    }
  }, [enqueue])
  if (!active) return null
  return (
    <div className={m.globalDrop} data-testid="global-drop">
      <div className={m.globalDropBox}>
        <strong>Отпустите файлы в любом месте или в нужной зоне раздела</strong>
        <label className={m.destRow}>
          Куда:{' '}
          <select aria-label="Назначение загрузки" value={target} onChange={(e) => setTarget(e.target.value as 'suggested' | 'library')}>
            <option value="suggested">{targetLabel(suggested)}</option>
            {suggested.type !== 'library' ? <option value="library">Только медиатека</option> : null}
          </select>
        </label>
        <span className={m.hintText}>Изображения, видео (MP4, WebM, MOV) и PDF</span>
      </div>
    </div>
  )
}

/** Локальная зона раздела: перетаскивание с подсветкой + кнопка выбора файлов (для телефона). */
export function DropZone({
  target,
  accept = MEDIA_ACCEPT,
  label,
  testId,
  multiple = true,
  prepare,
}: {
  target: UploadTarget
  accept?: string
  label: string
  testId?: string
  multiple?: boolean
  /** Предварительная проверка файлов (например, длительность видео); в очередь уходят только годные. */
  prepare?: (files: File[]) => Promise<File[]>
}) {
  const { enqueue: rawEnqueue } = useMediaUploads()
  const enqueue = (files: File[], t: UploadTarget) => {
    const list = multiple ? files : files.slice(0, 1)
    if (!prepare) return rawEnqueue(list, t)
    void prepare(list).then((ok) => {
      if (ok.length) rawEnqueue(ok, t)
    })
  }
  const [over, setOver] = useState(false)
  return (
    <div
      className={`${m.dropZone} ${over ? m.dropZoneActive : ''}`}
      data-testid={testId}
      data-active={over ? 'true' : undefined}
      onDragOver={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        e.stopPropagation()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        e.stopPropagation()
        setOver(false)
        window.dispatchEvent(new Event(DROP_END))
        enqueue(Array.from(e.dataTransfer.files), target)
      }}
    >
      <span>{over ? 'Отпустите, чтобы загрузить' : label}</span>
      <label className={styles.btn}>
        Выбрать файлы
        <input
          type="file"
          multiple={multiple}
          accept={accept}
          className={m.fileInput}
          aria-label={`${label}: выбрать файлы`}
          onChange={(e) => {
            if (e.target.files?.length) enqueue(Array.from(e.target.files), target)
            e.target.value = ''
          }}
        />
      </label>
    </div>
  )
}

export const STATUS_LABEL: Record<UploadStatus, string> = {
  queued: 'В очереди',
  hashing: 'Проверка',
  uploading: 'Загрузка',
  verifying: 'Проверка на сервере',
  processing: 'Обработка',
  done: 'Готово',
  duplicate: 'Уже есть в медиатеке',
  error: 'Ошибка',
  canceled: 'Отменено',
}

function ItemThumb({ item }: { item: UploadItem<MediaItem> }) {
  const local = useMemo(
    () =>
      item.kind !== 'image' || item.size > 25 * 1024 * 1024 || typeof URL.createObjectURL !== 'function'
        ? null
        : URL.createObjectURL(item.file),
    [item.file, item.kind, item.size],
  )
  useEffect(() => () => void (local && URL.revokeObjectURL(local)), [local])
  const src = item.media?.thumb ?? local
  if (src) return <img className={m.qThumb} src={src} alt="" width={44} height={44} />
  return (
    <span className={m.qThumb} aria-hidden="true">
      {item.kind === 'video' ? '▶' : item.kind === 'document' ? 'PDF' : '?'}
    </span>
  )
}

function UploadQueuePanel() {
  const { queue } = useMediaUploads()
  const [open, setOpen] = useState(true)
  if (!queue.items.length) return null
  const o = queue.overall
  return (
    <section className={m.queue} aria-label="Очередь загрузок" data-testid="upload-queue">
      <div className={m.queueHead}>
        <button type="button" className={m.linkBtn} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          Загрузки: {o.done} из {o.total} · {Math.round(o.progress * 100)}%
        </button>
        <progress max={1} value={o.progress} aria-label="Общий прогресс" />
        <label className={m.hintText}>
          Параллельно{' '}
          <select
            aria-label="Параллельных загрузок"
            value={queue.concurrency}
            onChange={(e) => {
              queue.setConcurrency(Number(e.target.value))
              try {
                localStorage.setItem(CONCURRENCY_KEY, String(queue.concurrency))
              } catch {
                /* ignore */
              }
            }}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        {o.active ? (
          <button type="button" className={m.linkBtn} onClick={() => queue.cancelAll()}>
            Отменить все
          </button>
        ) : (
          <button type="button" className={m.linkBtn} onClick={() => queue.clearFinished()}>
            Скрыть
          </button>
        )}
      </div>
      {open ? (
        <ul className={m.queueList}>
          {queue.items.map((item) => (
            <li key={item.id} className={m.queueItem} data-status={item.status} data-testid="upload-item">
              <ItemThumb item={item} />
              <div className={m.queueInfo}>
                <span className={m.qName} title={item.name}>
                  {item.name}
                </span>
                <span className={m.hintText}>
                  {item.mime} · {formatBytes(item.size)} · {targetLabel(item.target)}
                </span>
                {['uploading', 'hashing', 'verifying'].includes(item.status) ? (
                  <progress max={1} value={item.progress} aria-label={`Прогресс ${item.name}`} />
                ) : null}
                <span className={item.status === 'error' ? m.qError : m.hintText} role={item.status === 'error' ? 'alert' : undefined}>
                  {STATUS_LABEL[item.status]}
                  {item.status === 'uploading' ? ` ${Math.round(item.progress * 100)}%` : ''}
                  {item.error ? ` — ${item.error}` : ''}
                </span>
              </div>
              {['queued', 'hashing', 'uploading', 'verifying'].includes(item.status) ? (
                <button type="button" className={m.iconBtn} aria-label={`Отменить ${item.name}`} onClick={() => queue.cancel(item.id)}>
                  ✕
                </button>
              ) : (item.status === 'error' || item.status === 'canceled') && item.kind ? (
                <button type="button" className={m.iconBtn} aria-label={`Повторить ${item.name}`} onClick={() => queue.retry(item.id)}>
                  ↻
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

/**
 * Открыт ли сейчас нативный выбор файла. В WebView MAX любой вызов bridge (closing confirmation, BackButton)
 * или автосохранение с перерисовкой, пока выбор открыт, закрывает его через ~2 с — такие действия откладываем.
 */
let pickerOpen = false
const pickerListeners = new Set<() => void>()
let pickerFallback: ReturnType<typeof setTimeout> | null = null
function setPickerOpen(v: boolean) {
  if (pickerFallback) clearTimeout(pickerFallback)
  pickerFallback = null
  if (pickerOpen === v) return
  pickerOpen = v
  for (const fn of pickerListeners) fn()
}
export const devicePickerOpen = () => pickerOpen
export function useDevicePickerOpen(): boolean {
  return useSyncExternalStore(
    (fn) => {
      pickerListeners.add(fn)
      return () => pickerListeners.delete(fn)
    },
    () => pickerOpen,
    () => false,
  )
}
// Отмена без события cancel (старые WebView): страница снова видима/в фокусе и файла нет — считаем выбор закрытым.
function armPickerFallback() {
  if (!pickerOpen || document.visibilityState !== 'visible') return
  if (pickerFallback) clearTimeout(pickerFallback)
  pickerFallback = setTimeout(() => setPickerOpen(false), 1500)
}
if (typeof window !== 'undefined') {
  window.addEventListener('focus', armPickerFallback)
  document.addEventListener('visibilitychange', armPickerFallback)
}

/** Широкий accept: узкий список MIME (video/mp4,video/webm) часть Android/MAX WebView не понимает; формат проверяем после выбора. */
export const DEVICE_IMAGE_ACCEPT = 'image/*'
export const DEVICE_VIDEO_ACCEPT = 'video/*'

/**
 * Нативный выбор файла с устройства прямо из обработчика клика (жест пользователя — работает в WebView MAX).
 * Input всегда смонтирован в корне редактора: закрытие меню или перерисовка не уничтожают его до события change.
 */
export function useDevicePicker() {
  const ref = useRef<HTMLInputElement>(null)
  const pending = useRef<((files: File[]) => void) | null>(null)
  const open = useCallback((accept: string, multiple: boolean, onFiles: (files: File[]) => void) => {
    const el = ref.current
    if (!el) return
    pending.current = onFiles
    el.accept = accept
    el.multiple = multiple
    el.value = ''
    setPickerOpen(true)
    el.click()
  }, [])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const off = () => setPickerOpen(false)
    el.addEventListener('cancel', off)
    return () => el.removeEventListener('cancel', off)
  }, [])
  const input = (
    <input
      ref={ref}
      type="file"
      className={m.fileInput}
      aria-hidden="true"
      tabIndex={-1}
      data-testid="device-file-input"
      onChange={(e) => {
        const files = Array.from(e.target.files ?? [])
        const cb = pending.current
        e.target.value = ''
        setPickerOpen(false)
        if (files.length && cb) cb(files)
      }}
    />
  )
  return { open, input }
}
