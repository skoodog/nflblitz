// PIECE cinematography — THE CAMERA BODY. Mass, damping, an operator's hands, and the
// shove a hit gives him. Everything here is a PURE FUNCTION OF THE SIMULATED TIME t.
//
// WHY A SPRING AND NOT A LERP, stated as the failure it replaces. The obvious follow
// camera is `pos += (ideal - pos) * k`, and it has two tells you can see in one frame of
// video: it never overshoots, so it never looks like something with mass; and its error
// is proportional to subject speed, so it sits at a FIXED lag behind a runner at constant
// speed and snaps forward the instant he is tackled. A second-order system does neither.
// It arrives late, carries through, and settles — which is what a shoulder-mounted
// operator does, and what every Blitz-lineage replay camera has always faked.
//
//     a = (ideal - p) * k  -  v * c,      c = 2 * sqrt(k) * zeta
//
// zeta is 0.86 rather than 1.0 on purpose: a hair under critical, so there is exactly one
// visible overshoot on a hard cut and none on a smooth follow.
//
// ------------------------------------------------------------- DETERMINISM, EXACTLY
// scripts/lint-determinism.mjs forbids wall clocks, and the capture path is worse than
// that: engine.js calls applyShot at t, then at t-0.5*shutter, then walks forward across
// the shutter arc. So an integrator that just accumulated dt between calls would produce
// a DIFFERENT camera for the same URL depending on the sample order.
//
// This one integrates on a FIXED GRID from t=0 at 120 Hz, and caches the state at grid
// index k. A request for a time whose index is >= k steps forward from the cache; a
// request below it restarts from zero. Either way the answer for a given t is the same
// bits, because the grid is the same. The cache is a speed optimisation with no effect on
// the result — verified by the fact that removing it changes nothing but the runtime.

import { hash01 } from '../../foundation/rng.js';

export const STEP = 1 / 120;
const ZETA = 0.86;
const MAX_STEPS = 4200;        // 35 s of play; a down is never that long

/** Nine tracked scalars: pos xyz, target xyz, fov, roll, focus distance. */
export const N = 9;

export function createBody() {
  return {
    p: new Float64Array(N),
    v: new Float64Array(N),
    k: -1,              // grid index the state is valid at; -1 = uninitialised
    shot: -1,           // which recipe was active at index k (used to detect a cut)
    lastCut: 0,         // grid index of the most recent cut
  };
}

/**
 * Step the body to grid index `kTarget`, calling `ideal(k, out)` to get the director's
 * wanted state at each grid step. `ideal` must also write `out[N]` = the shot id, so a
 * change of shot can be detected and taken as a CUT.
 *
 * ON A CUT the state does not interpolate — it teleports, which is what a cut is. But it
 * teleports to a point deliberately SHORT of the new ideal, with velocity toward it:
 * `p = ideal - err`, `v = err * CUT_KICK`. The result is that the frame arrives already
 * moving and settles over ~0.25 s, which is how a real operator lands on a new subject.
 * A cut that lands perfectly composed and frozen reads as a scene change, not as an edit.
 */
const CUT_LAG = 0.055;      // fraction of the way back along the settle
const CUT_KICK = 9.0;

export function stepTo(body, kTarget, ideal, scratch, stiffOf) {
  if (kTarget > MAX_STEPS) kTarget = MAX_STEPS;
  if (body.k < 0 || body.k > kTarget) {
    // restart from zero, settled on frame zero's ideal so a still at t=0 is exact
    ideal(0, scratch);
    for (let i = 0; i < N; i++) { body.p[i] = scratch[i]; body.v[i] = 0; }
    body.k = 0;
    body.shot = scratch[N];
    body.lastCut = 0;
  }
  while (body.k < kTarget) {
    const k = body.k + 1;
    ideal(k, scratch);
    const sid = scratch[N];
    if (sid !== body.shot) {
      for (let i = 0; i < N; i++) {
        const err = scratch[i] - body.p[i];
        body.p[i] = scratch[i] - err * CUT_LAG;
        body.v[i] = err * CUT_KICK;
      }
      body.shot = sid;
      body.lastCut = k;
    } else {
      const kk = stiffOf(sid);
      for (let i = 0; i < N; i++) {
        // fov, roll and focus are far stiffer than the body: a lens does not swing on a
        // shoulder mount. Measured by eye — at the body's stiffness a focus pull lagged
        // ~0.4 s behind the ball and the ball was soft through the whole catch.
        const s = i >= 6 ? kk * 2.4 : kk;
        const cc = 2 * Math.sqrt(s) * ZETA;
        const a = (scratch[i] - body.p[i]) * s - body.v[i] * cc;
        body.v[i] += a * STEP;
        body.p[i] += body.v[i] * STEP;
      }
    }
    body.k = k;
  }
  return body;
}

/* ------------------------------------------------------------------- the hands */

/**
 * HANDHELD. Three incommensurate sines per axis so it never repeats inside a down, all
 * of them sin(w*t) so EVERY AXIS IS EXACTLY ZERO AT t=0.
 *
 * That last property is not decoration, it is a requirement: `scripts/shoot.mjs` captures
 * at t=0 by default, so any drift with a non-zero value at the origin would mean the
 * composed frame and the captured frame are different frames, and every number measured
 * off the bar in language.js would be measuring the wrong thing.
 *
 * Amplitudes are metres. 12 mm of sway at 4.6 m from the subject is ~0.15 degrees, which
 * at 1080p is about 3 px of drift — present, never distracting.
 */
const HAND_W = [
  [0.83, 1.97, 3.41],
  [1.13, 2.53, 4.27],
  [0.71, 1.61, 3.79],
];

export function handheld(out, t, amp, seed) {
  for (let ax = 0; ax < 3; ax++) {
    const w = HAND_W[ax];
    // Phase offsets come from hash01 so two shots in the same game do not breathe in
    // lockstep, but they multiply sin(w*t) rather than shifting it, so t=0 stays zero.
    const g0 = 0.6 + 0.8 * hash01(seed, ax, 1);
    const g1 = 0.5 + 0.7 * hash01(seed, ax, 2);
    const g2 = 0.4 + 0.6 * hash01(seed, ax, 3);
    out[ax] = amp * (
      0.0120 * g0 * Math.sin(w[0] * t) +
      0.0052 * g1 * Math.sin(w[1] * t) +
      0.0021 * g2 * Math.sin(w[2] * t)
    );
  }
  return out;
}

/**
 * IMPACT SHAKE. A decaying ring, keyed off a REAL event time — the sim's own tackle,
 * sack, truck and fumble log — not off a timer and not off a noise field.
 *
 *   A(dt) = power * exp(-dt / TAU) * sin(dt * OMEGA)
 *
 * TAU 0.115 s and OMEGA 61 rad/s were picked so the ring is about three visible cycles
 * and is under a pixel by 0.4 s. Longer than that and it reads as an earthquake; the
 * arcade reference shakes hard and stops.
 *
 * Returns the scalar envelope; the caller decides which axes it drives.
 */
const TAU = 0.115;
const OMEGA = 61.0;

export function shake(dt, power) {
  if (dt < 0 || dt > 0.75) return 0;
  return power * Math.exp(-dt / TAU) * Math.sin(dt * OMEGA);
}

export default { createBody, stepTo, handheld, shake, STEP, N };
