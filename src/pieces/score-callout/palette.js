// PIECE: score-callout — the colour system for the lockups.
//
// ROUND 2. Every value below is now a MEASURED mean off the bar, not a sampled pair of
// endpoints. Threshold the ink out of the panel, average it, and average the top third
// against the bottom third:
//
//   panel-truck    TRUCK!    mean rgb (192,187,180)   top/bottom value swing  5.6%
//   panel-midair   MID-AIR   mean rgb (215,210,202)   swing 4.9%
//   panel-midair   MURDER!   mean rgb (167, 21, 18)   swing 8.8%
//   panel-truck    150 PTS   mean rgb (222,184,  1)   swing 2.6%
//   panel-midair   250 PTS   mean rgb (224,189,  2)   swing 0.1%
//
// Two things fall straight out of that and both were wrong in round 1.
//   * The bar's ink is FLAT. A 25-45% top-to-bottom sweep — which is what round 1's
//     ramps plus its "crown" pass added up to — is a plastic web button, not paint.
//     Every ramp here now swings <= 11% end to end and the crown pass is gone.
//   * The gold's BLUE channel is 1-2, not 26. A lemon-to-orange ramp with blue in it
//     desaturates to brass; the bar's numerals are a single saturated yellow.

export const RAMPS = {
  // Warm paper-white. NOT #ffffff — a flat pure white is the instant "canvas text" tell.
  white: [
    [0.00, '#efeade'],
    [0.42, '#e6e0d3'],
    [0.78, '#dcd5c6'],
    [1.00, '#d2cbba'],
  ],
  // Blood red.
  red: [
    [0.00, '#c22320'],
    [0.42, '#b81b18'],
    [0.78, '#ad1514'],
    [1.00, '#a21211'],
  ],
  // Rich gold for the numerals. Blue pinned near zero — that is what makes it read as
  // saturated gold rather than brass.
  gold: [
    [0.00, '#eec20a'],
    [0.45, '#e8bd01'],
    [1.00, '#dcb100'],
  ],
  // Slightly deeper gold for a display LINE (CATCH!) rather than a numeral.
  goldLine: [
    [0.00, '#eabd0a'],
    [0.45, '#e2b501'],
    [1.00, '#d4a700'],
  ],
};

/** Ink keyline — a very dark plum-black. Only the gold numerals wear one. */
export const OUTLINE = 'rgba(26,15,10,0.82)';
/** Shadow base — dark, faintly warm, never pure black. */
export const SHADOW_RGB = '9,6,7';

/** Warm halo behind the gold numerals. */
export const GOLD_GLOW = 'rgba(255,178,26,0.85)';
export const RED_GLOW = 'rgba(226,44,32,0.55)';

export function ramp(c2d, key, y0, y1) {
  const stops = RAMPS[key] || RAMPS.white;
  const g = c2d.createLinearGradient(0, y0, 0, y1);
  for (let i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
  return g;
}

export default { RAMPS, OUTLINE, SHADOW_RGB, GOLD_GLOW, RED_GLOW, ramp };
