// PIECE hud-overlay — the bottom-left TURBO meter.
//
// SILHOUETTE, MEASURED OFF bar/panel-truck.png (528x310 for a 1080-tall frame,
// panel border at x=12, so 1 panel px = 3.484 logical). The plate is 298 x 75
// logical. It is NOT the hard-mitred hexagon with a pointed right spur that round
// one drew. Tracing the frame in the panel at 12x gives, as fractions of the
// plate box:
//
//   (0.055, 0.00) (0.877, 0.00) (1.000, 0.64) (0.976, 1.00) (0.032, 1.00) (0.000, 0.42)
//
// i.e. a soft-rounded left lead, a flat top, ONE diagonal chop at the top right,
// and a rounded bottom. There is no spur.
//
// The blue is not a uniformly-lit bevel around a dark hole either: the plate is a
// near-black glass slab with a thin blue rim, and the big bright blue mass is the
// FILL BAR itself, which occupies the bottom 35% and wraps around the rounded left
// lead — which is exactly why the bar's plate reads brightest along its bottom
// left. One segment divider, a long white-hot leading smear, no outer halo.
//
// The word sits high and large: ink 178 x 37 logical inside a 288 x 82 plate, and
// it is OBLIQUE — slant 0.34, about 19 degrees right, matching the brush italic
// elsewhere in the art. Round one drew it at the face's 0.19 default, which at
// this size reads as dead upright. It is also PACKED, ink to ink, rather than set
// on the face's 0.10 em default tracking (see ink.js).
//
// COST: chrome, fill strip, leading-edge sprite and the overheat rim are each
// baked once. The frame path is drawImage calls with numeric sub-rects and, when
// overheating, one extra alpha-modulated blit — no allocation, no re-pathing.

import {
  mkCanvas, poly, vgrad, hgrad, rgba, mix, lighten, darken, grain, brushed, innerEdge, gloss,
} from './chrome.js';
import { inkSet } from './ink.js';

/* PLATE PROPORTION, RE-MEASURED IN ROUND 3.
 * Round 2 shipped 288 x 82 = 3.51. Re-derived from the art by masking the blue
 * rim (B > 90, B-R > 45, B-G > 22) in the bottom-left of every panel that shows
 * the meter whole — panel-catch is cropped at x=0 and cannot be used — and taking
 * the bounding box of the rim component, GLOW INCLUDED:
 *
 *     qb_dropback  89 x 23  = 3.87        leveler    89 x 23 = 3.87
 *     truck        87 x 24  = 3.63        touchdown  91 x 22 = 4.14
 *     midair_hit   87 x 22  = 3.95
 *
 * The two hero panels give 3.87 and 3.63, mean 3.75; the five-panel median is
 * 3.87. The spread is real — the plate's right end tapers into its own glow, so
 * where you cut the tip moves the width by a few per cent — but every panel is
 * above 3.6 and ours was 3.51. Shipping 3.79.
 *
 * The BOTTOM EDGE does not move: layout.turboTop() derives the top from
 * (frame bottom - TURBO_BOTTOM_INSET - plateH - mg), so the plate's bottom stays
 * pinned at 1036 logical whatever h is. Only the top edge comes down.
 * The interior (word, track) is rescaled by 76/82 so nothing overflows. */
export const PLATE = { x: 48, y: 960, w: 288, h: 76 };
const MG = 24;

export const TRK = { x: 4, y: 45.4, w: 277, h: 26 };

const BLUE = '#1f57ef';
const BLUE_HI = '#8fb6ff';
const BLUE_LO = '#0b1d68';

/* THE WORD, RE-MEASURED IN ROUND 2.
 * Thresholding panel-truck.png at 16x over a band that excludes the meter puts
 * the TURBO ink at panel x 30..80, y 273..281 — 51 x 9 panel px, and at 3.484
 * logical per panel px that is 177.7 x 31.4 LOGICAL, sitting 7 logical below the
 * plate's top edge. Two corrections fall out:
 *
 *   HEIGHT.  Round 1 set h = 37 in the same 178-wide box. Taller ink in a fixed
 *            width means NARROWER letters, so the run solved to five 28-wide
 *            glyphs separated by 10 px of air. The bar's five glyphs are ~33 wide
 *            with ~3.5 px between them: nearly square, packed, moulded. Dropping
 *            to h = 32 and opening the gap to 3.4 lets the solver widen the
 *            letters instead of stretching them.
 *   SLANT.   Tracing the U and R stems in the art gives dx/dy = 0.19..0.23, i.e.
 *            11-13 degrees off vertical. Round 1 used 0.34 (18.8 deg), which past
 *            about 15 degrees stops reading as a moulded oblique and starts
 *            reading as a skewed rectangle. 0.24 = 13.5 degrees. */
// x/w carry the oblique's overhang: the run box is anchored on the UPRIGHT boxes,
// and a sheared 'T' puts its real left edge about 10 px right of that anchor while
// the final 'O' leans ~8 px past its right, so the box is opened at both ends to
// land the DRAWN ink on the bar's 0.128..0.71 of the plate width.
const WORD = { x: 27, y: 6.5, w: 182, h: 29.6, slant: 0.24 };

let chromeCv = null, fillCv = null, leadCv = null, heatCv = null;
let quality = 1;
export function setQuality(q) { quality = q; }

function outlinePts(w, h) {
  return [
    [0.055 * w, 0],
    [0.877 * w, 0],
    [1.000 * w, 0.64 * h],
    [0.976 * w, h],
    [0.032 * w, h],
    [0.000 * w, 0.42 * h],
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
  const cw = Math.round(w * s), ch = Math.round(h * s);
  if (!fillCv) fillCv = mkCanvas(cw, ch);
  if (fillCv.width !== cw) { fillCv.width = cw; fillCv.height = ch; }
  const c = fillCv.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, fillCv.width, fillCv.height);
  c.setTransform(s, 0, 0, s, 0, 0);

  // clip to the plate's inner silhouette so the strip picks up the rounded left
  // lead and the right-hand chop instead of ending in a square butt
  const innerLocal = inset(outlinePts(W, H), 4.6);
  c.save();
  const p = poly(innerLocal.map((q) => [q[0] - TRK.x, q[1] - TRK.y]), 6);
  c.clip(p);

  c.fillStyle = hgrad(c, 0, w, [
    [0.00, rgba(mix(BLUE, BLUE_HI, 0.34), 1)],
    [0.22, rgba(BLUE, 1)],
    [0.66, rgba(mix(BLUE, BLUE_HI, 0.24), 1)],
    [1.00, rgba(mix(BLUE, BLUE_HI, 0.48), 1)],
  ]);
  c.fillRect(0, 0, w, h);

  // glossy cylinder: dark top lip, hot specular band high, deep shadow at base
  c.fillStyle = vgrad(c, 0, h, [
    [0.00, 'rgba(8,18,60,0.62)'],
    [0.12, 'rgba(140,184,255,0.42)'],
    [0.28, 'rgba(232,243,255,0.80)'],
    [0.40, 'rgba(150,190,255,0.26)'],
    [0.62, 'rgba(20,50,150,0.08)'],
    [0.86, 'rgba(3,9,40,0.50)'],
    [1.00, 'rgba(1,5,24,0.80)'],
  ]);
  c.fillRect(0, 0, w, h);

  // ONE divider. The bar's meter is a single glowing bar that happens to be
  // notched once, not a six-cell battery gauge.
  c.fillStyle = 'rgba(2,6,26,0.72)';
  c.fillRect(Math.round(w * 0.45) - 0.8, 0, 1.6, h);
  c.fillStyle = 'rgba(150,190,255,0.18)';
  c.fillRect(Math.round(w * 0.45) + 0.8, 0, 0.8, h);

  grain(c, poly([[0, 0], [w, 0], [w, h], [0, h]], 0), 0, 0, w, h, 0x7be1, 0.45 * quality);
  c.restore();
  return fillCv;
}

/** The long white-hot smear that rides the fill boundary, plus its warm tick. */
function bakeLead(s) {
  const w = 46, h = TRK.h + 10;
  const cw = Math.round(w * s), ch = Math.round(h * s);
  if (!leadCv) leadCv = mkCanvas(cw, ch);
  if (leadCv.width !== cw) { leadCv.width = cw; leadCv.height = ch; }
  const c = leadCv.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, leadCv.width, leadCv.height);
  c.setTransform(s, 0, 0, s, 0, 0);
  const cy = h * 0.5;
  // long horizontal smear rather than a round blob — the bar's is a streak
  const g = c.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0.00, 'rgba(120,170,255,0)');
  g.addColorStop(0.30, 'rgba(180,214,255,0.35)');
  g.addColorStop(0.66, 'rgba(255,255,255,0.92)');
  g.addColorStop(0.80, 'rgba(255,252,244,0.98)');
  g.addColorStop(0.86, 'rgba(255,190,150,0.55)');
  g.addColorStop(1.00, 'rgba(255,120,80,0)');
  c.fillStyle = g;
  const vg = c.createLinearGradient(0, cy - h * 0.42, 0, cy + h * 0.42);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(0.5, 'rgba(0,0,0,1)');
  vg.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillRect(0, cy - h * 0.34, w, h * 0.68);
  c.globalCompositeOperation = 'destination-in';
  c.fillStyle = vg;
  c.fillRect(0, 0, w, h);
  c.globalCompositeOperation = 'source-over';
  // the warm tick the bar puts right at the boundary
  c.fillStyle = 'rgba(255,96,60,0.85)';
  c.fillRect(w * 0.855, cy - h * 0.24, 2.2, h * 0.48);
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
  const outer = poly(pts, 9);

  // Contact shadow only. Round one wrapped this in a strong additive blue halo;
  // the bar has none — just a tight dark shadow and a faint blue bleed onto the
  // turf below the plate, which is a light spill, not a glow ring.
  c.save();
  c.shadowColor = 'rgba(1,3,10,0.78)';
  c.shadowBlur = 11;
  c.shadowOffsetY = 5;
  c.fillStyle = 'rgba(0,0,0,0.99)';
  c.fill(outer);
  c.restore();
  c.save();
  c.globalCompositeOperation = 'lighter';
  c.globalAlpha = 0.055;
  c.shadowColor = 'rgba(40,96,255,0.9)';
  c.shadowBlur = 16;
  c.shadowOffsetY = 13;
  c.fillStyle = 'rgba(20,50,180,0.9)';
  c.fill(outer);
  c.restore();
  c.save();
  c.globalCompositeOperation = 'destination-out';
  c.fill(outer);
  c.restore();

  // The rim: a thin anodised blue band, brightest along the BOTTOM LEFT.
  const rg = c.createLinearGradient(0, H * 1.15, W * 0.66, -H * 0.22);
  rg.addColorStop(0.00, rgba(lighten(BLUE, 0.46), 1));
  rg.addColorStop(0.18, rgba(mix(BLUE, BLUE_HI, 0.18), 1));
  rg.addColorStop(0.38, rgba(BLUE, 1));
  rg.addColorStop(0.60, rgba(mix(BLUE, BLUE_LO, 0.72), 1));
  rg.addColorStop(0.82, rgba(darken(BLUE_LO, 0.46), 1));
  rg.addColorStop(1.00, rgba(darken(BLUE_LO, 0.66), 1));
  c.fillStyle = rg;
  c.fill(outer);
  brushed(c, outer, 0, 0, W, H, 0x3ad2, 0.7 * quality);
  innerEdge(c, outer, 0, 1.4, 'rgba(210,232,255,0.42)', 'rgba(0,0,0,0.5)', 1.6);
  c.strokeStyle = 'rgba(5,11,42,0.92)';
  c.lineWidth = 1.2;
  c.stroke(outer);

  // inner well — near-black glass, the word's ground
  const innerPts = inset(pts, 4.6);
  const inner = poly(innerPts, 6);
  c.fillStyle = vgrad(c, 0, H, [
    [0.00, 'rgba(20,28,52,0.97)'],
    [0.18, 'rgba(10,14,26,0.97)'],
    [0.58, 'rgba(5,7,14,0.96)'],
    [1.00, 'rgba(2,4,9,0.97)'],
  ]);
  c.fill(inner);
  grain(c, inner, 0, 0, W, H, 0x11c4, 0.6 * quality);
  gloss(c, inner, 0, 0, W, H * 0.5, 0.05, 0.45);
  innerEdge(c, inner, 0, 1.1, 'rgba(0,0,0,0.8)', 'rgba(150,190,255,0.20)', 1.5);

  // empty track well, under where the fill will land
  c.save();
  c.clip(inner);
  c.fillStyle = vgrad(c, TRK.y, TRK.y + TRK.h, [
    [0.00, 'rgba(0,1,4,0.98)'],
    [0.44, 'rgba(5,8,17,0.96)'],
    [1.00, 'rgba(13,19,36,0.92)'],
  ]);
  c.fillRect(TRK.x, TRK.y, TRK.w, TRK.h);
  c.strokeStyle = 'rgba(0,0,0,0.85)';
  c.lineWidth = 1.3;
  c.strokeRect(TRK.x + 0.65, TRK.y + 0.65, TRK.w - 1.3, TRK.h - 1.3);
  c.fillStyle = 'rgba(52,86,180,0.16)';
  c.fillRect(TRK.x + Math.round(TRK.w * 0.45), TRK.y + 2, 1, TRK.h - 4);
  c.restore();

  // TURBO — oblique, packed ink-to-ink, filling its measured rect edge to edge.
  inkSet(F, c, 'TURBO', 'blitz-techno', {
    x: WORD.x, y: WORD.y, h: WORD.h, w: WORD.w, align: 'left',
    // maxXs 2.05: the techno cap is naturally ~0.56 of its height and the bar's is
    // 33 x 31, so the run genuinely needs to be widened almost 2x to sit as square
    // and as heavy as the art. Round 2's first pass clamped at 1.70 and silently
    // gave back a run 11% narrower than asked for.
    // gap 3.4, not 2.4: MEASURED off the art. Thresholding panel-truck.png over
    // the word band and reading the letter edges row by row puts the bar's
    // inter-letter gaps at 1 panel px = 3.5 logical for U-R, R-B and B-O, and
    // 5 panel px = 17.4 logical for T-U — the T's crossbar sets its own spacing
    // there, in the art exactly as here. So the four gaps are NOT meant to match
    // each other; the three that do not involve a 'T' are.
    //
    // capBand 0.50 / clear 0.15: blitz-techno's 'R' throws its leg ~12 px right of
    // its bowl at this size, so a full-height packing rule spaced 'B' off the toe
    // of that leg and left a 6.3 px hole beside the bowl — "TUR BO". Spacing on
    // the middle 50% of the ink and holding the toe off with a small clearance
    // instead closes it. (The bar's own 'R' does not splay: its widest point is
    // the bowl, 59 panel px, against a foot at 58 — which is why the art can hold
    // one uniform gap at every height and this face cannot.)
    gap: 3.4, capBand: 0.50, clear: 0.15,
    slant: WORD.slant, minXs: 0.62, maxXs: 2.05,
    keyline: { color: 'rgba(0,0,0,0.92)', k: 0.034 },
    shadow: { color: 'rgba(0,3,14,0.95)', blur: 9, dy: 4, alpha: 0.95 },
    grad: [
      [0.00, '#ffffff'],
      [0.46, '#ffffff'],
      [0.80, '#e8eef8'],
      [1.00, '#c3cede'],
    ],
    shade: { color: 'rgba(14,22,44,0.16)', dy: 2.4, alpha: 1 },
  });

  c.setTransform(1, 0, 0, 1, 0, 0);
  return chromeCv;
}

/** Overheat rim: baked once, blitted with a scalar alpha when heat > 0. */
function bakeHeat(s) {
  const W = PLATE.w, H = PLATE.h;
  const CW = Math.round(BOX.w * s), CH = Math.round(BOX.h * s);
  if (!heatCv) heatCv = mkCanvas(CW, CH);
  if (heatCv.width !== CW) { heatCv.width = CW; heatCv.height = CH; }
  const c = heatCv.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, CW, CH);
  c.setTransform(s, 0, 0, s, 0, 0);
  c.translate(MG, MG);
  const pts = outlinePts(W, H);
  const outer = poly(pts, 9);
  const inner = poly(inset(pts, 4.6), 6);
  c.save();
  c.fillStyle = vgrad(c, 0, H, [
    [0.00, 'rgba(255,214,120,0.95)'],
    [0.35, 'rgba(255,110,26,0.95)'],
    [1.00, 'rgba(176,18,12,0.95)'],
  ]);
  c.fill(outer);
  c.globalCompositeOperation = 'destination-out';
  c.fill(inner);
  c.restore();
  // additive bloom on the rim only. `destination-out` erases by SOURCE ALPHA, so
  // the cut-out has to be filled opaque — cutting with the 0.55 tint is how the
  // first pass at this leaked orange across the whole interior.
  c.save();
  c.globalCompositeOperation = 'lighter';
  c.shadowColor = 'rgba(255,110,40,0.9)';
  c.shadowBlur = 16;
  c.fillStyle = 'rgba(255,90,30,0.5)';
  c.fill(outer);
  c.restore();
  c.save();
  c.globalCompositeOperation = 'destination-out';
  c.fillStyle = '#000';
  c.fill(inner);
  c.restore();
  // a restrained interior wash so the well reads hot without hiding the meter
  c.save();
  c.clip(inner);
  c.fillStyle = vgrad(c, 0, H, [
    [0.00, 'rgba(255,150,40,0.26)'],
    [0.55, 'rgba(214,54,16,0.14)'],
    [1.00, 'rgba(150,16,8,0.10)'],
  ]);
  c.fillRect(0, 0, W, H);
  c.restore();
  c.setTransform(1, 0, 0, 1, 0, 0);
  return heatCv;
}

/* ------------------------------------------------------------------ bake */

let bakedK = 1;

export function bake(ui, k) {
  const s = k || 1;
  bakedK = s;
  bakeChrome(ui, s);
  bakeFill(PLATE.w, PLATE.h, s);
  bakeLead(s);
  bakeHeat(s);
}
export function invalidate() { if (chromeCv) { chromeCv.width = 1; } }

export const ORIGIN = { x: PLATE.x - MG, y: PLATE.y - MG };
export const BOX = { w: PLATE.w + MG * 2, h: PLATE.h + MG * 2, mg: MG };

/**
 * Frame path. Integer-rect drawImage calls plus, when the meter is full or the
 * turbo is overheating, one alpha-modulated re-blit. `d` is the on-screen scale
 * of the blit (1 in game; 2 on the state sheet crop). `heat` 0..1 is the overheat
 * state the timing piece drives.
 */
export function draw(c, ox, oy, v, t, d, heat) {
  if (!chromeCv || chromeCv.width < 4) return;
  const k = d || 1, s = bakedK;
  c.drawImage(chromeCv, ox, oy, BOX.w * k, BOX.h * k);
  const val = v < 0 ? 0 : v > 1 ? 1 : v;
  const fw = Math.round(TRK.w * val);
  const tx = ox + (MG + TRK.x) * k, ty = oy + (MG + TRK.y) * k;
  if (fw > 0) c.drawImage(fillCv, 0, 0, fw * s, TRK.h * s, tx, ty, fw * k, TRK.h * k);
  if (fw > 2 && fw < TRK.w - 1) {
    c.drawImage(leadCv, tx + (fw - 38) * k, ty - 5 * k, 46 * k, (TRK.h + 10) * k);
  } else if (val >= 0.999) {
    const a = 0.26 + 0.24 * (0.5 + 0.5 * Math.sin(t * 6.0));
    c.save();
    c.globalAlpha = a;
    c.globalCompositeOperation = 'lighter';
    c.drawImage(leadCv, tx + (TRK.w - 40) * k, ty - 5 * k, 46 * k, (TRK.h + 10) * k);
    c.drawImage(leadCv, tx + (TRK.w * 0.5 - 24) * k, ty - 5 * k, 46 * k, (TRK.h + 10) * k);
    c.restore();
  }
  const hv = heat === undefined ? 0 : (heat < 0 ? 0 : heat > 1 ? 1 : heat);
  if (hv > 0.001 && heatCv) {
    c.save();
    c.globalAlpha = hv * (0.62 + 0.38 * (0.5 + 0.5 * Math.sin(t * 9.0)));
    c.drawImage(heatCv, ox, oy, BOX.w * k, BOX.h * k);
    c.restore();
  }
}
