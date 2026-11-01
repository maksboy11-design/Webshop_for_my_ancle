import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatPrice } from '../data/price'
import { adminErrorText, productsApi, type AdminProductDetail, type AdminProductListItem, type BulkOp } from './adminHttp'
import styles from './App.module.css'
import { AddEntries } from './AddEntries'
import admin from './Admin.module.css'
import type { SectionProps } from './sections'

const ProductForm = lazy(() => import('./ProductForm'))

const STATUS_LABEL: Record<string, string> = {
  draft: 'Черновик',
  review: 'На проверке',
  published: 'Опубликован',
  archived: 'Архив',
}

const BULK_LABELS: { op: BulkOp; label: string; danger?: boolean; needs?: 'category' | 'brand' | 'tags' | 'status' }[] = [
  { op: 'publish', label: 'Опубликовать' },
  { op: 'unpublish', label: 'Снять с публикации' },
  { op: 'set_status', label: 'Статус…', needs: 'status' },
  { op: 'set_category', label: 'Категория…', needs: 'category' },
  { op: 'set_brand', label: 'Бренд…', needs: 'brand' },
  { op: 'add_tags', label: 'Теги +', needs: 'tags' },
  { op: 'remove_tags', label: 'Теги −', needs: 'tags' },
  { op: 'archive', label: 'В архив' },
  { op: 'trash', label: 'В корзину', danger: true },
  { op: 'restore', label: 'Восстановить' },
]

const CATEGORIES = [
  ['supplements', 'БАДы'],
  ['devices', 'Приборы'],
  ['care', 'Уход'],
  ['bath', 'Ванная'],
  ['drinks', 'Напитки'],
  ['home', 'Дом'],
  ['accessories', 'Аксессуары'],
] as const

export default function ProductsSection({ initData, active, setBack, setDirty }: SectionProps) {
  const [items, setItems] = useState<AdminProductListItem[] | null>(null)
  const [editable, setEditable] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [trash, setTrash] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkProgress, setBulkProgress] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [detail, setDetail] = useState<AdminProductDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [formDirty, setFormDirty] = useState(false)
  const [retentionDays, setRetentionDays] = useState(30)
  const listScroll = useRef(0)
  const abort = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    setLoading(true)
    setError(null)
    try {
      const res = await productsApi.list(initData, {
        signal: controller.signal,
        trash,
        status: statusFilter || undefined,
      })
      setItems(res.products)
      setEditable(res.editable)
      if (typeof res.trashRetentionDays === 'number') setRetentionDays(res.trashRetentionDays)
    } catch (err) {
      if (controller.signal.aborted) return
      setError(adminErrorText(err))
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [initData, trash, statusFilter])

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0)
    return () => {
      window.clearTimeout(t)
      abort.current?.abort()
    }
  }, [load])

  useEffect(() => {
    setSelected(new Set())
  }, [trash, statusFilter])

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
      void load()
    },
    [formDirty, load],
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

  const onAutoSaved = useCallback((product: AdminProductDetail) => {
    setItems((prev) => prev?.map((p) => (p.id === product.id ? { ...p, ...product } : p)) ?? prev)
  }, [])

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!items) return []
    return needle
      ? items.filter((p) => `${p.name} ${p.brand} ${p.pack ?? ''} ${(p.tags ?? []).join(' ')}`.toLowerCase().includes(needle))
      : items
  }, [items, q])

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    setSelected((prev) => (prev.size === visible.length ? new Set() : new Set(visible.map((p) => p.id))))
  }

  const runBulk = async (op: BulkOp) => {
    const ids = [...selected]
    if (!ids.length) return
    let extra: Record<string, unknown> = {}
    if (op === 'trash' && !window.confirm(`Убрать в корзину ${ids.length} товар(ов)?`)) return
    if (op === 'archive' && !window.confirm(`Архивировать ${ids.length} товар(ов)?`)) return
    if (op === 'set_category') {
      const category = window.prompt('Категория (supplements/devices/care/bath/drinks/home/accessories):')
      if (!category) return
      extra = { category }
    }
    if (op === 'set_brand') {
      const brandId = window.prompt('Id бренда (как в каталоге):')
      if (!brandId) return
      extra = { brandId }
    }
    if (op === 'add_tags' || op === 'remove_tags') {
      const raw = window.prompt('Теги через запятую:')
      if (!raw) return
      extra = {
        tags: raw
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      }
    }
    if (op === 'set_status') {
      const status = window.prompt('Статус: draft / review / archived')
      if (!status) return
      extra = { status }
    }
    setBulkBusy(true)
    setBulkProgress(`Обработка 0 / ${ids.length}…`)
    setError(null)
    try {
      // Батч по 50 id (лимит API) — без load-all.
      const ok: string[] = []
      const failed: { id: string; error: string }[] = []
      for (let i = 0; i < ids.length; i += 50) {
        const chunk = ids.slice(i, i + 50)
        setBulkProgress(`Обработка ${Math.min(i + chunk.length, ids.length)} / ${ids.length}…`)
        const res = await productsApi.bulk(initData, chunk, op, extra)
        ok.push(...res.ok)
        failed.push(...res.failed)
      }
      setNotice(
        failed.length
          ? `Готово: ${ok.length} ок, ${failed.length} с ошибкой (${failed
              .slice(0, 3)
              .map((f) => f.id)
              .join(', ')})`
          : `Готово: ${ok.length} товар(ов).`,
      )
      setSelected(new Set())
      await load()
    } catch (err) {
      setError(adminErrorText(err))
    } finally {
      setBulkBusy(false)
      setBulkProgress(null)
    }
  }

  const purgeOne = async (id: string, name: string) => {
    if (!window.confirm(`Удалить навсегда «${name}»? Это необратимо.`)) return
    try {
      await productsApi.purge(initData, id)
      setNotice('Удалено навсегда.')
      await load()
    } catch (err) {
      setError(adminErrorText(err))
    }
  }

  const purgeExpired = async () => {
    if (!window.confirm(`Удалить навсегда товары в корзине старше ${retentionDays} дн.? Cron на Hobby не используем (слот занят).`)) return
    try {
      const r = await productsApi.purgeExpired(initData, retentionDays)
      setNotice(r.purged.length ? `Очищено: ${r.purged.length}` : 'Нечего очищать.')
      await load()
    } catch (err) {
      setError(adminErrorText(err))
    }
  }

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
        {notice ? (
          <div className={styles.notice} role="status">
            {notice}
          </div>
        ) : null}
        {detailError ? (
          <div className={styles.error} role="alert">
            {detailError}{' '}
            <button type="button" className={styles.btn} onClick={() => void openProduct(openId)}>
              Повторить
            </button>
          </div>
        ) : null}
        {!detail && !detailError ? (
          <p className={styles.status} role="status">
            Загрузка…
          </p>
        ) : null}
        {detail ? (
          <Suspense fallback={<p className={styles.status}>Загрузка формы…</p>}>
            <ProductForm
              key={`${detail.id}-${detail.updatedAt ?? 'base'}`}
              initData={initData}
              product={detail}
              editable={editable}
              onDirtyChange={setFormDirty}
              onSaved={onSaved}
              onAutoSaved={onAutoSaved}
              onDuplicated={(newId) => {
                setNotice(`Создан дубликат: ${newId}`)
                void openProduct(newId)
              }}
            />
          </Suspense>
        ) : null}
      </div>
    )
  }

  const bulkOps = BULK_LABELS.filter((b) => (trash ? b.op === 'restore' || b.op === 'trash' : b.op !== 'restore'))

  return (
    <div className={styles.app} data-testid="products-list">
      <header className={styles.header}>
        <h1 className={styles.title}>{trash ? 'Корзина товаров' : 'Товары'}</h1>
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
        <div className={styles.actionsRow} style={{ flexWrap: 'wrap', gap: 8 }}>
          <label className={styles.meta}>
            <input type="checkbox" checked={trash} onChange={(e) => setTrash(e.target.checked)} /> Корзина
          </label>
          {!trash ? (
            <select
              className={styles.input}
              aria-label="Фильтр статуса"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{ maxWidth: 160 }}
            >
              <option value="">Все статусы</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          ) : (
            <button type="button" className={styles.btn} onClick={() => void purgeExpired()} disabled={bulkBusy}>
              Очистить старше {retentionDays} дн.
            </button>
          )}
        </div>
        <p className={styles.status}>
          {loading && !items ? 'Загрузка…' : `Товаров: ${visible.length}`}
          {selected.size ? ` · выбрано ${selected.size}` : ''}
          {bulkProgress ? ` · ${bulkProgress}` : ''}
        </p>
      </header>
      {!trash ? <AddEntries kind="product" initData={initData} active={active} /> : null}
      {!editable ? (
        <div className={styles.error}>
          Редактирование товаров ещё не включено на сервере (нужна миграция 005). Сайт работает на базовом каталоге.
        </div>
      ) : null}
      {trash ? (
        <p className={styles.meta}>
          Хранение в корзине: {retentionDays} дн. Авто-cron не включён (Vercel Hobby 11/12 функций) — очистка по кнопке.
        </p>
      ) : null}
      {notice ? (
        <div className={styles.notice} role="status">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div className={styles.error} role="alert">
          {error}{' '}
          <button type="button" className={styles.btn} onClick={() => void load()}>
            Повторить
          </button>
        </div>
      ) : null}

      {selected.size > 0 ? (
        <div className={styles.actionsRow} style={{ flexWrap: 'wrap', gap: 6, marginBottom: 8 }} data-testid="bulk-bar">
          {bulkOps.map((b) => (
            <button
              key={b.op}
              type="button"
              className={`${styles.btn} ${b.danger ? '' : styles.btnPrimary}`}
              disabled={bulkBusy}
              onClick={() => void runBulk(b.op)}
            >
              {b.label}
            </button>
          ))}
          {trash ? (
            <button
              type="button"
              className={styles.btn}
              disabled={bulkBusy}
              onClick={() => {
                if (!window.confirm(`Удалить навсегда ${selected.size} товар(ов)? Необратимо.`)) return
                void (async () => {
                  setBulkBusy(true)
                  try {
                    for (const id of selected) await productsApi.purge(initData, id)
                    setSelected(new Set())
                    await load()
                    setNotice('Удалено навсегда.')
                  } catch (err) {
                    setError(adminErrorText(err))
                  } finally {
                    setBulkBusy(false)
                  }
                })()
              }}
            >
              Удалить навсегда
            </button>
          ) : null}
        </div>
      ) : null}

      <div className={styles.actionsRow} style={{ marginBottom: 8 }}>
        <label className={styles.meta}>
          <input type="checkbox" checked={visible.length > 0 && selected.size === visible.length} onChange={toggleAll} /> Выбрать все на
          экране
        </label>
      </div>

      <div className={styles.list}>
        {visible.map((p) => (
          <div key={p.id} className={admin.rowCard} style={{ display: 'flex', alignItems: 'stretch', gap: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', padding: '0 4px' }} onClick={(e) => e.stopPropagation()}>
              <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleOne(p.id)} aria-label={`Выбрать ${p.name}`} />
            </label>
            <button
              type="button"
              className={admin.rowCard}
              style={{ flex: 1, border: 'none', boxShadow: 'none' }}
              onClick={() => void openProduct(p.id)}
            >
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
                  {p.status ? ` · ${STATUS_LABEL[p.status] ?? p.status}` : ''}
                </span>
                <span className={styles.meta}>{p.price ? formatPrice(p.price) : 'Цена уточняется'}</span>
                {p.deletedAt ? <span className={styles.meta}>Удалён: {new Date(p.deletedAt).toLocaleString('ru-RU')}</span> : null}
                {p.overridden.length > 0 ? <span className={admin.badge}>Изменён</span> : null}
              </span>
            </button>
            {trash ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 4 }}>
                <button
                  type="button"
                  className={styles.btn}
                  disabled={bulkBusy}
                  onClick={() => {
                    void (async () => {
                      try {
                        await productsApi.restore(initData, p.id)
                        setNotice('Восстановлено.')
                        await load()
                      } catch (err) {
                        setError(adminErrorText(err))
                      }
                    })()
                  }}
                >
                  Восстановить
                </button>
                <button type="button" className={styles.btn} onClick={() => void purgeOne(p.id, p.name)}>
                  Удалить
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
      {items && visible.length === 0 ? <p className={styles.status}>{trash ? 'Корзина пуста' : 'Ничего не найдено'}</p> : null}
      {/* категории для подсказки bulk — скрытый справочник */}
      <span hidden>{CATEGORIES.map((c) => c[0]).join(',')}</span>
    </div>
  )
}
