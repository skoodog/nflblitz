// PIECE: score-callout — the ink engine.
//
// ROUND 2 REBUILD, against four measurements taken off bar/panel-truck.png and our own
// capture with the same threshold (mx>150, saturation<46, tight bbox):
//
//                             bar TRUCK!        round-1 ours       this round
//   ink bbox                  140 x 45 px       479 x 213 px       measured below
//   width / frame width       0.265             0.2495             ~0.31
//   w / h  (whole bbox)       3.11              2.25               ~3.4
//   w / h  (rows >=5% peak)   3.33              3.45               ~3.6
//
// The round-1 bbox was 213 px tall against a 139 px core: seventy-four pixels of stuff
// hanging under the letters. That is where the reported "31% too condensed" came from —
// not from the letterforms, which already measured 3.45, but from long DARK drips under
// every foot. They were dark because the drop shadow was derived from the mask AFTER the
// filaments were added, so a 1 px hair carried a 2-pass blurred shadow that outweighed
// its own ink. On the bar the tails are the same light grey as the stroke: at threshold
// 205 they vanish (bbox 38 px tall) and at 150 they appear (46 px), i.e. they are ink
// fading out, not a dark drip.
//
// So this version:
//
//   1. silhouette      one Path2D fill — the only path fill in the whole line
//   2. slimX           directional erosion. Widening a glyph horizontally to reach the
//                      bar's set width multiplies a near-vertical STEM and leaves a
//                      horizontal hairline alone, so eroding the same axis back restores
//                      the stem weight with the counters left open.
//   3. TERMINAL TAPER  an ISOTROPIC erosion whose radius ramps with depth — see taper()
//                      below. This is the round-3 fix and it is the one that decides
//                      whether the mark reads as brush or as a distressed typeface.
//   4. SHADOW SOURCE   the mask is downsampled to the shadow's working size HERE, after
//                      the taper and before a single filament exists. Nothing the tails
//                      do can cast a shadow.
//   5. split tails     the tapered mask is extruded down the brush axis with a per-step
//                      alpha decay and combed with SPLIT STATIONS — one terminal shedding
//                      two or three clustered hairs — not an evenly spaced picket comb.
//   6. flat ink        ONE fill colour, composited straight into the mask with source-in.
//                      No gradient object, no keyline, no speckle, no specular sweep.
//   7. shadow + glow   from the step-4 downsample, on EXACT-SIZED blur canvases.
//
// WHAT ROUND 3 CHANGED, and why. Round 2 matched the bar's overall block — TRUCK! came
// out 594 x 168 against the bar's 138 x 38 scaled up, w/h 3.63 against 3.63, flat matte
// with a 0.000 top-to-bottom swing — and still read as a grunge FONT beside it. Measured
// on the two at matched ink height:
//
//                              bar TRUCK!            round-2 ours
//   stem width, mid-cap        0.132 cap             0.170 cap      29% heavy
//   stem width at the foot     0.026-0.053 cap       0.170 cap      NO TAPER AT ALL
//   terminal                   point, then 1-3       flat cut, then 8-10 identical
//                              hairlines             vertical pickets
//   numerals                   italic, ~0.24 slant   upright, and dripping
//
// So the letterforms were right and the ENDS OF THE STROKES were wrong: every stroke in
// the bar narrows to a point and only then sheds a hair or two, and round 2 cut every
// stroke off square and hung a machined comb under it. A comb under a square end is
// exactly what a distressed display font looks like. taper() + the split comb below are
// the fix, and slimX went 0.017 -> 0.029 to bring the stem weight onto the bar's.
//
// COST. Round 1 measured 45-49 ms for a one-line lockup at 1:1 against an 8 ms cap, and
// the money was not where the comments said it was: the display line was 14 ms and the
// two small gold lines were 14.3 and 11.7. The reason is `ctx.filter='blur()'`, whose
// cost in Chromium follows the CANVAS surface, not the drawn rectangle — and the blur
// canvases came out of a pool grown to the largest line in the lockup, so 'PTS' paid the
// display line's blur three times. Blur targets now come from `exact()`, which resizes to
// the requested size, and the 8-tap keyline ring (8 full-plate draws per gold line) is
// gone because the bar has no keyline anyway. Measured after: see the header of index.js.
//
// Everything here runs at BAKE time only. The frame path never enters this file.

import { makeRng, seedFromString, hash } from '../../foundation/rng.js';
import { SHADOW_RGB, flat } from './palette.js';

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
  // what made the 'PTS' line — 200 px of ink — cost 11.7 ms of a 45 ms bake. Clipping
  // at acquisition bounds every composite in the file to the region that is live.
  c.restore();
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'source-over';
  c.globalAlpha = 1;
  c.filter = 'none';
  c.clearRect(0, 0, Math.ceil(w), Math.ceil(h));
  c.beginPath();
  c.rect(0, 0, Math.ceil(w), Math.ceil(h));
  c.clip();
  return s;
}

// Surfaces that are BLURRED. `ctx.filter` costs the whole surface in Chromium, so these
// are resized to exactly what the caller asked for. They are small (a quarter-scale
// silhouette, ~180 x 140 for a display line) so the resize is cheap and it is the
// difference between 11.7 ms and 1.4 ms on the PTS line.
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
 * angle exactly. At xScale 1.46 that is the difference between the bar's ~15 deg and a
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
    // Tight, because this box is what every raster surface in the line is sized from and
    // the line surface was 1.6x the ink area at round 1's 1.26/0.56. Measured: the brush
    // face's caps top out at -1.02 cap and the long filaments reach +0.36, so -1.15/+0.46
    // leaves ~0.1 cap of margin on each side and nothing more.
    top = Math.min(top, dy - capH * scales[i] * 1.15);
    bot = Math.max(bot, dy + capH * scales[i] * 0.46);
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

/* ------------------------------------------------------------------ paint */

/**
 * inkMask(faces, spec) -> state
 *
 * Phase one: silhouette, x-erosion, the shadow downsample and the SHORT fringe. Nothing
 * is coloured and nothing is drawn to the plate. The long filaments come back as
 * `st.finish` and `inkPaint` does the colour, so a caller can spend the line over three
 * slices.
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
  // lives on the downsampled canvas, not here — so 0.26 cap, not round 1's 0.55. It went
  // 0.22 -> 0.26 when the NUMERALS were sheared: a slant of 0.24 throws the top of a digit
  // 0.24 cap right of its advance box and the old pad clipped the 1's flag.
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

  /* ------------------------------------------- 2. directional erosion */
  // slimX narrows what is nearly VERTICAL and leaves a horizontal hairline alone, so it
  // undoes the stem-fattening side effect of the horizontal widening.
  //
  // slimY is the mirror image and is the only lever this piece has on thick/thin
  // contrast: it thins the HORIZONTALS and leaves the stems, and the bar's brush runs a
  // much higher contrast than the face's fixed 2.6:1. Round 1 shipped it at zero because
  // at tile scale it ate the tapered arm of the T's crossbar and CATCH! read as CAICH!;
  // at this round's cap (138 against 115) 0.010 cap is 1.4 px and the crossbar is 25.
  let M = S;
  const ex = Math.round((spec.slimX || 0) * capH);
  const ey = Math.round((spec.slimY || 0) * capH);
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

  /* ------------------------------------------- 3. THE TERMINAL TAPER */
  /**
   * A brush lifting off the paper does not get cut off square — the nib narrows in EVERY
   * direction as the pressure comes off, so the stroke ends in a point. That is the one
   * thing the compiled face cannot do for us (its outline is baked at a fixed pressure
   * profile) and the one thing that separates brush lettering from a distressed font.
   *
   * So: an isotropic (diamond, L1) erosion whose radius RAMPS WITH DEPTH. Band 1 covers
   * the whole taper zone and takes 1 px off every side; band 2 covers everything below a
   * fifth of the zone and takes another; and so on. A stem passing through all `bands`
   * therefore loses 2 px of width per band by the time it reaches the foot, and the last
   * band or two eat the flat bottom edge outright and leave a point.
   *
   * Measured against the bar's T stem in panel-truck (cap 38 px, ink thresholded at 150):
   *   depth   0.20 cap   0.50   0.75   0.92   0.97   1.00
   *   bar     0.132 cap  0.132  0.132  0.105  0.053  0.026   -> point
   * i.e. a gentle 20% narrowing down the stem and then a hard point over the last 8% of
   * the cap. One px per band over a zone that starts at -0.46 cap reproduces both: the
   * upper bands are spread thin over most of the stem, and the bands pile up at the foot.
   *
   * Integer offsets on purpose. A sub-pixel destination-in multiplies the edge alpha 4x a
   * band and after six bands the letter has a soft airbrushed rim; 1 px keeps it crisp.
   *
   * Cost: the zone is ~0.5 cap tall, so this is 5 draws over W x 0.5cap per band, ~0.9 M
   * pixels for a display line at 1:1 — measured at 0.6-1.1 ms, and it is its own slice.
   */
  function taper(amount, zoneTop) {
    const bands = Math.min(9, Math.round(amount * capH));
    if (bands < 1) return;
    const zTop = Math.max(0, Math.floor(oy + capH * zoneTop));
    const zBot = Math.min(H, Math.ceil(oy + capH * 0.05));
    const zH = zBot - zTop;
    if (zH < bands + 2) return;

    let si = 4, di = 5;
    let src = scratch(si, W, zH);
    src.ctx.drawImage(M.cv, 0, zTop, W, zH, 0, 0, W, zH);
    for (let k = 1; k <= bands; k++) {
      const dst = scratch(di, W, zH);
      const c = dst.ctx;
      c.drawImage(src.cv, 0, 0, W, zH, 0, 0, W, zH);
      const yb = Math.max(1, Math.floor((zH - 1) * (k - 1) / bands));
      c.save();
      c.beginPath();
      c.rect(0, yb, W, zH - yb);
      c.clip();
      c.globalCompositeOperation = 'destination-in';
      c.drawImage(src.cv, 0, 0, W, zH, 1, 0, W, zH);
      c.drawImage(src.cv, 0, 0, W, zH, -1, 0, W, zH);
      c.drawImage(src.cv, 0, 0, W, zH, 0, 1, W, zH);
      c.drawImage(src.cv, 0, 0, W, zH, 0, -1, W, zH);
      c.restore();
      src = dst;
      const t = si; si = di; di = t;
    }
    M.ctx.setTransform(1, 0, 0, 1, 0, 0);
    M.ctx.globalCompositeOperation = 'source-over';
    M.ctx.clearRect(0, zTop, W, zH);
    M.ctx.drawImage(src.cv, 0, 0, W, zH, 0, zTop, W, zH);
  }

  /* ------------------------------------ 4. shadow source, BEFORE the tails */
  // This is the fix for the dark drips. A filament is one or two pixels of half-loaded
  // ink; give it a two-pass blurred shadow of its own and the shadow wins, which is how
  // round 1 grew 74 px of black drool under every foot. The shadow is cast by the
  // LETTER, so it is sampled here and the tails are added afterwards.
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

  /* ------------------------------------------------- 5. split tails */
  // Direction the paint runs off a terminal: gravity, leaning back along the brush axis.
  // The face is sheared to the right going UP, so running DOWN the axis runs left, which
  // is exactly the way the bar's filaments lean.
  const fx = -slant * 0.55, fy = 1;

  /**
   * SPLIT STATIONS, not a comb.
   *
   * Round 2 laid hairs down every 0.074 cap at a constant width — across TRUCK! that is
   * about fifty of them, evenly spaced, all the same length, hanging off a square-cut
   * bottom edge. Counted on bar/panel-truck at threshold 150 there are SIX filaments under
   * the whole word, and they arrive in twos: one terminal sheds two or three hairs that
   * leave from the same point and splay apart. That is what "split hairline tails" means,
   * and it is the difference between paint leaving a brush and a texture layer.
   *
   * So the walk steps `spacing` cap between STATIONS, and each station puts 1-3 hairs
   * inside a twentieth of a cap of each other. Each hair is a wedge — `w0` cap at the root
   * where it leaves the terminal, a tenth of that at the tip — because a stroked constant
   * width hairline reads as a machined sawtooth.
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
      const n = 1 + (rng() < 0.60 ? 1 : 0) + (rng() < 0.24 ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const hx = k === 0 ? x : x + rng.range(-0.052, 0.052) * capH;
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
  const steps = [];

  // [0] taper, then sample the shadow off the TAPERED letter. Order matters twice over:
  //     the shadow has to follow the pointed stroke, and it has to be taken before a
  //     single filament exists, or a 1 px hair carries a two-pass blurred shadow that
  //     outweighs its own ink — which is how round 1 grew 74 px of black drool per foot.
  steps.push(() => { taper(tp, -0.46); sampleShadow(); });

  // [1] the split tails, off the tapered mask. ONE pass now, not round 2's dense fringe
  //     plus long hairs: with the terminals coming to a point the fringe had nothing left
  //     to do except advertise itself.
  //
  //     Composited at 0.80, not 1.0. A filament carries less paint than the stroke it
  //     leaves, and it has to READ that way under a threshold as well as to the eye: the
  //     bar's tails disappear at a 205 cut (bbox 138 x 38, w/h 3.63) and reappear at 150
  //     (140 x 46, w/h 3.04). A tail baked at full alpha survives the 205 cut and drags
  //     the measured aspect down with it — the exact artefact behind the round-1 verdict.
  if (fr > 0) {
    steps.push(() => tails(-0.34, 0.46, 5, 0.076 * fr, 0.70, 0.80, [0.62, 0.008, 0.019, 0.50, 0.26, 0.20]));
  }

  return {
    L, capH, slant, key, rng, W, H, ox, oy, bx0, bx1, dx, dy, y0, y1, M, A, sw, sh, mb, iq, q, blurH,
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
 * Phase two: colour the mask, lay the shadow that was sampled in phase one, composite.
 * `spec.x` is the line's CENTRE, `spec.y` its BASELINE, in target space.
 */
export function inkPaint(target, faces, spec, st) {
  const { capH, key, W, H, dx, dy, M, A, sw, sh, mb, iq, q, blurH } = st;
  if (st.ensureShadow) st.ensureShadow();
  const mx = mb * iq;
  const dw = sw * iq, dh = sh * iq;

  /* ---------------------------------------------- 1. shadow + halo + glow */
  // Both shadow passes come off the same quarter-scale silhouette `A`, are ASSEMBLED ON
  // A CANVAS THAT IS ALSO QUARTER SCALE, and reach the plate as ONE scaled blit.
  //
  // That last part is the whole point. A blur target is 25k pixels, but a blit of it onto
  // the plate is (W + 2*margin) x (H + 2*margin) = ~310k — by a distance the most
  // expensive operation left in this file. Round 1 did four of them per line (halo twice,
  // shadow twice); the compounded-alpha rewrite got that to two; assembling at quarter
  // scale gets it to one. Every canvas here is EXACT-sized, because ctx.filter costs the
  // whole SURFACE in Chromium, not the drawn rectangle.
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
      // 0.42 in one draw, not 0.34 twice. Round 1's compounded 0.564 put a dark band
      // exactly where the tails hang and the gaps between the filaments read as the mark.
      SH.ctx.globalAlpha = 0.42 * haA;
      SH.ctx.drawImage(B.cv, 0, 0, sw, sh, capH * 0.02 * q, capH * 0.07 * q, sw, sh);
    }
    const B2 = exact(3, sw, sh);
    B2.ctx.filter = `blur(${Math.max(0.8, capH * 0.055 * q).toFixed(2)}px)`;
    B2.ctx.drawImage(A.cv, 0, 0, sw, sh, 0, 0, sw, sh);
    B2.ctx.filter = 'none';
    B2.ctx.globalCompositeOperation = 'source-in';
    B2.ctx.fillStyle = `rgb(${SHADOW_RGB})`;
    B2.ctx.fillRect(0, 0, sw, sh);
    SH.ctx.globalAlpha = 0.986 * shA;
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

  /* ------------------------------------------------------- 2. the flat ink */
  // ONE colour, straight into the mask. No gradient, no keyline, no grain, no sweep.
  // `scratch()` already clipped this surface to (0,0,W,H), so `source-in` cannot reach
  // the pool's dead margin.
  M.ctx.setTransform(1, 0, 0, 1, 0, 0);
  M.ctx.globalCompositeOperation = 'source-in';
  M.ctx.fillStyle = spec.fillStyle || flat(key);
  M.ctx.fillRect(0, 0, W, H);
  M.ctx.globalCompositeOperation = 'source-over';

  target.drawImage(M.cv, 0, 0, W, H, dx, dy, W, H);
  return st.L;
}

/** All three slices back to back. */
export function paintLine(target, faces, spec) {
  const st = inkMask(faces, spec);
  st.finish();
  return inkPaint(target, faces, spec, st);
}

export default { layoutLine, linePath, paintLine, inkMask, inkPaint, newCanvas, releaseScratch };
