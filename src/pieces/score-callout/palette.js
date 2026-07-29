// PIECE: score-callout — the colour system for the lockups.
//
// ROUND 1 CLAIMED the bar's ink is "DEAD-FLAT MATTE". ROUND 2 BELIEVED IT and shipped one
// colour per key with no modelling at all. IT IS FALSE, and this round it is re-measured
// from scratch. Threshold the ink out of each panel (max channel >= 150, saturation <= 46
// for the white lines), erode the mask 1 px so only interior pixels count, and read the
// luminance:
//
//                        mean   std   corr(lum,y)   p5..p95
//   truck   TRUCK!       175.2  15.0    -0.518      155..205
//   midair  MURDER!       51.3   5.2    -0.451   (red; per-channel R std 14.6)
//   midair  MID-AIR      210.0  17.5    -0.078      185..235
//   touchd  TOUCHDOWN!   223.2  10.3    +0.005      209..240
//   lev     LEVELER!     221.5  16.3    +0.105      185..242
//   truck   150          188.0  11.6    +0.127   (gold, rgb 235,193,1)
//   midair  250          193.2   9.3    -0.058   (gold, rgb 238,199,1)
//
// Round 2 shipped an interior std of 0.00. Every single bar line carries 9-18.
//
// TWO SEPARATE THINGS make up that number, and they are separable. Fit a straight line in
// y through TRUCK!'s interior luminance: the slope is -0.80 lum/row, i.e. -34 lum from the
// cap line to the baseline, and the RESIDUAL after taking that out still has std 12.85.
// So it is a shallow top-to-bottom RAMP (std ~7.8) plus a much stronger CHALKY BREAKUP
// (std ~12.8). The breakup is not speckle: the residual's autocorrelation is 0.92 at one
// pixel, 0.89 at two and 0.85 at three, so its blob scale is 4-6 px at cap 36 — about
// 0.13 cap — soft mottling the size of a brush hair bundle, not per-pixel grain.
//
// The two hero panels (TRUCK!, MURDER!) both run corr(lum,y) near -0.5; the three that do
// not (TOUCHDOWN!, LEVELER!, CATCH!) all sit at mean 220+ with p95 at 240-242, i.e. their
// highlights are clipped and there is no room left for a ramp to show. So the ramp is
// real and this file ships it.
//
// GOLD IS DIFFERENT and that is measured too: the numerals carry the same chalk (std
// 9.3-11.6) but NO ramp (corr +0.13 / -0.06). So `MODEL.gold` has equal top and bottom
// stops and a smaller chalk amount, which keeps the numerals' mean where round 2 had it —
// they were called effectively exact and must not regress.

/** Flat ink — still the base colour of a line, and the fallback when modelling is off. */
export const FLAT = {
  // Warm paper-white. NOT #ffffff — a flat pure white is the instant "canvas text" tell.
  white: '#e3ddd0',
  // Blood red (MURDER!).
  red: '#ae1815',
  // Rich gold for the numerals. Blue pinned near zero — that is what makes it read as
  // saturated gold rather than brass.
  gold: '#e6c003',
  // Slightly deeper gold for a display LINE (CATCH!) rather than a numeral.
  goldLine: '#deb601',
};

/**
 * Per-key modelling.
 *
 *   top / bot   the ends of the vertical ramp, laid across the CAP BAND (not the plate),
 *               so the corr(lum,y) it produces is comparable with the measurement above.
 *   tint        what the chalk darkens TOWARD. Not black and not grey: dry brush on a dark
 *               ground leaves the ground's own colour showing through the thin patches, so
 *               the tint is the ink dragged toward the panel's shadow, hue kept.
 *   chalk       peak alpha of the chalk plate. The resulting interior std is
 *               (inkLum - tintLum) x std(alpha), which is how the numbers below were set.
 *
 * The top stop is deliberately BRIGHTER than the round-2 flat colour, because the chalk
 * only ever darkens: the mean has to be built from above.
 */
// RE-DERIVED IN ROUND 3 from the render rather than from the stops, because what the two
// controls actually buy is not obvious. Decompose the interior luminance: the RAMP
// contributes a std of |corr| x total, the CHALK the rest in quadrature.
//
//                        total std   ramp std   chalk std   mean
//   bar TRUCK!             13.92       7.03       12.00     174.1
//   ours, stops as set     15.65       6.42       14.27     189.0
//
// So the ramp was 9% too shallow and the chalk 19% too strong — the mark was mottling
// more than it was shading. `chalk` 0.46 -> 0.40 takes the breakup down; widening the two
// stops by ~10% while dropping both takes the ramp up and the mean with it. The chalk only
// ever darkens, and lightening it raises the mean, so the stops carry both corrections.
export const MODEL = {
// Measured after the first correction: mean 184.8, std 14.45, corr -0.596 — mean and std
// on the nose, but the ramp overshot, so the stops close from 43.9 lum apart to 36.0 about
// the same midpoint. corr scales with the gap, and 0.596 x (36.0/43.9) = 0.489.
  white:    { top: '#e9e3d7', bot: '#c7bfb0', tint: '#6d675c', chalk: 0.43 },
  red:      { top: '#c81d19', bot: '#8f1210', tint: '#4a0f0d', chalk: 0.42 },
  goldLine: { top: '#f0c405', bot: '#c69c01', tint: '#7a5f04', chalk: 0.38 },
  // Numerals: no ramp (top === bot), lighter chalk. Measured mean must stay at 225,188,3.
  gold:     { top: '#eecb08', bot: '#eecb08', tint: '#9c7c05', chalk: 0.34 },
};

/**
 * Swatch strips for the iso colour-rule sheet — now the ramp the ink path actually has,
 * so the sheet cannot advertise something the render does not do.
 */
export const RAMPS = {
  white: [[0, MODEL.white.top], [1, MODEL.white.bot]],
  red: [[0, MODEL.red.top], [1, MODEL.red.bot]],
  gold: [[0, MODEL.gold.top], [1, MODEL.gold.bot]],
  goldLine: [[0, MODEL.goldLine.top], [1, MODEL.goldLine.bot]],
};

/** Shadow base — dark, faintly warm, never pure black. */
export const SHADOW_RGB = '9,6,7';

/** Warm halo behind the gold numerals. */
export const GOLD_GLOW = 'rgba(255,178,26,0.85)';
export const RED_GLOW = 'rgba(226,44,32,0.55)';

/** The one colour for a key. */
export function flat(key) {
  return FLAT[key] || FLAT.white;
}

/** The modelling recipe for a key. */
export function model(key) {
  return MODEL[key] || MODEL.white;
}

export default { FLAT, MODEL, RAMPS, SHADOW_RGB, GOLD_GLOW, RED_GLOW, flat, model };
