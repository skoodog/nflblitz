// PIECE menu-title — polygon / colour / shading primitives.
//
// Everything the chrome wordmark needs that Canvas2D does not give you:
// a mitred polygon offset (so a glyph can have a real inset face and a real
// chamfer ring), per-edge outward normals, and a small lighting model that
// turns those normals into facet colours.
//
// CONTOUR WINDING CONVENTION, used everywhere in this piece:
//   outer contours are CLOCKWISE in screen space (y down)
//   counters (holes) are COUNTER-CLOCKWISE
// With that convention the right-hand normal (dy, -dx) is ALWAYS the facet's
// outward-facing normal — outward from the letter for an outer contour, into
// the hole for a counter — and offsetPoly(pts, -d) always moves into material.

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
}

/* ------------------------------------------------------------------ colour */

export function hexToRgb(h) {
  const s = h[0] === '#' ? h.slice(1) : h;
  const n = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbCss(r, g, b, a) {
  const R = Math.round(clamp(r, 0, 255)), G = Math.round(clamp(g, 0, 255)), B = Math.round(clamp(b, 0, 255));
  return a === undefined ? `rgb(${R},${G},${B})` : `rgba(${R},${G},${B},${clamp(a, 0, 1).toFixed(3)})`;
}
export function mixHex(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbCss(lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t));
}
/** hex + alpha -> rgba() css. */
export function alpha(hex, a) {
  const c = hexToRgb(hex);
  return rgbCss(c[0], c[1], c[2], a);
}

/** Multi-stop ramp sampler over hex stops [[t,'#hex'],...]; returns [r,g,b]. */
export function rampAt(stops, t) {
  const u = clamp(t, 0, 1);
  let i = 0;
  while (i < stops.length - 2 && u > stops[i + 1][0]) i++;
  const a = stops[i], b = stops[i + 1];
  const k = (u - a[0]) / ((b[0] - a[0]) || 1e-6);
  const A = hexToRgb(a[1]), B = hexToRgb(b[1]);
  return [lerp(A[0], B[0], k), lerp(A[1], B[1], k), lerp(A[2], B[2], k)];
}

/** Apply hex stops to a canvas gradient object. */
export function stopsInto(g, stops) {
  for (let i = 0; i < stops.length; i++) g.addColorStop(clamp(stops[i][0], 0, 1), stops[i][1]);
  return g;
}

/* ---------------------------------------------------------------- canvases */

/**
 * Offscreen canvas. texlab.canvas() asks for willReadFrequently, which is the
 * right hint for its per-pixel work and the wrong one for the layers here,
 * which are written with gradients and blitted. Same {cv,ctx,w,h} shape, so
 * texlab.fillPixels() still accepts it.
 */
export function mkCanvas(w, h) {
  const W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h));
  let cv;
  if (typeof OffscreenCanvas !== 'undefined') cv = new OffscreenCanvas(W, H);
  else { cv = document.createElement('canvas'); cv.width = W; cv.height = H; }
  return { cv, ctx: cv.getContext('2d'), w: W, h: H };
}

/* ----------------------------------------------------------------- polygon */

export function polyPath(c, pts, close = true) {
  c.beginPath();
  c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
  if (close) c.closePath();
}

/** Path2D for a set of contours (used for clipping and masks). */
export function contoursPath(contours) {
  const p = new Path2D();
  for (const pts of contours) {
    p.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]);
    p.closePath();
  }
  return p;
}

/**
 * Mitred polygon offset. d < 0 moves INTO the material (given the winding
 * convention above). Miters are clamped so a sharp spike cannot fly off.
 */
export function offsetPoly(pts, d) {
  const n = pts.length;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const p = pts[(i - 1 + n) % n], c = pts[i], q = pts[(i + 1) % n];
    let e1x = c[0] - p[0], e1y = c[1] - p[1];
    let e2x = q[0] - c[0], e2y = q[1] - c[1];
    const l1 = Math.hypot(e1x, e1y) || 1, l2 = Math.hypot(e2x, e2y) || 1;
    e1x /= l1; e1y /= l1; e2x /= l2; e2y /= l2;
    const n1x = e1y, n1y = -e1x;
    const n2x = e2y, n2y = -e2x;
    let bx = n1x + n2x, by = n1y + n2y;
    const bl = Math.hypot(bx, by);
    if (bl < 1e-5) { bx = n1x; by = n1y; } else { bx /= bl; by /= bl; }
    const cosHalf = bx * n1x + by * n1y;
    const scale = d / (Math.abs(cosHalf) < 0.28 ? 0.28 * Math.sign(cosHalf || 1) : cosHalf);
    out[i] = [c[0] + bx * scale, c[1] + by * scale];
  }
  return out;
}

/** Outward normal of edge i (pts[i] -> pts[i+1]). */
export function edgeNormal(pts, i) {
  const a = pts[i], b = pts[(i + 1) % pts.length];
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  return [dy / l, -dx / l];
}

/* ---------------------------------------------------------------- shading */

const L_KEY = norm3(-0.34, -0.86, 0.38);   // key: high, front, slightly left
const L_SKY = norm3(0.05, -1.0, 0.16);     // cool sky bounce from above
const L_RED = norm3(0.0, 0.94, 0.34);      // the neon chevron, from below
const L_RIM = norm3(0.92, 0.10, 0.38);     // cool rim off the right
const V = [0, 0, 1];
const H_KEY = norm3(L_KEY[0] + V[0], L_KEY[1] + V[1], L_KEY[2] + V[2]);
const H_RED = norm3(L_RED[0] + V[0], L_RED[1] + V[1], L_RED[2] + V[2]);

function norm3(x, y, z) { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; }

/**
 * Facet colour for a chamfer whose 2D outward normal is (nx,ny).
 *   base  [r,g,b] the chrome value the face would have at this height
 *   tilt  0..1, how far the chamfer leans away from the screen plane
 * Returns [r,g,b].
 */
export function facetShade(nx, ny, base, tilt = 0.82, opts = {}) {
  const s = tilt, cz = Math.sqrt(Math.max(0.0001, 1 - s * s));
  const N = norm3(nx * s, ny * s, cz);
  const dKey = Math.max(0, N[0] * L_KEY[0] + N[1] * L_KEY[1] + N[2] * L_KEY[2]);
  const dSky = Math.max(0, N[0] * L_SKY[0] + N[1] * L_SKY[1] + N[2] * L_SKY[2]);
  const dRed = Math.max(0, N[0] * L_RED[0] + N[1] * L_RED[1] + N[2] * L_RED[2]);
  const dRim = Math.max(0, N[0] * L_RIM[0] + N[1] * L_RIM[1] + N[2] * L_RIM[2]);
  const spK = Math.pow(Math.max(0, N[0] * H_KEY[0] + N[1] * H_KEY[1] + N[2] * H_KEY[2]), 44);
  const spR = Math.pow(Math.max(0, N[0] * H_RED[0] + N[1] * H_RED[1] + N[2] * H_RED[2]), 22);
  const red = opts.red || 1;
  const k = 0.20 + 0.74 * dKey;
  let r = base[0] * k, g = base[1] * k, b = base[2] * k;
  // cool sky bounce
  r += 26 * dSky * dSky; g += 32 * dSky * dSky; b += 44 * dSky * dSky;
  // neon bounce off the chevron, warm and strong on downward faces
  const rr = Math.pow(dRed, 2.0) * red;
  r += 150 * rr; g += 40 * rr; b += 24 * rr;
  // cool rim
  r += 34 * dRim * dRim; g += 38 * dRim * dRim; b += 48 * dRim * dRim;
  // speculars
  r += 255 * spK; g += 255 * spK; b += 255 * spK;
  r += 150 * spR * red; g += 70 * spR * red; b += 46 * spR * red;
  return [r, g, b];
}

export default {
  clamp, lerp, smoothstep, hexToRgb, rgbCss, mixHex, alpha, rampAt, stopsInto,
  polyPath, contoursPath, offsetPoly, edgeNormal, facetShade, mkCanvas,
};
