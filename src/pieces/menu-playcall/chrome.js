// PIECE menu-playcall — Canvas2D primitives. Everything here runs at BAKE time.
//
// Deterministic: seeded rng only. No Math.random, no clocks — the screen is baked once
// per (side, page) and blitted, so even the grain has to come out the same on two runs
// or the capture is not reproducible.

import { makeRng, hash } from '../../foundation/rng.js';

export function mkCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

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

/**
 * Fine tooth. A Canvas2D plate with a mathematically flat fill is one of the instant
 * "this is a vector mock" tells; the bar's own card interiors read 5..7 rather than a
 * single value. ~1 px specks, both signs, clipped to the path.
 *
 * IT IS A TILED PATTERN, AND THAT CAME OUT OF A MEASUREMENT. The first version laid
 * the specks down one fillRect at a time over whatever it was given. At this screen's
 * size that is 1920*1080*0.0275 = 57,000 rects for the backdrop plus ~3,200 per card,
 * every one of them building an `rgba(...)` string first — and the whole-sheet bake
 * measured 359 ms cold and 160 ms on a page flip, which is a visible hitch on a button
 * press. The specks are now rasterised ONCE into a 256x256 tile and repeated, so a
 * plate of any size costs one fillRect. Same look (the tile is seeded, the repeat is
 * invisible at these alphas), two orders of magnitude less work. Measured in-page,
 * before -> after, on this box while five captures were competing for the same four
 * cores (so both columns are upper bounds):
 *
 *   cold bake, defensive sheet   359 ms -> 143 ms
 *   cold bake, offence page 1    232 ms ->  60 ms
 *   page flip (full re-bake)     160 ms ->  51 ms
 *   selection move (one card)   17.5 ms -> 1.7 ms
 *   steady frame (2 blits)      0.11 ms -> 0.06 ms
 */
const TILE = 256;
const tiles = new Map();
function grainTile(amount) {
  const key = Math.round(amount * 20);
  const hit = tiles.get(key);
  if (hit) return hit;
  const cv = mkCanvas(TILE, TILE);
  const c = cv.getContext('2d');
  const rng = makeRng(hash(0x9e37, key, TILE));
  const n = Math.round(TILE * TILE * 0.055 * amount);
  for (let i = 0; i < n; i++) {
    const a = (0.010 + rng() * 0.048) * amount;
    c.fillStyle = rng() < 0.55 ? `rgba(0,0,0,${a.toFixed(3)})` : `rgba(176,196,255,${a.toFixed(3)})`;
    c.fillRect(rng() * TILE, rng() * TILE, 1, rng() < 0.22 ? 2 : 1);
  }
  tiles.set(key, cv);
  return cv;
}

export function grain(c, path, x, y, w, h, seed, amount) {
  if (amount <= 0) return;
  const tile = grainTile(amount);
  const pat = c.createPattern(tile, 'repeat');
  if (!pat) return;
  c.save();
  c.clip(path);
  // Offset the tile per caller so nine cards do not all show the same speck field.
  const ox = (seed | 0) % TILE, oy = ((seed | 0) * 7) % TILE;
  c.translate(-ox, -oy);
  c.fillStyle = pat;
  c.fillRect(x + ox - TILE, y + oy - TILE, w + TILE * 2, h + TILE * 2);
  c.restore();
}

/** Bright hairline riding the top of `path`, dark one under the bottom. */
export function innerEdge(c, path, dx, dy, light, dark, width) {
  c.save();
  c.clip(path);
  c.lineJoin = 'round';
  c.lineWidth = width;
  c.save(); c.translate(dx, dy); c.strokeStyle = light; c.stroke(path); c.restore();
  c.save(); c.translate(-dx, -dy); c.strokeStyle = dark; c.stroke(path); c.restore();
  c.restore();
}

/**
 * Arrowhead at (x,y) pointing along (dx,dy). Filled triangle with a slight tail notch
 * so it reads as a head and not as a lozenge at small sizes.
 */
export function arrowHead(c, x, y, dx, dy, size, fill) {
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L;
  const px = -uy, py = ux;
  c.beginPath();
  c.moveTo(x, y);
  c.lineTo(x - ux * size + px * size * 0.52, y - uy * size + py * size * 0.52);
  c.lineTo(x - ux * size * 0.66, y - uy * size * 0.66);
  c.lineTo(x - ux * size - px * size * 0.52, y - uy * size - py * size * 0.52);
  c.closePath();
  c.fillStyle = fill;
  c.fill();
}

/**
 * Polyline with rounded corners, as a Path2D. The route data is a 3-point waypoint
 * chain; drawn as raw corners it looks like a bent wire, and drawn as a spline through
 * the points it stops agreeing with the data. Rounding each interior corner by a
 * radius capped at a third of the shorter adjacent segment keeps every waypoint on the
 * path to within that radius while making the break read as a cut.
 */
export function roundedPolyPath(pts, radius) {
  const p = new Path2D();
  if (pts.length < 2) return p;
  p.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], cpt = pts[i + 1];
    const v0x = a[0] - b[0], v0y = a[1] - b[1];
    const v1x = cpt[0] - b[0], v1y = cpt[1] - b[1];
    const l0 = Math.hypot(v0x, v0y) || 1, l1 = Math.hypot(v1x, v1y) || 1;
    const r = Math.min(radius, l0 / 3, l1 / 3);
    p.lineTo(b[0] + (v0x / l0) * r, b[1] + (v0y / l0) * r);
    p.quadraticCurveTo(b[0], b[1], b[0] + (v1x / l1) * r, b[1] + (v1y / l1) * r);
  }
  p.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
  return p;
}

/**
 * Resample a polyline at a fixed arc-length spacing. Returns [x,y,dirx,diry] samples.
 *
 * The first version of this walked each segment from its own origin, which would put
 * an extra sample right on top of every corner (two beads a pixel apart at every route
 * break). Caught by reading it back while writing it, not by a render — recorded
 * anyway, because uniform bead spacing is what makes a route read as steps. It now
 * tracks ONE global distance cursor across the whole chain, so the spacing is uniform
 * through the corners as well.
 */
export function walk(pts, spacing, skipStart, skipEnd) {
  const out = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  const from = skipStart || 0;
  const to = total - (skipEnd || 0);
  let next = from;
  let acc = 0;
  for (let i = 1; i < pts.length && next <= to; i++) {
    const ax = pts[i - 1][0], ay = pts[i - 1][1];
    const bx = pts[i][0], by = pts[i][1];
    const seg = Math.hypot(bx - ax, by - ay);
    if (seg < 1e-6) continue;
    const ux = (bx - ax) / seg, uy = (by - ay) / seg;
    while (next <= acc + seg && next <= to) {
      const d = next - acc;
      out.push([ax + ux * d, ay + uy * d, ux, uy]);
      next += spacing;
    }
    acc += seg;
  }
  return out;
}

export default { mkCanvas, rr, rrPath, vgrad, hgrad, grain, innerEdge, arrowHead, roundedPolyPath, walk };
