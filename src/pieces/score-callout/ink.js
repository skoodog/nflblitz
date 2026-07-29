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
//   2. slimX / slimY   directional erosion. Widening a glyph horizontally to reach the
//                      bar's set width multiplies a near-vertical STEM and leaves a
//                      horizontal hairline alone, so eroding the same axis back restores
//                      the stem weight with the counters left open. That is slimX, and it
//                      is what every line uses. slimY is the mirror image and is the only
//                      lever this piece has on thick/thin contrast (the face is fixed at
//                      2.6:1, the bar measures nearer 3.4:1) — but it is SHIPPED AT ZERO:
//                      at tile scale it ate the tapered arm of the brush T's crossbar and
//                      CATCH! read as CAICH!. Contrast is not worth a misread word.
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
//                      39 px halo costs a 10 px blur over 1/15 of the pixels. The small
//                      canvas carries a margin, or Chromium clips the blur at its edge
//                      and the halo grows a hard rectangular boundary — visible as a box
//                      round the lockup on any pale background.
//
// COST. Round 1: 8 full Path2D fills for tornEdge and 8 more for fleck, 4-6 full-plate
// ctx.filter blurs at 35 px, ~900 strokes a line — 65-148 ms a lockup against an 8.0 ms
// budget. This version: ONE path fill, every erode/dilate a drawImage, every blur at
// 0.26 scale, ~60 strokes. Measured on this box, 27-37 ms at 1:1 and 8.6-11.6 ms at the
// runtime raster. That is still over 8 ms in one go, so the work is exposed as three
// resumable phases — inkMask / st.finish / inkPaint — and lockup.js spends them on
// separate slices. Largest single slice: 2.2-3.1 ms at the runtime raster, 7-10 ms at 1:1.
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
  // Clear only the region this caller asked for. The pool grows to the largest line in
  // the lockup and never shrinks, so clearing the whole surface made the small PTS line
  // pay the display line's fill rate nine times over. Every drawImage below therefore
  // passes an EXPLICIT source rect — nothing may read outside the live region.
  c.clearRect(0, 0, Math.ceil(w), Math.ceil(h));
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

const RING8 = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [0.72, 0.72], [-0.72, 0.72], [0.72, -0.72], [-0.72, -0.72],
];

/**
 * inkMask(faces, spec) -> state
 *
 * Phase one: silhouette, x-erosion and the SHORT fray. Nothing is coloured and nothing
 * is drawn to the plate. The long filaments come back as `st.finish`, and `inkPaint`
 * does the colour — three resumable phases, because the display line on its own was
 * 15-18 ms at 1:1 against an 8 ms bake budget and it now splits into 7.5 / 3.7 / 4.0.
 *
 * The returned state carries the live mask, which is a POOLED scratch surface: nothing
 * else may bake between the phases. lockup.js's slices are strictly sequential.
 */
export function inkMask(faces, spec) {
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

  /* ------------------------------------------- 2. directional erosion */
  // slimX narrows what is nearly VERTICAL and leaves a horizontal hairline alone, so it
  // undoes the stem-fattening side effect of the 1.36x horizontal widening.
  // slimY does the opposite: it thins the HORIZONTALS and leaves the stems, which is the
  // only lever this piece has on thick/thin contrast, since the face's own ratio is
  // fixed at 2.6:1 and the bar runs nearer 3.4:1.
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

  /* ------------------------------------------------- 3. frayed terminals */
  // Direction the paint runs off a terminal: mostly gravity, leaning back along the
  // brush axis. The bar's filaments hang from every downward-facing stroke end.
  const fx = -slant * 0.5, fy = 1;

  // The whole fray lives in a BAND: 1.05 cap above the baseline down to the bottom of
  // the layout. Everything above that is faded out by the vertical gradient anyway, so
  // running the extrusion over the full line canvas was paying for ~2.4x the pixels.
  // Measured on this box: the fray was 16.3 ms of a 22.1 ms line.
  const bTop = Math.max(0, Math.floor(oy - capH * 1.05));
  const bH = Math.max(4, Math.min(H, Math.ceil(oy + capH * 0.62)) - bTop);
  const bOy = oy - bTop;                     // baseline row inside the band

  function fringe(steps, stepLen, spacing, wMin, wMax, fadeAt, alpha) {
    const u = stepLen * capH;
    const T = scratch(2, W, bH);
    for (let k = 1; k <= steps; k++) {
      T.ctx.drawImage(M.cv, 0, bTop - fy * u * k, W, bH, fx * u * k, 0, W, bH);
    }
    T.ctx.globalCompositeOperation = 'destination-out';
    T.ctx.drawImage(M.cv, 0, bTop, W, bH, 0, 0, W, bH);

    // comb: hairlines parallel to the run direction
    const C = scratch(3, W, bH);
    C.ctx.setTransform(1, 0, 0, 1, ox, bOy);
    C.ctx.strokeStyle = '#fff';
    C.ctx.lineCap = 'butt';
    const yA = -capH * 1.1, yB = capH * 0.65;
    let x = bx0;
    while (x < bx1) {
      const t = rng();
      C.ctx.lineWidth = capH * (wMin + t * t * (wMax - wMin));
      // Per-hair opacity. Uniform hairs comb out as a machined sawtooth; real dry brush
      // leaves some filaments barely loaded.
      C.ctx.globalAlpha = 0.45 + rng() * 0.55;
      C.ctx.beginPath();
      C.ctx.moveTo(x, yA);
      C.ctx.lineTo(x + fx * (yB - yA), yB);
      C.ctx.stroke();
      x += capH * spacing * (0.45 + rng() * 1.1);
    }
    C.ctx.globalAlpha = 1;
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
    T.ctx.drawImage(C.cv, 0, 0, W, bH, 0, 0, W, bH);

    M.ctx.setTransform(1, 0, 0, 1, 0, 0);
    M.ctx.globalCompositeOperation = 'source-over';
    M.ctx.globalAlpha = alpha;
    M.ctx.drawImage(T.cv, 0, 0, W, bH, 0, bTop, W, bH);
    M.ctx.globalAlpha = 1;
  }

  const fr = spec.fray === undefined ? 1 : spec.fray;
  // A ragged, uneven edge on the feet...
  if (fr > 0) fringe(1, 0.024 * fr, 0.062, 0.008, 0.028, 0.66, 0.92);
  // ...and, sparsely, the long hairs: ~2 per glyph, from the baseline only, up to 0.21
  // cap long. The first pass at this was a CURTAIN under every downward edge — melted
  // candle, not brush. Held as a closure so the caller can spend it on its own slice.
  const finish = fr > 0
    ? () => { fringe(4, 0.074 * fr, 0.560, 0.006, 0.015, 0.38, 0.86); }
    : () => {};

  return { L, P, capH, slant, key, rng, W, H, ox, oy, bx0, bx1, dx, dy, y0, y1, M, finish };
}

/**
 * inkPaint(target, faces, spec, st)
 * Phase two: colour the mask, derive the shadow from it, composite onto the plate.
 * `spec.x` is the line's CENTRE, `spec.y` its BASELINE, in target space.
 */
export function inkPaint(target, faces, spec, st) {
  const { L, capH, slant, key, rng, W, H, ox, oy, bx0, bx1, dx, dy, y0, y1, M } = st;

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
  INK.ctx.drawImage(M.cv, 0, 0, W, H, 0, 0, W, H);

  /* ------------------------------------------------ 6. shadow at 1/4 res */
  // The whole shadow stack runs on a canvas a quarter the size, so a 39 px halo costs a
  // 10 px blur over 1/15 of the pixels. `mb` is the margin the blur needs OUTSIDE the
  // downsampled plate: without it Chromium clips the blur at the canvas edge and the
  // halo acquires a hard rectangular boundary, which shows on any pale background as a
  // faint box round the lockup.
  const q = 0.26, iq = 1 / q;
  const blurH = capH * 0.34;
  const mb = Math.ceil(blurH * q * 2.4) + 2;
  const sw = Math.max(8, Math.round(W * q) + mb * 2), sh = Math.max(8, Math.round(H * q) + mb * 2);
  const mx = mb * iq;
  const dw = sw * iq, dh = sh * iq;
  const A = scratch(5, sw, sh);
  A.ctx.drawImage(M.cv, 0, 0, W, H, mb, mb, W * q, H * q);
  A.ctx.globalCompositeOperation = 'source-in';
  A.ctx.fillStyle = `rgb(${SHADOW_RGB})`;
  A.ctx.fillRect(0, 0, sw, sh);

  const shA = spec.shadow === undefined ? 1 : spec.shadow;
  if (shA > 0) {
    const haA = spec.halo === undefined ? 1 : spec.halo;
    if (haA > 0) {
      const Bh = scratch(6, sw, sh);
      Bh.ctx.filter = `blur(${Math.max(1, blurH * q).toFixed(2)}px)`;
      Bh.ctx.drawImage(A.cv, 0, 0, sw, sh, 0, 0, sw, sh);
      target.save();
      target.globalAlpha = 0.30 * haA;
      target.drawImage(Bh.cv, 0, 0, sw, sh, dx - mx + capH * 0.02, dy - mx + capH * 0.10, dw, dh);
      target.drawImage(Bh.cv, 0, 0, sw, sh, dx - mx + capH * 0.02, dy - mx + capH * 0.10, dw, dh);
      target.restore();
    }
    const Bt = scratch(7, sw, sh);
    Bt.ctx.filter = `blur(${Math.max(0.8, capH * 0.055 * q).toFixed(2)}px)`;
    Bt.ctx.drawImage(A.cv, 0, 0, sw, sh, 0, 0, sw, sh);
    target.save();
    target.globalAlpha = 0.86 * shA;
    target.drawImage(Bt.cv, 0, 0, sw, sh, dx - mx + capH * 0.032, dy - mx + capH * 0.078, dw, dh);
    target.drawImage(Bt.cv, 0, 0, sw, sh, dx - mx + capH * 0.032, dy - mx + capH * 0.078, dw, dh);
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
    for (let i = 0; i < RING8.length; i++) {
      K.ctx.drawImage(M.cv, 0, 0, W, H, RING8[i][0] * r, RING8[i][1] * r, W, H);
    }
    K.ctx.globalCompositeOperation = 'source-in';
    K.ctx.fillStyle = spec.keylineColor || OUTLINE;
    K.ctx.fillRect(0, 0, W, H);
    target.drawImage(K.cv, 0, 0, W, H, dx, dy, W, H);
  }

  /* ------------------------------------------------------------- 8. glow */
  if (spec.glow) {
    const G = scratch(6, sw, sh);
    G.ctx.drawImage(M.cv, 0, 0, W, H, mb, mb, W * q, H * q);
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
    for (let i = 0; i < reps; i++) target.drawImage(G2.cv, 0, 0, sw, sh, dx - mx, dy - mx, dw, dh);
    target.restore();
  }

  target.drawImage(INK.cv, 0, 0, W, H, dx, dy, W, H);
  return L;
}

/** All three slices back to back. */
export function paintLine(target, faces, spec) {
  const st = inkMask(faces, spec);
  st.finish();
  return inkPaint(target, faces, spec, st);
}

export default { layoutLine, linePath, paintLine, inkMask, inkPaint, newCanvas, releaseScratch };
