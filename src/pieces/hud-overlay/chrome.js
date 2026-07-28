// PIECE hud-overlay — shared Canvas2D chrome primitives.
//
// Everything here runs at BAKE time, never on the frame path. The frame path is
// two drawImage() calls; these functions build what those blits contain.
//
// Deterministic: seeded rng only, no clocks, no Math.random.

import { makeRng, hash } from '../../foundation/rng.js';

export function mkCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/* ------------------------------------------------------------------ colour */

export function hex2rgb(h) {
  let s = String(h).replace('#', '');
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgba(c, a) {
  const v = Array.isArray(c) ? c : hex2rgb(c);
  return `rgba(${v[0] | 0},${v[1] | 0},${v[2] | 0},${a})`;
}
export function mix(a, b, t) {
  const A = Array.isArray(a) ? a : hex2rgb(a);
  const B = Array.isArray(b) ? b : hex2rgb(b);
  return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
}
export function lighten(c, t) { return mix(c, [255, 255, 255], t); }
export function darken(c, t) { return mix(c, [0, 0, 0], t); }
/** Brighten by SCALING channels, so hue survives — unlike mixing toward white. */
export function brighten(c, k) {
  const v = Array.isArray(c) ? c : hex2rgb(c);
  return [Math.min(255, v[0] * k), Math.min(255, v[1] * k), Math.min(255, v[2] * k)];
}
/** Push a colour toward full chroma so a muddy team primary still reads as a colour. */
export function vivid(c, k) {
  const v = Array.isArray(c) ? c : hex2rgb(c);
  const mx = Math.max(v[0], v[1], v[2]);
  const mn = Math.min(v[0], v[1], v[2]);
  const mid = (mx + mn) * 0.5;
  return [
    Math.max(0, Math.min(255, mid + (v[0] - mid) * k)),
    Math.max(0, Math.min(255, mid + (v[1] - mid) * k)),
    Math.max(0, Math.min(255, mid + (v[2] - mid) * k)),
  ];
}
/** Relative luminance 0..1 — used to keep dark team colours legible on a dark plate. */
export function lum(c) {
  const v = Array.isArray(c) ? c : hex2rgb(c);
  return (0.299 * v[0] + 0.587 * v[1] + 0.114 * v[2]) / 255;
}
export function chroma(c) {
  const v = Array.isArray(c) ? c : hex2rgb(c);
  return (Math.max(v[0], v[1], v[2]) - Math.min(v[0], v[1], v[2])) / 255;
}

/**
 * THE HUD COLOUR. A club's `accent` is picked by the brand piece as the
 * brightest non-primary official, which for half the roster is silver or white
 * — and a white momentum bar tells a player nothing. The HUD instead wants the
 * most CHROMATIC colour the club owns, lifted until it survives a dark plate.
 * Deterministic, cached by the caller through the bake.
 */
export function hudColor(colors) {
  const cand = [];
  const push = (v) => {
    if (typeof v !== 'string' || v[0] !== '#') return;
    const k = v.toLowerCase();
    if (!cand.some((q) => q.k === k)) cand.push({ k, c: hex2rgb(v) });
  };
  if (colors) {
    if (Array.isArray(colors.officials)) for (const o of colors.officials) push(o);
    push(colors.accent); push(colors.secondary); push(colors.primary); push(colors.metal);
  }
  let best = null, bestScore = -1;
  for (const q of cand) {
    const ch = chroma(q.c), l = lum(q.c);
    const score = ch * (0.34 + 0.66 * Math.min(1, l / 0.5));
    if (score > bestScore) { bestScore = score; best = q.c; }
  }
  if (!best || bestScore < 0.055) best = hex2rgb('#5f9ad8');
  // Lift by SCALING, not by mixing toward white: a club red must stay red on a
  // dark plate instead of drifting to pink.
  let out = vivid(best, 1.38);
  const l = Math.max(0.02, lum(out));
  const k = Math.min(2.6, 0.44 / l);
  out = [Math.min(255, out[0] * k), Math.min(255, out[1] * k), Math.min(255, out[2] * k)];
  let n = 0;
  while (lum(out) < 0.30 && n++ < 5) out = lighten(out, 0.10);
  return out;
}

/* ------------------------------------------------------------------- paths */

export function rrPath(p, x, y, w, h, r) {
  const rr = Math.min(r, w * 0.5, h * 0.5);
  p.moveTo(x + rr, y);
  p.lineTo(x + w - rr, y);
  p.quadraticCurveTo(x + w, y, x + w, y + rr);
  p.lineTo(x + w, y + h - rr);
  p.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  p.lineTo(x + rr, y + h);
  p.quadraticCurveTo(x, y + h, x, y + h - rr);
  p.lineTo(x, y + rr);
  p.quadraticCurveTo(x, y, x + rr, y);
  p.closePath();
  return p;
}
export function rr(x, y, w, h, r) { return rrPath(new Path2D(), x, y, w, h, r); }

/** Rounded polygon through `pts` ([[x,y],...]) with a uniform corner radius. */
export function poly(pts, radius) {
  const p = new Path2D();
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
    const v0x = p0[0] - p1[0], v0y = p0[1] - p1[1];
    const v1x = p2[0] - p1[0], v1y = p2[1] - p1[1];
    const l0 = Math.hypot(v0x, v0y) || 1, l1 = Math.hypot(v1x, v1y) || 1;
    const r = Math.min(radius, l0 * 0.45, l1 * 0.45);
    const ax = p1[0] + (v0x / l0) * r, ay = p1[1] + (v0y / l0) * r;
    const bx = p1[0] + (v1x / l1) * r, by = p1[1] + (v1y / l1) * r;
    if (i === 0) p.moveTo(ax, ay); else p.lineTo(ax, ay);
    p.quadraticCurveTo(p1[0], p1[1], bx, by);
  }
  p.closePath();
  return p;
}

/* --------------------------------------------------------------- gradients */

export function vgrad(c, y0, y1, stops) {
  const g = c.createLinearGradient(0, y0, 0, y1);
  for (const s of stops) g.addColorStop(s[0], s[1]);
  return g;
}
export function hgrad(c, x0, x1, stops) {
  const g = c.createLinearGradient(x0, 0, x1, 0);
  for (const s of stops) g.addColorStop(s[0], s[1]);
  return g;
}

/* ----------------------------------------------------------------- texture */

/**
 * Fine sensor-grade tooth. Without this a Canvas2D plate reads as flat vector —
 * one of the five instant tells. Clipped to `path`, ~1 px specks, both signs.
 */
export function grain(c, path, x, y, w, h, seed, amount) {
  if (amount <= 0) return;
  const rng = makeRng(hash(seed | 0, w | 0, h | 0));
  c.save();
  c.clip(path);
  const n = Math.round(w * h * 0.10 * amount);
  for (let i = 0; i < n; i++) {
    const px = x + rng() * w;
    const py = y + rng() * h;
    const a = (0.012 + rng() * 0.055) * amount;
    c.fillStyle = rng() < 0.52 ? `rgba(0,0,0,${a.toFixed(3)})` : `rgba(190,215,255,${a.toFixed(3)})`;
    c.fillRect(px, py, 1, rng() < 0.25 ? 2 : 1);
  }
  c.restore();
}

/** Brushed-metal micro striations along the plate's long axis. */
export function brushed(c, path, x, y, w, h, seed, amount) {
  if (amount <= 0) return;
  const rng = makeRng(hash(seed | 0, 7717, w | 0));
  c.save();
  c.clip(path);
  c.lineWidth = 1;
  const n = Math.round(h * 1.6 * amount);
  for (let i = 0; i < n; i++) {
    const py = y + rng() * h;
    const x0 = x + rng() * w * 0.5;
    const len = w * (0.18 + rng() * 0.6);
    const a = (0.010 + rng() * 0.030) * amount;
    c.strokeStyle = rng() < 0.5 ? `rgba(0,0,0,${a.toFixed(3)})` : `rgba(200,222,255,${a.toFixed(3)})`;
    c.beginPath();
    c.moveTo(x0, py + 0.5);
    c.lineTo(Math.min(x + w, x0 + len), py + 0.5);
    c.stroke();
  }
  c.restore();
}

/**
 * Inner edge lighting: a bright hairline riding the top of `path` and a dark one
 * under the bottom, produced by stroking an offset copy through a clip. This is
 * what makes a flat fill read as a bevelled machined plate.
 */
export function innerEdge(c, path, dx, dy, light, dark, width) {
  c.save();
  c.clip(path);
  c.lineJoin = 'round';
  c.lineWidth = width;
  c.save();
  c.translate(dx, dy);
  c.strokeStyle = light;
  c.stroke(path);
  c.restore();
  c.save();
  c.translate(-dx, -dy);
  c.strokeStyle = dark;
  c.stroke(path);
  c.restore();
  c.restore();
}

/** A soft diagonal gloss sweep, clipped to `path`. */
export function gloss(c, path, x, y, w, h, alpha, tilt) {
  c.save();
  c.clip(path);
  const g = c.createLinearGradient(x, y, x + w * (tilt || 0.35), y + h);
  g.addColorStop(0.00, `rgba(255,255,255,${(alpha * 0.0).toFixed(3)})`);
  g.addColorStop(0.28, `rgba(220,238,255,${(alpha * 1.0).toFixed(3)})`);
  g.addColorStop(0.46, `rgba(200,224,255,${(alpha * 0.22).toFixed(3)})`);
  g.addColorStop(1.00, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(x, y, w, h);
  c.restore();
}

/** Soft drop shadow behind `path`. Never pure black — a cold near-black. */
export function dropShadow(c, path, blur, dy, alpha) {
  c.save();
  c.shadowColor = `rgba(2,5,11,${alpha})`;
  c.shadowBlur = blur;
  c.shadowOffsetY = dy;
  c.fillStyle = 'rgba(0,0,0,0.98)';
  c.fill(path);
  c.restore();
}

export default { mkCanvas, rr, rrPath, poly, vgrad, hgrad, grain, brushed, innerEdge, gloss, dropShadow };
