import { useState } from 'react'
import type { SecureClipboardService } from '../service'
import styles from '../Clipboard.module.css'
import app from '../../App.module.css'

export function ClipboardSetupDialog({
  service,
  mode,
  onDone,
  onClose,
}: {
  service: SecureClipboardService
  mode: 'setup' | 'recovery' | 'pending'
  onDone: () => void
  onClose: () => void
}) {
  const [recovery, setRecovery] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  if (mode === 'pending') {
    return (
      <div className={styles.backdrop} role="dialog" aria-modal="true" onClick={onClose}>
        <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
          <h2>Подтверждение устройства</h2>
          <p>Это устройство ещё не доверено. Откройте CMS на уже подтверждённом устройстве и одобрите запрос — либо восстановите доступ ключом восстановления.</p>
          <div className={styles.row}>
            <button type="button" className={app.btn} onClick={onClose}>
              Закрыть
            </button>
            <button type="button" className={`${app.btn} ${app.btnPrimary}`} onClick={() => onDone()}>
              У меня есть ключ восстановления
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (mode === 'recovery' || recovery === null && mode === 'setup' && false) {
    /* fallthrough */
  }

  if (mode === 'recovery') {
    return (
      <div className={styles.backdrop} role="dialog" aria-modal="true" onClick={onClose}>
        <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
          <h2>Восстановление буфера</h2>
          <p>Вставьте ключ восстановления, сохранённый при первой настройке. Без него старые записи расшифровать нельзя.</p>
          <textarea className={app.input} rows={3} value={input} onChange={(e) => setInput(e.target.value.trim())} aria-label="Ключ восстановления" />
          {err ? <p className={styles.error}>{err}</p> : null}
          <div className={styles.row}>
            <button type="button" className={app.btn} onClick={onClose}>
              Отмена
            </button>
            <button
              type="button"
              className={`${app.btn} ${app.btnPrimary}`}
              disabled={busy || input.length < 20}
              onClick={() => {
                setBusy(true)
                setErr(null)
                void service
                  .recover(input)
                  .then(onDone)
                  .catch(() => setErr('Не удалось восстановить. Проверьте ключ.'))
                  .finally(() => setBusy(false))
              }}
            >
              Восстановить
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (recovery) {
    return (
      <div className={styles.backdrop} role="dialog" aria-modal="true">
        <div className={styles.dialog}>
          <h2>Сохраните ключ восстановления</h2>
          <p>Без этого ключа при потере всех устройств доступ к буферу восстановить нельзя. Сервер его не знает.</p>
          <div className={styles.recovery} data-testid="clipboard-recovery-key">
            {recovery}
          </div>
          <button
            type="button"
            className={`${app.btn} ${app.btnPrimary}`}
            onClick={() => {
              void navigator.clipboard?.writeText(recovery).catch(() => undefined)
              onDone()
            }}
          >
            Скопировать и продолжить
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <h2>Защищённый буфер обмена</h2>
        <p>
          Компоненты шифруются на этом устройстве (AES-256-GCM). Сервер хранит только шифротекст и не может прочитать содержимое.
        </p>
        {err ? <p className={styles.error}>{err}</p> : null}
        <div className={styles.row}>
          <button type="button" className={app.btn} onClick={onClose}>
            Позже
          </button>
          <button
            type="button"
            className={`${app.btn} ${app.btnPrimary}`}
            disabled={busy}
            onClick={() => {
              setBusy(true)
              setErr(null)
              void service
                .setup()
                .then((r) => setRecovery(r.recoveryKeyB64))
                .catch(() => setErr('Не удалось настроить буфер.'))
                .finally(() => setBusy(false))
            }}
          >
            Включить
          </button>
        </div>
      </div>
    </div>
  )
}
