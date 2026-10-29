import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { adminErrorText, AdminHttpError, WEBINAR_STATUS_LABEL, webinarsApi, type AdminWebinar } from './adminHttp'
import styles from './App.module.css'
import admin from './Admin.module.css'
import type { SectionProps } from './sections'

const WebinarForm = lazy(() => import('./WebinarForm'))

const PAGE = 20
const STATUSES = [
  { id: 'all', label: 'Все' },
  { id: 'pending', label: 'Ожидают' },
  { id: 'published', label: 'Опубликованы' },
  { id: 'withdrawn', label: 'Сняты' },
  { id: 'rejected', label: 'Отклонены' },
] as const

function describeSource(w: AdminWebinar) {
  return w.sourceType === 'youtube' ? `YouTube ${w.youtubeVideoId ?? ''}` : 'Файл на сайте'
}

export default function WebinarsSection({ initData, active, setBack, setDirty }: SectionProps) {
  const [status, setStatus] = useState<string>('all')
  const [draftQ, setDraftQ] = useState('')
  const [q, setQ] = useState('')
  const [items, setItems] = useState<AdminWebinar[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [open, setOpen] = useState<AdminWebinar | null>(null)
  const [formDirty, setFormDirty] = useState(false)
  const [reload, setReload] = useState(0)
  const listScroll = useRef(0)
  const abort = useRef<AbortController | null>(null)

  useEffect(() => {
    const t = window.setTimeout(() => setQ(draftQ.trim()), 350)
    return () => window.clearTimeout(t)
  }, [draftQ])

  useEffect(() => {
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    const t = window.setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await webinarsApi.list(initData, { status, q, offset: 0, limit: PAGE }, controller.signal)
        setItems(res.webinars)
        setTotal(res.total)
        setLoaded(true)
      } catch (err) {
        if (controller.signal.aborted || (err instanceof AdminHttpError && err.code === 'aborted')) return
        setError(adminErrorText(err)) // прежний список остаётся
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, 0)
    return () => {
      window.clearTimeout(t)
      controller.abort()
    }
  }, [initData, status, q, reload])

  const loadMore = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await webinarsApi.list(initData, { status, q, offset: items.length, limit: PAGE })
      setItems((prev) => [...prev, ...res.webinars.filter((w) => !prev.some((p) => p.id === w.id))])
      setTotal(res.total)
    } catch (err) {
      setError(adminErrorText(err))
    } finally {
      setLoading(false)
    }
  }

  const close = useCallback(
    (force = false) => {
      if (!force && formDirty && !window.confirm('Есть несохранённые изменения. Закрыть без сохранения?')) return
      setOpen(null)
      setFormDirty(false)
      const y = listScroll.current
      requestAnimationFrame(() => window.scrollTo(0, y))
    },
    [formDirty],
  )

  useEffect(() => {
    if (!active) return
    setBack(open ? () => close() : null)
  }, [active, open, close, setBack])
  useEffect(() => setDirty(formDirty), [formDirty, setDirty])

  const openItem = (w: AdminWebinar) => {
    listScroll.current = window.scrollY
    setNotice(null)
    setOpen(w)
    window.scrollTo(0, 0)
  }

  const onChanged = (w: AdminWebinar, message: string) => {
    setItems((prev) => prev.map((x) => (x.id === w.id ? w : x)))
    setNotice(message)
    setFormDirty(false)
    setOpen(w)
  }

  const onRemoved = (message: string) => {
    setNotice(message)
    setReload((n) => n + 1)
    close(true)
  }

  if (open) {
    return (
      <div className={styles.app} data-testid="webinar-screen">
        <header className={styles.header}>
          <h1 className={styles.title}>Вебинар</h1>
          <div className={styles.actionsRow}>
            <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => close()}>
              Назад к вебинарам
            </button>
          </div>
        </header>
        {notice ? <div className={styles.notice} role="status">{notice}</div> : null}
        <Suspense fallback={<p className={styles.status}>Загрузка формы…</p>}>
          <WebinarForm
            key={`${open.id}-${open.updatedAt}`}
            initData={initData}
            webinar={open}
            onDirtyChange={setFormDirty}
            onChanged={onChanged}
            onRemoved={onRemoved}
          />
        </Suspense>
      </div>
    )
  }

  return (
    <div className={styles.app} data-testid="webinars-list">
      <header className={styles.header}>
        <h1 className={styles.title}>Вебинары</h1>
        <div className={styles.searchRow}>
          <input
            className={styles.input}
            type="search"
            placeholder="Поиск по названию, спикеру, видео..."
            aria-label="Поиск вебинаров"
            value={draftQ}
            onChange={(e) => setDraftQ(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div className={admin.chips} role="group" aria-label="Статус">
          {STATUSES.map((s) => (
            <button
              key={s.id}
              type="button"
              className={admin.chip}
              aria-pressed={status === s.id}
              onClick={() => {
                setStatus(s.id)
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
        <p className={styles.status}>{loading ? 'Загрузка…' : `Найдено: ${total}`}</p>
      </header>
      {notice ? <div className={styles.notice} role="status">{notice}</div> : null}
      {error ? (
        <div className={styles.error} role="alert">
          {error}{' '}
          <button type="button" className={styles.btn} onClick={() => setReload((n) => n + 1)}>
            Повторить
          </button>
        </div>
      ) : null}
      <div className={styles.list}>
        {items.map((w) => (
          <button key={w.id} type="button" className={admin.rowCard} onClick={() => openItem(w)}>
            <span className={admin.rowBody}>
              <span className={admin.badge} data-status={w.status}>
                {WEBINAR_STATUS_LABEL[w.status]}
              </span>
              <span className={admin.rowTitle}>{w.title}</span>
              <span className={styles.meta}>
                {[w.speaker, w.date, describeSource(w)].filter(Boolean).join(' · ')}
              </span>
              {w.metadataText && w.status === 'pending' ? <span className={styles.meta}>{w.metadataText}</span> : null}
            </span>
          </button>
        ))}
      </div>
      {loaded && items.length === 0 && !loading ? <p className={styles.status}>Ничего не найдено</p> : null}
      {items.length < total ? (
        <button type="button" className={styles.btn} disabled={loading} onClick={() => void loadMore()}>
          Показать ещё
        </button>
      ) : null}
    </div>
  )
}
