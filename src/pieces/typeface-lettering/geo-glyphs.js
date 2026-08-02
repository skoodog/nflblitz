// PIECE: typeface-lettering — the three GEOMETRIC faces
//   `blitz-block`  condensed squarish HUD/label sans   (SEA, MIA, SPEED, NICKEL)
//   `blitz-num`    tall heavy numerals                 (:15, 14, 250, 22)
//   `blitz-techno` wide chamfered angular italic       (TURBO)
//
// One skeleton set, three pens. Each glyph is a set of monoline segments. Where two
// segments form an OUTER corner, both are extended by exactly one pen half-width
// (`ext: E`) so they terminate on the same corner point: the union squares off
// cleanly, and the chamfer pass then cuts both of them identically instead of
// leaving stitched notches inside the letter. `ext` is measured in pen half-widths,
// never in glyph units, so it stays correct under any x-scale.
//
// Frame: cap ~700, baseline 0, stems centred at 105 and 270, bars centred at
// y 635 / 350 / 65, nominal advance 400. Per-face x-scale and pen weight in build.js.

const E = 1;    // one pen half-width — the standard corner extension
const LS = 105, RS = 270;
const TOP = 635, MID = 350, BOT = 65;

const V = (x, y0, y1, e0, e1, w) => ({ p: [[x, y0], [x, y1]], curve: false, ext: [e0 || 0, e1 || 0], w, c: ['butt', 'butt'] });
const H = (y, x0, x1, e0, e1, w) => ({ p: [[x0, y], [x1, y]], curve: false, ext: [e0 || 0, e1 || 0], w, c: ['butt', 'butt'] });
const D = (x0, y0, x1, y1, e0, e1, w) => ({ p: [[x0, y0], [x1, y1]], curve: false, ext: [e0 || 0, e1 || 0], w, c: ['butt', 'butt'] });
/** Bar that lands on a stem at BOTH ends. */
const HB = (y, x0, x1, w) => H(y, x0, x1, E, E, w);
/** Bar that lands on a stem on the left and terminates free on the right. */
const HF = (y, x0, x1, w) => H(y, x0, x1, E, 0, w);
/** A square ink dot of side `s` centred at (cx,cy). */
const SQ = (cx, cy, s) => ({ p: [[cx, cy - s / 2], [cx, cy + s / 2]], curve: false, w: s / 130, c: ['butt', 'butt'] });

/* eslint-disable object-curly-newline */
export const GEO = {
  ' ': { adv: 250, s: [] },

  A: { adv: 415, s: [D(100, 0, 152, 700), D(275, 0, 223, 700), H(180, 112, 264, 0, 0, 0.86)] },
  B: { adv: 400, s: [
    V(LS, 0, 700), HB(TOP, LS, 240), HF(MID, LS, 240), HB(BOT, LS, 252),
    V(240, 470, TOP, E, E), V(252, 120, 232, E, E),
  ] },
  C: { adv: 400, s: [V(LS, 130, 570, E, E), HB(TOP, LS, RS), HB(BOT, LS, RS)] },
  // D WAS AN O. Measured off the shipped play-call sheet, where DOG HOOK read as "OOG
  // HOOK": the rendered D and the rendered O agreed on 95.3% of their pixels, differing by
  // a single row of ink out of 25. For scale, K and H -- two letters that merely share a
  // stem -- agree on 89.6%, and two instances of the same O agree on 100%. So D was LESS
  // distinguishable from O than two genuinely different letters are from each other.
  //
  // The cause was that both were closed rectangles. D's only differentiator was a
  // full-height left stem against O's inset one (0..700 vs 120..580), and at a 25 px cap
  // the pen width and the bar overlap swallow that nub entirely.
  //
  // Fixed on D rather than on O, deliberately: O reads correctly as an O, and this face
  // sets every label in the game, so re-cutting it would ripple somewhere I cannot cheaply
  // re-verify. A geometric D is a flat left stem and a bowl, so the bowl is what it gets --
  // bars that stop short of RS and two chamfers down to a shortened right side. Square-left
  // and cut-right against O's square-everywhere is a silhouette difference, which survives
  // being small in a way that a 4 px stem extension does not.
  D: { adv: 408, s: [
    V(LS, 0, 700), H(TOP, LS, 212, E, E), H(BOT, LS, 212, E, E),
    V(RS, 168, 532, E, E), D(212, TOP, RS, 532, E, E), D(212, BOT, RS, 168, E, E),
  ] },
  E: { adv: 385, s: [V(LS, 0, 700), HB(TOP, LS, RS), HF(MID, LS, 248), HB(BOT, LS, RS)] },
  F: { adv: 375, s: [V(LS, 0, 700), HB(TOP, LS, RS), HF(MID, LS, 248)] },
  G: { adv: 415, s: [
    V(LS, 130, 570, E, E), HB(TOP, LS, RS), HB(BOT, LS, RS),
    V(RS, 120, 300, E, E), H(MID, 196, RS, 0, E, 0.9),
  ] },
  H: { adv: 415, s: [V(LS, 0, 700), V(RS, 0, 700), H(MID, LS, RS)] },
  I: { adv: 215, s: [V(LS, 0, 700)] },
  J: { adv: 372, s: [V(RS, 120, 700), HB(BOT, LS, RS), V(LS, 120, 210, E, 0)] },
  K: { adv: 420, s: [V(LS, 0, 700), D(150, MID, 325, 700, 0, E, 0.95), D(150, MID, 330, 0, 0, E, 1.0)] },
  L: { adv: 370, s: [V(LS, 0, 700), HB(BOT, LS, RS)] },
  M: { adv: 495, s: [
    V(85, 0, 700), V(325, 0, 700), D(85, 690, 205, 250, 0, 0, 0.92), D(325, 690, 205, 250, 0, 0, 0.92),
  ] },
  N: { adv: 420, s: [V(LS, 0, 700), V(RS, 0, 700), D(LS, 690, RS, 10, 0, 0, 0.95)] },
  O: { adv: 420, s: [V(LS, 120, 580), V(RS, 120, 580), HB(TOP, LS, RS), HB(BOT, LS, RS)] },
  P: { adv: 400, s: [V(LS, 0, 700), HB(TOP, LS, 240), HB(MID, LS, 240), V(240, 470, TOP, E, E)] },
  Q: { adv: 432, s: [
    V(LS, 120, 580), V(RS, 120, 580), HB(TOP, LS, RS), HB(BOT, LS, RS),
    D(232, 168, 344, -40, 0, 0, 0.9),
  ] },
  R: { adv: 424, s: [
    V(LS, 0, 700), HB(TOP, LS, 240), HB(MID, LS, 240), V(240, 470, TOP, E, E),
    D(178, MID, 332, 0, 0, E, 1.0),
  ] },
  S: { adv: 400, s: [
    HB(TOP, LS, RS), V(LS, 455, 585, E, E), HB(MID, LS, RS), V(RS, 115, 245, E, E), HB(BOT, LS, RS),
  ] },
  T: { adv: 400, s: [HB(TOP, LS, RS), V(187, 0, TOP, 0, E)] },
  U: { adv: 415, s: [V(LS, 110, 700), V(RS, 110, 700), HB(BOT, LS, RS)] },
  V: { adv: 420, s: [D(68, 700, 187, 50), D(307, 700, 187, 50)] },
  W: { adv: 545, s: [
    D(60, 700, 140, 40, 0, 0, 0.92), D(140, 40, 218, 430, 0, 0, 0.92),
    D(298, 40, 218, 430, 0, 0, 0.92), D(378, 700, 298, 40, 0, 0, 0.92),
  ] },
  X: { adv: 415, s: [D(70, 700, 305, 0, E, E, 0.95), D(70, 0, 305, 700, E, E, 0.95)] },
  Y: { adv: 415, s: [
    D(70, 700, 187, 360, 0, 0, 0.95), D(305, 700, 187, 360, 0, 0, 0.95), V(187, 0, 375),
  ] },
  Z: { adv: 405, s: [HB(TOP, LS, RS), D(288, 600, 86, 100, 0, 0, 0.98), HB(BOT, LS, RS)] },

  /* ------------------------------------------------------------- numerals */

  0: { adv: 408, s: [V(LS, 120, 580), V(RS, 120, 580), HB(TOP, LS, RS), HB(BOT, LS, RS)] },
  1: { adv: 292, s: [V(196, 0, 700), D(96, 540, 190, 678, 0, 0, 0.86)] },
  2: { adv: 402, s: [
    HB(TOP, LS, RS), V(RS, 495, 585, E, E), D(285, 455, 105, 112, 0, E, 1.0), HB(BOT, LS, RS),
  ] },
  3: { adv: 402, s: [
    HB(TOP, LS, RS), V(RS, 405, 585, E, E), H(MID, 150, RS, 0, E), V(RS, 115, 300, E, E), HB(BOT, LS, RS),
  ] },
  4: { adv: 424, s: [D(258, 690, 78, 222, 0, E, 0.9), HB(220, 80, 285), V(255, 0, 700)] },
  5: { adv: 402, s: [
    HB(TOP, LS, RS), V(LS, 405, 585, E, E), HB(MID, LS, RS), V(RS, 115, 300, E, E), HB(BOT, LS, RS),
  ] },
  6: { adv: 402, s: [
    V(LS, 120, 580, E, E), HB(TOP, LS, RS), HB(MID, LS, RS), V(RS, 115, 300, E, E), HB(BOT, LS, RS),
  ] },
  7: { adv: 392, s: [HB(TOP, LS, RS), D(287, 566, 150, 0, 0, 0, 0.95)] },
  8: { adv: 408, s: [
    V(LS, 120, 580), V(RS, 120, 580), HB(TOP, LS, RS), HB(MID, LS, RS), HB(BOT, LS, RS),
  ] },
  9: { adv: 402, s: [
    V(RS, 120, 580, E, E), HB(TOP, LS, RS), V(LS, 405, 585, E, E), HB(MID, LS, RS), HB(BOT, LS, RS),
  ] },

  /* ---------------------------------------------------------- punctuation */

  '!': { adv: 225, s: [V(112, 190, 700, 0, 0, 0.98), SQ(112, 62, 128)] },
  '.': { adv: 225, s: [SQ(112, 62, 128)] },
  ',': { adv: 225, s: [SQ(112, 62, 128), D(112, 30, 62, -92, 0, 0, 0.62)] },
  ':': { adv: 215, s: [SQ(108, 452, 124), SQ(108, 62, 124)] },
  "'": { adv: 205, s: [V(108, 535, 700, 0, 0, 0.9)] },
  '-': { adv: 330, s: [H(348, 82, 232, 0, 0, 0.86)] },
  '/': { adv: 360, s: [D(58, -55, 292, 735, 0, 0, 0.86)] },
};
/* eslint-enable object-curly-newline */

/** Uniform scale of a skeleton set (x, y and advance independently). */
export function scaleGeo(src, sx, sy, advScale) {
  const out = {};
  for (const ch of Object.keys(src)) {
    const g = src[ch];
    out[ch] = {
      adv: Math.round(g.adv * (advScale === undefined ? sx : advScale)),
      s: g.s.map((st) => Object.assign({}, st, {
        p: st.p.map((pt) => [pt[0] * sx, pt[1] * sy]),
        ext: st.ext,     // ext is in pen half-widths — never scaled with the glyph
      })),
    };
  }
  return out;
}

export default { GEO, scaleGeo };
