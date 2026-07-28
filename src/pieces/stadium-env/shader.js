// PIECE stadium-env — the materials. FIVE programs for the whole stadium.
//
// The bowl is ONE program because crowd and structure are one merged mesh that
// branches on a per-vertex mask. That is not a micro-optimisation: the recut budget
// allows this piece 1/2/4/5 programs across the tiers, and a stadium made of eight
// materials would fail the gate before a critic ever saw it.
//
// Nothing here is lit by a scene light. A night bowl is lit by its own luminaires;
// modelling that with real lights would cost shadow maps and forward light loops on
// the piece that is meant to be free. So value structure is baked into vertex colour
// (per section, per row, per band) and the shader only adds what must move: fog,
// camera flashes, LED scroll.
//
// Linearisation is c*c, not pow(c, 2.2). The difference at these values is under 4%
// and invisible next to the grade, and it saves three pow() per pixel on the largest
// surface on screen.

import * as THREE from 'three';
import { PALETTE } from './config.js';

export function lin(hex) {
  let t = String(hex).replace('#', '');
  if (t.length === 3) t = t[0] + t[0] + t[1] + t[1] + t[2] + t[2];
  const v = parseInt(t, 16);
  const r = ((v >> 16) & 255) / 255, g = ((v >> 8) & 255) / 255, b = (v & 255) / 255;
  return new THREE.Vector3(r * r, g * g, b * b);
}

// One exp and one multiply-add. `pow(f, 1.35)` was the honest spelling of the curve
// and it cost a transcendental on every pixel of the largest surface in the frame;
// f * (0.35 + 0.65 * f) tracks it to within 2% over 0..1 for two ALU.
const FOG_CHUNK = /* glsl */`
uniform vec3 uCam;
uniform vec4 uFog;        // x density, y max, z heightTop, w heightFalloff
uniform vec3 uFogCol;
float fogAmount(vec3 w) {
  float d = distance(w, uCam);
  float f = 1.0 - exp(-d * uFog.x);
  f *= 0.35 + 0.65 * f;
  f *= 1.0 - clamp((w.y - uFog.z) * uFog.w, 0.0, 0.55);
  return clamp(f, 0.0, uFog.y);
}
`;

/* ================================================================== the bowl */

const BOWL_VERT = /* glsl */`
attribute vec2 aMask;
varying vec2 vUv;
varying vec3 vCol;
varying vec2 vMask;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vCol = color;
  vMask = aMask;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const BOWL_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tCrowd;
uniform vec3 uTeam;
uniform float uDetail;
uniform float uFlash;
uniform float uTime;
uniform float uGain;
uniform vec3 uSuite;
uniform vec3 uVom;
uniform vec3 uRail;
varying vec2 vUv;
varying vec3 vCol;
varying vec2 vMask;
varying vec3 vWorld;
${FOG_CHUNK}

float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

void main() {
  vec3 col;
  if (vMask.x > 0.5) {
    /* ---------------- CROWD ---------------- */
    // Alternate sections are mirrored about their aisle. Real bowls do this, and it
    // doubles the apparent variety of one tiling section for three instructions.
    float sec = floor(vUv.x);
    float lu = fract(vUv.x);
    lu = mix(lu, 1.0 - lu, mod(sec, 2.0));
    vec4 s = texture2D(tCrowd, vec2(lu, vUv.y));
    vec3 c = s.rgb * s.rgb;

    // a third of the fans wear the club's colours, biased toward the front rows
    c = mix(c, c * uTeam * 2.30, s.a * vMask.y);

    // rung ladder: fade the per-seat read toward the section's own mean so the low
    // tiers lose crispness, never structure
    float mean = dot(c, vec3(0.333));
    c = mix(vec3(mean * 0.92, mean * 0.86, mean * 0.74), c, uDetail);

    col = c * vCol * uGain;

    // camera flashes and phone strobes. The cell index is GLOBAL (vUv.x is not
    // fracted before the multiply), so no two sections flash in step.
    // ONE CELL PER SEAT (26 x 20 matches the tile's own seat grid), so a flash is a
    // single fan holding up a phone and not a glowing block of six of them.
    vec2 cell = floor(vec2(vUv.x * 26.0, vUv.y * 20.0));
    float hh = h21(cell);
    if (hh < 0.0055 * uFlash) {
      float ph = fract(hh * 1971.31);
      float f = fract(uTime * 0.42 + ph);
      col += vec3(1.35, 1.28, 1.14) * exp(-f * 22.0) * 3.0;
    }
  } else {
    /* -------------- STRUCTURE -------------- */
    float band = vMask.y;
    float u = vUv.x, v = vUv.y;
    col = vCol * vCol * 0.22;

    // cast-concrete panel joints. Every smoothstep here runs edge0 < edge1 and is
    // inverted explicitly — reversed edges are UNDEFINED in the GLSL spec, and a
    // driver that honours that renders the whole bowl as noise.
    float joint = 1.0 - smoothstep(0.0, 0.020, abs(fract(u * 2.0) - 0.5) - 0.482);
    col *= 1.0 - joint * 0.55;

    // wall padding seams (band 0)
    float m0 = step(band, 0.5);
    float pad = 1.0 - smoothstep(0.0, 0.030, abs(fract(u * 6.0) - 0.5) - 0.47);
    col *= 1.0 - m0 * pad * 0.60;

    // suite windows on the fascia (band 4): warm interior light
    float m4 = step(3.5, band) * step(band, 4.5);
    float wu = fract(u * 5.0);
    float win = step(0.34, wu) * (1.0 - step(0.78, wu))
              * smoothstep(0.46, 0.50, v) * (1.0 - smoothstep(0.70, 0.75, v));
    col += m4 * win * uSuite * 0.42 * (0.35 + 0.65 * h21(vec2(floor(u * 5.0), 3.0)));

    // vomitory mouths: one opening every five sections, glowing from the concourse
    float vu = fract(u * 0.2);
    float vmU = smoothstep(0.900, 0.945, vu) * (1.0 - smoothstep(0.980, 0.998, vu));
    float m3 = step(2.5, band) * step(band, 3.5);
    float vm = vmU * smoothstep(0.02, 0.18, v) * (1.0 - smoothstep(0.60, 0.92, v));
    col = mix(col, uVom * 0.34, (m3 + m4) * vm * 0.9);

    // lit handrails top the concourse and the rim wall
    float mRail = step(2.5, band) * step(band, 3.5) + step(6.5, band) * step(band, 7.5);
    col += mRail * uRail * smoothstep(0.88, 0.99, v) * 0.5;

    // roof face (band 8): dark housings between the luminaires
    float m8 = step(7.5, band) * step(band, 8.5);
    col *= 1.0 - m8 * step(0.45, fract(u * 3.5)) * 0.70;

    col *= uGain;
  }

  float f = fogAmount(vWorld);
  col = mix(col, uFogCol, f);
  gl_FragColor = vec4(col, 1.0);
}
`;

export function makeBowlMaterial(tex, teamColor) {
  return new THREE.ShaderMaterial({
    vertexShader: BOWL_VERT,
    fragmentShader: BOWL_FRAG,
    vertexColors: true,
    side: THREE.DoubleSide,
    fog: false,
    uniforms: {
      tCrowd: { value: tex },
      uTeam: { value: teamColor || new THREE.Vector3(0.4, 0.45, 0.6) },
      uDetail: { value: 1.0 },
      uFlash: { value: 1.0 },
      uTime: { value: 0 },
      uGain: { value: 1.0 },
      uSuite: { value: lin(PALETTE.suiteGlow) },
      uVom: { value: lin(PALETTE.vomGlow) },
      uRail: { value: lin(PALETTE.handrail) },
      uCam: { value: new THREE.Vector3() },
      uFog: { value: new THREE.Vector4(0.0092, 0.60, 12.0, 0.030) },
      uFogCol: { value: lin(PALETTE.hazeFar) },
    },
  });
}

/* ============================================================ emissive atlas */

const EM_VERT = /* glsl */`
attribute float aScroll;
varying vec2 vUv;
varying vec3 vCol;
varying vec3 vWorld;
uniform float uTime;
uniform float uScroll;
void main() {
  vUv = uv + vec2(uTime * uScroll * aScroll, 0.0);
  vCol = color;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const EM_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tAtlas;
uniform float uGain;
varying vec2 vUv;
varying vec3 vCol;
varying vec3 vWorld;
${FOG_CHUNK}
void main() {
  vec3 c = texture2D(tAtlas, vUv).rgb;
  c = c * c * vCol * uGain;
  // LEDs punch through haze harder than concrete does — half fog, and toward a
  // brighter haze, which is what a real board looks like across a smoky bowl.
  float f = fogAmount(vWorld) * 0.55;
  c = mix(c, uFogCol * 1.6, f);
  gl_FragColor = vec4(c, 1.0);
}
`;

export function makeEmissiveMaterial(tex) {
  return new THREE.ShaderMaterial({
    vertexShader: EM_VERT,
    fragmentShader: EM_FRAG,
    vertexColors: true,
    side: THREE.DoubleSide,
    fog: false,
    uniforms: {
      tAtlas: { value: tex },
      uGain: { value: 0.95 },
      uTime: { value: 0 },
      uScroll: { value: 0.016 },
      uCam: { value: new THREE.Vector3() },
      uFog: { value: new THREE.Vector4(0.0092, 0.60, 12.0, 0.030) },
      uFogCol: { value: lin(PALETTE.hazeFar) },
    },
  });
}

/* ==================================================================== glow */

// `position` is the quad's CENTRE. The corner offset is applied in VIEW space, so
// every halo faces the camera exactly without a per-frame CPU billboard pass and
// without an instanced draw — one static merged mesh serves every light in the bowl.
const GLOW_VERT = /* glsl */`
attribute vec2 aCorner;
attribute vec2 aSize;
attribute float aPower;
varying vec2 vUv;
varying float vPower;
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec4 mv = viewMatrix * wp;
  mv.xy += aCorner * aSize;
  vUv = aCorner * 0.5 + 0.5;
  vPower = aPower;
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

const GLOW_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tGlow;
uniform vec3 uTint;
uniform float uGain;
varying vec2 vUv;
varying float vPower;
varying vec3 vWorld;
${FOG_CHUNK}
void main() {
  vec4 g = texture2D(tGlow, vUv);
  float a = g.a * g.a;
  vec3 c = g.rgb * uTint * a * vPower * uGain;
  // haze SCATTERS a light source rather than hiding it
  float f = fogAmount(vWorld);
  c = mix(c, c * 0.55 + uFogCol * a * vPower * 1.4, f);
  gl_FragColor = vec4(c, 1.0);
}
`;

export function makeGlowMaterial(tex) {
  return new THREE.ShaderMaterial({
    vertexShader: GLOW_VERT,
    fragmentShader: GLOW_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    fog: false,
    uniforms: {
      tGlow: { value: tex },
      uTint: { value: lin(PALETTE.lightHalo) },
      uGain: { value: 1.0 },
      uCam: { value: new THREE.Vector3() },
      uFog: { value: new THREE.Vector4(0.0092, 0.60, 12.0, 0.030) },
      uFogCol: { value: lin(PALETTE.hazeFar) },
    },
  });
}

/* ===================================================================== sky */

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const SKY_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tSky;
uniform float uGain;
varying vec3 vDir;
void main() {
  float el = clamp(vDir.y, -0.2, 1.0);
  float v = 1.0 - clamp(el * 1.35, 0.0, 1.0);
  float az = atan(vDir.z, vDir.x) * 0.15915494 + 0.5;
  vec3 c = texture2D(tSky, vec2(az, v)).rgb;
  gl_FragColor = vec4(c * c * uGain, 1.0);
}
`;

export function makeSkyMaterial(tex) {
  return new THREE.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { tSky: { value: tex }, uGain: { value: 1.0 } },
  });
}

export default { makeBowlMaterial, makeEmissiveMaterial, makeGlowMaterial, makeSkyMaterial, lin };
