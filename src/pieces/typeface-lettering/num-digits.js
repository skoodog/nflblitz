// PIECE: typeface-lettering — `blitz-num` digits.
//
// The letters of blitz-num come from the shared geometric skeleton, but the DIGITS
// are authored separately: "250 PTS", ":15", "14", "22" are the most-compared strings
// in the whole game, and in the bar art those numerals are round-bowled heavy italics,
// not rectilinear ones. Authored directly in the final num frame — cap 770, baseline 0,
// ink body x 40..420, pen half-width 75 — so no scaling is applied on top.

const E = 1;

function ring(cx, cy, rx, ry, a0, sweep, n) {
  const p = [];
  for (let i = 0; i <= n; i++) {
    const a = (a0 + sweep * (i / n)) * Math.PI / 180;
    p.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return p;
}

const L = (p, w, ext) => ({ p, curve: false, w, ext, c: ['butt', 'butt'] });
const C = (p, w) => ({ p, curve: true, w, c: ['butt', 'butt'] });

/* eslint-disable object-curly-newline */
export const NUM_DIGITS = {
  0: { adv: 500, s: [C(ring(230, 385, 116, 311, 96, -372, 28))] },
  1: { adv: 322, s: [
    L([[252, 0], [252, 770]]),
    L([[110, 592], [244, 752]], 0.82),
  ] },
  2: { adv: 492, s: [
    C([[102, 592], [128, 704], [232, 776], [340, 708], [346, 580], [246, 436], [112, 170]]),
    L([[120, 76], [346, 76]], 0.94, [E, E]),
  ] },
  3: { adv: 484, s: [
    C([[104, 620], [152, 732], [250, 776], [340, 706], [320, 582], [224, 514]]),
    C([[192, 508], [302, 492], [360, 382], [338, 174], [236, -6], [126, 56], [102, 152]]),
  ] },
  4: { adv: 478, s: [
    L([[322, 758], [88, 266]], 0.9),
    L([[66, 266], [398, 266]], 0.92, [E, E]),
    L([[322, 0], [322, 770]]),
  ] },
  5: { adv: 484, s: [
    L([[124, 760], [372, 760]], 0.9, [E, E]),
    L([[126, 770], [114, 470]]),
    C([[112, 484], [222, 520], [332, 436], [342, 228], [240, -8], [128, 56], [102, 152]]),
  ] },
  6: { adv: 486, s: [
    C([[344, 636], [264, 762], [150, 720], [104, 516], [102, 296], [170, -6], [292, 26], [348, 182], [288, 344], [166, 356], [104, 260]]),
  ] },
  7: { adv: 456, s: [
    L([[98, 760], [384, 760]], 0.9, [E, E]),
    L([[374, 746], [188, 0]], 0.95),
  ] },
  8: { adv: 496, s: [
    C(ring(232, 556, 112, 194, 90, -372, 20), 0.86),
    C(ring(230, 194, 124, 200, 90, -372, 20), 0.86),
  ] },
  9: { adv: 486, s: [
    C([[118, 126], [198, 4], [312, 46], [358, 250], [360, 470], [292, 772], [170, 740], [114, 584], [174, 422], [296, 410], [358, 506]]),
  ] },
  ':': { adv: 250, s: [
    L([[128, 430], [128, 570]], 1.02),
    L([[128, 70], [128, 210]], 1.02),
  ] },
  '.': { adv: 250, s: [L([[128, 70], [128, 210]], 1.02)] },
  ',': { adv: 250, s: [L([[128, 70], [128, 210]], 1.02), L([[128, 70], [72, -70]], 0.62)] },
  '-': { adv: 390, s: [L([[92, 372], [292, 372]], 0.88)] },
  '/': { adv: 400, s: [L([[64, -60], [330, 810]], 0.88)] },
  '!': { adv: 262, s: [L([[132, 250], [132, 770]], 1.0), L([[132, 70], [132, 200]], 1.0)] },
};
/* eslint-enable object-curly-newline */

export default { NUM_DIGITS };
