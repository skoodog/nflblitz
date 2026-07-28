// PIECE brand-identity — drawing kernel.
// Colour maths, path tracing, "inked plate" rendering, bevels, glows, grain.
// Everything here is deterministic: no Math.random, no clocks.

import { makeRng, hash01 } from '../../foundation/rng.js';

/* ------------------------------------------------------------------ colour */

export function hex2rgb(h) {
  const s = String(h).replace('#', '');
  const v = s.length === 3
    ? s.split('').map((c) => parseInt(c + c, 16))
    : [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
  return [v[0] | 0, v[1] | 0, v[2] | 0];
}
const cl = (v) => Math.max(0, Math.min(255, Math.round(v)));
export function rgb2hex(r, g, b) {
  return '#' + [cl(r), cl(g), cl(b)].map((v) => v.toString(16).padStart(2, '0')).join('');
}
export function mix(a, b, t) {
  const A = hex2rgb(a), B = hex2rgb(b);
  return rgb2hex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}
export const lighten = (c, t) => mix(c, '#ffffff', t);
export const darken = (c, t) => mix(c, '#000000', t);
export function rgba(c, a) {
  const v = hex2rgb(c);
  return `rgba(${v[0]},${v[1]},${v[2]},${a})`;
}
/** Push a colour toward its own hue-max (crank chroma) then optionally brighten. */
export function vivid(c, k) {
  const v = hex2rgb(c);
  const mx = Math.max(v[0], v[1], v[2]), mn = Math.min(v[0], v[1], v[2]);
  const mid = (mx + mn) * 0.5;
  return rgb2hex(
    mid + (v[0] - mid) * (1 + k),
    mid + (v[1] - mid) * (1 + k),
    mid + (v[2] - mid) * (1 + k)
  );
}
export function luma(c) {
  const v = hex2rgb(c);
  return (0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]) / 255;
}

/* -------------------------------------------------------------------- path */
// Segment list. Each entry:
//   [x, y]                        -> moveTo (first) / lineTo
//   ['m', x, y]                   -> moveTo
//   ['c', x1,y1, x2,y2, x,y]      -> bezierCurveTo
//   ['q', x1,y1, x,y]             -> quadraticCurveTo

export function trace(c, seg) {
  let first = true;
  for (let i = 0; i < seg.length; i++) {
    const s = seg[i];
    if (typeof s[0] === 'number') {
      if (first) { c.moveTo(s[0], s[1]); first = false; } else c.lineTo(s[0], s[1]);
    } else if (s[0] === 'm') { c.moveTo(s[1], s[2]); first = false; }
    else if (s[0] === 'c') { c.bezierCurveTo(s[1], s[2], s[3], s[4], s[5], s[6]); }
    else if (s[0] === 'q') { c.quadraticCurveTo(s[1], s[2], s[3], s[4]); }
  }
}

export function pathOf(c, seg, close = true) {
  c.beginPath();
  trace(c, seg);
  if (close) c.closePath();
}

/* --------------------------------------------------------------- gradients */

export function lin(c, x0, y0, x1, y1, stops) {
  const g = c.createLinearGradient(x0, y0, x1, y1);
  for (const s of stops) g.addColorStop(s[0], s[1]);
  return g;
}
export function rad(c, x0, y0, r0, x1, y1, r1, stops) {
  const g = c.createRadialGradient(x0, y0, r0, x1, y1, r1);
  for (const s of stops) g.addColorStop(s[0], s[1]);
  return g;
}

/**
 * A metal ramp: dark base -> mid -> bright edge -> mid -> dark, the classic
 * chrome/bevel response. `dir` in radians, `box` = [x,y,w,h].
 */
export function metal(c, box, base, opts = {}) {
  const [x, y, w, h] = box;
  const a = opts.dir === undefined ? Math.PI * 0.62 : opts.dir;
  const L = Math.max(w, h);
  const cx = x + w / 2, cy = y + h / 2;
  const dx = Math.cos(a) * L * 0.6, dy = Math.sin(a) * L * 0.6;
  const hi = opts.hi === undefined ? 0.62 : opts.hi;
  const lo = opts.lo === undefined ? 0.55 : opts.lo;
  return lin(c, cx - dx, cy - dy, cx + dx, cy + dy, [
    [0.00, darken(base, lo * 0.85)],
    [0.16, lighten(base, hi * 0.30)],
    [0.34, lighten(base, hi)],
    [0.44, lighten(base, hi * 0.34)],
    [0.58, base],
    [0.74, darken(base, lo * 0.55)],
    [0.90, darken(base, lo * 0.86)],
    [1.00, darken(base, lo)],
  ]);
}

/* --------------------------------------------------- inked plate primitive */

/**
 * The e-sports crest primitive: a shape with a heavy dark keyline, filled with a
 * shaded plate. Draw parts back-to-front; each part's keyline reads over the one
 * behind it.
 */
export function plate(c, seg, opts = {}) {
  const ink = opts.ink === undefined ? 22 : opts.ink;
  const inkColor = opts.inkColor || '#05080a';
  pathOf(c, seg, opts.close !== false);
  c.lineJoin = opts.join || 'round';
  c.lineCap = 'round';
  if (ink > 0) {
    c.strokeStyle = inkColor;
    c.lineWidth = ink;
    c.stroke();
    c.fillStyle = inkColor;
    c.fill();
  }
  if (opts.fill) {
    c.fillStyle = opts.fill;
    c.fill();
  }
  if (opts.inner) {
    c.strokeStyle = opts.inner;
    c.lineWidth = opts.innerW === undefined ? 4 : opts.innerW;
    c.stroke();
  }
}

/** A dark detail line (fold, seam, wrinkle). */
export function line(c, seg, w = 9, color = '#05080a', cap = 'round') {
  pathOf(c, seg, false);
  c.lineCap = cap;
  c.lineJoin = 'round';
  c.strokeStyle = color;
  c.lineWidth = w;
  c.stroke();
}

/** A bright specular sliver — the thing that makes a flat plate read as metal. */
export function spec(c, seg, color = 'rgba(255,255,255,0.85)') {
  pathOf(c, seg, true);
  c.fillStyle = color;
  c.fill();
}

/** Run `fn` twice: as authored, and mirrored about x = axis. */
export function sym(c, fn, axis = 500) {
  c.save(); fn(c, 1); c.restore();
  c.save(); c.translate(axis * 2, 0); c.scale(-1, 1); fn(c, -1); c.restore();
}

/* ---------------------------------------------------------------- surfaces */

export function mkCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(Math.max(1, w | 0), Math.max(1, h | 0));
  const c = document.createElement('canvas');
  c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0);
  return c;
}

/** Rounded rect path. */
export function rr(c, x, y, w, h, r) {
  const rad2 = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + rad2, y);
  c.lineTo(x + w - rad2, y);
  c.quadraticCurveTo(x + w, y, x + w, y + rad2);
  c.lineTo(x + w, y + h - rad2);
  c.quadraticCurveTo(x + w, y + h, x + w - rad2, y + h);
  c.lineTo(x + rad2, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - rad2);
  c.lineTo(x, y + rad2);
  c.quadraticCurveTo(x, y, x + rad2, y);
  c.closePath();
}

/* --------------------------------------------------------- surface finishes */

/**
 * Fine anisotropic scratches + grain, composited source-atop so they only touch
 * pixels that already exist. This is the single biggest "premium vs clip-art" tell.
 */
export function scratchPass(c, w, h, seed, opts = {}) {
  const rng = makeRng(seed);
  const n = opts.count === undefined ? 90 : opts.count;
  c.save();
  c.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < n; i++) {
    const x = rng() * w, y = rng() * h;
    const len = (0.02 + rng() * 0.11) * w;
    const a = (rng() - 0.5) * 0.9 - 0.42;
    const bright = rng() < 0.62;
    c.globalAlpha = (bright ? 0.055 : 0.085) * (0.35 + rng() * 0.65) * (opts.strength || 1);
    c.strokeStyle = bright ? '#ffffff' : '#000000';
    c.lineWidth = Math.max(0.6, w * (0.0007 + rng() * 0.0016));
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    c.stroke();
  }
  c.restore();
}

/** Deterministic film grain over an existing image. */
export function grainPass(c, w, h, seed, strength = 0.05, cell = 2) {
  c.save();
  c.globalCompositeOperation = 'source-atop';
  const nx = Math.ceil(w / cell), ny = Math.ceil(h / cell);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const v = hash01(i, j, seed);
      if (v < 0.55) continue;
      c.globalAlpha = (v - 0.55) * strength * 2.2;
      c.fillStyle = ((i * 7 + j * 13 + seed) & 1) ? '#ffffff' : '#000000';
      c.fillRect(i * cell, j * cell, cell, cell);
    }
  }
  c.restore();
}

/** Directional sheen — a raking light across whatever is already drawn. */
export function sheenPass(c, w, h, opts = {}) {
  c.save();
  c.globalCompositeOperation = 'source-atop';
  const g = lin(c, w * (opts.x0 ?? 0.02), h * (opts.y0 ?? -0.05), w * (opts.x1 ?? 0.9), h * (opts.y1 ?? 1.05), [
    [0.00, `rgba(255,255,255,${opts.top ?? 0.16})`],
    [0.30, 'rgba(255,255,255,0.045)'],
    [0.55, 'rgba(0,0,0,0)'],
    [1.00, `rgba(0,0,0,${opts.bot ?? 0.32})`],
  ]);
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  c.restore();
}

/** Inner colour glow — accent bleeding out of the emblem's core. */
export function innerGlowPass(c, w, h, color, opts = {}) {
  c.save();
  c.globalCompositeOperation = opts.op || 'source-atop';
  c.globalAlpha = opts.alpha === undefined ? 0.3 : opts.alpha;
  const g = rad(c, w * (opts.cx ?? 0.5), h * (opts.cy ?? 0.52), 0, w * (opts.cx ?? 0.5), h * (opts.cy ?? 0.52), w * (opts.r ?? 0.62), [
    [0.0, rgba(color, 0.75)],
    [0.45, rgba(color, 0.28)],
    [1.0, rgba(color, 0.0)],
  ]);
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  c.restore();
}

/** Soft outer bloom behind an emblem (drawn before it). */
export function outerGlow(c, x, y, r, color, alpha = 0.5) {
  c.save();
  const g = rad(c, x, y, 0, x, y, r, [
    [0.0, rgba(color, alpha)],
    [0.35, rgba(color, alpha * 0.42)],
    [0.72, rgba(color, alpha * 0.10)],
    [1.0, rgba(color, 0)],
  ]);
  c.fillStyle = g;
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  c.restore();
}

/* ------------------------------------------------------------- backgrounds */

/**
 * The faceted near-black panel every card in the bar art sits on: shattered
 * low-contrast polygons, a colour wash, a vignette and grain.
 */
export function facetedPanel(c, x, y, w, h, color, seed, opts = {}) {
  const rng = makeRng(seed);
  c.save();
  c.beginPath();
  if (opts.round) rr(c, x, y, w, h, opts.round); else c.rect(x, y, w, h);
  c.clip();

  const base = opts.base || '#08090c';
  c.fillStyle = lin(c, x, y, x, y + h, [
    [0, lighten(base, 0.05)],
    [0.45, base],
    [1, darken(base, 0.5)],
  ]);
  c.fillRect(x, y, w, h);

  // colour wash from the team hue
  c.globalCompositeOperation = 'lighter';
  c.fillStyle = rad(c, x + w * 0.5, y + h * (opts.wy ?? 0.36), 0, x + w * 0.5, y + h * (opts.wy ?? 0.36), Math.max(w, h) * 0.72, [
    [0, rgba(color, opts.wash ?? 0.30)],
    [0.5, rgba(color, (opts.wash ?? 0.30) * 0.30)],
    [1, rgba(color, 0)],
  ]);
  c.fillRect(x, y, w, h);
  c.globalCompositeOperation = 'source-over';

  // shattered facets
  const n = opts.facets === undefined ? 26 : opts.facets;
  for (let i = 0; i < n; i++) {
    const px = x + rng() * w, py = y + h * (0.05 + rng() * 0.75);
    const s = (0.08 + rng() * 0.30) * Math.min(w, h) * 1.5;
    const a0 = rng() * Math.PI * 2;
    const k = 3 + (rng() * 3) | 0;
    c.beginPath();
    for (let j = 0; j < k; j++) {
      const a = a0 + (j / k) * Math.PI * 2 + rng() * 0.5;
      const rr2 = s * (0.35 + rng() * 0.85);
      const vx = px + Math.cos(a) * rr2, vy = py + Math.sin(a) * rr2 * 0.8;
      if (j === 0) c.moveTo(vx, vy); else c.lineTo(vx, vy);
    }
    c.closePath();
    const up = rng() < 0.5;
    c.globalAlpha = 0.05 + rng() * 0.09;
    c.fillStyle = up ? lighten(color, 0.05) : '#000000';
    c.fill();
  }
  c.globalAlpha = 1;

  // vignette
  c.fillStyle = rad(c, x + w * 0.5, y + h * 0.42, Math.min(w, h) * 0.18, x + w * 0.5, y + h * 0.5, Math.max(w, h) * 0.78, [
    [0, 'rgba(0,0,0,0)'],
    [0.62, 'rgba(0,0,0,0.30)'],
    [1, 'rgba(0,0,0,0.80)'],
  ]);
  c.fillRect(x, y, w, h);
  c.restore();
}

/** Jagged shard burst behind a mascot — the team-colour splash in the bar art. */
export function shardBurst(c, cx, cy, r, color, seed, opts = {}) {
  const rng = makeRng(seed);
  const n = opts.count === undefined ? 13 : opts.count;
  c.save();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng() * 0.35 + (opts.rot || 0);
    const len = r * (0.45 + rng() * 0.72);
    const wid = r * (0.06 + rng() * 0.15);
    const ax = Math.cos(a), ay = Math.sin(a);
    const bx = -ay, by = ax;
    const base = r * (0.16 + rng() * 0.24);
    c.beginPath();
    c.moveTo(cx + ax * base + bx * wid, cy + ay * base + by * wid);
    c.lineTo(cx + ax * len + bx * wid * 0.12, cy + ay * len + by * wid * 0.12);
    c.lineTo(cx + ax * len * (0.72 + rng() * 0.2) - bx * wid * 0.9, cy + ay * len * (0.72 + rng() * 0.2) - by * wid * 0.9);
    c.closePath();
    const t = rng();
    c.globalAlpha = (opts.alpha ?? 0.55) * (0.34 + t * 0.8);
    c.fillStyle = t < 0.4 ? darken(color, 0.45) : t < 0.8 ? color : lighten(color, 0.22);
    c.fill();
  }
  c.globalAlpha = 1;
  c.restore();
}

/* ----------------------------------------------------------------- lettering */

/**
 * Condensed caps via REG.faces with a horizontal compression — the bar's UI type is
 * a tight squarish sans. When `typeface-lettering` lands its real faces flow through
 * here automatically.
 */
export function capsText(c, faces, text, x, y, opts = {}) {
  const size = opts.size || 40;
  const cond = opts.cond === undefined ? 0.84 : opts.cond;
  const align = opts.align || 'center';
  c.save();
  c.translate(x, y);
  c.scale(cond, 1);
  const r = faces.draw(c, String(text).toUpperCase(), 0, 0, {
    face: opts.face || 'blitz-block',
    size,
    align,
    tracking: opts.tracking === undefined ? 0.055 : opts.tracking,
    fill: opts.fill || '#e8e8ec',
    stroke: opts.stroke,
    strokeWidth: opts.strokeWidth,
  });
  c.restore();
  return r ? { w: (r.w || 0) * cond, h: r.h || size } : { w: 0, h: size };
}

/* ------------------------------------------------------------ value noise */

function vn(ix, iy, s) { return hash01(ix, iy, s); }
export function noise2(x, y, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = vn(ix, iy, seed), b = vn(ix + 1, iy, seed);
  const cc = vn(ix, iy + 1, seed), d = vn(ix + 1, iy + 1, seed);
  return (a + (b - a) * ux) + ((cc + (d - cc) * ux) - (a + (b - a) * ux)) * uy;
}
export function fbm2(x, y, oct = 4, seed = 0) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * noise2(x * f, y * f, seed + i * 17); f *= 2; a *= 0.5; }
  return s;
}

/** Mirror-close a half path authored from axis to axis. */
export function mirrorClose(seg, axis = 500) {
  const items = [];
  let cur = null;
  for (const s of seg) {
    if (typeof s[0] === 'number') {
      if (cur === null) { cur = [s[0], s[1]]; items.push({ t: 'S', to: cur }); }
      else { items.push({ t: 'L', from: cur, to: [s[0], s[1]] }); cur = [s[0], s[1]]; }
    } else if (s[0] === 'm') { cur = [s[1], s[2]]; items.push({ t: 'S', to: cur }); }
    else if (s[0] === 'c') { items.push({ t: 'C', from: cur, c1: [s[1], s[2]], c2: [s[3], s[4]], to: [s[5], s[6]] }); cur = [s[5], s[6]]; }
    else if (s[0] === 'q') { items.push({ t: 'Q', from: cur, c1: [s[1], s[2]], to: [s[3], s[4]] }); cur = [s[3], s[4]]; }
  }
  const M = (p) => [2 * axis - p[0], p[1]];
  const out = seg.slice();
  for (let i = items.length - 1; i >= 1; i--) {
    const it = items[i];
    if (it.t === 'L') out.push(M(it.from));
    else if (it.t === 'C') out.push(['c', ...M(it.c2), ...M(it.c1), ...M(it.from)]);
    else if (it.t === 'Q') out.push(['q', ...M(it.c1), ...M(it.from)]);
  }
  return out;
}
