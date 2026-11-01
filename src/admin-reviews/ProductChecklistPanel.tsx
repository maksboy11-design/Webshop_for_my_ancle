import { useState } from 'react'
import { AdminHttpError, adminErrorText, productsApi } from './adminHttp'
import styles from './App.module.css'
import admin from './Admin.module.css'

export function ProductChecklistPanel({ initData, productId }: { initData: string; productId: string }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<Awaited<ReturnType<typeof productsApi.checklist>> | null>(null)

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await productsApi.checklist(initData, productId)
      setData(r)
      setOpen(true)
    } catch (err) {
      setError(err instanceof AdminHttpError ? adminErrorText(err) : 'Ошибка проверки')
    } finally {
      setBusy(false)
    }
  }

  const jump = (field: string) => {
    const el = document.querySelector(`[data-field="${CSS.escape(field)}"]`) as HTMLElement | null
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.focus?.()
    el.classList.add(admin.legend)
  }

  return (
    <div data-testid="product-checklist">
      <button type="button" className={styles.btn} disabled={busy} onClick={() => void run()}>
        {busy ? 'Проверка…' : 'Проверить товар'}
      </button>
      {error ? <p className={styles.error}>{error}</p> : null}
      {open && data ? (
        <div className={admin.fieldset} style={{ marginTop: 8 }}>
          <p className={admin.legend}>
            Чеклист: {data.ok ? 'ошибок нет' : `${data.errors} ошибок`}
            {data.warns ? `, предупреждений ${data.warns}` : ''}
          </p>
          {data.items.length === 0 ? (
            <p className={styles.meta}>Всё в порядке.</p>
          ) : (
            <ul className={admin.galleryList}>
              {data.items.map((it) => (
                <li key={it.id} className={admin.galleryItem}>
                  <span className={styles.meta}>{it.severity === 'error' ? 'Ошибка' : '⚠'}</span> {it.message}{' '}
                  <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => jump(it.field)}>
                    К полю
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => setOpen(false)}>
            Скрыть
          </button>
        </div>
      ) : null}
    </div>
  )
}
