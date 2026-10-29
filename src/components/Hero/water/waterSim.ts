/**
 * Интерактивное высотное поле лужи на GPU (WebGL1, ping-pong FBO).
 *
 * Уравнение (единицы: px, с модельного времени):
 *   ∂²h/∂t² = a ∇²h − b ∇⁴h − β ∂h/∂t + S(x, t)
 * a, b — подгонка дисперсии гравитационно-капиллярных волн (waterParams.rippleDispersionFit),
 * β = 2νk_c² · dampingBoost, S — давление курсора: «мексиканская шляпа» G(σ) − κG(2σ) вдоль пути
 * с нулевым интегралом (объём сохраняется) и мягким насыщением по высоте под курсором.
 * Явная схема «чехарда» по времени, центральные разности по пространству:
 *   h⁺ = [2h − (1 − βΔt/2) h⁻ + aΔt²/Δx² · L(h) − bΔt²/Δx⁴ · L²(h) + Δt² S] / (1 + βΔt/2)
 * L — 5-точечный лапласиан, L² — 13-точечный бигармонический шаблон.
 * Устойчивость: ω_max Δt ≤ 2, ω_max² = 8a/Δx² + 64b/Δx⁴ (для b = 0 это CFL cΔt/Δx ≤ 1/√2).
 * Граница — контур лужи: Нейман ∂h/∂n = 0 (соседи снаружи маски берут значение центра),
 * поэтому волны отражаются от края.
 */
import { RIPPLE_ARTISTIC as R } from './waterParams'
import { fieldStats, hatKappa, segmentAmp, simCoefficients, splitPolyline, type FieldStats } from './waterCore'

export type SimFormat = 'float' | 'half' | 'pack'

/** Диапазон высоты для упаковки в RGBA8, px. */
export const PACK_RANGE_PX = 16

export const SIM_CODEC = `
#ifdef PACK
const float PACK_R = ${PACK_RANGE_PX.toFixed(1)};
vec2 enc16(float v) {
  float u = clamp(v / PACK_R * 0.5 + 0.5, 0.0, 1.0) * 65535.0;
  float hi = floor(u / 256.0);
  return vec2(hi, u - hi * 256.0) / 255.0;
}
float dec16(vec2 c) { return ((c.x * 255.0 * 256.0 + c.y * 255.0) / 65535.0 - 0.5) * 2.0 * PACK_R; }
vec2 decodeState(vec4 c) { return vec2(dec16(c.rg), dec16(c.ba)); }
vec4 encodeState(vec2 s) { return vec4(enc16(s.x), enc16(s.y)); }
#else
vec2 decodeState(vec4 c) { return c.rg; }
vec4 encodeState(vec2 s) { return vec4(s, 0.0, 1.0); }
#endif
`

const SIM_FRAGMENT = `
precision highp float;
uniform sampler2D uState;
uniform vec2 uGrid;      // ячеек по x, y
uniform float uDx;       // CSS px на ячейку
uniform vec2 uSize;      // блок, CSS px
uniform float uRadius;
uniform float uA;        // a Δt²/Δx²
uniform float uB;        // b Δt²/Δx⁴
uniform float uBeta;     // β Δt
uniform vec4 uSeg;       // отрезок источника за подшаг, px
uniform float uSegAmp;   // Δt² S0, px
uniform float uSigma;
uniform vec3 uImpulse;   // x, y, глубина впадины (px), применяется один раз
uniform float uImpSigma;
uniform float uReset;
uniform float uKappa;    // вес широкой гауссианы (нулевой интеграл источника)
uniform float uHSat;     // высота насыщения источника, px
uniform float uShift;    // вычитаемый средний уровень (проекция объёма), px
uniform vec3 uResample;  // z > 0.5: перенос поля со старой сетки (xy — её размер)
uniform vec4 uFlood;     // xy — центр, z — амплитуда (объём > 0), w — σ, px; растекание
${SIM_CODEC}

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
bool inside(vec2 c) {
  if (c.x < 0.0 || c.y < 0.0 || c.x > uGrid.x || c.y > uGrid.y) return false;
  return sdRoundBox(c * uDx - uSize * 0.5, uSize * 0.5, uRadius) < -0.5 * uDx;
}
vec2 st(vec2 c) { return decodeState(texture2D(uState, c / uGrid)); }
// Нейман: сосед за контуром = значение в центре (зеркальное отражение).
float H(vec2 c, float hc) { return inside(c) ? (st(c).x - uShift) : hc; }

float probe(vec2 p) {
  vec2 c = floor(p / uDx) + 0.5;
  return inside(c) ? (st(c).x - uShift) : 0.0;
}

// Связь источника с водой у борта: широкая часть «шляпы» обрезалась бы контуром и источник
// потерял бы нулевой интеграл (дрейф уровня). Плавно гасим вклад в полосе у края.
float edgeCouple(vec2 p, float sw) {
  float d = -sdRoundBox(p - uSize * 0.5, uSize * 0.5, uRadius);
  return smoothstep(sw, 4.0 * sw, d);
}

void main() {
  vec2 c = gl_FragCoord.xy;
  if (uReset > 0.5 || !inside(c)) { gl_FragColor = encodeState(vec2(0.0)); return; }
  if (uResample.z > 1.5) {
    // Только проекция среднего: h′ = h − uShift, hp′ = hp − uShift.
    gl_FragColor = encodeState(st(c) - uShift);
    return;
  }
  if (uResample.z > 0.5) {
    // Смена сетки: те же относительные координаты блока, высоты в CSS px не меняются.
    gl_FragColor = encodeState(decodeState(texture2D(uState, c / uGrid)));
    return;
  }
  vec2 s = st(c) - uShift;
  float h = s.x;
  float hp = s.y;
  float n4 = H(c + vec2(1.0, 0.0), h) + H(c - vec2(1.0, 0.0), h) + H(c + vec2(0.0, 1.0), h) + H(c - vec2(0.0, 1.0), h);
  float dg = H(c + vec2(1.0, 1.0), h) + H(c + vec2(1.0, -1.0), h) + H(c + vec2(-1.0, 1.0), h) + H(c + vec2(-1.0, -1.0), h);
  float f2 = H(c + vec2(2.0, 0.0), h) + H(c - vec2(2.0, 0.0), h) + H(c + vec2(0.0, 2.0), h) + H(c - vec2(0.0, 2.0), h);
  // Изотропный 9-точечный лапласиан (Oono–Puri): анизотропия O(k⁴) вместо O(k²),
  // фронт кольца остаётся круглым, а не «квадратным».
  float lap = (4.0 * n4 + dg - 20.0 * h) / 6.0;
  float bih = 20.0 * h - 8.0 * n4 + 2.0 * dg + f2;

  vec2 p = c * uDx;
  // Источник вдоль отрезка (капсула): движение интерполировано, пунктира нет.
  vec2 ab = uSeg.zw - uSeg.xy;
  float t = clamp(dot(p - uSeg.xy, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0);
  vec2 dv = p - uSeg.xy - ab * t;
  float d2 = dot(dv, dv);
  // Связь только в середине хорды: min по концам обнулял бы длинный жест, чьи
  // концы у борта, а энергия как раз должна осесть в середине лужи.
  vec2 mid = 0.5 * (uSeg.xy + uSeg.zw);
  float hs = probe(mid);
  float sat = uHSat * uHSat / (uHSat * uHSat + hs * hs) * edgeCouple(mid, 2.0 * uSigma);
  float src = uSegAmp * sat * (exp(-d2 / (2.0 * uSigma * uSigma)) - uKappa * exp(-d2 / (8.0 * uSigma * uSigma)));

  float hn = (2.0 * h - (1.0 - 0.5 * uBeta) * hp + uA * lap - uB * bih - src) / (1.0 + 0.5 * uBeta);
  vec2 di = p - uImpulse.xy;
  float di2 = dot(di, di);
  float hi = probe(uImpulse.xy);
  float imp = -uImpulse.z * uHSat * uHSat / (uHSat * uHSat + hi * hi) * edgeCouple(uImpulse.xy, 2.0 * uImpSigma)
    * (exp(-di2 / (2.0 * uImpSigma * uImpSigma)) - 0.25 * exp(-di2 / (8.0 * uImpSigma * uImpSigma)));
  // Положительный объём для растекания (не «шляпа»): горб растекается по области через ту же PDE.
  float flood = 0.0;
  if (uFlood.z > 0.0 && uFlood.w > 0.0) {
    vec2 df = p - uFlood.xy;
    flood = uFlood.z * exp(-dot(df, df) / (2.0 * uFlood.w * uFlood.w)) * edgeCouple(uFlood.xy, 2.0 * uFlood.w);
  }
  gl_FragColor = encodeState(vec2(hn + imp + flood, h + imp + flood));
}
`

const VERTEX = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`

const HALF_FLOAT_OES = 0x8d61

function tryFormat(gl: WebGLRenderingContext, type: number): boolean {
  const tex = gl.createTexture()
  const fb = gl.createFramebuffer()
  if (!tex || !fb) return false
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 4, 4, 0, gl.RGBA, type, null)
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE && gl.getError() === gl.NO_ERROR
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.deleteFramebuffer(fb)
  gl.deleteTexture(tex)
  return ok
}

/** float → half-float → упаковка 16 бит в RGBA8. */
export function detectSimFormat(gl: WebGLRenderingContext): SimFormat {
  if (gl.getExtension('OES_texture_float') && tryFormat(gl, gl.FLOAT)) return 'float'
  if (gl.getExtension('OES_texture_half_float') && tryFormat(gl, HALF_FLOAT_OES)) return 'half'
  return 'pack'
}

export interface SimInput {
  /** Полный путь курсора за кадр (ломаная, px блока) и ускорение источника, px/с². */
  path: { pts: { x: number; y: number }[]; accel: number } | null
  impulse: { x: number; y: number } | null
}

export class RippleSim {
  readonly format: SimFormat
  private gl: WebGLRenderingContext
  private program: WebGLProgram
  private shaders: WebGLShader[] = []
  private tex: WebGLTexture[] = []
  private fbo: WebGLFramebuffer[] = []
  private cur = 0
  private loc: Record<string, WebGLUniformLocation | null>
  private type: number
  grid: [number, number] = [1, 1]
  dx = 1
  /** Фиксированный шаг модельного времени, с. */
  dt = 0
  private acc = 0
  /** Коэффициент затухания β, 1/с модельного времени. */
  beta = 0
  /** Время подшагов, «срезанных» лимитом maxSubsteps (диагностика), с. */
  droppedTime = 0
  private size: [number, number] = [1, 1]
  private radius = 0
  private stencil: [number, number, number] = [0, 0, 0]

  constructor(gl: WebGLRenderingContext, format: SimFormat, compile: (t: number, s: string) => WebGLShader) {
    this.gl = gl
    this.format = format
    this.type = format === 'float' ? gl.FLOAT : format === 'half' ? HALF_FLOAT_OES : gl.UNSIGNED_BYTE
    const defs = format === 'pack' ? '#define PACK 1\n' : ''
    const vs = compile(gl.VERTEX_SHADER, VERTEX)
    const fs = compile(gl.FRAGMENT_SHADER, defs + SIM_FRAGMENT)
    this.shaders.push(vs, fs)
    const program = gl.createProgram()
    if (!program) throw new Error('sim program')
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.bindAttribLocation(program, 0, 'aPos')
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('sim link')
    this.program = program
    const names = ['uState', 'uGrid', 'uDx', 'uSize', 'uRadius', 'uA', 'uB', 'uBeta', 'uSeg', 'uSegAmp', 'uSigma', 'uImpulse', 'uImpSigma', 'uReset', 'uKappa', 'uHSat', 'uShift', 'uResample', 'uFlood']
    this.loc = Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(program, n)]))
  }

  /**
   * Подгоняет сетку под размер блока. Материал и шейдер отрисовки не трогаются; поле
   * сохраняется (при смене сетки — переносится в те же относительные координаты), а не
   * обнуляется: изменение размера не вызывает «сброса» воды.
   */
  resize(cssW: number, cssH: number, radius: number, long: number) {
    const gl = this.gl
    this.dx = Math.max(cssW, cssH) / long
    const gw = Math.max(4, Math.round(cssW / this.dx))
    const gh = Math.max(4, Math.round(cssH / this.dx))
    this.size = [cssW, cssH]
    this.radius = radius
    const first = this.tex.length === 0
    if (first || gw !== this.grid[0] || gh !== this.grid[1]) {
      const oldTex = this.tex[this.cur]
      const keep = this.tex
      const keepF = this.fbo
      const oldGrid = this.grid
      this.tex = []
      this.fbo = []
      this.grid = [gw, gh]
      for (let i = 0; i < 2; i++) {
        const t = gl.createTexture()
        const f = gl.createFramebuffer()
        if (!t || !f) throw new Error('sim target')
        gl.bindTexture(gl.TEXTURE_2D, t)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gw, gh, 0, gl.RGBA, this.type, null)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.bindFramebuffer(gl.FRAMEBUFFER, f)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0)
        this.tex.push(t)
        this.fbo.push(f)
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      this.cur = 0
      this.setUniforms(gw, gh, cssW, cssH, radius)
      if (first || !oldTex) {
        this.clear()
      } else {
        // Перенос старого поля в новую сетку (оба слоя h, h⁻ — скорость сохраняется).
        this.pass(() => gl.uniform3f(this.loc.uResample, oldGrid[0], oldGrid[1], 1), oldTex)
      }
      keep.forEach((t) => gl.deleteTexture(t))
      keepF.forEach((f) => gl.deleteFramebuffer(f))
    } else {
      this.setUniforms(gw, gh, cssW, cssH, radius)
    }
  }

  private setUniforms(gw: number, gh: number, cssW: number, cssH: number, radius: number) {
    const gl = this.gl
    const co = simCoefficients(this.dx)
    this.dt = co.dt
    this.beta = co.beta
    this.stencil = [co.A, co.B, co.betaDt]
    gl.useProgram(this.program)
    gl.uniform2f(this.loc.uGrid, gw, gh)
    gl.uniform1f(this.loc.uDx, this.dx)
    gl.uniform2f(this.loc.uSize, cssW, cssH)
    gl.uniform1f(this.loc.uRadius, radius)
    gl.uniform1f(this.loc.uA, co.A)
    gl.uniform1f(this.loc.uB, co.B)
    gl.uniform1f(this.loc.uBeta, co.betaDt)
    gl.uniform1f(this.loc.uSigma, R.spotSigmaPx)
    gl.uniform1f(this.loc.uImpSigma, R.impulseSigmaPx)
    gl.uniform1f(this.loc.uHSat, R.saturationPx)
    gl.uniform1i(this.loc.uState, 3)
  }

  /** Обнулить поле. Вызывается только когда поле уже ниже порога видимости (или NaN). */
  clear() {
    this.pass(() => this.gl.uniform1f(this.loc.uReset, 1))
    this.pass(() => this.gl.uniform1f(this.loc.uReset, 1))
    this.acc = 0
  }

  /** Вычесть средний уровень (проекция объёма). Отдельный проход — без PDE, иначе
   *  при ненулевом uShift соседи в лапласиане должны тоже быть сдвинуты. */
  removeMean(mean: number) {
    if (!Number.isFinite(mean) || Math.abs(mean) < 1e-8) return
    const gl = this.gl
    this.pass(() => {
      gl.uniform1f(this.loc.uShift, mean)
      gl.uniform3f(this.loc.uResample, 0, 0, 2) // z=2: только вычесть среднее
    })
  }

  /**
   * Влить положительный объём (горб гауссианы) — для растекания по странице.
   * В отличие от курсорной «шляпы», интеграл > 0: вода остаётся и расходится по домену PDE.
   */
  flood(x: number, y: number, amp: number, sigma: number) {
    if (!(amp > 0) || !(sigma > 0)) return
    const gl = this.gl
    this.pass(() => gl.uniform4f(this.loc.uFlood, x, y, amp, sigma))
  }

  private pass(setup: () => void, from?: WebGLTexture) {
    const gl = this.gl
    if (this.tex.length < 2) return
    gl.useProgram(this.program)
    gl.activeTexture(gl.TEXTURE3)
    // Ping-pong: читаем текущий слой, пишем в другой.
    gl.bindTexture(gl.TEXTURE_2D, from ?? this.tex[this.cur])
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[1 - this.cur])
    gl.viewport(0, 0, this.grid[0], this.grid[1])
    gl.uniform1f(this.loc.uReset, 0)
    gl.uniform3f(this.loc.uImpulse, 0, 0, 0)
    gl.uniform1f(this.loc.uSegAmp, 0)
    gl.uniform4f(this.loc.uSeg, -1e4, -1e4, -1e4, -1e4)
    gl.uniform1f(this.loc.uShift, 0)
    gl.uniform3f(this.loc.uResample, 0, 0, 0)
    gl.uniform4f(this.loc.uFlood, 0, 0, 0, 0)
    setup()
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.cur = 1 - this.cur
  }

  /**
   * Продвигает поле на dtReal реальных секунд фиксированными подшагами dt.
   * Долг времени ограничен: при лимите подшагов переносится не больше одного шага
   * (без «догоняющих» рывков), срезанное время копится в droppedTime для диагностики.
   * Путь курсора за кадр делится между подшагами по длине дуги.
   */
  step(dtReal: number, input: SimInput): number {
    const real = Number.isFinite(dtReal) ? Math.min(Math.max(dtReal, 0), 1 / 20) : 0
    this.acc += real * R.timeScale
    let n = Math.floor(this.acc / this.dt)
    if (n > R.maxSubsteps) {
      n = R.maxSubsteps
      const rest = this.acc - n * this.dt
      this.acc = Math.min(rest, this.dt)
      this.droppedTime += rest - this.acc
    } else {
      this.acc -= n * this.dt
    }
    if (n === 0 && input.impulse) n = 1
    const gl = this.gl
    const chords = input.path ? splitPolyline(input.path.pts, n) : []
    for (let i = 0; i < n; i++) {
      this.pass(() => {
        if (i === 0 && input.impulse) {
          gl.uniform3f(this.loc.uImpulse, input.impulse.x, input.impulse.y, R.impulseDepthPx)
        }
        const c = chords[i]
        if (c && input.path) {
          gl.uniform4f(this.loc.uSeg, c.ax, c.ay, c.bx, c.by)
          gl.uniform1f(this.loc.uSegAmp, segmentAmp(this.dt, input.path.accel, c.arc))
          gl.uniform1f(this.loc.uKappa, hatKappa(R.spotSigmaPx, Math.hypot(c.bx - c.ax, c.by - c.ay)))
        }
      })
    }
    return n
  }

  /** Считать текущий слой h (CPU). null — формат не читается (тогда работает запасной критерий). */
  readField(): Float32Array | null {
    const gl = this.gl
    const [gw, gh] = this.grid
    if (this.tex.length < 2) return null
    const out = new Float32Array(gw * gh)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[this.cur])
    let ok = true
    if (this.format === 'pack') {
      const b = new Uint8Array(gw * gh * 4)
      gl.readPixels(0, 0, gw, gh, gl.RGBA, gl.UNSIGNED_BYTE, b)
      for (let i = 0; i < gw * gh; i++) out[i] = ((b[4 * i] * 256 + b[4 * i + 1]) / 65535 - 0.5) * 2 * PACK_RANGE_PX
    } else {
      const b = new Float32Array(gw * gh * 4)
      gl.readPixels(0, 0, gw, gh, gl.RGBA, gl.FLOAT, b)
      if (gl.getError() !== gl.NO_ERROR) ok = false
      for (let i = 0; i < gw * gh; i++) out[i] = b[4 * i]
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return ok ? out : null
  }

  stats(): FieldStats | null {
    const f = this.readField()
    if (!f) return null
    return fieldStats(f, this.grid[0], this.grid[1], this.dx, this.size[0], this.size[1], this.radius)
  }

  get coefficients() {
    return this.stencil
  }

  /** Привязать текущее поле к текстурному блоку для шейдера отрисовки. */
  bind(unit: number) {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, this.tex[this.cur])
  }

  get cssSize() {
    return this.size
  }

  private freeTargets() {
    this.tex.forEach((t) => this.gl.deleteTexture(t))
    this.fbo.forEach((f) => this.gl.deleteFramebuffer(f))
    this.tex = []
    this.fbo = []
    this.cur = 0
  }

  dispose() {
    this.freeTargets()
    this.shaders.forEach((s) => this.gl.deleteShader(s))
    this.gl.deleteProgram(this.program)
  }
}
