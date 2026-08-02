// PIECE impact-fx — THE POOLED QUAD BATCH. Everything except the ball's fire is one of
// these: sparks, clods, dust, smoke, rings, the flash, the lens response.
//
// THE ONE IDEA IN THIS FILE. A particle is written ONCE, at the instant it is emitted,
// and after that it is a closed-form function of `uTime` evaluated in the vertex shader:
//
//     p(age) = p0 + v0 * (1 - e^(-k*age)) / k  -  (0, g*age*age/2, 0)
//
// Nothing is integrated, nothing is stepped, and the CPU cost of an active particle
// system is exactly one uniform write per frame per material. That is not just a
// performance trick — it is what makes the piece pass scripts/lint-determinism.mjs by
// construction, because there is no accumulated state that could drift between a capture
// at t=0.30 and a play session that happened to arrive at t=0.30 by a different route.
//
// WHAT THE PER-FRAME COST ACTUALLY IS: fx.update() writes uTime on two materials and
// ball.update() writes it on a third, plus one Euler assignment for the ball's spin.
// Nothing else runs on the CPU, nothing is read, nothing is allocated — there is no
// particle list to walk because there is no particle state to walk. Everything else is
// in the vertex stage at 4 vertices per quad.
//
// WHY NOT InstancedBufferGeometry, which would be 4x less vertex memory and 4x less
// work at emit time: foundation/budget.js only counts instances for THREE.InstancedMesh
// (`obj.isInstancedMesh ? obj.count : 1`), so a plain Mesh wrapping an
// InstancedBufferGeometry bills as TWO triangles no matter how many particles are live.
// I would rather pay 0.9 MB of vertex buffer than be invisible to the budget harness.
// Non-indexed-instanced it is; drawRange keeps the real draw honest as well.

import * as THREE from 'three';
import { GROUND_Y } from './config.js';

/* --------------------------------------------------------------- the program */

const VERT = /* glsl */`
in vec3 aVel;      // birth velocity, m/s
in vec4 aCorner;   // (corner.x, corner.y, priority, spare)
in vec4 aLife;     // (t0, 1/life, size at birth, size at death)
in vec3 aColor;    // linear radiance tint (may exceed 1 — it is meant to clip)
in vec4 aDyn;      // (atlas cell, mode, drag k, gravity g)
in vec4 aOpt;      // (seed 0..1, spin rad/s, stretch, fade exponent)

out vec2 vUv;
out vec3 vColor;
out float vFade;

uniform float uTime;
uniform float uGain;        // global multiplier, 0 disables the batch
uniform float uPrioCut;     // quads with priority > this are collapsed (the rung ladder)
uniform float uFogD;
uniform float uGroundY;
uniform float uClampGround; // 1 for debris, 0 for anything additive

const float CELLS = 4.0;
const float INSET = 0.0234375;   // 12 px of a 512 px atlas, in UV

void main() {
  float prio = aCorner.z;
  float age = uTime - aLife.x;
  float u = age * aLife.y;

  if (u < 0.0 || u >= 1.0 || uGain <= 0.0 || (prio > uPrioCut && prio >= 0.0)) {
    // Collapse to a degenerate point outside the clip volume. Cheaper than a discard in
    // the fragment stage and it removes the primitive entirely.
    vFade = 0.0; vColor = vec3(0.0); vUv = vec2(0.0);
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  float k = max(aDyn.z, 0.001);
  float decay = exp(-k * age);
  vec3 disp = aVel * ((1.0 - decay) / k);
  disp.y -= 0.5 * aDyn.w * age * age;
  vec3 P = position + disp;
  if (uClampGround > 0.5) P.y = max(P.y, uGroundY);

  float size = mix(aLife.z, aLife.w, u);
  float mode = aDyn.y;

  vec4 mv;
  if (mode > 1.5) {
    // GROUND — the quad lies in the XZ plane. Shockwave rings and the light pool the
    // flash throws on the turf have to be on the ground or they read as a floating
    // hoop; this is the one mode that is not billboarded.
    vec3 wo = vec3(aCorner.x, 0.0, aCorner.y) * (size * 0.5);
    mv = modelViewMatrix * vec4(P + wo, 1.0);
  } else {
    mv = modelViewMatrix * vec4(P, 1.0);
    vec2 q;
    vec2 dir;
    if (mode > 0.5) {
      // STREAK — align the sprite's long axis with the screen projection of the
      // particle's CURRENT velocity (which includes the gravity term, so a spark that
      // has started to fall visibly tips over), and stretch it by its speed.
      vec3 vv = mat3(modelViewMatrix) * (aVel * decay - vec3(0.0, aDyn.w * age, 0.0));
      float sp = length(vv);
      vec2 d = vv.xy;
      dir = dot(d, d) > 1e-8 ? -normalize(d) : vec2(-1.0, 0.0);
      float len = size * (1.0 + aOpt.z * sp);
      q = vec2(aCorner.x * len * 0.5, aCorner.y * size * 0.5);
    } else {
      float rot = aOpt.x * 6.2831853 + aOpt.y * age;
      dir = vec2(cos(rot), sin(rot));
      q = aCorner.xy * (size * 0.5);
    }
    mv.xy += vec2(q.x * dir.x - q.y * dir.y, q.x * dir.y + q.y * dir.x);
  }

  gl_Position = projectionMatrix * mv;

  // ATLAS CELL -> UV. The row is MIRRORED, and this cost me two captures.
  // (No backticks anywhere in this shader source: it is a JS template literal, and one
  // stray backtick inside a GLSL comment ends the string and produces a JS parse error
  // pointing at a comment. Which is exactly how the first version of this note failed.)
  // THREE.CanvasTexture leaves flipY = true, so UV v=0 is the BOTTOM of the canvas while
  // atlas.js lays cells out from the TOP. floor(cell/4) therefore addressed row 3-r
  // instead of row r, and every sprite quietly drew a different cell's art: the flash
  // (cell 3, STAR) rendered the DUST puff, the dust (cell 15) rendered the STARBURST,
  // and every dirt clod (cells 8-10) rendered the RING. I spent two capture cycles
  // dimming "the dust" to kill a white blob that was actually the flash drawing a puff,
  // and the giveaway was a field full of thin black hoops in
  // shots/impact-fx/probe_timeline.png — clods drawing shockwave rings.
  // Flipping the row here rather than setting flipY=false keeps the WITHIN-cell
  // orientation correct too: with flipY on, uv01.y=1 lands on the canvas rows atlas.js
  // drew as the sprite's top.
  float cell = aDyn.x;
  vec2 cxy = vec2(mod(cell, CELLS), CELLS - 1.0 - floor(cell / CELLS));
  vec2 uv01 = aCorner.xy * 0.5 + 0.5;
  vUv = (cxy + INSET * 4.0 + uv01 * (1.0 - INSET * 8.0)) / CELLS;

  vColor = aColor;

  float dist = length(mv.xyz);
  float fd = dist * uFogD;
  // Fast attack, then a shaped decay.
  //
  // THE ATTACK IS IN SECONDS, NOT IN A FRACTION OF LIFE, and getting that wrong made the
  // entire debris field invisible in the hero frame for two rounds of "the debris is too
  // small / too slow / too few". It used to be smoothstep(0.0, 0.06, u) — 6% of the
  // particle's own life. The comment justified it as "a real 10 ms rise" for the 0.16 s
  // flash, and for the flash it is: 6% of 0.16 s is 10 ms. But a turf clod lives 1.15-2.15
  // s, so 6% of ITS life is 69-129 ms, and the leveler panel — the hero this piece is
  // judged on — is captured at an age of 30 ms. (No backticks in this note: see the one
  // in the atlas-cell comment below. This shader is a JS template literal and one stray
  // backtick in a GLSL comment ends the string.)
  //
  // For the additive batch that only meant "dimmer than intended". For the DEBRIS batch it
  // meant GONE: that material is an opaque cutout with uAlphaTest = 0.36 and uPremul = 0,
  // and the fragment stage does  a = t.a * vFade; if (a <= uAlphaTest) discard;  At 30 ms
  // the rise term was 0.40, so a clod texel needed a sprite alpha above 0.36/0.40 = 0.90 to
  // survive at all. 200 clods were being emitted and all but the hardest core of each
  // sprite was discarded before it reached the frame. iso_impact (age 0.09) was over the
  // ramp and looked fine, which is exactly why this hid for so long.
  //
  // 10 ms of absolute time reproduces the old behaviour for the flash EXACTLY (its ramp
  // was already 10 ms) and gives every other element the same honest attack.
  float rise = smoothstep(0.0, 0.010, age);
  float fall = pow(1.0 - u, max(aOpt.w, 0.01));
  vFade = rise * fall * uGain * exp(-fd * fd * 0.85) * smoothstep(0.06, 0.55, dist);
}`;

// TONE MAPPING, and why this piece has to do it by hand.
//
// A ShaderMaterial with a hand-written GLSL3 fragment shader gets NONE of three.js's
// injected output chunks — not <tonemapping_fragment> and not <colorspace_fragment>.
// On the CAPTURE path that is exactly right: engine.js renders into a half-float target
// (three forces NoToneMapping whenever the target is not null) and its resolve pass does
// ACES + sRGB once, over the accumulated buffer. Writing linear radiance is the contract.
//
// On the PLAY path there is no resolve pass — cinematography's buildPost returns null in
// play mode and the scene goes straight to the default framebuffer, where every STANDARD
// material has ACES and the sRGB transfer compiled into it and mine would not. Additive
// values of 3.0 written raw into an sRGB backbuffer are a white hole. So uTone is set
// from ctx.mode at build time and the same ACES curve engine.js uses is applied here.
//
// KNOWN LIMITATION: if a cinema piece ever returns a real post chain in play mode, that
// chain renders into its own linear target and this would double-tonemap. There is no
// way to know that at build time — buildPost runs after fx.build — so it is recorded
// here rather than guessed at.
const FRAG = /* glsl */`
precision highp float;
in vec2 vUv;
in vec3 vColor;
in float vFade;
uniform sampler2D uAtlas;
uniform float uPremul;     // 1 additive (premultiply by alpha), 0 opaque cutout
uniform float uAlphaTest;
uniform float uTone;       // 1 when this material writes straight to an sRGB backbuffer
out vec4 fragColor;

vec3 aces(vec3 x) {
  const mat3 IN = mat3(0.59719, 0.07600, 0.02840,
                       0.35458, 0.90834, 0.13383,
                       0.04823, 0.01566, 0.83777);
  const mat3 OUT = mat3( 1.60475, -0.10208, -0.00327,
                        -0.53108,  1.10813, -0.07276,
                        -0.07367, -0.00605,  1.07602);
  vec3 v = IN * x;
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return clamp(OUT * (a / b), 0.0, 1.0);
}
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(0.41666)) - 0.055, step(0.0031308, c));
}

void main() {
  if (vFade <= 0.0) discard;
  vec4 t = texture(uAtlas, vUv);
  float a = t.a * vFade;
  if (a <= uAlphaTest) discard;
  vec3 c = t.rgb * vColor * mix(1.0, a, uPremul);
  if (uTone > 0.5) c = toSRGB(aces(c));
  fragColor = vec4(c, 1.0);
}`;

/**
 * Both batches are built from the SAME shader source, which means three.js hands them
 * ONE compiled program (its cache key is the source text plus defines, and blending is
 * material state, not program state). The difference between "additive spark" and
 * "opaque dirt clod" travels as two uniforms, uPremul and uAlphaTest. That is the whole
 * reason this piece costs 2 programs instead of 4.
 */
export function makeQuadMaterial(atlas, opts) {
  const o = opts || {};
  const additive = o.additive !== false;
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uAtlas: { value: atlas },
      uTime: { value: 0 },
      uGain: { value: 1 },
      uPrioCut: { value: 1 },
      uFogD: { value: o.fogD !== undefined ? o.fogD : 0.0082 },
      uGroundY: { value: GROUND_Y },
      uClampGround: { value: additive ? 0 : 1 },
      uPremul: { value: additive ? 1 : 0 },
      uAlphaTest: { value: additive ? 0.0015 : 0.36 },
      uTone: { value: o.tone ? 1 : 0 },
    },
    transparent: additive,
    depthWrite: !additive,
    depthTest: true,
    blending: additive ? THREE.AdditiveBlending : THREE.NoBlending,
    side: THREE.DoubleSide,
    toneMapped: true,
  });
  mat.name = additive ? 'impactfx.glow' : 'impactfx.debris';
  return mat;
}

/* ------------------------------------------------------------------- batch */

const STRIDE = {
  pos: 3, vel: 3, corner: 4, life: 4, color: 3, dyn: 4, opt: 4,
};

/**
 * A ring-buffered pool of `cap` quads. Nothing here allocates after construction.
 */
export function makeBatch(cap, mat, name, renderOrder) {
  const geo = new THREE.BufferGeometry();
  const arr = {
    pos: new Float32Array(cap * 4 * STRIDE.pos),
    vel: new Float32Array(cap * 4 * STRIDE.vel),
    corner: new Float32Array(cap * 4 * STRIDE.corner),
    life: new Float32Array(cap * 4 * STRIDE.life),
    color: new Float32Array(cap * 4 * STRIDE.color),
    dyn: new Float32Array(cap * 4 * STRIDE.dyn),
    opt: new Float32Array(cap * 4 * STRIDE.opt),
  };
  const attr = {
    pos: new THREE.BufferAttribute(arr.pos, 3),
    vel: new THREE.BufferAttribute(arr.vel, 3),
    corner: new THREE.BufferAttribute(arr.corner, 4),
    life: new THREE.BufferAttribute(arr.life, 4),
    color: new THREE.BufferAttribute(arr.color, 3),
    dyn: new THREE.BufferAttribute(arr.dyn, 4),
    opt: new THREE.BufferAttribute(arr.opt, 4),
  };
  for (const k of Object.keys(attr)) attr[k].setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', attr.pos);
  geo.setAttribute('aVel', attr.vel);
  geo.setAttribute('aCorner', attr.corner);
  geo.setAttribute('aLife', attr.life);
  geo.setAttribute('aColor', attr.color);
  geo.setAttribute('aDyn', attr.dyn);
  geo.setAttribute('aOpt', attr.opt);

  // The corner pattern never changes, so write it once for the whole pool.
  const CX = [-1, 1, 1, -1], CY = [-1, -1, 1, 1];
  for (let i = 0; i < cap; i++) {
    for (let k = 0; k < 4; k++) {
      const o = (i * 4 + k) * 4;
      arr.corner[o] = CX[k];
      arr.corner[o + 1] = CY[k];
    }
  }

  const idx = new Uint32Array(cap * 6);
  for (let i = 0; i < cap; i++) {
    const b = i * 4, o = i * 6;
    idx[o] = b; idx[o + 1] = b + 1; idx[o + 2] = b + 2;
    idx[o + 3] = b; idx[o + 4] = b + 2; idx[o + 5] = b + 3;
  }
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.setDrawRange(0, 0);
  // Never culled: the bounding sphere of a pool whose contents move analytically in the
  // vertex shader is meaningless, and a per-frame bounds test on it buys nothing.
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2, 0), 200);

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = name;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData.wantShadow = false;
  mesh.renderOrder = renderOrder === undefined ? 12 : renderOrder;
  mesh.matrixAutoUpdate = false;

  return {
    cap, geo, mesh, mat, arr, attr,
    head: 0,       // next slot to write
    live: 0,       // high-water mark, drives drawRange
    dirtyLo: -1,   // vertex range touched since the last flush
    dirtyHi: -1,
  };
}

/**
 * Write one quad. POSITIONAL ARGUMENTS ON PURPOSE: an options object here allocates one
 * short-lived object per particle, and a power-2.2 hit emits 245 of them in a single
 * frame. Ugly signature, zero garbage.
 */
export function emit(b, px, py, pz, vx, vy, vz,
  t0, life, s0, s1, cr, cg, cb, cell, mode, drag, grav, seed01, spin, stretch, fadePow, prio) {
  const i = b.head;
  b.head = (b.head + 1) % b.cap;
  if (b.live < b.cap) b.live++;
  const v0 = i * 4;
  const a = b.arr;
  const invLife = 1 / (life > 1e-4 ? life : 1e-4);
  for (let k = 0; k < 4; k++) {
    const v = v0 + k;
    let o = v * 3;
    a.pos[o] = px; a.pos[o + 1] = py; a.pos[o + 2] = pz;
    a.vel[o] = vx; a.vel[o + 1] = vy; a.vel[o + 2] = vz;
    a.color[o] = cr; a.color[o + 1] = cg; a.color[o + 2] = cb;
    o = v * 4;
    a.corner[o + 2] = prio;
    a.life[o] = t0; a.life[o + 1] = invLife; a.life[o + 2] = s0; a.life[o + 3] = s1;
    a.dyn[o] = cell; a.dyn[o + 1] = mode; a.dyn[o + 2] = drag; a.dyn[o + 3] = grav;
    a.opt[o] = seed01; a.opt[o + 1] = spin; a.opt[o + 2] = stretch; a.opt[o + 3] = fadePow;
  }
  if (b.dirtyLo < 0 || v0 < b.dirtyLo) b.dirtyLo = v0;
  if (v0 + 4 > b.dirtyHi) b.dirtyHi = v0 + 4;
}

/**
 * Hand the touched vertex range to the GL uploader.
 *
 * A burst is contiguous in the ring buffer unless it wrapped, and a wrap shows up here
 * as a range that spans the whole pool. Rather than track two spans, a wrap re-uploads
 * everything — it costs ~0.9 MB and happens at most once per six maximum-power hits.
 *
 * DO NOT ADD clearUpdateRanges() HERE. It looks like the obvious hygiene and it is a bug:
 * three.js clears the ranges ITSELF, inside WebGLAttributes.updateBuffer, once the data
 * has actually reached the GPU. Clearing them on this side means that two impacts in the
 * SAME frame — one emit, flush, emit, flush with no draw in between — throw away the
 * first burst's pending range and upload only the second, and the first hit renders as
 * whatever stale quads happened to be in those slots. The three-burst iso_impact_timeline
 * scene emits three bursts back to back inside buildFromShot and is exactly this case;
 * it only survived the first version because three does a full bufferData on an
 * attribute's FIRST upload and ignores ranges then.
 */
export function flush(b) {
  if (b.dirtyLo < 0) return;
  const lo = b.dirtyLo, n = b.dirtyHi - b.dirtyLo;
  for (const k of Object.keys(b.attr)) {
    const at = b.attr[k];
    at.addUpdateRange(lo * at.itemSize, n * at.itemSize);
    at.needsUpdate = true;
  }
  b.geo.setDrawRange(0, b.live * 6);
  b.dirtyLo = -1; b.dirtyHi = -1;
}

export function resetBatch(b) {
  b.head = 0; b.live = 0; b.dirtyLo = -1; b.dirtyHi = -1;
  b.geo.setDrawRange(0, 0);
  // The pool's contents are left alone: every quad is gated on `uTime - t0` and the
  // draw range is zero, so stale data is unreachable and zeroing 0.9 MB would be work
  // for nothing.
}

export function disposeBatch(b) {
  b.geo.dispose();
}

export default { makeQuadMaterial, makeBatch, emit, flush, resetBatch, disposeBatch };
