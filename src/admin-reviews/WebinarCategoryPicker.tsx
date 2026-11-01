/** Категория вебинара из бота: «о продукции» / «с врачами». Сохраняется сразу при выборе. */
import { useEffect, useState } from 'react'
import { adminErrorText, adminRequest, AdminHttpError } from './adminHttp'
import admin from './Admin.module.css'
import { WEBINAR_CATEGORY_OPTIONS } from './entriesModel'

type Category = (typeof WEBINAR_CATEGORY_OPTIONS)[number]['value']

export function WebinarCategoryPicker({ initData, webinarId }: { initData: string; webinarId: string }) {
  const [value, setValue] = useState<Category | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    adminRequest<{ categories: Record<string, Category> }>(initData, `/api/admin/entries?webinarIds=${encodeURIComponent(webinarId)}`)
      .then((r) => alive && setValue(r.categories[webinarId] ?? 'products'))
      .catch(() => alive && setValue('products'))
    return () => {
      alive = false
    }
  }, [initData, webinarId])

  async function choose(next: Category) {
    if (next === value || busy) return
    setBusy(true)
    setNote(null)
    try {
      await adminRequest(initData, `/api/admin/entries?webinarId=${encodeURIComponent(webinarId)}`, { method: 'PATCH', json: { category: next } })
      setValue(next)
      setNote('Категория сохранена.')
    } catch (err) {
      setNote(
        err instanceof AdminHttpError && err.code === 'migration_pending'
          ? 'Категории ещё не включены на сервере (нужна миграция 006).'
          : adminErrorText(err),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className={admin.chips} role="radiogroup" aria-label="Категория вебинара">
        {WEBINAR_CATEGORY_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            aria-pressed={value === o.value}
            className={admin.chip}
            disabled={busy || value === null}
            onClick={() => void choose(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
      {note ? <span className={admin.hint}>{note}</span> : null}
    </div>
  )
}
