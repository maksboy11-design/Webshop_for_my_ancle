import { useId } from 'react'

/**
 * SVG-ЗАГЛУШКИ изображений сцены (без текста внутри графики).
 * Назначение: прибор, флаконы БАДов, стакан воды — заменяются реальными фото через
 * src/config/sceneAssets.ts (поле src). Цветовая гамма берётся из токенов (CSS custom properties).
 * Уникальные id градиентов (useId) — чтобы ссылки работали, даже если один из экземпляров скрыт.
 */

const svgProps = {
  width: '100%',
  height: '100%',
  'aria-hidden': true,
  focusable: false,
  preserveAspectRatio: 'xMidYMax meet',
} as const

/** ПЛЕЙСХОЛДЕР: бежевый прибор для обогащения воды водородом (aspect 0.62). */
export function DevicePlaceholder() {
  const uid = useId().replace(/:/g, '')
  const body = `dev-body-${uid}`
  const gold = `dev-gold-${uid}`
  const glass = `dev-glass-${uid}`
  const steel = `dev-steel-${uid}`
  return (
    <svg viewBox="0 0 200 322" {...svgProps}>
      <defs>
        <linearGradient id={body} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--color-device-shade)" />
          <stop offset="0.3" stopColor="var(--color-device-body)" />
          <stop offset="0.7" stopColor="var(--color-device-body)" />
          <stop offset="1" stopColor="var(--color-device-edge)" />
        </linearGradient>
        <linearGradient id={gold} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#b89a5e" />
          <stop offset="0.45" stopColor="#f3e3b4" />
          <stop offset="1" stopColor="#a98a4f" />
        </linearGradient>
        <linearGradient id={glass} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2c3a33" />
          <stop offset="1" stopColor="#141c18" />
        </linearGradient>
        <linearGradient id={steel} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#9ea8a3" />
          <stop offset="0.5" stopColor="#e6ece9" />
          <stop offset="1" stopColor="#8e9994" />
        </linearGradient>
      </defs>
      {/* Тень на основании */}
      <ellipse cx="82" cy="316" rx="76" ry="6" fill="#143222" opacity="0.18" />
      {/* Корпус */}
      <rect x="8" y="70" width="148" height="244" rx="36" fill={`url(#${body})`} />
      <rect x="8" y="70" width="148" height="244" rx="36" fill="none" stroke="var(--color-device-edge)" strokeOpacity="0.6" />
      {/* Золотистый ободок и крышка */}
      <rect x="4" y="58" width="156" height="20" rx="10" fill={`url(#${gold})`} />
      <rect x="20" y="40" width="124" height="22" rx="11" fill={`url(#${body})`} stroke="var(--color-device-edge)" strokeOpacity="0.6" />
      {/* Излив-трубка */}
      <path d="M138 46c34-10 54 8 52 40l-2 70" fill="none" stroke={`url(#${steel})`} strokeWidth="7" strokeLinecap="round" />
      {/* Панель */}
      <rect x="96" y="108" width="38" height="112" rx="19" fill={`url(#${glass})`} />
      <path d="M115 128c5 6.500 8 11 8 15a8 8 0 0 1-16 0c0-4 3-8.500 8-15Z" fill="none" stroke="#e8f6ef" strokeWidth="2" />
      <circle cx="115" cy="170" r="2.200" fill="#e8f6ef" />
      <circle cx="115" cy="180" r="2.200" fill="#e8f6ef" opacity="0.6" />
      <circle cx="115" cy="204" r="6" fill="none" stroke="#e8f6ef" strokeWidth="1.600" />
      {/* Отражение */}
      <rect x="22" y="92" width="10" height="190" rx="5" fill="#ffffff" opacity="0.35" />
      {/* Знак бренда без текста */}
      <circle cx="82" cy="276" r="8" fill="none" stroke="var(--color-device-edge)" strokeWidth="1.500" />
      <circle cx="82" cy="276" r="2.500" fill="var(--color-device-edge)" />
    </svg>
  )
}

/** ПЛЕЙСХОЛДЕР: флакон БАДа (aspect 0.5). tone: dark | light. */
export function BottlePlaceholder({ tone }: { tone: 'dark' | 'light' }) {
  const uid = useId().replace(/:/g, '')
  const body = `bt-body-${uid}`
  const dark = tone === 'dark'
  const base = dark ? 'var(--color-bottle-dark)' : 'var(--color-bottle-light)'
  const shade = dark ? 'var(--color-bottle-dark-shade)' : 'var(--color-device-shade)'
  const label = dark ? '#e9efe3' : '#fbf7ec'
  const ink = dark ? '#1d3f2d' : '#3f7a52'
  return (
    <svg viewBox="0 0 100 200" {...svgProps}>
      <defs>
        <linearGradient id={body} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={shade} />
          <stop offset="0.35" stopColor={base} />
          <stop offset="1" stopColor={shade} />
        </linearGradient>
      </defs>
      <ellipse cx="50" cy="196" rx="42" ry="4" fill="#143222" opacity="0.2" />
      <rect x="20" y="4" width="60" height="30" rx="6" fill="var(--color-bottle-cap)" />
      <rect x="20" y="4" width="60" height="8" rx="4" fill="#ffffff" opacity="0.28" />
      <rect x="8" y="30" width="84" height="164" rx="16" fill={`url(#${body})`} />
      <rect x="15" y="64" width="70" height="104" rx="7" fill={label} opacity="0.96" />
      <circle cx="50" cy="84" r="8" fill="none" stroke={ink} strokeWidth="1.500" />
      <rect x="28" y="102" width="44" height="4" rx="2" fill={ink} />
      <rect x="34" y="112" width="32" height="3" rx="1.500" fill={ink} opacity="0.55" />
      <rect x="30" y="144" width="40" height="3" rx="1.500" fill={ink} opacity="0.4" />
      <rect x="14" y="40" width="9" height="140" rx="4.500" fill="#ffffff" opacity="0.22" />
    </svg>
  )
}

/** ПЛЕЙСХОЛДЕР: стакан воды (aspect 0.72). */
export function GlassPlaceholder() {
  const uid = useId().replace(/:/g, '')
  const water = `gl-water-${uid}`
  return (
    <svg viewBox="0 0 72 100" {...svgProps}>
      <defs>
        <linearGradient id={water} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e9f8f5" stopOpacity="0.9" />
          <stop offset="1" stopColor="#a7dbd6" stopOpacity="0.95" />
        </linearGradient>
      </defs>
      <ellipse cx="36" cy="97" rx="28" ry="3" fill="#143222" opacity="0.18" />
      <path d="M8 6h56l-6 88a4 4 0 0 1-4 3.600H18a4 4 0 0 1-4-3.600Z" fill="#ffffff" fillOpacity="0.35" stroke="#ffffff" strokeOpacity="0.9" strokeWidth="1.500" />
      <path d="M10.500 20h51l-4.600 74a3 3 0 0 1-3 2.800H18a3 3 0 0 1-3-2.800Z" fill={`url(#${water})`} />
      <ellipse cx="36" cy="20" rx="25.500" ry="3" fill="#ffffff" fillOpacity="0.8" />
      <g fill="#ffffff" fillOpacity="0.85">
        <circle cx="26" cy="70" r="2.600" />
        <circle cx="40" cy="58" r="2" />
        <circle cx="46" cy="76" r="3" />
        <circle cx="32" cy="46" r="1.600" />
        <circle cx="50" cy="52" r="1.400" />
        <circle cx="24" cy="86" r="1.800" />
      </g>
      <path d="M17 12l3.500 78" stroke="#ffffff" strokeOpacity="0.8" strokeWidth="2.500" strokeLinecap="round" />
    </svg>
  )
}
