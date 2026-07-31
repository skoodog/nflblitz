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
// MEASURED, on this box (SwiftShader, ?mode=play&scene=live_play):
//   update() for both batches + the flame = 3 uniform writes, 0 allocations. The
//   allocprobe run over 900 frames shows this piece contributing 0 B/frame; the whole
//   per-frame cost is inside the GPU vertex stage, which is 4 verts per quad.
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

  float cell = aDyn.x;
  vec2 cxy = vec2(mod(cell, CELLS), floor(cell / CELLS));
  vec2 uv01 = aCorner.xy * 0.5 + 0.5;
  vUv = (cxy + INSET * 4.0 + uv01 * (1.0 - INSET * 8.0)) / CELLS;

  vColor = aColor;

  float dist = length(mv.xyz);
  float fd = dist * uFogD;
  // Fast attack, then a shaped decay. The attack is over 6% of the life so that even a
  // 0.16 s flash has a real (10 ms) rise instead of popping on.
  float rise = smoothstep(0.0, 0.06, u);
  float fall = pow(1.0 - u, max(aOpt.w, 0.01));
  vFade = rise * fall * uGain * exp(-fd * fd * 0.85) * smoothstep(0.06, 0.55, dist);
}`;

const FRAG = /* glsl */`
precision highp float;
in vec2 vUv;
in vec3 vColor;
in float vFade;
uniform sampler2D uAtlas;
uniform float uPremul;     // 1 additive (premultiply by alpha), 0 opaque cutout
uniform float uAlphaTest;
out vec4 fragColor;
void main() {
  if (vFade <= 0.0) discard;
  vec4 t = texture(uAtlas, vUv);
  float a = t.a * vFade;
  if (a <= uAlphaTest) discard;
  fragColor = vec4(t.rgb * vColor * mix(1.0, a, uPremul), 1.0);
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
 * short-lived object per particle, and a power-2.2 `hit` emits 327 of them in a single
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
 * everything — it costs ~0.9 MB and happens at most once per five maximum-power hits.
 * Before update ranges were wired up at all, EVERY impact re-uploaded all seven
 * attributes of both pools whether or not they had changed.
 */
export function flush(b) {
  if (b.dirtyLo < 0) return;
  const lo = b.dirtyLo, n = b.dirtyHi - b.dirtyLo;
  for (const k of Object.keys(b.attr)) {
    const at = b.attr[k];
    at.clearUpdateRanges();
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
