/* eslint-disable react-refresh/only-export-components -- плитка, тулбар и хук списка медиатеки живут вместе */
/** Сетка медиатеки с серверным поиском, фильтром, сортировкой и страницами. Используется в разделе и в выборе для галереи. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { formatBytes, type MediaKind } from '../../cms/mediaTypes'
import { adminErrorText } from '../adminHttp'
import styles from '../App.module.css'
import m from './Media.module.css'
import { mediaApi, type MediaItem, type MediaListParams } from './mediaApi'

export const KIND_LABEL: Record<MediaKind, string> = { image: 'Изображение', video: 'Видео', document: 'PDF' }
const PAGE = 24

export function MediaTile({ item, pressed, onClick }: { item: MediaItem; pressed?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={m.tile}
      aria-pressed={pressed ? 'true' : 'false'}
      onClick={onClick}
      data-testid="media-tile"
      title={item.name}
    >
      {item.thumb ? (
        <img className={m.tileImg} src={item.thumb} alt="" loading="lazy" decoding="async" />
      ) : (
        <span className={m.tileImg} aria-hidden="true">
          {item.kind === 'video' ? '▶ Видео' : item.kind === 'document' ? 'PDF' : item.status === 'processing' ? 'Обработка…' : 'Фото'}
        </span>
      )}
      <span className={m.tileName}>{item.name}</span>
      <span className={m.hintText}>
        {formatBytes(item.size)}
        {item.status === 'processing' ? ' · обработка' : item.status === 'failed' ? ' · ошибка' : ''}
      </span>
    </button>
  )
}

export interface BrowserState {
  q: string
  kind: MediaKind | ''
  sort: 'date' | 'size'
  dir: 'asc' | 'desc'
  page: number
  trash: boolean
}

export function useMediaList(initData: string, init: Partial<BrowserState> = {}) {
  const [st, setSt] = useState<BrowserState>({ q: '', kind: '', sort: 'date', dir: 'desc', page: 1, trash: false, ...init })
  const [data, setData] = useState<{ total: number; items: MediaItem[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const [nonce, setNonce] = useState(0)
  const reload = useCallback(() => setNonce((n) => n + 1), [])
  useEffect(() => {
    const t = window.setTimeout(
      () => {
        abort.current?.abort()
        const c = new AbortController()
        abort.current = c
        setLoading(true)
        const p: MediaListParams = { ...st, limit: PAGE }
        mediaApi
          .list(initData, p, c.signal)
          .then((r) => {
            setData({ total: r.total, items: r.items })
            setError(null)
          })
          .catch((err) => {
            if (!c.signal.aborted) setError(adminErrorText(err))
          })
          .finally(() => {
            if (!c.signal.aborted) setLoading(false)
          })
      },
      st.q ? 250 : 0,
    )
    return () => window.clearTimeout(t)
  }, [initData, st, nonce])
  useEffect(() => () => abort.current?.abort(), [])
  const update = (patch: Partial<BrowserState>) => setSt((s) => ({ ...s, page: 1, ...patch }))
  return {
    st,
    update,
    setPage: (page: number) => setSt((s) => ({ ...s, page })),
    data,
    error,
    loading,
    reload,
    pages: Math.max(1, Math.ceil((data?.total ?? 0) / PAGE)),
  }
}

export function MediaToolbar({
  list,
  fixedKind,
  showTrash,
}: {
  list: ReturnType<typeof useMediaList>
  fixedKind?: boolean
  showTrash?: boolean
}) {
  const { st, update } = list
  return (
    <div className={m.toolbar}>
      <input
        type="search"
        placeholder="Поиск по имени"
        aria-label="Поиск по имени файла"
        value={st.q}
        onChange={(e) => update({ q: e.target.value })}
      />
      {!fixedKind ? (
        <select aria-label="Тип файла" value={st.kind} onChange={(e) => update({ kind: e.target.value as MediaKind | '' })}>
          <option value="">Все типы</option>
          <option value="image">Изображения</option>
          <option value="video">Видео</option>
          <option value="document">PDF</option>
        </select>
      ) : null}
      <select
        aria-label="Сортировка"
        value={`${st.sort}-${st.dir}`}
        onChange={(e) => {
          const [sort, dir] = e.target.value.split('-') as ['date' | 'size', 'asc' | 'desc']
          update({ sort, dir })
        }}
      >
        <option value="date-desc">Сначала новые</option>
        <option value="date-asc">Сначала старые</option>
        <option value="size-desc">Сначала большие</option>
        <option value="size-asc">Сначала маленькие</option>
      </select>
      {showTrash ? (
        <label>
          <input type="checkbox" checked={st.trash} onChange={(e) => update({ trash: e.target.checked })} /> Корзина
        </label>
      ) : null}
    </div>
  )
}

export function MediaPager({ list }: { list: ReturnType<typeof useMediaList> }) {
  if (list.pages <= 1) return null
  return (
    <div className={m.pager}>
      <button type="button" className={styles.btn} disabled={list.st.page <= 1} onClick={() => list.setPage(list.st.page - 1)}>
        Назад
      </button>
      <span>
        {list.st.page} / {list.pages}
      </span>
      <button type="button" className={styles.btn} disabled={list.st.page >= list.pages} onClick={() => list.setPage(list.st.page + 1)}>
        Далее
      </button>
    </div>
  )
}
