// PIECE menu-playcall — the colour system, MEASURED off bar/panel-defense_playcall.png.
//
// HOW THESE NUMBERS WERE GOT. The panel is 528x310 with the concept sheet's light
// panel frame at row y=3 and columns x=4..5, so the artwork interior starts at (6,4)
// and is 522x306. Every colour below is a real pixel read out of that interior with
// PIL (there is no image library on this box; python3+PIL is, and the reads are in the
// build log). The panel is a DOWNSCALE of the concept render, so small ink is
// area-averaged and reads dimmer than the art intends — where that is the case it is
// said so and the shipped value is lifted, with the measured value kept next to it.
//
//   card interior      (5,5,5) .. (7,7,7)      flat near-black, no gradient at all
//   card border        (69,45,77) (85,54,82)   violet-grey, corners flare to (157,45,160)
//   card LEFT RAIL     (172,16,105) (205,39,181)  magenta, on EVERY card, not just the
//                                              selected one — checked on cards 1 and 2
//   gutter between     (4,5,13) (6,4,23)       the black carries a blue-violet cast
//   above the grid     (0,0,3) (2,2,6)         nearly pure black at the header
//   headline ink peak  (180,182,181)           NEUTRAL white, not the callout's warm one
//   clock ink peak     (198,154,24) (201,153,15)  gold, blue channel near zero
//   chip gradient      (16,27,85) -> (43,31,123) -> (5,28,61), gone by panel x=325
//   name ink peak      150..170 mean           i.e. NOTHING above 170 in an 80x30 box;
//                                              the plate type is small and downscaled
//
// WHY THE SHIPPED VALUES ARE BRIGHTER THAN THE READS. A 528-wide panel of a 1920-wide
// frame is a 3.53x downscale: a 3 px stroke in the art becomes a 0.85 px stroke in the
// panel and loses ~40% of its peak to its neighbours. The headline read 182 and ships
// at 232; the name plate read <=170 and ships at 230. The HUES are taken as measured —
// those survive downscaling — and only the levels are lifted.

/** Base black of the screen. Carries the blue-violet cast measured in the gutters. */
export const BG = '#04050b';
export const BG_DEEP = '#010104';

/** Card plate. Flat, because the bar's is flat: interior std over an 80x40 box is ~1. */
export const CARD_FILL = '#070709';
export const CARD_FILL_SEL = '#120814';
export const CARD_EDGE = '#4a3050';
export const CARD_EDGE_HI = '#9d2da0';
export const CARD_RAIL = '#cd27b5';
export const CARD_RAIL_HOT = '#ff54d8';

/** Type. */
export const INK = '#e8eaee';          // headline, neutral (measured 180,182,181)
export const INK_DIM = '#8d93a4';
export const NAME = '#e6e8ec';
export const GOLD = '#edb424';         // clock (measured 199,154,19 after downscale)
export const GOLD_DEEP = '#a5760a';

/** The formation chip's left-to-right ramp, straight off the panel. */
export const CHIP_A = '#2b1f7b';
export const CHIP_B = '#051c3d';

/**
 * SLOT COLOUR IS IDENTITY, NOT EMPHASIS. The same receiver slot is the same hue on
 * every one of the 18 offensive cards, so a player learns "the magenta one is the
 * split end" once and it holds across the whole sheet. The primary read is marked by
 * a RING and a brighter bead, never by a different hue — otherwise the hue would mean
 * two things at once and neither would be learnable.
 */
export const SLOT = {
  REC1: '#ff3fa8',
  REC2: '#35c8ff',
  REC3: '#57e06a',
  QB: '#e8eaee',
  OL: '#5b6070',
};

/**
 * Defensive assignment classes. Eight assignment strings appear in the data
 * (rush/man/press/spy/contain/zone_flat/zone_hook/zone_deep) and they collapse to
 * four families a player has to tell apart at a glance:
 *   red      coming after the passer
 *   magenta  chasing a man (press is the same job, one shade up, done at the line)
 *   cyan     sitting in a zone (the three depths differ by bubble size, not hue)
 *   green    watching, not committing (spy)
 * Orange is kept for `contain` — no play in the shipped book uses it, but the schema
 * allows it and a card that silently dropped an assignment would be a lie.
 */
export const ASSIGN = {
  rush: '#ff3b30',
  man: '#ff3fa8',
  press: '#ff8ad6',
  spy: '#57e06a',
  contain: '#ffa42b',
  zone_flat: '#35c8ff',
  zone_hook: '#35c8ff',
  zone_deep: '#35c8ff',
};

export const ZONE_FILL = 'rgba(53,200,255,0.13)';
export const ZONE_EDGE = 'rgba(53,200,255,0.40)';

/** The offence shown behind a defensive card: present, but never competing. */
export const GHOST = 'rgba(150,158,175,0.42)';
export const LOS = 'rgba(196,206,224,0.55)';
export const YARD_RULE = 'rgba(150,170,210,0.10)';

export function hex2rgb(h) {
  let s = String(h).replace('#', '');
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgba(c, a) {
  const v = Array.isArray(c) ? c : hex2rgb(c);
  return `rgba(${v[0] | 0},${v[1] | 0},${v[2] | 0},${a})`;
}
export function mix(a, b, t) {
  const A = Array.isArray(a) ? a : hex2rgb(a);
  const B = Array.isArray(b) ? b : hex2rgb(b);
  return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
}

export default { BG, CARD_FILL, CARD_EDGE, CARD_RAIL, INK, GOLD, SLOT, ASSIGN };
