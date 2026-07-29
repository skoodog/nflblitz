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
// sits inside 194 px (35.5 mm), leaving ~4.5 mm of margin for a panel whose CSS pixel is
// slightly larger than an iPhone's.
//
// ==========================================================================
// AND THE SECOND BUDGET, WHICH THE FIRST ONE HID: THE SCREEN IS ONLY SO WIDE.
//
// Anchoring in CSS px fixed reach, and then quietly broke something else. Both thumbs'
// clusters are anchored to their own corner, so the SPACE BETWEEN THEM is not a constant —
// it is `0.96 * W` minus a constant. The previous table spent 370 px of that, which is
// fine at 390 (4.4 px left over) and is a 24.4 px OVERLAP at 360, the most common Android
// CSS width. `zoneAt()` scans in table order with STICK first, so STICK simply won:
// 31% of the PASS pad at 360 and 13% at 375 (iPhone SE / 8 / 13-mini) started a thumbstick
// drag instead of raising the receivers. A reach budget in millimetres cannot see that,
// because both controls were comfortably reachable — they were just the same pixels.
//
// So there are two budgets and the layout has to satisfy both:
//   REACH   each control within 40 mm of its thumb pivot          — a PHYSICAL limit
//   WIDTH   the two clusters plus real gaps within 0.96 * W       — a PIXEL limit
//
// The rows below are solved for both at 360 CSS px, which is the narrowest surface a
// fixed CSS-px layout can carry: the drawn stick well alone is 124 px across and the
// right-hand cluster needs 202, and 124 + 202 + gaps is already most of 0.96 * 360.
//
// BELOW 360 THE SURFACE IS GENUINELY TOO SMALL and no table of constants fixes it, so
// `layoutZones` applies ONE UNIFORM SCALE, `min(1, min(W,H) / 360)`, to every number in
// the table. Uniform, and keyed on the NARROW dimension, so that:
//   * the geometry stays similar — every gap and every reach scales by the same factor,
//     and nothing can cross anything else that it did not cross at the reference size;
//   * a device gets the SAME layout in portrait and in landscape, because min(W,H) is the
//     same number for 320x568 and 568x320. That is the property the previous round's
//     fractional layout lost (44.4 mm portrait / 55.3 mm landscape), and it is preserved
//     here for the same reason: nothing is a fraction of an AXIS.
//   * every surface at or above 360 — 360x640, 375x667, 390x844, 414x896, 430x932 and
//     every landscape of those — is at scale exactly 1 and therefore byte-identical.
// The scale is exported as `FIT.scale` because `draw.js` has to scale the ARTWORK by the
// same number; artwork that did not scale with its hit rectangle would put a 124 px well
// inside a 110 px pad, which is the drawn-here / hit-tested-there bug in a new costume.
// ==========================================================================

import { ZONE, TUNING } from './tuning.js';

/** 40 mm at 0.18333 mm per CSS px. The number every row below is built to satisfy. */
export const REACH_PX = 218;
/** Physical size of a CSS pixel on a 390 pt / 71.5 mm panel. Reporting only. */
export const MM_PER_CSSPX = 71.5 / 390;

/**
 * The narrow dimension the CSS-px table is solved for. At or above this the table is
 * used verbatim; below it everything scales uniformly. 360 rather than 390 because 360
 * is the most common Android CSS width and the table has to be exact there, not scaled.
 */
export const FIT_REF_PX = 360;

/**
 * The uniform scale currently in force, published for `draw.js` (artwork) and for the
 * reach report. A one-field object rather than a `let` export so readers see the live
 * value without a function call on the frame path.
 */
export const FIT = { scale: 1 };

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
 * THE ARTWORK IS NEVER LARGER THAN THE HIT RECTANGLE. A button that looks bigger than it
 * is, is a button that misses; a button that looks smaller than it is, is a button that
 * forgives. ACTION, PASS and TURBO each keep 2-4 px of forgiving margin on every side.
 * STICK is the one row where artwork and hit rectangle are EXACTLY equal (124 px), which
 * is the boundary case and not an accident: the capture pad had to give up width to clear
 * the PASS pad at 360 CSS px, and the drawn well's own diameter is the floor it stopped
 * at. One pixel narrower and the idle ghost would be promising a pad that is not there.
 */
const SHAPE_PAD = 0, SHAPE_LOZENGE = 1, SHAPE_WELL = 2;

const LAYOUT = [
  // zone          side  dx    dy   halfW halfH  artW  artH  shape
  [ZONE.STICK, 'L', 62, 118, 62, 118, 124, 124, SHAPE_WELL],
  [ZONE.ACTION, 'R', 54, 150, 52, 52, 96, 96, SHAPE_PAD],
  [ZONE.PASS, 'R', 162, 106, 40, 42, 76, 76, SHAPE_PAD],
  [ZONE.TURBO, 'R', 54, 50, 52, 22, 100, 36, SHAPE_LOZENGE],
];

/**
 * THE WIDTH BUDGET, WRITTEN OUT, because it is the constraint that was violated silently
 * and it should not be possible to violate it silently again. The two clusters are
 * anchored to pivots 0.96 * W apart, so the horizontal demand is a constant:
 *
 *   STICK.dx + STICK.halfW  +  PASS.dx + PASS.halfW   =  62 + 62 + 162 + 40  =  326 px
 *
 * and the STICK-to-PASS gap is `0.96 * W * (scale) - 326 * scale`. At the reference the
 * narrowest surface that matters is 360: 345.6 - 326 = 19.6 px. Every wider surface has
 * more. `minZoneGap()` asserts the result rather than trusting this arithmetic, at six
 * widths in both orientations, in the self-test.
 */
export const WIDTH_DEMAND_PX = 62 + 62 + 162 + 40;

export const SHAPES = Object.freeze({ PAD: SHAPE_PAD, LOZENGE: SHAPE_LOZENGE, WELL: SHAPE_WELL });

/**
 * WHY THIS PARTICULAR ARRANGEMENT, in one paragraph each.
 *
 * STICK is a 124 x 236 px CAPTURE PAD flush against the lower-left corner, not a circle.
 *   A floating stick's pad is the region in which the thumb is ALLOWED to land; making it
 *   the size of the drawn well is the classic mistake, because then the player has to aim
 *   at the well and the "floating" buys nothing. Its centre is 133 px (24.4 mm) from the
 *   left pivot, which is where a relaxed left thumb already rests.
 *
 *   IT USED TO BE 176 px WIDE and that is the number that had to go. 176 put its right
 *   edge 24 px INSIDE the PASS pad at 360 CSS px, and because a wider capture pad is only
 *   ever a convenience while a PASS pad that starts a thumbstick drag is a broken throw,
 *   the pad gave up the width. 124 px is exactly the drawn well's diameter, so the pad is
 *   now precisely as large as the thing the player can see — the smallest it can be
 *   without the artwork over-promising, and every pixel of it is live.
 *
 * TURBO is the closest control to the right pivot at 74 px (13.5 mm) and it is a WIDE
 *   LOZENGE rather than a disc. It is the most-held control in the game — in an arcade
 *   football game the thumb lives on turbo — so it gets the shortest reach and the
 *   largest cross-section along the axis the thumb actually swings on.
 *
 * ACTION sits directly above it at 159 px (29.2 mm), which is the top of the right thumb's
 *   comfortable arc. It is the biggest disc on screen (96 px = 17.6 mm drawn, 104 px hit)
 *   because it carries seven meanings through gesture and every one of them has to land.
 *   TURBO and ACTION share a dx, so they are one COLUMN against the right edge with 26 px
 *   of clear glass between them: two controls the thumb finds by height alone.
 *
 * PASS sits inboard at 194 px (35.5 mm) — the furthest control in the layout and the
 *   only one near the budget. That is the right control to spend the reach on: it is
 *   pressed once per play from a standing start, never held, never in traffic, whereas
 *   TURBO and ACTION are pressed under pressure and got the near positions. It clears
 *   BOTH members of the right-hand column by 16 px horizontally — not by 2.0 px of
 *   corner-to-corner luck, which is what the previous table left between PASS and TURBO
 *   and is 0.37 mm, i.e. touching, for two controls whose consequences are "throw the
 *   ball" and "sprint".
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

  // ONE uniform scale, keyed on the NARROW dimension so a device gets the same layout in
  // both orientations, and never above 1 so that every surface the table was solved for
  // uses the table verbatim. See the long note at the top of this file.
  const S = Math.min(1, Math.min(W, H) / FIT_REF_PX);
  FIT.scale = S;

  for (let i = 0; i < LAYOUT.length; i++) {
    const row = LAYOUT[i];
    const zone = row[0], side = row[1];
    const dx = row[2] * S, dy = row[3] * S, halfW = row[4] * S, halfH = row[5] * S;
    const artW = row[6] * S, artH = row[7] * S, shape = row[8];

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
 * THE RECTANGLES ARE DISJOINT BY CONSTRUCTION and that is now checked at SIX WIDTHS IN
 * BOTH ORIENTATIONS rather than assumed: `minZoneGap()` below returns the smallest gap
 * between any two rectangles, and the self-test fails if it is ever below 12 px at
 * 320 / 360 / 375 / 390 / 414 / 430 CSS px, portrait and landscape. The previous version
 * of that check ran at exactly two sizes, both of them wide enough to pass, which is why
 * a 24 px overlap at 360 shipped: an assertion evaluated only where it holds is not an
 * assertion. Overlapping zones make the answer depend on table ORDER — this loop returns
 * the FIRST match — which is a silent way for a control to stop being pressable.
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

/**
 * zonePairGaps(w, h) -> every pair's gap in CSS px, worst first: [zoneA, zoneB, gapPx].
 * Reporting only — this is what the self-test prints so a failure names the two controls
 * that touched rather than just a number. Allocates; never called during play.
 */
export function zonePairGaps(w, h) {
  layoutZones(w, h);
  const W = Math.max(16, w), H = Math.max(16, h);
  const out = [];
  for (let i = 0; i < ZONE_RECTS.length; i++) {
    for (let j = i + 1; j < ZONE_RECTS.length; j++) {
      const a = ZONE_RECTS[i], b = ZONE_RECTS[j];
      const gx = Math.max(b[1] * W - a[3] * W, a[1] * W - b[3] * W);
      const gy = Math.max(b[2] * H - a[4] * H, a[2] * H - b[4] * H);
      out.push([a[0], b[0], Math.max(gx, gy)]);
    }
  }
  out.sort((p, q) => p[2] - q[2]);
  return out;
}

export default {
  ZONE_RECTS, ZONE_HOMES, ZONE_ART, PIVOT, SHAPES, FIT, FIT_REF_PX, WIDTH_DEMAND_PX,
  REACH_PX, MM_PER_CSSPX, TUNING,
  layoutZones, zoneAt, reachReport, minZoneGap, zonePairGaps,
};
