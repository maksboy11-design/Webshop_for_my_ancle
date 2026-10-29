/** Чистые помощники формы вебинара (тестируются отдельно). */
const YT_ID = /^[A-Za-z0-9_-]{11}$/

export function formatStart(sec: number | null): string {
  if (!sec) return ''
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/** Клиентская подсказка; окончательная проверка — на сервере. */
export function looksLikeYoutube(raw: string): boolean {
  const t = raw.trim()
  if (YT_ID.test(t)) return true
  try {
    const u = new URL(t)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
    const host = u.hostname.replace(/^www\.|^m\./, '')
    if (host === 'youtu.be') return YT_ID.test(u.pathname.slice(1).split('/')[0] ?? '')
    if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') return false
    const v = u.searchParams.get('v')
    if (v) return YT_ID.test(v)
    const m = /^\/(?:embed|live|shorts)\/([^/?#]+)/.exec(u.pathname)
    return !!m && YT_ID.test(m[1]!)
  } catch {
    return false
  }
}

