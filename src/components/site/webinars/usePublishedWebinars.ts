import { useEffect, useState } from 'react'
import { cmsClient } from '../../../cms/staticAdapter'
import type { Webinar } from '../../../cms/types'

export type WebinarsPhase = 'loading' | 'empty' | 'error' | 'ready'

export function usePublishedWebinars() {
  const [state, setState] = useState<{ phase: WebinarsPhase; webinars: readonly Webinar[] }>({ phase: 'loading', webinars: [] })
  useEffect(() => {
    let cancelled = false
    cmsClient
      .listWebinars()
      .then((webinars) => {
        if (!cancelled) setState({ phase: webinars.length === 0 ? 'empty' : 'ready', webinars })
      })
      .catch(() => {
        if (!cancelled) setState({ phase: 'error', webinars: [] })
      })
    return () => {
      cancelled = true
    }
  }, [])
  return state
}
