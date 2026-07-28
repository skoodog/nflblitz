// FOUNDATION — FROZEN after t=0. Do not edit.
//
// Vector type engine + the deliberately-plain FALLBACK face set.
//
// Only DejaVu / Liberation / FreeSans exist on this box — nothing resembling the
// hand-lettered brush italic in the bar art. So `typeface-lettering` owns real
// outline data; until it lands, everything renders in system italic 900 so a critic
// can never mistake a fallback for finished lettering.
//
// FACE NAMES any consumer may request (frozen vocabulary):
//   'blitz-brush'  hand-lettered bold italic display  ("TRUCK!", "MID-AIR MURDER!")
//   'blitz-block'  condensed squarish HUD / label sans ("SPEED", "HIT POWER", "NICKEL")
//   'blitz-num'    tall gold numerals                  ("250", "22", ":15")
//   'blitz-techno' tech labels                          ("TURBO")
//
// GLYPH DATA FORMAT — frozen JSON schema a face piece must produce:
// {
//   unitsPerEm: 1000,
//   ascent: 750, descent: -250,
//   defaultSlant: 0.18,                 // shear applied by the face itself
//   glyphs: { 'A': { adv: 620, cmds: [['M',x,y],['L',x,y],['C',x1,y1,x2,y2,x,y],['Q',x1,y1,x,y],['Z']] } },
//   kern: { 'AV': -40, 'To': -30 }
// }
// Y is UP in glyph space (font convention); the engine flips it.

export const FACE_NAMES = Object.freeze(['blitz-brush', 'blitz-block', 'blitz-num', 'blitz-techno']);

const SYSTEM_STACK = '"Liberation Sans","DejaVu Sans","FreeSans",Arial,sans-serif';

/** Fallback per-face CSS. Deliberately plain — no bevel, no gradient, no texture. */
const FALLBACK_CSS = {
  'blitz-brush': (px) => `italic 900 ${px}px ${SYSTEM_STACK}`,
  'blitz-block': (px) => `700 ${px}px ${SYSTEM_STACK}`,
  'blitz-num': (px) => `italic 900 ${px}px ${SYSTEM_STACK}`,
  'blitz-techno': (px) => `700 ${px}px ${SYSTEM_STACK}`,
};

const FALLBACK_TRACK = {
  'blitz-brush': 0.01,
  'blitz-block': 0.06,
  'blitz-num': 0.0,
  'blitz-techno': 0.12,
};

function faceKey(name) {
  return FACE_NAMES.includes(name) ? name : 'blitz-block';
}

/* ------------------------------------------------------------------ measure */

let measureCanvas = null;
function measureCtx() {
  if (measureCanvas) return measureCanvas;
  const cv = (typeof OffscreenCanvas !== 'undefined')
    ? new OffscreenCanvas(8, 8)
    : (() => { const c = document.createElement('canvas'); c.width = c.height = 8; return c; })();
  measureCanvas = cv.getContext('2d');
  return measureCanvas;
}

/**
 * Build a full faces object from a glyph-data map.
 * `data` = { 'blitz-brush': GlyphFont, ... }. Any face missing from `data`
 * silently falls back to the system rendering, so a piece can ship one face at a time.
 */
export function makeFaces(data = {}) {
  const fonts = data || {};

  function font(name) { return fonts[faceKey(name)] || null; }

  function glyphOf(f, ch) {
    if (!f || !f.glyphs) return null;
    return f.glyphs[ch] || f.glyphs[ch.toUpperCase()] || f.glyphs[ch.toLowerCase()] || null;
  }

  function measure(text, faceName, sizePx, opts = {}) {
    const name = faceKey(faceName);
    const f = font(name);
    const tracking = opts.tracking !== undefined ? opts.tracking : (f ? 0 : FALLBACK_TRACK[name]);
    const s = String(text === undefined || text === null ? '' : text);
    if (!f) {
      const ctx = measureCtx();
      ctx.font = FALLBACK_CSS[name](sizePx);
      let w = 0;
      for (const ch of s) w += ctx.measureText(ch).width + tracking * sizePx;
      if (s.length) w -= tracking * sizePx;
      const m = ctx.measureText(s || 'M');
      const ascent = m.actualBoundingBoxAscent || sizePx * 0.74;
      const descent = m.actualBoundingBoxDescent || sizePx * 0.22;
      return { w, h: ascent + descent, ascent, descent, fallback: true };
    }
    const upm = f.unitsPerEm || 1000;
    const k = sizePx / upm;
    let w = 0;
    for (let i = 0; i < s.length; i++) {
      const g = glyphOf(f, s[i]);
      w += (g ? g.adv : upm * 0.5) * k;
      if (f.kern && i < s.length - 1) {
        const kv = f.kern[s[i] + s[i + 1]];
        if (kv) w += kv * k;
      }
      w += tracking * sizePx;
    }
    if (s.length) w -= tracking * sizePx;
    const ascent = (f.ascent !== undefined ? f.ascent : upm * 0.75) * k;
    const descent = Math.abs(f.descent !== undefined ? f.descent : -upm * 0.25) * k;
    return { w, h: ascent + descent, ascent, descent, fallback: false };
  }

  /**
   * Outline path for `text`. Origin is the text baseline at x=0.
   * If the face has no outline data this returns a coarse block-per-glyph path so
   * callers that need geometry (extrusion, stroke-along) still get *something*
   * obviously placeholder rather than nothing. Prefer draw() for pixels.
   */
  function path(text, faceName, sizePx, opts = {}) {
    const name = faceKey(faceName);
    const f = font(name);
    const s = String(text === undefined || text === null ? '' : text);
    const p = new Path2D();
    const slant = opts.slant !== undefined ? opts.slant : (f ? (f.defaultSlant || 0) : 0);
    const tracking = opts.tracking !== undefined ? opts.tracking : (f ? 0 : FALLBACK_TRACK[name]);

    if (!f) {
      const ctx = measureCtx();
      ctx.font = FALLBACK_CSS[name](sizePx);
      let x = 0;
      for (const ch of s) {
        const w = ctx.measureText(ch).width;
        if (ch !== ' ') {
          const top = -sizePx * 0.72, bot = sizePx * 0.02;
          const sh = -slant;
          p.moveTo(x + top * sh, top);
          p.lineTo(x + w * 0.92 + top * sh, top);
          p.lineTo(x + w * 0.92 + bot * sh, bot);
          p.lineTo(x + bot * sh, bot);
          p.closePath();
        }
        x += w + tracking * sizePx;
      }
      return p;
    }

    const upm = f.unitsPerEm || 1000;
    const k = sizePx / upm;
    let x = 0;
    const X = (gx, gy) => x + (gx * k) - (gy * -k) * slant * 0;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      const g = glyphOf(f, ch);
      if (g && g.cmds) {
        for (const c of g.cmds) {
          const op = c[0];
          const map = (gx, gy) => {
            const yy = -gy * k;              // flip to screen space
            return [x + gx * k + yy * slant, yy];
          };
          if (op === 'M') { const [ax, ay] = map(c[1], c[2]); p.moveTo(ax, ay); }
          else if (op === 'L') { const [ax, ay] = map(c[1], c[2]); p.lineTo(ax, ay); }
          else if (op === 'Q') {
            const [bx, by] = map(c[1], c[2]); const [ax, ay] = map(c[3], c[4]);
            p.quadraticCurveTo(bx, by, ax, ay);
          } else if (op === 'C') {
            const [b1x, b1y] = map(c[1], c[2]);
            const [b2x, b2y] = map(c[3], c[4]);
            const [ax, ay] = map(c[5], c[6]);
            p.bezierCurveTo(b1x, b1y, b2x, b2y, ax, ay);
          } else if (op === 'Z') p.closePath();
        }
      }
      x += (g ? g.adv : upm * 0.5) * k;
      if (f.kern && i < s.length - 1) {
        const kv = f.kern[ch + s[i + 1]];
        if (kv) x += kv * k;
      }
      x += tracking * sizePx;
    }
    void X;
    return p;
  }

  /**
   * draw(c2d, text, x, y, {face,size,align,baseline,tracking,slant,fill,stroke,strokeWidth,shadow})
   * Returns {w,h}. `y` is the BASELINE unless baseline:'top'|'middle'.
   */
  function draw(c2d, text, x, y, o = {}) {
    const name = faceKey(o.face);
    const size = o.size || 48;
    const s = String(text === undefined || text === null ? '' : text);
    const f = font(name);
    const m = measure(s, name, size, o);

    let ox = x;
    if (o.align === 'center') ox = x - m.w / 2;
    else if (o.align === 'right') ox = x - m.w;
    let oy = y;
    if (o.baseline === 'top') oy = y + m.ascent;
    else if (o.baseline === 'middle') oy = y + m.ascent / 2 - m.descent / 2;

    c2d.save();
    if (o.shadow) {
      c2d.shadowColor = o.shadow.color || 'rgba(0,0,0,0.75)';
      c2d.shadowBlur = o.shadow.blur !== undefined ? o.shadow.blur : size * 0.18;
      c2d.shadowOffsetX = o.shadow.dx || 0;
      c2d.shadowOffsetY = o.shadow.dy !== undefined ? o.shadow.dy : size * 0.06;
    }

    if (!f) {
      // ---- deliberately plain system-font fallback -------------------------
      const tracking = o.tracking !== undefined ? o.tracking : FALLBACK_TRACK[name];
      c2d.font = FALLBACK_CSS[name](size);
      c2d.textAlign = 'left';
      c2d.textBaseline = 'alphabetic';
      let cx = ox;
      for (const ch of s) {
        const w = c2d.measureText(ch).width;
        if (o.stroke) {
          c2d.lineWidth = o.strokeWidth !== undefined ? o.strokeWidth : Math.max(1, size * 0.06);
          c2d.lineJoin = 'round';
          c2d.strokeStyle = o.stroke;
          c2d.strokeText(ch, cx, oy);
        }
        c2d.fillStyle = o.fill || '#ffffff';
        c2d.fillText(ch, cx, oy);
        cx += w + tracking * size;
      }
      c2d.restore();
      return { w: m.w, h: m.h, ascent: m.ascent, fallback: true };
    }

    // ---- real outline face ------------------------------------------------
    const p = path(s, name, size, o);
    c2d.translate(ox, oy);
    if (o.stroke) {
      c2d.lineWidth = o.strokeWidth !== undefined ? o.strokeWidth : Math.max(1, size * 0.06);
      c2d.lineJoin = 'round';
      c2d.strokeStyle = o.stroke;
      c2d.stroke(p);
    }
    c2d.fillStyle = o.fill || '#ffffff';
    c2d.fill(p);
    c2d.restore();
    return { w: m.w, h: m.h, ascent: m.ascent, fallback: false };
  }

  return {
    piece: 'foundation-fallback',
    names: FACE_NAMES.slice(),
    has: (n) => !!font(n),
    data: fonts,
    measure, path, draw,
    /** CSS string for a face — pieces that want to fillText directly may use it. */
    css: (n, px) => FALLBACK_CSS[faceKey(n)](px),
  };
}

/** The fallback faces object installed at boot. */
export const fallbackFaces = makeFaces({});

export default { makeFaces, fallbackFaces, FACE_NAMES };
