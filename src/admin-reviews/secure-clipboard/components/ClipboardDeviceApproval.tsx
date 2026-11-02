import { useEffect, useState } from 'react'
import type { SecureClipboardService } from '../service'
import type { ClipboardDeviceRow } from '../types'
import styles from '../Clipboard.module.css'
import app from '../../App.module.css'

export function ClipboardDeviceApproval({ service }: { service: SecureClipboardService }) {
  const [pending, setPending] = useState<ClipboardDeviceRow[]>([])

  useEffect(() => {
    let stop = false
    const load = () =>
      void service
        .listPendingDevices()
        .then((d) => {
          if (!stop) setPending(d)
        })
        .catch(() => undefined)
    load()
    const t = setInterval(load, 20_000)
    return () => {
      stop = true
      clearInterval(t)
    }
  }, [service])

  if (!pending.length) return null
  return (
    <div className={styles.dialog} style={{ margin: '8px 0' }} data-testid="clipboard-pending-devices">
      <strong>Новые устройства для буфера</strong>
      {pending.map((d) => (
        <div key={d.id} className={styles.row}>
          <span>
            {d.deviceName || 'Устройство'} · {new Date(d.createdAt).toLocaleString('ru-RU')}
          </span>
          <button type="button" className={`${app.btn} ${app.btnPrimary}`} onClick={() => void service.approveDevice(d.id).then(() => setPending((p) => p.filter((x) => x.id !== d.id)))}>
            Подтвердить
          </button>
          <button type="button" className={app.btn} onClick={() => void service.revokeDevice(d.id).then(() => setPending((p) => p.filter((x) => x.id !== d.id)))}>
            Отклонить
          </button>
        </div>
      ))}
    </div>
  )
}
