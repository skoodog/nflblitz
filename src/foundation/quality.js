// FOUNDATION — PERFCORE. Device tiering, the 16-rung quality ladder, the PRESENT RATE
// axis, and the closed-loop adaptive scaler.
//
// Visual quality is a DEPENDENT VARIABLE. The frame wall is the independent one. This
// file is what makes that true at runtime instead of in a design document.
//
// TWO AXES, NOT ONE
//   RATE  60 or 30 presents per second. 60 is the CAP and is never exceeded. 30 is a
//         first-class shipping mode. A rate change is VISIBLE, so it is rarer and far
//         more hysteretic than a rung change.
//   RUNG  0..15 continuous quality ladder. A rung change should not be visible at all.
//   The scaler picks the highest RATE it can hold, then walks the RUNGS within it.
//
// THREE STAGES. Stage 3 is the authority; 1 and 2 only pick a starting rate+rung so the
// first two seconds are neither ugly nor stuttering.
//   1 STATIC   (<2 ms)   renderer string, cores, DPR, screen area, GL limits.
//   2 PROBE    (<=250 ms) a real CPU workload shaped like our skinning, and a real
//                        fill-rate slope measured on the actual GPU. No device database.
//   3 SCALER   (forever) rolling 30-frame windows; DOWN fast, UP slow, 8:2 hysteresis,
//                        one rung change per 3 s, one rate change per 10 s, never
//                        allocates, never compiles a shader.
//
// WHAT NEVER SCALES: colour grade + LUT, value structure, key/rim direction, silhouette
// and proportion, camera staging, ALL typography, HUD layout, team colour, and THE SIM
// ITSELF — every tier and BOTH RATES play exactly the same game with exactly the same
// timing windows. A floor-tier frame is a well-composed, correctly graded, sharply
// lettered arcade football frame with simpler lighting. It is never a stuttering one.

import { rateSpec, pacingTargets } from './clock.js';

/* ------------------------------------------------------------------- tiers */

export const TIER_NAMES = ['floor', 'low', 'mid', 'high'];

export const TIERS = Object.freeze({
  floor: {
    name: 'floor', rungLo: 0, rungHi: 2, throttle: 6, bootRate: 30,
    ref: 'this container (SwiftShader), llvmpipe, old low-RAM Android, any thermally collapsed device',
    caps: { drawCalls: 60, triangles: 90000, programs: 12, textureMB: 24, renderTargets: 1, particles: 0, overdraw: 1.6, shadowCasters: 0, skinned: 6, imposter: 8, postPasses: 0 },
  },
  low: {
    name: 'low', rungLo: 3, rungHi: 6, throttle: 4, bootRate: 60,
    ref: 'Mali-G52/G57, Adreno 610/619, iPhone 8 / SE2 class',
    caps: { drawCalls: 110, triangles: 180000, programs: 18, textureMB: 48, renderTargets: 2, particles: 400, overdraw: 2.0, shadowCasters: 14, skinned: 10, imposter: 4, postPasses: 1 },
  },
  mid: {
    name: 'mid', rungLo: 7, rungHi: 11, throttle: 2, bootRate: 60,
    ref: 'Adreno 64x/730, Mali-G78, A14/A15, Pixel 6 class',
    caps: { drawCalls: 180, triangles: 400000, programs: 26, textureMB: 96, renderTargets: 3, particles: 1500, overdraw: 2.6, shadowCasters: 20, skinned: 14, imposter: 0, postPasses: 3 },
  },
  high: {
    name: 'high', rungLo: 12, rungHi: 15, throttle: 1, bootRate: 60,
    ref: 'A16+/M-series, Adreno 740+, desktop dGPU',
    caps: { drawCalls: 280, triangles: 950000, programs: 38, textureMB: 192, renderTargets: 5, particles: 4000, overdraw: 3.4, skinned: 14, imposter: 0, postPasses: 5, shadowCasters: 30 },
  },
});

export function tierOfRung(r) {
  if (r <= 2) return 'floor';
  if (r <= 6) return 'low';
  if (r <= 11) return 'mid';
  return 'high';
}

/* -------------------------------------------------------------- the ladder */

/**
 * 16 rungs. Tier boundaries land EXACTLY on the tier's structural cap so
 * `budget.mjs --tier=X` and `rungForTier(X)` agree by construction.
 *
 * Columns: renderScale, dprCap, shadowSize (0=off, blob decals), shadowCasters,
 *          postPasses, particles, skinned actors, imposter actors, bones evaluated,
 *          volumetric (0 off,1 baked haze,2 billboard shafts,3 raymarched),
 *          turf (0 flat,1 normal-mapped,2 aniso+wet,3 shell grass),
 *          crowd (0 backdrop,1 imposter strip,2 instanced quads,3 instanced meshes)
 */
const R = (renderScale, dprCap, shadowSize, shadowCasters, postPasses, particles, skinned, imposter, bones, volumetric, turf, crowd) =>
  ({ renderScale, dprCap, shadowSize, shadowCasters, postPasses, particles, skinned, imposter, bones, volumetric, turf, crowd });

export const RUNGS = Object.freeze([
  /* 0  floor */ R(0.50, 1.0, 0, 0, 0, 0, 6, 8, 14, 0, 0, 0),
  /* 1  floor */ R(0.55, 1.0, 0, 0, 0, 0, 6, 8, 14, 1, 0, 0),
  /* 2  floor */ R(0.60, 1.0, 0, 0, 0, 0, 6, 8, 14, 1, 0, 0),
  /* 3  low   */ R(0.62, 1.25, 512, 8, 1, 150, 8, 6, 18, 1, 1, 1),
  /* 4  low   */ R(0.64, 1.25, 512, 10, 1, 250, 9, 5, 18, 1, 1, 1),
  /* 5  low   */ R(0.65, 1.5, 512, 12, 1, 320, 10, 4, 20, 1, 1, 1),
  /* 6  low   */ R(0.65, 1.5, 512, 14, 1, 400, 10, 4, 20, 1, 1, 1),
  /* 7  mid   */ R(0.70, 1.75, 1024, 16, 2, 700, 12, 2, 22, 2, 2, 2),
  /* 8  mid   */ R(0.75, 1.75, 1024, 18, 2, 950, 13, 1, 24, 2, 2, 2),
  /* 9  mid   */ R(0.80, 2.0, 1024, 18, 3, 1200, 14, 0, 26, 2, 2, 2),
  /* 10 mid   */ R(0.82, 2.0, 1024, 20, 3, 1350, 14, 0, 26, 2, 2, 2),
  /* 11 mid   */ R(0.85, 2.0, 1024, 20, 3, 1500, 14, 0, 26, 2, 2, 2),
  /* 12 high  */ R(0.90, 2.0, 2048, 24, 4, 2200, 14, 0, 26, 3, 3, 3),
  /* 13 high  */ R(0.94, 2.0, 2048, 26, 4, 2900, 14, 0, 26, 3, 3, 3),
  /* 14 high  */ R(0.97, 2.0, 2048, 28, 5, 3500, 14, 0, 26, 3, 3, 3),
  /* 15 high  */ R(1.00, 2.0, 2048, 30, 5, 4000, 14, 0, 26, 3, 3, 3),
]);

/** The rung a tier is judged at by budget.mjs — the tier's TOP rung (its cap). */
export function rungForTier(tier) { return TIERS[tier].rungHi; }

/* --------------------------------------------------- stage 1: static signals */

const RENDERER_TABLE = [
  [/SwiftShader|llvmpipe|Software|Microsoft Basic Render/i, 'floor'],
  [/Apple\s*(A1[6-9]|A2\d|M[1-9])/i, 'high'],
  [/Apple\s*A1[0-5]/i, 'mid'],
  [/Adreno.*\b(7\d{2}|8\d{2})\b/i, 'high'],
  [/Adreno.*\b6[2-9]\d\b/i, 'mid'],
  [/Adreno.*\b[45]\d{2}\b/i, 'low'],
  [/Mali-G(7[0-9]|[89][0-9])/i, 'mid'],
  [/Mali-G(3[0-9]|5[0-9])/i, 'low'],
  [/Mali-T/i, 'low'],
  [/(RTX|Radeon RX|GeForce|Arc A)/i, 'high'],
  [/PowerVR/i, 'low'],
];

export function staticSignals() {
  const s = {
    cores: 4, deviceMemory: undefined, dpr: 1, screenW: 0, screenH: 0, screenMP: 0,
    renderer: '', vendor: '', maxTexture: 0, maxSamples: 0, floatRT: false,
    timerQuery: false, compressed: '', tier: 'mid', reason: 'default',
  };
  if (typeof navigator === 'undefined') return s;
  s.cores = navigator.hardwareConcurrency || 4;
  // deviceMemory is undefined on iOS/Safari and undefined in this container's
  // mobile-emulated context. It is a BONUS signal, never a requirement.
  s.deviceMemory = navigator.deviceMemory;
  s.dpr = (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1) || 1;
  if (typeof screen !== 'undefined') {
    s.screenW = screen.width || 0; s.screenH = screen.height || 0;
    s.screenMP = (s.screenW * s.screenH * s.dpr * s.dpr) / 1e6;
  }
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2', { failIfMajorPerformanceCaveat: false });
    if (gl) {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      s.renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '') : String(gl.getParameter(gl.RENDERER) || '');
      s.vendor = dbg ? String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) || '') : '';
      s.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 0;
      s.maxSamples = gl.getParameter(gl.MAX_SAMPLES) || 0;
      s.floatRT = !!gl.getExtension('EXT_color_buffer_float');
      s.timerQuery = !!gl.getExtension('EXT_disjoint_timer_query_webgl2');
      const cx = [];
      if (gl.getExtension('WEBGL_compressed_texture_astc')) cx.push('ASTC');
      if (gl.getExtension('WEBGL_compressed_texture_etc')) cx.push('ETC2');
      if (gl.getExtension('EXT_texture_compression_bptc')) cx.push('BPTC');
      s.compressed = cx.join('+');
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    }
  } catch (e) { /* no WebGL2: stay at the default and let the probe decide */ }

  let tier = null, reason = 'unknown-renderer -> mid, probe corrects';
  for (const [re, t] of RENDERER_TABLE) {
    if (re.test(s.renderer)) { tier = t; reason = `renderer matched ${re}`; break; }
  }
  if (!tier) tier = 'mid';
  // Corroborating signals may only pull DOWN, never up: a good GPU string with 2 cores
  // is still going to miss the CPU wall.
  if (s.cores <= 2 && tier === 'high') { tier = 'mid'; reason += ' | cores<=2 -> mid'; }
  if (s.cores <= 2 && tier === 'mid') { tier = 'low'; reason += ' | cores<=2 -> low'; }
  if (s.deviceMemory !== undefined && s.deviceMemory <= 2 && tier !== 'floor') { tier = 'low'; reason += ' | deviceMemory<=2 -> low'; }
  if (s.maxTexture && s.maxTexture < 4096 && tier !== 'floor') { tier = 'low'; reason += ' | maxTexture<4096 -> low'; }
  s.tier = tier; s.reason = reason;
  return s;
}

/* ------------------------------------------------- stage 2: the boot probe */

/**
 * CPU probe: 14 actors x 26 bones x N iterations of quaternion slerp + matrix compose.
 * This is not a synthetic benchmark, it is LITERALLY the work the animation subsystem
 * does, so its ms/unit maps directly onto the `anim` budget line.
 * Pure math on preallocated Float64Arrays. No THREE, no DOM — runs under Node too.
 */
export function cpuProbe(iterations) {
  const ACTORS = 14, BONES = 26;
  const ITER = iterations || 200;
  const qa = new Float64Array(ACTORS * BONES * 4);
  const qb = new Float64Array(ACTORS * BONES * 4);
  const out = new Float64Array(ACTORS * BONES * 4);
  const mat = new Float64Array(16);
  for (let i = 0; i < qa.length; i += 4) {
    const a = i * 0.017, b = i * 0.031;
    qa[i] = Math.sin(a); qa[i + 1] = Math.cos(b); qa[i + 2] = Math.sin(b * 0.5); qa[i + 3] = Math.cos(a * 0.5);
    qb[i] = Math.cos(a); qb[i + 1] = Math.sin(b); qb[i + 2] = Math.cos(b * 0.5); qb[i + 3] = Math.sin(a * 0.5);
    const na = Math.hypot(qa[i], qa[i + 1], qa[i + 2], qa[i + 3]) || 1;
    const nb = Math.hypot(qb[i], qb[i + 1], qb[i + 2], qb[i + 3]) || 1;
    qa[i] /= na; qa[i + 1] /= na; qa[i + 2] /= na; qa[i + 3] /= na;
    qb[i] /= nb; qb[i + 1] /= nb; qb[i + 2] /= nb; qb[i + 3] /= nb;
  }
  const now = (typeof performance !== 'undefined' && performance.now) ? () => performance.now() : () => Date.now();
  const t0 = now();
  let sink = 0;
  for (let it = 0; it < ITER; it++) {
    const tParam = (it % 64) / 64;
    for (let k = 0; k < qa.length; k += 4) {
      // --- slerp
      let ax = qa[k], ay = qa[k + 1], az = qa[k + 2], aw = qa[k + 3];
      const bx = qb[k], by = qb[k + 1], bz = qb[k + 2], bw = qb[k + 3];
      let cosom = ax * bx + ay * by + az * bz + aw * bw;
      if (cosom < 0) { cosom = -cosom; ax = -ax; ay = -ay; az = -az; aw = -aw; }
      let s0, s1;
      if (1 - cosom > 1e-6) {
        const omega = Math.acos(cosom), sinom = Math.sin(omega);
        s0 = Math.sin((1 - tParam) * omega) / sinom;
        s1 = Math.sin(tParam * omega) / sinom;
      } else { s0 = 1 - tParam; s1 = tParam; }
      const x = s0 * ax + s1 * bx, y = s0 * ay + s1 * by, z = s0 * az + s1 * bz, w = s0 * aw + s1 * bw;
      out[k] = x; out[k + 1] = y; out[k + 2] = z; out[k + 3] = w;
      // --- compose to a 4x4 (translation + rotation + uniform scale)
      const x2 = x + x, y2 = y + y, z2 = z + z;
      const xx = x * x2, xy = x * y2, xz = x * z2;
      const yy = y * y2, yz = y * z2, zz = z * z2;
      const wx = w * x2, wy = w * y2, wz = w * z2;
      mat[0] = 1 - (yy + zz); mat[1] = xy + wz; mat[2] = xz - wy; mat[3] = 0;
      mat[4] = xy - wz; mat[5] = 1 - (xx + zz); mat[6] = yz + wx; mat[7] = 0;
      mat[8] = xz + wy; mat[9] = yz - wx; mat[10] = 1 - (xx + yy); mat[11] = 0;
      mat[12] = x * 0.5; mat[13] = y * 0.5; mat[14] = z * 0.5; mat[15] = 1;
      sink += mat[0] + mat[5] + mat[10];
    }
  }
  const ms = now() - t0;
  const units = ITER * ACTORS * BONES;
  return { ms, units, msPerUnit: ms / units, msPerFullPose: ms / ITER, sink };
}

/**
 * GPU probe: draw N full-screen quads with a fixed-cost fragment shader at the device's
 * OWN resolution and take the SLOPE of frame time vs N. That yields effective
 * pixels/ms on the real hardware with no device database.
 *
 * A hard wall-clock deadline bounds it. Blowing the deadline is not a failure of the
 * probe, it IS the measurement: a device that cannot fill its own screen a few times
 * inside 200 ms is a floor device. On this box the probe correctly reports floor.
 */
export function gpuProbe(deadlineMs) {
  const res = { ok: false, pixPerMs: 0, mp: 0, points: [], aborted: false, note: '' };
  if (typeof document === 'undefined') { res.note = 'no DOM'; return res; }
  const now = () => performance.now();
  const t0 = now();
  const budget = deadlineMs || 200;
  let canvas = null, gl = null;
  try {
    canvas = document.createElement('canvas');
    const dpr = Math.min(2, (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1) || 1);
    const w = Math.max(64, Math.round((window.innerWidth || 390) * dpr));
    const h = Math.max(64, Math.round((window.innerHeight || 844) * dpr));
    canvas.width = w; canvas.height = h;
    res.mp = (w * h) / 1e6;
    gl = canvas.getContext('webgl2', { antialias: false, depth: false, alpha: false, powerPreference: 'high-performance' });
    if (!gl) { res.note = 'no webgl2'; return res; }

    const vs = `#version 300 es
in vec2 p; out vec2 v;
void main(){ v = p*0.5+0.5; gl_Position = vec4(p,0.0,1.0); }`;
    // Fixed, non-trivial ALU cost per pixel — representative of a lit material's
    // fragment stage without depending on any of our real shaders.
    const fs = `#version 300 es
precision highp float;
in vec2 v; out vec4 o; uniform float u;
void main(){
  vec3 c = vec3(v, 0.5);
  for (int i = 0; i < 8; i++) {
    c = fract(c * 1.7 + vec3(0.13, 0.71, 0.31) + u);
    c = c * c * (3.0 - 2.0 * c);
    c += 0.15 * sin(c.yzx * 6.2831 + u);
  }
  o = vec4(c * 0.02, 0.02);
}`;
    const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, mk(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { res.note = 'link failed'; return res; }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uLoc = gl.getUniformLocation(prog, 'u');
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.viewport(0, 0, w, h);

    // warm the pipeline (first draw pays compile + first-use costs)
    gl.uniform1f(uLoc, 0.0); gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.finish();

    for (const n of [1, 2, 4, 8]) {
      if (now() - t0 > budget) { res.aborted = true; break; }
      const a0 = now();
      for (let f = 0; f < 2; f++) {
        for (let i = 0; i < n; i++) { gl.uniform1f(uLoc, i * 0.1 + f); gl.drawArrays(gl.TRIANGLES, 0, 3); }
      }
      gl.finish();
      const ms = (now() - a0) / 2;
      res.points.push({ n, ms });
      if (ms > budget) { res.aborted = true; break; }
    }
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
  } catch (e) { res.note = 'probe threw: ' + (e && e.message); return res; }

  if (res.points.length >= 2) {
    // least-squares slope of ms vs n -> ms per full-screen layer
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    const k = res.points.length;
    for (const p of res.points) { sx += p.n; sy += p.ms; sxx += p.n * p.n; sxy += p.n * p.ms; }
    const denom = k * sxx - sx * sx;
    const slope = denom !== 0 ? (k * sxy - sx * sy) / denom : res.points[0].ms;
    if (slope > 0) { res.pixPerMs = (res.mp * 1e6) / slope; res.ok = true; }
  } else if (res.points.length === 1) {
    const slope = res.points[0].ms / res.points[0].n;
    if (slope > 0) { res.pixPerMs = (res.mp * 1e6) / slope; res.ok = true; }
  }
  res.wallMs = now() - t0;
  return res;
}

/**
 * Combine stages 1+2 into a starting RATE and RUNG.
 *
 * The rate choice at boot is deliberately conservative in one direction only: a device
 * that boots at 30 and turns out to have headroom is promoted by the scaler within a
 * few seconds and the player sees a smooth ramp UP. A device that boots at 60 and
 * cannot hold it stutters first and gets demoted after — which is exactly the failure
 * the user forbade. So: floor tier boots at 30; everything else boots at 60.
 */
export function classify(sig, cpu, gpu) {
  let tier = sig.tier;
  const notes = [];

  // CPU: msPerFullPose is one full 14-actor x 26-bone pose evaluation. The `anim`
  // budget is 3.20 ms at 60 Hz; a device needing more than that for one pose cannot
  // be mid at 60.
  if (cpu && cpu.msPerFullPose !== undefined) {
    const p = cpu.msPerFullPose;
    notes.push(`cpu ${p.toFixed(3)} ms/pose`);
    if (p > 2.60) tier = 'floor';
    else if (p > 1.20 && tier !== 'floor') tier = 'low';
    else if (p > 0.55 && (tier === 'high')) tier = 'mid';
  }

  // GPU: required fill = screen MP * assumed avg overdraw of the tier we are eyeing.
  // If the measured pixels/ms cannot deliver the tier's pixel load inside ~4 ms of
  // GPU time, drop a tier. Measured, not assumed — this is the one honest GPU signal.
  if (gpu && gpu.ok) {
    const need = { floor: 1.6, low: 2.0, mid: 2.6, high: 3.4 };
    notes.push(`gpu ${(gpu.pixPerMs / 1e6).toFixed(2)} Mpix/ms over ${gpu.mp.toFixed(2)} MP`);
    for (let guard = 0; guard < 4; guard++) {
      const rung = RUNGS[TIERS[tier].rungHi];
      const px = gpu.mp * rung.renderScale * rung.renderScale * need[tier] * 1e6;
      const ms = px / Math.max(1, gpu.pixPerMs);
      if (ms <= 4.0 || tier === 'floor') { notes.push(`gpu est ${ms.toFixed(1)} ms at ${tier}`); break; }
      tier = tier === 'high' ? 'mid' : tier === 'mid' ? 'low' : 'floor';
    }
  } else if (gpu && gpu.aborted) {
    tier = 'floor';
    notes.push('gpu probe blew its deadline -> floor');
  }

  // Start at the MIDDLE of the tier, never the top: the scaler climbs quickly when it
  // has headroom and we would rather be pretty in 3 s than stutter in the first 1 s.
  const T = TIERS[tier];
  const rung = Math.round((T.rungLo + T.rungHi) / 2);
  const rate = T.bootRate;
  notes.push(`boot rate ${rate} Hz`);
  return { tier, rung, rate, notes: notes.join(' | ') };
}

/* ------------------------------------------------------------- the scaler */

export const SCALER = Object.freeze({
  windowFrames: 30,
  /** Rung moves. Fast down, slow up: 8:2 hysteresis. */
  downWindows: 2,
  upWindows: 8,
  rungRateLimitMs: 3000,
  crossFadeMs: 250,
  /**
   * RATE moves. A rate change is VISIBLE, so it is much rarer and much more
   * hysteretic than a rung change, exactly as the amendment requires.
   *   - down only after the rung ladder is EXHAUSTED (rung is at the floor of the
   *     allowed range) and pacing is still failing.
   *   - up only after a long clean streak with CPU that would fit the 60 Hz wall.
   */
  rateDownWindows: 6,
  rateUpWindows: 16,
  rateLimitMs: 10000,
  /**
   * CPU p95 that must be beaten at 30 Hz before the scaler will even consider 60 Hz.
   * The 60 Hz wall is 13.00 ms; require a 2 ms margin so we do not promote a device
   * that would immediately fail and demote again.
   */
  rateUpCpuMs: 11.0,
  /**
   * How many times a 60 Hz promotion may fail before 60 is LATCHED OFF for the
   * session. This is what turns "try the better thing, remember it failed" into
   * "spend the headroom on looks instead" — see `rate60Latched` below.
   */
  rate60MaxFailures: 2,
  /** A promotion that is reversed within this long counts as a FAILED promotion. */
  rate60FailWindowMs: 20000,
});

/** Reasons, as small ints, so logging never allocates a string in the frame path. */
export const RUNG_REASON = Object.freeze({
  BOOT: 0, DOWN_PACING: 1, UP_HEADROOM: 2, MANUAL: 3, DEFER_COMMIT: 4,
  RATE_DOWN: 5, RATE_UP: 6, RATE_LATCH: 7,
});
export const RUNG_REASON_NAME = [
  'boot', 'down(pacing)', 'up(headroom)', 'manual', 'deferred-commit',
  'rate-down(ladder exhausted)', 'rate-up(headroom)', 'rate-latched-30',
];
export const CHANGE_KIND = Object.freeze({ RUNG: 0, RATE: 1 });

/**
 * createScaler({ rung, rate, onRung, onRate, minRung, maxRung }) — stage 3, the authority.
 *
 * `sample(nowMs, intervalMs, cpuMs)` is called once per presented frame. It is O(1),
 * allocation-free, and costs well under its 0.10 ms budget line.
 *
 * THE PRIORITY ORDER, and why it is this way round:
 *   1. If pacing is failing -> drop a RUNG. Always. Stutter is the thing we refuse to
 *      ship and a rung change is invisible.
 *   2. If pacing is failing AND the rung ladder is exhausted -> drop the RATE.
 *   3. If there is headroom and we are at 30 Hz -> spend it on RATE first, not looks.
 *      A player feels 60 Hz more than they feel one more rung of particles. The rung
 *      up-check is deliberately BLOCKED at 30 Hz while a promotion is still plausible,
 *      so headroom cannot be quietly eaten by quality before rate gets a chance at it.
 *   4. If 60 Hz has been tried and failed `rate60MaxFailures` times, LATCH to 30 and
 *      unblock rung climbing. This is the amendment's "spend that headroom on looks
 *      rather than idling", and it happens only after 60 has been honestly attempted.
 */
export function createScaler(opts) {
  const o = opts || {};
  const W = SCALER.windowFrames;
  const iv = new Float64Array(W);
  const cp = new Float64Array(W);
  const sortBuf = new Float64Array(W);
  let n = 0, i = 0;
  let downStreak = 0, upStreak = 0;
  let rateDownStreak = 0, rateUpStreak = 0;
  let lastRungChangeMs = -1e9;
  let lastRateChangeMs = -1e9;
  let rung = o.rung !== undefined ? o.rung : 8;
  let rate = o.rate === 30 ? 30 : 60;
  let locked = !!o.locked;
  let rateLocked = !!o.rateLocked;
  let minRung = o.minRung !== undefined ? o.minRung : 0;
  let maxRung = o.maxRung !== undefined ? o.maxRung : 15;
  // 60 Hz promotion memory
  let rate60Failures = 0;
  let rate60Latched = false;
  let promotedAtMs = -1e9;

  let targets = pacingTargets(rate);

  function p95(src) {
    for (let k = 0; k < W; k++) sortBuf[k] = src[k];
    sortBuf.sort();
    return sortBuf[Math.min(W - 1, Math.round(0.95 * (W - 1)))];
  }

  const scaler = {
    get rung() { return rung; },
    get rate() { return rate; },
    get tier() { return tierOfRung(rung); },
    get locked() { return locked; },
    set locked(v) { locked = !!v; },
    get rateLocked() { return rateLocked; },
    set rateLocked(v) { rateLocked = !!v; },
    get rate60Latched() { return rate60Latched; },
    get rate60Failures() { return rate60Failures; },
    get wallMs() { return rateSpec(rate).wallMs; },
    lastP95Interval: 0,
    lastP95Cpu: 0,
    downStreak: 0,
    upStreak: 0,
    rateDownStreak: 0,
    rateUpStreak: 0,

    setRungRange(lo, hi) { minRung = lo; maxRung = hi; },

    setRung(r, reason) {
      let next = r < minRung ? minRung : r > maxRung ? maxRung : r | 0;
      if (next < 0) next = 0; if (next > 15) next = 15;
      if (next === rung) return false;
      const from = rung;
      rung = next;
      if (o.onRung) o.onRung(next, from, reason === undefined ? RUNG_REASON.MANUAL : reason);
      return true;
    },

    setRate(r, reason) {
      const next = r === 30 ? 30 : 60;
      if (next === rate) return false;
      const from = rate;
      rate = next;
      targets = pacingTargets(rate);
      if (o.onRate) o.onRate(next, from, reason === undefined ? RUNG_REASON.MANUAL : reason);
      return true;
    },

    sample(nowMs, intervalMs, cpuMs) {
      // EXACTLY W samples per window, then evaluate and start a fresh one.
      //
      // The obvious spelling of this — write, advance, `if (n < W) { n++; return; }` —
      // makes the cycle W+1 samples long, because the sample that triggers the
      // evaluation is written into the buffer and then discarded from the count. The
      // windows then drift against any regular signal and a strictly alternating
      // good/bad input reads as uniformly bad. `simtest.mjs --suite=scaler` caught
      // exactly that: 60 alternating windows produced 9 rung changes and walked the
      // ladder to the floor when the correct answer is zero changes.
      iv[i] = intervalMs; cp[i] = cpuMs;
      i++;
      if (i < W) return false;
      i = 0; n = W;

      const pi = p95(iv), pc = p95(cp);
      scaler.lastP95Interval = pi; scaler.lastP95Cpu = pc;

      // Health of the window, judged against the ACTIVE period.
      const paceBad = pi > targets.p95;
      const paceGood = pi <= targets.p95 && pc < rateSpec(rate).wallMs * 0.70;

      if (paceBad) { downStreak++; upStreak = 0; rateDownStreak++; rateUpStreak = 0; }
      else if (paceGood) { upStreak++; downStreak = 0; rateUpStreak++; rateDownStreak = 0; }
      else { downStreak = 0; upStreak = 0; rateDownStreak = 0; rateUpStreak = 0; }

      scaler.downStreak = downStreak; scaler.upStreak = upStreak;
      scaler.rateDownStreak = rateDownStreak; scaler.rateUpStreak = rateUpStreak;

      // A promotion to 60 that is about to be reversed counts as a FAILED promotion.
      if (rate === 60 && paceBad && (nowMs - promotedAtMs) < SCALER.rate60FailWindowMs
        && rung <= minRung && rateDownStreak >= SCALER.rateDownWindows) {
        rate60Failures++;
        if (rate60Failures >= SCALER.rate60MaxFailures) {
          rate60Latched = true;
          if (o.onLatch) o.onLatch(rate60Failures);
        }
      }

      if (locked && rateLocked) return false;

      /* ---- 1. DOWN a rung. Fast, invisible, always first. -------------------- */
      if (!locked && downStreak >= SCALER.downWindows && rung > minRung
        && (nowMs - lastRungChangeMs) >= SCALER.rungRateLimitMs) {
        downStreak = 0; lastRungChangeMs = nowMs;
        return scaler.setRung(rung - 1, RUNG_REASON.DOWN_PACING);
      }

      /* ---- 2. DOWN the rate, but ONLY with the ladder exhausted. ------------- */
      if (!rateLocked && rate === 60 && rung <= minRung
        && rateDownStreak >= SCALER.rateDownWindows
        && (nowMs - lastRateChangeMs) >= SCALER.rateLimitMs) {
        rateDownStreak = 0; lastRateChangeMs = nowMs;
        return scaler.setRate(30, RUNG_REASON.RATE_DOWN);
      }

      /* ---- 3. UP the rate before UP the rung. Frames beat looks. ------------- */
      const promotionPlausible = !rate60Latched && !rateLocked;
      if (rate === 30 && promotionPlausible
        && rateUpStreak >= SCALER.rateUpWindows
        && pc < SCALER.rateUpCpuMs
        && (nowMs - lastRateChangeMs) >= SCALER.rateLimitMs) {
        rateUpStreak = 0; upStreak = 0; lastRateChangeMs = nowMs; promotedAtMs = nowMs;
        return scaler.setRate(60, RUNG_REASON.RATE_UP);
      }

      /* ---- 4. UP a rung. At 30 Hz this is BLOCKED while 60 is still plausible
                and the measured CPU says 60 might be reachable — headroom must be
                offered to the rate axis first. Once 60 is latched off, or once the
                cost is clearly past what 60 could carry, quality gets the headroom. */
      if (!locked && upStreak >= SCALER.upWindows && rung < maxRung
        && (nowMs - lastRungChangeMs) >= SCALER.rungRateLimitMs) {
        const rateWantsIt = rate === 30 && promotionPlausible && pc < SCALER.rateUpCpuMs;
        if (!rateWantsIt) {
          upStreak = 0; lastRungChangeMs = nowMs;
          return scaler.setRung(rung + 1, RUNG_REASON.UP_HEADROOM);
        }
      }
      return false;
    },

    /** Test hook: force the latch so a harness can exercise the 30 Hz equilibrium. */
    latch60Off() { rate60Latched = true; },

    reset(r, rt) {
      n = 0; i = 0;
      for (let k = 0; k < W; k++) { iv[k] = 0; cp[k] = 0; }
      downStreak = 0; upStreak = 0; rateDownStreak = 0; rateUpStreak = 0;
      lastRungChangeMs = -1e9; lastRateChangeMs = -1e9; promotedAtMs = -1e9;
      rate60Failures = 0; rate60Latched = false;
      if (r !== undefined) rung = r;
      if (rt !== undefined) { rate = rt === 30 ? 30 : 60; targets = pacingTargets(rate); }
    },
  };
  return scaler;
}

/* --------------------------------------------------- cheap vs expensive rungs */

/**
 * A rung change must never itself cause the hitch it exists to prevent.
 *   CHEAP     particle count, render scale, shadow RESOLUTION, volumetric intensity.
 *             Cross-faded over 250 ms, applied live.
 *   EXPENSIVE post pass COUNT, shadow on/off, actor LOD CLASS (skinned vs imposter),
 *             turf/crowd class. Queued and applied at the next play boundary, where a
 *             hitch is invisible.
 */
export function expensiveClass(rung) {
  const r = RUNGS[rung];
  return `${r.postPasses}|${r.shadowSize > 0 ? 1 : 0}|${r.skinned}|${r.imposter}|${r.turf}|${r.crowd}|${r.volumetric}`;
}

export default {
  TIERS, TIER_NAMES, RUNGS, tierOfRung, rungForTier,
  staticSignals, cpuProbe, gpuProbe, classify,
  createScaler, SCALER, RUNG_REASON, RUNG_REASON_NAME, CHANGE_KIND, expensiveClass,
};
