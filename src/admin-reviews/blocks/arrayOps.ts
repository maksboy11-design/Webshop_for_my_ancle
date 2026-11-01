/** Чистые операции со списками (без зависимостей от React). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list]
  const next = [...list]
  const [x] = next.splice(from, 1)
  next.splice(to, 0, x!)
  return next
}
export function removeAt<T>(list: readonly T[], i: number): T[] {
  return list.filter((_, j) => j !== i)
}
export function duplicateAt<T>(list: readonly T[], i: number, clone: (x: T) => T): T[] {
  if (i < 0 || i >= list.length) return [...list]
  const next = [...list]
  next.splice(i + 1, 0, clone(list[i]!))
  return next
}
export function newBlockId(prefix = 'b'): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}
