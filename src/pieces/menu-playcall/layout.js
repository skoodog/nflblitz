// PIECE menu-playcall — geometry. Every constant here is either measured off the bar
// or derived from a measurement with the derivation written down.
//
// THE BAR PANEL, MEASURED. bar/panel-defense_playcall.png is 528x310. The concept
// sheet's light panel frame sits at row y=3 and columns x=4..5 (found by scanning for
// rows/cols whose mean luminance exceeds 110 — exactly one row and two columns do), so
// the artwork interior is (6,4)..(528,310) = 522x306. Mapping that interior height onto
// a 1080-tall frame gives
//
//     s = 1080 / 306 = 3.5294 logical px per panel px
//
// and the interior width comes back as 522 * 3.5294 = 1842, i.e. the panel is a 78 px
// horizontal CROP of the 1920 frame, not the whole of it. That is why the x figures
// below are used as PROPORTIONS and the right-hand edge is re-anchored to the 48 px
// safe inset instead of being copied literally: copying it would put the grid's right
// edge at 1757 and leave a 115 px hole that exists only because the panel was cropped.
//
// Edge detection over the tile band (mean |d lum / dx| across rows 70..300) puts the
// card columns' left edges at panel x = 140, 233, 326, 420 — a pitch of 93.33 px — and
// the same scan across rows finds card tops at y = 85 and 179 with the card bottom at
// y = 170, so a bar card is 84 x 86 panel px = 296 x 303 logical, with a 33 px gutter.
// Inside a card the divider between the diagram and the name plate is at y = 131, i.e.
// the plate is 39/86 = 45% of the card height.
//
//     headline ink box   panel x  35..353   y 20..48   ->  logical x 102..1225, cap 99
//     clock  ":09" ink   panel x 433..480   y 23..45   ->  logical cap 78
//     formation chip     panel y  59..85, left edge x=139 (= the grid's left edge)
//
// WHAT THIS PIECE CHANGES, AND WHY. The bar shows EIGHT cards in a 4x2. The shipped
// playbook is 18 offensive plays in TWO PAGES OF NINE plus 9 defensive plays, so the
// grid here is 3x3 — one grid that serves all three sheets. Three columns across the
// same right-hand region make the card wider and shorter than the bar's: 436 x 241
// against 296 x 303. The name plate therefore drops from 45% of the card to 33% (80 of
// 241 px), because the plate's job is to hold one line of type and the extra height is
// worth more to the diagram, which now has to carry real route geometry rather than a
// decorative dot cluster.
//
// The left rail (x < 504) is left to the character render behind the overlay. In the
// bar the linebacker occupies panel x 0..140 = logical 0..473; the grid starts at 504.

export const W = 1920;
export const H = 1080;

/** Bar-panel constants, kept so a critic can audit the derivations above. */
export const BAR = {
  panel: [528, 310],
  interiorOrigin: [6, 4],
  interior: [522, 306],
  scale: 1080 / 306,
  headlineInk: [35, 20, 353, 48],
  clockInk: [433, 23, 480, 45],
  chipBand: [139, 59, 438, 85],
  cardCols: [140, 233, 326, 420],
  cardRows: [85, 179],
  card: [84, 86],
  cardDivider: 131,
};

/** Header. The headline's cap height and baseline come straight off the bar. */
export const HEAD = {
  x: 102,                    // bar: panel x=35 -> 102 logical
  capTop: 56,                // bar: panel y=20
  capBot: 155,               // bar: panel y=48  -> cap height 99
  size: 104,                 // brush-italic point size that lands a 99 px cap (measured)
  clockRight: 1872,          // re-anchored to the safe inset; see the crop note above
  clockSize: 84,
  bandBot: 176,
};

/** Formation chip, sitting on the grid's left edge exactly as the bar's does. */
export const CHIP = {
  x: 504,
  y: 182,
  h: 62,
  w: 470,
  fade: 900,                 // the ramp is dead by here, as in the bar (panel x=325)
};

/**
 * THE GRID. 3 x 3. Right edge lands on the 48 px safe inset (1872) and the bottom on
 * 1039, which leaves the bottom safe inset (1044) clear.
 *   504 + 3*436 + 2*30 = 1872
 *   262 + 3*241 + 2*27 = 1039
 */
export const GRID = {
  x: 504, y: 262,
  cw: 436, ch: 241,
  gx: 30, gy: 27,
  cols: 3, rows: 3,
};

export function cellRect(i) {
  const col = i % GRID.cols;
  const row = (i / GRID.cols) | 0;
  return {
    x: GRID.x + col * (GRID.cw + GRID.gx),
    y: GRID.y + row * (GRID.ch + GRID.gy),
    w: GRID.cw, h: GRID.ch,
  };
}

/** Inside a card: the diagram box and the name plate. */
export const CARD = {
  radius: 14,
  rail: 6,                   // bar: 2 panel px of magenta = 7 logical; 6 after rounding
  railSel: 12,
  plate: 80,                 // 33% of 241; the bar's is 45% of a much taller card
  pad: 12,
};

export function diagramRect(r) {
  return {
    x: r.x + CARD.rail + CARD.pad,
    y: r.y + CARD.pad,
    w: r.w - CARD.rail - CARD.pad * 2,
    h: r.h - CARD.plate - CARD.pad,
  };
}
export function plateRect(r) {
  return { x: r.x + CARD.rail, y: r.y + r.h - CARD.plate, w: r.w - CARD.rail, h: CARD.plate };
}

/**
 * THE DEPTH MAPPING — one curve for all 27 cards, so two cards are comparable.
 *
 * The book's routes run from -4 yards (the QB's drop) to +44 (HAIL MARY). A linear
 * map that fits 44 yards into the 100 px above the line of scrimmage gives DOG HOOK's
 * 9-yard route 20 px of travel, which is not a diagram, it is a smudge. Per-card
 * normalisation fixes the smudge and breaks the comparison: two cards would then use
 * two different scales and the deep shot would look like the hook.
 *
 * So depth is compressed by a single power curve, shared by every card:
 *
 *     up  = (yards / 44) ^ 0.62      (fraction of the height above the LOS)
 *     down= (|yards| / 8) ^ 0.90     (fraction of the height below it)
 *
 * Measured against the shipped book, that puts the nine route depths at
 *   9 yd -> 37% of the field box, 14 -> 49%, 21 -> 63%, 27 -> 72%, 34 -> 84%, 44 -> 100%
 * which keeps every play distinguishable from its neighbour while the bomb still
 * visibly out-runs the hook. The exponent was chosen by printing that table for 0.5,
 * 0.62 and 0.75 and taking the one where the shallowest play still cleared a third of
 * the box (0.5 gave 45% and flattened the deep half; 0.75 gave 30% and crowded the
 * short plays into the LOS).
 */
export const MAX_DEPTH = 44;
export const MAX_BACK = 8;
export const DEPTH_POW = 0.62;
export const BACK_POW = 0.90;

/** Half-width of the field actually drawn, in yards. The widest point in the book is
 *  SPLIT's -20 and SUBZERO's -18/+15; 22 keeps the widest route inside the card with a
 *  little air, and the same value is used on every card. */
export const HALF_WIDTH = 22;
