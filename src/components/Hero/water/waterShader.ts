/**
 * GLSL ES 1.00 (работает и в WebGL1, и в WebGL2). Координаты: x вправо, y вниз (как в CSS),
 * z — к зрителю. Единицы — CSS px; физика переведена в px через PX_TO_M (waterParams.ts).
 * Дно лужи — плоскость z = 0, совпадающая с плоскостью страницы: сквозь воду видна
 * та же композиция фона, что и без неё (кадр Hero + текстура воды страницы).
 */
export const VERTEX_SHADER = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`

export const FRAGMENT_SHADER = `
precision highp float;

uniform vec2 uRes;        // размер холста, device px
uniform vec2 uSize;       // размер блока, CSS px
uniform float uRadius;    // радиус контура, CSS px
uniform float uTime;      // с (уже с художественным замедлением)
uniform float uEnabled;   // effectEnabled: 0 — честный проход фона без воды

uniform vec2 uK[4];       // волновые векторы, рад/px
uniform float uOmega[4];  // рад/с (из дисперсии)
uniform float uAmp[4];    // px
uniform float uPhase[4];
uniform float uThick;     // h∞, px
uniform float uEdgeL;     // ширина краевого профиля, px
uniform float uDampW;     // ширина затухания волн у края, px
uniform float uEta;       // n_air / n_water
uniform float uF0;
uniform float uDepthK;    // refractionStrength (художественный)
uniform vec3 uAbsorb;     // 1/px, с художественным множителем
uniform float uCaust;
uniform float uAlpha;     // GGX α = r²
uniform vec3 uSunDir;
uniform vec3 uSkyDir;
uniform float uSunI;
uniform float uSkyI;
uniform vec3 uEye;        // глаз в локальных координатах блока, px

// Фон
uniform sampler2D uTile;
uniform sampler2D uHero;
uniform float uHasHero;
uniform vec2 uElemPage;   // левый верхний угол блока относительно <main>, CSS px
uniform vec4 uStage;      // x, y, w, h кадра Hero относительно <main>
uniform float uStageH;    // --hero-stage-h
uniform float uFade;      // --water-fade
uniform float uTileOffX;
uniform float uTileSize;
uniform vec4 uHeroMap;    // object-fit: cover — offset.xy, displaySize.xy
uniform vec3 uPageBg;

const float PI = 3.14159265;

vec3 toLin(vec3 c) { return pow(c, vec3(2.2)); }
vec3 toSrgb(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }

vec3 tileAt(vec2 page) {
  vec2 uv = fract(vec2((page.x - uTileOffX) / uTileSize, (page.y - uStageH) / uTileSize));
  vec3 t = texture2D(uTile, uv).rgb;
  return mix(t, vec3(1.0), 0.12); // linear-gradient(rgb(255 255 255 / 0.12)) из App.module.css
}

// Тот же порядок слоёв, что в DOM: фон страницы → ::before → кадр Hero → ::after.
vec3 background(vec2 local) {
  vec2 page = uElemPage + local;
  vec3 c = uPageBg;
  if (page.y >= uStageH) c = tileAt(page);
  vec2 s = page - uStage.xy;
  if (uHasHero > 0.5 && s.x >= 0.0 && s.y >= 0.0 && s.x <= uStage.z && s.y <= uStage.w) {
    vec2 uv = (s - uHeroMap.xy) / uHeroMap.zw;
    c = texture2D(uHero, clamp(uv, 0.0, 1.0)).rgb;
  }
  float bandTop = uStageH - uFade;
  if (page.y >= bandTop && page.y < uStageH) {
    float a = (page.y - bandTop) / uFade; // mask-image: linear-gradient(transparent, #000)
    c = mix(c, tileAt(page), a);
  }
  return c;
}

float sdRoundBox(vec2 p, vec2 halfSize, float r) {
  vec2 q = abs(p) - halfSize + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float tanhF(float x) { float e = exp(-2.0 * min(x, 20.0)); return (1.0 - e) / (1.0 + e); }

float sdf(vec2 p) { return sdRoundBox(p - uSize * 0.5, uSize * 0.5, uRadius); }

// Высота поверхности и её градиент: h = T(s) + w(s)·Σ A sin(k·x − ωt + φ).
// T(s) = h∞ tanh(s / ℓ) — профиль края тонкой лужи, s — расстояние до контура внутрь.
vec3 surface(vec2 p) {
  float s = -sdf(p);
  vec2 e = vec2(0.75, 0.0);
  vec2 gs = -vec2(sdf(p + e.xy) - sdf(p - e.xy), sdf(p + e.yx) - sdf(p - e.yx)) / (2.0 * e.x);
  float sc = max(s, 0.0);
  float th = tanhF(sc / uEdgeL);
  float T = uThick * th;
  float dT = uThick * (1.0 - th * th) / uEdgeL;
  float w = smoothstep(0.0, uDampW, sc);
  float dw = (sc > 0.0 && sc < uDampW) ? 6.0 * (sc / uDampW) * (1.0 - sc / uDampW) / uDampW : 0.0;
  float waves = 0.0;
  vec2 gw = vec2(0.0);
  for (int i = 0; i < 4; i++) {
    float ph = dot(uK[i], p) - uOmega[i] * uTime + uPhase[i];
    waves += uAmp[i] * sin(ph);
    gw += uAmp[i] * cos(ph) * uK[i];
  }
  float h = T + w * waves;
  vec2 g = (dT + dw * waves) * gs + w * gw;
  return vec3(h, g);
}

vec3 normalOf(vec2 grad) { return normalize(vec3(-grad, 1.0)); }

// Точка, куда приходит на дно луч солнца, преломлённый в p: x' = x + h·T.xy/(−T.z).
vec2 lightMap(vec2 p, vec3 L) {
  vec3 sf = surface(p);
  vec3 N = normalOf(sf.yz);
  vec3 T = refract(-L, N, uEta);
  return p + uDepthK * sf.x * T.xy / max(-T.z, 1e-3);
}

float ggxD(float NoH, float a) {
  float a2 = a * a;
  float d = NoH * NoH * (a2 - 1.0) + 1.0;
  return a2 / (PI * d * d);
}

float smithG1(float NoX, float a) {
  float a2 = a * a;
  return 2.0 * NoX / (NoX + sqrt(a2 + (1.0 - a2) * NoX * NoX));
}

float schlick(float c) { return uF0 + (1.0 - uF0) * pow(1.0 - c, 5.0); }

vec3 specular(vec3 N, vec3 V, vec3 L, vec3 color) {
  vec3 H = normalize(L + V);
  float NoL = max(dot(N, L), 0.0);
  float NoV = max(dot(N, V), 1e-3);
  float NoH = max(dot(N, H), 0.0);
  float F = schlick(max(dot(H, V), 0.0));
  float G = smithG1(NoL, uAlpha) * smithG1(NoV, uAlpha);
  float fr = ggxD(NoH, uAlpha) * F * G / (4.0 * NoV * max(NoL, 1e-3));
  return color * fr * NoL;
}

// Окружение для отражения: тёплый свет Hero сверху-слева, светлое небо (художественная модель).
vec3 environment(vec3 R) {
  float up = clamp(-R.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 sky = mix(vec3(0.93, 0.90, 0.80), vec3(0.80, 0.90, 0.93), up);
  return toLin(sky) * (0.6 + 0.4 * clamp(R.z, 0.0, 1.0));
}

void main() {
  vec2 local = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uRes * uSize;
  float d = sdf(local);
  float px = uSize.x / uRes.x;
  float cover = 1.0 - smoothstep(-px, px, d);
  if (cover <= 0.0) { gl_FragColor = vec4(0.0); return; }

  vec3 base = toLin(background(local));
  if (uEnabled < 0.5) { gl_FragColor = vec4(toSrgb(base) * cover, cover); return; }

  vec3 sf = surface(local);
  float h = sf.x;
  vec3 N = normalOf(sf.yz);
  vec3 P = vec3(local, h);
  vec3 I = normalize(P - uEye);
  vec3 V = -I;

  // Снеллиус: T = refract(I, N, n_air/n_water). Смещение выборки относительно
  // луча без воды на эффективной глубине: Δ = h (T.xy/(−T.z) − I.xy/(−I.z)).
  vec3 T = refract(I, N, uEta);
  vec2 delta = uDepthK * h * (T.xy / max(-T.z, 1e-3) - I.xy / max(-I.z, 1e-3));
  vec3 trans = toLin(background(local + delta));

  // Бугер–Ламберт–Бер вдоль пути в слое: путь вниз и обратно после рассеяния дном.
  float path = h / max(-T.z, 1e-3) + h;
  trans *= exp(-uAbsorb * path);

  // Каустика: E ∝ E0 / |J|, J — якобиан отображения лучей солнца на дно.
  vec3 Ls = normalize(uSunDir);
  float ee = 1.5;
  vec2 m0 = lightMap(local, Ls);
  vec2 mx = lightMap(local + vec2(ee, 0.0), Ls);
  vec2 my = lightMap(local + vec2(0.0, ee), Ls);
  vec2 jx = (mx - m0) / ee;
  vec2 jy = (my - m0) / ee;
  float J = abs(jx.x * jy.y - jx.y * jy.x);
  float E = 1.0 / max(J, 0.35); // регуляризация у сингулярностей
  E = min(E, 2.2);
  trans *= mix(1.0, E, uCaust);

  float F = schlick(max(dot(N, V), 0.0));
  vec3 refl = environment(reflect(I, N));
  vec3 col = F * refl + (1.0 - F) * trans;
  col += specular(N, V, Ls, toLin(vec3(1.0, 0.92, 0.78)) * uSunI);
  col += specular(N, V, normalize(uSkyDir), toLin(vec3(0.85, 0.95, 0.97)) * uSkyI);

  gl_FragColor = vec4(toSrgb(col) * cover, cover);
}
`
