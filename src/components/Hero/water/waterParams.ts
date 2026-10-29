/**
 * Параметры водного слоя под блоком преимуществ Hero.
 *
 * Масштаб визуализации (явное допущение, а не измерение): 1 CSS px ≙ PX_TO_M метров.
 * Реальный размер блока на экране неизвестен, поэтому физические величины (СИ)
 * переводятся в CSS px только через этот множитель.
 */
export const PX_TO_M = 0.25e-3

/** Физические параметры (СИ). */
export const PHYSICAL = {
  iorAir: 1.0003,
  /** Чистая вода, ~589 нм, комнатная температура. */
  iorWater: 1.333,
  /** Поверхностное натяжение вода–воздух, Н/м. */
  surfaceTension: 0.0728,
  /** Плотность воды, кг/м³. */
  density: 998,
  /** Ускорение свободного падения, м/с². */
  gravity: 9.81,
  /**
   * Контактный угол лужи на гладкой поверхности, рад. Не измерен для конкретного
   * материала: 60° — допущение для чистого стекла/эмали средней смачиваемости.
   */
  contactAngle: (60 * Math.PI) / 180,
  /**
   * Коэффициенты поглощения чистой воды, 1/м, для R/G/B (~650/550/450 нм),
   * порядок величин по Pope & Fry (1997). RGB-свёртка спектра приближённая.
   */
  absorptionRGB: [0.35, 0.06, 0.01] as const,
  /** Цвет и направление прямого тёплого света (к источнику, y вниз, z к зрителю). */
  sunDirection: [-0.42, -0.5, 0.76] as const,
  skyDirection: [0.3, -0.25, 0.92] as const,
} as const

/** Капиллярная длина ℓc = √(γ / (Δρ g)) ≈ 2.7 мм. */
export const CAPILLARY_LENGTH_M = Math.sqrt(
  PHYSICAL.surfaceTension / (PHYSICAL.density * PHYSICAL.gravity),
)

/**
 * Толщина большой плоской лужи (2D-решение Юнга–Лапласа для широкой лужи):
 * h∞ = 2 ℓc sin(θc / 2).
 */
export const PUDDLE_THICKNESS_M = 2 * CAPILLARY_LENGTH_M * Math.sin(PHYSICAL.contactAngle / 2)

/**
 * Художественные поправки. Они не являются свойствами воды и подписаны явно.
 */
export const ARTISTIC = {
  /** Множитель эффективной глубины для рефракции и каустики (вода в 2.7 мм почти не искажает фон). */
  refractionStrength: 5,
  /** Замедление времени: настоящие капиллярные волны колеблются с частотой ~10–20 Гц. */
  timeScale: 0.035,
  /** Множитель поглощения: тонкий слой чистой воды на глаз бесцветен. */
  absorptionBoost: 70,
  /** Доля каустики, подмешиваемой к освещённости дна (0 — выключено). */
  causticsIntensity: 0.55,
  /** Perceptual roughness для GGX (α = r²). */
  surfaceRoughness: 0.2,
  /** Яркость солнца и неба в спекулярном члене. */
  sunIntensity: 1.6,
  skyIntensity: 0.35,
  /** Ширина затухания волн у линии контакта, в долях ℓc (контактная линия закреплена). */
  waveDampingLc: 3,
  /** Расстояние до глаза, CSS px (~60 см при 96 dpi). */
  eyeDistancePx: 2268,
  /** Лимит devicePixelRatio и доля разрешения в упрощённом режиме. */
  maxDpr: 1.5,
  lowPowerScale: 0.6,
} as const

export interface Wave {
  /** Длина волны, м. */
  wavelength: number
  /** Амплитуда, м. */
  amplitude: number
  /** Направление (будет нормализовано). */
  direction: [number, number]
  phase: number
}

/** Несколько слабых гравитационно-капиллярных волн: спокойная поверхность, не «море». */
export const WAVES: Wave[] = [
  { wavelength: 14e-3, amplitude: 0.05e-3, direction: [1, 0.35], phase: 0 },
  { wavelength: 10e-3, amplitude: 0.035e-3, direction: [-0.6, 1], phase: 1.7 },
  { wavelength: 7.5e-3, amplitude: 0.022e-3, direction: [0.8, -0.9], phase: 4.1 },
  { wavelength: 19e-3, amplitude: 0.06e-3, direction: [-1, -0.25], phase: 2.6 },
]

/**
 * Дисперсия гравитационно-капиллярных волн на глубине d:
 * ω² = (g k + γ/ρ k³) tanh(k d).
 */
export function angularFrequency(k: number, depth: number): number {
  const { gravity: g, surfaceTension: gamma, density: rho } = PHYSICAL
  return Math.sqrt((g * k + (gamma / rho) * k ** 3) * Math.tanh(k * depth))
}

/** Френель при нормальном падении: F0 = ((n1 − n2)/(n1 + n2))² ≈ 0.02. */
export function fresnelF0(n1: number, n2: number): number {
  return ((n1 - n2) / (n1 + n2)) ** 2
}

export interface WaterSettings {
  effectEnabled: boolean
}

/* ───────────── Интерактивные волны от курсора (waterSim.ts) ───────────── */

/** Кинематическая вязкость воды при ~20 °C, м²/с. */
export const KINEMATIC_VISCOSITY = 1.0e-6

/**
 * Характерная длина волны пятна курсора, м: пятно σ≈7px ≙ 1.75 мм → λ ≈ 8 мм.
 * Это выбор модели (масштаб источника), а не свойство воды.
 */
export const RIPPLE_WAVELENGTH_M = 8e-3

export const RIPPLE_ARTISTIC = {
  /**
   * Замедление времени для интерактивных волн. Настоящие кольца λ≈8 мм бегут ~0.25 м/с
   * (≈1000 px/с при принятом масштабе) — за ¼ с пересекают блок. 0.35 — чтобы их было видно.
   */
  timeScale: 0.35,
  /** Множитель к вязкому затуханию β = 2νk² (чистая вязкость гасит кольца лишь за ~1 с). */
  dampingBoost: 3,
  /** Ячеек сетки по длинной стороне: десктоп / мобильный и упрощённый режим. */
  gridLong: 192,
  gridLongSmall: 128,
  /** Радиус (σ гауссианы) пятна давления, CSS px. */
  spotSigmaPx: 7,
  impulseSigmaPx: 9,
  /** Глубина начальной впадины при нажатии, CSS px (≈0.4 мм — больше линейного режима ради видимости). */
  impulseDepthPx: 10,
  /** Сила источника при движении: ускорение, px/с² на 1 px/с скорости курсора. */
  moveGain: 380,
  /** Ограничение скорости курсора, px/с. */
  maxPointerSpeedPx: 2400,
  /** Поле считается успокоившимся через столько постоянных затухания 1/β. */
  settleTimeConstants: 7,
  /** Запас по устойчивости явной схемы (доля от предельного шага). */
  stabilitySafety: 0.7,
  /** Не больше подшагов за кадр (иначе время замедляется, но схема не разваливается). */
  maxSubsteps: 8,
} as const

/**
 * Дисперсия гравитационно-капиллярных волн на глубокой воде, ω² = g k + (γ/ρ) k³
 * (k·h∞ ≈ 3.7 ≫ 1, tanh ≈ 1), аппроксимируется в окрестности k_c полиномом
 * ω² ≈ a k² + b k⁴ с совпадением значения и наклона в k_c. Полином ровно соответствует
 * уравнению ∂²h/∂t² = a ∇²h − b ∇⁴h: короткие волны бегут быстрее — как у капиллярных.
 *   a = g/k_c + s k_c − b k_c²,  b = (s k_c² − g) / (2 k_c⁴),  s = γ/ρ.
 */
export function rippleDispersionFit(kc: number): { a: number; b: number } {
  const { gravity: g, surfaceTension: gamma, density: rho } = PHYSICAL
  const s = gamma / rho
  const b = (s * kc * kc - g) / (2 * kc ** 4)
  const a = g / kc + s * kc - b * kc * kc
  return { a, b }
}

/** Фазовая скорость гравитационно-капиллярной волны c = ω/k (глубокая вода), м/с. */
export function phaseSpeed(k: number): number {
  const { gravity: g, surfaceTension: gamma, density: rho } = PHYSICAL
  return Math.sqrt(g / k + (gamma / rho) * k)
}
