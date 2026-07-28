// PIECE: score-callout — the colour system for the lockups.
//
// Every ramp below was sampled off the bar panels rather than invented:
//   bar/panel-midair_hit.png  MURDER!  body  #a81010 .. #b81810
//   bar/panel-touchdown.png   200      body  #e0b000 .. #f0c800
//   bar/panel-touchdown.png   TOUCHDOWN body #d0d0d0 .. #e8e8e8
//   bar/panel-midair_hit.png  MID-AIR  body  #d0c8c0 .. #e8e8e0   (warmer than TD's)
// so the ramps bracket the sampled body value and carry the hot rim / deep foot that
// the panel's own dynamic range clips off.

/** Vertical ink ramps, top -> bottom of the cap band. */
export const RAMPS = {
  // Warm paper-white. NOT #ffffff: a flat pure white is the instant "canvas text" tell.
  white: [
    [0.00, '#fffdf6'],
    [0.14, '#f1eee6'],
    [0.45, '#ddd7cc'],
    [0.78, '#c4bdb1'],
    [1.00, '#a49c91'],
  ],
  // Blood red. Hot rim at the very top, deep oxblood foot.
  red: [
    [0.00, '#f4705f'],
    [0.09, '#dd2c22'],
    [0.34, '#c11715'],
    [0.66, '#a41012'],
    [0.88, '#8a0b0f'],
    [1.00, '#6d080d'],
  ],
  // Rich gold. Bright yellow crown, amber belly, burnt-orange foot.
  gold: [
    [0.00, '#fff5b8'],
    [0.08, '#ffdd4e'],
    [0.28, '#f7c604'],
    [0.55, '#eaad00'],
    [0.80, '#d38700'],
    [1.00, '#b06803'],
  ],
  // Slightly deeper gold for a display LINE (CATCH!) rather than a numeral.
  goldLine: [
    [0.00, '#ffeea4'],
    [0.10, '#f9d13a'],
    [0.32, '#eeb903'],
    [0.62, '#dfa000'],
    [0.86, '#c47c00'],
    [1.00, '#a15f02'],
  ],
};

/** Ink outline — a very dark plum-black. Pure #000 reads as clip-art. */
export const OUTLINE = 'rgba(19,11,17,0.94)';
/** Shadow base — dark, faintly violet, never pure black. */
export const SHADOW_RGB = '7,4,10';

/** Warm halo behind the gold numerals. */
export const GOLD_GLOW = 'rgba(255,176,32,0.85)';
export const RED_GLOW = 'rgba(226,44,32,0.62)';

export function ramp(c2d, key, y0, y1) {
  const stops = RAMPS[key] || RAMPS.white;
  const g = c2d.createLinearGradient(0, y0, 0, y1);
  for (let i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
  return g;
}

export default { RAMPS, OUTLINE, SHADOW_RGB, GOLD_GLOW, RED_GLOW, ramp };
