// PIECE turf-field — procedural texture bakes.
//
// Everything is drawn with Canvas2D vector ops (thousands of tapered blade strokes,
// soft clump gradients, torn-soil clods) rather than per-pixel fBm loops: it is an
// order of magnitude faster to bake AND it produces real blade structure instead of
// noise mush. All tiling textures are drawn with wrapped duplicates so they tile
// seamlessly.
//
// Determinism: every random draw comes from makeRng(seed). No Math.random anywhere.

import * as THREE from 'three';
import { makeRng } from '../../foundation/rng.js';
import {
  DIGIT_W, NUM_TOP_Z, NUM_BOT_Z,
} from './field.js';

/* ------------------------------------------------------------------ colour */

function lerp(a, b, t) { return a + (b - a) * t; }
function mixHex(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return `rgb(${Math.round(lerp(ar, br, t))},${Math.round(lerp(ag, bg, t))},${Math.round(lerp(ab, bb, t))})`;
}
function hexToRgb(h) {
  let s = String(h).replace('#', '');
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbCss(c, a) { return a === undefined ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`; }
function shade(c, k) { return [Math.min(255, c[0] * k) | 0, Math.min(255, c[1] * k) | 0, Math.min(255, c[2] * k) | 0]; }

/** Perceived luminance, used to decide whether paint sits light-on-dark or the reverse. */
function lum(c) { return (c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114) / 255; }

/* ----------------------------------------------------------- grass palette */
// Deep, desaturated stadium rye under sodium/metal-halide light. Reference: the bar's
// field is olive-black in the roots, yellow-green at the lit tips — never a flat
// mid-green, and never saturated.
const ROOT = 0x0b1206;
const BLADE_DK = 0x1c2a10;
const BLADE_MD = 0x36471a;
const BLADE_LT = 0x5f7028;
const BLADE_HI = 0x8b8f3c;

/* ------------------------------------------------------- tiling primitives */

/** Call fn(dx,dy) for the wrapped copies a stamp of radius r at (x,y) needs. */
function wraps(x, y, r, N, fn) {
  fn(0, 0);
  const lx = x < r, hx = x > N - r, ly = y < r, hy = y > N - r;
  if (lx) fn(N, 0);
  if (hx) fn(-N, 0);
  if (ly) fn(0, N);
  if (hy) fn(0, -N);
  if (lx && ly) fn(N, N);
  if (lx && hy) fn(N, -N);
  if (hx && ly) fn(-N, N);
  if (hx && hy) fn(-N, -N);
}

/** One tapered blade: a 3-point sliver from base to tip. */
function blade(g, x, y, ang, len, w, fill) {
  const cx = Math.cos(ang), sy = Math.sin(ang);
  const px = -sy * w, py = cx * w;
  g.fillStyle = fill;
  g.beginPath();
  g.moveTo(x - px, y - py);
  g.lineTo(x + px, y + py);
  g.lineTo(x + cx * len + px * 0.12, y + sy * len + py * 0.12);
  g.closePath();
  g.fill();
}

/* --------------------------------------------------------- grass detail map */

/**
 * The tiling grass sheet. RGB = albedo with real blade structure, A = blade height
 * (used for the normal map and as the shell-grass mask).
 * Tiles at 1.21 m in world space, so at a 0.6 m camera height one texel is ~2 mm.
 */
export function bakeGrass(texlab, size, seed) {
  const N = size;
  const alb = texlab.canvas(N, N);
  const hgt = texlab.canvas(N, N);
  const g = alb.ctx, h = hgt.ctx;
  const rng = makeRng(seed);
  const s = N / 512;

  g.fillStyle = mixHex(ROOT, BLADE_DK, 0.35);
  g.fillRect(0, 0, N, N);
  h.fillStyle = '#000000';
  h.fillRect(0, 0, N, N);

  // 1. clumps — broad soft tufts that give the sheet its low-frequency structure
  const clumps = Math.round(150 * s * s) + 40;
  for (let i = 0; i < clumps; i++) {
    const x = rng() * N, y = rng() * N;
    const r = (18 + rng() * 54) * s;
    const k = rng();
    const col = k < 0.45 ? mixHex(ROOT, BLADE_DK, 0.15 + rng() * 0.3)
      : k < 0.85 ? mixHex(BLADE_DK, BLADE_MD, rng())
        : mixHex(BLADE_MD, BLADE_HI, 0.2 + rng() * 0.4);
    wraps(x, y, r, N, (dx, dy) => {
      const grd = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
      grd.addColorStop(0, col);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalAlpha = 0.55;
      g.fillStyle = grd;
      g.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
      const gh = h.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
      gh.addColorStop(0, k > 0.5 ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.30)');
      gh.addColorStop(1, 'rgba(0,0,0,0)');
      h.globalAlpha = 1;
      h.fillStyle = gh;
      h.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
    });
  }
  g.globalAlpha = 1;

  // 2. blades — two passes: a dark understorey, then bright tips catching the key
  const bladeCount = Math.round(11000 * s * s);
  for (let pass = 0; pass < 2; pass++) {
    const bright = pass === 1;
    const n = bright ? Math.round(bladeCount * 0.45) : bladeCount;
    for (let i = 0; i < n; i++) {
      const x = rng() * N, y = rng() * N;
      // blades lean, they do not stand: bias the angle band and vary per blade
      const ang = (rng() < 0.5 ? -1 : 1) * (0.9 + rng() * 1.35) + (rng() - 0.5) * 0.5;
      const len = (bright ? 7 + rng() * 15 : 6 + rng() * 20) * s;
      const w = (0.55 + rng() * 0.75) * s;
      const t = rng();
      const fill = bright
        ? mixHex(BLADE_LT, BLADE_HI, t * t)
        : mixHex(ROOT, BLADE_MD, 0.25 + t * 0.75);
      wraps(x, y, len + 3 * s, N, (dx, dy) => {
        blade(g, x + dx, y + dy, ang, len, w, fill);
        if (bright) {
          h.globalAlpha = 0.5;
          blade(h, x + dx, y + dy, ang, len, w, `rgba(255,255,255,${(0.35 + t * 0.65).toFixed(3)})`);
          h.globalAlpha = 1;
        }
      });
    }
  }

  // 3. fine dry speckle — the pale flecks of thatch that keep the sheet from reading synthetic
  const flecks = Math.round(2600 * s * s);
  for (let i = 0; i < flecks; i++) {
    const x = rng() * N, y = rng() * N;
    const r = (0.5 + rng() * 1.5) * s;
    g.fillStyle = rng() < 0.6
      ? `rgba(150,146,86,${(0.10 + rng() * 0.3).toFixed(3)})`
      : `rgba(10,14,6,${(0.15 + rng() * 0.35).toFixed(3)})`;
    g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill();
  }

  const albTex = texlab.toTexture(alb, { srgb: true, aniso: 16 });
  const nrmTex = texlab.heightToNormal(hgt, 2.6);
  nrmTex.wrapS = nrmTex.wrapT = THREE.RepeatWrapping;
  nrmTex.anisotropy = 16;
  // A copy of the height sheet as a single-channel-ish texture for the shells.
  const hgtTex = texlab.toTexture(hgt, { srgb: false, aniso: 8 });
  return { albedo: albTex, normal: nrmTex, height: hgtTex };
}

/* --------------------------------------------------------------- macro map */

/**
 * Low-frequency field variation, tiled at ~11.3 m so it never lines up with the
 * blade sheet. RGB = albedo multiplier around 0.5 (shader does *2), A = wear.
 */
export function bakeMacro(texlab, size, seed) {
  const N = size;
  const cv = texlab.canvas(N, N);
  const g = cv.ctx;
  const rng = makeRng(seed);
  const s = N / 256;
  g.fillStyle = 'rgb(128,128,128)';
  g.fillRect(0, 0, N, N);

  for (let i = 0; i < Math.round(120 * s * s) + 30; i++) {
    const x = rng() * N, y = rng() * N;
    const r = (14 + rng() * 60) * s;
    const k = rng();
    // patchiness: mow-shear lightness, damp dark patches, dry yellow patches
    const col = k < 0.42 ? [84, 94, 80] : k < 0.76 ? [166, 162, 138] : [172, 148, 92];
    wraps(x, y, r, N, (dx, dy) => {
      const grd = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
      grd.addColorStop(0, rgbCss(col, 0.55));
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
    });
  }
  // wear streaks along the field (players run the same lanes all night)
  for (let i = 0; i < Math.round(46 * s); i++) {
    const y = rng() * N;
    const wgt = (2 + rng() * 9) * s;
    g.globalAlpha = 0.09 + rng() * 0.12;
    g.strokeStyle = 'rgb(168,160,124)';
    g.lineWidth = wgt;
    g.beginPath();
    g.moveTo(-10, y);
    g.bezierCurveTo(N * 0.3, y + (rng() - 0.5) * 30 * s, N * 0.7, y + (rng() - 0.5) * 30 * s, N + 10, y);
    g.stroke();
  }
  g.globalAlpha = 1;
  return texlab.toTexture(cv, { srgb: false, aniso: 8 });
}

/* ---------------------------------------------------------------- soil map */

/** Torn-turf substrate: wet dark loam, clods, sand and severed blade litter. */
export function bakeSoil(texlab, size, seed) {
  const N = size;
  const cv = texlab.canvas(N, N);
  const g = cv.ctx;
  const rng = makeRng(seed);
  const s = N / 256;
  g.fillStyle = '#332a20';
  g.fillRect(0, 0, N, N);
  for (let i = 0; i < Math.round(420 * s * s); i++) {
    const x = rng() * N, y = rng() * N;
    const r = (2 + rng() * 13) * s;
    const k = rng();
    const col = k < 0.45 ? [40, 33, 25] : k < 0.80 ? [84, 70, 53] : [124, 108, 84];
    wraps(x, y, r, N, (dx, dy) => {
      const grd = g.createRadialGradient(x + dx - r * 0.3, y + dy - r * 0.3, 0, x + dx, y + dy, r);
      grd.addColorStop(0, rgbCss(col, 0.95));
      grd.addColorStop(1, rgbCss(shade(col, 0.4), 0));
      g.fillStyle = grd;
      g.beginPath(); g.arc(x + dx, y + dy, r, 0, 6.2832); g.fill();
    });
  }
  // severed blades lying in the dirt
  for (let i = 0; i < Math.round(300 * s * s); i++) {
    const x = rng() * N, y = rng() * N;
    const ang = rng() * 6.2832;
    const len = (3 + rng() * 12) * s;
    wraps(x, y, len, N, (dx, dy) => {
      blade(g, x + dx, y + dy, ang, len, 0.7 * s, mixHex(BLADE_DK, BLADE_HI, rng()));
    });
  }
  return texlab.toTexture(cv, { srgb: true, aniso: 8 });
}

/* --------------------------------------------------------- numeral atlas */

/**
 * 4 x 3 cells of digits 0-9, drawn to the real NFL numeral box (4 ft x 6 ft, so a
 * 0.667 cell aspect). Painted, not printed: chipped edges and a scuffed interior.
 * Cell (col,row) = (i%4, floor(i/4)), UV origin top-left (texture is flipY:false).
 */
export function bakeNumerals(texlab, faces, w, h, seed) {
  const cv = texlab.canvas(w, h);
  const g = cv.ctx;
  const cw = w / 4, ch = h / 3;
  const rng = makeRng(seed);
  g.clearRect(0, 0, w, h);

  for (let i = 0; i < 10; i++) {
    const col = i % 4, row = (i / 4) | 0;
    const x0 = col * cw, y0 = row * ch;
    g.save();
    g.beginPath();
    g.rect(x0, y0, cw, ch);
    g.clip();
    // The numeral box is DIGIT_W x NUM_H; fill the cell exactly.
    const size = ch * 0.98;
    g.translate(x0 + cw * 0.5, y0 + ch * 0.5);
    // Condense to the 4ft:6ft proportion of a real yard numeral.
    g.scale(0.82, 1.0);
    g.fillStyle = '#ffffff';
    let drew = false;
    try {
      const r = faces.draw(g, String(i), 0, 0, {
        face: 'blitz-block', size, align: 'center', baseline: 'middle', fill: '#ffffff',
      });
      drew = !!r;
    } catch (e) { drew = false; }
    if (!drew) {
      g.font = `900 ${Math.round(size)}px "Liberation Sans","DejaVu Sans",Arial,sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(i), 0, 0);
    }
    // paint wear: chip the edges and scuff the interior
    g.globalCompositeOperation = 'destination-out';
    for (let k = 0; k < 90; k++) {
      const px = (rng() - 0.5) * cw * 1.1, py = (rng() - 0.5) * ch * 1.05;
      const r = (rng() * 0.035 + 0.004) * ch;
      g.globalAlpha = 0.25 + rng() * 0.55;
      g.beginPath(); g.arc(px, py, r, 0, 6.2832); g.fill();
    }
    for (let k = 0; k < 8; k++) {
      const py = (rng() - 0.5) * ch;
      g.globalAlpha = 0.18 + rng() * 0.3;
      g.lineWidth = (0.006 + rng() * 0.016) * ch;
      g.strokeStyle = '#000';
      g.beginPath();
      g.moveTo(-cw, py);
      g.lineTo(cw, py + (rng() - 0.5) * ch * 0.1);
      g.stroke();
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.restore();
  }
  const tex = texlab.toTexture(cv, { srgb: false, wrap: THREE.ClampToEdgeWrapping, aniso: 8, flipY: false });
  return tex;
}

/* -------------------------------------------------- endzone wordmark + crest */

/**
 * Endzone lettering. White tackle-twill-style caps with a heavy team-colour outline,
 * painted onto the endzone and then worn. Reads top-of-letters toward the end line.
 */
export function bakeWordmark(texlab, faces, team, w, h, seed) {
  const cv = texlab.canvas(w, h);
  const g = cv.ctx;
  const rng = makeRng(seed);
  g.clearRect(0, 0, w, h);
  const text = String(team.nick || team.name || 'HOME').toUpperCase();
  const prim = hexToRgb(team.colors[0] || '#0b1020');
  const sec = hexToRgb(team.colors[1] || '#c8ccd0');
  // Endzone paint is the team's primary; the lettering must be the value that
  // survives on it. Light primary -> dark letters, dark primary -> white letters.
  const dark = lum(prim) > 0.42;
  const fill = dark ? shade(prim, 0.22) : [238, 240, 236];
  const edge = dark ? [238, 240, 236] : sec;

  const size = h * 0.78;
  g.save();
  g.translate(w * 0.5, h * 0.54);
  // squeeze the word to the plate
  let mw = 0;
  try { mw = faces.measure(text, 'blitz-block', size, { tracking: 0.02 }).w; } catch (e) { mw = 0; }
  if (!mw) {
    g.font = `900 ${Math.round(size)}px "Liberation Sans","DejaVu Sans",Arial,sans-serif`;
    mw = g.measureText(text).width;
  }
  const sx = Math.min(1.0, (w * 0.92) / Math.max(1, mw));
  g.scale(sx, 1);
  let drew = false;
  try {
    faces.draw(g, text, 0, 0, {
      face: 'blitz-block', size, align: 'center', baseline: 'middle',
      fill: rgbCss(fill), stroke: rgbCss(edge), strokeWidth: size * 0.048, tracking: 0.02,
    });
    drew = true;
  } catch (e) { drew = false; }
  if (!drew) {
    g.font = `900 ${Math.round(size)}px "Liberation Sans","DejaVu Sans",Arial,sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = size * 0.048; g.lineJoin = 'round';
    g.strokeStyle = rgbCss(edge); g.strokeText(text, 0, 0);
    g.fillStyle = rgbCss(fill); g.fillText(text, 0, 0);
  }
  g.restore();

  // wear
  g.globalCompositeOperation = 'destination-out';
  for (let k = 0; k < 900; k++) {
    const px = rng() * w, py = rng() * h;
    const r = rng() * h * 0.014 + 0.6;
    g.globalAlpha = 0.12 + rng() * 0.32;
    g.beginPath(); g.arc(px, py, r, 0, 6.2832); g.fill();
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  return texlab.toTexture(cv, { srgb: true, wrap: THREE.ClampToEdgeWrapping, aniso: 8, flipY: false });
}

/**
 * Midfield mark: a painted club monogram inside a broken ring, in club colours.
 * Deliberately low-contrast and worn — in the bar the midfield logo is a ghost, not a
 * decal, and a crisp logo at midfield is an instant tell that the field is a texture.
 */
export function bakeCrest(texlab, faces, team, size, seed) {
  const cv = texlab.canvas(size, size);
  const g = cv.ctx;
  const rng = makeRng(seed);
  const S = size;
  g.clearRect(0, 0, S, S);
  const prim = hexToRgb(team.colors[0] || '#10203a');
  const sec = hexToRgb(team.colors[1] || '#c8ccd0');
  const acc = hexToRgb(team.colors[2] || team.colors[1] || '#c8ccd0');

  g.save();
  g.translate(S * 0.5, S * 0.5);

  // outer ring
  g.lineWidth = S * 0.045;
  g.strokeStyle = rgbCss(sec, 0.92);
  g.beginPath(); g.arc(0, 0, S * 0.44, 0, 6.2832); g.stroke();
  g.lineWidth = S * 0.018;
  g.strokeStyle = rgbCss(acc, 0.8);
  g.beginPath(); g.arc(0, 0, S * 0.385, 0, 6.2832); g.stroke();

  // filled disc in the primary
  g.fillStyle = rgbCss(prim, 0.86);
  g.beginPath(); g.arc(0, 0, S * 0.365, 0, 6.2832); g.fill();

  // monogram
  const text = String(team.abbr || 'NFL').toUpperCase();
  const fsize = S * (text.length > 2 ? 0.32 : 0.42);
  const fill = lum(prim) > 0.42 ? shade(prim, 0.25) : [240, 242, 238];
  let drew = false;
  try {
    faces.draw(g, text, 0, 0, {
      face: 'blitz-block', size: fsize, align: 'center', baseline: 'middle',
      fill: rgbCss(fill), stroke: rgbCss(sec, 0.9), strokeWidth: fsize * 0.07,
    });
    drew = true;
  } catch (e) { drew = false; }
  if (!drew) {
    g.font = `900 ${Math.round(fsize)}px "Liberation Sans","DejaVu Sans",Arial,sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = fsize * 0.07; g.strokeStyle = rgbCss(sec, 0.9); g.strokeText(text, 0, 0);
    g.fillStyle = rgbCss(fill); g.fillText(text, 0, 0);
  }
  g.restore();

  // heavy wear — this thing has been played on for three quarters
  g.globalCompositeOperation = 'destination-out';
  for (let k = 0; k < 900; k++) {
    const px = rng() * S, py = rng() * S;
    const r = rng() * S * 0.03 + 1;
    g.globalAlpha = 0.2 + rng() * 0.55;
    g.beginPath(); g.arc(px, py, r, 0, 6.2832); g.fill();
  }
  for (let k = 0; k < 26; k++) {
    g.globalAlpha = 0.25 + rng() * 0.4;
    g.lineWidth = 1 + rng() * S * 0.02;
    g.strokeStyle = '#000';
    const y = rng() * S;
    g.beginPath(); g.moveTo(0, y); g.lineTo(S, y + (rng() - 0.5) * S * 0.1); g.stroke();
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  return texlab.toTexture(cv, { srgb: true, wrap: THREE.ClampToEdgeWrapping, aniso: 8, flipY: false });
}

export const NUM_BOX = { w: DIGIT_W, top: NUM_TOP_Z, bot: NUM_BOT_Z };

export default { bakeGrass, bakeMacro, bakeSoil, bakeNumerals, bakeWordmark, bakeCrest };
