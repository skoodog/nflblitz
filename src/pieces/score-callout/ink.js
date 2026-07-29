// PIECE: score-callout — the ink engine.
//
// EVERY NUMBER BELOW WAS RE-DERIVED THIS ROUND, on both sides, with one rule: ink is a
// pixel whose max channel clears 150 and whose saturation is under 46; components under
// 20 px are dropped; cap height is the MEDIAN LETTER-COMPONENT HEIGHT, which is the only
// definition that survives a mark whose glyphs bounce (bar TRUCK!: T+R 40, K 37, C 36,
// U 35, ! 27 -> 36). Our render is resampled to the bar's cap of 36 and put through the
// identical code, so the two columns are measured, not asserted.
//
// Both marks are TILTED (the bar's TRUCK! by -1.7 deg, ours by -2.5), and a tilt inflates
// the ink box and smears the baseline across several rows, so the table gives both the
// as-captured numbers and the same measurement with each mark de-rotated. The de-rotated
// pair is the fair one; the as-is pair is what a critic gets by thresholding the panels.
//
//                            bar     ours  |  bar de-rot   ours de-rot   round 2
//   ink bbox / cap          3.889   3.556  |    3.917        3.556        4.68
//   ink box height / cap    1.306   1.361  |    1.222        1.194         --
//   bbox coverage          0.2875  0.2513  |   0.3001       0.2871         --
//   letter components           5       5  |        5            5           6
//   run width median / cap 0.1389  0.1389  |   0.1389       0.1389         --
//   run width p90 / median  1.800   1.400  |    1.800        1.400        1.29
//   run width p95/p99/max  12.8/27/46      |  13.0/22.6/45  11.0/15.5/35    --
//   interior lum mean       174.1   185.7  |    174.3        185.3       221.3
//   interior lum std        13.92   13.99  |    14.58        14.14        0.00
//   interior corr(lum,y)   -0.505  -0.466  |   -0.440       -0.499       +0.02
//   ring 2 px out, vs bg    -21.9   -20.3  |    -14.4        -19.0         -33
//   below-baseline rows   8/4/4/2/1/1  15/11/10/7/1/1/1/1 | 14/5    6/7/2/1   9 rows
//
// WHAT IS STILL SHORT, stated plainly: the set is 9% narrow per cap (3.556 against 3.889)
// and p90/median is 1.40 against 1.800. The median run width is exact and p90 is one pixel
// short at cap 36, which is what that ratio is made of.
//
// FIVE THINGS CHANGED. Two of them are bugs, and both were found by looking, not by
// reading numbers off a table.
//
// 0. THE POOL BLED. `scratch()` cleared exactly the caller's live rect, and every finished
//    line is blitted from that rect at a FRACTIONAL destination — so Chromium's resampler
//    reached one texel past it and picked up the previous line's ink off the shared pool.
//    That is what the faint gold rule and dashes under every points line on the five-up
//    sheet were. The clear now runs two pixels wider than the clip. See `scratch`.
//
// 1. THE SWASH — see `swashSource` / `swashGrow`. The bar's whole upper run-width tail is one feature, the
//    T's crossbar running on into the R's shoulder, and no erosion can produce it because
//    erosion only removes. This is the change that carries the thick/thin.
//
// 2. MODELLING, re-measured. See palette.js. Round 1 asserted the bar was dead flat, round
//    2 believed it and shipped interior std 0.00 against the bar's 9-18. The ink is a
//    vertical RAMP across the cap band plus a CHALK plate composited `source-atop`.
//
// 3. THE SHADOW IS A POOL, NOT A RING. The bar still carries 8-17 lum of shadow nine
//    pixels out at cap 36; ours carried 0.5. A blur alone cannot do that — the silhouette
//    has to be GROWN first. See the falloff table in `inkPaint`.
//
// 4. THE SET, THE BOUNCE AND THE TAIL. `xScale` and `jitter` in lockup.js, `tailReach` and
//    friends below. The tail was a 16-row picket fence in round 2 and one row after the
//    in-flight round-3 fix; the bar has six, and they are few but nearly opaque.
//
// AND A WARNING, because this round earned it. A permissive swash matched the bar on
// w/cap, h/cap, coverage, component count, median run width AND p90/median simultaneously
// and rendered a mark that could not be read as TRUCK!. Every setting here was confirmed
// by looking at the rendered word before it was kept.
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
  // CLEAR TWO PIXELS WIDER THAN THE CLIP, and this is a real bug fix, not hygiene.
  //
  // Every finished line is blitted with `drawImage(M.cv, 0,0,W,H, dx,dy,W,H)` and dx/dy are
  // FRACTIONAL — they come from `spec.x - L.width * 0.5`, and a laid-out line width is never
  // an integer. A fractional destination makes Chromium resample, and at the edge of the
  // source rect the sampler reaches one texel PAST it. On a pooled surface that has been
  // grown to the display line, the texel past the points line's live rect still holds the
  // previous line's ink — so the numerals bled a one-pixel gold rule down the right edge of
  // the PTS box and a pair of gold dashes along its bottom, which is what the faint marks
  // under every points line on the five-up sheet actually were.
  //
  // The clip stays at (0,0,w,h) so nothing can DRAW into the margin; the clear just makes
  // the margin transparent so the resampler has nothing to pick up.
  c.clearRect(0, 0, Math.ceil(w) + 2, Math.ceil(h) + 2);
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
  function barsMask(zTop, zH, hrFrac) {
    const hr = Math.max(2, Math.round(capH * (hrFrac || 0.15)));
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

  /* ------------------------------------------- 3b. SWASH: the crossbar flies */
  /**
   * THE SINGLE BIGGEST PIECE OF THE MISSING THICK/THIN, and it is not an erosion at all.
   *
   * Re-measured this round off bar/panel-truck.png at cap 36, one rule both sides
   * (max channel >= 150, saturation <= 46), horizontal run lengths per row:
   *
   *                    p50   p75   p90   p95   p99   max   runs >= 2x median
   *     bar TRUCK!     5.0   6.0   9.0  12.8  27.0    46   31
   *     ours, before   6.0   7.0   8.0  10.0  14.0    17   10
   *
   * The bar's whole upper tail — 46 / 42 / 36 / 30 px, every one of them at u 0.81..0.89,
   * i.e. a fifth of a cap under the cap line — is ONE feature: the T's crossbar running
   * on into the R's shoulder as a single unbroken horizontal band 1.28 cap long. That is
   * also why the bar segments into five components with T and R fused where ours segments
   * into seven with clean gaps. Ours has no run over 0.47 cap anywhere.
   *
   * No amount of erosion can produce that, because erosion only ever REMOVES; and the
   * previous round's attempt to buy the ratio with a uniform slimX is measurable as a
   * straight trade of coverage for ratio — at slimX 0.042 the ratio reaches 1.75 but the
   * median stroke falls to 0.113 cap against the bar's 0.139 and coverage to 0.232
   * against 0.287. The mark goes skeletal, which is the opposite note.
   *
   * So the fix ADDS ink, and only where the bar has it. `barsMask` already isolates
   * exactly the pixels that belong to a horizontal run longer than 0.30 cap — crossbars,
   * arms, the flat apex of a bowl — and drops every stem. Dilating THAT along +x lets a
   * broad stroke fly on to the right the way a loaded brush does, closes the 0.19 cap gap
   * between the T's crossbar and the R, and leaves every stem width untouched.
   *
   * Right only, and only in the top band. Rightward because the face's crossbars are drawn
   * left-to-right and already taper that way (T is c:['chisel','taper']), and because the
   * italic leans the next glyph's top toward the swash rather than away from it. Top band
   * because that is where the bar's fusion is; a baseline arm flying right would bridge
   * feet, which no panel does.
   *
   * Dilation by DOUBLING: shifts of 1, 1, 2, 4, 8... reach R in ceil(log2 R) + 1 draws
   * rather than R of them, and for solid horizontal runs the shift form is exact.
   */
  //
  // TWO SLICES, because on the widest plate this was the tallest pole left in the bake:
  // measured on TOUCHDOWN! (plate 842x523) it ran 6.6 ms of a 35 ms whole-plate bake, more
  // than the ramp, the chalk and the plate blit put together. `swashSource` isolates and
  // cleans the qualifying strokes, `swashGrow` does the dilation and the merge.
  let swZ = null;
  function swashSource(uTop, uBot, hrFrac) {
    const zTop = Math.max(0, Math.floor(oy - capH * uTop));
    const zBot = Math.min(H, Math.ceil(oy - capH * uBot));
    const zH = zBot - zTop;
    if (zH < 4) return;
    const B = barsMask(zTop, zH, hrFrac);
    const src = scratch(8, W, zH);
    // AND IT HAS TO HAVE REAL THICKNESS, not just length. A crossbar tapers, so its last
    // pixels are a single row tall; dilating THOSE along x draws a one-pixel rule running
    // off the letter, and on LEVELER! the E arms produced exactly that — thin horizontal
    // lines reaching to the next glyph, which read as scanlines, not paint. One row of
    // vertical erosion first drops every hairline tip and keeps the body of the stroke.
    const vr = Math.max(1, Math.round(capH * 0.008));
    src.ctx.drawImage(B.cv, 0, 0, W, zH, 0, 0, W, zH);
    src.ctx.globalCompositeOperation = 'destination-in';
    src.ctx.drawImage(B.cv, 0, 0, W, zH, 0, vr, W, zH);
    src.ctx.drawImage(B.cv, 0, 0, W, zH, 0, -vr, W, zH);
    src.ctx.globalCompositeOperation = 'source-over';
    swZ = { zTop, zH };
  }

  function swashGrow(reach) {
    if (!swZ) return;
    const { zTop, zH } = swZ;
    swZ = null;
    const R = Math.round(capH * reach);
    if (R < 1) return;
    let si = 8, di = 9;
    let src = POOL[si];
    let cur = 0;
    while (cur < R) {
      const s = Math.min(cur || 1, R - cur);
      const dst = scratch(di, W, zH);
      dst.ctx.drawImage(src.cv, 0, 0, W, zH, 0, 0, W, zH);
      dst.ctx.drawImage(src.cv, 0, 0, W, zH, s, 0, W, zH);
      src = dst;
      const t = si; si = di; di = t;
      cur += s;
    }
    M.ctx.setTransform(1, 0, 0, 1, 0, 0);
    M.ctx.globalCompositeOperation = 'source-over';
    M.ctx.drawImage(src.cv, 0, 0, W, zH, 0, zTop, W, zH);
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
  const swR = spec.swash === undefined ? 0 : spec.swash;
  const steps = [];

  // [0] THE SWASH. Before every shaping pass, so the extension is part of the letter by
  //     the time `barsMask` protects broad horizontals and the shadow is sampled off it.
  //     NOT gated on `fine`: fusion is a property of the mark at every size — the bar's
  //     own T and R are fused at cap 36 — and a swash that only appears on the hero
  //     capture would be a different letterform on the sheet.
  //     AND IT HAS TO BE NARROW, WHICH COST A ROUND OF LOOKING TO LEARN. A permissive
  //     version of this pass — qualifying radius 0.15 cap, band u 1.02..0.70, reach 0.20
  //     cap, plus a second band at the feet — matched the bar on w/cap, h/cap, coverage,
  //     component count, median run AND p90/median all at once, and rendered an illegible
  //     mark: every letter top qualifies as a broad horizontal, so the extensions chained
  //     T-R-U-C-K into one unbroken bar across the cap line and the counters filled in.
  //     Metrics are a check, not the target.
  //
  //     What the bar actually fuses is ONE pair. Its T crossbar is the only horizontal in
  //     the word longer than half a cap; the tops of U, C and K are 0.3-0.4 cap and stay
  //     separate, with clear gaps. So the qualifying radius goes to 0.26 cap — keeping only
  //     runs over 0.52 cap, which the crossbar clears at 0.73 and nothing else does — the
  //     band narrows to the top eighth of the cap, and the reach is cut to just what closes
  //     the 0.19 cap gap to the R.
  if (swR > 0) {
    steps.push(() => swashSource(1.06, 0.84, spec.swashSel === undefined ? 0.26 : spec.swashSel));
    steps.push(() => swashGrow(swR));
  }

  // [1] ENTRIES. Thinning run down from the cap line. X only — an entry is a chisel edge,
  //     not a point — and through `barsMask`, so a crossbar keeps its length.
  steps.push(() => shape(Math.min(4, Math.round(en * capH * fine)), 1.16, 0.62, 1.35, 0, true));

  // [2] EXITS AND TERMINALS, then the shadow off the shaped letter. Order matters twice
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

  // [2b] THE ARM FLOOR. Measured, not guessed: the bar never lets a horizontal feature
  //      fall below about half a stem, and we were taking them to a sixteenth. On the
  //      callouts sheet at cap 136, per-glyph (median horizontal run = stem, 10th
  //      percentile vertical run = thinnest horizontal):
  //
  //                       stem   thinnest   arm/stem        bar
  //        L              19        2         0.105
  //        E V E L (fused)16        1         0.062        ~0.50
  //        E R !          14        2         0.143
  //
  //      A one-pixel middle arm on an E is not a thin E, it is an F: the sheet rendered
  //      LEVFLER!. Two rounds of texture work could not fix that because it is not a
  //      texture defect — the letterform is wrong, and a mark that spells a different
  //      word fails whatever its ink looks like.
  //
  //      Why the existing protection missed it. `barsMask` restores horizontals whose run
  //      clears 2 * hr, and at the default hrFrac 0.15 that is 0.30 cap. An E arm on this
  //      face measures 0.30-0.35 cap, so it sits ON the qualifying edge and falls through
  //      whenever the shaping lands a band across it; a 0.12 cap stem is comfortably under.
  //      So the discrimination is sound, the threshold was simply too close to the feature
  //      it had to protect.
  //
  //      This pass is ADDITIVE, like the swash, for the reason that section already
  //      records: erosion only ever removes, and the note here is missing mass. It lifts
  //      qualifying horizontals to a floor thickness and leaves everything else alone --
  //      no scale, aspect, interior modelling, colour ramp, shadow or halo is touched,
  //      all of which now measure on the bar and must not move.
  steps.push(() => {
    // Stem width in px, from the face's own metrics rather than a constant, so the floor
    // tracks weight instead of fighting it.
    const stem = Math.max(2, Math.round(capH * 0.139));
    const floorPx = Math.round(stem * (spec.armFloor === undefined ? 0.42 : spec.armFloor));
    if (floorPx < 2) return;
    const zTop = 0, zH = H;
    // hr well clear of the arm it protects (qualifies runs over ~0.17 cap) and still well
    // clear of the stem it must not (0.12 cap), instead of splitting the two at 0.30.
    const B = barsMask(zTop, zH, 0.085);
    const r = Math.max(1, Math.round(floorPx / 2));

    // A floor is max(current, floor), NOT a thickening. Dilating every qualifying
    // horizontal unconditionally is the obvious version and it is wrong: measured, it took
    // arm/stem to 0.60-0.77 against the bar's ~0.50 and added 54% to the word's ink, which
    // would trade a letterform bug for the airy-vs-loaded note two rounds just closed.
    // So isolate the DEFICIENT horizontals first, with a vertical opening: erode across
    // the arm by r and dilate back: anything thicker than 2r survives the round trip, and
    // anything thinner is annihilated.
    const open = scratch(8, W, zH);
    open.ctx.drawImage(B.cv, 0, 0, W, zH, 0, 0, W, zH);
    open.ctx.globalCompositeOperation = 'destination-in';
    for (let k = 1; k <= r; k++) {
      open.ctx.drawImage(B.cv, 0, 0, W, zH, 0, k, W, zH);
      open.ctx.drawImage(B.cv, 0, 0, W, zH, 0, -k, W, zH);
    }
    const thick = scratch(9, W, zH);
    thick.ctx.drawImage(open.cv, 0, 0, W, zH, 0, 0, W, zH);
    for (let k = 1; k <= r; k++) {
      thick.ctx.drawImage(open.cv, 0, 0, W, zH, 0, k, W, zH);
      thick.ctx.drawImage(open.cv, 0, 0, W, zH, 0, -k, W, zH);
    }
    // Thin = qualifying horizontals MINUS the ones already thick enough.
    const thin = scratch(10, W, zH);
    thin.ctx.drawImage(B.cv, 0, 0, W, zH, 0, 0, W, zH);
    thin.ctx.globalCompositeOperation = 'destination-out';
    thin.ctx.drawImage(thick.cv, 0, 0, W, zH, 0, 0, W, zH);

    // Grow ONLY the deficient ones, and only across the arm (+-y). Growing along it would
    // relengthen terminals that step [2] deliberately shortened.
    // Grow by HALF the floor, not the whole floor. A symmetric +-k dilation adds 2k of
    // thickness, so dilating by floorPx lands at 1 + 2*floorPx and overshoots to arm/stem
    // 0.67 -- measured. +-r puts a 1 px arm at 1 + 2r, i.e. the floor itself.
    const G = scratch(11, W, zH);
    G.ctx.drawImage(thin.cv, 0, 0, W, zH, 0, 0, W, zH);
    for (let k = 1; k <= r; k++) {
      G.ctx.drawImage(thin.cv, 0, 0, W, zH, 0, k, W, zH);
      G.ctx.drawImage(thin.cv, 0, 0, W, zH, 0, -k, W, zH);
    }
    M.ctx.globalCompositeOperation = 'source-over';
    M.ctx.drawImage(G.cv, 0, 0, W, zH, 0, zTop, W, zH);
  });

  // [3] the split tails, off the shaped mask. Composited under 1.0: a filament carries
  //     less paint than the stroke it leaves, and it has to READ that way under a
  //     threshold as well as to the eye — the bar's tails vanish at a 205 cut and appear
  //     at 150. A tail baked at full alpha survives the 205 cut and drags the measured
  //     aspect down with it, which was the artefact behind the round-1 verdict.
  //     The gate also kills them at tile scale: a 0.008 cap wedge is 0.5 px there, and a
  //     sub-pixel filament is not a filament, it is speckle.
  //
  //     RE-MEASURED THIS ROUND, because both neighbouring rounds got it wrong in opposite
  //     directions. Ink pixels per row below the baseline, threshold 150, cap 36:
  //
  //       bar panel-truck      8  4  4  2  1  1                     6 rows, 0.167 cap
  //       round 2 (a comb)   100 92 85 68 ...                      16 rows — a picket fence
  //       round 3 in flight    6                                    1 row  — no tail at all
  //
  //     Round 2's fence read as scanline dropout; the in-flight fix deleted it outright and
  //     took the mark's whole bottom edge with it (ink-box h/cap 1.194 against the bar's
  //     1.306). What the bar actually has is a SHORT, FAST-DECAYING tail: half the ink in
  //     the first row, gone by the sixth. `tailReach` is that 0.167 cap and `tailAlpha` is
  //     what keeps the last rows just above the 150 cut rather than well under it.
  //
  //     AND THE REASON THE PREVIOUS SETTINGS PRODUCED NOTHING, which is worth writing down
  //     because it is not obvious: a tail row only COUNTS if it clears the same threshold
  //     the bar was measured at. Over a background at lum ~42 with ink at ~190, a pixel
  //     reaches lum 150 only above mask alpha 0.73. The in-flight settings multiplied a
  //     0.66 line alpha by a 0.60^k decay by a 0.55..1.0 per-hair alpha, so nothing past
  //     the first step could ever clear the cut however far it reached — which is why
  //     sweeping `reach` moved the measured tail by exactly zero rows. The hairs were also
  //     0.007..0.016 cap wide, i.e. a quarter of a pixel at cap 36, so they antialiased
  //     away as well. The bar's tail is the opposite shape: VERY FEW hairs, each of them
  //     nearly opaque and 2-3 px wide at cap 36. Hence wide stations, fat roots, slow decay.
  if (fr > 0 && fine > 0.05) {
    const tR = (spec.tailReach === undefined ? 0.17 : spec.tailReach) * fr;
    const tA = spec.tailAlpha === undefined ? 1.0 : spec.tailAlpha;
    const tD = spec.tailDecay === undefined ? 0.93 : spec.tailDecay;
    const tW = spec.tailW === undefined ? 1 : spec.tailW;
    const tS = spec.tailSpacing === undefined ? 1.30 : spec.tailSpacing;
    // Hair ROOT width, sized from the bar's own pixel counts rather than guessed. Its
    // first tail row carries 8 px of ink across the whole word; two hairs is 4 px each,
    // i.e. 0.11 cap — and the wedge is already half-tapered by the time it crosses the
    // baseline, so the root has to be about twice that again.
    const tN = Math.max(2, Math.min(6, Math.round(tR / 0.034)));
    steps.push(() => tails(-0.30, tR + 0.12, tN, tR / tN, tD, tA * (0.45 + 0.55 * fine),
      [tS, 0.045 * tW, 0.125 * tW, 0.90, 0.20, 0.16]));
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
export function inkPaint(target, faces, spec, st, phase) {
  const { capH, key, W, H, oy, dx, dy, M, A, sw, sh, mb, iq, q, blurH, seed } = st;
  if (st.ensureShadow) st.ensureShadow();
  // SPLIT INTO TWO SLICES. Measured on this box from a cold cache, timing every
  // stepLockup() call: with the shadow assembled and the ink laid in ONE job, TRUCK! at
  // 1:1 peaked at 10.5 ms — over the piece's 8 ms per-call cap — because that job now
  // carries three separate blurs plus the full-plate blit. Phase 1 is the shadow, halo and
  // glow; phase 2 is the ink itself. `phase` undefined runs both, which is what the
  // synchronous `paintLine` path wants.
  // THREE slices, not two. Even split shadow-from-ink the ink job held 6.8-7.8 ms at 1:1
  // for the display line, because it carries a full-plate gradient `source-in`, an
  // upscaled chalk blit and the plate blit. Phase 2 colours the mask in place, phase 3
  // blits it. Both are ~half of what phase 2 alone used to be.
  const doShadow = phase === undefined || phase === 1;
  const doInk = phase === undefined || phase === 2;
  const doChalk = phase === undefined || phase === 3;
  const doBlit = phase === undefined || phase === 4;
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
  if (doShadow && shA > 0) {
    const SH = exact(1, sw, sh);
    const B = exact(2, sw, sh);
    // THE POOL. Measured falloff of the mean luminance in the ring r px outside the ink,
    // against the local background, at matched cap 36:
    //
    //                    r1     r2     r3     r4     r6     r9
    //   bar truck      +19.4  -21.9  -18.0  -16.2  -11.3   -7.9
    //   bar leveler    +16.4  -27.7  -22.3  -22.4  -18.8  -16.7
    //   ours, before   +23.4  -10.6   -4.0   -2.8   -1.4   -0.5
    //
    // Ours did not merely sit light at r2 — it fell off a cliff. The bar still carries 8 to
    // 17 lum of shadow NINE pixels out at cap 36, so what it has is a broad dark pool the
    // lettering sits in, and the single-number "ring at 2 px" the previous rounds argued
    // over was reading the near edge of it. Tightening the contact pass, which is what that
    // number invites, makes the mismatch worse.
    //
    // So the halo is now two blurs rather than one: a MID pass at 0.13 cap, which is the
    // bar's own measured half-life (-21.9 at r2 to -11.3 at r6), carrying most of the
    // weight, and the original 0.30 cap SPREAD behind it for the far field.
    //
    // AND THE THING THAT WAS ACTUALLY MISSING: SPREAD. A blur alone cannot make a heavy
    // wide shadow, it can only make a faint one — blurring a 5 px silhouette (the stroke at
    // the quarter scale these plates work at) by 11 px leaves a peak alpha near 0.18, which
    // is why the 0.30 cap pass was measuring -0.5 lum nine pixels out however hard its
    // alpha was driven. A drop shadow with a broad heavy skirt is a silhouette GROWN and
    // then blurred. So the halo blurs a dilated copy: eight shifted draws on the quarter-
    // scale plate, which is 25k pixels, not the plate's 310k.
    const haA = spec.halo === undefined ? 1 : spec.halo;
    if (haA > 0) {
      const hb = spec.haloBlur === undefined ? 0.13 : spec.haloBlur;
      const sp = Math.max(1, Math.round(capH * (spec.haloSpread === undefined ? 0.075 : spec.haloSpread) * q));
      const SP = exact(6, sw, sh);
      SP.ctx.drawImage(A.cv, 0, 0, sw, sh, 0, 0, sw, sh);
      SP.ctx.drawImage(A.cv, 0, 0, sw, sh, sp, 0, sw, sh);
      SP.ctx.drawImage(A.cv, 0, 0, sw, sh, -sp, 0, sw, sh);
      SP.ctx.drawImage(A.cv, 0, 0, sw, sh, 0, sp, sw, sh);
      SP.ctx.drawImage(A.cv, 0, 0, sw, sh, 0, -sp, sw, sh);
      SP.ctx.drawImage(A.cv, 0, 0, sw, sh, sp, sp, sw, sh);
      SP.ctx.drawImage(A.cv, 0, 0, sw, sh, -sp, sp, sw, sh);
      SP.ctx.drawImage(A.cv, 0, 0, sw, sh, sp, -sp, sw, sh);
      SP.ctx.drawImage(A.cv, 0, 0, sw, sh, -sp, -sp, sw, sh);
      B.ctx.filter = `blur(${Math.max(1, blurH * q).toFixed(2)}px)`;
      B.ctx.drawImage(SP.cv, 0, 0, sw, sh, 0, 0, sw, sh);
      B.ctx.filter = 'none';
      B.ctx.globalCompositeOperation = 'source-in';
      B.ctx.fillStyle = `rgb(${SHADOW_RGB})`;
      B.ctx.fillRect(0, 0, sw, sh);
      SH.ctx.globalAlpha = Math.min(1, 0.32 * haA);
      SH.ctx.drawImage(B.cv, 0, 0, sw, sh, capH * 0.02 * q, capH * 0.07 * q, sw, sh);

      // Slot 5, not 4: 4 is the chalk plate, which is 1/8 scale, and `exact` reallocates
      // whenever the requested size differs from the last tenant's.
      const B3 = exact(5, sw, sh);
      B3.ctx.filter = `blur(${Math.max(1, capH * hb * q).toFixed(2)}px)`;
      B3.ctx.drawImage(SP.cv, 0, 0, sw, sh, 0, 0, sw, sh);
      B3.ctx.filter = 'none';
      B3.ctx.globalCompositeOperation = 'source-in';
      B3.ctx.fillStyle = `rgb(${SHADOW_RGB})`;
      B3.ctx.fillRect(0, 0, sw, sh);
      SH.ctx.globalAlpha = Math.min(1, (spec.haloMid === undefined ? 0.50 : spec.haloMid) * haA);
      SH.ctx.drawImage(B3.cv, 0, 0, sw, sh, capH * 0.012 * q, capH * 0.030 * q, sw, sh);
    }
    // THE CONTACT RING, and it is a ring, not a drop. Measured 2 px outside the ink at
    // matched cap 36 against the local background: bar panel-truck -21.9 lum, panel-leveler
    // -20.8, panel-touchdown -7.1. Round 2 sat at -33 (a bruise); the in-flight round-3 fix
    // over-corrected to -9.3 (no seat at all).
    //
    // Raising the OFFSET pass could not close that gap — measured, an offset shadow at any
    // alpha darkens one side of the ring and leaves the other at background, so the mean
    // over the whole ring saturates near -14 however hard it is driven. What the bar has is
    // a tight shadow that surrounds the letter, so this pass is now drawn TWICE: once
    // un-offset and close in, which seats the mark, and once offset, which throws it.
    const B2 = exact(3, sw, sh);
    B2.ctx.filter = `blur(${Math.max(0.8, capH * 0.042 * q).toFixed(2)}px)`;
    B2.ctx.drawImage(A.cv, 0, 0, sw, sh, 0, 0, sw, sh);
    B2.ctx.filter = 'none';
    B2.ctx.globalCompositeOperation = 'source-in';
    B2.ctx.fillStyle = `rgb(${SHADOW_RGB})`;
    B2.ctx.fillRect(0, 0, sw, sh);
    SH.ctx.globalAlpha = Math.min(1, 0.55 * shA);
    SH.ctx.drawImage(B2.cv, 0, 0, sw, sh, 0, 0, sw, sh);
    SH.ctx.globalAlpha = Math.min(1, 0.62 * shA);
    SH.ctx.drawImage(B2.cv, 0, 0, sw, sh, capH * 0.026 * q, capH * 0.050 * q, sw, sh);
    SH.ctx.globalAlpha = 1;

    target.drawImage(SH.cv, 0, 0, sw, sh, dx - mx, dy - mx, dw, dh);
  }

  if (doShadow && spec.glow) {
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

  if (!doInk && !doChalk && !doBlit) return st.L;

  /* --------------------------------------------- 2. the ink: ramp, then chalk */
  // `scratch()` already clipped this surface to (0,0,W,H), so `source-in` cannot reach
  // the pool's dead margin. Ramp, chalk and blit are three separate slices: each of them
  // touches the whole plate, and on a contended box any one of them alone can approach
  // the piece's 8 ms per-call cap.
  const MD = spec.model === false ? null : model(key);

  if (doInk) {
    M.ctx.setTransform(1, 0, 0, 1, 0, 0);
    M.ctx.globalCompositeOperation = 'source-in';
    if (spec.fillStyle || !MD) {
      M.ctx.fillStyle = spec.fillStyle || flat(key);
    } else {
      // The ramp is laid across the CAP BAND, not the plate, so the corr(lum,y) it
      // produces is the same number the bar was measured with. It runs a little past both
      // ends because the glyphs bounce and the ascender of a '!' clears the cap.
      const g = M.ctx.createLinearGradient(0, oy - capH * 1.06, 0, oy + capH * 0.04);
      g.addColorStop(0, MD.top);
      g.addColorStop(1, MD.bot);
      M.ctx.fillStyle = g;
    }
    M.ctx.fillRect(0, 0, W, H);
    M.ctx.globalCompositeOperation = 'source-over';
  }

  if (doChalk && MD && MD.chalk > 0 && !spec.fillStyle) {
    // CHALK. `source-atop` is clipped by the destination's own alpha, so this cannot put
    // a single pixel outside the mask and needs no second full-size surface — the whole
    // pass is one upscaled blit of a plate 1/64 the area, drawn with smoothing on, which
    // is also what gives the noise its soft blob edge.
    const cell = Math.max(1.6, capH * 0.13 * 0.125);
    const rgb = hexRGB(MD.tint);
    const CH = chalkPlate(4, W, H, cell, rgb, MD.chalk, hash(seed, 0x5c4a));
    M.ctx.setTransform(1, 0, 0, 1, 0, 0);
    M.ctx.globalCompositeOperation = 'source-atop';
    M.ctx.drawImage(CH.cv, 0, 0, CH.w, CH.h, 0, 0, W, H);
    M.ctx.globalCompositeOperation = 'source-over';
  }

  if (doBlit) target.drawImage(M.cv, 0, 0, W, H, dx, dy, W, H);
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
