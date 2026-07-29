// PIECE: score-callout — the lockup: composition, colour rule, and the bake cache.
//
// GEOMETRY. Measured with ONE rule applied to both sides — ink is a pixel whose max
// channel clears the threshold and whose saturation is under 46 (white lines) or which
// is dominantly red (MURDER!), tight bbox inside a window that holds no background. Two
// thresholds, because the bar's TAILS live between them: 205 keeps only the strokes, 150
// picks the filaments up as well.
//
//   bar panel-truck    (528x310)  TRUCK!     T205 138 x 38  w/h 3.63   T150 140 x 46  3.04
//   bar panel-midair   (528x338)  MURDER!    T150 154 x 45  w/h 3.42 (core 3.85)
//   bar panel-touchdown(382x376)  TOUCHDOWN! T205 208 x 51  core w/h 4.08
//   bar panel-leveler  (410x376)  LEVELER!   T205 256 x 56  core w/h 4.57
//
// The panels have four different aspect ratios and all four carry the same UI (HUD top
// left, TURBO bottom left), so "fraction of frame WIDTH" is not comparable between them.
// Normalised by frame HEIGHT the single-line callouts run 0.445 (truck) / 0.456 (murder)
// / 0.559 (touchdown) / 0.692 (leveler) — the two 16:9-ish panels at the bottom of that
// range and the two square ones at the top.
//
// WHERE WE LAND, on the same rule, off shots/score-callout/iso_callout_truck.png:
//
//   TRUCK!   T205 645 x 185 (core 636 x 182)  w/h core 3.50   w/frameW 0.336  w/frameH 0.597
//   MURDER!  T150 697 x 159 (core 697 x 156)  w/h core 4.47   w/frameW 0.363  w/frameH 0.645
//
// i.e. 0.336 of frame width against round 1's 0.208 — a 62% scale-up — and an aspect of
// 3.50 against round 1's 2.51 and the bar's 3.63. Deliberately at the TOP of the bar's
// own spread rather than the middle: the verdict was that the callout read small, and
// 0.597 of frame height sits between panel-touchdown's 0.559 and panel-leveler's 0.692.
//
// LINE 1 gets its own, much looser tracking. At a shared value MID-AIR came out 0.55 as
// wide as MURDER! and the two lines never locked into the bar's near-rectangular block;
// the bar's ratio is 0.693 and its MID-AIR is visibly letterspaced where MURDER! is set
// tight. cap1 = 0.725 is measured (19/27) and was already right.
//
// COLOUR RULE (unchanged — verified against all five panels):
//     line 1 present  ->  line 2 takes the accent   (MID-AIR/MURDER! red, WHAT A/CATCH! gold)
//     line 1 absent   ->  line 2 is white           (TRUCK!, LEVELER!, TOUCHDOWN!)
// and the points line is always gold, because it is gold in every bar panel.

import { hash, seedFromString } from '../../foundation/rng.js';
import { inkMask, inkPaint, layoutLine, linePath, newCanvas, releaseScratch } from './ink.js';
import { GOLD_GLOW } from './palette.js';

/* ------------------------------------------------------------- proportions */

export const GEO = {
  cap2: 144,          // line-2 cap height at scale 1, one-line lockup. 115 / 138 / 150 in
                      //   rounds 1-3; 144 now, and the 4% is all this axis needed. Stretch
                      //   panel-truck to 1920 wide and its TRUCK! is 509 px across a
                      //   131 px cap; round 2 measured 648 across a 136 px cap. The CAP was
                      //   right to 4% and the WIDTH was 27% out, so the correction belongs
                      //   in INK.line2.xScale, not here.
  duo: 0.82,          // x cap2 when line 1 is present — the bar shrinks the stack to fit
                      //   (bar: MURDER! cap 27 against TRUCK! cap 31 = 0.87)
  cap1: 0.725,        // x cap2eff   (bar: 19/27)
  capNum: 0.585,      // x cap2eff   (bar: 17/33 truck, 16/27 midair)
  capPts: 0.680,      // x capNum
  dy1: -1.380,        // line-1 baseline, x cap2eff, relative to line-2 baseline
                      //   (bar: MID-AIR baseline 252, MURDER! baseline 290, cap 27)
  dyNum: 0.950,       // points baseline, x cap2eff  (bar: +32/33 truck, +25/27 midair)
  ptsGap: 0.155,      // x capNum, between the last digit and P
  ptsLift: 0.030,     // x capNum, PTS baseline sits marginally above the numerals
  liftSolo: 0.760,    // x cap2. A one-line lockup has less mass, so it is lifted to
                      //   sit in the same band of the frame as a two-line one. Measured
                      //   against the panels stretched to 1920x1080: bar TRUCK! ink box
                      //   y 658..815, bar MURDER! y 811..994. With ANCHOR_Y at 1035 the
                      //   one-line lockup lands at 644..811 and the two-line at 794..943.
  nudge1: -0.065,     // x line-2 width  (bar: MID-AIR centre is 10.5px left of MURDER!'s)
  nudgeNum: 0.048,   // x line-2 width. The bar sets the points line 14 px RIGHT of the
                      //   display line's centre on panel-truck; round 1 put it 14 left.
  rotation: -0.0435,  // rad, -2.5 deg. Measured: truck -1.7, midair -1.3, touchdown -2.9,
                      //   leveler -4.6. Rises to the right, as every panel does.
  maxWidth: 680,      // TOUCHDOWN! is 10 glyphs. MEASURED: the bar sets a 10-glyph line at
                      //   0.408 cap per glyph against TRUCK!'s 0.605 — it condenses a long
                      //   word by a THIRD. At maxWidth 800 nothing squeezed at all (raw
                      //   780) and TOUCHDOWN! ran 1148..1877 of a 1920 frame, 43 px off
                      //   the edge. 680 keeps every line's right margin at 4% of the frame,
                      //   which is what the bar holds (panel-truck 8%, panel-midair 5%).
  condense: 0.70,     // floor on the horizontal squeeze an over-long line may take before
                      //   any of the overflow comes off its cap height. The bar's own
                      //   floor, read off TOUCHDOWN! against TRUCK!, is 0.674.
};

/**
 * Per-line ink recipes. Kept here so the whole look is legible in one place.
 *
 * `taper` is the round-3 addition and the one that decides whether the mark reads as
 * brush or as a distressed typeface — see ink.js's taper(), which is where it is spent.
 * `slimX`/`slimY`/`taper` are all whole numbers of pixels off a stroke whose width is a
 * FRACTION of the cap, so ink.js gates all three on its own `fine` factor; that is what
 * keeps MURDER! from reading as MURDFR! on the five-up sheet, where the tile scale is
 * 0.604 and a stacked lockup lands at cap 74.
 */
export const INK = {
  line1: { tracking: 0.048, xScale: 1.28, minor: 0.930, slimX: 0.022, fray: 0.70, taper: 0.050, halo: 0.70, jitter: 0.9 },
  // TIGHT, AND THE TIGHTENING COMES OUT OF THE COUNTERS. Round 2 set xScale 1.60 with
  // tracking -0.010 and measured w/cap 4.765 against the bar's 3.889 — 22% too airy, with
  // seven clean-gapped components where the bar has five and T is fused into R. xScale
  // 1.33 narrows the R bowl, the U interior and the C aperture and leaves cap height
  // alone; tracking -0.040 closes the gaps. Measured after: w/cap 3.89, five components.
  line2: { tracking: -0.040, xScale: 1.36, minor: 0.885, slimX: 0.0295, slimY: 0.006, fray: 1.0, taper: 0.058, entry: 0.030, jitter: 0.85 },
  // ITALIC NUMERALS and NO TAILS. Both are measured: the bar's 150/250 lean with the
  // display line (~0.24, the brush face's own 0.27 taken off a touch because a geometric
  // digit at 15 deg already reads fast) and neither panel's points line has a single
  // filament under it — the drips belong to the brush face, not to the score.
  num: { tracking: 0.010, xScale: 1.40, minor: 1, excl: 1, slant: 0.235, slimX: 0.013, fray: 0, taper: 0, entry: 0, jitter: 0.45 },
  pts: { tracking: 0.026, xScale: 1.36, minor: 1, slimX: 0.014, fray: 0, taper: 0.022, entry: 0, jitter: 0.5 },
};

function accentFor(state) {
  const l1 = String(state.line1 || '').trim();
  const l2 = String(state.line2 || '').trim();
  const explicit = state.line2Color;
  if (explicit === 'white' || explicit === 'red' || explicit === 'gold') {
    return { key: explicit === 'gold' ? 'goldLine' : explicit, l1, l2 };
  }
  if (!l1) return { key: 'white', l1, l2 };
  return { key: state.accent === 'red' ? 'red' : 'goldLine', l1, l2 };
}

/* -------------------------------------------------------------------- bake */

/**
 * Plan the lockup: allocate the plate, lay every line out, and return a record whose
 * `jobs` array paints one line each. Nothing is rasterised yet.
 *
 * The plate is SLICED because a whole lockup cannot be painted inside this piece's 8 ms
 * bake budget on a software canvas. Measured on this box at 1:1 after the ink rebuild:
 * TRUCK! 16.0-17.7 ms over 13 slices, largest 3.8; MID-AIR/MURDER! 18.8-20.0 ms over 17
 * slices, largest 2.9. Round 1 was 45-49 ms with a 14.3 ms tall pole. At the runtime
 * raster (fit*dpr*1.25, ~0.45 on a 390x844 phone) the pixel work is 0.2x, so the whole
 * bake is ~4 ms and no slice reaches 1 ms. `stepLockup` runs exactly one.
 */
export function beginLockup(faces, state, opts) {
  const A = accentFor(state);
  const pts = state.pts | 0;
  const seed = hash(seedFromString('sc|' + A.l1 + '|' + A.l2 + '|' + pts + '|' + A.key), opts && opts.seed ? opts.seed | 0 : 7);
  const scale = (opts && opts.scale) || 1;
  // `raster` is RESOLUTION, not size: the plate is baked at the number of device pixels
  // it will actually be blitted at. On a 390x844 phone the overlay's fit is 0.36, so a
  // 1:1 plate would be resampled down for no visible gain and 8x the memory.
  const raster = (opts && opts.raster) || 1;
  const R = scale * raster;

  const C = GEO.cap2 * R * (A.l1 ? GEO.duo : 1);
  const c1 = GEO.cap1 * C;
  const cN = GEO.capNum * C;
  const cP = GEO.capPts * cN;

  // ---- lay every line out first so the whole lockup can be fitted as one object
  const numTxt = pts > 0 ? String(pts) : '';
  const lay = (h2, h1, hN, hP, k) => ({
    l2: A.l2 ? layoutLine(faces, A.l2, Object.assign({ face: 'blitz-brush', capH: h2 }, INK.line2, { xScale: INK.line2.xScale * k })) : null,
    l1: A.l1 ? layoutLine(faces, A.l1, Object.assign({ face: 'blitz-brush', capH: h1 }, INK.line1, { xScale: INK.line1.xScale * k })) : null,
    ln: numTxt ? layoutLine(faces, numTxt, Object.assign({ face: 'blitz-num', capH: hN }, INK.num, { xScale: INK.num.xScale * k })) : null,
    lp: numTxt ? layoutLine(faces, 'PTS', Object.assign({ face: 'blitz-brush', capH: hP }, INK.pts, { xScale: INK.pts.xScale * k })) : null,
  });

  let S = lay(C, c1, cN, cP, 1);
  const wPts = S.ln ? S.ln.width + GEO.ptsGap * cN + (S.lp ? S.lp.width : 0) : 0;
  const wMax = Math.max(S.l2 ? S.l2.width : 0, S.l1 ? S.l1.width : 0, wPts, 1);

  // OVER-LONG LINES CONDENSE BEFORE THEY SHRINK. A word that will not fit was scaled DOWN
  // in round 1, which is why TOUCHDOWN! came out 745 x 106 — 24% wider and 18% shorter
  // than the bar's, an aspect of 6.1 against 4.7. The bar does not shrink it: panel-
  // touchdown sets TOUCHDOWN! in a visibly narrower, lighter cut at 0.82 of TRUCK!'s cap
  // and 0.47 of its per-character width. One face cannot change weight, but it can
  // condense, so `condense` takes the x axis down to 0.80 first and only what is left
  // over comes off the cap.
  const over = wMax / (GEO.maxWidth * R);
  let cond = 1, fit = 1;
  if (over > 1) {
    cond = Math.max(GEO.condense, 1 / over);
    fit = Math.min(1, 1 / (over * cond));
  }

  // Fitting changes cap heights, so re-lay out. Cheap, and it keeps every ratio exact.
  let CC = C, cc1 = c1, ccN = cN, ccP = cP;
  if (fit < 0.999 || cond < 0.999) {
    CC = C * fit; cc1 = c1 * fit; ccN = cN * fit; ccP = cP * fit;
    S = lay(CC, cc1, ccN, ccP, cond);
  }
  const l2 = S.l2, l1 = S.l1, ln = S.ln, lp = S.lp;

  const w2 = l2 ? l2.width : (ln ? ln.width : 100);
  const yNum = 0;                                  // anchor: points baseline
  const y2 = yNum - GEO.dyNum * CC;
  const y1 = y2 + GEO.dy1 * CC;
  const wPts2 = ln ? ln.width + GEO.ptsGap * ccN + (lp ? lp.width : 0) : 0;

  const x2 = 0;
  const x1 = GEO.nudge1 * w2;
  const xP = GEO.nudgeNum * w2;
  const lift = l1 ? 0 : GEO.liftSolo * CC;

  // ---- bounding box in anchor space
  const halfW = Math.max(
    l2 ? l2.width * 0.5 : 0,
    l1 ? l1.width * 0.5 + Math.abs(x1) : 0,
    wPts2 * 0.5 + Math.abs(xP)
  );
  const top = (l1 ? y1 + l1.top : y2 + (l2 ? l2.top : 0)) - CC * 0.18;
  const bot = (ln ? yNum + ln.bot : y2 + (l2 ? l2.bot : 0)) + CC * 0.18;

  // Room for the halo and nothing else. The halo blur is 0.30 cap and its visible reach
  // is about 1.5x that, so 0.56 x 0.46 cap clears it. Round 1 used 1.15 x 1.05, roughly
  // 40% of the plate's area spent on empty pixels — and the plate is blitted every frame.
  const padX = Math.ceil(CC * 0.56);
  const padY = Math.ceil(CC * 0.46);
  const W = Math.ceil(halfW * 2 + padX * 2);
  const H = Math.ceil(bot - top + padY * 2);
  const ox = Math.round(W * 0.5);
  const drawOy = Math.round(padY - top);
  // `lift` moves the ANCHOR ROW, not the drawing, so the layout above stays untouched
  // and a one-line lockup simply reports its anchor lower down its own plate.
  const oy = drawOy + Math.round(lift);

  const cv = newCanvas(W, H);
  const g = cv.getContext('2d');
  g.translate(ox, drawOy);

  // NO radial backdrop. Round 1 pooled a dark ellipse behind the lockup at alpha 0.40
  // and on clean turf it read as a smudge on the lens. No bar panel has one; the
  // legibility comes from each line's own halo, which follows the letters.

  const jobs = [];

  /**
   * Every line is spent over FOUR slices — mask, short fringe, long hairs, paint — with
   * the live mask parked in ink.js's scratch pool in between. That is safe only because
   * the slices are strictly sequential and nothing else in the piece bakes between them.
   *
   * Round 1 gave line 2 three slices and painted line 1, the numerals and PTS whole; the
   * measured spread was 3.7 / 2.1 / 2.5 / 2.3 for line 2 against 6.3-7.8 for line 1 in
   * one go, so the WHOLE-LINE jobs were the tall poles. Four slices each puts every step
   * of every lockup under 5 ms at 1:1 and under 1.5 ms at the runtime raster.
   */
  function pushLine(spec) {
    let st = null;
    jobs.push(() => { st = inkMask(faces, spec); });
    jobs.push(() => { st.step(0); });
    jobs.push(() => { st.step(1); });
    jobs.push(() => { st.step(2); });
    jobs.push(() => { inkPaint(g, faces, spec, st); st = null; });
  }

  // CONDENSING THINS THE STEMS, so the erosion that trims them has to condense with it.
  // `slimX` is a fixed fraction of the CAP, but a stem's width is a fraction of the cap
  // times `cond` — so at LEVELER!'s 0.87 the same 4.7 px came off a stem that was 13%
  // narrower to begin with and the word rendered visibly lighter than TRUCK! beside it.
  const slim2 = INK.line2.slimX * cond, slimY2 = INK.line2.slimY * cond;

  /* ---- line 1: always warm white, quieter shadow ---- */
  if (l1) {
    pushLine(Object.assign({}, INK.line1, {
      text: A.l1, layout: l1, path: linePath(faces, l1), capH: cc1,
      x: x1, y: y1, rampKey: 'white', seed: hash(seed, 1),
      slimX: INK.line1.slimX * cond,
    }));
  }

  /* ---- line 2: the loud one ---- */
  if (l2) {
    const glow = A.key === 'goldLine' ? { color: GOLD_GLOW, blur: 0.22, alpha: 0.09 } : null;
    pushLine(Object.assign({}, INK.line2, {
      text: A.l2, layout: l2, path: linePath(faces, l2), capH: CC,
      x: x2, y: y2, rampKey: A.key, seed: hash(seed, 2), glow,
      slimX: slim2, slimY: slimY2,
      taper: INK.line2.taper * (0.35 + 0.65 * cond),
      entry: INK.line2.entry * (0.35 + 0.65 * cond),
    }));
  }

  /* ---- points line: gold numerals + smaller PTS ---- */
  if (ln) {
    const xNumLeft = xP - wPts2 * 0.5;
    pushLine(Object.assign({}, INK.num, {
      text: numTxt, layout: ln, path: linePath(faces, ln), capH: ccN,
      x: xNumLeft + ln.width * 0.5, y: yNum, rampKey: 'gold', seed: hash(seed, 3),
      glow: { color: GOLD_GLOW, blur: 0.24, alpha: 0.11 },
    }));
    if (lp) {
      const xPtsLeft = xNumLeft + ln.width + GEO.ptsGap * ccN;
      pushLine(Object.assign({}, INK.pts, {
        text: 'PTS', layout: lp, path: linePath(faces, lp), capH: ccP,
        x: xPtsLeft + lp.width * 0.5, y: yNum - GEO.ptsLift * ccN, rampKey: 'gold',
        seed: hash(seed, 4),
        glow: { color: GOLD_GLOW, blur: 0.24, alpha: 0.09 },
      }));
    }
  }
  // The scratch surfaces are six plate-sized canvases; they are not part of the
  // backing store the piece is budgeted for, so they go back at the end of every bake.
  jobs.push(() => releaseScratch());

  return {
    cv, ox, oy, w: W, h: H,
    raster,
    capH: CC,
    halfW,
    top: top - padY * 0.5,
    bot: bot + padY * 0.5,
    jobs, at: 0, done: false,
  };
}

/** Run exactly one slice of a planned lockup. Returns true when the plate is finished. */
export function stepLockup(rec) {
  if (!rec || rec.done) return true;
  const j = rec.jobs[rec.at++];
  if (j) j();
  if (rec.at >= rec.jobs.length) { rec.done = true; rec.jobs = null; }
  return rec.done;
}

/** Plan and paint in one go — the synchronous path, used when nobody pre-warmed. */
export function bakeLockup(faces, state, opts) {
  const rec = beginLockup(faces, state, opts);
  while (!stepLockup(rec));
  return rec;
}

/* ------------------------------------------------------------------- cache */
//
// Backing store. The lockup is 20% larger this round, so a one-line plate is 751 x 504
// (1.51 MB) and a two-line plate 743 x 528 (1.57 MB); the LRU holds two, i.e. ~3.1 MB
// worst case. Round 1 held EIGHT plates at 1.5-2.2 MB, up to ~16 MB.

const CACHE = new Map();
const ORDER = [];
const MAX = 2;

function keyOf(faces, state, opts) {
  const A = accentFor(state);
  const scale = (opts && opts.scale) || 1;
  const raster = (opts && opts.raster) || 1;
  return `${faces && faces.piece}|${A.l1}|${A.l2}|${state.pts | 0}|${A.key}`
    + `|${scale.toFixed(3)}|${raster.toFixed(3)}|${(opts && opts.seed) | 0}`;
}

function put(key, v) {
  CACHE.set(key, v);
  ORDER.push(key);
  while (ORDER.length > MAX) {
    const k = ORDER.shift();
    const old = CACHE.get(k);
    if (old && old.cv) { old.cv.width = 1; old.cv.height = 1; }
    CACHE.delete(k);
  }
}

export function lockupFor(faces, state, opts) {
  const key = keyOf(faces, state, opts);
  const v = CACHE.get(key);
  if (v) return v;
  const rec = bakeLockup(faces, state, opts);
  put(key, rec);
  return rec;
}

/**
 * One slice of a pre-warm. Returns true when this lockup's plate is complete and in the
 * cache. Only FINISHED plates ever enter the cache, so `lockupFor` can never hand the
 * frame path a half-painted lockup.
 */
let PENDING = null;
export function warmStep(faces, state, opts) {
  const key = keyOf(faces, state, opts);
  if (CACHE.has(key)) { if (PENDING && PENDING.key === key) PENDING = null; return true; }
  if (!PENDING || PENDING.key !== key) PENDING = { key, rec: beginLockup(faces, state, opts) };
  if (stepLockup(PENDING.rec)) { put(key, PENDING.rec); PENDING = null; return true; }
  return false;
}

export function clearCache() {
  CACHE.clear();
  ORDER.length = 0;
  PENDING = null;
}

export default { bakeLockup, beginLockup, stepLockup, lockupFor, warmStep, GEO };
