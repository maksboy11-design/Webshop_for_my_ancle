import { useEffect, useRef, useState } from 'react'
import { SecureClipboardService, type ClipboardStatus } from './service'

export function useSecureClipboard(initData: string | null) {
  const ref = useRef<SecureClipboardService | null>(null)
  const [status, setStatus] = useState<ClipboardStatus>({ state: 'loading' })

  useEffect(() => {
    if (!initData) {
      ref.current = null
      setStatus({ state: 'unavailable', reason: 'no_auth' })
      return
    }
    let cancelled = false
    try {
      const svc = new SecureClipboardService(initData)
      ref.current = svc
      const off = svc.onStatus((s) => {
        if (!cancelled) setStatus(s)
      })
      void svc.init()
      return () => {
        cancelled = true
        off()
        ref.current = null
      }
    } catch {
      setStatus({ state: 'error', reason: 'init_failed' })
    }
  }, [initData])

  return { service: ref.current, status }
}
