import { useEffect, useState } from 'react'
import { sanitizePublicPageDoc, type PageDoc } from '../../cms/pageDoc'
import type { PageLinks } from './PageRenderer'

export interface PublicPage {
  id: string
  slug: string
  title: string
  doc: PageDoc
  links: PageLinks
}
export type PublicPageState = { state: 'loading' } | { state: 'ready'; page: PublicPage } | { state: 'missing' } | { state: 'unavailable' }

/** Только опубликованная версия (сервер черновики не отдаёт). 404 → missing; 503/сеть → unavailable. */
export async function fetchPublicPage(slug: string, signal?: AbortSignal): Promise<PublicPageState> {
  try {
    const r = await fetch(`/api/pages?slug=${encodeURIComponent(slug)}`, { signal, headers: { accept: 'application/json' } })
    if (r.status === 404) return { state: 'missing' }
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return { state: 'unavailable' }
    const j = (await r.json()) as { page?: { id?: unknown; slug?: unknown; title?: unknown; doc?: unknown }; links?: unknown }
    const doc = sanitizePublicPageDoc(j.page?.doc)
    if (!doc || typeof j.page?.title !== 'string' || typeof j.page.slug !== 'string') return { state: 'unavailable' }
    const links = j.links && typeof j.links === 'object' ? (j.links as PageLinks) : {}
    return { state: 'ready', page: { id: String(j.page.id), slug: j.page.slug, title: j.page.title, doc, links } }
  } catch {
    return { state: 'unavailable' }
  }
}

export function usePublicPage(slug: string): PublicPageState {
  const [res, setRes] = useState<{ slug: string; value: PublicPageState } | null>(null)
  useEffect(() => {
    const ac = new AbortController()
    fetchPublicPage(slug, ac.signal).then((value) => {
      if (!ac.signal.aborted) setRes({ slug, value })
    })
    return () => ac.abort()
  }, [slug])
  return res && res.slug === slug ? res.value : { state: 'loading' }
}
