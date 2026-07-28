// PIECE: character-anatomy — bone-chain sampling + skin weight authoring.
//
// Every piece of body geometry is built in BIND-POSE WORLD SPACE along a chain of bone
// world positions, and each ring records the chain parameter it sits at. Skin weights
// therefore come out of the same parameter that drives the shape, which is what stops a
// full-extension dive from pinching: a ring at a joint is exactly 50/50 between the two
// bones that meet there, and the blend band is smooth on both sides.

import { V, smooth01 } from './mesh.js';

/**
 * makeChain(points, boneIndices) — parallel arrays, same length.
 * The last entry may repeat a bone index (a tip point) so a leaf bone still gets a
 * length to loft along.
 */
export function makeChain(points, boneIndices) {
  const seg = [];
  for (let i = 0; i < points.length - 1; i++) {
    const d = V.sub(points[i + 1], points[i]);
    seg.push({ len: V.len(d), dir: V.norm(d) });
  }
  return { p: points, b: boneIndices, seg, n: points.length };
}

/** World position at chain parameter t (linear, extrapolating past either end). */
export function chainPoint(ch, t) {
  const k = ch.n - 1;
  if (t <= 0) return V.madd(ch.p[0], ch.seg[0].dir, t * ch.seg[0].len);
  if (t >= k) return V.madd(ch.p[k], ch.seg[k - 1].dir, (t - k) * ch.seg[k - 1].len);
  const i = Math.floor(t);
  return V.lerp(ch.p[i], ch.p[i + 1], t - i);
}

/** Chain direction at t (unit). */
export function chainDir(ch, t) {
  const k = ch.n - 1;
  const i = Math.max(0, Math.min(k - 1, Math.floor(t)));
  const f = t - i;
  if (f < 0.15 && i > 0) return V.norm(V.lerp(ch.seg[i - 1].dir, ch.seg[i].dir, 0.5 + f / 0.3));
  if (f > 0.85 && i + 1 < k) return V.norm(V.lerp(ch.seg[i].dir, ch.seg[i + 1].dir, (f - 0.85) / 0.3));
  return ch.seg[i].dir;
}

/**
 * Skin weights at chain parameter t.
 *
 * Bone i owns the segment from p[i] to p[i+1]. Within `band` of a joint the weight
 * crosses smoothly to the neighbour, reaching exactly 0.5/0.5 at the joint itself from
 * BOTH sides — so the two lofts meeting there deform identically and no seam opens.
 */
export function chainWeights(ch, t, band) {
  const k = ch.n - 1;
  const bw = band === undefined ? 0.34 : band;
  const tt = t < 0 ? 0 : t > k ? k : t;
  const i = Math.max(0, Math.min(k - 1, Math.floor(tt)));
  const f = tt - i;
  const own = ch.b[i];
  if (f < bw && i > 0) {
    const a = 0.5 * (1 - smooth01(f / bw));
    return [[own, 1 - a], [ch.b[i - 1], a]];
  }
  if (f > 1 - bw && i + 1 <= k) {
    const a = 0.5 * smooth01((f - (1 - bw)) / bw);
    const nb = ch.b[Math.min(i + 1, k)];
    if (nb === own) return [[own, 1]];
    return [[own, 1 - a], [nb, a]];
  }
  return [[own, 1]];
}

/** Blend of two explicit bones. */
export function w2(a, b, f) {
  if (f <= 0) return [[a, 1]];
  if (f >= 1) return [[b, 1]];
  return [[a, 1 - f], [b, f]];
}

export default { makeChain, chainPoint, chainDir, chainWeights, w2 };
