import { createHash, timingSafeEqual } from 'node:crypto'

/** Сравнение секрета webhook не зависит от длины и не раскрывает совпавший префикс. */
export function secretsMatch(expected: string, received: string | null): boolean {
  const actual = received ?? ''
  const left = createHash('sha256').update(expected, 'utf8').digest()
  const right = createHash('sha256').update(actual, 'utf8').digest()
  return timingSafeEqual(left, right)
}
