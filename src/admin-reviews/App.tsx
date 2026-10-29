import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AdminApiError,
  editReview,
  errorMessage,
  fetchCatalog,
  fetchReview,
  fetchReviews,
  withdrawReview,
  type AdminReviewCard,
  type AdminReviewDetail,
  type ApiErrorCode,
} from './api'
import styles from './App.module.css'
import admin from './Admin.module.css'
import type { SectionId } from './sections'
import {
  getBridgeState,
  getInitData,
  getWebApp,
  initWebAppOnce,
  onBridgeChange,
  retryBridge,
  returnToMax,
  type BridgeState,
} from './maxBridge'
import { toSameOriginMedia } from './mediaUrl'

const PAGE_SIZE = 10
const DEBOUNCE_MS = 350
/** Сколько ждать bridge на медленной сети, прежде чем предложить повторить. */
const BRIDGE_TIMEOUT_MS = 12_000

const EditForm = lazy(() => import('./EditForm'))
const ProductsSection = lazy(() => import('./ProductsSection'))
const WebinarsSection = lazy(() => import('./WebinarsSection'))

const TABS: { id: SectionId; label: string }[] = [
  { id: 'reviews', label: 'Отзывы' },
  { id: 'products', label: 'Товары' },
  { id: 'webinars', label: 'Вебинары' },
]

function Spinner({ text }: { text: string }) {
  return (
    <p className={`${styles.status} ${styles.boot}`} role="status">
      <span className={styles.spinner} aria-hidden="true" />
      {text}
    </p>
  )
}
/** Глубокая ссылка на бота (документированный openMaxLink). Задаётся при сборке через VITE_MAX_BOT_DEEP_LINK. */
const BOT_DEEP_LINK = (import.meta.env.VITE_MAX_BOT_DEEP_LINK as string | undefined)?.trim() || null

type Screen = 'list' | 'detail'

interface ListState {
  q: string
  photos: string
  videos: string
  offset: number
  scrollY: number
}

const initialList: ListState = { q: '', photos: '', videos: '', offset: 0, scrollY: 0 }

function MediaPreview({ media, more }: { media: AdminReviewCard['media']; more: number }) {
  if (media.length === 0) return <div className={styles.noMedia}>Без медиа</div>
  return (
    <div className={styles.mediaRow} aria-hidden={false}>
      {media.slice(0, 3).map((item, index) =>
        item.type === 'image' ? (
          <img
            key={`${item.src}-${index}`}
            className={styles.thumb}
            src={toSameOriginMedia(item.thumbnailSrc || item.src)}
            alt={item.alt ?? ''}
            width={72}
            height={72}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div key={`${item.src}-${index}`} className={styles.thumbVideo}>
            {item.poster ? (
              <img className={styles.thumb} src={toSameOriginMedia(item.poster)} alt="" width={72} height={72} loading="lazy" decoding="async" />
            ) : (
              <span>▶︎ видео</span>
            )}
          </div>
        ),
      )}
      {more > 0 ? <div className={styles.moreBadge}>+{more}</div> : null}
    </div>
  )
}


export default function App() {
  const [bridge, setBridge] = useState<BridgeState>(() => getBridgeState())
  const [bridgeTimedOut, setBridgeTimedOut] = useState(false)
  const [timeoutEpoch, setTimeoutEpoch] = useState(0)
  // Подписанные данные: из bridge (window.WebApp.initData) или резерв из URL (#WebAppData) — без ожидания bridge.
  const [initData, setInitData] = useState(() => getInitData())
  const insideMax = initData.length > 0

  useEffect(() => {
    const sync = (state: BridgeState) => {
      setBridge(state)
      if (state === 'ready') {
        initWebAppOnce()
        const value = getInitData()
        if (value) setInitData((prev) => prev || value)
      }
    }
    sync(getBridgeState())
    return onBridgeChange(sync)
  }, [])

  useEffect(() => {
    if (bridge !== 'loading') return
    const timer = window.setTimeout(() => setBridgeTimedOut(true), BRIDGE_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [bridge, timeoutEpoch])

  const retryConnect = () => {
    setBridgeTimedOut(false)
    setTimeoutEpoch((n) => n + 1)
    setBridge('loading')
    retryBridge()
  }

  const [screen, setScreen] = useState<Screen>('list')
  const [list, setList] = useState<ListState>(initialList)
  const [draftQ, setDraftQ] = useState('')
  const [draftPhotos, setDraftPhotos] = useState('')
  const [draftVideos, setDraftVideos] = useState('')
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<AdminReviewCard[]>([])
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [detail, setDetail] = useState<AdminReviewDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [catalog, setCatalog] = useState<{ id: string; name: string }[] | null>(null)
  const [closeHint, setCloseHint] = useState<string | null>(null)
  const listScrollRestore = useRef<number | null>(null)
  const requestSeq = useRef(0)
  const listAbort = useRef<AbortController | null>(null)
  const [reloadTick, setReloadTick] = useState(0)

  const loadList = useCallback(
    async (state: ListState) => {
      if (!initData) return
      const seq = ++requestSeq.current
      listAbort.current?.abort()
      const controller = new AbortController()
      listAbort.current = controller
      setLoading(true)
      setError(null)
      try {
        const result = await fetchReviews(initData, {
          q: state.q,
          photos: state.photos,
          videos: state.videos,
          limit: PAGE_SIZE,
          offset: state.offset,
        }, controller.signal)
        if (seq !== requestSeq.current) return
        setItems(result.reviews)
        setTotal(result.total)
      } catch (err) {
        if (seq !== requestSeq.current) return
        const code: ApiErrorCode = err instanceof AdminApiError ? err.code : 'unknown'
        if (code === 'aborted') return
        setError(errorMessage(code))
        setItems([])
        setTotal(0)
      } finally {
        if (seq === requestSeq.current) setLoading(false)
      }
    },
    [initData],
  )

  useEffect(() => {
    if (!insideMax || !initData || screen !== 'list') return
    const handle = window.setTimeout(() => {
      void loadList({
        q: list.q,
        photos: list.photos,
        videos: list.videos,
        offset: list.offset,
        scrollY: list.scrollY,
      })
    }, 0)
    return () => window.clearTimeout(handle)
    // list.scrollY не триггерит перезагрузку — только поисковое состояние.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- намеренно узкий набор ключей списка
  }, [insideMax, initData, screen, list.q, list.photos, list.videos, list.offset, loadList, reloadTick])

  useEffect(() => () => listAbort.current?.abort(), [])

  useEffect(() => {
    if (screen !== 'list') return
    const y = listScrollRestore.current
    if (y == null) return
    listScrollRestore.current = null
    requestAnimationFrame(() => window.scrollTo(0, y))
  }, [screen, items])

  useEffect(() => {
    if (!insideMax) return
    const handle = window.setTimeout(() => {
      setList((prev) => {
        if (prev.q === draftQ) return prev
        return { ...prev, q: draftQ, offset: 0 }
      })
    }, DEBOUNCE_MS)
    return () => window.clearTimeout(handle)
  }, [draftQ, insideMax])

  const applyFilters = () => {
    setNotice(null)
    setList((prev) => ({
      ...prev,
      photos: draftPhotos.trim(),
      videos: draftVideos.trim(),
      offset: 0,
    }))
  }

  const resetFilters = () => {
    setDraftPhotos('')
    setDraftVideos('')
    setList((prev) => ({ ...prev, photos: '', videos: '', offset: 0 }))
  }

  const clearSearch = () => {
    setDraftQ('')
    setList((prev) => ({ ...prev, q: '', offset: 0 }))
  }

  const openDetail = async (id: string) => {
    listScrollRestore.current = window.scrollY
    setList((prev) => ({ ...prev, scrollY: window.scrollY }))
    setScreen('detail')
    setEditing(false)
    setDetail(null)
    setDetailLoading(true)
    setError(null)
    setNotice(null)
    try {
      const review = await fetchReview(initData, id)
      setDetail(review)
    } catch (err) {
      const code: ApiErrorCode = err instanceof AdminApiError ? err.code : 'unknown'
      setError(errorMessage(code))
      setScreen('list')
    } finally {
      setDetailLoading(false)
    }
  }

  const startEdit = () => {
    setEditing(true)
    setError(null)
    setNotice(null)
    if (!catalog) {
      fetchCatalog(initData)
        .then(setCatalog)
        .catch(() => setCatalog(null))
    }
  }

  const saveEdit = async (input: { text?: string; author?: string | null; productId?: string; removeMedia?: string[] }) => {
    if (!detail || saving) return
    setSaving(true)
    setError(null)
    try {
      const updated = await editReview(initData, detail.id, input)
      setDetail(updated)
      setEditing(false)
      setNotice('Изменения сохранены и уже видны на сайте.')
    } catch (err) {
      const code: ApiErrorCode = err instanceof AdminApiError ? err.code : 'unknown'
      setError(errorMessage(code))
    } finally {
      setSaving(false)
    }
  }

  const backToList = useCallback(() => {
    setEditing(false)
    setScreen('list')
    setDetail(null)
    setError(null)
    listScrollRestore.current = list.scrollY
  }, [list.scrollY])

  const [section, setSection] = useState<SectionId>('reviews')
  const [visited, setVisited] = useState<Record<SectionId, boolean>>({ reviews: true, products: false, webinars: false })
  const sectionScroll = useRef<Record<SectionId, number>>({ reviews: 0, products: 0, webinars: 0 })
  const [sectionBack, setSectionBackState] = useState<{ id: SectionId; fn: () => void } | null>(null)
  const [dirtyMap, setDirtyMap] = useState<Record<SectionId, boolean>>({ reviews: false, products: false, webinars: false })
  const anyDirty = dirtyMap.reviews || dirtyMap.products || dirtyMap.webinars || editing

  const makeSetBack = useCallback(
    (id: SectionId) => (fn: (() => void) | null) => setSectionBackState((prev) => (fn ? { id, fn } : prev?.id === id ? null : prev)),
    [],
  )
  const setBackProducts = useMemo(() => makeSetBack('products'), [makeSetBack])
  const setBackWebinars = useMemo(() => makeSetBack('webinars'), [makeSetBack])
  const setDirtyProducts = useCallback((d: boolean) => setDirtyMap((m) => (m.products === d ? m : { ...m, products: d })), [])
  const setDirtyWebinars = useCallback((d: boolean) => setDirtyMap((m) => (m.webinars === d ? m : { ...m, webinars: d })), [])

  const switchSection = (next: SectionId) => {
    if (next === section) {
      window.scrollTo(0, 0)
      return
    }
    sectionScroll.current[section] = window.scrollY
    setSection(next)
    setVisited((v) => (v[next] ? v : { ...v, [next]: true }))
    const y = sectionScroll.current[next]
    requestAnimationFrame(() => window.scrollTo(0, y))
  }

  // Подтверждение закрытия окна MAX, пока есть несохранённые правки (если клиент это поддерживает).
  // Включаем только при появлении правок, выключаем — только если ранее включали (bridge уже выключил при старте).
  const closingConfirm = useRef(false)
  useEffect(() => {
    if (bridge !== 'ready' || closingConfirm.current === anyDirty) return
    closingConfirm.current = anyDirty
    const app = getWebApp() as unknown as { enableClosingConfirmation?: () => void; disableClosingConfirmation?: () => void } | null
    if (!app) return
    try {
      if (anyDirty) app.enableClosingConfirmation?.()
      else app.disableClosingConfirmation?.()
    } catch {
      /* необязательная возможность клиента */
    }
  }, [anyDirty, bridge])

  const activeBack: (() => void) | null =
    section === 'reviews' ? (screen === 'detail' ? backToList : null) : sectionBack?.id === section ? sectionBack.fn : null

  useEffect(() => {
    if (bridge !== 'ready') return
    const app = getWebApp()
    if (!app?.BackButton) return
    const onBack = () => {
      activeBack?.()
    }
    if (activeBack) {
      app.BackButton.show()
      app.BackButton.onClick(onBack)
    } else {
      app.BackButton.hide()
    }
    return () => {
      app.BackButton.offClick(onBack)
      app.BackButton.hide()
    }
  }, [activeBack, bridge])

  const doWithdraw = async (id: string) => {
    if (busyId) return
    setBusyId(id)
    setError(null)
    try {
      const result = await withdrawReview(initData, id)
      setNotice(result === 'withdrawn' ? 'Отзыв удалён с сайта.' : 'Отзыв уже снят с сайта.')
      setScreen('list')
      setDetail(null)
      // Один запрос списка: перезагрузку делает эффект списка (reloadTick), без второго прямого вызова.
      setList((prev) => ({ ...prev, offset: 0 }))
      setReloadTick((n) => n + 1)
    } catch (err) {
      const code: ApiErrorCode = err instanceof AdminApiError ? err.code : 'unknown'
      setError(errorMessage(code))
    } finally {
      setBusyId(null)
    }
  }

  const onClose = () => {
    const result = returnToMax(BOT_DEEP_LINK)
    if (result === 'manual') {
      setCloseHint('Закройте окно системной кнопкой MAX (документированного метода close() нет).')
    }
  }

  const emptyText = useMemo(() => {
    if (loading) return 'Загрузка…'
    if (total === 0 && !list.q && !list.photos && !list.videos) return 'Опубликованных отзывов пока нет.'
    return 'Ничего не найдено'
  }, [loading, total, list.q, list.photos, list.videos])

  if (!insideMax && bridge === 'loading' && !bridgeTimedOut) {
    return <Spinner text="Подключение к MAX…" />
  }

  if (!insideMax && (bridge === 'error' || bridgeTimedOut)) {
    return (
      <div className={styles.app}>
        <div className={styles.gate} role="alert">
          <h1 className={styles.title}>Опубликованные отзывы</h1>
          <p className={styles.status}>
            {bridge === 'error'
              ? 'Не удалось загрузить модуль MAX — похоже, слабая связь.'
              : 'MAX отвечает слишком долго — похоже, слабая связь.'}{' '}
            Проверьте интернет и попробуйте ещё раз.
          </p>
          <div className={styles.actionsRow}>
            <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={retryConnect}>
              Повторить
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!insideMax) {
    return (
      <div className={styles.app}>
        <div className={styles.gate}>
          <h1 className={styles.title}>Опубликованные отзывы</h1>
          <p className={styles.status}>
            Откройте этот интерфейс из MAX: меню модератора → «Опубликованные отзывы». В обычном браузере список и
            действия недоступны.
          </p>
        </div>
      </div>
    )
  }

  const reviewsView =
    screen === 'detail' ? (
      <div className={styles.app}>
        <header className={styles.header}>
          <h1 className={styles.title}>Отзыв</h1>
          <div className={styles.actionsRow}>
            <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={backToList}>
              Назад к результатам
            </button>
          </div>
        </header>
        {notice ? <div className={styles.notice}>{notice}</div> : null}
        {error ? <div className={styles.error}>{error}</div> : null}
        {detailLoading || !detail ? (
          <Spinner text="Загрузка…" />
        ) : editing ? (
          <Suspense fallback={<Spinner text="Загрузка формы…" />}>
            <EditForm
              key={detail.id}
              detail={detail}
              catalog={catalog}
              saving={saving}
              onCancel={() => {
                setEditing(false)
                setError(null)
              }}
              onSave={(input) => void saveEdit(input)}
            />
          </Suspense>
        ) : (
          <section className={styles.detail}>
            <h2 className={styles.product}>{detail.productName}</h2>
            <p className={styles.meta}>
              {detail.author ? `Автор: ${detail.author}` : 'Автор не указан'}
              {detail.publishedAt ? ` · ${detail.publishedAt.slice(0, 10)}` : ''}
            </p>
            <p className={styles.meta}>
              Фото: {detail.photosCount} · Видео: {detail.videosCount}
            </p>
            <p className={styles.detailText}>{detail.text}</p>
            <div className={styles.gallery}>
              {detail.media.length === 0 ? <div className={styles.noMedia}>Без медиа</div> : null}
              {detail.media.map((item, index) =>
                item.type === 'image' ? (
                  <img key={`${item.src}-${index}`} src={toSameOriginMedia(item.src)} alt={item.alt ?? ''} loading="lazy" decoding="async" />
                ) : (
                  <video key={`${item.src}-${index}`} src={toSameOriginMedia(item.src)} poster={toSameOriginMedia(item.poster)} controls playsInline muted preload="none" />
                ),
              )}
            </div>
            <div className={styles.cardActions}>
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={backToList} disabled={busyId != null}>
                Оставить
              </button>
              <button type="button" className={styles.btn} onClick={startEdit} disabled={busyId != null}>
                Редактировать
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnDanger}`}
                onClick={() => void doWithdraw(detail.id)}
                disabled={busyId != null}
              >
                {busyId === detail.id ? 'Удаление…' : 'Удалить'}
              </button>
            </div>
          </section>
        )}
        <footer className={styles.footerBar}>
          <button type="button" className={styles.btn} onClick={onClose}>
            Закрыть окно и вернуться в MAX
          </button>
          {closeHint ? <p className={styles.closeHint}>{closeHint}</p> : null}
        </footer>
      </div>
    ) : (
    <div className={styles.app}>
      <header className={styles.header}>
        <h1 className={styles.title}>Опубликованные отзывы</h1>
        <div className={styles.searchRow}>
          <input
            className={styles.input}
            type="search"
            placeholder="Поиск по ключевым словам..."
            value={draftQ}
            onChange={(e) => setDraftQ(e.target.value)}
            enterKeyHint="search"
            autoComplete="off"
          />
          {draftQ ? (
            <button type="button" className={`${styles.btn} ${styles.btnClear}`} onClick={clearSearch} aria-label="Очистить поиск">
              ×
            </button>
          ) : null}
        </div>
        <div className={styles.filters}>
          <label className={styles.filterField}>
            <span className={styles.filterLabel}>Количество фотографий</span>
            <input
              className={styles.number}
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="пусто = без фильтра"
              value={draftPhotos}
              onChange={(e) => setDraftPhotos(e.target.value.replace(/[^\d]/g, '').slice(0, 3))}
            />
          </label>
          <label className={styles.filterField}>
            <span className={styles.filterLabel}>Количество видео</span>
            <input
              className={styles.number}
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="пусто = без фильтра"
              value={draftVideos}
              onChange={(e) => setDraftVideos(e.target.value.replace(/[^\d]/g, '').slice(0, 3))}
            />
          </label>
        </div>
        <div className={styles.actionsRow}>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={applyFilters}>
            Применить фильтры
          </button>
          <button type="button" className={styles.btn} onClick={resetFilters}>
            Сбросить фильтры
          </button>
        </div>
        <p className={styles.status}>
          {loading ? 'Загрузка…' : `Найдено: ${total}`}
          {list.photos !== '' || list.videos !== ''
            ? ` · фильтры: фото=${list.photos === '' ? '—' : list.photos}, видео=${list.videos === '' ? '—' : list.videos}`
            : ''}
        </p>
      </header>

      {notice ? <div className={styles.notice}>{notice}</div> : null}
      {error ? <div className={styles.error}>{error}</div> : null}

      {items.length === 0 ? (
        <p className={styles.status}>{emptyText}</p>
      ) : (
        <div className={styles.list}>
          {items.map((item) => {
            const more = Math.max(0, item.mediaCount - Math.min(3, item.media.length))
            return (
              <article key={item.id} className={styles.card}>
                <MediaPreview media={item.media} more={more} />
                <h2 className={styles.product}>{item.productName}</h2>
                <p className={styles.meta}>{item.author ? item.author : 'Автор не указан'}</p>
                <p className={styles.preview}>{item.textPreview}</p>
                <p className={styles.meta}>
                  Фото: {item.photosCount} · Видео: {item.videosCount}
                </p>
                <div className={styles.cardActions}>
                  <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => void openDetail(item.id)}>
                    Подробнее
                  </button>
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.btnDanger}`}
                    disabled={busyId != null}
                    onClick={() => void doWithdraw(item.id)}
                  >
                    {busyId === item.id ? 'Удаление…' : 'Удалить'}
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}

      {total > PAGE_SIZE ? (
        <div className={styles.pager}>
          <button
            type="button"
            className={styles.btn}
            disabled={list.offset <= 0 || loading}
            onClick={() => setList((prev) => ({ ...prev, offset: Math.max(0, prev.offset - PAGE_SIZE) }))}
          >
            Назад
          </button>
          <span className={styles.status}>
            {list.offset + 1}–{Math.min(list.offset + PAGE_SIZE, total)} из {total}
          </span>
          <button
            type="button"
            className={styles.btn}
            disabled={list.offset + PAGE_SIZE >= total || loading}
            onClick={() => setList((prev) => ({ ...prev, offset: prev.offset + PAGE_SIZE }))}
          >
            Дальше
          </button>
        </div>
      ) : null}

      <footer className={styles.footerBar}>
        <button type="button" className={styles.btn} onClick={onClose}>
          Закрыть окно и вернуться в MAX
        </button>
        {closeHint ? <p className={styles.closeHint}>{closeHint}</p> : null}
      </footer>
    </div>
    )

  const closeFooter = (
    <footer className={styles.footerBar}>
      <button type="button" className={styles.btn} onClick={onClose}>
        Закрыть окно и вернуться в MAX
      </button>
      {closeHint ? <p className={styles.closeHint}>{closeHint}</p> : null}
    </footer>
  )
  const sectionFallback = <Spinner text="Загрузка раздела…" />

  return (
    <>
      <div hidden={section !== 'reviews'}>{reviewsView}</div>
      {visited.products ? (
        <div hidden={section !== 'products'}>
          <Suspense fallback={sectionFallback}>
            <ProductsSection initData={initData} active={section === 'products'} setBack={setBackProducts} setDirty={setDirtyProducts} />
          </Suspense>
          <div className={styles.app}>{closeFooter}</div>
        </div>
      ) : null}
      {visited.webinars ? (
        <div hidden={section !== 'webinars'}>
          <Suspense fallback={sectionFallback}>
            <WebinarsSection initData={initData} active={section === 'webinars'} setBack={setBackWebinars} setDirty={setDirtyWebinars} />
          </Suspense>
          <div className={styles.app}>{closeFooter}</div>
        </div>
      ) : null}
      <div className={admin.tabSpacer} aria-hidden="true" />
      <nav className={admin.tabbar} aria-label="Разделы">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={admin.tab}
            aria-current={section === t.id ? 'page' : undefined}
            onClick={() => switchSection(t.id)}
          >
            {t.label}
            {dirtyMap[t.id] ? ' •' : ''}
          </button>
        ))}
      </nav>
    </>
  )
}
