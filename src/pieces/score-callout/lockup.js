// PIECE: score-callout — the lockup: composition, colour rule, and the bake cache.
//
// GEOMETRY, ROUND 2. Re-measured with one threshold applied to both sides — ink is a
// pixel whose max channel is over 150 and whose saturation is under 46, tight bbox, no
// background inside the window:
//
//   panel-truck.png (528x310)   TRUCK!    140 x 45   W/frame 0.265   W/H 3.11
//   panel-leveler   (410x376)   LEVELER!  176 x 44   W/frame 0.429   W/H 4.00
//   panel-touchdown (382x376)   TOUCHDOWN 210 x 60   W/frame 0.550   W/H 3.50
//   panel-midair    (528x338)   MID-AIR+MURDER! 173 x 68 (both lines)
//
// The three panels have three different aspect ratios, so "fraction of frame WIDTH" is
// not comparable between them. Normalised to a 16:9 frame by ink width / frame HEIGHT
// they agree closely: truck 0.452, leveler 0.468, touchdown 0.559 — i.e. a single-line
// callout is about half the frame height wide, and 0.12-0.16 of the frame height tall.
//
// Round 1 shipped 479 x 139 (core) at 1920x1080 = 0.2495 x 0.129, W/H 3.45 — i.e. the
// LETTERFORMS were already close, and the reported 2.51 aspect came from 74 px of dark
// drips inflating the bbox to 479 x 213 (see ink.js). What was genuinely short was
// SCALE. This round takes cap2 from 115 to 138 and xScale from 1.36 to 1.46, which puts
// TRUCK! at ~617 x 168 = 0.321 x 0.156 of the frame with W/H 3.67 — 21% larger than the
// bar's own truck panel in linear terms, sitting between panel-truck's 0.452 and
// panel-touchdown's 0.559 on the height-normalised axis.
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
  cap2: 138,          // line-2 cap height at scale 1, one-line lockup.  bar: 33/310
  duo: 0.82,          // x cap2 when line 1 is present — the bar shrinks the stack to fit
                      //   (bar: MURDER! cap 27 against TRUCK! cap 31 = 0.87)
  cap1: 0.725,        // x cap2eff   (bar: 19/27)
  capNum: 0.585,      // x cap2eff   (bar: 17/33 truck, 16/27 midair)
  capPts: 0.680,      // x capNum
  dy1: -1.380,        // line-1 baseline, x cap2eff, relative to line-2 baseline
                      //   (bar: MID-AIR baseline 252, MURDER! baseline 290, cap 27)
  dyNum: 0.950,       // points baseline, x cap2eff  (bar: +32/33 truck, +25/27 midair)
  ptsGap: 0.175,      // x capNum, between the last digit and P
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
  maxWidth: 800,      // TOUCHDOWN! is 10 glyphs. The bar's TOUCHDOWN! is 1.21x its
                      //   TRUCK! on the height-normalised axis; 800 against TRUCK!'s 595
                      //   is 1.34, and the rest of the difference is taken out of the x
                      //   axis by `condense` rather than off the cap.
  condense: 0.80,     // floor on the horizontal squeeze an over-long line may take before
                      //   any of the overflow comes off its cap height.
};

/**
 * Per-line ink recipes. Kept here so the whole look is legible in one place.
 *
 * slimY — the thick/thin contrast lever — is on LINE 2 ONLY. It costs a fixed 2 px off
 * every horizontal, so what matters is the cap it is spent against, and line 1 is the
 * SMALL line: on the hostile sheet (k 0.74) line 1 lands at cap 61 and 2 px took the arm
 * off the T, so "WHAT A" captured as "WHAI A" in all four tiles. Line 2 at its smallest
 * shipped scale is cap 84 and CATCH! survives it; below cap 100 the erosion rounds to
 * zero on its own. This is the same trap round 1 documented and it is real.
 */
const INK = {
  line1: { tracking: 0.078, xScale: 1.47, minor: 0.930, slimX: 0.024, fray: 0.70, taper: 0.050, halo: 0.70, jitter: 0.9 },
  line2: { tracking: 0.016, xScale: 1.50, minor: 0.885, slimX: 0.029, slimY: 0.010, fray: 1.0, taper: 0.058, jitter: 0.85 },
  // ITALIC NUMERALS and NO TAILS. Both are measured: the bar's 150/250 lean with the
  // display line (~0.24, the brush face's own 0.27 taken off a touch because a geometric
  // digit at 15 deg already reads fast) and neither panel's points line has a single
  // filament under it — the drips belong to the brush face, not to the score.
  num: { tracking: 0.026, xScale: 1.44, minor: 1, excl: 1, slant: 0.235, slimX: 0.013, fray: 0, taper: 0, jitter: 0.45 },
  pts: { tracking: 0.030, xScale: 1.44, minor: 1, slimX: 0.014, fray: 0, taper: 0.022, jitter: 0.5 },
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
    jobs.push(() => { inkPaint(g, faces, spec, st); st = null; });
  }

  /* ---- line 1: always warm white, quieter shadow ---- */
  if (l1) {
    pushLine(Object.assign({}, INK.line1, {
      text: A.l1, layout: l1, path: linePath(faces, l1), capH: cc1,
      x: x1, y: y1, rampKey: 'white', seed: hash(seed, 1),
    }));
  }

  /* ---- line 2: the loud one ---- */
  if (l2) {
    const glow = A.key === 'goldLine' ? { color: GOLD_GLOW, blur: 0.22, alpha: 0.09 } : null;
    pushLine(Object.assign({}, INK.line2, {
      text: A.l2, layout: l2, path: linePath(faces, l2), capH: CC,
      x: x2, y: y2, rampKey: A.key, seed: hash(seed, 2), glow,
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
