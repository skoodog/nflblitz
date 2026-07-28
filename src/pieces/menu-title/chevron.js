// PIECE menu-title — the red neon chevron badge behind the wordmark.
//
// Geometry measured off bar/panel-title.png at 3.195 logical px per panel px,
// with x taken relative to the LOCKUP centre (panel x 235.5) rather than the
// panel centre, because the bar panel is a slightly off-centre crop:
//
//   outer points        x = 960 +- 640, y = 297
//   shoulder corners    x = 960 +- 454, y = 262   (the top edge steps up here)
//   apex                (960, 741)
//   flanking bracket    tips (960 +- 237, 200) -> corners (960 +- 166, 236)
//
// Three horizontal neon lines therefore stack above the wordmark at y = 236,
// 262 and 297 — the bracket, the outer outline and the inset outline. That
// stepped stack is the shape's signature; a single clean arrowhead reads wrong
// at a glance even when the colour is right.
//
// The neon is built the way neon reads: a wide weak halo, a mid halo, a
// saturated body whose hue runs deep red at the centre to orange-white at the
// tips, and a thin white-hot core — all additive, so crossings and tips blow
// out on their own instead of being drawn pre-blown.

import { stopsInto } from './geom.js';

export const CX = 960;

export const OUTER = [
  [CX - 640, 297], [CX - 454, 262], [CX + 454, 262], [CX + 640, 297], [CX, 741],
];

export const BRACKET = [
  [CX - 237, 200], [CX - 166, 236], [CX + 166, 236], [CX + 237, 200],
];

const BODY_STOPS = [
  [0.000, '#ffcf92'], [0.030, '#ff7a24'], [0.075, '#e02c16'], [0.180, '#c81c10'],
  [0.500, '#b81810'], [0.820, '#c81c10'], [0.925, '#e02c16'], [0.970, '#ff7a24'],
  [1.000, '#ffcf92'],
];

function pathOf(c, pts, close) {
  c.beginPath();
  c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
  if (close) c.closePath();
}

/** halo -> body -> core. `s` scales every width so one stack serves all three outlines. */
function neonStroke(c, pts, close, s, x0, x1) {
  c.save();
  c.globalCompositeOperation = 'lighter';
  c.lineJoin = 'miter';
  c.miterLimit = 8;
  c.lineCap = 'round';

  const halo = [
    [82 * s, 'rgba(206,26,12,0.055)'],
    [44 * s, 'rgba(228,38,16,0.090)'],
    [23 * s, 'rgba(240,54,20,0.165)'],
    [14 * s, 'rgba(250,74,26,0.210)'],
  ];
  for (let i = 0; i < halo.length; i++) {
    c.lineWidth = halo[i][0]; c.strokeStyle = halo[i][1];
    pathOf(c, pts, close); c.stroke();
  }
  c.lineWidth = 10.6 * s;
  c.strokeStyle = stopsInto(c.createLinearGradient(x0, 0, x1, 0), BODY_STOPS);
  pathOf(c, pts, close); c.stroke();

  c.lineWidth = 4.4 * s;
  c.strokeStyle = 'rgba(255,140,74,0.42)';
  pathOf(c, pts, close); c.stroke();

  c.lineWidth = 2.0 * s;
  c.strokeStyle = 'rgba(255,240,204,0.72)';
  pathOf(c, pts, close); c.stroke();
  c.restore();
}

function flare(c, x, y, r, a) {
  c.save();
  c.globalCompositeOperation = 'lighter';
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(255,246,214,${(0.82 * a).toFixed(3)})`);
  g.addColorStop(0.16, `rgba(255,150,60,${(0.40 * a).toFixed(3)})`);
  g.addColorStop(0.45, `rgba(226,42,18,${(0.15 * a).toFixed(3)})`);
  g.addColorStop(1, 'rgba(190,20,10,0)');
  c.fillStyle = g;
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  c.restore();
}

/** Everything behind the wordmark: ambient spill, dark plate, all three outlines. */
export function drawChevron(c, inner) {
  c.save();
  c.globalCompositeOperation = 'lighter';
  const amb = c.createRadialGradient(CX, 440, 40, CX, 440, 1000);
  amb.addColorStop(0, 'rgba(186,26,14,0.185)');
  amb.addColorStop(0.35, 'rgba(150,20,12,0.095)');
  amb.addColorStop(0.72, 'rgba(96,14,26,0.033)');
  amb.addColorStop(1, 'rgba(60,10,30,0)');
  c.fillStyle = amb;
  // sized to the gradient, not to the frame, so a zoomed iso scene still gets
  // the whole falloff under an arbitrary transform
  c.fillRect(CX - 1010, 440 - 1010, 2020, 2020);
  c.restore();

  c.save();
  pathOf(c, OUTER, true);
  const plate = c.createLinearGradient(0, 262, 0, 741);
  plate.addColorStop(0.00, 'rgba(9,5,12,0.94)');
  plate.addColorStop(0.42, 'rgba(14,5,11,0.88)');
  plate.addColorStop(0.78, 'rgba(36,7,10,0.74)');
  plate.addColorStop(1.00, 'rgba(82,13,12,0.56)');
  c.fillStyle = plate;
  c.fill();
  c.restore();

  // the interior is not empty in the art: neon fills it, brightest under the
  // top edge and again at the apex
  c.save();
  pathOf(c, OUTER, true);
  c.clip();
  c.globalCompositeOperation = 'lighter';
  const inglow = c.createLinearGradient(0, 262, 0, 620);
  inglow.addColorStop(0, 'rgba(224,52,24,0.34)');
  inglow.addColorStop(0.34, 'rgba(176,28,14,0.13)');
  inglow.addColorStop(1, 'rgba(120,16,10,0)');
  c.fillStyle = inglow;
  c.fillRect(CX - 700, 250, 1400, 400);
  c.restore();

  flare(c, CX, 733, 215, 0.55);

  neonStroke(c, OUTER, true, 1.0, CX - 640, CX + 640);
  neonStroke(c, inner, true, 0.56, CX - 585, CX + 585);
  neonStroke(c, BRACKET, false, 0.60, CX - 237, CX + 237);

  flare(c, CX - 640, 297, 124, 1.0);
  flare(c, CX + 640, 297, 124, 1.0);
  flare(c, CX - 454, 262, 54, 0.62);
  flare(c, CX + 454, 262, 54, 0.62);
  flare(c, CX - 237, 200, 46, 0.60);
  flare(c, CX + 237, 200, 46, 0.60);
}

export default { OUTER, BRACKET, drawChevron, CX };
