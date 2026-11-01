/**
 * Сводная корзина: товары (product_content.deleted_at) + медиа/документы (media.deleted_at).
 * Авто-cron очистки на Hobby не добавляем (11/12 serverless-функций) — только по кнопке.
 */
import { useCallback, useEffect, useState } from 'react'
import { adminErrorText, productsApi, type AdminProductListItem } from './adminHttp'
import { mediaApi, type MediaItem } from './media/mediaApi'
import styles from './App.module.css'
import admin from './Admin.module.css'
import type { SectionProps } from './sections'

const fmt = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—'

export default function TrashSection({ initData, active, setBack, setDirty }: SectionProps) {
  const [products, setProducts] = useState<AdminProductListItem[] | null>(null)
  const [media, setMedia] = useState<MediaItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [selectedP, setSelectedP] = useState<Set<string>>(() => new Set())
  const [selectedM, setSelectedM] = useState<Set<string>>(() => new Set())
  const [retention, setRetention] = useState(30)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [p, m] = await Promise.all([
        productsApi.list(initData, { trash: true }),
        mediaApi.list(initData, { trash: true, limit: 100, page: 1 }),
      ])
      setProducts(p.products)
      if (typeof p.trashRetentionDays === 'number') setRetention(p.trashRetentionDays)
      setMedia(m.items)
    } catch (err) {
      setError(adminErrorText(err))
    }
  }, [initData])

  useEffect(() => {
    if (!active) return
    void load()
  }, [active, load])

  useEffect(() => {
    if (!active) return
    setBack(null)
    setDirty(false)
  }, [active, setBack, setDirty])

  const act = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      setSelectedP(new Set())
      setSelectedM(new Set())
      await load()
    } catch (err) {
      setError(adminErrorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.app} data-testid="trash-section">
      <header className={styles.header}>
        <h1 className={styles.title}>Корзина</h1>
        <p className={styles.meta}>
          Товары, фото и документы. Срок хранения по умолчанию: {retention} дн. Автоочистка по cron не включена (Vercel Hobby 11/12 функций)
          — удаление по кнопке или «Очистить просроченное».
        </p>
      </header>
      {notice ? (
        <div className={styles.notice} role="status">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div className={styles.error} role="alert">
          {error}
        </div>
      ) : null}

      <h2 className={admin.legend}>Товары ({products?.length ?? '…'})</h2>
      <div className={styles.actionsRow} style={{ flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        <button
          type="button"
          className={styles.btn}
          disabled={busy || !selectedP.size}
          onClick={() =>
            act(async () => {
              await productsApi.bulk(initData, [...selectedP], 'restore')
              setNotice('Товары восстановлены.')
            })
          }
        >
          Восстановить
        </button>
        <button
          type="button"
          className={styles.btn}
          disabled={busy || !selectedP.size}
          onClick={() => {
            if (!window.confirm(`Удалить навсегда ${selectedP.size} товар(ов)?`)) return
            void act(async () => {
              for (const id of selectedP) await productsApi.purge(initData, id)
              setNotice('Товары удалены навсегда.')
            })
          }}
        >
          Удалить навсегда
        </button>
        <button
          type="button"
          className={styles.btn}
          disabled={busy}
          onClick={() => {
            if (!window.confirm(`Удалить товары в корзине старше ${retention} дн.?`)) return
            void act(async () => {
              const r = await productsApi.purgeExpired(initData, retention)
              setNotice(r.purged.length ? `Очищено товаров: ${r.purged.length}` : 'Просроченных товаров нет.')
            })
          }}
        >
          Очистить просроченное
        </button>
      </div>
      <div className={styles.list}>
        {(products ?? []).map((p) => (
          <label key={p.id} className={admin.rowCard} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={selectedP.has(p.id)}
              onChange={() =>
                setSelectedP((prev) => {
                  const n = new Set(prev)
                  if (n.has(p.id)) n.delete(p.id)
                  else n.add(p.id)
                  return n
                })
              }
            />
            <span className={admin.rowBody}>
              <span className={admin.rowTitle}>{p.name}</span>
              <span className={styles.meta}>
                {p.id} · удалён {fmt(p.deletedAt)}
              </span>
            </span>
          </label>
        ))}
        {products && !products.length ? <p className={styles.status}>Нет товаров в корзине</p> : null}
      </div>

      <h2 className={admin.legend}>Медиа и документы ({media?.length ?? '…'})</h2>
      <div className={styles.actionsRow} style={{ flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        <button
          type="button"
          className={styles.btn}
          disabled={busy || !selectedM.size}
          onClick={() =>
            act(async () => {
              for (const id of selectedM) await mediaApi.restore(initData, id)
              setNotice('Файлы восстановлены.')
            })
          }
        >
          Восстановить
        </button>
        <button
          type="button"
          className={styles.btn}
          disabled={busy || !selectedM.size}
          onClick={() => {
            if (!window.confirm(`Удалить навсегда ${selectedM.size} файл(ов)? Необратимо.`)) return
            void act(async () => {
              for (const id of selectedM) await mediaApi.purge(initData, id)
              setNotice('Файлы удалены навсегда.')
            })
          }}
        >
          Удалить навсегда
        </button>
      </div>
      <div className={styles.list}>
        {(media ?? []).map((m) => (
          <label key={m.id} className={admin.rowCard} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={selectedM.has(m.id)}
              onChange={() =>
                setSelectedM((prev) => {
                  const n = new Set(prev)
                  if (n.has(m.id)) n.delete(m.id)
                  else n.add(m.id)
                  return n
                })
              }
            />
            <span className={admin.rowBody}>
              <span className={admin.rowTitle}>{m.title || m.name || m.id}</span>
              <span className={styles.meta}>
                {m.kind} · удалён {fmt(m.deletedAt)}
              </span>
            </span>
          </label>
        ))}
        {media && !media.length ? <p className={styles.status}>Нет файлов в корзине</p> : null}
      </div>
    </div>
  )
}
