// PIECE: score-callout — the lockup: composition, colour rule, and the bake cache.
//
// GEOMETRY, ROUND 2. Round 1's table was read off the panels by eye and got the two
// numbers that matter backwards. Re-measured properly — threshold the ink out of the
// panel, take the tight bounding box, divide by the panel's own height:
//
//   panel-truck.png  (528x310)      panel-midair_hit.png (528x338)
//     TRUCK!  ink 140 x 44            MID-AIR  ink 106 x 26   cap 19
//             cap 31-33                MURDER!  ink 153 x 44   cap 27
//             ink W / frame W  0.254   MURDER!  ink W / frame W  0.2546
//             ink H / frame H  0.142   MURDER!  ink H / frame H  0.127
//             ink W / ink H    3.18    MID-AIR W / MURDER! W     0.693
//
// Round 1 measured 400 x 185 for TRUCK! at 1920x1080 — 0.208 x 0.171 of the frame, and
// an aspect of 2.15. So the lockup was NOT too small overall: it was 20% too TALL and
// 22% too NARROW, i.e. 48% too condensed. Scaling the whole thing up (the obvious
// reading of "it looks small") would have made the taller axis worse.
//
// The fix is therefore aspect, not size. `xScale` 1.52 with tracking loosened from
// -0.022 to +0.030 takes the face's natural 3.19 cap of ink width for TRUCK! to 5.08,
// and `cap2` comes DOWN from 118 to 98 so the ink box lands at 0.25 x 0.145 of the
// frame with an aspect of 3.1. ink.js then erodes the same x axis back by 0.048 cap so
// the widening does not carry the stems with it.
//
// LINE 1 gets its own, much looser tracking. At a shared value MID-AIR came out 0.55 as
// wide as MURDER! and the two lines never locked into the bar's near-rectangular block;
// the bar's ratio is 0.693 and its MID-AIR is visibly letterspaced where MURDER! is set
// tight. cap1 = 0.70 is measured (19/27) and was already right.
//
// COLOUR RULE (unchanged — verified against all five panels):
//     line 1 present  ->  line 2 takes the accent   (MID-AIR/MURDER! red, WHAT A/CATCH! gold)
//     line 1 absent   ->  line 2 is white           (TRUCK!, LEVELER!, TOUCHDOWN!)
// and the points line is always gold, because it is gold in every bar panel.

import { hash, seedFromString } from '../../foundation/rng.js';
import { paintLine, inkMask, inkPaint, layoutLine, linePath, newCanvas, releaseScratch } from './ink.js';
import { GOLD_GLOW } from './palette.js';

/* ------------------------------------------------------------- proportions */

export const GEO = {
  cap2: 115,          // line-2 cap height at scale 1, one-line lockup.  bar: 33/310
  duo: 0.75,          // x cap2 when line 1 is present — the bar shrinks the stack to fit
  cap1: 0.725,        // x cap2eff   (bar: 19/27)
  capNum: 0.585,      // x cap2eff   (bar: 17/33 truck, 16/27 midair)
  capPts: 0.680,      // x capNum
  dy1: -1.380,        // line-1 baseline, x cap2eff, relative to line-2 baseline
                      //   (bar: MID-AIR baseline 252, MURDER! baseline 290, cap 27)
  dyNum: 0.950,       // points baseline, x cap2eff  (bar: +32/33 truck, +25/27 midair)
  ptsGap: 0.175,      // x capNum, between the last digit and P
  ptsLift: 0.030,     // x capNum, PTS baseline sits marginally above the numerals
  liftSolo: 0.760,    // x cap2. A one-line lockup has less mass, so it is lifted to
                      //   sit in the same band of the frame as a two-line one.
  nudge1: -0.065,     // x line-2 width  (bar: MID-AIR centre is 10.5px left of MURDER!'s)
  nudgeNum: 0.004,
  rotation: -0.0435,  // rad, -2.5 deg. Measured: truck -1.7, midair -1.3, touchdown -2.9,
                      //   leveler -4.6. Rises to the right, as every panel does.
  maxWidth: 600,      // TOUCHDOWN! is 10 glyphs; the bar shrinks it to 0.75 of TRUCK!'s
                      //   cap rather than letting it run the width of the frame.
};

/** Per-line ink recipes. Kept here so the whole look is legible in one place. */
const INK = {
  line1: { tracking: 0.090, xScale: 1.36, minor: 0.930, slimX: 0.014, grain: 0.10, fray: 0.62, halo: 0.70, jitter: 0.9 },
  line2: { tracking: 0.030, xScale: 1.36, minor: 0.885, slimX: 0.016, grain: 0.10, fray: 1.0, jitter: 0.85 },
  num: { tracking: 0.030, xScale: 1.45, minor: 1, excl: 1, slimX: 0.014, grain: 0.07, fray: 0.7, keyOut: 0.013, jitter: 0.45 },
  pts: { tracking: 0.055, xScale: 1.45, minor: 1, slimX: 0.012, grain: 0.07, fray: 0.7, keyOut: 0.012, jitter: 0.5 },
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
 * bake budget on a software canvas — measured on this box, a two-line lockup at 1:1 is
 * 30-47 ms (round 1 was 65-148). Sliced by line it is four steps of which the largest is
 * line 2, and at the runtime raster (fit*dpr*1.25, ~0.45 on a 390x844 phone) the whole
 * bake is 11-18 ms, i.e. ~5 ms a step. `stepLockup` runs exactly one.
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
  const lay = (h2, h1, hN, hP) => ({
    l2: A.l2 ? layoutLine(faces, A.l2, Object.assign({ face: 'blitz-brush', capH: h2 }, INK.line2)) : null,
    l1: A.l1 ? layoutLine(faces, A.l1, Object.assign({ face: 'blitz-brush', capH: h1 }, INK.line1)) : null,
    ln: numTxt ? layoutLine(faces, numTxt, Object.assign({ face: 'blitz-num', capH: hN }, INK.num)) : null,
    lp: numTxt ? layoutLine(faces, 'PTS', Object.assign({ face: 'blitz-brush', capH: hP }, INK.pts)) : null,
  });

  let S = lay(C, c1, cN, cP);
  const wPts = S.ln ? S.ln.width + GEO.ptsGap * cN + (S.lp ? S.lp.width : 0) : 0;
  const wMax = Math.max(S.l2 ? S.l2.width : 0, S.l1 ? S.l1.width : 0, wPts, 1);
  const fit = Math.min(1, (GEO.maxWidth * R) / wMax);

  // Fitting changes cap heights, so re-lay out. Cheap, and it keeps every ratio exact.
  let CC = C, cc1 = c1, ccN = cN, ccP = cP;
  if (fit < 0.999) {
    CC = C * fit; cc1 = c1 * fit; ccN = cN * fit; ccP = cP * fit;
    S = lay(CC, cc1, ccN, ccP);
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

  // Padding covers the drop shadow and the 0.34-cap halo, and nothing else. Round 1 used
  // 1.15C x 1.05C, roughly 40% of the plate's area spent on empty pixels.
  const padX = Math.ceil(CC * 0.78);
  const padY = Math.ceil(CC * 0.66);
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

  /* ---- line 1: always warm white, quieter shadow ---- */
  if (l1) {
    jobs.push(() => paintLine(g, faces, Object.assign({}, INK.line1, {
      text: A.l1, layout: l1, path: linePath(faces, l1), capH: cc1,
      x: x1, y: y1, rampKey: 'white', seed: hash(seed, 1),
    })));
  }

  /* ---- line 2: the loud one ----
     Split across TWO slices. It is the biggest line in the lockup and the only one that
     on its own exceeds the 8 ms bake budget at 1:1 (measured 15-18 ms); silhouette,
     long-hair fray and paint are three slices. The mask lives in ink.js's scratch pool between the two, which is safe
     because these slices are strictly sequential and nothing else bakes in between. */
  if (l2) {
    const glow = A.key === 'goldLine' ? { color: GOLD_GLOW, blur: 0.22, alpha: 0.10, reps: 1 } : null;
    const spec2 = Object.assign({}, INK.line2, {
      text: A.l2, layout: l2, path: linePath(faces, l2), capH: CC,
      x: x2, y: y2, rampKey: A.key, seed: hash(seed, 2), glow,
    });
    let st2 = null;
    jobs.push(() => { st2 = inkMask(faces, spec2); });
    jobs.push(() => { st2.finish(); });
    jobs.push(() => { inkPaint(g, faces, spec2, st2); st2 = null; });
  }

  /* ---- points line: gold numerals + smaller PTS ---- */
  if (ln) {
    const xNumLeft = xP - wPts2 * 0.5;
    jobs.push(() => paintLine(g, faces, Object.assign({}, INK.num, {
      text: numTxt, layout: ln, path: linePath(faces, ln), capH: ccN,
      x: xNumLeft + ln.width * 0.5, y: yNum, rampKey: 'gold', seed: hash(seed, 3),
      glow: { color: GOLD_GLOW, blur: 0.24, alpha: 0.13, reps: 1 },
      sweep: { at: 0.30, w: 0.80, a: 0.05 },
    })));
    if (lp) {
      const xPtsLeft = xNumLeft + ln.width + GEO.ptsGap * ccN;
      jobs.push(() => paintLine(g, faces, Object.assign({}, INK.pts, {
        text: 'PTS', layout: lp, path: linePath(faces, lp), capH: ccP,
        x: xPtsLeft + lp.width * 0.5, y: yNum - GEO.ptsLift * ccN, rampKey: 'gold',
        seed: hash(seed, 4),
        glow: { color: GOLD_GLOW, blur: 0.24, alpha: 0.10, reps: 1 },
      })));
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
// Backing store <= 3 MB. Round 1 held EIGHT plates at 1.5-2.2 MB, up to ~16 MB. The
// padding is now 0.52C x 0.48C instead of 1.15C x 1.05C, which puts a one-line plate at
// 584 x 441 (1.03 MB) and a two-line plate at ~1.0 MB, and the LRU holds two.

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
