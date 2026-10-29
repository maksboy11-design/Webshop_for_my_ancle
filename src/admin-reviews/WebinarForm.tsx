import { useEffect, useMemo, useState } from 'react'
import { adminErrorText, AdminHttpError, WEBINAR_STATUS_LABEL, webinarsApi, type AdminWebinar } from './adminHttp'
import styles from './App.module.css'
import admin from './Admin.module.css'
import { formatStart, looksLikeYoutube } from './webinarFormModel'

interface FormState {
  title: string
  speaker: string
  date: string
  start: string
  sourceType: 'youtube' | 'hosted'
  youtube: string
  hosted: string
  recheck: boolean
}

function initial(w: AdminWebinar): FormState {
  return {
    title: w.title,
    speaker: w.speaker ?? '',
    date: w.date ?? '',
    start: formatStart(w.startSeconds),
    sourceType: w.sourceType,
    youtube: w.youtubeVideoId ? `https://www.youtube.com/watch?v=${w.youtubeVideoId}` : '',
    hosted: w.recordingSrc ?? '',
    recheck: false,
  }
}

interface Props {
  initData: string
  webinar: AdminWebinar
  onDirtyChange: (dirty: boolean) => void
  onChanged: (w: AdminWebinar, message: string) => void
  onRemoved: (message: string) => void
}

export default function WebinarForm({ initData, webinar, onDirtyChange, onChanged, onRemoved }: Props) {
  const start = useMemo(() => initial(webinar), [webinar])
  const [state, setState] = useState<FormState>(start)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const editable = webinar.status === 'pending' || webinar.status === 'published'
  const dirty = (Object.keys(start) as (keyof FormState)[]).some((k) => k !== 'recheck' && state[k] !== start[k])

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  const patch = (p: Partial<FormState>) => setState((s) => ({ ...s, ...p }))

  const save = async () => {
    if (!state.title.trim()) return setError('Укажите название.')
    if (state.sourceType === 'youtube' && !looksLikeYoutube(state.youtube)) return setError('Нужна ссылка YouTube или 11-символьный id видео.')
    if (state.sourceType === 'hosted' && !/^https:\/\//.test(state.hosted.trim())) return setError('Файл записи: https-ссылка на хранилище сайта.')
    setSaving(true)
    setError(null)
    try {
      const res = await webinarsApi.patch(initData, webinar.id, {
        title: state.title,
        speaker: state.speaker.trim() ? state.speaker : null,
        date: state.date.trim() ? state.date.trim() : null,
        startSeconds: state.start.trim() ? state.start.trim() : null,
        source: state.sourceType === 'youtube' ? { type: 'youtube', url: state.youtube.trim() } : { type: 'hosted', src: state.hosted.trim() },
        recheck: state.recheck,
        expectedUpdatedAt: webinar.updatedAt,
      })
      onChanged(
        res.webinar,
        res.webinar.status === 'published' ? 'Сохранено. На сайте изменения появятся в течение минуты.' : 'Сохранено.',
      )
    } catch (err) {
      let text = adminErrorText(err)
      if (err instanceof AdminHttpError && err.code === 'verification_failed' && typeof err.body.metadataText === 'string') {
        text = `${text} ${err.body.metadataText}`
      }
      setError(text) // поля формы сохраняются
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await webinarsApi.remove(initData, webinar.id)
      onRemoved(
        res.already
          ? 'Запись уже была снята.'
          : res.status === 'withdrawn'
            ? 'Вебинар снят с сайта.'
            : 'Заявка отклонена и не будет опубликована повторно.',
      )
    } catch (err) {
      setError(adminErrorText(err))
      setConfirming(false)
    } finally {
      setSaving(false)
    }
  }

  const removeLabel = webinar.status === 'published' ? 'Снять с сайта' : webinar.status === 'pending' ? 'Отклонить' : null

  return (
    <form
      className={admin.form}
      aria-label="Редактирование вебинара"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <p className={styles.meta}>
        <span className={admin.badge} data-status={webinar.status}>
          {WEBINAR_STATUS_LABEL[webinar.status]}
        </span>{' '}
        {webinar.fromGroup ? 'из группы · ' : ''}
        {webinar.metadataText ?? ''}
      </p>
      {!editable ? <div className={styles.notice}>Снятые и отклонённые записи не редактируются.</div> : null}
      <fieldset className={admin.fieldset} disabled={!editable || saving}>
        <label className={styles.filterField}>
          <span className={styles.filterLabel}>Название</span>
          <input className={styles.input} aria-label="Название" value={state.title} maxLength={300} onChange={(e) => patch({ title: e.target.value })} />
        </label>
        <label className={styles.filterField}>
          <span className={styles.filterLabel}>Спикер</span>
          <input className={styles.input} aria-label="Спикер" value={state.speaker} maxLength={200} onChange={(e) => patch({ speaker: e.target.value })} />
        </label>
        <div className={styles.filters}>
          <label className={styles.filterField}>
            <span className={styles.filterLabel}>Дата</span>
            <input className={styles.input} type="date" aria-label="Дата" value={state.date} onChange={(e) => patch({ date: e.target.value })} />
          </label>
          <label className={styles.filterField}>
            <span className={styles.filterLabel}>Начало (м:сс)</span>
            <input className={styles.input} aria-label="Время начала" inputMode="numeric" placeholder="0:00" value={state.start} onChange={(e) => patch({ start: e.target.value })} />
          </label>
        </div>
        <div className={admin.chips} role="radiogroup" aria-label="Источник">
          {(['youtube', 'hosted'] as const).map((t) => (
            <button key={t} type="button" role="radio" aria-checked={state.sourceType === t} className={admin.chip} aria-pressed={state.sourceType === t} onClick={() => patch({ sourceType: t })}>
              {t === 'youtube' ? 'YouTube' : 'Файл на сайте'}
            </button>
          ))}
        </div>
        {state.sourceType === 'youtube' ? (
          <label className={styles.filterField}>
            <span className={styles.filterLabel}>Ссылка YouTube или id</span>
            <input className={styles.input} aria-label="Ссылка YouTube" inputMode="url" value={state.youtube} onChange={(e) => patch({ youtube: e.target.value })} />
            {state.youtube && !looksLikeYoutube(state.youtube) ? <span className={admin.hint}>Не похоже на ссылку YouTube.</span> : null}
          </label>
        ) : (
          <label className={styles.filterField}>
            <span className={styles.filterLabel}>https-ссылка на файл в хранилище сайта</span>
            <input className={styles.input} aria-label="Ссылка на файл" inputMode="url" value={state.hosted} onChange={(e) => patch({ hosted: e.target.value })} />
          </label>
        )}
        {state.sourceType === 'youtube' ? (
          <label className={admin.check}>
            <input type="checkbox" checked={state.recheck} onChange={(e) => patch({ recheck: e.target.checked })} /> Перепроверить видео на YouTube
          </label>
        ) : null}
      </fieldset>
      {error ? (
        <div className={styles.error} role="alert">
          {error}
        </div>
      ) : null}
      {editable ? (
        <div className={admin.saveBar}>
          <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={saving || (!dirty && !state.recheck)}>
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
          <button type="button" className={styles.btn} disabled={!dirty || saving} onClick={() => setState(start)}>
            Отменить правки
          </button>
        </div>
      ) : null}
      {removeLabel ? (
        <div className={admin.dangerZone}>
          {!confirming ? (
            <button type="button" className={`${styles.btn} ${styles.btnDanger}`} disabled={saving} onClick={() => setConfirming(true)}>
              {removeLabel}
            </button>
          ) : (
            <div role="alertdialog" aria-label="Подтверждение" className={admin.confirmBox}>
              <p>
                {webinar.status === 'published'
                  ? 'Снять вебинар с сайта? Запись останется в базе, удаления нет.'
                  : 'Отклонить заявку? Она не будет опубликована повторно.'}
              </p>
              <div className={styles.actionsRow}>
                <button type="button" className={`${styles.btn} ${styles.btnDanger}`} disabled={saving} onClick={() => void remove()}>
                  {saving ? 'Выполняется…' : `Да, ${removeLabel.toLowerCase()}`}
                </button>
                <button type="button" className={styles.btn} disabled={saving} onClick={() => setConfirming(false)}>
                  Нет
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </form>
  )
}
