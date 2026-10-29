import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatPrice } from '../data/price'
import { adminErrorText, productsApi, type AdminProductDetail, type AdminProductListItem } from './adminHttp'
import styles from './App.module.css'
import admin from './Admin.module.css'
import type { SectionProps } from './sections'

const ProductForm = lazy(() => import('./ProductForm'))

export default function ProductsSection({ initData, active, setBack, setDirty }: SectionProps) {
  const [items, setItems] = useState<AdminProductListItem[] | null>(null)
  const [editable, setEditable] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [detail, setDetail] = useState<AdminProductDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [formDirty, setFormDirty] = useState(false)
  const listScroll = useRef(0)
  const abort = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    setLoading(true)
    setError(null)
    try {
      const res = await productsApi.list(initData, controller.signal)
      setItems(res.products)
      setEditable(res.editable)
    } catch (err) {
      if (controller.signal.aborted) return
      setError(adminErrorText(err)) // прежний список (если был) остаётся на экране
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [initData])

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0)
    return () => {
      window.clearTimeout(t)
      abort.current?.abort()
    }
  }, [load])

  const openProduct = async (id: string) => {
    listScroll.current = window.scrollY
    setOpenId(id)
    setDetail(null)
    setDetailError(null)
    setNotice(null)
    window.scrollTo(0, 0)
    try {
      const res = await productsApi.get(initData, id)
      setDetail(res.product)
      setEditable(res.editable)
    } catch (err) {
      setDetailError(adminErrorText(err))
    }
  }

  const closeProduct = useCallback(
    (force = false) => {
      if (!force && formDirty && !window.confirm('Есть несохранённые изменения. Закрыть без сохранения?')) return
      setOpenId(null)
      setDetail(null)
      setFormDirty(false)
      const y = listScroll.current
      requestAnimationFrame(() => window.scrollTo(0, y))
    },
    [formDirty],
  )

  useEffect(() => {
    if (!active) return
    setBack(openId ? () => closeProduct() : null)
  }, [active, openId, closeProduct, setBack])

  useEffect(() => setDirty(formDirty), [formDirty, setDirty])

  const onSaved = (product: AdminProductDetail) => {
    setDetail(product)
    setFormDirty(false)
    setNotice('Сохранено. На сайте изменения появятся в течение минуты.')
    setItems((prev) => prev?.map((p) => (p.id === product.id ? { ...p, ...product } : p)) ?? prev)
  }

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!items) return []
    return needle ? items.filter((p) => `${p.name} ${p.brand} ${p.pack ?? ''}`.toLowerCase().includes(needle)) : items
  }, [items, q])

  if (openId) {
    return (
      <div className={styles.app} data-testid="product-screen">
        <header className={styles.header}>
          <h1 className={styles.title}>Товар</h1>
          <div className={styles.actionsRow}>
            <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => closeProduct()}>
              Назад к товарам
            </button>
          </div>
        </header>
        {notice ? <div className={styles.notice} role="status">{notice}</div> : null}
        {detailError ? (
          <div className={styles.error} role="alert">
            {detailError}{' '}
            <button type="button" className={styles.btn} onClick={() => void openProduct(openId)}>
              Повторить
            </button>
          </div>
        ) : null}
        {!detail && !detailError ? <p className={styles.status} role="status">Загрузка…</p> : null}
        {detail ? (
          <Suspense fallback={<p className={styles.status}>Загрузка формы…</p>}>
            <ProductForm
              key={`${detail.id}-${detail.updatedAt ?? 'base'}`}
              initData={initData}
              product={detail}
              editable={editable}
              onDirtyChange={setFormDirty}
              onSaved={onSaved}
            />
          </Suspense>
        ) : null}
      </div>
    )
  }

  return (
    <div className={styles.app} data-testid="products-list">
      <header className={styles.header}>
        <h1 className={styles.title}>Товары</h1>
        <div className={styles.searchRow}>
          <input
            className={styles.input}
            type="search"
            placeholder="Поиск товара..."
            aria-label="Поиск товара"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoComplete="off"
          />
        </div>
        <p className={styles.status}>{loading && !items ? 'Загрузка…' : `Товаров: ${visible.length}`}</p>
      </header>
      {!editable ? <div className={styles.error}>Редактирование товаров ещё не включено на сервере (нужна миграция 005). Сайт работает на базовом каталоге.</div> : null}
      {error ? (
        <div className={styles.error} role="alert">
          {error}{' '}
          <button type="button" className={styles.btn} onClick={() => void load()}>
            Повторить
          </button>
        </div>
      ) : null}
      <div className={styles.list}>
        {visible.map((p) => (
          <button key={p.id} type="button" className={admin.rowCard} onClick={() => void openProduct(p.id)}>
            <img
              className={admin.rowThumb}
              src={p.image.thumb ?? p.image.src}
              alt=""
              width={64}
              height={64}
              loading="lazy"
              decoding="async"
            />
            <span className={admin.rowBody}>
              <span className={admin.rowTitle}>{p.name}</span>
              <span className={styles.meta}>
                {p.brand}
                {p.pack ? ` · ${p.pack}` : ''}
              </span>
              <span className={styles.meta}>{p.price ? formatPrice(p.price) : 'Цена уточняется'}</span>
              {p.overridden.length > 0 ? <span className={admin.badge}>Изменён</span> : null}
            </span>
          </button>
        ))}
      </div>
      {items && visible.length === 0 ? <p className={styles.status}>Ничего не найдено</p> : null}
    </div>
  )
}
