// Проверка контраста пар цветов из src/styles/tokens.css (WCAG 2.x).
// Обычный текст ≥ 4.5:1, крупный (≥ 24px / 18.66px bold) и не-текстовые элементы интерфейса ≥ 3:1.
// Запуск: npm run check:contrast
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8')
const tokens = {}
for (const [, name, value] of css.matchAll(/--([\w-]+):\s*([^;]+);/g)) tokens[name] = value.trim()

function resolve(value) {
  const m = value.match(/^var\(--([\w-]+)\)$/)
  return m ? resolve(tokens[m[1]]) : value
}

function parse(value) {
  const v = resolve(value)
  let m = v.match(/^#([0-9a-f]{6})$/i)
  if (m) {
    const n = parseInt(m[1], 16)
    return { r: n >> 16, g: (n >> 8) & 255, b: n & 255, a: 1 }
  }
  m = v.match(/^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+))?\s*\)$/)
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] }
  throw new Error(`Не удалось разобрать цвет: ${value}`)
}

const color = (name) => parse(tokens[name] ?? `var(--${name})`)
const over = (top, bottom) => ({
  r: top.r * top.a + bottom.r * (1 - top.a),
  g: top.g * top.a + bottom.g * (1 - top.a),
  b: top.b * top.a + bottom.b * (1 - top.a),
  a: 1,
})
const lum = ({ r, g, b }) => {
  const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const ratio = (fg, bg) => {
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x)
  return (a + 0.05) / (b + 0.05)
}

const page = color('color-bg-page')
const white = color('palette-milk-0')
const green100 = color('palette-green-100')
const lime200 = color('palette-lime-200')
const water100 = color('palette-water-100')
const water200 = color('palette-water-200')
const skyBottom = color('color-bg-sky-bottom')
const waterField = over(color('color-surface-water'), water100)

/** [название, цвет текста/элемента, фон, минимальный порог] */
const checks = [
  ['text-primary / bg-page', color('color-text-primary'), page, 4.5],
  ['text-primary / карточка (белая)', color('color-text-primary'), over(color('color-surface-strong'), white), 4.5],
  ['text-heading / bg-page', color('color-text-heading'), page, 4.5],
  ['text-heading / green-100', color('color-text-heading'), green100, 4.5],
  ['text-heading / sky-bottom', color('color-text-heading'), skyBottom, 4.5],
  ['text-heading / water-100', color('color-text-heading'), water100, 4.5],
  ['text-secondary / bg-page', color('color-text-secondary'), page, 4.5],
  ['text-secondary / green-100', color('color-text-secondary'), green100, 4.5],
  ['text-secondary / water-100', color('color-text-secondary'), water100, 4.5],
  ['text-secondary / water-200', color('color-text-secondary'), water200, 4.5],
  ['text-secondary / карточка', color('color-text-secondary'), over(color('color-surface-strong'), white), 4.5],
  ['text-muted / bg-page', color('color-text-muted'), page, 4.5],
  ['text-muted / green-100', color('color-text-muted'), green100, 4.5],
  ['text-muted (placeholder) / поле поиска', color('color-text-muted'), waterField, 4.5],
  ['text-primary (ввод) / поле поиска', color('color-text-primary'), waterField, 4.5],
  ['text-on-action / action (CTA)', color('color-text-on-action'), color('color-action'), 4.5],
  ['text-on-action / action-hover', color('color-text-on-action'), color('color-action-hover'), 4.5],
  ['text-on-action / action-active', color('color-text-on-action'), color('color-action-active'), 4.5],
  ['badge-text / badge-bg (демо-цена)', color('color-badge-text'), lime200, 4.5],
  ['text-heading / action-subtle (активный пункт меню)', color('color-text-heading'), color('color-action-subtle'), 4.5],
  ['focus / bg-page (не-текст, 3:1)', color('color-focus'), page, 3],
  ['focus / sky-bottom (не-текст, 3:1)', color('color-focus'), skyBottom, 3],
  ['border-strong на bg-page (иконки преимуществ, 3:1)', over(color('color-border-strong'), page), page, 3],
  ['action / bg-page (не-текст, 3:1)', color('color-action'), page, 3],
]

let failed = 0
for (const [name, fg, bg, min] of checks) {
  const value = ratio(fg, bg)
  const ok = value >= min
  if (!ok) failed++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${value.toFixed(2).padStart(5)}:1 (мин ${min})  ${name}`)
}
console.log(failed ? `\nНе прошло: ${failed}` : '\nВсе пары контраста проходят порог.')
process.exit(failed ? 1 : 0)
