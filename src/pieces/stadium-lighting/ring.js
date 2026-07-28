// PIECE stadium-lighting — where the luminaires actually are.
//
// The bowl's plan curve is an arc-length-resampled superellipse. Our shafts and our
// flare cores have to sit ON stadium-env's luminaires, not near them, or the frame
// reads as two overlapping light rigs. So this file reproduces that curve from the
// mirrored constants in config.js and hands back one tower list that the flare layer,
// the shaft layer and the IBL bake all read from.
//
// Arc-length resampling matters here for the same reason it matters there: a
// theta-sampled squircle bunches its samples into the corners, and a light ring built
// on it would visibly crowd the end zones.

import { hash01 } from '../../foundation/rng.js';
import { RING } from './config.js';

function superellipse(t, A, B, p) {
  const th = t * Math.PI * 2;
  const c = Math.cos(th), s = Math.sin(th);
  const e = 2 / p;
  return [
    A * Math.sign(c) * Math.pow(Math.abs(c), e),
    B * Math.sign(s) * Math.pow(Math.abs(s), e),
  ];
}

/** Closed loop of n+1 samples at equal arc length, with outward unit normals. */
export function buildLoop(n) {
  const A = RING.halfX, B = RING.halfZ, p = RING.power;
  const M = 2048;
  const px = new Float64Array(M + 1), pz = new Float64Array(M + 1), cum = new Float64Array(M + 1);
  for (let i = 0; i <= M; i++) {
    const q = superellipse(i / M, A, B, p);
    px[i] = q[0]; pz[i] = q[1];
    if (i > 0) cum[i] = cum[i - 1] + Math.hypot(px[i] - px[i - 1], pz[i] - pz[i - 1]);
  }
  const total = cum[M];
  const x = new Float32Array(n + 1), z = new Float32Array(n + 1);
  const nx = new Float32Array(n + 1), nz = new Float32Array(n + 1);
  let j = 0;
  for (let i = 0; i <= n; i++) {
    const target = (i / n) * total;
    while (j < M && cum[j + 1] < target) j++;
    const seg = (cum[j + 1] - cum[j]) || 1;
    const k = (target - cum[j]) / seg;
    x[i] = px[j] + (px[j + 1] - px[j]) * k;
    z[i] = pz[j] + (pz[j + 1] - pz[j]) * k;
  }
  for (let i = 0; i <= n; i++) {
    const a = (i - 1 + n) % n, b = (i + 1) % n;
    const tx = x[b] - x[a], tz = z[b] - z[a];
    const L = Math.hypot(tx, tz) || 1;
    // loop runs CCW in XZ with +Z at t=0.25, so (tz,-tx)/L points away from the field
    nx[i] = tz / L; nz[i] = -tx / L;
  }
  return { n, x, z, nx, nz };
}

function at(loop, s, r, y, out) {
  const f = ((s % 1) + 1) % 1;
  const i = Math.min(loop.n - 1, Math.floor(f * loop.n));
  const k = f * loop.n - i;
  const x = loop.x[i] + (loop.x[i + 1] - loop.x[i]) * k;
  const z = loop.z[i] + (loop.z[i + 1] - loop.z[i]) * k;
  const ax = loop.nx[i], az = loop.nz[i];
  out[0] = x + ax * r;
  out[1] = y;
  out[2] = z + az * r;
  out[3] = -ax;          // inward normal — the direction the bank faces
  out[4] = -az;
  return out;
}

/**
 * towers(capture) -> [{ x, y, z, inX, inZ, power, s, seed }]
 * One entry per BANK (not per luminaire). Position is the bank's centre at the
 * midpoint of its two luminaire rows, which is what a shaft should originate from
 * and where the flare core should sit.
 */
export function buildTowers(capture) {
  const loop = buildLoop(capture ? 384 : 256);
  const count = capture ? RING.towersCapture : RING.towersLive;
  const span = RING.towerSpan / count;
  const y = (RING.lightY0 + RING.lightY1) * 0.5;
  const r = RING.lightR - 0.6;
  const tmp = [0, 0, 0, 0, 0];
  const out = [];
  for (let tw = 0; tw < count; tw++) {
    const s = tw / count + span * 0.5;
    at(loop, s, r, y, tmp);
    out.push({
      x: tmp[0], y: tmp[1], z: tmp[2],
      inX: tmp[3], inZ: tmp[4],
      // same per-tower output jitter law stadium-env uses, so bright banks agree
      power: 0.78 + hash01(tw, 3, 88) * 0.50,
      s,
      seed: tw,
    });
  }
  return out;
}

export default { buildLoop, buildTowers };
