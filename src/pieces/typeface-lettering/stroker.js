// PIECE: typeface-lettering
// Centerline -> filled outline. This is the whole reason the faces look hand-made:
// every glyph is authored as brush/pen STROKES (a centreline plus a pressure profile),
// and this module converts them into closed polygons using a broad-nib pen model.
//
// Pen model: an ellipse with semi-axis `a` along the nib direction `d` and `b` across
// it. The perpendicular half-width of the stroke at a point whose normal is N is
//     support(N) = sqrt( a^2 (d.N)^2 + b^2 (d_perp.N)^2 )
// so vertical stems come out at full weight 2a and horizontals thin down to 2b —
// exactly the varying stroke weight of a flat brush. Terminals are cut flat along `d`
// (a chisel), or tapered to a point (a brush exit).
//
// Edge roughness is seeded value noise applied MULTIPLICATIVELY to the half width,
// independently on each side, plus occasional deep notches — the torn brush edge.
//
// Everything here is deterministic: hash01() from foundation/rng.js only.

import { hash01 } from '../../foundation/rng.js';

/* ------------------------------------------------------------------- noise */

export function vn(x, seed) {
  const i = Math.floor(x);
  const f = x - i;
  const a = hash01(seed, i);
  const b = hash01(seed, i + 1);
  const u = f * f * (3 - 2 * f);
  return a + (b - a) * u;
}
export function sn(x, seed) { return vn(x, seed) * 2 - 1; }

/* ----------------------------------------------------------------- sampling */

function cr(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  const f = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return [f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])];
}

/** Resample a control polygon into a dense point list. */
export function sampleCenterline(pts, curve, step) {
  if (!pts || pts.length === 0) return [];
  if (pts.length === 1) return [pts[0].slice()];
  const out = [];
  if (!curve || pts.length < 3) {
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1];
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const n = Math.max(1, Math.round(d / step));
      for (let k = 0; k < n; k++) out.push([p[0] + (q[0] - p[0]) * k / n, p[1] + (q[1] - p[1]) * k / n]);
    }
    out.push(pts[pts.length - 1].slice());
    return out;
  }
  const P = [pts[0], ...pts, pts[pts.length - 1]];
  for (let i = 1; i < P.length - 2; i++) {
    const p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2];
    const d = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(2, Math.round(d / step));
    for (let k = 0; k < n; k++) out.push(cr(p0, p1, p2, p3, k / n));
  }
  out.push(pts[pts.length - 1].slice());
  return out;
}

/* --------------------------------------------------------------- pressure */

/** press:[p0,p1,...] sampled over u in 0..1 with smooth interpolation. */
function pressureAt(press, u) {
  if (!press || press.length === 0) return 1;
  if (press.length === 1) return press[0];
  const f = u * (press.length - 1);
  const i = Math.min(press.length - 2, Math.max(0, Math.floor(f)));
  let k = f - i;
  k = k * k * (3 - 2 * k);
  return press[i] + (press[i + 1] - press[i]) * k;
}

/* ----------------------------------------------------------------- outline */

/**
 * strokeToCmds(stroke, cfg) -> array of path commands in glyph space (y up).
 *
 * stroke = {
 *   p:[[x,y],...]   control points (required)
 *   curve:true      Catmull-Rom through p (false = polyline)
 *   w:1             weight multiplier
 *   press:[..]      pressure profile along the stroke
 *   c:['chisel','chisel']  start/end cap: chisel | taper | butt | round
 *   nib: degrees    per-stroke nib override
 *   rough: number   per-stroke roughness override
 * }
 * cfg = { a, b, nib(deg), step, rough, seed }
 */
export function strokeToCmds(stroke, cfg) {
  const step = cfg.step || 16;
  const P = sampleCenterline(stroke.p, stroke.curve !== false, step);
  if (P.length < 2) return [];

  const nibDeg = stroke.nib !== undefined ? stroke.nib : cfg.nib;
  const th = nibDeg * Math.PI / 180;
  const dx = Math.cos(th), dy = Math.sin(th);
  const px = -dy, py = dx;                        // d_perp
  const A = cfg.a * (stroke.w !== undefined ? stroke.w : 1);
  const B = cfg.b * (stroke.w !== undefined ? stroke.w : 1);

  // `ext:[k0,k1]` extends the centreline outward by k * pen half-width. Geometric
  // faces use it to square off the corner where two strokes meet: with k = 1 both
  // strokes terminate on EXACTLY the same outer corner point, so the union has a
  // clean square corner and the chamfer pass cuts each of them identically.
  // (It must scale with the pen, never with the glyph's x-scale — otherwise the two
  // corners land apart and the chamfer leaves stitched notches inside the letter.)
  if (stroke.ext && (stroke.ext[0] || stroke.ext[1])) {
    const ext = stroke.ext;
    if (ext[0]) {
      const dxa = P[0][0] - P[1][0], dya = P[0][1] - P[1][1];
      const l = Math.hypot(dxa, dya) || 1;
      P.unshift([P[0][0] + dxa / l * ext[0] * A, P[0][1] + dya / l * ext[0] * A]);
    }
    if (ext[1]) {
      const m = P.length;
      const dxb = P[m - 1][0] - P[m - 2][0], dyb = P[m - 1][1] - P[m - 2][1];
      const l = Math.hypot(dxb, dyb) || 1;
      P.push([P[m - 1][0] + dxb / l * ext[1] * A, P[m - 1][1] + dyb / l * ext[1] * A]);
    }
  }
  const n = P.length;
  const rough = stroke.rough !== undefined ? stroke.rough : (cfg.rough || 0);
  const seed = cfg.seed | 0;

  // arc length
  const s = new Array(n); s[0] = 0;
  for (let i = 1; i < n; i++) s[i] = s[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
  const total = s[n - 1] || 1;

  const L = new Array(n), R = new Array(n);
  const halfAt = [];
  let T0 = null, Tn = null;

  for (let i = 0; i < n; i++) {
    const ia = Math.max(0, i - 1), ib = Math.min(n - 1, i + 1);
    let tx = P[ib][0] - P[ia][0], ty = P[ib][1] - P[ia][1];
    const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    if (i === 0) T0 = [tx, ty];
    if (i === n - 1) Tn = [tx, ty];
    const nx = -ty, ny = tx;                       // left normal
    const dn = dx * nx + dy * ny;
    const dpn = px * nx + py * ny;
    const u = s[i] / total;
    const pr = pressureAt(stroke.press || cfg.defaultPress, u);
    const base = Math.sqrt(A * A * dn * dn + B * B * dpn * dpn) * pr;
    halfAt.push(base);

    let rl = 1, rr = 1;
    if (rough > 0) {
      // A torn brush edge is NOT a wavy edge: it is a mostly-straight edge with
      // occasional sharp inward bites where the bristles skipped. So: a tiny smooth
      // undulation + a fine tremor + rare, sharp, one-sided chips.
      const q = s[i] / 100;
      const undL = 0.034 * sn(q * 0.85, seed + 11) + 0.014 * sn(q * 4.3, seed + 29);
      const undR = 0.034 * sn(q * 0.72 + 3.7, seed + 53) + 0.014 * sn(q * 4.9 + 1.1, seed + 71);
      // Chips are rare and sharp: two low-frequency streams multiplied, so a bite only
      // happens where both peak. About three or four per stem, never evenly spaced.
      const cl = vn(q * 1.05 + 9.2, seed + 97) * vn(q * 0.61 + 4.1, seed + 181);
      const cr2 = vn(q * 0.93 + 2.4, seed + 131) * vn(q * 0.55 + 7.7, seed + 211);
      const biteL = cl > 0.36 ? Math.pow((cl - 0.36) / 0.64, 1.15) : 0;
      const biteR = cr2 > 0.38 ? Math.pow((cr2 - 0.38) / 0.62, 1.15) : 0;
      rl = 1 + undL - rough * biteL * 2.6;
      rr = 1 + undR - rough * biteR * 2.6;
    }
    L[i] = [P[i][0] + nx * base * rl, P[i][1] + ny * base * rl];
    R[i] = [P[i][0] - nx * base * rr, P[i][1] - ny * base * rr];
  }

  // Brush hairs are occasional, not uniform: only ~40% of terminals pull one, and the
  // ones that do vary a lot in length. Uniform spikes read as decorative nibs.
  const sp = cfg.spike || 0;
  const spikeStart = sp && hash01(seed, 7) < 0.40 ? sp * (0.9 + hash01(seed, 8) * 1.9) : 0;
  const spikeEnd = sp && hash01(seed, 17) < 0.52 ? sp * (0.9 + hash01(seed, 18) * 2.3) : 0;

  const caps = stroke.c || ['chisel', 'chisel'];
  const cmds = [];
  const push = (op, p) => cmds.push([op, p[0], p[1]]);

  // --- forward along the left edge
  push('M', L[0]);
  for (let i = 1; i < n; i++) push('L', L[i]);

  // --- end cap
  const endPts = capPoints(P[n - 1], Tn, [dx, dy], halfAt[n - 1], A * pressureAt(stroke.press || cfg.defaultPress, 1), caps[1], L[n - 1], R[n - 1], spikeEnd);
  for (const p of endPts) push('L', p);

  // --- back along the right edge
  for (let i = n - 1; i >= 0; i--) push('L', R[i]);

  // --- start cap
  const stPts = capPoints(P[0], [-T0[0], -T0[1]], [dx, dy], halfAt[0], A * pressureAt(stroke.press || cfg.defaultPress, 0), caps[0], R[0], L[0], spikeStart);
  for (const p of stPts) push('L', p);

  cmds.push(['Z']);
  return cmds;
}

/**
 * Cap geometry. `T` points OUT of the stroke; `from` is the edge point we are
 * leaving and `to` the one we are heading for.
 */
function capPoints(P, T, d, half, nibHalf, kind, from, to, spike) {
  const nx = -T[1], ny = T[0];
  if (kind === 'butt') return [];
  if (kind === 'taper') {
    return [[P[0] + T[0] * half * 1.35, P[1] + T[1] * half * 1.35]];
  }
  if (kind === 'point') {
    return [[P[0] + T[0] * half * 2.4, P[1] + T[1] * half * 2.4]];
  }
  if (kind === 'round') {
    const out = [];
    const a0 = Math.atan2(from[1] - P[1], from[0] - P[0]);
    for (let k = 1; k <= 5; k++) {
      const a = a0 - Math.PI * (k / 6) * Math.sign(nx * (to[0] - from[0]) + ny * (to[1] - from[1]) || 1);
      out.push([P[0] + Math.cos(a) * half, P[1] + Math.sin(a) * half]);
    }
    return out;
  }
  // chisel: flat cut along the nib direction, nudged out along the tangent, with the
  // trailing corner pulled into a thin spike — the hair the brush leaves as it lifts.
  const sgn = (d[0] * nx + d[1] * ny) >= 0 ? 1 : -1;
  const e = [P[0] + T[0] * nibHalf * 0.22, P[1] + T[1] * nibHalf * 0.22];
  const c1 = [e[0] + d[0] * nibHalf * sgn, e[1] + d[1] * nibHalf * sgn];
  const c2 = [e[0] - d[0] * nibHalf * sgn, e[1] - d[1] * nibHalf * sgn];
  if (spike > 0) {
    const tip = [
      c2[0] + T[0] * nibHalf * spike - d[0] * nibHalf * sgn * 0.06,
      c2[1] + T[1] * nibHalf * spike - d[1] * nibHalf * sgn * 0.06,
    ];
    const back = [
      c2[0] - d[0] * nibHalf * sgn * 0.17,
      c2[1] - d[1] * nibHalf * sgn * 0.17,
    ];
    return [c1, back, tip, c2];
  }
  return [c1, c2];
}

/* ---------------------------------------------------------------- chamfer */

/** Cut every convex corner of a closed polygon by `amt` — the techno face's look. */
export function chamferCmds(cmds, amt, minAngle) {
  const out = [];
  let poly = [];
  const flush = () => {
    if (poly.length > 2) {
      const c = chamferPoly(poly, amt, minAngle === undefined ? 0.35 : minAngle);
      out.push(['M', c[0][0], c[0][1]]);
      for (let i = 1; i < c.length; i++) out.push(['L', c[i][0], c[i][1]]);
      out.push(['Z']);
    }
    poly = [];
  };
  for (const c of cmds) {
    if (c[0] === 'M') { flush(); poly.push([c[1], c[2]]); }
    else if (c[0] === 'L') poly.push([c[1], c[2]]);
    else if (c[0] === 'Z') flush();
  }
  flush();
  return out;
}

function chamferPoly(poly, amt, minTurn) {
  const n = poly.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p0 = poly[(i - 1 + n) % n], p1 = poly[i], p2 = poly[(i + 1) % n];
    let ax = p0[0] - p1[0], ay = p0[1] - p1[1];
    let bx = p2[0] - p1[0], by = p2[1] - p1[1];
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (la < 1e-6 || lb < 1e-6) { out.push(p1); continue; }
    ax /= la; ay /= la; bx /= lb; by /= lb;
    const cosang = ax * bx + ay * by;                 // -1 straight, 1 spike
    if (cosang < -1 + minTurn) { out.push(p1); continue; }
    const k = Math.min(amt, la * 0.45, lb * 0.45);
    out.push([p1[0] + ax * k, p1[1] + ay * k]);
    out.push([p1[0] + bx * k, p1[1] + by * k]);
  }
  return out;
}

/* ------------------------------------------------------------------ glyphs */

/**
 * Compile a skeleton glyph description into the frozen glyph JSON shape.
 * g = { adv, s:[stroke,...], dy, rot, chamfer }
 */
export function compileGlyph(ch, g, cfg) {
  const seed = (cfg.seed | 0) + ch.charCodeAt(0) * 7919;
  let cmds = [];
  for (let i = 0; i < g.s.length; i++) {
    const st = g.s[i];
    cmds = cmds.concat(strokeToCmds(st, Object.assign({}, cfg, { seed: seed + i * 331 })));
  }
  if (g.chamfer || cfg.chamfer) cmds = chamferCmds(cmds, g.chamfer || cfg.chamfer, cfg.chamferMin);

  // Hand-lettered bounce: a small per-glyph rotation + vertical shift baked in.
  const jitter = cfg.jitter || 0;
  if (jitter > 0) {
    const rot = (hash01(seed, 3) - 0.5) * jitter * 0.030;       // radians
    const dy = (hash01(seed, 5) - 0.5) * jitter * 30;
    const dxx = (hash01(seed, 9) - 0.5) * jitter * 12;
    const cx = 180, cy = 340;
    const ca = Math.cos(rot), sa = Math.sin(rot);
    cmds = cmds.map((c) => {
      if (c[0] === 'Z') return c;
      const x = c[1] - cx, y = c[2] - cy;
      return [c[0], cx + x * ca - y * sa + dxx, cy + x * sa + y * ca + dy];
    });
  }
  return { adv: g.adv, cmds };
}

export default { strokeToCmds, compileGlyph, chamferCmds, sampleCenterline, vn, sn };
