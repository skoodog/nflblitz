// PIECE: typeface-lettering — `blitz-brush`
//
// The hand-lettered bold-italic display face: MID-AIR MURDER!, TOUCHDOWN!, TRUCK!,
// WHAT A CATCH!, CHOOSE YOUR CITY, PICK YOUR UNIFORM, DEFENSE! PICK A PLAY.
//
// Authored as brush strokes, not outlines. Every glyph is a small set of centrelines
// with a pressure profile; stroker.js inks them with a broad-nib pen so verticals come
// out heavy, horizontals thin, terminals are chisel-cut, and the edges are torn.
//
// Metrics: unitsPerEm 1000, cap height 700, baseline 0, round overshoot ~+8/-8.
// Ink body sits roughly x = 45..420; nominal advance 480.
// The italic is applied as a shear by the type engine (defaultSlant 0.27 ~= 15 deg),
// which is the angle measured off the bar's "CHOOSE YOUR CITY" and "MID-AIR" stems.

/** Open elliptical ring: one stroke that sweeps past its own start so the fill
 *  resolves to a proper counter under the nonzero rule, and the overlap reads as a
 *  brush join the way the bar's O's do. */
function ring(cx, cy, rx, ry, a0, sweep, n) {
  const p = [];
  for (let i = 0; i <= n; i++) {
    const a = (a0 + sweep * (i / n)) * Math.PI / 180;
    p.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return p;
}

const O_RING = () => ring(236, 350, 124, 352, 104, -368, 26);
const ZERO_RING = () => ring(232, 350, 112, 352, 104, -368, 26);

/* eslint-disable object-curly-newline */
export const BRUSH = {
  ' ': { adv: 300, s: [] },

  A: { adv: 486, s: [
    { p: [[78, 0], [162, 356], [240, 698]], press: [1.02, 1.0, 0.84], c: ['chisel', 'chisel'] },
    { p: [[260, 698], [342, 356], [420, 0]], press: [0.84, 1.0, 1.04], c: ['chisel', 'chisel'] },
    { p: [[132, 208], [356, 234]], w: 0.58, press: [0.95, 1.0, 0.55], c: ['chisel', 'taper'] },
  ] },

  B: { adv: 472, s: [
    { p: [[120, 0], [113, 350], [120, 700]] },
    { p: [[128, 698], [268, 706], [340, 646], [344, 522], [258, 428], [166, 398]], w: 0.78, press: [1.0, 1.0, 0.92, 0.66], c: ['butt', 'taper'] },
    { p: [[136, 398], [292, 408], [386, 320], [374, 138], [258, 8], [148, 2]], w: 0.86, press: [1.0, 1.0, 0.95, 0.6], c: ['butt', 'taper'] },
  ] },

  C: { adv: 462, s: [
    { p: [[404, 556], [332, 672], [206, 708], [110, 604], [90, 350], [122, 106], [236, -8], [356, 44], [400, 148]],
      press: [0.5, 0.95, 1.06, 1.0, 1.0, 0.95, 0.5], c: ['taper', 'taper'] },
  ] },

  D: { adv: 486, s: [
    { p: [[118, 0], [111, 350], [118, 700]] },
    { p: [[126, 700], [280, 702], [378, 626], [406, 420], [392, 152], [286, 12], [124, 2]], w: 0.94, press: [1.0, 1.02, 1.0, 0.95], c: ['butt', 'butt'] },
  ] },

  E: { adv: 452, s: [
    { p: [[124, 0], [117, 350], [124, 700]] },
    { p: [[120, 694], [378, 708]], w: 0.58, press: [1.0, 1.0, 0.55], c: ['butt', 'taper'] },
    { p: [[116, 378], [320, 390]], w: 0.54, press: [1.0, 1.0, 0.55], c: ['butt', 'taper'] },
    { p: [[124, 6], [388, 18]], w: 0.62, press: [1.0, 1.0, 0.55], c: ['butt', 'taper'] },
  ] },

  F: { adv: 432, s: [
    { p: [[124, 0], [117, 350], [124, 700]] },
    { p: [[120, 694], [378, 708]], w: 0.58, press: [1.0, 1.0, 0.55], c: ['butt', 'taper'] },
    { p: [[116, 372], [316, 384]], w: 0.54, press: [1.0, 1.0, 0.55], c: ['butt', 'taper'] },
  ] },

  G: { adv: 494, s: [
    { p: [[404, 556], [332, 672], [206, 708], [110, 604], [90, 350], [122, 106], [236, -8], [368, 52], [406, 168]],
      press: [0.5, 0.95, 1.06, 1.0, 1.0, 1.0, 0.92], c: ['taper', 'butt'] },
    { p: [[406, 168], [402, 302]], w: 0.9, c: ['butt', 'butt'] },
    { p: [[406, 296], [256, 302]], w: 0.6, press: [1.0, 0.6], c: ['butt', 'taper'] },
  ] },

  H: { adv: 496, s: [
    { p: [[118, 0], [111, 350], [118, 700]] },
    { p: [[356, 0], [349, 350], [356, 700]] },
    { p: [[110, 362], [362, 386]], w: 0.56, press: [0.85, 1.0, 0.85], c: ['butt', 'butt'] },
  ] },

  I: { adv: 254, s: [
    { p: [[150, 0], [143, 350], [150, 700]] },
  ] },

  J: { adv: 382, s: [
    { p: [[306, 700], [300, 208], [258, 30], [154, 6], [86, 96]], press: [1.0, 1.0, 0.95, 0.8, 0.5], c: ['chisel', 'taper'] },
  ] },

  K: { adv: 476, s: [
    { p: [[118, 0], [111, 350], [118, 700]] },
    { p: [[388, 700], [132, 336]], curve: false, w: 0.70, press: [0.5, 1.0], c: ['taper', 'butt'] },
    { p: [[184, 404], [404, 0]], curve: false, w: 0.88, press: [0.9, 1.05], c: ['butt', 'chisel'] },
  ] },

  L: { adv: 434, s: [
    { p: [[124, 700], [116, 120], [126, 8]] },
    { p: [[118, 6], [384, 20]], w: 0.62, press: [1.0, 1.0, 0.55], c: ['butt', 'taper'] },
  ] },

  M: { adv: 610, s: [
    { p: [[76, 0], [98, 356], [116, 700]] },
    { p: [[116, 698], [212, 300], [288, 160]], curve: false, w: 0.72, press: [1.0, 0.70], c: ['butt', 'butt'] },
    { p: [[288, 160], [370, 318], [456, 700]], curve: false, w: 0.72, press: [0.70, 1.0], c: ['butt', 'butt'] },
    { p: [[456, 698], [480, 356], [498, 0]] },
  ] },

  N: { adv: 498, s: [
    { p: [[112, 0], [105, 350], [116, 700]] },
    { p: [[120, 682], [348, 70]], curve: false, w: 0.76, press: [1.0, 0.95], c: ['butt', 'butt'] },
    { p: [[352, 0], [345, 350], [354, 700]] },
  ] },

  O: { adv: 506, s: [
    { p: O_RING(), press: [0.72, 1.0, 1.0, 1.0, 1.0, 0.66], c: ['taper', 'taper'] },
  ] },

  P: { adv: 464, s: [
    { p: [[118, 0], [111, 350], [118, 700]] },
    { p: [[126, 700], [274, 708], [364, 626], [360, 480], [258, 398], [168, 380]], w: 0.84, press: [1.0, 1.0, 0.92, 0.58], c: ['butt', 'taper'] },
  ] },

  Q: { adv: 516, s: [
    { p: O_RING(), press: [0.72, 1.0, 1.0, 1.0, 1.0, 0.66], c: ['taper', 'taper'] },
    { p: [[272, 168], [418, -76]], curve: false, w: 0.82, press: [0.95, 0.4], c: ['butt', 'taper'] },
  ] },

  R: { adv: 486, s: [
    { p: [[118, 0], [111, 350], [118, 700]] },
    { p: [[126, 700], [268, 708], [356, 632], [352, 496], [256, 414], [170, 396]], w: 0.82, press: [1.0, 1.0, 0.92, 0.6], c: ['butt', 'taper'] },
    { p: [[208, 410], [404, 0]], curve: false, w: 0.90, press: [0.85, 1.05], c: ['butt', 'chisel'] },
  ] },

  S: { adv: 470, s: [
    { p: [[398, 580], [350, 672], [238, 706], [136, 654], [130, 546], [214, 470], [320, 404], [372, 318], [352, 136], [246, -8], [128, 26], [84, 122]],
      press: [0.5, 0.94, 1.06, 0.92, 1.06, 0.94, 0.5], c: ['taper', 'taper'] },
  ] },

  T: { adv: 456, s: [
    { p: [[50, 698], [424, 714]], w: 0.62, press: [0.9, 1.0, 0.55], c: ['chisel', 'taper'] },
    { p: [[244, 704], [234, 350], [242, 2]] },
  ] },

  U: { adv: 496, s: [
    { p: [[104, 700], [100, 208], [162, 20], [282, 2], [354, 116], [360, 700]],
      press: [1.0, 1.0, 0.9, 0.9, 1.0, 1.0], c: ['chisel', 'chisel'] },
  ] },

  V: { adv: 492, s: [
    { p: [[76, 700], [240, 12], [420, 700]], curve: false, press: [1.02, 0.76, 1.02], c: ['chisel', 'chisel'] },
  ] },

  W: { adv: 620, s: [
    { p: [[68, 700], [176, 14], [278, 452], [382, 14], [492, 700]], curve: false, press: [1.02, 0.74, 0.88, 0.74, 1.02], c: ['chisel', 'chisel'] },
  ] },

  X: { adv: 490, s: [
    { p: [[72, 700], [416, 0]], curve: false, w: 0.95, press: [1.0, 0.85, 1.0], c: ['chisel', 'chisel'] },
    { p: [[106, 0], [408, 700]], curve: false, w: 0.74, press: [1.0, 0.85, 1.0], c: ['chisel', 'chisel'] },
  ] },

  Y: { adv: 482, s: [
    { p: [[72, 700], [244, 336]], curve: false, w: 0.92, press: [1.0, 0.9], c: ['chisel', 'butt'] },
    { p: [[418, 700], [266, 348]], curve: false, w: 0.70, press: [1.0, 0.9], c: ['chisel', 'butt'] },
    { p: [[252, 348], [240, 0]], w: 0.95, c: ['butt', 'chisel'] },
  ] },

  Z: { adv: 486, s: [
    { p: [[74, 692], [414, 708]], w: 0.60, press: [0.9, 1.0, 0.95], c: ['chisel', 'butt'] },
    { p: [[406, 698], [98, 12]], curve: false, w: 0.84, press: [0.95, 1.0], c: ['butt', 'butt'] },
    { p: [[84, 6], [426, 22]], w: 0.64, press: [0.95, 1.0, 0.6], c: ['butt', 'taper'] },
  ] },

  /* ------------------------------------------------------------- numerals */

  0: { adv: 480, s: [
    { p: ZERO_RING(), press: [0.72, 1.0, 1.0, 1.0, 1.0, 0.66], c: ['taper', 'taper'] },
  ] },
  1: { adv: 372, s: [
    { p: [[96, 542], [212, 692]], curve: false, w: 0.70, press: [0.45, 1.0], c: ['taper', 'butt'] },
    { p: [[224, 700], [216, 350], [222, 0]] },
  ] },
  2: { adv: 470, s: [
    { p: [[86, 548], [126, 664], [250, 708], [364, 644], [364, 500], [230, 342], [96, 18]],
      press: [0.5, 0.95, 1.05, 1.0, 1.0, 0.95], c: ['taper', 'butt'] },
    { p: [[80, 8], [408, 22]], w: 0.66, press: [1.0, 1.0, 0.6], c: ['butt', 'taper'] },
  ] },
  3: { adv: 468, s: [
    { p: [[90, 566], [146, 672], [268, 706], [368, 630], [340, 496], [206, 428]], press: [0.5, 0.95, 1.05, 0.95, 0.8], c: ['taper', 'butt'] },
    { p: [[178, 424], [332, 396], [390, 282], [346, 84], [212, -8], [100, 44], [78, 140]], press: [0.8, 1.0, 1.05, 0.95, 0.5], c: ['butt', 'taper'] },
  ] },
  4: { adv: 486, s: [
    { p: [[314, 698], [58, 194]], curve: false, w: 0.70, press: [0.6, 1.0], c: ['taper', 'butt'] },
    { p: [[48, 190], [412, 206]], w: 0.62, press: [1.0, 1.0, 0.6], c: ['butt', 'taper'] },
    { p: [[318, 700], [310, 0]], w: 0.98, c: ['chisel', 'chisel'] },
  ] },
  5: { adv: 470, s: [
    { p: [[118, 698], [388, 710]], w: 0.62, press: [1.0, 1.0, 0.55], c: ['chisel', 'taper'] },
    { p: [[120, 700], [110, 430]], w: 0.92, c: ['butt', 'butt'] },
    { p: [[108, 436], [264, 466], [386, 372], [370, 142], [238, -10], [110, 34], [82, 126]],
      press: [0.9, 1.0, 1.05, 1.0, 0.95, 0.5], c: ['butt', 'taper'] },
  ] },
  6: { adv: 476, s: [
    { p: [[366, 618], [286, 704], [166, 664], [106, 466], [98, 240], [152, 56], [270, -10], [376, 84], [356, 254], [238, 330], [124, 296], [98, 224]],
      press: [0.5, 0.95, 1.0, 1.0, 1.0, 1.0, 0.95, 0.5], c: ['taper', 'taper'] },
  ] },
  7: { adv: 462, s: [
    { p: [[58, 692], [406, 708]], w: 0.66, press: [0.9, 1.0, 1.0], c: ['chisel', 'butt'] },
    { p: [[396, 692], [286, 400], [170, 0]], w: 0.90, press: [0.95, 1.0, 1.0], c: ['butt', 'chisel'] },
  ] },
  8: { adv: 478, s: [
    { p: [[240, 704], [352, 654], [344, 524], [206, 456], [102, 388], [90, 216], [134, 56], [250, -10], [366, 58], [388, 228], [330, 368], [186, 438], [112, 546], [128, 662], [240, 704]],
      press: [0.7, 1.0, 0.9, 1.0, 1.0, 0.9, 1.0, 0.7], c: ['taper', 'taper'] },
  ] },
  9: { adv: 476, s: [
    { p: [[104, 118], [186, 8], [300, 54], [356, 236], [352, 468], [300, 646], [188, 708], [98, 618], [116, 452], [230, 380], [340, 414], [364, 486]],
      press: [0.5, 0.95, 1.0, 1.0, 1.0, 1.0, 0.95, 0.5], c: ['taper', 'taper'] },
  ] },

  /* ---------------------------------------------------------- punctuation */

  '!': { adv: 268, s: [
    { p: [[252, 706], [218, 196]], curve: false, w: 1.00, press: [1.08, 0.30], c: ['chisel', 'taper'] },
    { p: [[210, 128], [200, 12]], curve: false, w: 0.92, press: [1.0, 0.92], c: ['chisel', 'chisel'] },
  ] },
  '.': { adv: 248, s: [
    { p: [[196, 118], [186, 6]], curve: false, w: 0.92, press: [1.0, 0.92], c: ['chisel', 'chisel'] },
  ] },
  ',': { adv: 248, s: [
    { p: [[198, 118], [186, 6], [148, -92]], w: 0.92, press: [1.0, 0.9, 0.30], c: ['chisel', 'taper'] },
  ] },
  ':': { adv: 250, s: [
    { p: [[214, 500], [204, 388]], curve: false, w: 0.88, press: [1.0, 0.92], c: ['chisel', 'chisel'] },
    { p: [[196, 118], [186, 6]], curve: false, w: 0.88, press: [1.0, 0.92], c: ['chisel', 'chisel'] },
  ] },
  "'": { adv: 236, s: [
    { p: [[218, 706], [190, 512]], curve: false, w: 0.92, press: [1.0, 0.42], c: ['chisel', 'taper'] },
  ] },
  '-': { adv: 372, s: [
    { p: [[62, 332], [318, 348]], w: 0.74, press: [0.95, 1.0, 0.9], c: ['chisel', 'chisel'] },
  ] },
  '/': { adv: 400, s: [
    { p: [[62, -52], [342, 726]], curve: false, w: 0.80, c: ['chisel', 'chisel'] },
  ] },
};
/* eslint-enable object-curly-newline */

export const BRUSH_CFG = {
  a: 71,          // stem half-width  (2a/cap = 0.203, matched to the bar)
  b: 29,          // thin half-width  (thin/thick = 0.38, matches the bar's contrast)
  nib: 14,        // nib angle, degrees (thins run at 14deg -> horizontals are light)
  step: 9,
  rough: 0.175,   // torn brush edge
  jitter: 1.35,   // hand-lettered per-glyph bounce
  spike: 0.62,    // brush hair pulled off every chisel terminal
  // Un-profiled strokes (mostly stems) get a loaded entry that bleeds off toward the
  // baseline — the single most brush-like cue after the chisel cut.
  defaultPress: [1.12, 1.02, 0.94, 0.80],
  seed: 0x51ce,
};

export const BRUSH_KERN = {
  AV: -34, VA: -34, AT: -26, TA: -30, AW: -30, WA: -30, AY: -30, YA: -26,
  LT: -30, LY: -32, LV: -30, LW: -28, PA: -24, FA: -22, RT: -14,
  TO: -16, TY: -8, VO: -12, OV: -10, YO: -14, OY: -12,
  'T.': -40, 'Y.': -34, 'V.': -30, 'W.': -22, 'A.': -14,
  'D!': -14, 'R!': -10, 'H!': -8, 'N!': -8, 'K!': -18, 'T!': -22,
  'I-': -12, '-A': -20, 'D-': -6,
  IR: -10, IT: -8, ID: -6, II: -6, IC: -6, IN: -6, IS: -6, IE: -6, IM: -6, IL: -6, IG: -6, IO: -6, IA: -8, IP: -6, IB: -6, IK: -6, IY: -12, IV: -12, IW: -12,
  RI: -8, TI: -14, CI: -8, DI: -6, HI: -6, LI: -6, MI: -6, NI: -6, PI: -6, SI: -6, BI: -6, EI: -6, FI: -8, KI: -8, VI: -12, WI: -12, YI: -14,
};

export default { BRUSH, BRUSH_CFG, BRUSH_KERN };
