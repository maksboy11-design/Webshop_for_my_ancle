import { test } from 'node:test'
import assert from 'node:assert/strict'
import { frontPx, PanelWater, ritterDepth, travelTime, waveSpeedPx } from '../src/components/site/waterSelect/outflow'
import { PHYSICAL, PUDDLE_THICKNESS_M, PX_TO_M } from '../src/components/Hero/water/waterParams'

test('фронт Риттера: x_f = 2√(g h0)·t (в px, с timeScale)', () => {
  assert.ok(Math.abs(waveSpeedPx() - Math.sqrt(PHYSICAL.gravity * PUDDLE_THICKNESS_M) / PX_TO_M) < 1e-9)
  assert.ok(Math.abs(frontPx(0.1, PUDDLE_THICKNESS_M, 1) - 0.2 * waveSpeedPx()) < 1e-9)
  assert.ok(Math.abs(frontPx(travelTime(100)) - 100) < 1e-9)
})

test('профиль толщины монотонно убывает к фронту', () => {
  assert.equal(ritterDepth(0, 100), 1)
  assert.equal(ritterDepth(100, 100), 0)
  assert.ok(ritterDepth(30, 100) > ritterDepth(60, 100))
})

test('вытекание и затекание симметричны по времени, рябь конечна и затухает', () => {
  const w = new PanelWater(240, 100)
  w.open()
  let t = 0
  while (w.phase !== 'open' && t < 2) { w.advance(1 / 60); t += 1 / 60 }
  assert.equal(w.phase, 'open')
  const openT = t
  const s = w.sim.stats()
  assert.equal(s.bad, 0)
  assert.ok(s.maxH > 0 && s.maxH < 20, `maxH ${s.maxH}`)
  w.close()
  t = 0
  while ((w.phase as string) !== 'closed' && t < 2) { w.advance(1 / 60); t += 1 / 60 }
  assert.equal(w.phase, 'closed')
  assert.ok(Math.abs(t - openT) < 0.05)
  assert.equal(w.advance(1 / 60), false)
})
