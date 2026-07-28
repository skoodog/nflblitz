// PIECE menu-title — the chrome BLITZ wordmark.
//
// The single biggest tell in the whole panel is whether BLITZ reads as chromed
// metal or as flat grey text, so this is built as a lit object rather than as
// a fill:
//
//   1. a real EXTRUSION — 22 stacked offset copies of the outline, ramping from
//      warm near-black to black, so the letters have a side wall;
//   2. a real CHAMFER — every contour is mitre-offset inward and the ring
//      between the two contours is filled edge by edge, each facet shaded from
//      its own outward normal against a key light, a cool sky bounce, a strong
//      RED bounce from the neon chevron below and two specular lobes. That is
//      why the bottom edges go red and the top edges go white, exactly as they
//      do in the art;
//   3. a measured HORIZON GRADIENT — the value ramp is sampled straight off
//      bar/panel-title.png down the stem of the L: bright rim, hard dark band at
//      18-26% of the cap, then a broad bright field falling away to a warm
//      bottom. A linear light-to-dark gradient is the cheap-looking tell; this
//      is not that;
//   4. specular SPARKLES at three fixed points, and a sheen band that sweeps.

import {
  clamp, lerp, rgbCss, rampAt, stopsInto, contoursPath,
  offsetPoly, edgeNormal, facetShade, mkCanvas,
} from './geom.js';
import { WORD, layout, glyphContours } from './glyphs.js';

/** Chrome value ramp, u = 0 at the cap line, 1 at the baseline. */
export const CHROME_STOPS = [
  [0.000, '#7d818e'], [0.028, '#c3c8d3'], [0.060, '#e2e7ef'], [0.100, '#f1f4f9'],
  [0.140, '#f8fafd'], [0.162, '#eef2f8'], [0.182, '#3a3648'], [0.204, '#161327'],
  [0.244, '#100e1e'], [0.270, '#1c1930'], [0.292, '#514d63'], [0.310, '#a29fae'],
  [0.326, '#dcdde1'], [0.350, '#ececeb'], [0.450, '#f1f0ee'], [0.560, '#ebeae7'],
  [0.660, '#e2dfdb'], [0.760, '#d8d4cf'], [0.860, '#cdc8c2'], [0.940, '#c7c1ba'],
  [0.978, '#bcb0a7'], [1.000, '#8a5f52'],
];

/**
 * Geometry of the wordmark at a given size. Returned so the sheen pass and the
 * hit test can reuse the exact same outlines without rebuilding them.
 */
export function buildWordmark(cx, baseline, cap, width) {
  const L = layout(cap, width);
  const x0 = cx - width / 2;
  const glyphs = [];
  for (let i = 0; i < WORD.length; i++) {
    const it = L.items[i];
    glyphs.push({
      ch: it.ch,
      contours: glyphContours(it.ch, x0 + it.x, baseline, L.sx, L.sy, it.rise),
      top: baseline - cap * it.rise,
      cap: cap * it.rise,
      x: x0 + it.x,
      w: it.w,
    });
  }
  return { glyphs, x0, width, baseline, cap };
}

/** One Path2D over every contour of every glyph — used for clipping. */
export function wordmarkPath(wm) {
  const all = [];
  for (const g of wm.glyphs) for (const c of g.contours) all.push(c);
  return contoursPath(all);
}

/* ------------------------------------------------------------------ passes */

function extrude(c, wm, steps, dx, dy) {
  for (let s = steps; s >= 1; s--) {
    const k = s / steps;
    const r = lerp(13, 30, 1 - k), g = lerp(5, 8, 1 - k), b = lerp(9, 12, 1 - k);
    c.fillStyle = rgbCss(r * (1 - k * 0.55), g * (1 - k * 0.55), b * (1 - k * 0.55));
    c.save();
    c.translate(dx * s, dy * s);
    c.beginPath();
    for (const gl of wm.glyphs) for (const ct of gl.contours) {
      c.moveTo(ct[0][0], ct[0][1]);
      for (let i = 1; i < ct.length; i++) c.lineTo(ct[i][0], ct[i][1]);
      c.closePath();
    }
    c.fill('evenodd');
    c.restore();
  }
}

function faceFill(c, gl) {
  const g = c.createLinearGradient(0, gl.top, 0, gl.top + gl.cap);
  stopsInto(g, CHROME_STOPS);
  c.fillStyle = g;
  c.beginPath();
  for (const ct of gl.contours) {
    c.moveTo(ct[0][0], ct[0][1]);
    for (let i = 1; i < ct.length; i++) c.lineTo(ct[i][0], ct[i][1]);
    c.closePath();
  }
  c.fill('evenodd');
}

/**
 * The chamfer ring: one shaded quad per edge, per contour.
 *
 * Each facet is filled with a gradient ACROSS its width — the outer lip shaded
 * at a steeper tilt than the inner edge, which is blended back toward the face
 * value it abuts. A flat fill per facet is what makes bevelled type read as
 * faceted plastic; the cross-gradient is what makes it read as a rolled metal
 * edge catching a moving highlight.
 */
function bevelRing(c, gl, bw) {
  for (const ct of gl.contours) {
    const inner = offsetPoly(ct, -bw);
    const n = ct.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = ct[i], b = ct[j], bi = inner[j], ai = inner[i];
      const nrm = edgeNormal(ct, i);
      const my = (a[1] + b[1] + ai[1] + bi[1]) * 0.25;
      const u = clamp((my - gl.top) / gl.cap, 0, 1);
      const base = rampAt(CHROME_STOPS, u);
      const red = 0.22 + 0.50 * u;
      const lip = facetShade(nrm[0], nrm[1], base, 0.92, { red });
      const mid = facetShade(nrm[0], nrm[1], base, 0.70 + 0.14 * Math.abs(nrm[1]), { red });
      // gradient runs along the edge normal, outer lip -> inner face
      const ox = (a[0] + b[0]) * 0.5, oy = (a[1] + b[1]) * 0.5;
      const g = c.createLinearGradient(ox, oy, ox - nrm[0] * bw, oy - nrm[1] * bw);
      g.addColorStop(0, rgbCss(lip[0], lip[1], lip[2]));
      g.addColorStop(0.42, rgbCss(mid[0], mid[1], mid[2]));
      g.addColorStop(1, rgbCss(
        mid[0] * 0.45 + base[0] * 0.55, mid[1] * 0.45 + base[1] * 0.55, mid[2] * 0.45 + base[2] * 0.55,
      ));
      c.fillStyle = g;
      c.strokeStyle = rgbCss(mid[0], mid[1], mid[2]);
      c.lineWidth = 0.9;
      c.beginPath();
      c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.lineTo(bi[0], bi[1]); c.lineTo(ai[0], ai[1]);
      c.closePath();
      c.fill();
      c.stroke();
    }
  }
}

/**
 * The environment the metal is standing in. A vertical ramp alone is an
 * airbrush; chrome picks up the room. Three cheap terms, clipped to the glyph:
 * a broad specular hotspot up and left, one soft diagonal sweep, and a warm
 * dark band low down where the city sits in the reflection.
 */
function envPass(c, gl, wm) {
  c.save();
  c.beginPath();
  for (const ct of gl.contours) {
    c.moveTo(ct[0][0], ct[0][1]);
    for (let i = 1; i < ct.length; i++) c.lineTo(ct[i][0], ct[i][1]);
    c.closePath();
  }
  c.clip('evenodd');

  const top = gl.top, cap = gl.cap;
  // warm dark reflection band, low
  const band = c.createLinearGradient(0, top + cap * 0.70, 0, top + cap * 0.93);
  band.addColorStop(0, 'rgba(58,40,44,0)');
  band.addColorStop(0.5, 'rgba(60,42,44,0.20)');
  band.addColorStop(1, 'rgba(70,52,50,0)');
  c.fillStyle = band;
  c.fillRect(gl.x - cap, top, gl.w + cap * 2, cap * 1.1);

  c.globalCompositeOperation = 'lighter';
  // broad hotspot, referenced to the whole wordmark so the highlight travels
  // across the word instead of repeating identically in every letter
  const hx = wm.x0 + wm.width * 0.34, hy = top + cap * 0.46;
  const hot = c.createRadialGradient(hx, hy, 0, hx, hy, wm.width * 0.42);
  hot.addColorStop(0, 'rgba(255,255,255,0.14)');
  hot.addColorStop(0.45, 'rgba(226,236,255,0.05)');
  hot.addColorStop(1, 'rgba(200,220,255,0)');
  c.fillStyle = hot;
  c.fillRect(gl.x - cap, top, gl.w + cap * 2, cap * 1.1);

  // diagonal sweep
  c.save();
  c.translate(wm.x0 + wm.width * 0.62, top);
  c.transform(1, 0, -0.42, 1, 0, 0);
  const sw = c.createLinearGradient(-cap * 0.55, 0, cap * 0.55, 0);
  sw.addColorStop(0, 'rgba(255,255,255,0)');
  sw.addColorStop(0.5, 'rgba(255,252,246,0.11)');
  sw.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = sw;
  c.fillRect(-cap * 0.55, 0, cap * 1.1, cap * 1.05);
  c.restore();

  c.restore();
}

/** Warm neon bounce washed along the bottom of every letter. */
function redBounce(c, gl) {
  c.save();
  c.beginPath();
  for (const ct of gl.contours) {
    c.moveTo(ct[0][0], ct[0][1]);
    for (let i = 1; i < ct.length; i++) c.lineTo(ct[i][0], ct[i][1]);
    c.closePath();
  }
  c.clip('evenodd');
  c.globalCompositeOperation = 'lighter';
  const g = c.createLinearGradient(0, gl.top + gl.cap * 0.74, 0, gl.top + gl.cap * 1.02);
  g.addColorStop(0, 'rgba(255,60,26,0)');
  g.addColorStop(0.70, 'rgba(255,66,28,0.05)');
  g.addColorStop(1, 'rgba(255,104,44,0.22)');
  c.fillStyle = g;
  c.fillRect(gl.x - gl.w, gl.top, gl.w * 3, gl.cap * 1.1);
  c.restore();
}

/** A four-point star flare. */
export function sparkle(c, x, y, r, a, tint) {
  c.save();
  c.globalCompositeOperation = 'lighter';
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(255,255,255,${(a * 0.95).toFixed(3)})`);
  g.addColorStop(0.18, `rgba(${tint},${(a * 0.5).toFixed(3)})`);
  g.addColorStop(1, `rgba(${tint},0)`);
  c.fillStyle = g;
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  const ray = (ang, len, wid) => {
    c.save();
    c.translate(x, y); c.rotate(ang);
    const rg = c.createLinearGradient(0, 0, len, 0);
    rg.addColorStop(0, `rgba(255,255,255,${(a * 0.85).toFixed(3)})`);
    rg.addColorStop(0.35, `rgba(${tint},${(a * 0.3).toFixed(3)})`);
    rg.addColorStop(1, `rgba(${tint},0)`);
    c.fillStyle = rg;
    c.beginPath(); c.moveTo(0, -wid); c.lineTo(len, 0); c.lineTo(0, wid); c.closePath(); c.fill();
    c.restore();
  };
  for (let i = 0; i < 4; i++) {
    const ang = i * Math.PI * 0.5;
    const len = i % 2 ? r * 1.6 : r * 3.4;
    ray(ang, len, r * 0.13);
  }
  c.restore();
}

/* -------------------------------------------------------------------- draw */

/**
 * drawWordmark(c, wm, opts) — the full stack. Baked once; never per frame.
 */
export function drawWordmark(c, wm, opts = {}) {
  const cap = wm.cap;
  const bw = cap * 0.046;

  // contact shadow on the sky, well below the letters
  c.save();
  c.shadowColor = 'rgba(4,2,8,0.85)';
  c.shadowBlur = cap * 0.30;
  c.shadowOffsetY = cap * 0.16;
  c.fillStyle = 'rgba(6,3,10,0.9)';
  c.beginPath();
  for (const gl of wm.glyphs) for (const ct of gl.contours) {
    c.moveTo(ct[0][0], ct[0][1]);
    for (let i = 1; i < ct.length; i++) c.lineTo(ct[i][0], ct[i][1]);
    c.closePath();
  }
  c.fill('evenodd');
  c.restore();

  // neon spill picked up under the letters
  c.save();
  c.globalCompositeOperation = 'lighter';
  c.shadowColor = 'rgba(255,52,20,0.55)';
  c.shadowBlur = cap * 0.34;
  c.shadowOffsetY = cap * 0.10;
  c.fillStyle = 'rgba(120,16,8,0.55)';
  c.beginPath();
  for (const gl of wm.glyphs) for (const ct of gl.contours) {
    c.moveTo(ct[0][0], ct[0][1]);
    for (let i = 1; i < ct.length; i++) c.lineTo(ct[i][0], ct[i][1]);
    c.closePath();
  }
  c.fill('evenodd');
  c.restore();

  extrude(c, wm, 20, cap * 0.0013, cap * 0.0106);

  // dark keyline, then face, then chamfer, per glyph
  c.save();
  c.lineJoin = 'miter';
  c.miterLimit = 3;
  for (const gl of wm.glyphs) {
    c.strokeStyle = '#05040a';
    c.lineWidth = cap * 0.019;
    c.beginPath();
    for (const ct of gl.contours) {
      c.moveTo(ct[0][0], ct[0][1]);
      for (let i = 1; i < ct.length; i++) c.lineTo(ct[i][0], ct[i][1]);
      c.closePath();
    }
    c.stroke();
    faceFill(c, gl);
    envPass(c, gl, wm);
    bevelRing(c, gl, bw);
    redBounce(c, gl);
  }
  c.restore();

  // three fixed speculars — the blown highlight the art has on the T and the Z
  const S = opts.sparkles === false ? [] : [
    [0.632, 0.245, 1.00], [0.806, 0.055, 0.62], [0.148, 0.028, 0.44],
  ];
  for (const s of S) {
    sparkle(c, wm.x0 + wm.width * s[0], wm.baseline - cap * (1 - s[1]),
      cap * 0.105 * s[2], 0.78 * s[2], '206,222,255');
  }
}

/**
 * The sheen sweep. `u` is 0..1 across the wordmark plus overscan; drawn every
 * frame at runtime, so it clips to a cached Path2D and blits one baked band —
 * no gradient is constructed on the frame path.
 */
export function bakeSheenBand(w, h) {
  const o = mkCanvas(w, h);
  const g = o.ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0.00, 'rgba(255,255,255,0)');
  g.addColorStop(0.34, 'rgba(255,250,240,0.10)');
  g.addColorStop(0.47, 'rgba(255,255,255,0.62)');
  g.addColorStop(0.53, 'rgba(255,255,255,0.62)');
  g.addColorStop(0.66, 'rgba(230,240,255,0.10)');
  g.addColorStop(1.00, 'rgba(255,255,255,0)');
  o.ctx.fillStyle = g;
  o.ctx.fillRect(0, 0, w, h);
  return o.cv;
}

export default { buildWordmark, wordmarkPath, drawWordmark, bakeSheenBand, sparkle, CHROME_STOPS };
