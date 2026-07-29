// PIECE hud-overlay — INK: exact ink-box typesetting for the scoreboard.
//
// WHY THIS EXISTS. Round 1 set every string with `faces.draw(..., size)` and let
// the face's default tracking through. That is the wrong control surface for a
// scoreboard. A scoreboard cell is a fixed rectangle and the type has to FILL it:
// the bar's `NYC` is 74 x 46 logical and its `22` is 99 x 61, edge to edge in
// cells 96 and 109 wide. Asking for "size 55" and hoping is how you end up with
// "N Y C" floating in air, which is exactly what happened.
//
// So this module works in INK RECTANGLES, not point sizes:
//
//   inkBox()   exact ink extents, computed from the glyph outline data the face
//              already exposes (`faces.data`). No rasterisation, no getImageData,
//              no per-frame cost — the commands are all M/L polygons, so the box
//              is a min/max walk over a few hundred points.
//   inkText()  set `text` so that its INK lands on a given rect, with an explicit
//              horizontal scale applied to the PATH (not to the pen), so the black
//              keyline stays a uniform width instead of turning into an ellipse.
//   inkSet()   the one the scoreboard actually uses: lays a run out INK TO INK
//              with a fixed gap and solves one horizontal scale for the target
//              width, so "NYC" packs instead of letterspacing.
//
// The keyline / halation / fill treatment lives here too, because the bar's
// numerals have a very specific contour: a hard true-black keyline about 5% of the
// ink height, a warm low-alpha halation bloom outside that, and a flat paper-white
// fill with only a slight cool foot. Not a bevel, not a metal ramp.

/* ------------------------------------------------------------------ metrics */

function fontOf(F, face) {
  const d = F && F.data ? F.data[face] : null;
  return d && d.glyphs ? d : null;
}

function glyphOf(f, ch) {
  return f.glyphs[ch] || f.glyphs[ch.toUpperCase()] || f.glyphs[ch.toLowerCase()] || null;
}

/**
 * Exact ink bounds of `text` at `size`, in the same coordinate frame draw() uses
 * (origin = pen start on the baseline, y up-negative).
 */
export function inkBox(F, face, text, size, o) {
  const f = fontOf(F, face);
  const s = String(text === undefined || text === null ? '' : text);
  if (!f) {
    const m = F.measure(s, face, size, o || {});
    return { x0: 0, x1: m.w, y0: -m.ascent, y1: 0, w: m.w, h: m.ascent, adv: m.w };
  }
  const upm = f.unitsPerEm || 1000;
  const k = size / upm;
  const tracking = o && o.tracking !== undefined ? o.tracking : (f.defaultTracking || 0);
  const slant = o && o.slant !== undefined ? o.slant : (f.defaultSlant || 0);
  let x = 0;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const g = glyphOf(f, ch);
    if (g && g.cmds) {
      for (let j = 0; j < g.cmds.length; j++) {
        const cm = g.cmds[j];
        if (cm[0] === 'Z') continue;
        const yy = -cm[2] * k;
        const ax = x + cm[1] * k - yy * slant;
        if (ax < x0) x0 = ax;
        if (ax > x1) x1 = ax;
        if (yy < y0) y0 = yy;
        if (yy > y1) y1 = yy;
      }
    }
    x += (g ? g.adv : upm * 0.42) * k;
    if (f.kern && i < s.length - 1) {
      const kv = f.kern[ch + s[i + 1]];
      if (kv) x += kv * k;
    }
    x += tracking * size;
  }
  if (x0 === Infinity) return { x0: 0, x1: 0, y0: 0, y1: 0, w: 0, h: 0, adv: x };
  return { x0, x1, y0, y1, w: x1 - x0, h: y1 - y0, adv: x };
}

/** Point size that lands `text`'s ink height exactly on `h`. */
export function sizeForInk(F, face, text, h, o) {
  const b = inkBox(F, face, text, 100, o);
  if (!(b.h > 0.001)) return h;
  return (100 * h) / b.h;
}

/* -------------------------------------------------------------------- paths */

let matOk = true;
function scaledPath(p0, xs) {
  if (Math.abs(xs - 1) < 0.002 || !matOk) return null;
  try {
    const p = new Path2D();
    p.addPath(p0, new DOMMatrix([xs, 0, 0, 1, 0, 0]));
    return p;
  } catch (e) { matOk = false; return null; }
}

/* ------------------------------------------------------------------- runs */

/**
 * THE FIX FOR "N Y C".
 *
 * A face lays glyphs out by ADVANCE, and blitz-block's advances carry generous
 * sidebearings — so at the size that makes `NYC` 46 px tall the three letters sit
 * in 77 px with 9 px holes between them, which reads as a thin letterspaced techno
 * readout. The bar sets the same three glyphs 74 px wide with ~3 px between the
 * ink, chunky and packed. Tracking cannot fix that on its own: closing the holes
 * with negative tracking leaves the letters thin, and widening the letters with a
 * scale re-opens the holes.
 *
 * So a run is laid out by INK, not by advance: every glyph's exact ink box is
 * measured, the boxes are butted together with a fixed ink-to-ink gap, and one
 * horizontal scale is solved so the whole run lands on the target width. The
 * result is a single combined Path2D, so the black keyline strokes the run once
 * and never doubles up where two glyphs are close.
 */
export function inkRun(F, face, text, size, gap, xs, o) {
  const s = String(text === undefined || text === null ? '' : text);
  const items = [];
  let x = 0, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === ' ') { x += size * 0.30; continue; }
    const b = inkBox(F, face, ch, size, o);
    if (!(b.w > 0) && !(b.h > 0)) { x += size * 0.30; continue; }
    items.push({ ch, b, at: x - b.x0 * xs });
    if (b.y0 < y0) y0 = b.y0;
    if (b.y1 > y1) y1 = b.y1;
    x += b.w * xs + gap;
  }
  const w = items.length ? x - gap : 0;
  return { items, w, y0: y0 === Infinity ? 0 : y0, y1: y1 === -Infinity ? 0 : y1, size, xs };
}

function runPath(F, face, run, o) {
  const p = new Path2D();
  for (const it of run.items) {
    const gp = F.path(it.ch, face, run.size, o);
    try {
      p.addPath(gp, new DOMMatrix([run.xs, 0, 0, 1, it.at, 0]));
    } catch (e) {
      matOk = false;
      return null;
    }
  }
  return p;
}

/* --------------------------------------------------------------- treatment */

/** Halo-only pass: push the shape off-canvas and keep just its shadow. */
function haloPass(c, p, color, blur, alpha, reps) {
  c.save();
  c.globalAlpha = alpha;
  c.shadowColor = color;
  c.shadowBlur = blur;
  c.shadowOffsetX = 6000;
  c.fillStyle = '#000';
  c.translate(-6000, 0);
  for (let i = 0; i < (reps || 1); i++) c.fill(p);
  c.restore();
}

/**
 * Set `text` so its INK box lands where the caller asked.
 *
 *   o.h        ink height in logical px (REQUIRED — this is the real control)
 *   o.xs       horizontal scale applied to the PATH (1 = natural aspect)
 *   o.w        optional: solve xs so the ink is exactly this wide (overrides o.xs)
 *   o.x, o.y   ink-box anchor; o.align picks which edge o.x refers to
 *   o.keyline  {color, k}  k = fraction of ink height OUTSIDE the glyph
 *   o.halo     {color, blur, alpha, reps}
 *   o.shadow   {color, blur, dy, alpha}
 *   o.grad     [[t,color],...] vertical across the ink box
 *   o.shade    {color, dy, alpha}  low-alpha dark inner fill that leaves a lit top rim
 *
 * Returns the ink rect actually drawn.
 */
export function inkText(F, c, text, face, o) {
  const s = String(text === undefined || text === null ? '' : text);
  if (!s.length) return { x: o.x, y: o.y, w: 0, h: 0 };
  const topt = { tracking: o.tracking, slant: o.slant };
  if (o.tracking === undefined) delete topt.tracking;
  if (o.slant === undefined) delete topt.slant;

  const size = sizeForInk(F, face, s, o.h, topt);
  const b = inkBox(F, face, s, size, topt);
  let xs = o.xs === undefined ? 1 : o.xs;
  if (o.w !== undefined && b.w > 0.01) xs = o.w / b.w;
  if (o.maxXs !== undefined && xs > o.maxXs) xs = o.maxXs;
  if (o.minXs !== undefined && xs < o.minXs) xs = o.minXs;

  const inkW = b.w * xs;
  let ix = o.x;
  if (o.align === 'right') ix = o.x - inkW;
  else if (o.align === 'center') ix = o.x - inkW / 2;

  const p0 = F.path(s, face, size, topt);
  const p = scaledPath(p0, xs) || p0;
  const useCtxScale = p === p0 && Math.abs(xs - 1) >= 0.002;

  c.save();
  c.translate(ix - b.x0 * (useCtxScale ? 1 : xs), o.y - b.y0);
  if (useCtxScale) c.scale(xs, 1);
  c.lineJoin = 'round';
  c.lineCap = 'round';

  paint(c, p, b.y0, b.y1, o);
  c.restore();
  return { x: ix, y: o.y, w: inkW, h: o.h, size, xs };
}

/**
 * The scoreboard setter. Same treatment vocabulary as inkText(), but the run is
 * laid out ink-to-ink with a fixed `gap` and one solved horizontal scale, so the
 * string lands on `o.w` x `o.h` PACKED instead of letterspaced.
 *
 *   o.gap    ink-to-ink gap in logical px (bar: ~3.5 for abbreviations, ~6 for
 *            score numerals, ~4 for the clock)
 */
export function inkSet(F, c, text, face, o) {
  const s = String(text === undefined || text === null ? '' : text);
  if (!s.length) return { x: o.x, y: o.y, w: 0, h: 0 };
  const topt = {};
  if (o.tracking !== undefined) topt.tracking = o.tracking;
  if (o.slant !== undefined) topt.slant = o.slant;
  topt.tracking = 0;                       // a run controls its own spacing

  const gap = o.gap === undefined ? 3.5 : o.gap;
  const size = sizeForInk(F, face, s, o.h, topt);
  const nat1 = inkRun(F, face, s, size, gap, 1, topt);
  const gaps = gap * Math.max(0, nat1.items.length - 1);
  let xs = o.xs === undefined ? 1 : o.xs;
  if (o.w !== undefined && nat1.w - gaps > 0.01) xs = (o.w - gaps) / (nat1.w - gaps);
  if (o.maxXs !== undefined && xs > o.maxXs) xs = o.maxXs;
  if (o.minXs !== undefined && xs < o.minXs) xs = o.minXs;

  const run = inkRun(F, face, s, size, gap, xs, topt);
  const p = runPath(F, face, run, topt);
  if (!p) {
    return inkText(F, c, s, face, Object.assign({}, o, { xs, w: undefined }));
  }
  let ix = o.x;
  if (o.align === 'right') ix = o.x - run.w;
  else if (o.align === 'center') ix = o.x - run.w / 2;

  c.save();
  c.translate(ix, o.y - run.y0);
  c.lineJoin = 'round';
  c.lineCap = 'round';
  paint(c, p, run.y0, run.y1, o);
  c.restore();
  return { x: ix, y: o.y, w: run.w, h: o.h, size, xs };
}

/**
 * Shared passes: warm halation, drop shadow, hard keyline, fill, inner top-light.
 * `o.shade` is the top-light: clipping to `p` and filling `p` shifted DOWN paints
 * p ∩ (p+dy) — everything except the top edge of every stroke — so a low-alpha
 * DARK fill leaves a lit rim exactly along the top of each stroke. It is a fill
 * and not a stroke, so it cannot draw a line down an internal glyph boundary the
 * way stroking a union-of-strokes outline would.
 */
function paint(c, p, y0, y1, o) {
  if (o.halo) {
    haloPass(c, p, o.halo.color, o.halo.blur, o.halo.alpha === undefined ? 1 : o.halo.alpha, o.halo.reps);
  }
  if (o.shadow) {
    c.save();
    c.globalAlpha = o.shadow.alpha === undefined ? 1 : o.shadow.alpha;
    c.shadowColor = o.shadow.color;
    c.shadowBlur = o.shadow.blur;
    c.shadowOffsetX = 6000;
    c.shadowOffsetY = o.shadow.dy || 0;
    c.fillStyle = '#000';
    c.translate(-6000, 0);
    c.fill(p);
    c.restore();
  }
  if (o.keyline) {
    c.lineWidth = o.h * o.keyline.k * 2;
    c.strokeStyle = o.keyline.color;
    c.stroke(p);
  }
  if (o.grad) {
    const g = c.createLinearGradient(0, y0, 0, y1);
    for (const st of o.grad) g.addColorStop(st[0], st[1]);
    c.fillStyle = g;
  } else {
    c.fillStyle = o.fill || '#ffffff';
  }
  c.fill(p);
  if (o.shade) {
    c.save();
    c.clip(p);
    c.globalAlpha = o.shade.alpha;
    c.fillStyle = o.shade.color;
    c.translate(0, o.shade.dy);
    c.fill(p);
    c.restore();
  }
}

export default { inkBox, sizeForInk, inkText, inkSet, inkRun };
