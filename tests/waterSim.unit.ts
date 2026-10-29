/**
 * Стресс-тесты интерактивной воды на CPU-эталоне (тот же шаблон, что в шейдере).
 * Критерии зафиксированы до замеров (см. отчёт): C6 численные, C7 отклик, плюс устойчивость схемы.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CpuSim,
  PointerTracker,
  effectiveSpeed,
  hatKappa,
  isSettled,
  segmentAmp,
  simCoefficients,
  splitPolyline,
} from '../src/components/Hero/water/waterCore'
import { RIPPLE_ARTISTIC as R } from '../src/components/Hero/water/waterParams'

const LIMITS = { maxH: 5, maxSlope: 0.5, mean: 0.05, settleMs: 12000 }

/** Множитель усиления чехарды с затуханием для моды с символами λL, λB. */
function maxAmplification(A: number, B: number, betaDt: number) {
  let worst = 0
  const N = 48
  for (let a = 0; a <= N; a++)
    for (let b = 0; b <= N; b++) {
      const kx = (Math.PI * a) / N
      const ky = (Math.PI * b) / N
      const n4 = 2 * Math.cos(kx) + 2 * Math.cos(ky)
      const dg = 4 * Math.cos(kx) * Math.cos(ky)
      const f2 = 2 * Math.cos(2 * kx) + 2 * Math.cos(2 * ky)
      const lap = (4 * n4 + dg - 20) / 6
      const bih = 20 - 8 * n4 + 2 * dg + f2
      // (1+β/2) z² − (2 + A·lap − B·bih) z + (1 − β/2) = 0
      const p = 1 + betaDt / 2
      const q = -(2 + A * lap - B * bih)
      const r = 1 - betaDt / 2
      const disc = q * q - 4 * p * r
      const mod = disc < 0 ? Math.sqrt(r / p) : Math.max(Math.abs((-q + Math.sqrt(disc)) / (2 * p)), Math.abs((-q - Math.sqrt(disc)) / (2 * p)))
      worst = Math.max(worst, mod)
    }
  return worst
}

test('схема устойчива по фон Нейману на всех используемых шагах сетки (с ∇⁴)', () => {
  for (const dx of [576 / R.gridLong, 576 / R.gridLongSmall, 343 / R.gridLongSmall, 2]) {
    const c = simCoefficients(dx)
    assert.ok(Number.isFinite(c.dt) && c.dt > 0)
    assert.ok(maxAmplification(c.A, c.B, c.betaDt) <= 1 + 1e-12, `dx=${dx}`)
  }
})

test('источник «мексиканская шляпа» имеет нулевой интеграл (объём не растёт)', () => {
  for (const L of [0, 5, 40, 200]) {
    const k = hatKappa(R.spotSigmaPx, L)
    let sum = 0
    const s = R.spotSigmaPx
    for (let y = -80; y <= 80; y += 0.5)
      for (let x = -80; x <= L + 80; x += 0.5) {
        const t = Math.min(Math.max(x / Math.max(L, 1e-4), 0), 1)
        const d2 = (x - L * t) ** 2 + y * y
        sum += (Math.exp(-d2 / (2 * s * s)) - k * Math.exp(-d2 / (8 * s * s))) * 0.25
      }
    assert.ok(Math.abs(sum) < 1e-3 * 2 * Math.PI * s * s, `L=${L} sum=${sum}`)
  }
})

test('трекер: устойчив к нулевым, обратным, NaN и далёким timestamp; скорость ограничена', () => {
  const tr = new PointerTracker()
  let now = 1000
  tr.add(0, 0, now, now)
  for (let i = 1; i < 50; i++) {
    now += 16
    const bad = [now, now, now - 500, NaN, now + 1e6, -1][i % 6]
    tr.add(i * 40, (i % 2) * 30, bad, now)
    const s = tr.take(now)
    if (s) {
      assert.ok(Number.isFinite(s.speed) && s.speed >= 0 && s.speed <= R.maxPointerSpeedPx)
      for (const p of s.pts) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y))
    }
  }
  assert.ok(effectiveSpeed(1e9) <= R.maxPointerSpeedPx)
  assert.equal(effectiveSpeed(NaN), 0)
})

test('путь кадра: зигзаг внутри кадра сохраняется, длина дуги делится без потерь', () => {
  const tr = new PointerTracker()
  tr.add(0, 0, 0, 0)
  for (let i = 1; i <= 8; i++) tr.add(i * 10, i % 2 ? 40 : 0, i * 2, 16)
  const s = tr.take(16)!
  assert.equal(s.pts.length, 9)
  const arc = splitPolyline(s.pts, 4).reduce((a, c) => a + c.arc, 0)
  let L = 0
  for (let i = 1; i < s.pts.length; i++) L += Math.hypot(s.pts[i].x - s.pts[i - 1].x, s.pts[i].y - s.pts[i - 1].y)
  assert.ok(Math.abs(arc - L) < 1e-9)
})

type Path = (t: number) => { x: number; y: number } | null

/** Тот же цикл, что в WaterSurface: кадры → трекер → подшаги → проекция среднего → критерий успокоения. */
function simulate(path: Path, durMs: number, opts: { clickAt?: number; frame?: (f: number) => number } = {}) {
  const sim = new CpuSim(192, 67, 3, 576, 201, 24)
  const tr = new PointerTracker()
  let acc = 0
  let t = 0
  let last = 0
  let lastInput = 0
  const out = { maxH: 0, maxSlope: 0, mean: 0, bad: 0, settleMs: Infinity, hAtClear: Infinity }
  for (let f = 0; t < durMs + LIMITS.settleMs + 2000; f++) {
    const fdt = opts.frame ? opts.frame(f) : 1000 / 60
    t += fdt
    const p = t <= durMs ? path(t) : null
    if (p) {
      tr.add(p.x, p.y, t - Math.random() * 3, t)
      lastInput = t
    } else tr.end()
    const seg = tr.take(t)
    acc += (Math.min(fdt, 50) / 1000) * R.timeScale
    let n = Math.floor(acc / sim.co.dt)
    if (n > R.maxSubsteps) {
      n = R.maxSubsteps
      acc = Math.min(acc - n * sim.co.dt, sim.co.dt)
    } else acc -= n * sim.co.dt
    const click = opts.clickAt !== undefined && opts.clickAt >= t - fdt && opts.clickAt < t
    if (click) lastInput = t
    if (click && n === 0) n = 1
    const ch = seg ? splitPolyline(seg.pts, n) : []
    for (let i = 0; i < n; i++) {
      const c = ch[i] ?? null
      sim.step({
        seg: c,
        amp: c && seg ? segmentAmp(sim.co.dt, R.moveGain * seg.speed, c.arc) : 0,
        kappa: c ? hatKappa(R.spotSigmaPx, Math.hypot(c.bx - c.ax, c.by - c.ay)) : 0,
        impulse: i === 0 && click ? { x: 288, y: 100 } : null,
      })
    }
    if (t - last >= R.statsIntervalMs) {
      last = t
      const s = sim.stats()
      out.maxH = Math.max(out.maxH, s.maxH)
      out.maxSlope = Math.max(out.maxSlope, s.maxSlope)
      out.mean = Math.max(out.mean, Math.abs(s.mean))
      out.bad += s.bad
      sim.shift(s.mean)
      if (t - lastInput > 300 && t > durMs && isSettled(s)) {
        out.settleMs = t - durMs
        out.hAtClear = s.maxH
        return out
      }
    }
  }
  return out
}

const line = (v: number, y = 100): Path => (t) => {
  const x = 20 + (v * t) / 1000
  return x < 556 ? { x, y } : null
}

function checkStable(name: string, r: ReturnType<typeof simulate>) {
  if (process.env.WATER_VERBOSE) console.log(name, JSON.stringify(r))
  assert.equal(r.bad, 0, `${name}: NaN/Inf`)
  assert.ok(r.maxH <= LIMITS.maxH, `${name}: max|h|=${r.maxH}`)
  assert.ok(r.maxSlope <= LIMITS.maxSlope, `${name}: max|∇h|=${r.maxSlope}`)
  assert.ok(r.mean <= LIMITS.mean, `${name}: mean=${r.mean}`)
  assert.ok(r.settleMs <= LIMITS.settleMs, `${name}: не успокоилось (${r.settleMs})`)
  assert.ok(r.hAtClear < R.settleMaxHPx, `${name}: обнуление на видимой амплитуде`)
}

test('медленно 100 px/с: волны видны, всё устойчиво', () => {
  const r = simulate(line(100), 3000)
  checkStable('100', r)
  assert.ok(r.maxH >= 0.05, `отклик ${r.maxH}`)
})

for (const v of [1000, 2400, 6000]) {
  test(`резко ${v} px/с: амплитуда и уклон ограничены, отклик сохранён`, () => {
    const r = simulate(line(v), Math.min(540000 / v, 3000))
    checkStable(String(v), r)
    if (process.env.WATER_VERBOSE) console.log(v, r.maxH)
    // C7 задан для 1000–2400 px/с; 6000 px/с — за пределом vCap, проверяется только устойчивость и наличие волн.
    assert.ok(r.maxH >= (v <= 2400 ? 0.8 : 0.3), `отклик ${r.maxH}`)
  })
}

test('туда-обратно, круг, зигзаг, серия рывков', () => {
  checkStable('back-forth', simulate((t) => ({ x: 288 + 200 * Math.sin(t / 40), y: 100 }), 2500))
  checkStable('circle', simulate((t) => ({ x: 288 + 60 * Math.cos(t / 40), y: 100 + 50 * Math.sin(t / 40) }), 2500))
  checkStable('zigzag', simulate((t) => ({ x: 30 + ((t * 2) % 520), y: 100 + (Math.floor(t / 30) % 2 ? 50 : -50) }), 2500))
  checkStable('series', simulate((t) => (Math.floor(t / 400) % 2 ? null : { x: 288 + 260 * Math.sin(t / 60), y: 100 + 60 * Math.sin(t / 23) }), 4000))
})

test('хаотичное движение при неровных кадрах (5–60 мс) и клик', () => {
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  let x = 288
  let y = 100
  const r = simulate(
    () => {
      x = Math.min(Math.max(x + (rnd() - 0.5) * 160, 10), 566)
      y = Math.min(Math.max(y + (rnd() - 0.5) * 100, 10), 191)
      return { x, y }
    },
    3000,
    { frame: () => 5 + rnd() * 55 },
  )
  checkStable('chaos', r)
  const c = simulate(() => null, 0, { clickAt: 1 })
  checkStable('click', c)
  assert.ok(c.maxH >= 0.5, `клик ${c.maxH}`)
})
