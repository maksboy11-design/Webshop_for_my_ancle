import { useEffect, useRef, useState } from 'react'
import { AdminHttpError, adminErrorText, productsApi } from './adminHttp'
import styles from './App.module.css'
import admin from './Admin.module.css'
import type { SectionProps } from './sections'

type Item = Awaited<ReturnType<typeof productsApi.activity>>['items'][number]

export default function ActivitySection({ initData, active }: SectionProps) {
  const [userId, setUserId] = useState('')
  const [action, setAction] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [items, setItems] = useState<Item[]>([])
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
    setLoading(true)
    setError(null)
    void productsApi
      .activity(
        initData,
        {
          userId: userId.trim() || undefined,
          action: action.trim() || undefined,
          from: from ? new Date(from).toISOString() : undefined,
          to: to ? new Date(to + 'T23:59:59').toISOString() : undefined,
          page,
          limit: 30,
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
        setError(err instanceof AdminHttpError ? adminErrorText(err) : 'Ошибка журнала')
      })
      .finally(() => {
        if (alive.current) setLoading(false)
      })
    return () => ac.abort()
  }, [active, initData, userId, action, from, to, page])

  const pages = Math.max(1, Math.ceil(total / 30))

  return (
    <div data-testid="cms-activity" hidden={!active}>
      <h2 className={styles.h2}>Журнал активности</h2>
      <div className={admin.fieldset} style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <input
          className={styles.input}
          aria-label="User id"
          placeholder="user id"
          value={userId}
          onChange={(e) => {
            setPage(1)
            setUserId(e.target.value)
          }}
        />
        <input
          className={styles.input}
          aria-label="Действие"
          placeholder="action"
          value={action}
          onChange={(e) => {
            setPage(1)
            setAction(e.target.value)
          }}
        />
        <label className={styles.meta}>
          с <input type="date" value={from} onChange={(e) => { setPage(1); setFrom(e.target.value) }} />
        </label>
        <label className={styles.meta}>
          по <input type="date" value={to} onChange={(e) => { setPage(1); setTo(e.target.value) }} />
        </label>
      </div>
      {error ? <p className={styles.error}>{error}</p> : null}
      {loading ? <p className={styles.meta}>Загрузка…</p> : <p className={styles.meta}>Записей: {total}</p>}
      <ul className={admin.galleryList} data-testid="cms-activity-list">
        {items.map((it) => (
          <li key={it.id} className={admin.galleryItem}>
            <span className={styles.meta}>{new Date(it.at).toLocaleString('ru-RU')}</span>
            {' · '}
            <strong>{it.action}</strong>
            {' · '}
            {it.entityType}
            {it.entityId ? `:${it.entityId}` : ''}
            {it.userId ? ` · user ${it.userId}` : ''}
          </li>
        ))}
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
