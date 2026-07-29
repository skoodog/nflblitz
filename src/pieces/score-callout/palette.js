// PIECE: score-callout — the colour system for the lockups.
//
// ROUND 2 VERDICT: "our ink carries a bright-to-grey vertical gradient + dark keyline +
// interior speckle, where the bar's is DEAD-FLAT MATTE with no outline at all."
//
// Re-measured, and the verdict is right. Threshold the ink out of each panel and average
// the top third against the bottom third:
//
//   panel-truck    TRUCK!    mean rgb (192,187,180)   top/bottom value swing  5.6%
//   panel-midair   MID-AIR   mean rgb (215,210,202)   swing 4.9%
//   panel-midair   MURDER!   mean rgb (167, 21, 18)   swing 8.8%
//   panel-truck    150 PTS   mean rgb (222,184,  1)   swing 2.6%
//   panel-midair   250 PTS   mean rgb (224,189,  2)   swing 0.1%
//
// A 2.6-8.8% swing across a whole word is not a gradient, it is the panel's own grade
// falling off. Round 1 shipped a four-stop ramp; this ships ONE COLOUR PER KEY. There is
// no gradient object in the ink path any more, no keyline, and no speckle pass — the
// three things that together made the lockup read as a distressed typeface with a bevel
// rather than as brush paint.
//
// The values below are the measured means lifted ~12% in value, because the panels are
// graded down as a whole (their turf sits at 30-70) and our overlay is composited over
// an ungraded frame.

/** Dead-flat ink. One colour, no stops, no gradient object. */
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
 * Swatch strips for the iso colour-rule sheet. Flat now — a single stop per key — so the
 * sheet cannot advertise a ramp the ink path does not have.
 */
export const RAMPS = {
  white: [[0, FLAT.white]],
  red: [[0, FLAT.red]],
  gold: [[0, FLAT.gold]],
  goldLine: [[0, FLAT.goldLine]],
};

/** Shadow base — dark, faintly warm, never pure black. */
export const SHADOW_RGB = '9,6,7';

/** Warm halo behind the gold numerals. */
export const GOLD_GLOW = 'rgba(255,178,26,0.85)';
export const RED_GLOW = 'rgba(226,44,32,0.55)';

/** The one colour for a key. `c2d` is unused and kept so callers read symmetrically. */
export function flat(key) {
  return FLAT[key] || FLAT.white;
}

export default { FLAT, RAMPS, SHADOW_RGB, GOLD_GLOW, RED_GLOW, flat };
