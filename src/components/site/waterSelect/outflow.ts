/**
 * Вытекание/затекание панели вариантов. Использует ту же физическую модель воды, что и вода
 * блока преимуществ на главной (src/components/Hero/water): параметры воды (waterParams) и
 * CPU-реализацию того же разностного шаблона гравитационно-капиллярных волн (CpuSim из waterCore).
 *
 * Фронт: мелководье, задача о прорыве плотины (решение Риттера). Слой толщиной h0 —
 * равновесная толщина лужи PUDDLE_THICKNESS_M — растекается с фронтом x_f = 2·c0·t, c0 = √(g h0),
 * профиль за фронтом h(x,t) = (2c0 − x/t)² / (9g). Затекание — обращение по времени того же решения
 * (вода втягивается к источнику с той же скоростью). Время замедлено тем же timeScale, что и рябь.
 */
import { CpuSim, effectiveSpeed, hatKappa, segmentAmp } from '../../Hero/water/waterCore'
import { PHYSICAL, PUDDLE_THICKNESS_M, PX_TO_M, RIPPLE_ARTISTIC } from '../../Hero/water/waterParams'

/** Скорость гравитационной волны c0 = √(g h0), CSS px / модельная с. */
export function waveSpeedPx(h0 = PUDDLE_THICKNESS_M): number {
  return Math.sqrt(PHYSICAL.gravity * h0) / PX_TO_M
}

/** Положение фронта Риттера (px) через t реальных секунд с учётом замедления времени. */
export function frontPx(tSec: number, h0 = PUDDLE_THICKNESS_M, timeScale: number = RIPPLE_ARTISTIC.timeScale): number {
  return 2 * waveSpeedPx(h0) * Math.max(tSec, 0) * timeScale
}

/** Время (реальное, с), за которое фронт проходит L px. */
export function travelTime(Lpx: number, h0 = PUDDLE_THICKNESS_M, timeScale: number = RIPPLE_ARTISTIC.timeScale): number {
  return Lpx / (2 * waveSpeedPx(h0) * timeScale)
}

/** Относительная толщина Риттера h/h0 ∈ [0,1] на расстоянии x от источника при фронте xf. */
export function ritterDepth(x: number, xf: number): number {
  if (xf <= 0) return 0
  if (x <= 0) return 1
  if (x >= xf) return 0
  // ξ = x/t в долях c0: h/h0 = (2 − ξ)²/9 на [−1, 2], нормируем к 1 у источника (ξ = 0 → 4/9).
  const xi = (2 * x) / xf
  return Math.min(((2 - xi) ** 2 / 9) * (9 / 4), 1)
}

export type FlowPhase = 'closed' | 'opening' | 'open' | 'closing'

/** Состояние панели: фронт (px от верхней кромки), фаза и поле ряби на CpuSim. */
export class PanelWater {
  phase: FlowPhase = 'closed'
  front = 0
  sim: CpuSim
  private simTime = 0
  private kappa: number

  constructor(
    readonly W: number,
    readonly H: number,
    readonly dx = 4,
    readonly radius = 12,
  ) {
    const gw = Math.max(4, Math.ceil(W / dx))
    const gh = Math.max(4, Math.ceil(H / dx))
    this.sim = new CpuSim(gw, gh, dx, W, H, radius)
    this.kappa = hatKappa(RIPPLE_ARTISTIC.spotSigmaPx, Math.max(W - 16, 1))
  }

  open() {
    if (this.phase === 'open' || this.phase === 'opening') return
    this.phase = 'opening'
  }

  close() {
    if (this.phase === 'closed' || this.phase === 'closing') return
    this.phase = 'closing'
  }

  /** Продвинуть на dtSec реального времени. Возвращает true, пока есть движение. */
  advance(dtSec: number): boolean {
    const dt = Math.min(Math.max(dtSec, 0), 0.05)
    const v = 2 * waveSpeedPx() * RIPPLE_ARTISTIC.timeScale
    const before = this.front
    if (this.phase === 'opening') {
      this.front = Math.min(this.H, this.front + v * dt)
      if (this.front >= this.H) {
        this.phase = 'open'
        // фронт ударяет о закреплённую контактную линию — импульс у нижней кромки
        this.sim.step({ seg: null, amp: 0, kappa: this.kappa, impulse: { x: this.W / 2, y: this.H - 6 } })
      }
    } else if (this.phase === 'closing') {
      this.front = Math.max(0, this.front - v * dt)
      if (this.front <= 0) this.phase = 'closed'
    }
    // фронт как движущийся источник давления вдоль линии фронта (тот же шаблон, что курсор на главной)
    const moved = Math.abs(this.front - before)
    this.simTime += dt * RIPPLE_ARTISTIC.timeScale
    let steps = 0
    while (this.simTime >= this.sim.co.dt && steps < 40) {
      this.simTime -= this.sim.co.dt
      steps++
      const y = Math.min(Math.max(this.front - 4, 2), this.H - 2)
      const seg = moved > 0 ? { ax: 8, ay: y, bx: this.W - 8, by: y, arc: this.W - 16 } : null
      const amp = seg ? segmentAmp(this.sim.co.dt, RIPPLE_ARTISTIC.moveGain * effectiveSpeed(moved / Math.max(dt, 1e-3)), seg.arc) : 0
      this.sim.step({ seg, amp, kappa: this.kappa, impulse: null })
    }
    const s = this.sim.stats()
    if (s.bad > 0) this.reset()
    const rippling = !(s.maxH < RIPPLE_ARTISTIC.settleMaxHPx && s.maxSlope < RIPPLE_ARTISTIC.settleMaxSlope)
    return this.phase === 'opening' || this.phase === 'closing' || (this.front > 0 && rippling)
  }

  reset() {
    this.sim.h.fill(0)
    this.sim.hp.fill(0)
  }

  /** Высота поля ряби в точке (px). */
  heightAt(x: number, y: number): number {
    const { gw, gh, dx } = this.sim
    const i = Math.min(Math.max(Math.floor(x / dx), 0), gw - 1)
    const j = Math.min(Math.max(Math.floor(y / dx), 0), gh - 1)
    return this.sim.h[j * gw + i]
  }
}
