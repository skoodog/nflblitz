// PIECE: score-callout — the ink engine.
//
// ROUND 2 REWRITE. Round 1 painted the glyph and then processed it: keyline stroke,
// bolden stroke, gradient fill, per-letter density bands, an inner "crown" light, a
// specular sweep, a uniform grunge chew and outward spatter. Measured against the bar
// that produced three separate tells at frame size — a bevelled, gradient-shaded,
// dirt-speckled letterform with blunt chopped terminals, against flat matte brush paint
// with tapered, split terminals. It also cost 65-148 ms a lockup.
//
// This version is built the way the paint actually works, in ONE pass over a MASK:
//
//   1. silhouette      one Path2D fill — the only path fill in the whole line
//   2. slimX           an x-only erosion, so the horizontal widening that gives the bar's
//                      set width does not also fatten the stems. Widening multiplies a
//                      near-vertical stem's width and leaves a horizontal hairline alone,
//                      so eroding the same axis back puts the brush's thick/thin contrast
//                      exactly where it started while the counters stay open.
//   3. fringe          the signature. The mask is EXTRUDED down the brush axis and the
//                      extrusion is combed into hairlines, so every stroke end that faces
//                      down grows 2-3 filaments running past it — a short dense fringe
//                      plus a few long hairs. This is what the bar's R, K and U legs do
//                      and what a chopped vector terminal can never do.
//   4. flat ink        one narrow vertical ramp, masked. No bevel, no crown, no density
//                      banding. Total top-to-bottom value swing inside a glyph <= 10%.
//   5. dry brush       a handful of long, faint streaks ALONG the axis. No fine tooth —
//                      at frame size that read as JPEG dirt, not as paint.
//   6. shadow          derived from the finished mask and blurred at 1/4 resolution, so a
//                      35 px halo costs a 9 px blur on a plate 16x smaller.
//
// Everything here runs at BAKE time only. The frame path never enters this file.

import { makeRng, seedFromString, hash } from '../../foundation/rng.js';
import { OUTLINE, SHADOW_RGB, ramp } from './palette.js';

/* ----------------------------------------------------------- scratch pool */

const POOL = [];
function scratch(i, w, h) {
  let s = POOL[i];
  if (!s) {
    const cv = newCanvas(w, h);
    s = POOL[i] = { cv, ctx: cv.getContext('2d') };
  }
  if (s.cv.width < w || s.cv.height < h) {
    s.cv.width = Math.max(s.cv.width, Math.ceil(w));
    s.cv.height = Math.max(s.cv.height, Math.ceil(h));
  }
  const c = s.ctx;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'source-over';
  c.globalAlpha = 1;
  c.filter = 'none';
  c.clearRect(0, 0, s.cv.width, s.cv.height);
  return s;
}

/**
 * Drop the scratch canvases. A bake is one-shot, so holding six plate-sized surfaces
 * alive between callouts is pure backing-store cost — the piece's cap is 3 MB and the
 * cached PLATES have to fit inside it.
 */
export function releaseScratch() {
  for (let i = 0; i < POOL.length; i++) {
    const s = POOL[i];
    if (s && s.cv) { s.cv.width = 1; s.cv.height = 1; }
  }
  POOL.length = 0;
}

export function newCanvas(w, h) {
  const W = Math.max(2, Math.ceil(w)), H = Math.max(2, Math.ceil(h));
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(W, H);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  return cv;
}

/* -------------------------------------------------------------- cap ratio */

const CAP_CACHE = new Map();
function capRatioOf(faces, face) {
  const k = (faces.piece || 'f') + '|' + face;
  let v = CAP_CACHE.get(k);
  if (v === undefined) {
    let m = null;
    try { m = faces.measure('H', face, 100, { tracking: 0 }); } catch (e) { m = null; }
    v = (m && (m.cap || m.ascent)) ? (m.cap || m.ascent) / 100 : 0.72;
    if (!(v > 0.2) || !(v < 1.4)) v = 0.72;
    CAP_CACHE.set(k, v);
  }
  return v;
}

function advOf(faces, ch, face, size) {
  try { return faces.measure(ch, face, size, { tracking: 0 }).w; } catch (e) { return size * 0.5; }
}

/**
 * The face's own italic shear. Widening a glyph horizontally also multiplies its shear,
 * so the layout pre-divides by xScale and the widening restores the face's intended
 * angle exactly. At xScale 1.52 that is the difference between the bar's 15 deg and a
 * cartoonish 22 deg.
 */
function slantOfFace(faces, face) {
  try {
    const d = faces.data && faces.data[face];
    if (d && typeof d.defaultSlant === 'number') return d.defaultSlant;
  } catch (e) { /* fall through */ }
  return face === 'blitz-brush' ? 0.27 : 0;
}

/* ----------------------------------------------------------------- layout */

/**
 * Hand-set a single line. Origin is the line's baseline at x = 0.
 *
 * `minor` — after the line-initial cap every following cap drops slightly. Measured off
 * the bar rather than guessed: panel-truck TRUCK! runs R/T 0.92, U/T 0.83, C/T 0.81,
 * K/T 0.84; panel-midair MURDER! runs 0.79-0.88; but MID-AIR, the SMALL line, runs
 * 0.90-0.99. So line 2 sets `minor` near 0.885 and line 1 near 0.93 — a single value
 * for both was what made MID-AIR / WHAT A read as small-caps.
 */
export function layoutLine(faces, text, o) {
  const face = o.face || 'blitz-brush';
  const capH = o.capH;
  const size = capH / capRatioOf(faces, face);
  const track = (o.tracking || 0) * capH;
  const jit = o.jitter === undefined ? 1 : o.jitter;
  const minor = o.minor === undefined ? 0.885 : o.minor;
  const xs = o.xScale === undefined ? 1.12 : o.xScale;
  const faceSlant = o.slant === undefined ? slantOfFace(faces, face) : o.slant;
  const drawSlant = faceSlant / xs;      // widening will multiply it straight back
  const s = String(text);
  const n = s.length;
  const rng = makeRng(hash(seedFromString('sc.line|' + s + '|' + face), Math.round(capH * 4)));

  const scales = new Array(n);
  let seenFirst = false;
  for (let i = 0; i < n; i++) {
    const ch = s[i];
    if (ch === ' ') { scales[i] = 1; continue; }
    let sc;
    if (!seenFirst) { sc = 1.0; seenFirst = true; }
    else if (ch === '!' || ch === '?') sc = o.excl === undefined ? 1.0 : o.excl;
    else sc = minor;
    sc *= 1 + rng.range(-0.022, 0.022) * jit;
    scales[i] = sc;
  }

  const adv = new Array(n);
  for (let i = 0; i < n; i++) adv[i] = advOf(faces, s[i], face, size);

  const glyphs = [];
  let x = 0, top = 0, bot = 0;
  for (let i = 0; i < n; i++) {
    const dy = rng.range(-0.026, 0.026) * capH * jit;
    const rot = rng.range(-0.019, 0.019) * jit;
    glyphs.push({ ch: s[i], x, s: scales[i], dy, rot, adv: adv[i] });
    // Generous: the face pulls a brush hair off every chisel terminal, and step 3 below
    // hangs filaments up to 0.42 cap under the baseline.
    top = Math.min(top, dy - capH * scales[i] * 1.26);
    bot = Math.max(bot, dy + capH * scales[i] * 0.52);
    let step = adv[i] * scales[i];
    if (i < n - 1) {
      let pair;
      try { pair = faces.measure(s[i] + s[i + 1], face, size, { tracking: 0 }).w; } catch (e) { pair = adv[i] + adv[i + 1]; }
      step += (pair - adv[i] - adv[i + 1]) * Math.min(scales[i], scales[i + 1]);
      step += track;
    }
    x += step;
  }

  return { glyphs, width: x * xs, size, capH, face, top, bot, xScale: xs, drawSlant, slant: faceSlant };
}

/** All glyphs of a laid-out line as one Path2D, origin = baseline at x = 0. */
export function linePath(faces, L) {
  const P = new Path2D();
  const xs = L.xScale === undefined ? 1 : L.xScale;
  for (let i = 0; i < L.glyphs.length; i++) {
    const g = L.glyphs[i];
    if (g.ch === ' ') continue;
    let gp = null;
    try { gp = faces.path(g.ch, L.face, L.size, { tracking: 0, slant: L.drawSlant }); } catch (e) { gp = null; }
    if (!gp) continue;
    const co = Math.cos(g.rot), si = Math.sin(g.rot), sc = g.s;
    // Horizontal scale is applied in LINE space (post-rotation), so it widens the
    // letterform without shearing the baseline bounce.
    P.addPath(gp, {
      a: xs * sc * co, b: sc * si,
      c: -xs * sc * si, d: sc * co,
      e: xs * g.x, f: g.dy,
    });
  }
  return P;
}

/* ------------------------------------------------------------------ paint */

const RING8 = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [0.72, 0.72], [-0.72, 0.72], [0.72, -0.72], [-0.72, -0.72],
];

/**
 * paintLine(target, faces, spec)
 * `spec.x` is the line's CENTRE, `spec.y` its BASELINE, in target space.
 */
export function paintLine(target, faces, spec) {
  const capH = spec.capH;
  const L = spec.layout || layoutLine(faces, spec.text, spec);
  const P = spec.path || linePath(faces, L);
  const slant = L.slant === undefined ? 0.27 : L.slant;
  const key = spec.rampKey || 'white';
  const seed = hash(seedFromString('sc.ink|' + spec.text), Math.round(capH * 8), spec.seed | 0);
  const rng = makeRng(seed);

  const pad = Math.ceil(capH * 0.55);
  const y0 = L.top, y1 = L.bot;
  const W = Math.ceil(L.width + pad * 2);
  const H = Math.ceil((y1 - y0) + pad * 2);
  const ox = pad, oy = pad - y0;
  const bx0 = -pad * 0.9, bx1 = L.width + pad * 0.9;
  const ax = spec.x - L.width * 0.5;
  const dx = ax - ox, dy = spec.y - oy;

  /* --------------------------------------------------- 1. the silhouette */
  const S = scratch(0, W, H);
  S.ctx.setTransform(1, 0, 0, 1, ox, oy);
  S.ctx.fillStyle = '#fff';
  S.ctx.fill(P);

  /* ---------------------------------------------------- 2. x-only erosion */
  let M = S;
  const ex = Math.round((spec.slimX || 0) * capH);
  if (ex >= 1) {
    const E = scratch(1, W, H);
    E.ctx.drawImage(S.cv, 0, 0);
    E.ctx.globalCompositeOperation = 'destination-in';
    E.ctx.drawImage(S.cv, ex, 0);
    E.ctx.drawImage(S.cv, -ex, 0);
    M = E;
  }

  /* ------------------------------------------------- 3. frayed terminals */
  // Direction the paint runs off a terminal: mostly gravity, leaning back along the
  // brush axis. The bar's filaments hang from every downward-facing stroke end.
  const fx = -slant * 0.5, fy = 1;

  function fringe(steps, stepLen, spacing, wMin, wMax, fadeAt, alpha) {
    const T = scratch(2, W, H);
    for (let k = 1; k <= steps; k++) {
      T.ctx.drawImage(M.cv, fx * stepLen * capH * k, fy * stepLen * capH * k);
    }
    T.ctx.globalCompositeOperation = 'destination-out';
    T.ctx.drawImage(M.cv, 0, 0);

    // comb: hairlines parallel to the run direction
    const C = scratch(3, W, H);
    C.ctx.setTransform(1, 0, 0, 1, ox, oy);
    C.ctx.strokeStyle = '#fff';
    C.ctx.lineCap = 'butt';
    const yA = y0 - capH * 0.1, yB = y1 + capH * 0.1;
    let x = bx0;
    while (x < bx1) {
      C.ctx.lineWidth = capH * (wMin + rng() * (wMax - wMin));
      C.ctx.beginPath();
      C.ctx.moveTo(x, yA);
      C.ctx.lineTo(x + fx * (yB - yA), yB);
      C.ctx.stroke();
      x += capH * spacing * (0.55 + rng() * 0.9);
    }
    // and only from the lower part of a glyph — a curtain under every horizontal edge
    // would be wrong; paint runs off the FEET.
    C.ctx.globalCompositeOperation = 'destination-in';
    const vg = C.ctx.createLinearGradient(0, -capH * fadeAt, 0, -capH * (fadeAt - 0.42));
    vg.addColorStop(0, 'rgba(255,255,255,0)');
    vg.addColorStop(1, 'rgba(255,255,255,1)');
    C.ctx.fillStyle = vg;
    C.ctx.fillRect(bx0, yA, bx1 - bx0, yB - yA);

    T.ctx.setTransform(1, 0, 0, 1, 0, 0);
    T.ctx.globalCompositeOperation = 'destination-in';
    T.ctx.drawImage(C.cv, 0, 0);

    M.ctx.setTransform(1, 0, 0, 1, 0, 0);
    M.ctx.globalCompositeOperation = 'source-over';
    M.ctx.globalAlpha = alpha;
    M.ctx.drawImage(T.cv, 0, 0);
    M.ctx.globalAlpha = 1;
  }

  const fr = spec.fray === undefined ? 1 : spec.fray;
  if (fr > 0) {
    fringe(2, 0.055 * fr, 0.052, 0.011, 0.024, 0.62, 1.0);      // dense short fringe
    fringe(5, 0.072 * fr, 0.240, 0.006, 0.014, 0.80, 0.92);     // a few long filaments
  }

  /* ------------------------------------------------------------ 4. the ink */
  const INK = scratch(4, W, H);
  INK.ctx.setTransform(1, 0, 0, 1, ox, oy);
  INK.ctx.fillStyle = spec.fillStyle || ramp(INK.ctx, key, y0 * 0.90, capH * 0.10);
  INK.ctx.fillRect(bx0, y0 - capH * 0.4, bx1 - bx0, (y1 - y0) + capH * 0.8);

  /* --------------------------------------------------------- 5. dry brush */
  const grain = spec.grain === undefined ? 0.10 : spec.grain;
  if (grain > 0) {
    INK.ctx.lineCap = 'butt';
    const n = Math.round(5 + (L.width / capH) * 3.2);
    for (let i = 0; i < n; i++) {
      const gx = bx0 + rng() * (bx1 - bx0);
      const gy = y0 + rng() * (y1 - y0);
      const len = capH * (0.5 + rng() * 1.0);
      INK.ctx.lineWidth = capH * (0.004 + rng() * rng() * 0.012);
      INK.ctx.strokeStyle = rng() < 0.5
        ? `rgba(28,16,14,${(0.05 + rng() * 0.10) * grain * 3})`
        : `rgba(255,250,238,${(0.05 + rng() * 0.12) * grain * 3})`;
      INK.ctx.beginPath();
      INK.ctx.moveTo(gx + len * slant * 0.5, gy - len * 0.5);
      INK.ctx.lineTo(gx - len * slant * 0.5, gy + len * 0.5);
      INK.ctx.stroke();
    }
  }
  if (spec.sweep) {
    INK.ctx.save();
    INK.ctx.globalCompositeOperation = 'lighter';
    const cx = L.width * (spec.sweep.at === undefined ? 0.32 : spec.sweep.at);
    const wdt = capH * (spec.sweep.w === undefined ? 0.9 : spec.sweep.w);
    INK.ctx.translate(cx, 0);
    INK.ctx.rotate(-Math.atan(slant) - 0.05);
    const sg = INK.ctx.createLinearGradient(-wdt, 0, wdt, 0);
    sg.addColorStop(0, 'rgba(255,255,255,0)');
    sg.addColorStop(0.5, `rgba(255,248,226,${spec.sweep.a === undefined ? 0.05 : spec.sweep.a})`);
    sg.addColorStop(1, 'rgba(255,255,255,0)');
    INK.ctx.fillStyle = sg;
    INK.ctx.fillRect(-wdt, -capH * 3, wdt * 2, capH * 6);
    INK.ctx.restore();
  }
  INK.ctx.setTransform(1, 0, 0, 1, 0, 0);
  INK.ctx.globalCompositeOperation = 'destination-in';
  INK.ctx.drawImage(M.cv, 0, 0);

  /* ------------------------------------------------ 6. shadow at 1/4 res */
  const q = 0.26;
  const sw = Math.max(6, Math.round(W * q)), sh = Math.max(6, Math.round(H * q));
  const A = scratch(5, sw, sh);
  A.ctx.drawImage(M.cv, 0, 0, W, H, 0, 0, sw, sh);
  A.ctx.globalCompositeOperation = 'source-in';
  A.ctx.fillStyle = `rgb(${SHADOW_RGB})`;
  A.ctx.fillRect(0, 0, sw, sh);

  const shA = spec.shadow === undefined ? 1 : spec.shadow;
  if (shA > 0) {
    const haA = spec.halo === undefined ? 1 : spec.halo;
    if (haA > 0) {
      const Bh = scratch(6, sw, sh);
      Bh.ctx.filter = `blur(${Math.max(1, capH * 0.34 * q).toFixed(2)}px)`;
      Bh.ctx.drawImage(A.cv, 0, 0, sw, sh, 0, 0, sw, sh);
      target.save();
      target.globalAlpha = 0.40 * haA;
      target.drawImage(Bh.cv, 0, 0, sw, sh, dx + capH * 0.02, dy + capH * 0.10, W, H);
      target.drawImage(Bh.cv, 0, 0, sw, sh, dx + capH * 0.02, dy + capH * 0.10, W, H);
      target.restore();
    }
    const Bt = scratch(7, sw, sh);
    Bt.ctx.filter = `blur(${Math.max(0.8, capH * 0.055 * q).toFixed(2)}px)`;
    Bt.ctx.drawImage(A.cv, 0, 0, sw, sh, 0, 0, sw, sh);
    target.save();
    target.globalAlpha = 0.86 * shA;
    target.drawImage(Bt.cv, 0, 0, sw, sh, dx + capH * 0.032, dy + capH * 0.078, W, H);
    target.drawImage(Bt.cv, 0, 0, sw, sh, dx + capH * 0.032, dy + capH * 0.078, W, H);
    target.restore();
  }

  /* ---------------------------------------------------------- 7. keyline */
  // Only the gold numerals carry one. The bar's MURDER! and TRUCK! have no outline at
  // all — the dark edge round them is the shadow, and drawing a real keyline under
  // white ink is what made round 1 read as a bevelled font.
  const keyOut = spec.keyOut === undefined ? 0 : spec.keyOut;
  if (keyOut > 0) {
    const r = Math.max(1, capH * keyOut);
    const K = scratch(8, W, H);
    for (let i = 0; i < RING8.length; i++) K.ctx.drawImage(M.cv, RING8[i][0] * r, RING8[i][1] * r);
    K.ctx.globalCompositeOperation = 'source-in';
    K.ctx.fillStyle = spec.keylineColor || OUTLINE;
    K.ctx.fillRect(0, 0, W, H);
    target.drawImage(K.cv, dx, dy);
  }

  /* ------------------------------------------------------------- 8. glow */
  if (spec.glow) {
    const G = scratch(6, sw, sh);
    G.ctx.drawImage(M.cv, 0, 0, W, H, 0, 0, sw, sh);
    G.ctx.globalCompositeOperation = 'source-in';
    G.ctx.fillStyle = spec.glow.color;
    G.ctx.fillRect(0, 0, sw, sh);
    const G2 = scratch(7, sw, sh);
    G2.ctx.filter = `blur(${Math.max(1, capH * (spec.glow.blur === undefined ? 0.24 : spec.glow.blur) * q).toFixed(2)}px)`;
    G2.ctx.drawImage(G.cv, 0, 0, sw, sh, 0, 0, sw, sh);
    target.save();
    target.globalCompositeOperation = 'lighter';
    target.globalAlpha = spec.glow.alpha === undefined ? 0.12 : spec.glow.alpha;
    const reps = spec.glow.reps === undefined ? 1 : spec.glow.reps;
    for (let i = 0; i < reps; i++) target.drawImage(G2.cv, 0, 0, sw, sh, dx, dy, W, H);
    target.restore();
  }

  target.drawImage(INK.cv, dx, dy);
  return L;
}

export default { layoutLine, linePath, paintLine, newCanvas, releaseScratch };
