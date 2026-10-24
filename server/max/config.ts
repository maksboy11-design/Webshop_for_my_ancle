const SECRET_PATTERN = /^[A-Za-z0-9_-]{5,256}$/
const USER_ID_PATTERN = /^[1-9][0-9]{0,15}$/

export function secretIsValid(value: string): boolean {
  return SECRET_PATTERN.test(value)
}

export function tokenIsValid(value: string): boolean {
  return value.length > 0 && !/\s/.test(value)
}

/** Пустой или некорректный список запрещает модерацию целиком. */
export function readModeratorIds(raw: string | undefined): { ok: true; ids: ReadonlySet<string> } | { ok: false } {
  if (raw == null || raw.trim() === '') return { ok: false }
  const ids = new Set<string>()
  for (const part of raw.split(',')) {
    const id = part.trim()
    if (!USER_ID_PATTERN.test(id) || !Number.isSafeInteger(Number(id))) return { ok: false }
    ids.add(id)
  }
  if (ids.size === 0) return { ok: false }
  return { ok: true, ids }
}
