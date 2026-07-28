// PIECE stadium-lighting — the sky, and what happens in it.
//
// THE SKY DOME sits at r=268, INSIDE stadium-env's own sky sphere at r=300, and is
// drawn transparent with depth writes off. So it layers real cloud structure over
// their gradient rather than competing with it: two pieces, one sky, no z-fight.
//
// LIGHTNING IS A PURE FUNCTION OF t. `strikeState(t, seed, weatherLightning)` is the
// only clock in the piece. Strike 0 is deliberately UNJITTERED and placed 20 ms before
// t=0, so the default capture time lands on a bolt at full brightness with the flash
// just past its attack — which is the frame bar/panel-midair_hit shows.
//
// A shot only enters STORM MODE (frequent strikes, visible bolt geometry) when its
// ShotSpec asks for weather.lightning >= 0.78. Everything below that gets a rare,
// distant flash and no bolt, so qb_dropback does not get struck by lightning at t=0.

import * as THREE from 'three';
import { hash01 } from '../../foundation/rng.js';
import { PAL } from './config.js';
import { makeSpriteBuf, push, toGeometry, GRP } from './spritebuf.js';

export const STORM_THRESHOLD = 0.78;

const LEAD = 0.020;          // seconds of strike already elapsed at t=0

function smooth01(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0 || 1)));
  return t * t * (3 - 2 * t);
}

/**
 * strikeState(t, seed, lightning) -> { flash, bolt, index }
 *   flash  0..1 scene-wide burst, already scaled by the shot's weather
 *   bolt   0..1 bolt-geometry brightness (0 outside storm mode)
 *   index  which of the three bolt variants is discharging
 */
export function strikeState(t, seed, lightning) {
  const L = Math.max(0, Math.min(1, lightning));
  const storm = L >= STORM_THRESHOLD;
  const period = storm ? 2.90 : 11.30;
  // Storm mode puts strike 0 at t = -LEAD so a default capture lands on it. Everything
  // else is pushed 4.6 s away from t=0, because a scene that only asked for
  // weather.lightning=0.25 must not be mid-flash in its hero still.
  const tt = t + LEAD - (storm ? 0 : 4.6);
  let k = Math.floor(tt / period);
  if (!Number.isFinite(k)) k = 0;
  const jit = k === 0 ? 0 : (hash01(k, 3, seed) * (storm ? 0.85 : 3.4));
  const dt = (tt - k * period) - jit;

  if (dt < 0) return { flash: 0, bolt: 0, index: ((k % 3) + 3) % 3 };

  const attack = smooth01(0, 0.012, dt);
  const main = Math.exp(-dt * 7.2);
  const blink = dt > 0.082 ? 0.60 * Math.exp(-(dt - 0.082) * 15.0) : 0;
  const flashRaw = Math.min(1.35, attack * (main + blink));
  const boltRaw = attack * (Math.exp(-dt * 12.5) + (dt > 0.082 ? 0.55 * Math.exp(-(dt - 0.082) * 22.0) : 0));

  const flash = flashRaw * L * (storm ? 1.0 : 0.35);
  const bolt = storm ? boltRaw * (0.45 + 0.55 * (L - STORM_THRESHOLD) / (1 - STORM_THRESHOLD)) : 0;
  return { flash, bolt: Math.min(1.2, bolt), index: ((k % 3) + 3) % 3 };
}

/* ------------------------------------------------------------- bolt geometry */

/** Recursive midpoint displacement — the only shape that reads as lightning. */
function jaggedPath(rng, ax, ay, az, bx, by, bz, levels, amp0) {
  let pts = [[ax, ay, az], [bx, by, bz]];
  let amp = amp0;
  for (let l = 0; l < levels; l++) {
    const next = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1];
      const mx = (p[0] + q[0]) * 0.5, my = (p[1] + q[1]) * 0.5, mz = (p[2] + q[2]) * 0.5;
      // displace perpendicular-ish: any direction but along the segment
      let dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2];
      const dl = Math.hypot(dx, dy, dz) || 1;
      dx /= dl; dy /= dl; dz /= dl;
      let rx = rng() * 2 - 1, ry = rng() * 2 - 1, rz = rng() * 2 - 1;
      const dot = rx * dx + ry * dy + rz * dz;
      rx -= dx * dot; ry -= dy * dot; rz -= dz * dot;
      const rl = Math.hypot(rx, ry, rz) || 1;
      const a = amp * (0.35 + rng() * 0.65);
      next.push([mx + (rx / rl) * a, my + (ry / rl) * a, mz + (rz / rl) * a]);
      next.push(q);
    }
    pts = next;
    amp *= 0.56;
  }
  return pts;
}

function ribbon(buf, pts, w0, w1, gain) {
  const C = PAL.boltCore;
  const n = pts.length - 1;
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[i + 1];
    let dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2];
    const L = Math.hypot(dx, dy, dz);
    if (L < 1e-4) continue;
    dx /= L; dy /= L; dz /= L;
    const f = i / Math.max(1, n - 1);
    const w = w0 + (w1 - w0) * f;
    push(buf,
      (p[0] + q[0]) * 0.5, (p[1] + q[1]) * 0.5, (p[2] + q[2]) * 0.5,
      w, L * 1.10,
      [C[0] * gain, C[1] * gain, C[2] * gain],
      'bolt', 2, 0, 0, 0, [dx, dy, dz]);
  }
}

const BOLT_ANCHORS = [
  [62, 205, -110, 30, 8, -150],
  [-86, 196, -138, -42, 10, -168],
  [14, 228, -178, -12, 14, -206],
];

/**
 * Three bolts merged into ONE geometry. `update` picks which one is discharging with
 * setDrawRange — one draw call, zero allocation, and every strike looks different.
 * Returns { geometry, ranges:[[start,count] x3] }.
 */
export function buildBolts(rng) {
  const buf = makeSpriteBuf(GRP.bolt);
  const ranges = [];
  for (let b = 0; b < 3; b++) {
    const start = buf.n * 6;
    const A = BOLT_ANCHORS[b];
    const trunk = jaggedPath(rng, A[0], A[1], A[2], A[3], A[4], A[5], 5, Math.hypot(A[3] - A[0], A[4] - A[1], A[5] - A[2]) * 0.085);
    ribbon(buf, trunk, 3.40, 1.35, 1.0);

    // 3-4 branches peeling off the trunk, each shorter and thinner
    const nb = 3 + ((rng() * 2) | 0);
    for (let i = 0; i < nb; i++) {
      const at = 0.22 + rng() * 0.62;
      const idx = Math.min(trunk.length - 2, Math.floor(at * trunk.length));
      const p = trunk[idx];
      const q = trunk[Math.min(trunk.length - 1, idx + 3)];
      let dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2];
      const dl = Math.hypot(dx, dy, dz) || 1;
      dx /= dl; dy /= dl; dz /= dl;
      const spread = 0.55 + rng() * 0.75;
      const bx = p[0] + (dx + (rng() - 0.5) * spread * 2.2) * (26 + rng() * 40);
      const by = p[1] + (dy * 0.85 - rng() * 0.25) * (26 + rng() * 40);
      const bz = p[2] + (dz + (rng() - 0.5) * spread * 2.2) * (26 + rng() * 40);
      const br = jaggedPath(rng, p[0], p[1], p[2], bx, by, bz, 3, 4.5);
      ribbon(buf, br, 1.90, 0.60, 0.76);
    }
    ranges.push([start, buf.n * 6 - start]);
  }
  const g = toGeometry(buf, 'sl.bolt');
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 100, -150), 320);
  return { geometry: g, ranges };
}

/* --------------------------------------------------------------- sky dome */

export function buildSkyDome(capture) {
  const g = new THREE.SphereGeometry(268, capture ? 48 : 32, capture ? 26 : 18);
  g.name = 'sl.skydome';
  return g;
}

export default { strikeState, buildBolts, buildSkyDome, STORM_THRESHOLD };
