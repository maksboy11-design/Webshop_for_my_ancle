import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SecureClipboardService } from '../service'
import type { ClipboardEntryRow, ClipboardPayload, ClipboardScope } from '../types'
import { canPasteTo, previewText } from '../serialize'
import styles from '../Clipboard.module.css'
import app from '../../App.module.css'

function fmt(iso: string) {
  try {
    return new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return iso
  }
}

export function ClipboardHistoryPanel({
  service,
  scope,
  onPaste,
  onClose,
}: {
  service: SecureClipboardService
  scope: ClipboardScope
  onPaste: (payload: ClipboardPayload) => void
  onClose: () => void
}) {
  const [items, setItems] = useState<ClipboardEntryRow[]>([])
  const [total, setTotal] = useState(0)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [decoded, setDecoded] = useState<Record<string, ClipboardPayload | { error: string }>>({})

  const load = useCallback(async () => {
    setBusy(true)
    setErr(null)
    try {
      const r = await service.list(0, 50)
      setItems(r.items)
      setTotal(r.total)
    } catch (e) {
      setErr((e as { code?: string })?.code ?? 'load_failed')
    } finally {
      setBusy(false)
    }
  }, [service])

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 15_000)
    return () => clearInterval(t)
  }, [load])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      for (const e of items) {
        if (decoded[e.id] || cancelled) continue
        try {
          const p = await service.decrypt(e)
          if (!cancelled) setDecoded((d) => ({ ...d, [e.id]: p }))
        } catch {
          if (!cancelled) setDecoded((d) => ({ ...d, [e.id]: { error: 'decrypt_failed' } }))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [items, service, decoded])

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return items.filter((e) => {
      const d = decoded[e.id]
      if (!d || 'error' in d) return !needle
      if (!canPasteTo(scope, d)) return false
      if (!needle) return true
      return (
        d.label.toLowerCase().includes(needle) ||
        d.kind.toLowerCase().includes(needle) ||
        previewText(d).toLowerCase().includes(needle) ||
        (d.source?.pageTitle ?? '').toLowerCase().includes(needle) ||
        (d.source?.productName ?? '').toLowerCase().includes(needle)
      )
    })
  }, [items, decoded, q, scope])

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label="Защищённый буфер" data-testid="clipboard-panel" onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.head}>
          <h2 className={styles.title}>Защищённый буфер</h2>
          <span className={styles.lock} title="Шифрование на устройстве">
            E2EE
          </span>
          <button type="button" className={app.btn} onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>
        <input
          className={`${app.input} ${styles.search}`}
          placeholder="Поиск…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Поиск по буферу"
        />
        <div className={styles.list}>
          {busy && !items.length ? <p className={styles.empty}>Загрузка…</p> : null}
          {err ? <p className={styles.error}>Не удалось загрузить историю ({err}).</p> : null}
          {!busy && !err && !visible.length ? <p className={styles.empty}>Буфер пуст или нет подходящих элементов.</p> : null}
          {visible.map((e) => {
            const d = decoded[e.id]
            const broken = d && 'error' in d
            const payload = d && !('error' in d) ? d : null
            return (
              <div key={e.id} className={`${styles.card} ${e.pinned ? styles.cardPinned : ''}`} data-testid="clipboard-entry">
                <button
                  type="button"
                  className={styles.card}
                  style={{ border: 'none', padding: 0, boxShadow: 'none' }}
                  disabled={!!broken || !payload}
                  onClick={() => payload && onPaste(payload)}
                >
                  <span className={styles.kind}>{payload?.label ?? (broken ? 'Повреждено' : '…')}</span>
                  <span className={styles.preview}>{payload ? previewText(payload) : broken ? 'Не удалось расшифровать' : 'Расшифровка…'}</span>
                  <span className={styles.meta}>
                    {fmt(e.createdAt)}
                    {payload?.source?.pageTitle ? ` · ${payload.source.pageTitle}` : ''}
                    {payload?.source?.productName ? ` · ${payload.source.productName}` : ''}
                    {e.pinned ? ' · закреплено' : ''}
                  </span>
                </button>
                <div className={styles.row}>
                  <button type="button" className={app.btn} disabled={!payload} onClick={() => payload && onPaste(payload)}>
                    Вставить
                  </button>
                  <button
                    type="button"
                    className={app.btn}
                    onClick={() => void service.pin(e.id, !e.pinned).then(load)}
                  >
                    {e.pinned ? 'Открепить' : 'Закрепить'}
                  </button>
                  <button
                    type="button"
                    className={app.btn}
                    onClick={() => window.confirm('Удалить запись из буфера?') && void service.remove(e.id).then(load)}
                  >
                    Удалить
                  </button>
                </div>
              </div>
            )
          })}
        </div>
        <div className={styles.row} style={{ padding: '8px 14px 12px' }}>
          <span className={styles.meta}>{total} записей</span>
          <span style={{ flex: 1 }} />
          <button type="button" className={app.btn} onClick={() => window.confirm('Очистить незакреплённые?') && void service.clear(true).then(load)}>
            Очистить незакреплённые
          </button>
        </div>
      </div>
    </div>
  )
}
