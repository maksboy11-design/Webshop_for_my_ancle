/**
 * Чистая (без WebGL) часть интерактивной воды: коэффициенты схемы, форма источника,
 * трекинг курсора и CPU-эталон того же разностного шаблона, что и в шейдере (для тестов).
 */
import {
  KINEMATIC_VISCOSITY,
  PX_TO_M,
  RIPPLE_ARTISTIC as R,
  RIPPLE_WAVELENGTH_M,
  rippleDispersionFit,
} from './waterParams'

export interface SimCoefficients {
  /** Фиксированный шаг модельного времени, с. */
  dt: number
  aPx: number
  bPx: number
  /** Коэффициент затухания β, 1/с. */
  beta: number
  /** aΔt²/Δx², bΔt²/Δx⁴, βΔt — безразмерные коэффициенты шаблона. */
  A: number
  B: number
  betaDt: number
}

/**
 * a [м²/с²] → px²/с², b [м⁴/с²] → px⁴/с². Шаг: ω_max Δt ≤ 2·safety,
 * ω_max² = 8a/Δx² + 64b/Δx⁴ (оценка сверху для 9-точечного лапласиана, |λ| ≤ 16/3 < 8).
 */
export function simCoefficients(dx: number): SimCoefficients {
  const kc = (2 * Math.PI) / RIPPLE_WAVELENGTH_M
  const { a, b } = rippleDispersionFit(kc)
  const aPx = a / PX_TO_M ** 2
  const bPx = b / PX_TO_M ** 4
  const dx2 = dx * dx
  const omegaMax = Math.sqrt((8 * aPx) / dx2 + (64 * bPx) / (dx2 * dx2))
  const dt = (R.stabilitySafety * 2) / omegaMax
  const beta = 2 * KINEMATIC_VISCOSITY * kc * kc * R.dampingBoost
  return { dt, aPx, bPx, beta, A: (aPx * dt * dt) / dx2, B: (bPx * dt * dt) / (dx2 * dx2), betaDt: beta * dt }
}

/**
 * Источник — «мексиканская шляпа» G(σ) − κ·G(2σ) вдоль отрезка длины L.
 * κ = ∫G(σ)/∫G(2σ) делает интеграл нулевым: курсор вытесняет воду, но не добавляет её
 * (иначе по Нейману средний уровень лужи растёт без предела → сдвиг толщины и оттенка).
 */
export function hatKappa(sigma: number, len: number): number {
  const s2pi = Math.sqrt(2 * Math.PI)
  const narrow = 2 * Math.PI * sigma * sigma + len * sigma * s2pi
  const wide = 8 * Math.PI * sigma * sigma + len * 2 * sigma * s2pi
  return narrow / wide
}

/** Мягкое ограничение скорости курсора: линейно при v ≪ vCap, асимптотически vCap. */
export function effectiveSpeed(v: number, vCap: number = R.maxPointerSpeedPx): number {
  if (!Number.isFinite(v) || v <= 0) return 0
  return vCap * Math.tanh(v / vCap)
}

/** Амплитуда источника за подшаг (Δt²·S0): пятно «размазано» по подотрезку дуги ℓ. */
export function segmentAmp(dt: number, accel: number, arcLen: number, sigma = R.spotSigmaPx): number {
  const w = sigma * Math.sqrt(2 * Math.PI)
  return dt * dt * accel * (w / (arcLen + w))
}

export interface Chord {
  ax: number
  ay: number
  bx: number
  by: number
  /** Длина дуги ломаной на этом участке (≥ длины хорды). */
  arc: number
}

/** Делит ломаную кадра на n равных по длине дуги участков (по одному на подшаг). */
export function splitPolyline(pts: readonly { x: number; y: number }[], n: number): Chord[] {
  const out: Chord[] = []
  if (pts.length < 2 || n < 1) return out
  const cum = [0]
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y))
  const L = cum[cum.length - 1]
  const at = (s: number) => {
    let i = 1
    while (i < cum.length - 1 && cum[i] < s) i++
    const d = cum[i] - cum[i - 1]
    const f = d > 0 ? (s - cum[i - 1]) / d : 0
    return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f }
  }
  for (let k = 0; k < n; k++) {
    const a = at((L * k) / n)
    const b = at((L * (k + 1)) / n)
    out.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, arc: L / n })
  }
  return out
}

export interface TrackerConfig {
  vCap: number
  /** Постоянная сглаживания скорости (только вход), мс. */
  tauMs: number
  /** Разрыв трека: пауза между событиями больше этого — новый жест, мс. */
  gapMs: number
  /** Скорость оценивается не по интервалам короче этого (дребезг/coalesced events), мс. */
  minDtMs: number
}

export const TRACKER_DEFAULTS: TrackerConfig = {
  vCap: R.maxPointerSpeedPx,
  tauMs: R.speedSmoothingMs,
  gapMs: 120,
  minDtMs: 8,
}

/**
 * Трекинг курсора: накапливает полный путь за кадр (зигзаг внутри кадра не теряется),
 * оценивает скорость устойчиво к нулевым/обратным dt и к выбросам, сглаживает её EMA.
 */
export class PointerTracker {
  private cfg: TrackerConfig
  private pts: { x: number; y: number }[] = []
  private last: { x: number; y: number; t: number } | null = null
  private accD = 0
  private accT = 0
  private vSm = 0
  private lastTake = 0

  constructor(cfg: Partial<TrackerConfig> = {}) {
    this.cfg = { ...TRACKER_DEFAULTS, ...cfg }
  }

  /** t — время события, мс (тот же источник, что и now; некорректное заменяется now). */
  add(x: number, y: number, t: number, now: number) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    if (!Number.isFinite(t) || t > now + 50 || t < now - 1000) t = now
    const last = this.last
    if (!last || t - last.t > this.cfg.gapMs) {
      this.last = { x, y, t }
      this.pts = [{ x, y }]
      this.accD = this.accT = 0
      this.vSm = 0
      return
    }
    t = Math.max(t, last.t)
    this.accD += Math.hypot(x - last.x, y - last.y)
    this.accT += t - last.t
    if (this.accT >= this.cfg.minDtMs) {
      const vRaw = Math.min(this.accD / (this.accT / 1000), 4 * this.cfg.vCap)
      this.vSm += (vRaw - this.vSm) * (1 - Math.exp(-this.accT / this.cfg.tauMs))
      this.accD = this.accT = 0
    }
    if (this.pts.length === 0) this.pts.push({ x: last.x, y: last.y })
    this.pts.push({ x, y })
    this.last = { x, y, t }
  }

  /** Забрать путь кадра. Курсор, стоящий на месте, плавно теряет скорость. */
  take(now: number): { pts: { x: number; y: number }[]; speed: number } | null {
    const dtTake = this.lastTake ? Math.min(Math.max(now - this.lastTake, 0), 200) : 0
    this.lastTake = now
    if (!this.last) return null
    if (now - this.last.t > 2 * this.cfg.minDtMs) this.vSm *= Math.exp(-dtTake / this.cfg.tauMs)
    const pts = this.pts
    this.pts = [{ x: this.last.x, y: this.last.y }]
    if (pts.length < 2) return null
    return { pts, speed: effectiveSpeed(this.vSm, this.cfg.vCap) }
  }

  get speed() {
    return this.vSm
  }

  end() {
    this.last = null
    this.pts = []
    this.vSm = 0
    this.accD = this.accT = 0
  }
}

/** Связь источника с водой у борта (как edgeCouple в SIM_FRAGMENT): 0 у края, 1 глубже 4·sw. */
export function edgeCouple(x: number, y: number, W: number, H: number, radius: number, sw: number) {
  const px = Math.abs(x - W / 2) - W / 2 + radius
  const py = Math.abs(y - H / 2) - H / 2 + radius
  const d = -(Math.hypot(Math.max(px, 0), Math.max(py, 0)) + Math.min(Math.max(px, py), 0) - radius)
  const t = Math.min(Math.max((d - sw) / (3 * sw), 0), 1)
  return t * t * (3 - 2 * t)
}

/** Маска лужи (скруглённый прямоугольник) — та же, что в шейдере. */
export function insideMask(i: number, j: number, gw: number, gh: number, dx: number, W: number, H: number, radius: number) {
  const cx = i + 0.5
  const cy = j + 0.5
  if (cx < 0 || cy < 0 || cx > gw || cy > gh) return false
  const px = Math.abs(cx * dx - W / 2) - W / 2 + radius
  const py = Math.abs(cy * dx - H / 2) - H / 2 + radius
  const d = Math.hypot(Math.max(px, 0), Math.max(py, 0)) + Math.min(Math.max(px, py), 0) - radius
  return d < -0.5 * dx
}

export interface FieldStats {
  maxH: number
  mean: number
  maxSlope: number
  bad: number
  cells: number
}

/** max|h|, средний уровень, max|∇h| (центральные разности), число NaN/Inf — по ячейкам маски. */
export function fieldStats(f: ArrayLike<number>, gw: number, gh: number, dx: number, W: number, H: number, radius: number): FieldStats {
  let maxH = 0
  let sum = 0
  let n = 0
  let bad = 0
  let maxSlope = 0
  const ins = (i: number, j: number) => i >= 0 && j >= 0 && i < gw && j < gh && insideMask(i, j, gw, gh, dx, W, H, radius)
  for (let j = 0; j < gh; j++)
    for (let i = 0; i < gw; i++) {
      if (!ins(i, j)) continue
      const v = f[j * gw + i]
      if (!Number.isFinite(v)) {
        bad++
        continue
      }
      maxH = Math.max(maxH, Math.abs(v))
      sum += v
      n++
      if (ins(i + 1, j) && ins(i - 1, j) && ins(i, j + 1) && ins(i, j - 1)) {
        const gx = (f[j * gw + i + 1] - f[j * gw + i - 1]) / (2 * dx)
        const gy = (f[(j + 1) * gw + i] - f[(j - 1) * gw + i]) / (2 * dx)
        const s = Math.hypot(gx, gy)
        if (Number.isFinite(s)) maxSlope = Math.max(maxSlope, s)
      }
    }
  return { maxH, mean: n ? sum / n : 0, maxSlope, bad, cells: n }
}

/** Порог «поле успокоилось»: смещение преломления < 0.05 px и вклад в поглощение < 1/1000 уровня. */
export function isSettled(s: FieldStats) {
  return s.bad === 0 && s.maxH < R.settleMaxHPx && s.maxSlope < R.settleMaxSlope
}

/** Параметры источника для одного подшага (общие для GPU и CPU-эталона). */
export interface SubstepSource {
  seg: Chord | null
  amp: number
  kappa: number
  impulse: { x: number; y: number } | null
}

/**
 * CPU-эталон шага, бит-в-бит тот же шаблон, что SIM_FRAGMENT (для тестов и оценок).
 * h, hp — текущий и предыдущий слои (gw×gh), возвращает новые.
 */
export class CpuSim {
  h: Float64Array
  hp: Float64Array
  mask: Uint8Array
  readonly co: SimCoefficients

  constructor(
    readonly gw: number,
    readonly gh: number,
    readonly dx: number,
    readonly W: number,
    readonly H: number,
    readonly radius: number,
  ) {
    this.h = new Float64Array(gw * gh)
    this.hp = new Float64Array(gw * gh)
    this.mask = new Uint8Array(gw * gh)
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) this.mask[j * gw + i] = insideMask(i, j, gw, gh, dx, W, H, radius) ? 1 : 0
    this.co = simCoefficients(dx)
  }

  private at(i: number, j: number, hc: number) {
    if (i < 0 || j < 0 || i >= this.gw || j >= this.gh || !this.mask[j * this.gw + i]) return hc
    return this.h[j * this.gw + i]
  }

  step(src: SubstepSource) {
    const { gw, gh, dx } = this
    const { A, B, betaDt } = this.co
    const hn = new Float64Array(gw * gh)
    const hpn = new Float64Array(gw * gh)
    const sig = R.spotSigmaPx
    const isg = R.impulseSigmaPx
    const hs2 = R.saturationPx * R.saturationPx
    // Насыщение — один множитель на весь подшаг по высоте под курсором: форма источника
    // остаётся с нулевым интегралом (объём сохраняется), а рост амплитуды ограничен.
    const probe = (x: number, y: number) => {
      const i = Math.min(Math.max(Math.floor(x / dx), 0), gw - 1)
      const j = Math.min(Math.max(Math.floor(y / dx), 0), gh - 1)
      return this.mask[j * gw + i] ? this.h[j * gw + i] : 0
    }
    const hSeg = src.seg ? probe((src.seg.ax + src.seg.bx) / 2, (src.seg.ay + src.seg.by) / 2) : 0
    const hImp = src.impulse ? probe(src.impulse.x, src.impulse.y) : 0
    const { W, H, radius } = this
    const ec = (x: number, y: number, sw: number) => edgeCouple(x, y, W, H, radius, sw)
    const sg = src.seg
    const satSeg =
      (hs2 / (hs2 + hSeg * hSeg)) * (sg ? ec((sg.ax + sg.bx) / 2, (sg.ay + sg.by) / 2, 2 * sig) : 0)
    const satImp = (hs2 / (hs2 + hImp * hImp)) * (src.impulse ? ec(src.impulse.x, src.impulse.y, 2 * isg) : 0)
    for (let j = 0; j < gh; j++)
      for (let i = 0; i < gw; i++) {
        const k = j * gw + i
        if (!this.mask[k]) continue
        const h = this.h[k]
        const hp = this.hp[k]
        const n4 = this.at(i + 1, j, h) + this.at(i - 1, j, h) + this.at(i, j + 1, h) + this.at(i, j - 1, h)
        const dg = this.at(i + 1, j + 1, h) + this.at(i + 1, j - 1, h) + this.at(i - 1, j + 1, h) + this.at(i - 1, j - 1, h)
        const f2 = this.at(i + 2, j, h) + this.at(i - 2, j, h) + this.at(i, j + 2, h) + this.at(i, j - 2, h)
        const lap = (4 * n4 + dg - 20 * h) / 6
        const bih = 20 * h - 8 * n4 + 2 * dg + f2
        const px = (i + 0.5) * dx
        const py = (j + 0.5) * dx
        let s = 0
        if (src.seg && src.amp) {
          const { ax, ay, bx, by } = src.seg
          const ex = bx - ax
          const ey = by - ay
          const t = Math.min(Math.max(((px - ax) * ex + (py - ay) * ey) / Math.max(ex * ex + ey * ey, 1e-4), 0), 1)
          const vx = px - ax - ex * t
          const vy = py - ay - ey * t
          const d2 = vx * vx + vy * vy
          s = src.amp * (Math.exp(-d2 / (2 * sig * sig)) - src.kappa * Math.exp(-d2 / (8 * sig * sig))) * satSeg
        }
        let next = (2 * h - (1 - 0.5 * betaDt) * hp + A * lap - B * bih - s) / (1 + 0.5 * betaDt)
        let imp = 0
        if (src.impulse) {
          const d2 = (px - src.impulse.x) ** 2 + (py - src.impulse.y) ** 2
          imp = -R.impulseDepthPx * (Math.exp(-d2 / (2 * isg * isg)) - 0.25 * Math.exp(-d2 / (8 * isg * isg))) * satImp
        }
        next += imp
        hn[k] = next
        hpn[k] = h + imp
      }
    this.hp = hpn
    this.h = hn
  }

  /** Вычесть средний уровень (сохранение объёма; то же делает GPU по считыванию). */
  shift(m: number) {
    for (let k = 0; k < this.h.length; k++)
      if (this.mask[k]) {
        this.h[k] -= m
        this.hp[k] -= m
      }
  }

  stats() {
    return fieldStats(this.h, this.gw, this.gh, this.dx, this.W, this.H, this.radius)
  }
}
