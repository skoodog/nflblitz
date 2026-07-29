// PIECE touch-controller — THE REACH-FIRST LAYOUT.
//
// REACH IS A PHYSICAL QUESTION AND A FRACTIONAL LAYOUT CANNOT ANSWER IT.
//
// A table of constants in 0..1 of each axis makes every control's distance from the
// thumb pivot a function of the ASPECT RATIO, because the same fraction is a different
// number of millimetres on the long axis than on the short one. That is how a previous
// round shipped a layout that measured
//
//     390x844 portrait   TURBO centre  44.4 mm from the right thumb pivot   (cap 40)
//     844x390 landscape  TURBO centre  55.3 mm from the right thumb pivot   (cap 40)
//
// One layout, one budget, two failures, the landscape one 38% over. No set of fractions
// fixes it, because the two orientations disagree about what a fraction means.
//
// SO THE LAYOUT IS ANCHORED IN CSS PIXELS to the two bottom-corner thumb pivots and
// converted to fractions for whatever surface is actually in front of the player. The
// same PHYSICAL geometry comes out at every aspect ratio, and the reach table below is
// therefore the same table in portrait and in landscape — which is exactly what you want
// from a number that is supposed to describe a thumb.
//
// THE BUDGET, IN PIXELS. A 390-pt-wide phone panel is 71.5 mm across, so one CSS px is
// 0.18333 mm and the 40 mm thumb-reach cap is 218.2 CSS px. `scripts/touch.mjs` gates
// BOTH the drawn home point and the hit-rectangle centre against it. Every control below
// sits inside 191 px (34.9 mm), leaving ~5 mm of margin for a panel whose CSS pixel is
// slightly larger than an iPhone's.

import { ZONE, TUNING } from './tuning.js';

/** 40 mm at 0.18333 mm per CSS px. The number every row below is built to satisfy. */
export const REACH_PX = 218;
/** Physical size of a CSS pixel on a 390 pt / 71.5 mm panel. Reporting only. */
export const MM_PER_CSSPX = 71.5 / 390;

/**
 * THE ONE TABLE. Everything — hit rectangles, drawn artwork, and the reach report — is
 * derived from these six numbers per row, so a control's hit region cannot drift away
 * from the thing the player can see. (In a previous round the turbo pad was DRAWN at one
 * position and HIT-TESTED at another, so you could look at a control and press a
 * different one.)
 *
 *   zone, side, dx, dy, halfW, halfH, artW, artH, shape
 *
 * dx is positive INWARD from the near vertical edge, dy positive UPWARD from the bottom.
 * halfW/halfH are the HIT rectangle. artW/artH are the DRAWN size, in CSS px.
 *
 * THE ARTWORK IS SMALLER THAN THE HIT RECTANGLE, DELIBERATELY. A button that looks
 * bigger than it is, is a button that misses; a button that looks smaller than it is, is
 * a button that forgives. It is also a performance number: Canvas2D fill is what the
 * `overlay` span costs, and drawing the artwork at the hit rectangle's size is a
 * straight multiplier on it for no gain a player can see.
 */
const SHAPE_PAD = 0, SHAPE_LOZENGE = 1, SHAPE_WELL = 2;

const LAYOUT = [
  // zone          side  dx    dy   halfW halfH  artW  artH  shape
  [ZONE.STICK, 'L', 88, 118, 88, 118, 124, 124, SHAPE_WELL],
  [ZONE.ACTION, 'R', 56, 150, 52, 52, 96, 96, SHAPE_PAD],
  [ZONE.PASS, 'R', 154, 112, 40, 44, 76, 76, SHAPE_PAD],
  [ZONE.TURBO, 'R', 60, 50, 52, 22, 100, 38, SHAPE_LOZENGE],
];

export const SHAPES = Object.freeze({ PAD: SHAPE_PAD, LOZENGE: SHAPE_LOZENGE, WELL: SHAPE_WELL });

/**
 * WHY THIS PARTICULAR ARRANGEMENT, in one paragraph each.
 *
 * STICK is a 176 x 236 px CAPTURE PAD occupying the whole lower-left corner, not a
 *   circle. A floating stick's pad is the region in which the thumb is ALLOWED to land;
 *   making it the size of the drawn well is the classic mistake, because then the player
 *   has to aim at the well and the "floating" buys nothing. Its centre is 147 px
 *   (27.0 mm) from the left pivot, which is where a relaxed left thumb already rests.
 *
 * TURBO is the closest control to the right pivot at 78 px (14.3 mm) and it is a WIDE
 *   LOZENGE rather than a disc. It is the most-held control in the game — in an arcade
 *   football game the thumb lives on turbo — so it gets the shortest reach and the
 *   largest cross-section along the axis the thumb actually swings on.
 *
 * ACTION sits above it at 160 px (29.4 mm), which is the top of the right thumb's
 *   comfortable arc. It is the biggest disc on screen (96 px = 17.6 mm drawn, 104 px hit)
 *   because it carries seven meanings through gesture and every one of them has to land.
 *
 * PASS sits inboard at 190 px (34.9 mm) — the furthest control in the layout and the
 *   only one near the budget. That is the right control to spend the reach on: it is
 *   pressed once per play from a standing start, never held, never in traffic, whereas
 *   TURBO and ACTION are pressed under pressure and got the near positions.
 */

/** Zone rectangles as fractions of the live surface: [zone, x0f, y0f, x1f, y1f]. */
export const ZONE_RECTS = [
  [ZONE.STICK, 0, 0, 0, 0],
  [ZONE.ACTION, 0, 0, 0, 0],
  [ZONE.PASS, 0, 0, 0, 0],
  [ZONE.TURBO, 0, 0, 0, 0],
];

/** Where each control is DRAWN: [zone, cxFrac, cyFrac]. Reach is gated against these too. */
export const ZONE_HOMES = [
  [ZONE.STICK, 0, 0],
  [ZONE.ACTION, 0, 0],
  [ZONE.PASS, 0, 0],
  [ZONE.TURBO, 0, 0],
];

/**
 * Artwork geometry in CSS PIXELS on the live surface: [zone, cx, cy, w, h, shape].
 * CSS px rather than fractions because `draw()` converts to logical units with the
 * overlay's own fit scale, and a fraction would have to be un-converted first.
 */
export const ZONE_ART = [
  [ZONE.STICK, 0, 0, 0, 0, SHAPE_WELL],
  [ZONE.ACTION, 0, 0, 0, 0, SHAPE_PAD],
  [ZONE.PASS, 0, 0, 0, 0, SHAPE_PAD],
  [ZONE.TURBO, 0, 0, 0, 0, SHAPE_LOZENGE],
];

/** Pivots, in CSS px, for the live surface. Same points `scripts/touch.mjs` uses. */
export const PIVOT = { lx: 0, rx: 0, y: 0 };

/**
 * layoutZones(w, h) — rebuild all four tables for a w x h CSS surface.
 *
 * Allocation-free: every table is mutated in place and rows are read by index rather
 * than destructured, because array destructuring allocates an iterator. This is called
 * on every orientation change, which can happen mid-play.
 */
export function layoutZones(w, h) {
  const W = Math.max(16, w), H = Math.max(16, h);
  const pivotLX = 0.02 * W, pivotRX = 0.98 * W, pivotY = 0.99 * H;
  PIVOT.lx = pivotLX; PIVOT.rx = pivotRX; PIVOT.y = pivotY;

  for (let i = 0; i < LAYOUT.length; i++) {
    const row = LAYOUT[i];
    const zone = row[0], side = row[1];
    const dx = row[2], dy = row[3], halfW = row[4], halfH = row[5];
    const artW = row[6], artH = row[7], shape = row[8];

    const cx = side === 'L' ? pivotLX + dx : pivotRX - dx;
    const cy = pivotY - dy;

    // Clamp the RECTANGLE to the surface. The centre can shift by at most the amount
    // that was hanging off the edge, and the reach check runs against the CLAMPED
    // centre, so the number in the report is the number the player actually gets.
    const x0 = Math.max(0, cx - halfW), x1 = Math.min(W, cx + halfW);
    const y0 = Math.max(0, cy - halfH), y1 = Math.min(H, cy + halfH);

    const r = ZONE_RECTS[i];
    r[0] = zone; r[1] = x0 / W; r[2] = y0 / H; r[3] = x1 / W; r[4] = y1 / H;

    const hm = ZONE_HOMES[i];
    hm[0] = zone; hm[1] = ((x0 + x1) * 0.5) / W; hm[2] = ((y0 + y1) * 0.5) / H;

    const a = ZONE_ART[i];
    a[0] = zone; a[1] = (x0 + x1) * 0.5; a[2] = (y0 + y1) * 0.5;
    a[3] = artW; a[4] = artH; a[5] = shape;
  }
  return ZONE_RECTS;
}
layoutZones(390, 844);

/**
 * zoneAt(x, y, w, h) — which control owns this CSS-px point.
 *
 * THE RECTANGLES ARE DISJOINT BY CONSTRUCTION and that is checked, not assumed:
 * `reachReport()` below returns the minimum gap between any two rectangles, and the
 * self-test in shots/touch-controller/ fails if it is ever <= 0. Overlapping zones would
 * make the answer depend on table ORDER, which is a silent way for a control to stop
 * being pressable after somebody reorders a list.
 */
export function zoneAt(x, y, w, h) {
  const fx = x / Math.max(1, w), fy = y / Math.max(1, h);
  for (let i = 0; i < ZONE_RECTS.length; i++) {
    const r = ZONE_RECTS[i];
    if (fx >= r[1] && fx < r[3] && fy >= r[2] && fy < r[4]) return r[0];
  }
  return ZONE.NONE;
}

/* ------------------------------------------------------------ reach report */

/**
 * reachReport(w, h, out) — distance from the nearest bottom-corner thumb pivot to each
 * control's HOME and to its HIT-RECT CENTRE, in millimetres, for a w x h CSS surface.
 * They are the same point here by construction; both are reported because reporting one
 * and gating the other is how a reach budget quietly stops meaning anything.
 *
 * `out` is a caller-owned array of plain objects. This is NOT on the frame path — it
 * runs in the harness and in the self-test — so readability wins over pooling.
 */
export function reachReport(w, h) {
  layoutZones(w, h);
  const W = Math.max(16, w), H = Math.max(16, h);
  const px = [
    { name: 'left thumb', x: 0.02 * W, y: 0.99 * H },
    { name: 'right thumb', x: 0.98 * W, y: 0.99 * H },
  ];
  const rows = [];
  for (let i = 0; i < ZONE_RECTS.length; i++) {
    const r = ZONE_RECTS[i], hm = ZONE_HOMES[i];
    const cx = ((r[1] + r[3]) * 0.5) * W, cy = ((r[2] + r[4]) * 0.5) * H;
    const hx = hm[1] * W, hy = hm[2] * H;
    let best = Infinity, bestName = '';
    for (const p of px) {
      const d = Math.hypot(cx - p.x, cy - p.y);
      if (d < best) { best = d; bestName = p.name; }
    }
    let bestH = Infinity;
    for (const p of px) {
      const d = Math.hypot(hx - p.x, hy - p.y);
      if (d < bestH) bestH = d;
    }
    rows.push({
      zone: r[0],
      centrePx: best, centreMm: best * MM_PER_CSSPX,
      homePx: bestH, homeMm: bestH * MM_PER_CSSPX,
      pivot: bestName,
      rectPx: [r[1] * W, r[2] * H, r[3] * W, r[4] * H],
    });
  }
  return rows;
}

/** Smallest gap in CSS px between any two hit rectangles. Negative means they overlap. */
export function minZoneGap(w, h) {
  layoutZones(w, h);
  const W = Math.max(16, w), H = Math.max(16, h);
  let best = Infinity;
  for (let i = 0; i < ZONE_RECTS.length; i++) {
    for (let j = i + 1; j < ZONE_RECTS.length; j++) {
      const a = ZONE_RECTS[i], b = ZONE_RECTS[j];
      const ax0 = a[1] * W, ay0 = a[2] * H, ax1 = a[3] * W, ay1 = a[4] * H;
      const bx0 = b[1] * W, by0 = b[2] * H, bx1 = b[3] * W, by1 = b[4] * H;
      const gx = Math.max(bx0 - ax1, ax0 - bx1);
      const gy = Math.max(by0 - ay1, ay0 - by1);
      // Separated on either axis is separated. The gap is the larger of the two.
      const g = Math.max(gx, gy);
      if (g < best) best = g;
    }
  }
  return best;
}

export default {
  ZONE_RECTS, ZONE_HOMES, ZONE_ART, PIVOT, SHAPES,
  REACH_PX, MM_PER_CSSPX, TUNING,
  layoutZones, zoneAt, reachReport, minZoneGap,
};
