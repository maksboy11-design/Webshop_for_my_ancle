import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AdminApiError,
  AUTHOR_MAX,
  editReview,
  errorMessage,
  fetchCatalog,
  REVIEW_TEXT_MAX,
  fetchReview,
  fetchReviews,
  withdrawReview,
  type AdminReviewCard,
  type AdminReviewDetail,
  type ApiErrorCode,
} from './api'
import styles from './App.module.css'
import { getInitData, getWebApp, isInsideMax, returnToMax } from './maxBridge'
import { toSameOriginMedia } from './mediaUrl'

const PAGE_SIZE = 10
const DEBOUNCE_MS = 350
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
            src={toSameOriginMedia(item.src)}
            alt={item.alt ?? ''}
           
            decoding="async"
          />
        ) : (
          <div key={`${item.src}-${index}`} className={styles.thumbVideo}>
            {item.poster ? (
              <img className={styles.thumb} src={toSameOriginMedia(item.poster)} alt="" decoding="async" />
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

function charCount(value: string): number {
  return Array.from(value.trim()).length
}

function EditForm({
  detail,
  catalog,
  saving,
  onCancel,
  onSave,
}: {
  detail: AdminReviewDetail
  catalog: { id: string; name: string }[] | null
  saving: boolean
  onCancel: () => void
  onSave: (input: { text?: string; author?: string | null; productId?: string; removeMedia?: string[] }) => void
}) {
  const [text, setText] = useState(detail.text)
  const [author, setAuthor] = useState(detail.author ?? '')
  const [productId, setProductId] = useState(detail.productId)
  const [removed, setRemoved] = useState<string[]>([])
  const textLen = charCount(text)
  const authorLen = charCount(author)
  const validation =
    textLen === 0
      ? 'Текст отзыва не может быть пустым.'
      : textLen > REVIEW_TEXT_MAX
        ? `Текст отзыва длиннее ${REVIEW_TEXT_MAX} символов.`
        : authorLen > AUTHOR_MAX
          ? `Имя автора длиннее ${AUTHOR_MAX} символов.`
          : null
  const options = catalog ?? [{ id: detail.productId, name: detail.productName }]
  const hasCurrent = options.some((o) => o.id === detail.productId)

  const removeMedia = (src: string, type: 'image' | 'video') => {
    const label = type === 'image' ? 'фото' : 'видео'
    if (!window.confirm(`Убрать это ${label} из отзыва? Изменение применится после «Сохранить».`)) return
    setRemoved((prev) => [...prev, src])
  }

  const submit = () => {
    if (validation || saving) return
    const input: { text?: string; author?: string | null; productId?: string; removeMedia?: string[] } = {}
    if (text.trim() !== detail.text) input.text = text
    const nextAuthor = author.trim() === '' ? null : author.trim()
    if (nextAuthor !== detail.author) input.author = nextAuthor
    if (productId !== detail.productId) input.productId = productId
    if (removed.length > 0) input.removeMedia = removed
    if (Object.keys(input).length === 0) {
      onCancel()
      return
    }
    onSave(input)
  }

  const visibleMedia = detail.media.filter((m) => !removed.includes(m.src))

  return (
    <section className={`${styles.detail} ${styles.editForm}`}>
      <label className={styles.filterField}>
        <span className={styles.filterLabel}>Товар</span>
        <select className={styles.input} value={productId} onChange={(e) => setProductId(e.target.value)} disabled={saving}>
          {!hasCurrent ? <option value={detail.productId}>{detail.productName}</option> : null}
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.filterField}>
        <span className={styles.filterLabel}>Автор (пусто = не указан)</span>
        <input className={styles.input} value={author} onChange={(e) => setAuthor(e.target.value)} disabled={saving} />
        <span className={styles.counter}>
          {authorLen}/{AUTHOR_MAX}
        </span>
      </label>
      <label className={styles.filterField}>
        <span className={styles.filterLabel}>Текст отзыва</span>
        <textarea
          className={`${styles.input} ${styles.textarea}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={saving}
        />
        <span className={styles.counter}>
          {textLen}/{REVIEW_TEXT_MAX}
        </span>
      </label>
      <div className={styles.gallery}>
        {visibleMedia.length === 0 ? <div className={styles.noMedia}>Без медиа</div> : null}
        {visibleMedia.map((item, index) => (
          <div key={`${item.src}-${index}`} className={styles.editMedia}>
            {item.type === 'image' ? (
              <img src={toSameOriginMedia(item.src)} alt={item.alt ?? ''} />
            ) : (
              <video src={toSameOriginMedia(item.src)} poster={toSameOriginMedia(item.poster)} controls playsInline muted preload="metadata" />
            )}
            <button
              type="button"
              className={`${styles.btn} ${styles.btnDanger}`}
              onClick={() => removeMedia(item.src, item.type)}
              disabled={saving}
            >
              {item.type === 'image' ? 'Удалить фото' : 'Удалить видео'}
            </button>
          </div>
        ))}
      </div>
      {validation ? <div className={styles.error}>{validation}</div> : null}
      <div className={styles.cardActions}>
        <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={submit} disabled={saving || validation != null}>
          {saving ? 'Сохранение…' : 'Сохранить'}
        </button>
        <button type="button" className={styles.btn} onClick={onCancel} disabled={saving}>
          Отмена
        </button>
      </div>
    </section>
  )
}

export default function App() {
  const [initData, setInitData] = useState(() => getInitData())
  const insideMax = initData.length > 0
  const [bridgeWaitDone, setBridgeWaitDone] = useState(() => isInsideMax())
  useEffect(() => {
    if (initData) return
    // Bridge может загрузиться/заполнить initData позже первого рендера: ждём до ~2.5 с.
    const started = Date.now()
    const timer = window.setInterval(() => {
      const value = getInitData()
      if (value) {
        setInitData(value)
        setBridgeWaitDone(true)
        window.clearInterval(timer)
      } else if (Date.now() - started > 2500) {
        setBridgeWaitDone(true)
        window.clearInterval(timer)
      }
    }, 100)
    return () => window.clearInterval(timer)
  }, [initData])
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

  useEffect(() => {
    const app = getWebApp()
    app?.expand?.()
    // Без closing confirmation: при повторном открытии в той же сессии MAX
    // зависшее подтверждение закрытия ломало запуск («Техническая ошибка»).
    app?.disableClosingConfirmation?.()
  }, [])

  const loadList = useCallback(
    async (state: ListState) => {
      if (!initData) return
      const seq = ++requestSeq.current
      setLoading(true)
      setError(null)
      try {
        const result = await fetchReviews(initData, {
          q: state.q,
          photos: state.photos,
          videos: state.videos,
          limit: PAGE_SIZE,
          offset: state.offset,
        })
        if (seq !== requestSeq.current) return
        setItems(result.reviews)
        setTotal(result.total)
      } catch (err) {
        if (seq !== requestSeq.current) return
        const code: ApiErrorCode = err instanceof AdminApiError ? err.code : 'unknown'
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
  }, [insideMax, initData, screen, list.q, list.photos, list.videos, list.offset, loadList])

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

  useEffect(() => {
    const app = getWebApp()
    if (!app?.BackButton) return
    const onBack = () => {
      if (screen === 'detail') backToList()
    }
    if (screen === 'detail') {
      app.BackButton.show()
      app.BackButton.onClick(onBack)
    } else {
      app.BackButton.hide()
    }
    return () => {
      app.BackButton.offClick(onBack)
      app.BackButton.hide()
    }
  }, [screen, backToList])

  const doWithdraw = async (id: string) => {
    if (busyId) return
    setBusyId(id)
    setError(null)
    try {
      const result = await withdrawReview(initData, id)
      setNotice(result === 'withdrawn' ? 'Отзыв удалён с сайта.' : 'Отзыв уже снят с сайта.')
      setScreen('list')
      setDetail(null)
      setList((prev) => ({ ...prev, offset: 0 }))
      await loadList({ ...list, offset: 0 })
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

  if (!insideMax && !bridgeWaitDone) {
    return <p style={{ font: '16px/1.4 system-ui, sans-serif', padding: 24 }}>Подключение к MAX…</p>
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

  if (screen === 'detail') {
    return (
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
          <p className={styles.status}>Загрузка…</p>
        ) : editing ? (
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
                  <img key={`${item.src}-${index}`} src={toSameOriginMedia(item.src)} alt={item.alt ?? ''} />
                ) : (
                  <video key={`${item.src}-${index}`} src={toSameOriginMedia(item.src)} poster={toSameOriginMedia(item.poster)} controls playsInline muted preload="metadata" />
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
    )
  }

  return (
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
}
