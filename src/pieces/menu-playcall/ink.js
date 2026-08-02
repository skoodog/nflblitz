// PIECE menu-playcall — typesetting by INK RECTANGLE.
//
// WHY. The bar sets this screen's headline as a rectangle, not as a point size: the
// ink of "DEFENSE!  PICK A PLAY" measures panel x 35..353, y 20..48, which is a 1123 x
// 99 logical box, and ":09" is 166 x 78. Asking a face for "size 104" and hoping is
// how you end up 26 px short — measured, on the first render of this screen: size 104
// gave a 73 px cap, because the ink of a face is not its point size and the ratio is a
// property of the face, not a constant.
//
// AND THE FACE UNDER US IS THE WRONG SHAPE, WHICH THIS HAS TO SURVIVE.
// foundation/typeface.js says plainly that only DejaVu / Liberation / FreeSans exist
// on this box and that everything renders in system italic 900 until the piece
// `typeface-lettering` lands real outlines. Measured, the fallback needs 17.6 px of
// width per px of cap height for that headline; the bar's brush face needs 11.3. So
// the SAME string, set to the bar's 99 px cap, would be 1741 px wide and would run
// into the clock.
//
// So the fit is to a BOX, with both constraints, and a bounded horizontal squeeze:
//   1. solve the size that lands the ink height on `h`
//   2. if that overruns `maxW`, squeeze horizontally, but never below `minXScale`
//   3. if the squeeze is not enough, give up height until the width fits
// With today's fallback face the headline lands at a 78 px cap inside the bar's 1123
// px width. The day a condensed brush face registers, the SAME call lands the full
// 99 px cap and stops squeezing, because both numbers come from the face's own ink.
//
// THE INK BOX IS MEASURED OFF THE RASTER, not off the metrics. `faces.measure()`
// returns the FONT's ascent/descent for an outline face and the string's actual
// bounding box for the fallback — two different quantities. Rasterising once at a
// probe size and reading the alpha bounds is the only definition that is the same for
// both, so that is what this does. Memoised per (face, tracking, text): a menu screen
// draws maybe forty distinct strings, and each costs one small readback, once, at bake
// time.

import { mkCanvas } from './chrome.js';

const PROBE = 80;
const CACHE = new Map();
const CACHE_MAX = 256;

let probeCv = null, probeCx = null;

/**
 * Ink box of `text`, NORMALISED to a point size of 1: multiply by the size to get
 * pixels. Origin is the pen start on the baseline, y up-negative (so y0 < 0).
 */
export function inkBox(ui, text, face, opts = {}) {
  const s = String(text === undefined || text === null ? '' : text);
  const tr = opts.tracking === undefined ? '' : opts.tracking;
  const key = `${face}|${tr}|${s}`;
  const hit = CACHE.get(key);
  if (hit) return hit;

  const m = ui.faces.measure(s, face, PROBE, opts);
  const W = Math.max(8, Math.ceil(m.w + PROBE * 1.6));
  const H = Math.ceil(PROBE * 2.6);
  const ox = PROBE * 0.8, oy = PROBE * 1.7;
  if (!probeCv || probeCv.width < W || probeCv.height < H) {
    probeCv = mkCanvas(Math.max(W, 512), Math.max(H, 256));
    probeCx = probeCv.getContext('2d', { willReadFrequently: true });
  }
  const c = probeCx;
  let box = null;
  try {
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, W, H);
    ui.faces.draw(c, s, ox, oy, { face, size: PROBE, fill: '#ffffff', tracking: opts.tracking });
    const d = c.getImageData(0, 0, W, H).data;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (let y = 0; y < H; y++) {
      const row = y * W * 4;
      for (let x = 0; x < W; x++) {
        if (d[row + x * 4 + 3] > 24) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 >= x0) {
      box = {
        x0: (x0 - ox) / PROBE, x1: (x1 + 1 - ox) / PROBE,
        y0: (y0 - oy) / PROBE, y1: (y1 + 1 - oy) / PROBE,
      };
    }
  } catch (e) { box = null; }

  if (!box) {
    // No readable 2D context (never seen on this box, but a headless surface may
    // refuse getImageData). Fall back to the face's own metrics: the layout then
    // degrades to "roughly right" instead of throwing.
    const mm = ui.faces.measure(s, face, PROBE, opts);
    box = { x0: 0, x1: mm.w / PROBE, y0: -mm.ascent / PROBE, y1: mm.descent / PROBE };
  }
  box.w = box.x1 - box.x0;
  box.h = box.y1 - box.y0;
  if (CACHE.size > CACHE_MAX) CACHE.clear();
  CACHE.set(key, box);
  return box;
}

/**
 * Set `text` so its INK lands on a box.
 *   x, top   where the ink's left edge and top edge go (align 'right' -> x is the
 *            ink's RIGHT edge; 'center' -> its centre)
 *   h        target ink height
 *   maxW     ink width ceiling (optional)
 *   minXScale  how far the glyphs may be squeezed before height is given up instead
 * Returns { size, xs, w, h } — what it actually used.
 */
export function drawInk(c, ui, text, face, o) {
  const s = String(text === undefined || text === null ? '' : text);
  const b = inkBox(ui, s, face, o);
  if (!(b.h > 0)) return { size: 0, xs: 1, w: 0, h: 0 };
  let size = o.h / b.h;
  let xs = 1;
  const maxW = o.maxW || 0;
  if (maxW > 0) {
    const w = b.w * size;
    if (w > maxW) {
      const need = maxW / w;
      const floor = o.minXScale === undefined ? 0.86 : o.minXScale;
      xs = Math.max(floor, need);
      if (need < floor) size *= need / floor;
    }
  }
  const w = b.w * size * xs;
  const align = o.align || 'left';
  const left = align === 'right' ? o.x - w : (align === 'center' ? o.x - w * 0.5 : o.x);

  c.save();
  // Anchor the transform on the ink's top-left, then undo the ink offsets in the
  // scaled frame: the pen start is (-x0, -y0) from there.
  c.translate(left, o.top);
  if (xs !== 1) c.scale(xs, 1);
  ui.faces.draw(c, s, -b.x0 * size, -b.y0 * size, {
    face, size, tracking: o.tracking, fill: o.fill, stroke: o.stroke,
    strokeWidth: o.strokeWidth, shadow: o.shadow,
  });
  c.restore();
  return { size, xs, w, h: o.h };
}

/** Ink width `text` would take at a given ink height, before any squeeze. */
export function inkWidth(ui, text, face, h, opts = {}) {
  const b = inkBox(ui, text, face, opts);
  return b.h > 0 ? (b.w / b.h) * h : 0;
}

/**
 * Drop every memoised box. MUST be called when `ui.faces` changes identity: the cache
 * is keyed by face NAME, and 'blitz-brush' means something different once the piece
 * `typeface-lettering` registers real outlines — every ink box measured against the
 * system fallback would otherwise still be in here, and the headline would be set to
 * the old face's proportions with the new face's glyphs.
 */
export function resetInk() { CACHE.clear(); }

export default { inkBox, drawInk, inkWidth, resetInk };
