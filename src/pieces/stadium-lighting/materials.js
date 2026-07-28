// PIECE stadium-lighting — THREE shader programs, and only three.
//
//   sprite   every additive element: flare cores, anamorphic streaks, iris stars,
//            haze billows, rain streaks, bolt ribbons and the flash veil. All of it
//            is attribute-driven, so five meshes share ONE program and one texture.
//   shaft    the volumetric beams: a cylindrically-billboarded ribbon that raymarches
//            its own dust density and carves analytic occluder shadows into itself.
//   sky      the storm dome: three scrolling cloud layers over the bowl's sky.
//
// Programs at this piece's tier caps are 1/2/3/4. Three materials of the SAME source
// share one program in three.js (the cache key is the source text), which is how the
// bolt and the veil get their own gain without costing a program.
//
// GLSL3 throughout: dynamic loop bounds (the shaft's step count is a uniform, so the
// rung can change the march length WITHOUT recompiling — a rung change that compiles
// is a 5-50 ms stall on a real mobile driver and the contract forbids it).

import * as THREE from 'three';

/* =========================================================== 1. THE SPRITE */

const SPRITE_VERT = /* glsl */`
in vec2 aCorner;      // quad corner, -1..1
in vec2 aSize;        // metres (width, height)
in vec3 aColor;       // linear radiance multiplier
in vec4 aRect;        // atlas uv rect  (u0, v0, du, dv)
in vec4 aParam;       // (mode, phase, speed, rot|span)
in vec2 aExtra;       // (group id 0..3, spare)

out vec2 vUv01;
out vec4 vRect;
out vec3 vColor;
out float vFade;

uniform float uT;
uniform float uFogD;
uniform vec4 uGains;  // per-group gain: 0 atmos, 1 rain, 2 bolt, 3 veil

// Four meshes share ONE material instance so the whole additive layer is ONE shader
// program (the structural budget allows 4 for this piece and the shafts and the sky
// need two of them). Per-group brightness therefore has to travel as vertex data.
float gsel(float id) {
  return id < 0.5 ? uGains.x : id < 1.5 ? uGains.y : id < 2.5 ? uGains.z : uGains.w;
}

void main() {
  float mode = aParam.x;
  vec3 anchor = position;

  // mode 1 — rain. Falls and wraps entirely in the vertex shader, so the streaks
  // are a pure function of t with zero CPU work and zero per-frame allocation.
  if (mode > 0.5 && mode < 1.5) {
    float span = aParam.w;
    float fall = mod(uT * aParam.z + aParam.y * span, span);
    anchor.y -= fall;
    anchor.x += sin(uT * 0.65 + aParam.y * 41.0) * 0.28;
    anchor.z += cos(uT * 0.51 + aParam.y * 27.0) * 0.20;
  }

  vec4 mv = modelViewMatrix * vec4(anchor, 1.0);
  float dist = length(mv.xyz);

  vec2 half_ = aSize * 0.5;
  vec3 off;
  if (mode > 1.5) {
    // mode 2 - ribbon billboarded about an axis carried in the 'normal' attribute
    vec3 axisV = normalize(mat3(modelViewMatrix) * normal);
    vec3 vdir = normalize(-mv.xyz);
    vec3 side = normalize(cross(axisV, vdir));
    off = side * (aCorner.x * half_.x) + axisV * (aCorner.y * half_.y);
  } else {
    // screen-aligned; aParam.w rotates it in screen space for mode 0
    float rot = (mode < 0.5) ? aParam.w : aExtra.y;
    float c = cos(rot), s = sin(rot);
    vec2 q = vec2(aCorner.x * half_.x, aCorner.y * half_.y);
    off = vec3(q.x * c - q.y * s, q.x * s + q.y * c, 0.0);
  }
  mv.xyz += off;

  gl_Position = projectionMatrix * mv;

  vUv01 = aCorner * 0.5 + 0.5;
  vRect = aRect;
  vColor = aColor;

  // Additive light travelling through haze must lose energy, or every far luminaire
  // reads as near. Matches the FogExp2 law the opaque materials use.
  float fd = dist * uFogD;
  vFade = exp(-fd * fd * 0.85) * gsel(aExtra.x);
  // and never let a sprite the camera is inside of blow the frame out
  vFade *= smoothstep(0.10, 1.60, dist);
}`;

const SPRITE_FRAG = /* glsl */`
precision highp float;
in vec2 vUv01;
in vec4 vRect;
in vec3 vColor;
in float vFade;
uniform sampler2D uAtlas;
out vec4 fragColor;
void main() {
  if (vFade <= 0.0) discard;
  vec4 t = texture(uAtlas, vRect.xy + vUv01 * vRect.zw);
  float a = t.a * vFade;
  if (a <= 0.0006) discard;
  fragColor = vec4(t.rgb * vColor * a, 1.0);
}`;

export function makeSpriteMaterial(atlas, fogD) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: SPRITE_VERT,
    fragmentShader: SPRITE_FRAG,
    uniforms: {
      uAtlas: { value: atlas },
      uT: { value: 0 },
      uGains: { value: new THREE.Vector4(1, 1, 0, 0) },
      uFogD: { value: fogD !== undefined ? fogD : 0.0082 },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: true,
    fog: false,
  });
}

/* ============================================================ 2. THE SHAFT */

const SHAFT_VERT = /* glsl */`
in vec2 aQuad;        // (t along the beam 0..1, side -1..1)
in vec4 aShaft;       // (widthAtSource, widthAtEnd, power, seed)

out vec3 vWorld;
out vec3 vAxis;
out vec3 vView;
out float vT;
out float vU;
out float vPow;
out float vSeed;
out float vDist;

void main() {
  // 'position' carries the SOURCE point and 'normal' the END point, both world space.
  vec3 S = position;
  vec3 E = normal;
  float a = aQuad.x;
  vec3 P = mix(S, E, a);
  vec3 axis = normalize(E - S);
  vec3 toCam = cameraPosition - P;
  float d = length(toCam);
  vec3 vdir = toCam / max(d, 1e-4);
  vec3 side = cross(axis, vdir);
  float sl = length(side);
  side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);

  float w = mix(aShaft.x, aShaft.y, a);
  vec3 Pw = P + side * (aQuad.y * w);

  vWorld = Pw;
  vAxis = axis;
  vView = vdir;
  vT = a;
  vU = aQuad.y;
  vPow = aShaft.z;
  vSeed = aShaft.w;
  vDist = d;

  gl_Position = projectionMatrix * viewMatrix * vec4(Pw, 1.0);
}`;

const SHAFT_FRAG = /* glsl */`
precision highp float;
in vec3 vWorld;
in vec3 vAxis;
in vec3 vView;
in float vT;
in float vU;
in float vPow;
in float vSeed;
in float vDist;

uniform sampler2D uDust;
uniform float uT;
uniform float uGain;
uniform float uFogD;
uniform int   uSteps;
uniform float uStepLen;
uniform float uOccluding;
uniform vec4  uOcc[6];        // xyz centre, w radius. w<=0 disables the slot.
uniform vec3  uWarm;
uniform vec3  uCool;
out vec4 fragColor;

// How much of this point is in the shadow of a body standing in the beam.
// The occluder is swept along the BEAM axis, so a player carves a real cylinder of
// darkness downstream of himself — which is what "players carve into the shafts" is.
float shade(vec3 Q) {
  float s = 1.0;
  for (int i = 0; i < 6; i++) {
    vec4 o = uOcc[i];
    if (o.w <= 0.0) continue;
    vec3 d = Q - o.xyz;
    float t = dot(d, vAxis);
    if (t <= 0.0) continue;
    vec3 perp = d - vAxis * t;
    float r = length(perp);
    // penumbra widens and the shadow washes out with distance behind the body
    float grow = o.w * (1.0 + t * 0.055);
    float edge = smoothstep(grow * 0.42, grow * 1.20, r);
    float decay = clamp(1.0 - t * 0.026, 0.30, 1.0);
    s *= mix(1.0, edge, decay);
  }
  return s;
}

void main() {
  // radial profile across the ribbon: a tight core with a narrow skirt. A wide skirt
  // over fifteen beams is a grey veil across the whole frame, not a light shaft.
  float u2 = vU * vU;
  float radial = exp(-u2 * 4.2) * 0.92 + exp(-u2 * 1.5) * 0.13;

  // along the beam: hot at the luminaire, essentially gone by a third of the way down
  float a = vT;
  float lengthFade = pow(1.0 - a, 1.35) * exp(-a * 1.90);

  // drifting dust
  vec2 duv = vec2(a * 1.35 + vSeed * 0.371, (vU * 0.5 + 0.5) * 0.62 + vSeed * 0.117 - uT * 0.010);
  float d1 = texture(uDust, duv).r;
  float d2 = texture(uDust, duv * 2.9 + vec2(uT * 0.017, uT * 0.006)).g;
  float dust = 0.40 + 0.95 * (d1 * 0.62 + d2 * 0.38);

  // occlusion, marched along the view ray so the shadow has real thickness
  float occ = 1.0;
  if (uOccluding > 0.5) {
    float acc = 0.0;
    float n = 0.0;
    for (int i = 0; i < 5; i++) {
      if (i >= uSteps) break;
      float k = (float(i) - (float(uSteps) - 1.0) * 0.5) * uStepLen;
      acc += shade(vWorld - vView * k);
      n += 1.0;
    }
    occ = acc / max(n, 1.0);
  }

  // a beam pointing straight at the camera has no ribbon to show
  float par = 1.0 - abs(dot(vAxis, vView));
  float facing = smoothstep(0.004, 0.085, par);

  // never let the ribbon slam into the turf with a hard edge
  float ground = smoothstep(-1.2, 3.4, vWorld.y);

  float fd = vDist * uFogD;
  float atten = exp(-fd * fd * 0.55);

  float I = radial * lengthFade * dust * occ * facing * ground * atten * vPow * uGain;
  if (I <= 0.0008) discard;

  vec3 col = mix(uWarm, uCool, clamp(a * 1.15, 0.0, 1.0));
  fragColor = vec4(col * I, 1.0);
}`;

export function makeShaftMaterial(dust, warm, cool) {
  const occ = [];
  for (let i = 0; i < 6; i++) occ.push(new THREE.Vector4(0, 0, 0, 0));
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: SHAFT_VERT,
    fragmentShader: SHAFT_FRAG,
    uniforms: {
      uDust: { value: dust },
      uT: { value: 0 },
      uGain: { value: 1 },
      uFogD: { value: 0.0082 },
      uSteps: { value: 5 },
      uStepLen: { value: 0.85 },
      uOccluding: { value: 1 },
      uOcc: { value: occ },
      uWarm: { value: new THREE.Vector3(warm[0], warm[1], warm[2]) },
      uCool: { value: new THREE.Vector3(cool[0], cool[1], cool[2]) },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: true,
    fog: false,
  });
}

/* ============================================================== 3. THE SKY */

const SKY_VERT = /* glsl */`
out vec3 vW;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const SKY_FRAG = /* glsl */`
precision highp float;
in vec3 vW;
uniform sampler2D uCloud;
uniform float uT;
uniform float uDetail;
uniform float uCover;
uniform float uFlash;
uniform vec3  uFlashDir;
uniform vec3  uDark;
uniform vec3  uLit;
uniform vec3  uRim;
out vec4 fragColor;

void main() {
  vec3 dir = normalize(vW);
  float el = clamp(dir.y, -1.0, 1.0);
  if (el < -0.02) discard;

  float az = atan(dir.z, dir.x) * 0.1591549 + 0.5;
  float h = clamp((el - 0.02) / 0.62, 0.0, 1.0);
  vec2 base = vec2(az, 1.0 - clamp(el, 0.0, 1.0));

  // three layers at different scales and drift rates — this is what makes a sky
  // read as weather rather than as a texture
  float m0 = texture(uCloud, base * vec2(1.00, 1.00) + vec2(uT * 0.0021, 0.0)).r;
  float m1 = texture(uCloud, base * vec2(2.20, 1.65) + vec2(uT * 0.0053, 0.011)).g;
  float m2 = texture(uCloud, base * vec2(0.58, 0.52) + vec2(-uT * 0.0012, 0.0)).r;
  float lit = texture(uCloud, base * vec2(1.00, 1.00) + vec2(uT * 0.0021, 0.0)).b;

  float mass = m2 * 0.52 + m0 * 0.58 + m1 * 0.34 * uDetail;
  mass = clamp((mass - 0.545) * 3.70 * uCover, 0.0, 1.0);

  float a = smoothstep(0.01, 0.42, mass) * smoothstep(-0.02, 0.16, el) * (1.0 - 0.22 * h);

  vec3 c = uDark;
  c += uLit * pow(1.0 - h, 2.4) * (1.0 - lit) * 0.85;   // sodium bounce on the base
  c += uRim * lit * 0.52;                                // cool sky on the updraft tops

  float fd = max(0.0, dot(dir, uFlashDir));
  c += vec3(0.62, 0.60, 0.82) * uFlash * (0.055 + 1.15 * pow(fd, 3.0)) * (0.30 + 0.95 * mass);
  a = clamp(a + uFlash * mass * 0.14, 0.0, 1.0);

  fragColor = vec4(c, a);
}`;

export function makeSkyMaterial(cloud, dark, lit, rim) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    uniforms: {
      uCloud: { value: cloud },
      uT: { value: 0 },
      uDetail: { value: 1 },
      uCover: { value: 1 },
      uFlash: { value: 0 },
      uFlashDir: { value: new THREE.Vector3(0.6, 0.4, -0.7).normalize() },
      uDark: { value: new THREE.Vector3(dark[0], dark[1], dark[2]) },
      uLit: { value: new THREE.Vector3(lit[0], lit[1], lit[2]) },
      uRim: { value: new THREE.Vector3(rim[0], rim[1], rim[2]) },
    },
    transparent: true,
    blending: THREE.NormalBlending,
    depthTest: true,
    depthWrite: false,
    side: THREE.BackSide,
    toneMapped: true,
    fog: false,
  });
}

export default { makeSpriteMaterial, makeShaftMaterial, makeSkyMaterial };
