/** Раздел «Страницы»: список (поиск, статус, корзина, пагинация) и редактор. */
import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { adminErrorText } from '../adminHttp'
import type { SectionProps } from '../sections'
import styles from '../App.module.css'
import m from '../media/Media.module.css'
import p from './Pages.module.css'
import { pagesApi, type PageSummary } from './pagesApi'
import { pageHref } from '../../cms/pageDoc'

const PageEditor = lazy(() => import('./PageEditor'))
const LIMIT = 20

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—')

export default function PagesSection({ initData, active, setBack, setDirty }: SectionProps) {
  const api = pagesApi(initData)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<'all' | 'draft' | 'published'>('all')
  const [trash, setTrash] = useState(false)
  const [offset, setOffset] = useState(0)
  const [data, setData] = useState<{ items: PageSummary[]; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const [open, setOpen] = useState<string | null>(null)
  const refresh = useCallback(() => setReload((n) => n + 1), [])

  useEffect(() => {
    const ac = new AbortController()
    const t = setTimeout(() => {
      pagesApi(initData)
        .list({ q, status, trash, offset, limit: LIMIT }, ac.signal)
        .then((r) => {
          setData(r)
          setError(null)
        })
        .catch((e) => {
          if (!ac.signal.aborted) setError(adminErrorText(e))
        })
    }, 250)
    return () => {
      clearTimeout(t)
      ac.abort()
    }
  }, [initData, q, status, trash, offset, reload])

  const close = useCallback(() => {
    setOpen(null)
    setDirty(false)
    refresh()
  }, [refresh, setDirty])
  useEffect(() => {
    if (!active) return
    setBack(open ? close : null)
  }, [active, open, close, setBack])

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      refresh()
    } catch (e) {
      setError(adminErrorText(e))
    } finally {
      setBusy(false)
    }
  }

  if (open) {
    return (
      <div className={styles.app}>
        <Suspense fallback={<p className={m.hintText}>Загрузка редактора…</p>}>
          <PageEditor key={open} initData={initData} pageId={open} onClose={close} onOpen={setOpen} setDirty={setDirty} />
        </Suspense>
      </div>
    )
  }

  const create = () =>
    act(async () => {
      const r = await api.create('Новая страница')
      setOpen(r.page.id)
    })

  const trashPage = (x: PageSummary) =>
    act(async () => {
      if (!window.confirm(`Убрать страницу «${x.title}» в корзину?`)) return
      try {
        await api.trash(x.id, false)
      } catch (e) {
        const refs = (e as { body?: { referencedBy?: { title: string }[] } }).body?.referencedBy
        if (!refs?.length) throw e
        const names = refs.map((r) => `«${r.title}»`).join(', ')
        if (!window.confirm(`На эту страницу ведут кнопки: ${names}. Эти кнопки перестанут работать. Всё равно убрать в корзину?`)) return
        await api.trash(x.id, true)
      }
    })

  const pages = data ? Math.max(1, Math.ceil(data.total / LIMIT)) : 1
  return (
    <div className={styles.app} data-testid="pages-section">
      <header className={p.head}>
        <h1 className={styles.title}>Страницы</h1>
        <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={create} disabled={busy || trash}>
          + Создать страницу
        </button>
      </header>
      <div className={p.filters}>
        <input
          className={styles.input}
          type="search"
          placeholder="Поиск по названию или адресу"
          aria-label="Поиск страниц"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setOffset(0)
          }}
        />
        <select
          className={styles.input}
          aria-label="Статус"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as typeof status)
            setOffset(0)
          }}
        >
          <option value="all">Все</option>
          <option value="published">Опубликованные</option>
          <option value="draft">Черновики</option>
        </select>
        <label className={p.check}>
          <input
            type="checkbox"
            checked={trash}
            onChange={(e) => {
              setTrash(e.target.checked)
              setOffset(0)
            }}
          />
          Корзина
        </label>
      </div>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {!data && !error ? <p className={m.hintText}>Загрузка…</p> : null}
      {data && !data.items.length ? <p className={m.hintText}>{trash ? 'Корзина пуста.' : 'Страниц пока нет.'}</p> : null}
      <ul className={p.list}>
        {data?.items.map((x) => (
          <li key={x.id} className={p.row} data-testid="page-row">
            <div className={p.rowMain}>
              <strong>{x.title}</strong>
              <span className={m.hintText}>
                /{x.slug} · {x.status === 'published' ? (x.changed ? 'опубликована, есть изменения' : 'опубликована') : 'черновик'} ·
                изменена {fmt(x.updatedAt)}
              </span>
            </div>
            <div className={p.rowActions}>
              {trash ? (
                <button type="button" className={styles.btn} disabled={busy} onClick={() => act(() => api.restore(x.id))}>
                  Восстановить
                </button>
              ) : (
                <>
                  <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => setOpen(x.id)}>
                    Изменить
                  </button>
                  {x.status === 'published' ? (
                    <a className={styles.btn} href={`/${pageHref(x.slug)}`} target="_blank" rel="noopener noreferrer">
                      Открыть
                    </a>
                  ) : null}
                  {x.status === 'published' ? (
                    <button type="button" className={styles.btn} disabled={busy} onClick={() => act(() => api.unpublish(x.id))}>
                      Снять с публикации
                    </button>
                  ) : (
                    <button type="button" className={styles.btn} disabled={busy} onClick={() => act(() => api.publish(x.id))}>
                      Опубликовать
                    </button>
                  )}
                  <button type="button" className={styles.btn} disabled={busy} onClick={() => act(() => api.duplicate(x.id))}>
                    Дублировать
                  </button>
                  <button type="button" className={styles.btn} disabled={busy} onClick={() => trashPage(x)}>
                    В корзину
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      {data && pages > 1 ? (
        <div className={styles.actionsRow}>
          <button type="button" className={styles.btn} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>
            ← Назад
          </button>
          <span className={m.hintText}>
            {offset / LIMIT + 1} из {pages}
          </span>
          <button type="button" className={styles.btn} disabled={offset + LIMIT >= data.total} onClick={() => setOffset(offset + LIMIT)}>
            Дальше →
          </button>
        </div>
      ) : null}
    </div>
  )
}
