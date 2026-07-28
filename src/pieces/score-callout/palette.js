// PIECE: score-callout — the colour system for the lockups.
//
// Every ramp below was sampled off the bar panels rather than invented:
//   bar/panel-midair_hit.png  MURDER!   body #a81010 .. #b81810
//   bar/panel-touchdown.png   200       body #e0b000 .. #f0c800
//   bar/panel-touchdown.png   TOUCHDOWN body #d0d0d0 .. #e8e8e8
//   bar/panel-midair_hit.png  MID-AIR   body #d0c8c0 .. #e8e8e0   (warmer than TD's)
//   bar/panel-catch.png       CATCH!    body #d0a800 .. #e0b800
//
// The ramps are deliberately NARROW. The bar's ink reads as one colour with a shade
// of modelling in it, not as a gradient; a wide top-to-bottom sweep is the single
// fastest way to turn hand lettering into a plastic web button.

export const RAMPS = {
  // Warm paper-white. NOT #ffffff — a flat pure white is the instant "canvas text" tell.
  white: [
    [0.00, '#f9f6ee'],
    [0.26, '#ece8e0'],
    [0.60, '#ded8ce'],
    [0.88, '#cbc4b8'],
    [1.00, '#bab3a7'],
  ],
  // Blood red.
  red: [
    [0.00, '#c41e19'],
    [0.24, '#b71613'],
    [0.58, '#a91112'],
    [0.86, '#980e11'],
    [1.00, '#860b0f'],
  ],
  // Rich gold for the numerals: bright crown, amber belly.
  gold: [
    [0.00, '#fddc41'],
    [0.18, '#f7cc12'],
    [0.48, '#efbe00'],
    [0.80, '#e0a600'],
    [1.00, '#c98a00'],
  ],
  // Slightly deeper gold for a display LINE (CATCH!) rather than a numeral.
  goldLine: [
    [0.00, '#f6d132'],
    [0.20, '#eabf0e'],
    [0.52, '#dfb000'],
    [0.84, '#cf9c00'],
    [1.00, '#ba8300'],
  ],
};

/** Ink keyline — a very dark plum-black. Pure #000 reads as clip-art. */
export const OUTLINE = 'rgba(20,12,18,0.88)';
/** Shadow base — dark, faintly violet, never pure black. */
export const SHADOW_RGB = '7,4,10';

/** Warm halo behind the gold numerals. */
export const GOLD_GLOW = 'rgba(255,172,26,0.85)';
export const RED_GLOW = 'rgba(226,44,32,0.55)';

export function ramp(c2d, key, y0, y1) {
  const stops = RAMPS[key] || RAMPS.white;
  const g = c2d.createLinearGradient(0, y0, 0, y1);
  for (let i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
  return g;
}

export default { RAMPS, OUTLINE, SHADOW_RGB, GOLD_GLOW, RED_GLOW, ramp };
