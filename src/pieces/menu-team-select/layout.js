// PIECE menu-team-select — THE GEOMETRY, and where every number in it came from.
//
// ============================ HOW THE BAR WAS READ ============================
//
// bar/panel-team_select.png is 480 x 310. That is NOT 16:9 (1.548 vs 1.778), so the
// panel cannot be mapped to 1920x1080 by one scalar. Two things were taken from it
// and they are taken differently:
//
//   PROPORTIONS   fractions of panel width / panel height, mapped independently onto
//                 1920 / 1080. Used for the vertical rhythm (title band, card band,
//                 stat rows) because that is what the eye reads as "the layout".
//   ASPECTS       the card's own w/h ratio, kept as a ratio, because stretching it to
//                 fill the wider frame would turn a portrait card into a square one.
//
// The extra 230 logical px of width that 16:9 buys over the panel's aspect are spent
// on the paging chevrons and the division rail, neither of which the panel has room
// for. That is a deliberate deviation and it is listed at the bottom of this header.
//
// MEASUREMENT METHOD. Threshold + edge-walk over the panel (a column is a card border
// if its mean luminance over the card band exceeds both neighbours 3 px away by 18):
//
//   card left borders    x =  25.0  137.5  250.0  362.0
//   card right borders   x = 127.5  240.5  353.0  464.5
//   -> card width 102.8 +/- 0.3    pitch 112.4 +/- 0.3    gap 9.6
//   card top / bottom    y =  56.5 / 284.5   -> height 228.0
//   -> CARD ASPECT 102.8 / 228.0 = 0.451
//
//   gold stat-bar ink rows (R>140, G>110, B<110, R-B>70):
//     228..238   248..257   267..276      -> 3 rows, 10 px tall, pitch 19.5
//   nickname underline glow row           217..221
//   nickname ink                          199..214
//   city ink                              188..196
//   title ink                             y 10..41, x 111..321
//   title flanking rules                  y 39, x 56..110 and 322..422
//
//   As fractions of the CARD box (top 56.5, height 228.0):
//     city ink      0.578 .. 0.613
//     nick ink      0.626 .. 0.691
//     underline     0.704 .. 0.722
//     bar rows      0.752 / 0.840 / 0.923      bar height 0.045
//     bar track x   0.40w .. 0.94w             label x 0.06w
//
// The gold bars in the art are SEGMENTED, not solid: counting blocks in the 6x crop
// of card 0 gives 11 cells per track (9 lit on SPEED, 7 on HIT POWER, 5 on TURBO).
// SEGMENTS = 11 below is that count, not a guess.
//
// ========================= TOUCH: THE SIZING CONSTRAINT =======================
//
// The runtime overlay CONTAIN-fits the logical 1920x1080 onto the device, so a
// logical pixel is worth very little on a phone. touch-controller/layout.js pins the
// physical scale at MM_PER_CSSPX = 0.18333 (1 mm = 5.4546 CSS px).
//
//     844 x 390 landscape phone   fit = min(844/1920, 390/1080) = 0.3611
//     -> 1 logical px = 0.3611 CSS px = 0.0662 mm
//     -> a 9 mm minimum target = 49.1 CSS px = 136 LOGICAL px
//
// So no interactive element in this screen is under 140 logical px on its short
// axis. That is why the division rail is 145 tall rather than the 90 it would like
// to be, and why the chevrons carry a 140 x 340 hit rect around a 74 px glyph.
// `hitTargets()` returns the real rectangles and `reachReport()` converts them to
// millimetres; iso_team_select_touch draws both so the claim can be audited.
//
// ============================== DEVIATIONS =====================================
//
//  1. 4 cards at 356 x 655 instead of the panel's 102.8 x 228.0 scaled (which would
//     be 411 x 796 and would leave no room for anything else). Aspect 0.543 against
//     the panel's 0.451 — the cards are 20% wider in proportion. Chosen because the
//     real nicknames run to PHILADELPHIA / BUCCANEERS / COMMANDERS where the concept
//     art only ever had to fit STRYKERS.
//  2. A STAR PLAYER line inserted between the underline and the stat rows. It pushes
//     the three bar rows from 0.752/0.840/0.923 of the card down to 0.782/0.861/0.940.
//  3. A division rail (145 tall) and paging chevrons, neither in the panel.

export const W = 1920;
export const H = 1080;

/* --------------------------------------------------------------- the frame */

export const HEAD = {
  titleCap: 88,          // 0.100 * 1080 would be 108; 88 keeps the ink inside safe-top
  titleBase: 132,        // baseline
  ruleY: 126,            // the flanking rules sit near the baseline, as in the panel
  ruleGap: 46,           // clear space between title ink and each rule
  ruleX0: 178,           // outer end of the left rule
  subCap: 26,
  subBase: 186,
};

export const CARD = { w: 356, h: 655, gap: 28, y: 210, r: 20 };
export const COLS = 4;
export const CARDS_W = COLS * CARD.w + (COLS - 1) * CARD.gap;      // 1508
export const CARDS_X = Math.round((W - CARDS_W) / 2);              // 206
/** The selected card is lifted; the lift is part of the layout, not an animation. */
export const LIFT = 14;

export function cardX(i) { return CARDS_X + i * (CARD.w + CARD.gap); }

/* ------------------------------------------------------- inside a card box */
// All values are logical px relative to the card's top-left. Fractions of the card
// height are quoted so they can be checked against the panel numbers above.

export const C = {
  pad: 20,
  crest: { x: 28, y: 12, s: 300 },        // 300 square, centred (356-300)/2 = 28
  cityBase: 372,                          //  0.568
  cityCap: 22,
  nickBase: 428,                          //  0.654 (ink top 384/0.586)
  nickCap: 44,
  ruleY: 444,                             //  0.678  the club-colour underline
  ruleH: 10,
  starBase: 490,                          //  0.748
  starCap: 22,
  barY: [512, 564, 616],                  //  0.782 / 0.861 / 0.940
  barH: 28,
  labelX: 20,                             //  0.056w   (panel 0.06w)
  trackX: 142,                            //  0.399w   (panel 0.400w)
  trackW: 194,                            //  ends at 336 = 0.944w (panel 0.94w)
};

export const SEGMENTS = 11;
export const STAT_KEYS = ['speed', 'hitPower', 'turbo'];
export const STAT_LABELS = ['SPEED', 'HIT POWER', 'TURBO'];

/* ------------------------------------------------------------------- rail */

export const RAIL = {
  x: 80, y: 895, w: 1760, h: 145, gap: 14, r: 10,
  get tabW() { return (this.w - 7 * this.gap) / 8; },   // 207.75
};

export function tabX(i) { return RAIL.x + i * (RAIL.tabW + RAIL.gap); }

/* --------------------------------------------------------------- chevrons */

export const CHEV = { w: 140, h: 340, glyph: 74 };
export const CHEV_L = { x: 46, y: CARD.y + (CARD.h - CHEV.h) / 2, w: CHEV.w, h: CHEV.h };
export const CHEV_R = { x: W - 46 - CHEV.w, y: CHEV_L.y, w: CHEV.w, h: CHEV.h };

/* ------------------------------------------------------------ hit targets */

/**
 * Every rectangle a finger may land on, in LOGICAL coordinates, in hit-test order
 * (first match wins). The card rectangles are the un-lifted boxes: a selected card
 * is drawn 14 px higher but its target must not move under the thumb when it does.
 */
export function hitTargets() {
  const out = [];
  out.push({ id: 'page-prev', kind: 'chevron', ...CHEV_L });
  out.push({ id: 'page-next', kind: 'chevron', ...CHEV_R });
  for (let i = 0; i < COLS; i++) {
    out.push({ id: `card-${i}`, kind: 'card', slot: i, x: cardX(i), y: CARD.y, w: CARD.w, h: CARD.h });
  }
  for (let i = 0; i < 8; i++) {
    out.push({ id: `div-${i}`, kind: 'division', slot: i, x: tabX(i), y: RAIL.y, w: RAIL.tabW, h: RAIL.h });
  }
  return out;
}

export function hitAt(x, y) {
  const t = hitTargets();
  for (const r of t) if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return r;
  return null;
}

/** touch-controller/layout.js's physical constant. One CSS px is this many mm. */
export const MM_PER_CSSPX = 0.18333;

/**
 * reachReport(cssW, cssH) — every hit target's physical size on a given surface.
 * `fit` is the overlay's own contain-fit, reproduced here rather than assumed, so
 * the numbers move with foundation/overlay.js if it ever changes.
 */
export function reachReport(cssW, cssH) {
  const fit = Math.min(cssW / W, cssH / H);
  const mm = fit * MM_PER_CSSPX;
  return {
    cssW, cssH, fit, mmPerLogicalPx: mm,
    targets: hitTargets().map((r) => ({
      id: r.id, kind: r.kind,
      wmm: r.w * mm, hmm: r.h * mm,
      short: Math.min(r.w, r.h) * mm,
    })),
  };
}

export default {
  W, H, HEAD, CARD, COLS, CARDS_W, CARDS_X, LIFT, cardX, C, SEGMENTS,
  STAT_KEYS, STAT_LABELS, RAIL, tabX, CHEV, CHEV_L, CHEV_R,
  hitTargets, hitAt, reachReport, MM_PER_CSSPX,
};
