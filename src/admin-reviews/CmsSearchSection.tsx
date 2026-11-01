import { useEffect, useRef, useState } from 'react'
import { AdminHttpError, adminErrorText, productsApi } from './adminHttp'
import { CATEGORIES, PRODUCT_STATUSES } from '../cms/productCard'
import { BRAND_LABELS } from '../content/copy'
import styles from './App.module.css'
import admin from './Admin.module.css'
import type { SectionProps } from './sections'

type Hit = Awaited<ReturnType<typeof productsApi.cmsSearch>>['items'][number]

export default function CmsSearchSection({ initData, active }: SectionProps) {
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [brand, setBrand] = useState('')
  const [status, setStatus] = useState('')
  const [type, setType] = useState('')
  const [scope, setScope] = useState<'all' | 'products' | 'media'>('all')
  const [updatedFrom, setUpdatedFrom] = useState('')
  const [updatedTo, setUpdatedTo] = useState('')
  const [createdFrom, setCreatedFrom] = useState('')
  const [createdTo, setCreatedTo] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [items, setItems] = useState<Hit[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    if (!active) return
    const ac = new AbortController()
    const t = window.setTimeout(() => {
      setLoading(true)
      setError(null)
      void productsApi
        .cmsSearch(
          initData,
          {
            q: q.trim() || undefined,
            category: category || undefined,
            brand: brand || undefined,
            status: status || undefined,
            type: type || undefined,
            scope,
            page,
            limit: 20,
            updatedFrom: updatedFrom ? new Date(updatedFrom).toISOString() : undefined,
            updatedTo: updatedTo ? new Date(updatedTo + 'T23:59:59').toISOString() : undefined,
            createdFrom: createdFrom ? new Date(createdFrom).toISOString() : undefined,
            createdTo: createdTo ? new Date(createdTo + 'T23:59:59').toISOString() : undefined,
          },
          ac.signal,
        )
        .then((r) => {
          if (!alive.current) return
          setItems(r.items)
          setTotal(r.total)
        })
        .catch((err) => {
          if (ac.signal.aborted) return
          setError(err instanceof AdminHttpError ? adminErrorText(err) : 'Ошибка поиска')
        })
        .finally(() => {
          if (alive.current) setLoading(false)
        })
    }, 300)
    return () => {
      window.clearTimeout(t)
      ac.abort()
    }
  }, [active, initData, q, category, brand, status, type, scope, page, updatedFrom, updatedTo, createdFrom, createdTo])

  const pages = Math.max(1, Math.ceil(total / 20))

  return (
    <div data-testid="cms-search" hidden={!active}>
      <h2 className={styles.h2}>Поиск по CMS</h2>
      <p className={styles.meta}>Товары (имя, SKU, описание, категория, бренд, теги) и имена файлов медиатеки.</p>
      <div className={admin.fieldset} style={{ display: 'grid', gap: 8 }}>
        <input className={styles.input} aria-label="Запрос" placeholder="Запрос…" value={q} onChange={(e) => { setPage(1); setQ(e.target.value) }} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <select className={styles.input} aria-label="Область" value={scope} onChange={(e) => { setPage(1); setScope(e.target.value as typeof scope) }}>
            <option value="all">Всё</option>
            <option value="products">Товары</option>
            <option value="media">Медиа</option>
          </select>
          <select className={styles.input} aria-label="Категория" value={category} onChange={(e) => { setPage(1); setCategory(e.target.value) }}>
            <option value="">Категория</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select className={styles.input} aria-label="Бренд" value={brand} onChange={(e) => { setPage(1); setBrand(e.target.value) }}>
            <option value="">Бренд</option>
            {Object.entries(BRAND_LABELS).map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
          <select className={styles.input} aria-label="Статус" value={status} onChange={(e) => { setPage(1); setStatus(e.target.value) }}>
            <option value="">Статус</option>
            {PRODUCT_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select className={styles.input} aria-label="Тип" value={type} onChange={(e) => { setPage(1); setType(e.target.value) }}>
            <option value="">Тип</option>
            <option value="device">device</option>
            <option value="supplement">supplement</option>
            <option value="goods">goods</option>
          </select>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <label className={styles.meta}>
            Создан с{' '}
            <input type="date" value={createdFrom} onChange={(e) => { setPage(1); setCreatedFrom(e.target.value) }} />
          </label>
          <label className={styles.meta}>
            по{' '}
            <input type="date" value={createdTo} onChange={(e) => { setPage(1); setCreatedTo(e.target.value) }} />
          </label>
          <label className={styles.meta}>
            Изменён с{' '}
            <input type="date" value={updatedFrom} onChange={(e) => { setPage(1); setUpdatedFrom(e.target.value) }} />
          </label>
          <label className={styles.meta}>
            по{' '}
            <input type="date" value={updatedTo} onChange={(e) => { setPage(1); setUpdatedTo(e.target.value) }} />
          </label>
        </div>
      </div>
      {error ? <p className={styles.error}>{error}</p> : null}
      {loading ? <p className={styles.meta}>Ищем…</p> : <p className={styles.meta}>Найдено: {total}</p>}
      <ul className={admin.galleryList} data-testid="cms-search-results">
        {items.map((hit) =>
          hit.kind === 'product' ? (
            <li key={`p-${hit.id}`} className={admin.galleryItem}>
              <strong>Товар</strong> · {hit.name} · SKU {hit.sku} · {hit.brand} · {hit.category}
              {hit.status ? ` · ${hit.status}` : ''}
            </li>
          ) : (
            <li key={`m-${hit.id}`} className={admin.galleryItem}>
              <strong>Медиа</strong> · {hit.name}
              {hit.title ? ` (${hit.title})` : ''} · {hit.mediaKind} · {hit.status}
            </li>
          ),
        )}
      </ul>
      <div className={styles.actionsRow}>
        <button type="button" className={styles.btn} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          Назад
        </button>
        <span className={styles.meta}>
          {page} / {pages}
        </span>
        <button type="button" className={styles.btn} disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
          Дальше
        </button>
      </div>
    </div>
  )
}
