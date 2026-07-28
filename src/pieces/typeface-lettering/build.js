// PIECE: typeface-lettering — compiles the four faces into the foundation's frozen
// glyph JSON schema: { unitsPerEm, ascent, descent, defaultSlant, glyphs:{ch:{adv,cmds}}, kern }
//
// Compiled once at module load. ~45 glyphs x 4 faces, all pure arithmetic.
//
// SLANT CONVENTION: `defaultSlant` (and `opts.slant`) is POSITIVE for a right lean,
// applied as `x += slant * glyphY * size/upm`, i.e. the same sign as CSS `oblique`.
// foundation/typeface.js `makeFaces()` shears with the opposite sign, so if anything
// ever feeds this glyph data through that helper instead of through render.js it must
// negate defaultSlant. Every face here also carries `slantSign: 'positive-leans-right'`.

import { compileGlyph } from './stroker.js';
import { BRUSH, BRUSH_CFG, BRUSH_KERN } from './brush-glyphs.js';
import { GEO, scaleGeo } from './geo-glyphs.js';
import { NUM_DIGITS } from './num-digits.js';

function compileSet(set, cfg) {
  const glyphs = {};
  for (const ch of Object.keys(set)) {
    glyphs[ch] = compileGlyph(String(ch), set[ch], cfg);
  }
  return glyphs;
}

let CACHE = null;

export function buildFonts() {
  if (CACHE) return CACHE;

  /* ------------------------------------------------------- blitz-brush */
  const brush = {
    unitsPerEm: 1000,
    ascent: 730,
    descent: -130,
    capHeight: 700,
    slantSign: 'positive-leans-right',
    defaultSlant: 0.27,          // ~15 deg — measured off the bar's MID-AIR / CITY stems
    defaultTracking: 0.012,
    // Compressed 6% horizontally at full pen weight: tightens the counters to the
    // bar's proportion without thinning the strokes.
    glyphs: compileSet(scaleGeo(BRUSH, 0.865, 1.0, 0.862), BRUSH_CFG),
    kern: BRUSH_KERN,
  };

  /* ------------------------------------------------------- blitz-block */
  const block = {
    unitsPerEm: 1000,
    ascent: 705,
    descent: -110,
    capHeight: 700,
    defaultSlant: 0,
    defaultTracking: 0.05,
    glyphs: compileSet(scaleGeo(GEO, 1.14, 1.0, 1.14), {
      a: 61, b: 61, nib: 0, step: 22, rough: 0, jitter: 0, chamfer: 17, chamferMin: 0.5, seed: 0x81a3,
    }),
    kern: { AV: -22, VA: -22, AT: -18, TA: -20, AY: -18, YA: -16, LT: -20, LY: -20, PA: -14, 'T.': -26, 'A.': -12 },
  };

  /* --------------------------------------------------------- blitz-num */
  // Taller, heavier, a touch narrower — score numerals read at a glance.
  const num = {
    unitsPerEm: 1000,
    ascent: 790,
    descent: -110,
    capHeight: 770,
    defaultSlant: 0,
    defaultTracking: 0.008,
    glyphs: (() => {
      const cfg = { a: 75, b: 75, nib: 0, step: 16, rough: 0, jitter: 0, chamfer: 12, chamferMin: 0.5, seed: 0x2f70 };
      // letters from the shared skeleton, digits+punctuation from their own round-bowled set
      return Object.assign(
        compileSet(scaleGeo(GEO, 1.22, 1.10, 1.20), cfg),
        compileSet(NUM_DIGITS, Object.assign({}, cfg, { chamfer: 0 })),
      );
    })(),
    kern: { 11: -34, 17: -18, 71: -20, 14: -14, 41: -12, '1.': -18, '.1': -16, ':1': -22 },
  };

  /* ------------------------------------------------------ blitz-techno */
  // Wide, chamfered, italic — the TURBO plate face.
  const techno = {
    unitsPerEm: 1000,
    ascent: 710,
    descent: -110,
    capHeight: 700,
    defaultSlant: 0.19,
    defaultTracking: 0.10,
    glyphs: compileSet(scaleGeo(GEO, 1.62, 1.0, 2.02), {
      a: 68, b: 68, nib: 0, step: 22, rough: 0, jitter: 0, chamfer: 34, chamferMin: 0.5, seed: 0x9d21,
    }),
    kern: { TU: -18, UR: -10, RB: -8, BO: -8, AV: -24, VA: -24 },
  };

  CACHE = {
    'blitz-brush': brush,
    'blitz-block': block,
    'blitz-num': num,
    'blitz-techno': techno,
  };
  return CACHE;
}

export default { buildFonts };
