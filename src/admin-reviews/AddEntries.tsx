/**
 * Кнопка «Добавить» и список ручных записей раздела. Пустое обязательное поле — черновик (на сайте не виден),
 * все обязательные поля заполнены — запись публикуется автоматически.
 */
import { useCallback, useEffect, useState } from 'react'
import { adminErrorText, adminRequest, AdminHttpError } from './adminHttp'
import styles from './App.module.css'
import admin from './Admin.module.css'
import { ENTRY_FIELDS, ENTRY_STATUS_LABEL, KIND_LABEL, fieldLabel, missingRequired, type AdminEntry, type EntryKind } from './entriesModel'

const api = {
  list: (initData: string, kind: EntryKind) => adminRequest<{ entries: AdminEntry[] }>(initData, `/api/admin/entries?kind=${kind}`),
  create: (initData: string, kind: EntryKind, data: Record<string, string>) =>
    adminRequest<{ entry: AdminEntry }>(initData, '/api/admin/entries', { method: 'POST', json: { kind, data } }),
  save: (initData: string, id: string, data: Record<string, string>, republish: boolean) =>
    adminRequest<{ entry: AdminEntry }>(initData, `/api/admin/entries?id=${encodeURIComponent(id)}`, { method: 'PATCH', json: { data, republish } }),
  withdraw: (initData: string, id: string) =>
    adminRequest<{ id: string }>(initData, `/api/admin/entries?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
}

function entryError(err: unknown, kind: EntryKind): string {
  if (err instanceof AdminHttpError && err.code === 'migration_pending') {
    return 'Добавление ещё не включено на сервере (нужна миграция 006). Остальные разделы работают как раньше.'
  }
  if (err instanceof AdminHttpError && err.status === 400 && err.field) {
    return `Проверьте поле «${fieldLabel(kind, err.field)}».`
  }
  return adminErrorText(err)
}

function EntryForm({
  kind,
  initData,
  entry,
  onDone,
  onCancel,
}: {
  kind: EntryKind
  initData: string
  entry: AdminEntry | null
  onDone: (e: AdminEntry) => void
  onCancel: () => void
}) {
  const [data, setData] = useState<Record<string, string>>(entry?.data ?? {})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const missing = missingRequired(kind, data)
  const withdrawn = entry?.status === 'withdrawn'

  async function submit(republish = false) {
    setSaving(true)
    setError(null)
    try {
      const res = entry ? await api.save(initData, entry.id, data, republish) : await api.create(initData, kind, data)
      onDone(res.entry)
    } catch (err) {
      setError(entryError(err, kind))
    } finally {
      setSaving(false)
    }
  }

  async function withdraw() {
    if (!entry) return
    setSaving(true)
    setError(null)
    try {
      await api.withdraw(initData, entry.id)
      onDone({ ...entry, status: 'withdrawn' })
    } catch (err) {
      setError(entryError(err, kind))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      className={admin.form}
      data-testid={`entry-form-${kind}`}
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <h3 className={admin.legend}>{entry ? KIND_LABEL[kind].title(entry.data) : KIND_LABEL[kind].add}</h3>
      <p className={admin.hint}>
        Поля со <span className={admin.required}>*</span> обязательны. Если какое-то пусто, запись сохранится черновиком и не появится на сайте.
      </p>
      <fieldset className={admin.fieldset} disabled={saving}>
        {ENTRY_FIELDS[kind].map((f) => {
          const label = (
            <span className={styles.filterLabel}>
              {f.label}
              {f.required ? <span className={admin.required}> *</span> : null}
            </span>
          )
          const value = data[f.name] ?? ''
          const set = (v: string) => setData((d) => ({ ...d, [f.name]: v }))
          return (
            <label key={f.name} className={styles.filterField}>
              {label}
              {f.type === 'select' ? (
                <select className={styles.input} aria-label={f.label} value={value} onChange={(e) => set(e.target.value)}>
                  <option value="">— не выбрано —</option>
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : f.type === 'textarea' ? (
                <textarea className={admin.textarea} aria-label={f.label} value={value} maxLength={f.maxLength} rows={5} onChange={(e) => set(e.target.value)} />
              ) : (
                <input
                  className={styles.input}
                  aria-label={f.label}
                  type={f.type === 'number' ? 'text' : f.type === 'url' ? 'url' : f.type}
                  inputMode={f.type === 'number' ? 'numeric' : f.type === 'url' ? 'url' : undefined}
                  value={value}
                  maxLength={f.maxLength}
                  onChange={(e) => set(e.target.value)}
                />
              )}
            </label>
          )
        })}
      </fieldset>
      <p className={admin.hint} data-testid="entry-outcome">
        {withdrawn
          ? 'Запись снята с сайта.'
          : missing.length
            ? `Сохранится черновиком. Не заполнено: ${missing.map((m) => fieldLabel(kind, m)).join(', ')}.`
            : 'Все обязательные поля заполнены — запись будет опубликована на сайте.'}
      </p>
      {error ? (
        <div className={styles.error} role="alert">
          {error}
        </div>
      ) : null}
      <div className={admin.saveBar}>
        <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={saving}>
          {withdrawn ? 'Сохранить' : missing.length ? 'Сохранить черновик' : 'Опубликовать'}
        </button>
        {withdrawn && !missing.length ? (
          <button type="button" className={styles.btn} disabled={saving} onClick={() => void submit(true)}>
            Опубликовать снова
          </button>
        ) : null}
        <button type="button" className={styles.btn} disabled={saving} onClick={onCancel}>
          Отмена
        </button>
      </div>
      {entry && !withdrawn ? (
        <div className={admin.dangerZone}>
          <button type="button" className={`${styles.btn} ${styles.btnDanger}`} disabled={saving} onClick={() => void withdraw()}>
            {entry.status === 'draft' ? 'Удалить черновик' : 'Снять с сайта'}
          </button>
        </div>
      ) : null}
    </form>
  )
}

export function AddEntries({ kind, initData, active }: { kind: EntryKind; initData: string; active: boolean }) {
  const [entries, setEntries] = useState<AdminEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<AdminEntry | 'new' | null>(null)

  const load = useCallback(() => {
    api
      .list(initData, kind)
      .then((r) => {
        setEntries(r.entries)
        setError(null)
      })
      .catch((err: unknown) => setError(entryError(err, kind)))
  }, [initData, kind])

  useEffect(() => {
    if (active && entries === null) load()
  }, [active, entries, load])

  const visible = (entries ?? []).filter((e) => e.status !== 'withdrawn' || editing === e)

  return (
    <section className={admin.addBlock} aria-label={KIND_LABEL[kind].list} data-testid={`add-entries-${kind}`}>
      {editing ? (
        <EntryForm
          kind={kind}
          initData={initData}
          entry={editing === 'new' ? null : editing}
          onCancel={() => setEditing(null)}
          onDone={(e) => {
            setEntries((list) => [e, ...(list ?? []).filter((x) => x.id !== e.id)])
            setEditing(null)
          }}
        />
      ) : (
        <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => setEditing('new')}>
          ＋ {KIND_LABEL[kind].add}
        </button>
      )}
      {error ? <div className={styles.notice}>{error}</div> : null}
      {!editing && visible.length ? (
        <>
          <h3 className={admin.legend}>{KIND_LABEL[kind].list}</h3>
          {visible.map((e) => (
            <button key={e.id} type="button" className={admin.rowCard} onClick={() => setEditing(e)} data-testid="entry-row">
              <span className={admin.rowBody}>
                <span className={admin.rowTitle}>{KIND_LABEL[kind].title(e.data)}</span>
                <span className={admin.badge} data-status={e.status}>
                  {ENTRY_STATUS_LABEL[e.status]}
                </span>
                {e.status === 'draft' && e.missing.length ? (
                  <span className={admin.hint}>Не заполнено: {e.missing.map((m) => fieldLabel(kind, m)).join(', ')}</span>
                ) : null}
              </span>
            </button>
          ))}
        </>
      ) : null}
    </section>
  )
}
