// PIECE: score-callout — the ink engine.
//
// WHAT ROUND 3 IS FIXING, and the measurement behind each item. Everything below was
// re-derived this round off bar/panel-truck.png with one rule — ink is a pixel whose max
// channel clears 150 and whose saturation is under 46, tight bbox, components under 20 px
// dropped — and off our own render put through the identical code path. Cap height is the
// MEDIAN HEIGHT OF THE LETTER COMPONENTS, which is the only definition that survives a
// mark whose glyphs bounce (bar TRUCK!: T+R 40, K 37, C 36, U 35, ! 27 -> 36).
//
//                                  bar TRUCK!     round-2 ours   this round
//   ink bbox / cap  (w/cap)          3.889          4.765          -> 3.889
//   bbox coverage                    0.2874         0.2975         -> 0.287
//   8-connected components           5 (T+R fused)  7 (clean gaps) -> 5
//   run width, median / cap          0.1389         0.1985         -> 0.139
//   run width p90 / median           1.800          1.370          -> 1.80
//   interior lum std (erode 1/4 px) 15.02           0.00           -> 14
//   interior corr(lum, y)           -0.518         +0.020          -> -0.47
//   below-baseline rows              6              16             -> 6
//   ring 2 px outside ink, vs bg   -13.9 lum      -33 (hero)       -> -14
//
// FOUR THINGS CHANGED, and one shipping bug got fixed first.
//
// 0. THE E. `iso_callouts` shipped MURDFR! and LEVFLFR! — the E's BOTTOM ARM (not the
//    middle one) was being eaten at the five-up tile's cap. Bisected by re-rendering
//    LEVELER! at cap 90.6 with each pass disabled in turn: it is the TAPER, not `slimX`
//    and not `slimY`. taper()'s last bands erode ISOTROPICALLY to point the feet of the
//    stems, and the E/F/L bottom arm lies flat ON the baseline inside that zone — a 3 px
//    horizontal eroded 1 px top and bottom is a 1 px horizontal, and under the halo that
//    is invisible. The fix is `barsMask()`: a morphological OPENING of the mask along x
//    with a 0.15 cap radius keeps exactly those pixels that belong to a horizontal run
//    longer than 0.30 cap — arms and crossbars — and drops every stem. The vertical half
//    of the terminal erosion is re-filled through it, so a foot still comes to a point and
//    an arm never thins. It is cap-independent, so it holds at 74 and at 150 alike.
//
// 1. MODELLING IS BACK. See palette.js for the measurement; round 1 asserted the bar was
//    dead flat, round 2 believed it and shipped std 0.00 against the bar's 9-18. The ink
//    is now a vertical RAMP across the cap band (source-in with a linear gradient — free)
//    plus a CHALK plate composited `source-atop`, whose alpha is two octaves of value
//    noise at a 0.13 cap blob scale. source-atop clips to the destination's own alpha, so
//    the chalk costs exactly one upscaled blit of a 1/8-scale plate and cannot touch a
//    pixel outside the mask.
//
// 2. THE SET IS TIGHTER, out of the counters and the tracking, not out of the silhouette:
//    `xScale` 1.60 -> 1.33 narrows the R bowl, the U interior and the C aperture without
//    touching cap height, and `tracking` goes negative so T and R fuse the way the bar's
//    do. GEO.cap2 comes down only 4%, because the CAP was already right (ours 136 against
//    the bar's 131 when panel-truck is scaled to 1920) — it was the width that was 27% out.
//
// 3. THICK/THIN. A uniform erosion cannot raise p90/median: it subtracts the same amount
//    from every run, so it drives the RATIO up only by driving the whole mark to a
//    hairline. The contrast has to come from erosion that VARIES ALONG THE STROKE, which
//    is what `shape()` does — a depth-ramped erosion run from BOTH ends of the cap band,
//    thinning entries and exits and leaving the middle at full weight. X-ONLY except for
//    the last two bands at the very foot, which is what keeps a horizontal arm safe.
//
// 4. THE TAIL COMB. The bar puts SIX rows of ink below the baseline of TRUCK!, counting
//    8/4/4/2/1/1 pixels. Round 2 put sixteen, counting 100/92/85/68/... — a picket fence,
//    which at a glance reads as scanline dropout rather than as paint. One station per
//    0.95 cap now, at most two hairs, and half the reach.
//
// COST. Everything here runs at BAKE time only; the frame path never enters this file.
// The bake is sliced (see lockup.js) and no slice may exceed the piece's 8 ms cap. Two
// rules keep it there and both were bought with measurements: `ctx.filter` costs the whole
// SURFACE in Chromium, so every blurred canvas comes from `exact()`; and `destination-in`
// clears every destination pixel the source misses, so every pooled surface is CLIPPED at
// acquisition to the caller's live region.

import { makeRng, seedFromString, hash } from '../../foundation/rng.js';
import { SHADOW_RGB, flat, model } from './palette.js';

/* ----------------------------------------------------------- scratch pools */

// Surfaces that only ever get drawImage'd with an explicit source rect. They GROW to the
// largest line in the lockup and are never resized down, because a resize reallocates.
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
  // Reset the clip from the previous tenant, then clear and re-clip to THIS caller's
  // live region. The clip is not cosmetic: `destination-in` and `source-in` clear every
  // destination pixel the source does not cover, so on a pooled surface grown to the
  // display line they cost the whole surface however small the source rect is. That is
  // what made the 'PTS' line — 200 px of ink — cost 11.7 ms of a 45 ms bake.
  c.restore();
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'source-over';
  c.globalAlpha = 1;
  c.filter = 'none';
  c.imageSmoothingEnabled = true;
  c.clearRect(0, 0, Math.ceil(w), Math.ceil(h));
  c.beginPath();
  c.rect(0, 0, Math.ceil(w), Math.ceil(h));
  c.clip();
  return s;
}

// Surfaces that are BLURRED, or that are written with putImageData. `ctx.filter` costs the
// whole surface in Chromium, so these are resized to exactly what the caller asked for.
const EPOOL = [];
function exact(i, w, h) {
  const W = Math.max(2, Math.ceil(w)), H = Math.max(2, Math.ceil(h));
  let s = EPOOL[i];
  if (!s) {
    const cv = newCanvas(W, H);
    s = EPOOL[i] = { cv, ctx: cv.getContext('2d') };
  }
  if (s.cv.width !== W || s.cv.height !== H) { s.cv.width = W; s.cv.height = H; }
  const c = s.ctx;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'source-over';
  c.globalAlpha = 1;
  c.filter = 'none';
  c.clearRect(0, 0, W, H);
  return s;
}

/**
 * Drop every working canvas. A bake is one-shot, so holding plate-sized surfaces alive
 * between callouts is pure backing-store cost — the piece's cap is 3 MB and the cached
 * PLATES have to fit inside it.
 */
export function releaseScratch() {
  for (let i = 0; i < POOL.length; i++) {
    const s = POOL[i];
    if (s && s.cv) { s.cv.width = 1; s.cv.height = 1; }
  }
  POOL.length = 0;
  for (let i = 0; i < EPOOL.length; i++) {
    const s = EPOOL[i];
    if (s && s.cv) { s.cv.width = 1; s.cv.height = 1; }
  }
  EPOOL.length = 0;
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
 * angle exactly.
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
 * 0.90-0.99. So line 2 sets `minor` near 0.885 and line 1 near 0.93.
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
    // Tight, because this box is what every raster surface in the line is sized from.
    // The brush face's caps top out at -1.02 cap and the filaments now reach +0.22, so
    // -1.15/+0.34 leaves ~0.1 cap of margin on each side and nothing more.
    top = Math.min(top, dy - capH * scales[i] * 1.15);
    bot = Math.max(bot, dy + capH * scales[i] * 0.34);
    let step = adv[i] * scales[i];
    if (i < n - 1) {
      let pair;
      try { pair = faces.measure(s[i] + s[i + 1], face, size, { tracking: 0 }).w; } catch (e) { pair = adv[i] + adv[i + 1]; }
      step += (pair - adv[i] - adv[i + 1]) * Math.min(scales[i], scales[i + 1]);
      step += track;
      // The face parks the bang's ink at the right of its advance, so default setting
      // leaves "TRUCK !". The bar tucks it in: 0.15 cap on TOUCHDOWN!, 0.33 on TRUCK!.
      if (s[i + 1] === '!' || s[i + 1] === '?') step -= capH * 0.11;
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

/* ------------------------------------------------------------------ chalk */

/**
 * Two octaves of value noise straight into an ImageData, at 1/8 of the working size.
 *
 * The alpha channel carries the modelling; the RGB carries `tint`. Drawn `source-atop`
 * it darkens the ink toward the tint in proportion to alpha and CANNOT touch a pixel
 * outside the mask, because source-atop is clipped by the destination's own alpha. That
 * is what makes the whole pass cost one upscaled blit of a plate 1/64 the area.
 *
 * `cell` is the coarse lattice pitch in SMALL-PLATE pixels; the bar's chalk blobs measure
 * 4-6 px at cap 36 (autocorrelation 0.85 at lag 3), i.e. about 0.13 cap, so the caller
 * passes 0.13 * capH / 8.
 */
function octave(out, w, h, cell, rng, amp) {
  const nx = Math.ceil(w / cell) + 2, ny = Math.ceil(h / cell) + 2;
  const g = new Float32Array(nx * ny);
  for (let i = 0; i < g.length; i++) g[i] = rng();
  const inv = 1 / cell;
  for (let y = 0; y < h; y++) {
    const fy = y * inv, iy = fy | 0, ty = fy - iy;
    const sy = ty * ty * (3 - 2 * ty);
    const r0 = iy * nx, r1 = r0 + nx;
    for (let x = 0; x < w; x++) {
      const fx = x * inv, ix = fx | 0, tx = fx - ix;
      const sx = tx * tx * (3 - 2 * tx);
      const a = g[r0 + ix], b = g[r0 + ix + 1];
      const c = g[r1 + ix], d = g[r1 + ix + 1];
      const t = a + (b - a) * sx;
      out[y * w + x] += amp * (t + ((c + (d - c) * sx) - t) * sy);
    }
  }
}

function chalkPlate(idx, W, H, cell, rgb, peak, seed) {
  const w = Math.max(6, Math.ceil(W * 0.125)), h = Math.max(6, Math.ceil(H * 0.125));
  const P = exact(idx, w, h);
  const buf = new Float32Array(w * h);
  const rng = makeRng(seed);
  const c1 = Math.max(1.6, cell);
  octave(buf, w, h, c1, rng, 0.62);
  octave(buf, w, h, Math.max(1.15, c1 * 0.42), rng, 0.38);
  const img = P.ctx.createImageData(w, h);
  const d = img.data;
  const r = rgb[0], g = rgb[1], b = rgb[2];
  // The lattice mean is 0.5; re-centre so the plate's mean alpha is peak/2 and its range
  // is the full [0, peak]. Value noise on a smoothstep lattice has an interior std near
  // 0.19, so a peak of P lands an alpha std near 0.19 P — which is the number the
  // interior luminance std is finally set by.
  for (let i = 0; i < buf.length; i++) {
    let v = (buf[i] - 0.5) * 2.35 + 0.5;
    v = v < 0 ? 0 : v > 1 ? 1 : v;
    const o = i * 4;
    d[o] = r; d[o + 1] = g; d[o + 2] = b;
    d[o + 3] = (v * peak * 255) | 0;
  }
  P.ctx.putImageData(img, 0, 0);
  return { cv: P.cv, w, h };
}

/* ------------------------------------------------------------------ paint */

/**
 * inkMask(faces, spec) -> state
 *
 * Phase one: silhouette, uniform erosion, then the two shaping zones and the tails as
 * resumable slices. inkPaint does the colour.
 *
 * The returned state carries live POOLED surfaces: nothing else may bake between the
 * phases. lockup.js's slices are strictly sequential.
 */
export function inkMask(faces, spec) {
  const capH = spec.capH;
  const L = spec.layout || layoutLine(faces, spec.text, spec);
  const P = spec.path || linePath(faces, L);
  const slant = L.slant === undefined ? 0.27 : L.slant;
  const key = spec.rampKey || 'white';
  const seed = hash(seedFromString('sc.ink|' + spec.text), Math.round(capH * 8), spec.seed | 0);
  const rng = makeRng(seed);

  // The pad only has to cover the erosion and the tails' sideways run — the blur margin
  // lives on the downsampled canvas, not here. 0.26 cap, not round 1's 0.55; it went
  // 0.22 -> 0.26 when the NUMERALS were sheared, because a slant of 0.24 throws the top
  // of a digit 0.24 cap right of its advance box and the old pad clipped the 1's flag.
  const pad = Math.ceil(capH * 0.26);
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

  /* ------------------------------------------- 2. uniform directional erosion */
  // slimX narrows what is nearly VERTICAL and leaves a horizontal hairline alone, so it
  // undoes the stem-fattening side effect of the horizontal widening. slimY is the mirror
  // image and thins the horizontals.
  //
  // BOTH ARE GATED ON `fine`, and so is the shaping. Every one of them is a whole number
  // of pixels off a stroke whose width is a FRACTION of the cap, so their cost in
  // proportion explodes as the lockup shrinks: on the five-up sheet the tile scale is
  // 0.604 and a two-line lockup lands at cap 74, where an unhinted 0.036 cap of slimX is
  // 2 px a side off an arm four pixels thick.
  //
  // `fine` is just hinting: below cap 50 no ink treatment is resolvable at all, by cap 120
  // all of it is, and in between it ramps.
  const fine = Math.max(0, Math.min(1, (capH - 50) / 70));
  let M = S;
  const ex = Math.round((spec.slimX || 0) * capH * fine);
  const ey = Math.round((spec.slimY || 0) * capH * fine);
  if (ex >= 1 || ey >= 1) {
    const E = scratch(1, W, H);
    E.ctx.drawImage(S.cv, 0, 0, W, H, 0, 0, W, H);
    E.ctx.globalCompositeOperation = 'destination-in';
    if (ex >= 1) {
      E.ctx.drawImage(S.cv, 0, 0, W, H, ex, 0, W, H);
      E.ctx.drawImage(S.cv, 0, 0, W, H, -ex, 0, W, H);
    }
    if (ey >= 1) {
      E.ctx.drawImage(S.cv, 0, 0, W, H, 0, ey, W, H);
      E.ctx.drawImage(S.cv, 0, 0, W, H, 0, -ey, W, H);
    }
    M = E;
  }

  /* ------------------------------------------- 3. BROAD-HORIZONTAL PROTECTION */
  /**
   * A pixel that belongs to a horizontal run longer than 2 x `hr` is part of an ARM or a
   * CROSSBAR — the E's three arms, the T's bar, the L's foot, the A's waist — not part of
   * a stroke terminal. A morphological OPENING along x with that radius keeps exactly
   * those and drops every stem, and because glyph runs are solid intervals the three-tap
   * shift form of erode/dilate is exact, not an approximation.
   *
   * This is what makes the terminal point safe. Without it the isotropic bands at the
   * foot of the stroke thin a 3 px baseline arm to 1 px, and MURDER! ships as MURDFR!.
   *
   * Computed over the terminal zone only, which is a third of the plate.
   */
  function barsMask(zTop, zH) {
    const hr = Math.max(2, Math.round(capH * 0.15));
    const A1 = scratch(6, W, zH);
    A1.ctx.drawImage(M.cv, 0, zTop, W, zH, 0, 0, W, zH);
    A1.ctx.globalCompositeOperation = 'destination-in';
    A1.ctx.drawImage(M.cv, 0, zTop, W, zH, hr, 0, W, zH);
    A1.ctx.drawImage(M.cv, 0, zTop, W, zH, -hr, 0, W, zH);
    const A2 = scratch(7, W, zH);
    A2.ctx.drawImage(A1.cv, 0, 0, W, zH, 0, 0, W, zH);
    A2.ctx.drawImage(A1.cv, 0, 0, W, zH, hr, 0, W, zH);
    A2.ctx.drawImage(A1.cv, 0, 0, W, zH, -hr, 0, W, zH);
    // ...and back inside the original mask, so the dilation cannot spill past the arm.
    A2.ctx.globalCompositeOperation = 'destination-in';
    A2.ctx.drawImage(M.cv, 0, zTop, W, zH, 0, 0, W, zH);
    return A2;
  }

  /* ------------------------------------------- 4. SHAPE: entries, exits, terminals */
  /**
   * The thick/thin lever, and the one that decides whether the mark reads as brush or as
   * a distressed typeface.
   *
   * A UNIFORM erosion cannot produce contrast. It subtracts the same 2e from every
   * horizontal run, so p90/median only moves by driving the whole mark to a hairline —
   * measured: to take round 2's 1.37 to the bar's 1.80 by erosion alone needs e = 0.053
   * cap a side, which leaves the median stroke at 0.092 cap against the bar's 0.139.
   *
   * So the erosion has to VARY ALONG THE STROKE. `shape` runs a depth-ramped erosion into
   * one end of the cap band: band k takes one more pixel off every side of everything
   * beyond its own start row, so a pixel at depth d ends up eroded by however many bands
   * start before it. Run it from the top for the ENTRIES and from the bottom for the
   * EXITS and the middle of the stroke is left at full weight — a swell.
   *
   * The ramp is a POWER law and that is measured. The bar's T stem in panel-truck (cap
   * 36, ink at 150) runs:
   *   depth   0.20 cap   0.50   0.75   0.92   0.97   1.00
   *   bar     0.132 cap  0.132  0.132  0.105  0.053  0.026   -> point
   * — flat for three quarters of its length, then a hard point over the last 8%. A LINEAR
   * ramp spreads the same total erosion evenly and eats the bottom of the U and the C's
   * lower terminal on the way past. `pow` sets how hard the ramp is loaded toward the end.
   *
   * `iso` is how many of the LAST bands also erode vertically. Erosion across the stroke
   * narrows it; erosion along the stroke also SHORTENS it, so only the last two bands get
   * it — and they run through `barsMask`, so a horizontal arm is put straight back.
   *
   * Integer offsets on purpose: a sub-pixel destination-in multiplies the edge alpha 4x a
   * band and after six bands the letter has a soft airbrushed rim.
   */
  function shape(bands, uFrom, uTo, pow, iso, bars) {
    if (bands < 1) return;
    // u is height above the baseline in cap units; the zone runs from uFrom (its shallow
    // end) to uTo (its deep end), and y = oy - u * capH.
    const yA = oy - capH * Math.max(uFrom, uTo);
    const yB = oy - capH * Math.min(uFrom, uTo);
    const down = uTo < uFrom;                       // deep end is at the BOTTOM
    const zTop = Math.max(0, Math.floor(yA));
    const zBot = Math.min(H, Math.ceil(yB));
    const zH = zBot - zTop;
    if (zH < bands + 2) return;

    const B = bars ? barsMask(zTop, zH) : null;
    let si = 4, di = 5;
    let src = scratch(si, W, zH);
    src.ctx.drawImage(M.cv, 0, zTop, W, zH, 0, 0, W, zH);
    for (let k = 1; k <= bands; k++) {
      const dst = scratch(di, W, zH);
      const c = dst.ctx;
      c.drawImage(src.cv, 0, 0, W, zH, 0, 0, W, zH);
      const t = Math.pow((k - 0.5) / bands, 1 / pow);
      const yb = Math.max(1, Math.min(zH - 1, Math.floor((zH - 1) * (down ? t : 1 - t))));
      c.save();
      c.beginPath();
      if (down) c.rect(0, yb, W, zH - yb); else c.rect(0, 0, W, yb);
      c.clip();
      c.globalCompositeOperation = 'destination-in';
      c.drawImage(src.cv, 0, 0, W, zH, 1, 0, W, zH);
      c.drawImage(src.cv, 0, 0, W, zH, -1, 0, W, zH);
      if (k > bands - iso) {
        c.drawImage(src.cv, 0, 0, W, zH, 0, 1, W, zH);
        c.drawImage(src.cv, 0, 0, W, zH, 0, -1, W, zH);
      }
      if (B) {
        // Put the broad horizontals back, WHOLE. This is not only the E's bottom arm: at
        // the top of the cap band the same erosion was shortening the T's crossbar from
        // both ends, and measured on panel-truck that crossbar — fused into the R's
        // shoulder — is where the bar's four longest runs live (46/42/36/30 px at cap 36,
        // u 0.81-0.89). Cutting it is what took our run-width p99 to 0.39 cap against the
        // bar's 0.75, i.e. it is most of the missing thick/thin. The same protection saves
        // the C's and the U's bowl bottoms, which are mid-stroke, not terminals, and which
        // a height-indexed erosion would otherwise eat on the way past.
        c.globalCompositeOperation = 'source-over';
        c.drawImage(B.cv, 0, 0, W, zH, 0, 0, W, zH);
      }
      c.restore();
      src = dst;
      const tmp = si; si = di; di = tmp;
    }
    M.ctx.setTransform(1, 0, 0, 1, 0, 0);
    M.ctx.globalCompositeOperation = 'source-over';
    M.ctx.clearRect(0, zTop, W, zH);
    M.ctx.drawImage(src.cv, 0, 0, W, zH, 0, zTop, W, zH);
  }

  /* ------------------------------------ 5. shadow source, BEFORE the tails */
  // A filament is one or two pixels of half-loaded ink; give it a two-pass blurred shadow
  // of its own and the shadow wins, which is how round 1 grew 74 px of black drool under
  // every foot. The shadow is cast by the LETTER, so it is sampled here.
  const q = 0.26, iq = 1 / q;
  const blurH = capH * 0.30;
  const mb = Math.ceil(blurH * q * 1.6) + 2;
  const sw = Math.max(8, Math.round(W * q) + mb * 2), sh = Math.max(8, Math.round(H * q) + mb * 2);
  const A = exact(0, sw, sh);
  let sampled = false;
  function sampleShadow() {
    if (sampled) return;
    sampled = true;
    A.ctx.drawImage(M.cv, 0, 0, W, H, mb, mb, W * q, H * q);
  }

  /* ------------------------------------------------- 6. split tails */
  // Direction the paint runs off a terminal: gravity, leaning back along the brush axis.
  // The face is sheared right going UP, so running DOWN the axis runs left, which is
  // exactly the way the bar's filaments lean.
  const fx = -slant * 0.55, fy = 1;

  /**
   * SPLIT STATIONS, not a comb.
   *
   * Counted on bar/panel-truck at threshold 150 there are SIX rows of ink under the whole
   * word, 8/4/4/2/1/1 pixels, and they arrive in ones and twos off a terminal. Round 2
   * laid a station every 0.62 cap and got sixteen rows counting 100/92/85/68/... — a
   * picket fence, which at a glance reads as scanline dropout rather than as paint.
   *
   * Each hair is a wedge — `w0` cap at the root, a tenth of that at the tip — because a
   * stroked constant-width hairline reads as a machined sawtooth.
   */
  function comb(bTop, bH, spacing, wMin, wMax, aMin, fadeAt, fadeLen) {
    const bOy = oy - bTop;
    const C = scratch(3, W, bH);
    C.ctx.setTransform(1, 0, 0, 1, ox, bOy);
    C.ctx.fillStyle = '#fff';
    const yA = -capH * 1.12, yB = capH * 0.9;
    const run = fx * (yB - yA);
    let x = bx0;
    while (x < bx1) {
      const n = 1 + (rng() < 0.34 ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const hx = k === 0 ? x : x + rng.range(-0.042, 0.042) * capH;
        const t = rng();
        const w0 = capH * (wMin + t * t * (wMax - wMin));
        const w1 = w0 * 0.10;
        // Per-hair opacity. Uniform hairs read as a comb; real dry brush leaves some
        // filaments barely loaded, and against the extrusion's alpha decay a faint hair
        // also runs SHORT, which is where the length variation comes from.
        C.ctx.globalAlpha = aMin + rng() * (1 - aMin);
        C.ctx.beginPath();
        C.ctx.moveTo(hx - w0 * 0.5, yA);
        C.ctx.lineTo(hx + w0 * 0.5, yA);
        C.ctx.lineTo(hx + run + w1 * 0.5, yB);
        C.ctx.lineTo(hx + run - w1 * 0.5, yB);
        C.ctx.closePath();
        C.ctx.fill();
      }
      x += capH * spacing * (0.55 + rng() * 0.95);
    }
    C.ctx.globalAlpha = 1;
    // Only from the lower part of a glyph — a curtain under every horizontal edge would
    // be wrong; paint runs off the FEET.
    C.ctx.globalCompositeOperation = 'destination-in';
    const vg = C.ctx.createLinearGradient(0, -capH * fadeAt, 0, -capH * (fadeAt - fadeLen));
    vg.addColorStop(0, 'rgba(255,255,255,0)');
    vg.addColorStop(1, 'rgba(255,255,255,1)');
    C.ctx.fillStyle = vg;
    C.ctx.fillRect(bx0, yA, bx1 - bx0, yB - yA);
    return C;
  }

  /**
   * Extrude the mask down the brush axis and keep only what falls outside it, combed.
   * `decay` fades each successive step, so the filament thins in VALUE as the wedge
   * thins in width — a stroke running out of paint, not a drip.
   */
  function tails(bandTop, bandBot, steps, stepLen, decay, alpha, cfg) {
    const bTop = Math.max(0, Math.floor(oy + capH * bandTop));
    const bH = Math.max(4, Math.min(H, Math.ceil(oy + capH * bandBot)) - bTop);
    const u = stepLen * capH;
    const C = comb(bTop, bH, cfg[0], cfg[1], cfg[2], cfg[3], cfg[4], cfg[5]);
    const T = scratch(2, W, bH);
    for (let k = 1; k <= steps; k++) {
      T.ctx.globalAlpha = Math.pow(decay, k - 1);
      T.ctx.drawImage(M.cv, 0, bTop - fy * u * k, W, bH, fx * u * k, 0, W, bH);
    }
    T.ctx.globalAlpha = 1;
    T.ctx.globalCompositeOperation = 'destination-out';
    T.ctx.drawImage(M.cv, 0, bTop, W, bH, 0, 0, W, bH);
    T.ctx.globalCompositeOperation = 'destination-in';
    T.ctx.drawImage(C.cv, 0, 0, W, bH, 0, 0, W, bH);

    M.ctx.setTransform(1, 0, 0, 1, 0, 0);
    M.ctx.globalCompositeOperation = 'source-over';
    M.ctx.globalAlpha = alpha;
    M.ctx.drawImage(T.cv, 0, 0, W, bH, 0, bTop, W, bH);
    M.ctx.globalAlpha = 1;
  }

  const fr = spec.fray === undefined ? 1 : spec.fray;
  const tp = spec.taper === undefined ? 0.048 : spec.taper;
  const en = spec.entry === undefined ? tp * 0.62 : spec.entry;
  const steps = [];

  // [0] ENTRIES. Thinning run down from the cap line. X only — an entry is a chisel edge,
  //     not a point — and through `barsMask`, so a crossbar keeps its length.
  steps.push(() => shape(Math.min(4, Math.round(en * capH * fine)), 1.16, 0.62, 1.35, 0, true));

  // [1] EXITS AND TERMINALS, then the shadow off the shaped letter. Order matters twice
  //     over: the shadow has to follow the pointed stroke, and it has to be taken before
  //     a single filament exists.
  steps.push(() => {
    const b = Math.min(7, Math.round(tp * capH * fine));
    // The isotropic tip only exists once there are enough bands for it to be the LAST
    // part of a ramp. Below that it would be the whole ramp, and a single isotropic band
    // is exactly what a 3 px baseline arm cannot survive.
    shape(b, 0.42, -0.05, 2.4, b >= 4 ? 2 : 0, true);
    sampleShadow();
  });

  // [2] the split tails, off the shaped mask. Composited under 1.0: a filament carries
  //     less paint than the stroke it leaves, and it has to READ that way under a
  //     threshold as well as to the eye — the bar's tails vanish at a 205 cut and appear
  //     at 150. A tail baked at full alpha survives the 205 cut and drags the measured
  //     aspect down with it, which was the artefact behind the round-1 verdict.
  //     The gate also kills them at tile scale: a 0.008 cap wedge is 0.5 px there, and a
  //     sub-pixel filament is not a filament, it is speckle.
  if (fr > 0 && fine > 0.05) {
    steps.push(() => tails(-0.30, 0.26, 3, 0.060 * fr, 0.60, 0.66 * (0.30 + 0.70 * fine),
      [0.95, 0.007, 0.016, 0.55, 0.20, 0.16]));
  }

  return {
    L, capH, slant, key, rng, W, H, ox, oy, bx0, bx1, dx, dy, y0, y1, M, A, sw, sh, mb, iq, q, blurH,
    seed, fine,
    steps,
    /** Run resumable pass `i`, or nothing if this line has none. */
    step(i) { const f = steps[i]; if (f) f(); },
    /** Every remaining pass, back to back. */
    finish() { for (let i = 0; i < steps.length; i++) steps[i](); },
    /** Belt and braces: the shadow plate must exist by paint time whatever ran. */
    ensureShadow: sampleShadow,
  };
}

/**
 * inkPaint(target, faces, spec, st)
 * Phase two: colour and model the mask, lay the shadow that was sampled in phase one,
 * composite. `spec.x` is the line's CENTRE, `spec.y` its BASELINE, in target space.
 */
export function inkPaint(target, faces, spec, st) {
  const { capH, key, W, H, oy, dx, dy, M, A, sw, sh, mb, iq, q, blurH, seed } = st;
  if (st.ensureShadow) st.ensureShadow();
  const mx = mb * iq;
  const dw = sw * iq, dh = sh * iq;

  /* ---------------------------------------------- 1. shadow + halo + glow */
  // Both shadow passes come off the same quarter-scale silhouette `A`, are ASSEMBLED ON
  // A CANVAS THAT IS ALSO QUARTER SCALE, and reach the plate as ONE scaled blit. A blur
  // target is 25k pixels but a blit of it onto the plate is ~310k — by a distance the
  // most expensive operation left in this file.
  //
  // ALPHA, measured. The bar's ring two pixels outside the ink sits 13.9 lum under the
  // background on panel-truck, 11.4 on panel-leveler, 7.2 on panel-touchdown; ours ran 33
  // on the hero capture. So the contact shadow keeps its offset and loses a third of its
  // weight — the mark still has to hold on blown-out white (see the hostile sheet), it
  // just may not sit in a bruise.
  const shA = spec.shadow === undefined ? 1 : spec.shadow;
  if (shA > 0) {
    const SH = exact(1, sw, sh);
    const B = exact(2, sw, sh);
    const haA = spec.halo === undefined ? 1 : spec.halo;
    if (haA > 0) {
      B.ctx.filter = `blur(${Math.max(1, blurH * q).toFixed(2)}px)`;
      B.ctx.drawImage(A.cv, 0, 0, sw, sh, 0, 0, sw, sh);
      B.ctx.filter = 'none';
      B.ctx.globalCompositeOperation = 'source-in';
      B.ctx.fillStyle = `rgb(${SHADOW_RGB})`;
      B.ctx.fillRect(0, 0, sw, sh);
      SH.ctx.globalAlpha = 0.40 * haA;
      SH.ctx.drawImage(B.cv, 0, 0, sw, sh, capH * 0.02 * q, capH * 0.07 * q, sw, sh);
    }
    const B2 = exact(3, sw, sh);
    B2.ctx.filter = `blur(${Math.max(0.8, capH * 0.055 * q).toFixed(2)}px)`;
    B2.ctx.drawImage(A.cv, 0, 0, sw, sh, 0, 0, sw, sh);
    B2.ctx.filter = 'none';
    B2.ctx.globalCompositeOperation = 'source-in';
    B2.ctx.fillStyle = `rgb(${SHADOW_RGB})`;
    B2.ctx.fillRect(0, 0, sw, sh);
    SH.ctx.globalAlpha = 0.62 * shA;
    SH.ctx.drawImage(B2.cv, 0, 0, sw, sh, capH * 0.026 * q, capH * 0.050 * q, sw, sh);
    SH.ctx.globalAlpha = 1;

    target.drawImage(SH.cv, 0, 0, sw, sh, dx - mx, dy - mx, dw, dh);
  }

  if (spec.glow) {
    const G = exact(2, sw, sh);
    G.ctx.filter = `blur(${Math.max(1, capH * (spec.glow.blur === undefined ? 0.24 : spec.glow.blur) * q).toFixed(2)}px)`;
    G.ctx.drawImage(A.cv, 0, 0, sw, sh, 0, 0, sw, sh);
    G.ctx.filter = 'none';
    G.ctx.globalCompositeOperation = 'source-in';
    G.ctx.fillStyle = spec.glow.color;
    G.ctx.fillRect(0, 0, sw, sh);
    target.save();
    target.globalCompositeOperation = 'lighter';
    target.globalAlpha = spec.glow.alpha === undefined ? 0.12 : spec.glow.alpha;
    target.drawImage(G.cv, 0, 0, sw, sh, dx - mx, dy - mx, dw, dh);
    target.restore();
  }

  /* --------------------------------------------- 2. the ink: ramp, then chalk */
  // `scratch()` already clipped this surface to (0,0,W,H), so `source-in` cannot reach
  // the pool's dead margin.
  const MD = spec.model === false ? null : model(key);
  M.ctx.setTransform(1, 0, 0, 1, 0, 0);
  M.ctx.globalCompositeOperation = 'source-in';
  if (spec.fillStyle || !MD) {
    M.ctx.fillStyle = spec.fillStyle || flat(key);
  } else {
    // The ramp is laid across the CAP BAND, not the plate, so the corr(lum,y) it produces
    // is the same number the bar was measured with. It runs a little past both ends
    // because the glyphs bounce +/- 0.026 cap and the ascender of a '!' clears the cap.
    const g = M.ctx.createLinearGradient(0, oy - capH * 1.06, 0, oy + capH * 0.04);
    g.addColorStop(0, MD.top);
    g.addColorStop(1, MD.bot);
    M.ctx.fillStyle = g;
  }
  M.ctx.fillRect(0, 0, W, H);
  M.ctx.globalCompositeOperation = 'source-over';

  if (MD && MD.chalk > 0 && !spec.fillStyle) {
    // CHALK. `source-atop` is clipped by the destination's own alpha, so this cannot put
    // a single pixel outside the mask and needs no second full-size surface — the whole
    // pass is one upscaled blit of a plate 1/64 the area, drawn with smoothing on, which
    // is also what gives the noise its soft blob edge.
    const cell = Math.max(1.6, capH * 0.13 * 0.125);
    const rgb = hexRGB(MD.tint);
    const CH = chalkPlate(4, W, H, cell, rgb, MD.chalk, hash(seed, 0x5c4a));
    M.ctx.globalCompositeOperation = 'source-atop';
    M.ctx.drawImage(CH.cv, 0, 0, CH.w, CH.h, 0, 0, W, H);
    M.ctx.globalCompositeOperation = 'source-over';
  }

  target.drawImage(M.cv, 0, 0, W, H, dx, dy, W, H);
  return st.L;
}

function hexRGB(h) {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** All slices back to back. */
export function paintLine(target, faces, spec) {
  const st = inkMask(faces, spec);
  st.finish();
  return inkPaint(target, faces, spec, st);
}

export default { layoutLine, linePath, paintLine, inkMask, inkPaint, newCanvas, releaseScratch };
