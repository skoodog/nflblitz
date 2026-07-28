// PIECE hud-overlay — the bottom-left TURBO meter.
//
// GEOMETRY off bar/panel-truck.png and bar/panel-qb_dropback.png: the plate is
// 86-88 panel px wide and 23-24 tall against a 310/338 px frame, i.e. ~300 x 80
// logical, hugging the bottom-left. The silhouette is NOT a rectangle: the left
// edge leans back, the top-right corner is chopped, and the fill bar runs out
// past it into a spur. That silhouette is the single most recognisable thing
// about this element, so it is built as a real polygon, not a rounded rect.
//
// COST: chrome, fill strip and leading-edge sprite are each baked once. The
// frame path is three drawImage calls with integer sub-rects — no allocation.

import {
  mkCanvas, poly, vgrad, hgrad, rgba, mix, lighten, darken, grain, brushed, innerEdge, gloss,
} from './chrome.js';

export const PLATE = { x: 48, y: 954, w: 306, h: 82 };
const MG = 26;

export const TRK = { x: 18, y: 47, w: 270, h: 24 };

const BLUE = '#2a5cf0';
const BLUE_HI = '#7ea6ff';
const BLUE_LO = '#0b1a55';

let chromeCv = null, fillCv = null, leadCv = null;
let quality = 1;
export function setQuality(q) { quality = q; }

function outlinePts(w, h) {
  return [
    [15, 0],
    [w - 24, 0],
    [w - 10, h * 0.38],
    [w - 1, h * 0.62],
    [w - 16, h],
    [0, h],
  ];
}

/** Offset a polygon inward by `d` along each vertex's angle bisector. */
function inset(pts, d) {
  const n = pts.length;
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p[0]; cy += p[1]; }
  cx /= n; cy /= n;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1];
    const vx = p2[0] - p1[0], vy = p2[1] - p1[1];
    const lu = Math.hypot(ux, uy) || 1, lv = Math.hypot(vx, vy) || 1;
    let n1x = -uy / lu, n1y = ux / lu;
    let n2x = -vy / lv, n2y = vx / lv;
    if (n1x * (cx - p1[0]) + n1y * (cy - p1[1]) < 0) { n1x = -n1x; n1y = -n1y; }
    if (n2x * (cx - p1[0]) + n2y * (cy - p1[1]) < 0) { n2x = -n2x; n2y = -n2y; }
    let bx = n1x + n2x, by = n1y + n2y;
    const lb = Math.hypot(bx, by) || 1;
    bx /= lb; by /= lb;
    const cosHalf = Math.max(0.35, bx * n1x + by * n1y);
    out.push([p1[0] + bx * (d / cosHalf), p1[1] + by * (d / cosHalf)]);
  }
  return out;
}

/* ------------------------------------------------------------ fill strip */

function bakeFill(W, H, s) {
  const w = TRK.w, h = TRK.h;
  if (!fillCv) fillCv = mkCanvas(Math.round(w * s), Math.round(h * s));
  if (fillCv.width !== Math.round(w * s)) { fillCv.width = Math.round(w * s); fillCv.height = Math.round(h * s); }
  const c = fillCv.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, fillCv.width, fillCv.height);
  c.setTransform(s, 0, 0, s, 0, 0);

  // clip to the plate's inner silhouette so the strip's right end takes the spur
  const innerLocal = inset(outlinePts(W, H), 6);
  c.save();
  const p = poly(innerLocal.map((q) => [q[0] - TRK.x, q[1] - TRK.y]), 4);
  c.clip(p);

  c.fillStyle = hgrad(c, 0, w, [
    [0.00, rgba(darken(BLUE, 0.42), 1)],
    [0.18, rgba(BLUE, 1)],
    [0.62, rgba(mix(BLUE, BLUE_HI, 0.32), 1)],
    [1.00, rgba(mix(BLUE, BLUE_HI, 0.60), 1)],
  ]);
  c.fillRect(0, 0, w, h);

  // glossy cylinder: dark top lip, hot specular band at 0.30, deep shadow at base
  c.fillStyle = vgrad(c, 0, h, [
    [0.00, 'rgba(6,14,44,0.72)'],
    [0.10, 'rgba(120,168,255,0.35)'],
    [0.26, 'rgba(238,246,255,0.86)'],
    [0.36, 'rgba(150,190,255,0.30)'],
    [0.55, 'rgba(24,54,150,0.10)'],
    [0.82, 'rgba(4,10,38,0.52)'],
    [1.00, 'rgba(2,6,26,0.80)'],
  ]);
  c.fillRect(0, 0, w, h);

  // segment dividers — four, thin, dark only. Six with a light side read as a
  // battery gauge; the bar's meter reads as one glowing bar that happens to be
  // notched.
  c.fillStyle = 'rgba(3,7,22,0.62)';
  const seg = 4;
  for (let i = 1; i < seg; i++) c.fillRect(Math.round((w * i) / seg) - 0.6, 0, 1.2, h);

  grain(c, poly([[0, 0], [w, 0], [w, h], [0, h]], 0), 0, 0, w, h, 0x7be1, 0.5 * quality);
  c.restore();
  return fillCv;
}

/** The white-hot leading edge that rides the fill boundary. */
function bakeLead(s) {
  const w = 30, h = TRK.h + 16;
  if (!leadCv) leadCv = mkCanvas(Math.round(w * s), Math.round(h * s));
  if (leadCv.width !== Math.round(w * s)) { leadCv.width = Math.round(w * s); leadCv.height = Math.round(h * s); }
  const c = leadCv.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, leadCv.width, leadCv.height);
  c.setTransform(s, 0, 0, s, 0, 0);
  const g = c.createRadialGradient(w * 0.5, h * 0.5, 0, w * 0.5, h * 0.5, w * 0.5);
  g.addColorStop(0.00, 'rgba(255,255,255,0.92)');
  g.addColorStop(0.22, 'rgba(196,224,255,0.60)');
  g.addColorStop(0.55, 'rgba(74,132,255,0.28)');
  g.addColorStop(1.00, 'rgba(40,90,240,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  c.fillStyle = 'rgba(255,255,255,0.95)';
  c.fillRect(w * 0.5 - 1.4, 8, 2.8, h - 16);
  c.fillStyle = 'rgba(226,240,255,0.55)';
  c.fillRect(w * 0.5 - 3.4, 8, 2, h - 16);
  return leadCv;
}

/* ---------------------------------------------------------------- chrome */

function bakeChrome(ui, s) {
  const W = PLATE.w, H = PLATE.h;
  const CW = Math.round(BOX.w * s), CH = Math.round(BOX.h * s);
  if (!chromeCv) chromeCv = mkCanvas(CW, CH);
  if (chromeCv.width !== CW) { chromeCv.width = CW; chromeCv.height = CH; }
  const c = chromeCv.getContext('2d');
  const F = ui.faces;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, CW, CH);
  c.setTransform(s, 0, 0, s, 0, 0);
  c.translate(MG, MG);
  c.lineJoin = 'round';
  c.miterLimit = 2;

  const pts = outlinePts(W, H);
  const outer = poly(pts, 7);

  // drop shadow ring, plus the blue spill the panel throws onto the turf
  c.save();
  c.shadowColor = 'rgba(2,5,14,0.80)';
  c.shadowBlur = 20;
  c.shadowOffsetY = 7;
  c.fillStyle = 'rgba(0,0,0,0.99)';
  c.fill(outer);
  c.restore();
  c.save();
  c.globalCompositeOperation = 'lighter';
  c.shadowColor = 'rgba(46,104,255,0.62)';
  c.shadowBlur = 22;
  c.shadowOffsetY = 4;
  c.fillStyle = 'rgba(30,70,200,0.85)';
  c.fill(outer);
  c.restore();
  c.save();
  c.globalCompositeOperation = 'destination-out';
  c.fill(outer);
  c.restore();

  // blue anodised frame
  c.fillStyle = vgrad(c, 0, H, [
    [0.00, rgba(lighten(BLUE, 0.55), 1)],
    [0.14, rgba(mix(BLUE, BLUE_HI, 0.30), 1)],
    [0.42, rgba(BLUE, 1)],
    [0.72, rgba(mix(BLUE, BLUE_LO, 0.55), 1)],
    [1.00, rgba(BLUE_LO, 1)],
  ]);
  c.fill(outer);
  brushed(c, outer, 0, 0, W, H, 0x3ad2, 0.9 * quality);
  innerEdge(c, outer, 0, 1.7, 'rgba(214,234,255,0.72)', 'rgba(0,0,0,0.55)', 2.0);
  c.strokeStyle = 'rgba(12,26,74,0.85)';
  c.lineWidth = 1.2;
  c.stroke(outer);

  // inner well — near-black gloss
  const innerPts = inset(pts, 6);
  const inner = poly(innerPts, 4);
  c.fillStyle = vgrad(c, 0, H, [
    [0.00, 'rgba(26,36,62,0.97)'],
    [0.16, 'rgba(13,18,32,0.97)'],
    [0.55, 'rgba(6,9,17,0.96)'],
    [1.00, 'rgba(3,5,11,0.97)'],
  ]);
  c.fill(inner);
  grain(c, inner, 0, 0, W, H, 0x11c4, 0.7 * quality);
  gloss(c, inner, 0, 0, W, H * 0.55, 0.06, 0.45);
  innerEdge(c, inner, 0, 1.2, 'rgba(0,0,0,0.75)', 'rgba(140,180,255,0.22)', 1.6);

  // empty track well, under where the fill will land
  c.save();
  c.clip(inner);
  c.fillStyle = vgrad(c, TRK.y, TRK.y + TRK.h, [
    [0.00, 'rgba(1,2,6,0.98)'],
    [0.42, 'rgba(6,10,20,0.96)'],
    [1.00, 'rgba(16,24,44,0.92)'],
  ]);
  c.fillRect(TRK.x, TRK.y, TRK.w, TRK.h);
  c.strokeStyle = 'rgba(0,0,0,0.85)';
  c.lineWidth = 1.4;
  c.strokeRect(TRK.x + 0.7, TRK.y + 0.7, TRK.w - 1.4, TRK.h - 1.4);
  c.fillStyle = 'rgba(60,96,190,0.14)';
  const seg = 4;
  for (let i = 1; i < seg; i++) c.fillRect(TRK.x + Math.round((TRK.w * i) / seg) - 0.5, TRK.y + 2, 1, TRK.h - 4);
  c.restore();

  // TURBO — blitz-techno, scaled to the plate's measured 0.60 width ratio
  const TRACK = 0.018;                 // the face defaults to 0.10 — far looser
  let size = 47;                       // than the bar's tight, chunky lockup
  try {
    const m = F.measure('TURBO', 'blitz-techno', 100, { tracking: TRACK });
    if (m && m.w > 0) size = Math.min(56, (W * 0.625) / (m.w / 100));
  } catch (e) { /* keep the default */ }
  F.draw(c, 'TURBO', 34, 39.5, {
    face: 'blitz-techno',
    size,
    tracking: TRACK,
    gradient: [
      [0.00, '#ffffff'],
      [0.30, '#f2f7ff'],
      [0.56, '#c4d4ec'],
      [0.74, '#e8f1ff'],
      [1.00, '#93a6c4'],
    ],
    outline: 'rgba(4,9,24,0.92)',
    outlineWidth: size * 0.075,
    shadow: { color: 'rgba(0,4,14,0.8)', blur: size * 0.22, dy: size * 0.06 },
    glow: { color: 'rgba(120,170,255,0.35)', blur: size * 0.55, alpha: 0.5, reps: 1 },
    emboss: 0.55 * quality,
    grain: 0,
  });

  c.setTransform(1, 0, 0, 1, 0, 0);
  return chromeCv;
}

/* ------------------------------------------------------------------ bake */

let bakedK = 1;

export function bake(ui, k) {
  const s = k || 1;
  bakedK = s;
  bakeChrome(ui, s);
  bakeFill(PLATE.w, PLATE.h, s);
  bakeLead(s);
}
export function invalidate() { if (chromeCv) { chromeCv.width = 1; } }

export const ORIGIN = { x: PLATE.x - MG, y: PLATE.y - MG };
export const BOX = { w: PLATE.w + MG * 2, h: PLATE.h + MG * 2, mg: MG };

/**
 * Frame path. Three integer-rect drawImage calls plus, when the meter is full,
 * one alpha-modulated re-blit of the leading edge as an overcharge pulse.
 * `d` is the on-screen scale of the blit (1 in game; 2 on the state sheet crop).
 */
export function draw(c, ox, oy, v, t, d) {
  if (!chromeCv || chromeCv.width < 4) return;
  const k = d || 1, s = bakedK;
  c.drawImage(chromeCv, ox, oy, BOX.w * k, BOX.h * k);
  const val = v < 0 ? 0 : v > 1 ? 1 : v;
  const fw = Math.round(TRK.w * val);
  const tx = ox + (MG + TRK.x) * k, ty = oy + (MG + TRK.y) * k;
  if (fw > 0) c.drawImage(fillCv, 0, 0, fw * s, TRK.h * s, tx, ty, fw * k, TRK.h * k);
  if (fw > 2 && fw < TRK.w - 1) {
    c.drawImage(leadCv, tx + (fw - 15) * k, ty - 8 * k, 30 * k, (TRK.h + 16) * k);
  } else if (val >= 0.999) {
    // charged: the whole bar breathes instead of a single edge
    const a = 0.30 + 0.26 * (0.5 + 0.5 * Math.sin(t * 6.0));
    c.save();
    c.globalAlpha = a;
    c.globalCompositeOperation = 'lighter';
    c.drawImage(leadCv, tx + (TRK.w - 22) * k, ty - 8 * k, 30 * k, (TRK.h + 16) * k);
    c.drawImage(leadCv, tx + (TRK.w * 0.5 - 15) * k, ty - 8 * k, 30 * k, (TRK.h + 16) * k);
    c.restore();
  }
}
