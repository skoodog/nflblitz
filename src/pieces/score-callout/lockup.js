// PIECE: score-callout — the lockup: composition, colour rule, and the bake cache.
//
// GEOMETRY. Every ratio below is measured off the bar panels, expressed against the
// line-2 cap height C so the whole lockup scales as one object:
//
//   panel-midair_hit.png (528x338, frame height = panel height, scale 1080/338 = 3.195)
//     MURDER!  cap 34.5px -> 110    baseline 292 -> 933
//     MID-AIR  cap 23.0px ->  74    baseline 252 -> 805     (= C*0.67, dy = -1.16*C)
//     250      cap 20.5px ->  66    baseline 317.5 -> 1014  (= C*0.60, dy = +0.74*C)
//     PTS      cap 13.0px ->  42                            (= numeral cap * 0.63)
//   panel-truck.png (528x310, scale 1080/310 = 3.484)
//     TRUCK!   cap 34px -> 118      150 cap 22px -> 77      (= C*0.65)
//
// COLOUR RULE. `shot.callout.accent` is only ever 'red' | 'gold', but the bar shows
// three different line-2 colours across five panels. One rule reproduces all five:
//
//     line 1 present  ->  line 2 takes the accent   (MID-AIR/MURDER! red, WHAT A/CATCH! gold)
//     line 1 absent   ->  line 2 is white           (TRUCK!, LEVELER!, TOUCHDOWN!)
//
// and the points line is always gold with white-hot crown and a warm halo.

import { hash, seedFromString } from '../../foundation/rng.js';
import { paintLine, layoutLine, linePath, newCanvas } from './ink.js';
import { GOLD_GLOW, RED_GLOW, SHADOW_RGB } from './palette.js';

/* ------------------------------------------------------------- proportions */

export const GEO = {
  cap2: 118,          // line-2 cap height at scale 1
  cap1: 0.670,        // x cap2
  capNum: 0.630,      // x cap2
  capPts: 0.660,      // x capNum
  dy1: -1.160,        // line-1 baseline, x cap2, relative to line-2 baseline
  dyNum: 0.840,       // points baseline, x cap2, relative to line-2 baseline
  ptsGap: 0.105,      // x capNum, between the last digit and P
  ptsLift: 0.035,     // x capNum, PTS baseline sits marginally above the numerals
  nudge1: -0.055,     // x line-2 width
  nudgeNum: -0.010,
  rotation: -0.0565,  // rad. Rises to the right, as every panel does.
  maxWidth: 830,
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
 * Bake the whole lockup into one offscreen canvas.
 * Returns { cv, ox, oy, w, h, box } where (ox,oy) is the pixel that carries the
 * lockup's anchor: line-2 centre-x, points-line baseline-y.
 */
export function bakeLockup(faces, state, opts) {
  const A = accentFor(state);
  const pts = state.pts | 0;
  const seed = hash(seedFromString('sc|' + A.l1 + '|' + A.l2 + '|' + pts + '|' + A.key), opts && opts.seed ? opts.seed | 0 : 7);
  const scale = (opts && opts.scale) || 1;

  const C = GEO.cap2 * scale;
  const c1 = GEO.cap1 * C;
  const cN = GEO.capNum * C;
  const cP = GEO.capPts * cN;

  // ---- lay every line out first so the whole lockup can be fitted as one object
  const L2 = A.l2 ? layoutLine(faces, A.l2, { face: 'blitz-brush', capH: C, tracking: -0.018 }) : null;
  const L1 = A.l1 ? layoutLine(faces, A.l1, { face: 'blitz-brush', capH: c1, tracking: -0.004 }) : null;
  const numTxt = pts > 0 ? String(pts) : '';
  const LN = numTxt ? layoutLine(faces, numTxt, { face: 'blitz-num', capH: cN, tracking: -0.012, minor: 1, excl: 1, jitter: 0.45 }) : null;
  const LP = numTxt ? layoutLine(faces, 'PTS', { face: 'blitz-brush', capH: cP, tracking: 0.030, minor: 1, jitter: 0.5 }) : null;

  const wPts = LN ? LN.width + GEO.ptsGap * cN + (LP ? LP.width : 0) : 0;
  const wMax = Math.max(L2 ? L2.width : 0, L1 ? L1.width : 0, wPts, 1);
  const fit = Math.min(1, (GEO.maxWidth * scale) / wMax);

  // Fitting changes cap heights, so re-lay out. Cheap, and it keeps every ratio exact.
  let CC = C, cc1 = c1, ccN = cN, ccP = cP;
  let l2 = L2, l1 = L1, ln = LN, lp = LP;
  if (fit < 0.999) {
    CC = C * fit; cc1 = c1 * fit; ccN = cN * fit; ccP = cP * fit;
    l2 = A.l2 ? layoutLine(faces, A.l2, { face: 'blitz-brush', capH: CC, tracking: -0.018 }) : null;
    l1 = A.l1 ? layoutLine(faces, A.l1, { face: 'blitz-brush', capH: cc1, tracking: -0.004 }) : null;
    ln = numTxt ? layoutLine(faces, numTxt, { face: 'blitz-num', capH: ccN, tracking: -0.012, minor: 1, excl: 1, jitter: 0.45 }) : null;
    lp = numTxt ? layoutLine(faces, 'PTS', { face: 'blitz-brush', capH: ccP, tracking: 0.030, minor: 1, jitter: 0.5 }) : null;
  }

  const w2 = l2 ? l2.width : (ln ? ln.width : 100);
  const yNum = 0;                                  // anchor: points baseline
  const y2 = yNum - GEO.dyNum * CC;
  const y1 = y2 + GEO.dy1 * CC;
  const wPts2 = ln ? ln.width + GEO.ptsGap * ccN + (lp ? lp.width : 0) : 0;

  const x2 = 0;
  const x1 = GEO.nudge1 * w2;
  const xP = GEO.nudgeNum * w2;

  // ---- bounding box in anchor space
  const halfW = Math.max(
    l2 ? l2.width * 0.5 : 0,
    l1 ? l1.width * 0.5 + Math.abs(x1) : 0,
    wPts2 * 0.5 + Math.abs(xP)
  );
  const top = (l1 ? y1 + l1.top : y2 + (l2 ? l2.top : 0)) - CC * 0.30;
  const bot = yNum + (ln ? ln.bot : 0) + CC * 0.30;

  const padX = Math.ceil(CC * 1.15);
  const padY = Math.ceil(CC * 1.05);
  const W = Math.ceil(halfW * 2 + padX * 2);
  const H = Math.ceil(bot - top + padY * 2);
  const ox = Math.round(W * 0.5);
  const oy = Math.round(padY - top);

  const cv = newCanvas(W, H);
  const g = cv.getContext('2d');
  g.translate(ox, oy);

  /* ---- soft dark halo. The bar darkens the field behind every callout; this is
     what lets the lockup punch off turf, crowd or a blown-out light. ---- */
  if (!opts || opts.backdrop !== false) {
    g.save();
    const rx = halfW + CC * 0.95;
    const ry = (bot - top) * 0.52 + CC * 0.42;
    const cyy = (top + bot) * 0.5;
    g.translate(0, cyy);
    g.scale(1, ry / rx);
    const rg = g.createRadialGradient(0, 0, rx * 0.05, 0, 0, rx);
    rg.addColorStop(0.00, `rgba(${SHADOW_RGB},0.40)`);
    rg.addColorStop(0.42, `rgba(${SHADOW_RGB},0.28)`);
    rg.addColorStop(0.74, `rgba(${SHADOW_RGB},0.10)`);
    rg.addColorStop(1.00, `rgba(${SHADOW_RGB},0)`);
    g.fillStyle = rg;
    g.beginPath();
    g.arc(0, 0, rx, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  /* ---- line 1: always warm white, quieter shadow ---- */
  if (l1) {
    paintLine(g, faces, {
      text: A.l1, layout: l1, path: linePath(faces, l1), capH: cc1,
      x: x1, y: y1, rampKey: 'white', seed: hash(seed, 1),
      grain: 0.58, halo: 0.75,
    });
  }

  /* ---- line 2: the loud one ---- */
  if (l2) {
    const glow = A.key === 'red' ? { color: RED_GLOW, blur: 0.30, alpha: 0.30, reps: 2 }
      : A.key === 'goldLine' ? { color: GOLD_GLOW, blur: 0.30, alpha: 0.34, reps: 2 }
        : null;
    paintLine(g, faces, {
      text: A.l2, layout: l2, path: linePath(faces, l2), capH: CC,
      x: x2, y: y2, rampKey: A.key, seed: hash(seed, 2),
      grain: 0.66, glow,
      sweep: A.key === 'white' ? { at: 0.30, w: 0.75, a: 0.16 } : { at: 0.32, w: 0.85, a: 0.22 },
    });
  }

  /* ---- points line: gold numerals + smaller PTS ---- */
  if (ln) {
    const xNumLeft = xP - wPts2 * 0.5;
    paintLine(g, faces, {
      text: numTxt, layout: ln, path: linePath(faces, ln), capH: ccN,
      x: xNumLeft + ln.width * 0.5, y: yNum, rampKey: 'gold', seed: hash(seed, 3),
      grain: 0.42, torn: 0.72, flecks: 0.55, keylineW: 0.080,
      glow: { color: GOLD_GLOW, blur: 0.34, alpha: 0.50, reps: 2 },
      sweep: { at: 0.30, w: 0.70, a: 0.30 },
    });
    if (lp) {
      const xPtsLeft = xNumLeft + ln.width + GEO.ptsGap * ccN;
      paintLine(g, faces, {
        text: 'PTS', layout: lp, path: linePath(faces, lp), capH: ccP,
        x: xPtsLeft + lp.width * 0.5, y: yNum - GEO.ptsLift * ccN, rampKey: 'gold',
        seed: hash(seed, 4), grain: 0.5, torn: 0.85, keylineW: 0.078,
        glow: { color: GOLD_GLOW, blur: 0.34, alpha: 0.34, reps: 1 },
      });
    }
  }

  return {
    cv, ox, oy, w: W, h: H,
    capH: CC,
    halfW,
    top: top - padY * 0.5,
    bot: bot + padY * 0.5,
  };
}

/* ------------------------------------------------------------------- cache */

const CACHE = new Map();
const ORDER = [];
const MAX = 8;

export function lockupFor(faces, state, opts) {
  const A = accentFor(state);
  const scale = (opts && opts.scale) || 1;
  const key = `${faces && faces.piece}|${A.l1}|${A.l2}|${state.pts | 0}|${A.key}|${scale.toFixed(3)}|${(opts && opts.seed) | 0}`;
  let v = CACHE.get(key);
  if (v) return v;
  v = bakeLockup(faces, state, opts);
  CACHE.set(key, v);
  ORDER.push(key);
  while (ORDER.length > MAX) {
    const k = ORDER.shift();
    const old = CACHE.get(k);
    if (old && old.cv) { old.cv.width = 1; old.cv.height = 1; }
    CACHE.delete(k);
  }
  return v;
}

export function clearCache() {
  CACHE.clear();
  ORDER.length = 0;
}

export default { bakeLockup, lockupFor, GEO };
