// PIECE: score-callout — the animation, as a pure function of `callout.age`.
//
// No clock, no state, no allocation: `animate(age, out)` writes into a caller-owned
// object and returns it. Same age in, same numbers out, forever.
//
// The shape of it, in order:
//   0.000 .. 0.085   SLAM IN. Flies in from the right, oversized, decelerating on a
//                    quartic ease-out, with a motion-blurred streak trailing it.
//   0.085            IMPACT. White-hot flash on the ink, then a damped shake at ~11 Hz
//                    with a 50 ms envelope, plus a scale overshoot that settles.
//   0.30  .. 1.85    HOLD with a slow rise and a hair of scale creep, so it never
//                    looks frozen on a moving frame.
//   1.85  .. 2.27    FADE. Rises and grows slightly as it goes, the way a physical
//                    title card lifts off the plate.

export const IN_T = 0.085;
export const HOLD_T = 1.85;
export const FADE_T = 0.42;
export const END_T = HOLD_T + FADE_T;

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

export function animate(age, out) {
  const a = age > 0 ? age : 0;
  let alpha = 1, scale = 1, dx = 0, dy = 0, rot = 0, streak = 0, hot = 0, blur = 0;

  // ---- slam in
  const u = clamp01(a / IN_T);
  const inv = 1 - u;
  const eo = 1 - inv * inv * inv * inv;
  if (u < 1) {
    dx += (1 - eo) * 330;
    dy += (1 - eo) * -22;
    scale += (1 - eo) * 0.62;
    rot += (1 - eo) * 0.055;
    alpha = clamp01(u * 2.6);
    streak = inv * inv * 0.9 + inv * 0.1;
    blur = inv;
  }

  // ---- impact: damped shake + scale overshoot
  const s = a - IN_T;
  if (s > -IN_T) {
    const ss = s > 0 ? s : 0;
    const env = Math.exp(-ss / 0.050);
    const A = 24 * env;
    dx += A * Math.sin(ss * 74);
    dy += A * 0.45 * Math.sin(ss * 58 + 1.1);
    rot += A * 0.00042 * Math.sin(ss * 66 + 0.4);
    scale += 0.085 * Math.exp(-ss / 0.055) * Math.cos(ss * 46);
  }

  // ---- white-hot flash on the ink
  const fs = a - IN_T * 0.72;
  hot = fs < 0 ? clamp01((a / (IN_T * 0.72)) * 0.85) : Math.exp(-fs / 0.045);

  // ---- hold drift
  if (a > 0.30) {
    const d = a - 0.30;
    dy -= d * 6.5;
    scale += d * 0.0055;
  }

  // ---- fade
  if (a > HOLD_T) {
    const v = clamp01((a - HOLD_T) / FADE_T);
    alpha *= 1 - v * v;
    dy -= v * 46;
    scale += v * 0.11;
    streak = 0;
    hot = 0;
  }
  if (a >= END_T) alpha = 0;

  out.alpha = alpha;
  out.scale = scale;
  out.dx = dx;
  out.dy = dy;
  out.rot = rot;
  out.streak = streak;
  out.hot = hot;
  out.blur = blur;
  return out;
}

export default { animate, IN_T, HOLD_T, FADE_T, END_T };
