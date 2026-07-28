// PIECE: typeface-lettering — the `faces` implementation registered into REG.faces.
//
// Implements the frozen contract
//   measure(text, face, sizePx, opts) -> {w,h,ascent,descent}
//   path(text, face, sizePx, opts)    -> Path2D
//   draw(c2d, text, x, y, opts)       -> {w,h}
// and adds the texturing hook the brief asks for, so a consumer can get the brush's
// rough edge and inner grain without knowing anything about how the glyphs are made:
//
//   faces.ink(c2d, text, x, y, opts)     full display treatment (outline + drop shadow + grain)
//   faces.grain(c2d, path, box, opts)    grain-only, for a caller that owns its own fill
//   faces.paths(text, face, size, opts)  per-glyph Path2D list, for per-letter animation
//
// Extra opts understood by draw()/ink() (all optional, all backwards compatible):
//   gradient:[[t,color],...]  vertical gradient across the cap height
//   glow:{color,blur,alpha}   soft outer halo
//   grain:0..1                inner brush grain + dry-brush skips
//   emboss:0..1               inner top-light / bottom-shadow bevel (metal; off by default
//                             for the brush face, which the bar renders flat)
//   rotate:radians            rotation about the anchor point
//   outline / outlineWidth    alias of stroke / strokeWidth, drawn UNDER the fill

import { makeRng, hash, seedFromString } from '../../foundation/rng.js';
import { buildFonts } from './build.js';

const NAMES = ['blitz-brush', 'blitz-block', 'blitz-num', 'blitz-techno'];
const SYSTEM_STACK = '"Liberation Sans","DejaVu Sans","FreeSans",Arial,sans-serif';

function key(n) { return NAMES.includes(n) ? n : 'blitz-block'; }

export function createFaces() {
  const FONTS = buildFonts();

  const font = (n) => FONTS[key(n)];

  function glyphOf(f, ch) {
    if (!f.glyphs) return null;
    return f.glyphs[ch] || f.glyphs[ch.toUpperCase()] || f.glyphs[ch.toLowerCase()] || null;
  }

  function trackOf(f, o) {
    return o && o.tracking !== undefined ? o.tracking : (f.defaultTracking || 0);
  }
  function slantOf(f, o) {
    return o && o.slant !== undefined ? o.slant : (f.defaultSlant || 0);
  }

  function measure(text, faceName, sizePx, o = {}) {
    const f = font(faceName);
    const s = String(text === undefined || text === null ? '' : text);
    const upm = f.unitsPerEm || 1000;
    const k = sizePx / upm;
    const tracking = trackOf(f, o);
    let w = 0;
    for (let i = 0; i < s.length; i++) {
      const g = glyphOf(f, s[i]);
      w += (g ? g.adv : upm * 0.42) * k;
      if (f.kern && i < s.length - 1) {
        const kv = f.kern[s[i] + s[i + 1]];
        if (kv) w += kv * k;
      }
      w += tracking * sizePx;
    }
    if (s.length) w -= tracking * sizePx;
    const ascent = (f.ascent !== undefined ? f.ascent : upm * 0.75) * k;
    const descent = Math.abs(f.descent !== undefined ? f.descent : -upm * 0.25) * k;
    const cap = (f.capHeight || upm * 0.7) * k;
    return { w, h: ascent + descent, ascent, descent, cap, fallback: false };
  }

  /** Emit glyph commands into a Path2D-like sink at pen position x, sheared by slant. */
  function emit(sink, f, s, sizePx, tracking, slant) {
    const upm = f.unitsPerEm || 1000;
    const k = sizePx / upm;
    let x = 0;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      const g = glyphOf(f, ch);
      if (g && g.cmds && g.cmds.length) {
        const p = sink.begin ? sink.begin() : sink.p;
        for (const c of g.cmds) {
          if (c[0] === 'Z') { p.closePath(); continue; }
          const yy = -c[2] * k;
          // Shear convention: POSITIVE slant leans RIGHT (like CSS `oblique`).
          const ax = x + c[1] * k - yy * slant;
          if (c[0] === 'M') p.moveTo(ax, yy);
          else p.lineTo(ax, yy);
        }
        if (sink.end) sink.end(x);
      }
      x += (g ? g.adv : upm * 0.42) * k;
      if (f.kern && i < s.length - 1) {
        const kv = f.kern[ch + s[i + 1]];
        if (kv) x += kv * k;
      }
      x += tracking * sizePx;
    }
    return x;
  }

  function path(text, faceName, sizePx, o = {}) {
    const f = font(faceName);
    const s = String(text === undefined || text === null ? '' : text);
    const p = new Path2D();
    emit({ p }, f, s, sizePx, trackOf(f, o), slantOf(f, o));
    return p;
  }

  /** One Path2D per drawn glyph, in order — for per-letter animation. */
  function paths(text, faceName, sizePx, o = {}) {
    const f = font(faceName);
    const s = String(text === undefined || text === null ? '' : text);
    const out = [];
    let cur = null;
    emit({
      begin() { cur = new Path2D(); return cur; },
      end(x) { out.push({ path: cur, x }); },
    }, f, s, sizePx, trackOf(f, o), slantOf(f, o));
    return out;
  }

  /* ------------------------------------------------------------- texture */

  /**
   * The texturing hook. Clips to `p` and lays in dry-brush skips, longitudinal
   * grain and edge speckle. `box` = {x0,y0,x1,y1} in the CURRENT transform.
   */
  function grain(c2d, p, box, o = {}) {
    const amt = o.amount !== undefined ? o.amount : 0.4;
    if (amt <= 0) return;
    const h = Math.max(1, box.y1 - box.y0);
    const w = Math.max(1, box.x1 - box.x0);
    const rng = makeRng(hash(o.seed !== undefined ? o.seed | 0 : 1337, Math.round(w), Math.round(h)));
    const slant = o.slant !== undefined ? o.slant : 0.27;

    c2d.save();
    c2d.clip(p);
    c2d.lineCap = 'butt';

    // Dry-brush skips run WITH the stroke, i.e. down the italic axis, not across it.
    const nSkip = Math.round(5 + amt * 22);
    for (let i = 0; i < nSkip; i++) {
      const x = box.x0 + rng() * w;
      const y = box.y0 + rng() * h;
      const len = h * (0.14 + rng() * 0.55);
      const th = h * (0.004 + rng() * 0.011);
      const light = rng() < 0.55;
      c2d.strokeStyle = light
        ? `rgba(255,255,255,${((0.03 + rng() * 0.07) * amt).toFixed(3)})`
        : `rgba(0,0,0,${((0.03 + rng() * 0.09) * amt).toFixed(3)})`;
      c2d.lineWidth = th;
      c2d.beginPath();
      c2d.moveTo(x, y);
      c2d.lineTo(x + len * slant, y + len);
      c2d.stroke();
    }

    // Very fine tooth so flat colour never reads as vector-flat.
    const nSpec = Math.round(30 + amt * 120);
    for (let i = 0; i < nSpec; i++) {
      const x = box.x0 + rng() * w;
      const y = box.y0 + rng() * h;
      const r = h * (0.0015 + rng() * 0.005);
      c2d.fillStyle = rng() < 0.5
        ? `rgba(0,0,0,${((0.03 + rng() * 0.08) * amt).toFixed(3)})`
        : `rgba(255,255,255,${((0.03 + rng() * 0.07) * amt).toFixed(3)})`;
      c2d.fillRect(x, y, r * 1.6, r * 2.6);
    }
    c2d.restore();
  }

  /* --------------------------------------------------------------- bevel */

  let scratchCv = null;
  function scratch(w, h) {
    if (!scratchCv) {
      scratchCv = (typeof OffscreenCanvas !== 'undefined')
        ? new OffscreenCanvas(w, h)
        : document.createElement('canvas');
    }
    if (scratchCv.width < w) scratchCv.width = w;
    if (scratchCv.height < h) scratchCv.height = h;
    return scratchCv;
  }

  function bevel(c2d, p, box, amt, size) {
    const pad = size * 0.35;
    const ox = Math.floor(box.x0 - pad), oy = Math.floor(box.y0 - pad);
    const w = Math.ceil(box.x1 - box.x0 + pad * 2);
    const h = Math.ceil(box.y1 - box.y0 + pad * 2);
    if (w < 2 || h < 2 || w > 6000 || h > 3000) return;
    const cv = scratch(w, h);
    const g = cv.getContext('2d');
    const dx = size * 0.018, dy = size * 0.030;

    const pass = (col, sx, sy, alpha) => {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'source-over';
      g.clearRect(0, 0, cv.width, cv.height);
      g.translate(-ox, -oy);
      g.fillStyle = col;
      g.fill(p);
      g.globalCompositeOperation = 'destination-out';
      g.save(); g.translate(sx, sy); g.fill(p); g.restore();
      g.globalCompositeOperation = 'source-over';
      c2d.save();
      c2d.globalAlpha = alpha;
      c2d.drawImage(cv, 0, 0, w, h, ox, oy, w, h);
      c2d.restore();
    };
    pass('#ffffff', dx, dy, 0.55 * amt);
    pass('#000000', -dx, -dy, 0.48 * amt);
  }

  /* ---------------------------------------------------------------- draw */

  function resolveFill(c2d, o, box) {
    if (o.gradient && o.gradient.length) {
      const g = c2d.createLinearGradient(0, box.y0, 0, box.y1);
      for (const st of o.gradient) g.addColorStop(Math.min(1, Math.max(0, st[0])), st[1]);
      return g;
    }
    if (typeof o.fill === 'function') return o.fill(box, c2d);
    return o.fill || '#ffffff';
  }

  function draw(c2d, text, x, y, o = {}) {
    const name = key(o.face);
    const f = font(name);
    const size = o.size || 48;
    const s = String(text === undefined || text === null ? '' : text);
    if (!s.length) return { w: 0, h: 0, ascent: 0 };
    const m = measure(s, name, size, o);

    let ox = x;
    if (o.align === 'center') ox = x - m.w / 2;
    else if (o.align === 'right') ox = x - m.w;
    let oy = y;
    if (o.baseline === 'top') oy = y + m.cap;
    else if (o.baseline === 'middle') oy = y + m.cap / 2;
    else if (o.baseline === 'bottom') oy = y;

    const p = path(s, name, size, o);
    const slant = slantOf(f, o);
    const box = { x0: -size * 0.1, y0: -m.cap * 1.02, x1: m.w + size * 0.1, y1: size * 0.05 };

    c2d.save();
    if (o.rotate) {
      c2d.translate(x, y);
      c2d.rotate(o.rotate);
      c2d.translate(ox - x, oy - y);
    } else {
      c2d.translate(ox, oy);
    }

    // --- outer glow ------------------------------------------------------
    if (o.glow) {
      c2d.save();
      c2d.globalAlpha = o.glow.alpha !== undefined ? o.glow.alpha : 0.6;
      c2d.shadowColor = o.glow.color || 'rgba(255,190,60,0.9)';
      c2d.shadowBlur = o.glow.blur !== undefined ? o.glow.blur : size * 0.5;
      c2d.fillStyle = o.glow.color || 'rgba(255,190,60,0.9)';
      const reps = o.glow.reps || 2;
      for (let i = 0; i < reps; i++) c2d.fill(p);
      c2d.restore();
    }

    // --- drop shadow + dark outline --------------------------------------
    const outline = o.outline !== undefined ? o.outline : o.stroke;
    const outlineW = o.outlineWidth !== undefined ? o.outlineWidth
      : (o.strokeWidth !== undefined ? o.strokeWidth : size * 0.075);
    if (o.shadow) {
      c2d.save();
      c2d.shadowColor = o.shadow.color || 'rgba(0,0,0,0.8)';
      c2d.shadowBlur = o.shadow.blur !== undefined ? o.shadow.blur : size * 0.2;
      c2d.shadowOffsetX = o.shadow.dx || 0;
      c2d.shadowOffsetY = o.shadow.dy !== undefined ? o.shadow.dy : size * 0.07;
      c2d.fillStyle = o.shadow.color || 'rgba(0,0,0,0.8)';
      if (outline) { c2d.lineJoin = 'round'; c2d.lineWidth = outlineW; c2d.strokeStyle = o.shadow.color || 'rgba(0,0,0,0.8)'; c2d.stroke(p); }
      c2d.fill(p);
      if (o.shadow.reps) for (let i = 1; i < o.shadow.reps; i++) c2d.fill(p);
      c2d.restore();
    }
    if (outline) {
      c2d.lineJoin = 'round';
      c2d.lineCap = 'round';
      c2d.lineWidth = outlineW;
      c2d.strokeStyle = outline;
      c2d.stroke(p);
    }

    // --- fill -------------------------------------------------------------
    c2d.fillStyle = resolveFill(c2d, o, box);
    c2d.fill(p);

    // --- inner bevel ------------------------------------------------------
    // Stroking the path would draw a bright line along EVERY internal subpath
    // boundary (glyphs are unions of overlapping strokes), which reads as cracks
    // through the letter. So the bevel is built as `silhouette minus offset
    // silhouette` on a scratch layer: destination-out sees the filled union, so
    // internal seams simply do not exist.
    if ((o.emboss || 0) > 0) bevel(c2d, p, box, o.emboss, size);

    // --- brush grain ------------------------------------------------------
    const gAmt = o.grain !== undefined ? o.grain : (name === 'blitz-brush' && size >= 34 ? 0.30 : 0);
    if (gAmt > 0) {
      grain(c2d, p, box, {
        amount: gAmt,
        slant,
        seed: hash(seedFromString(s), Math.round(size), Math.round(m.w)),
      });
    }

    c2d.restore();
    return { w: m.w, h: m.h, ascent: m.ascent, cap: m.cap, fallback: false };
  }

  /** Full display treatment in one call — the loud lockup look from the bar. */
  function ink(c2d, text, x, y, o = {}) {
    const size = o.size || 96;
    return draw(c2d, text, x, y, Object.assign({
      outline: 'rgba(10,8,12,0.95)',
      outlineWidth: size * 0.048,
      shadow: { color: 'rgba(0,0,0,0.72)', blur: size * 0.30, dy: size * 0.075, reps: 2 },
      emboss: 0,
      grain: 0.30,
    }, o));
  }

  return {
    piece: 'typeface-lettering',
    names: NAMES.slice(),
    has: (n) => NAMES.includes(n),
    data: FONTS,
    measure,
    path,
    paths,
    draw,
    ink,
    grain,
    css: (n, px) => `${key(n) === 'blitz-brush' ? 'italic ' : ''}900 ${px}px ${SYSTEM_STACK}`,
  };
}

export default { createFaces };
