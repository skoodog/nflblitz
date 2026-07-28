// PIECE menu-title — the BLITZ wordmark letterforms.
//
// Five glyphs, authored here as outline polygons in a cap-height=1000 design
// space (y down: 0 is the cap line, 1000 is the baseline). They are NOT the
// `blitz-block` text face — a logotype is drawn, not set. The proportions are
// measured off bar/panel-title.png: on a 1080-tall frame the wordmark is
// 987 px wide with a 163 px cap height, the stem is 0.51 of the cap, and the
// letters carry 45-degree chamfers on the outer corners plus an angular waist
// notch on the B. That "wide load" ratio (6.05 : 1 wordmark to cap) is what
// makes the lockup read as BLITZ rather than as heavy type.
//
// WINDING: outer contours clockwise, counters counter-clockwise. geom.js
// depends on it for offsets and facet normals.

export const CAP = 1000;

export const GLYPHS = {
  B: {
    w: 1139,
    contours: [
      [[150, 0], [1000, 0], [1139, 150], [1139, 330], [1002, 468], [1139, 606],
       [1139, 852], [986, 1000], [150, 1000], [0, 860], [0, 140]],
      [[418, 162], [418, 272], [602, 272], [602, 392], [916, 392], [916, 162]],
      [[540, 566], [540, 802], [646, 906], [900, 906], [900, 566]],
    ],
  },
  L: {
    w: 730,
    contours: [
      [[130, 0], [380, 0], [380, 700], [600, 700], [730, 830], [730, 1000],
       [130, 1000], [0, 870], [0, 130]],
    ],
  },
  I: {
    w: 394,
    contours: [
      [[130, 0], [394, 0], [394, 870], [264, 1000], [0, 1000], [0, 130]],
    ],
  },
  T: {
    w: 891,
    contours: [
      [[110, 0], [781, 0], [891, 110], [891, 300], [636, 300], [636, 880],
       [506, 1000], [256, 1000], [256, 300], [0, 300], [0, 110]],
    ],
  },
  Z: {
    w: 1052,
    contours: [
      [[120, 0], [1052, 0], [1052, 238], [396, 700], [1052, 700], [1052, 1000],
       [130, 1000], [0, 870], [0, 700], [438, 282], [0, 282], [0, 120]],
    ],
  },
};

export const WORD = 'BLITZ';
/** Gaps between adjacent letters, design units. Measured pair by pair. */
export const GAPS = [117, 88, 102, 44];
/** Per-letter vertical scale — the outer letters run ~1% tall, as in the art. */
export const RISE = [1.014, 1.002, 0.996, 1.002, 1.014];

/** Total advance of the word in design units. */
export function wordWidth() {
  let w = 0;
  for (let i = 0; i < WORD.length; i++) {
    w += GLYPHS[WORD[i]].w;
    if (i < GAPS.length) w += GAPS[i];
  }
  return w;
}

/**
 * layout(capPx, widthPx) -> { sx, sy, items:[{ch, x, sy}], w }
 * `sx` / `sy` are design-unit -> pixel scales; the x scale is derived from the
 * target width so the wordmark always hits the measured 6.05:1 ratio.
 */
export function layout(capPx, widthPx) {
  const total = wordWidth();
  const sy = capPx / CAP;
  const sx = widthPx / total;
  const items = [];
  let x = 0;
  for (let i = 0; i < WORD.length; i++) {
    const ch = WORD[i];
    items.push({ ch, x: x * sx, w: GLYPHS[ch].w * sx, rise: RISE[i] });
    x += GLYPHS[ch].w + (i < GAPS.length ? GAPS[i] : 0);
  }
  return { sx, sy, items, w: widthPx };
}

/** Contours of one glyph transformed into pixel space at (ox, baselineY). */
export function glyphContours(ch, ox, baselineY, sx, sy, rise) {
  const g = GLYPHS[ch];
  const out = [];
  const k = sy * rise;
  for (const c of g.contours) {
    const p = new Array(c.length);
    for (let i = 0; i < c.length; i++) {
      p[i] = [ox + c[i][0] * sx, baselineY - (CAP - c[i][1]) * k];
    }
    out.push(p);
  }
  return out;
}

export default { CAP, GLYPHS, WORD, GAPS, RISE, wordWidth, layout, glyphContours };
