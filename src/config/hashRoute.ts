export type PageId = 'home' | 'catalog' | 'product' | 'videos' | 'webinars' | 'about' | 'contacts' | 'privacy'

export interface RouteState {
  page: PageId
  slug: string
  params: URLSearchParams
}

export function parseHash(hash: string): RouteState {
  const body = hash.replace(/^#/, '')
  const cut = body.indexOf('?')
  const path = (cut === -1 ? body : body.slice(0, cut)).replace(/^\/+|\/+$/g, '')
  const params = new URLSearchParams(cut === -1 ? '' : body.slice(cut + 1))
  if (path === '' || path === 'top') return { page: 'home', slug: '', params }
  if (path === 'catalog') return { page: 'catalog', slug: '', params }
  if (path === 'videos' || path === 'webinars' || path === 'about' || path === 'contacts' || path === 'privacy') {
    return { page: path, slug: '', params }
  }
  if (path.startsWith('product/')) {
    return { page: 'product', slug: decodeURIComponent(path.slice('product/'.length)), params }
  }
  return { page: 'home', slug: '', params }
}

export function catalogHref(patch: Record<string, string | null>, current?: URLSearchParams) {
  const next = new URLSearchParams(current?.toString() ?? '')
  for (const [key, value] of Object.entries(patch)) {
    if (!value) next.delete(key)
    else next.set(key, value)
  }
  const query = next.toString()
  return query ? `#catalog?${query}` : '#catalog'
}

export function productHref(slug: string) {
  return `#product/${encodeURIComponent(slug)}`
}
