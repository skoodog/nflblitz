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
// AND THE SPRING HAS THE LERP'S SECOND FAULT TOO, which round 1 of this file did not admit.
// "Its error is proportional to subject speed" is a property of ANY linear tracker with a
// finite bandwidth, not of first-order ones: a second-order tracker sits at 2*zeta*V/omega
// behind a constant-velocity target. It is cancelled explicitly below rather than denied.
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
    pi: new Float64Array(N),   // the previous grid step's IDEAL, for the feed-forward
    d: new Float64Array(N),    // low-passed d(ideal)/dt, same units per second
    k: -1,              // grid index the state is valid at; -1 = uninitialised
    shot: -1,           // which recipe was active at index k (used to detect a cut)
    lastCut: 0,         // grid index of the most recent cut
  };
}

/* ------------------------------------------------- VELOCITY FEED-FORWARD (round 2)
 *
 * THE SPRING WAS THROWING THE AUTHORED FRAMING AWAY, and the amount is closed-form.
 * A second-order tracker following a target moving at constant speed V settles at a
 * CONSTANT position error of 2*zeta*V/omega — it never catches up, it just stops falling
 * further behind. For `pursuit` (stiff 14 -> omega 3.74, zeta 0.86) an 8 m/s runner gives
 * 2*0.86*8/3.74 = 3.68 m of lag against a staging distance of 3.83 m. The camera sits at
 * very nearly TWICE the distance the recipe asked for, for the whole run.
 *
 * Measured over 4732 live frames across 20 seeds, delivered fill against authored fill:
 *     pocket 0.93 / 0.76      pursuit 0.39 / 0.64
 *     deep   0.29 / 0.38      impact  0.33 / 0.68   (at 10.9 m against an authored 3.9)
 * The flagship hit landed at 2.8x its staging distance and half its fill — under the 0.40
 * "fallback-wide" that this whole piece exists to replace.
 *
 * THE FIX IS TO CANCEL THE TERM, not to stiffen everything up: stiffness is the shot's
 * character (a locked tripod vs a heavy operator) and raising it to hide a lag would flatten
 * the six recipes into one. So the spring is aimed at
 *
 *     goal = ideal + (2*zeta/omega) * d(ideal)/dt
 *
 * which is exactly the steady-state error, added back. The transient behaviour — overshoot
 * on a direction change, carry-through when the runner is tackled — is untouched, because
 * the derivative is zero whenever the ideal is not moving. That is the whole point of using
 * the lag term rather than a shorter time constant.
 *
 * d(ideal)/dt is a finite difference on the SAME FIXED GRID the integrator runs on, so it
 * is still a pure function of t and still bit-identical under out-of-order stepping. It is
 * low-passed (DFILT, ~80 ms) because `ballGuard` can step the aim point discontinuously,
 * and each channel is capped (LEAD_CAP) so one such step cannot fling the camera.
 */
const LEAD = 0.90;             // fraction of the computed lag to cancel; 1.0 rings slightly
const DFILT = 0.10;            // per-step pole of the derivative filter at 120 Hz
const LEAD_CAP = new Float64Array([5, 2.5, 5, 6, 3, 6, 5, 4, 12]);

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
// CUT_KICK IS IN UNITS OF OMEGA, and the fact that it used to be a bare 9.0 was the second
// half of the framing bug. The teleport leaves a residual of `err * CUT_LAG`; the kick then
// set v = err * 9.0, which for a pursuit -> impact cut with a 7 m error is 63 m/s into a
// spring whose omega is 3. The camera did not land and settle, it was launched: measured
// |camera - ideal| on seed 12 went 0 -> 9.24 m in the 400 ms AFTER the cut, and on seed 5
// the pocket -> deep cut threw it 36 m past the mark. Scaling the kick by omega makes the
// arrival a property of the settle rather than of the size of the jump — peak overshoot is
// now CUT_LAG * CUT_KICK / e ~= 3.6% of the cut distance, which is a landing, not a flyby.
const CUT_LAG = 0.055;      // fraction of the way back along the settle
const CUT_KICK = 1.8;       // multiples of omega applied to that residual

export function stepTo(body, kTarget, ideal, scratch, stiffOf) {
  if (kTarget > MAX_STEPS) kTarget = MAX_STEPS;
  if (body.k < 0 || body.k > kTarget) {
    // restart from zero, settled on frame zero's ideal so a still at t=0 is exact
    ideal(0, scratch);
    for (let i = 0; i < N; i++) {
      body.p[i] = scratch[i]; body.v[i] = 0; body.pi[i] = scratch[i]; body.d[i] = 0;
    }
    body.k = 0;
    body.shot = scratch[N];
    body.lastCut = 0;
  }
  while (body.k < kTarget) {
    const k = body.k + 1;
    ideal(k, scratch);
    const sid = scratch[N];
    const kk = stiffOf(sid);
    if (sid !== body.shot) {
      const w = Math.sqrt(kk);
      for (let i = 0; i < N; i++) {
        const err = scratch[i] - body.p[i];
        body.p[i] = scratch[i] - err * CUT_LAG;
        body.v[i] = err * CUT_LAG * w * CUT_KICK;
        // A cut is a new shot, not a continuation: the old shot's lead means nothing about
        // the new one, so the feed-forward starts from rest and rebuilds over ~80 ms.
        body.pi[i] = scratch[i];
        body.d[i] = 0;
      }
      body.shot = sid;
      body.lastCut = k;
    } else {
      for (let i = 0; i < N; i++) {
        // fov, roll and focus are far stiffer than the body: a lens does not swing on a
        // shoulder mount. Measured by eye — at the body's stiffness a focus pull lagged
        // ~0.4 s behind the ball and the ball was soft through the whole catch.
        const s = i >= 6 ? kk * 2.4 : kk;
        const w = Math.sqrt(s);
        // FEED-FORWARD. Filtered rate of the ideal, times the closed-form lag 2*zeta/omega.
        const raw = (scratch[i] - body.pi[i]) / STEP;
        body.pi[i] = scratch[i];
        body.d[i] += (raw - body.d[i]) * DFILT;
        let lead = (2 * ZETA / w) * body.d[i] * LEAD;
        const cap = LEAD_CAP[i];
        if (lead > cap) lead = cap; else if (lead < -cap) lead = -cap;
        const cc = 2 * w * ZETA;
        const a = (scratch[i] + lead - body.p[i]) * s - body.v[i] * cc;
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
