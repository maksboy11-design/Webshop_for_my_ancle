/** Хосты CDN MAX, с которых безопасно скачивать вложения. Остальные URL отбрасываются (SSRF). */
const ALLOWED_SUFFIXES = ['.okcdn.ru', '.oneme.ru'] as const

export function isAllowedMaxMediaHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase()
  if (!host || host.includes(':') || host === 'localhost') return false
  if (host === 'okcdn.ru' || host === 'oneme.ru') return true
  return ALLOWED_SUFFIXES.some((suffix) => host.endsWith(suffix))
}

export function isAllowedMaxMediaUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  if (url.username || url.password) return false
  return isAllowedMaxMediaHost(url.hostname)
}

export function isAllowedPublicMediaSrc(value: string): boolean {
  if (value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) return true
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  if (url.username || url.password) return false
  const host = url.hostname.toLowerCase()
  return host === 'blob.vercel-storage.com' || host.endsWith('.blob.vercel-storage.com')
}
