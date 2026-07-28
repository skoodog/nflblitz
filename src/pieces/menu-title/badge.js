// PIECE menu-title — the LEAGUE BADGE.
//
// FICTIONAL, deliberately and visibly. The bar panel puts the real NFL shield
// at the top of the lockup; this league is BLITZ RELOADED, so the crest is a
// different object: an angular winged crest with a stepped shoulder that echoes
// the chevron below it, a chrome rim, a deep navy field, a raised star band and
// a chromed bolt. It is not a rounded shield, it carries no NFL letterforms and
// no NFL colourway, and it is drawn here rather than taken from REG.brand,
// whose leagueMark is a shield.
//
// Authored in a 100 x 128 unit space and scaled, so it survives from a 40 px
// HUD chip up to the 182 px title lockup.

import { stopsInto } from './geom.js';

const CREST = [
  [20, 3], [80, 3], [90, 13], [90, 33], [100, 45], [86, 62],
  [74, 82], [50, 125], [26, 82], [14, 62], [0, 45], [10, 33], [10, 13],
];

function pathOf(c, pts, k) {
  c.beginPath();
  c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
  c.closePath();
  void k;
}

function inset(pts, d) {
  // The crest is convex enough that a centre-directed inset is stable and
  // cheaper than a general offset here.
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p[0]; cy += p[1]; }
  cx /= pts.length; cy /= pts.length;
  return pts.map((p) => {
    const dx = p[0] - cx, dy = p[1] - cy;
    const l = Math.hypot(dx, dy) || 1;
    return [p[0] - (dx / l) * d, p[1] - (dy / l) * d];
  });
}

function star(c, x, y, r, rot) {
  c.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + rot + (k / 10) * Math.PI * 2;
    const rr = k % 2 ? r * 0.42 : r;
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    if (k === 0) c.moveTo(px, py); else c.lineTo(px, py);
  }
  c.closePath();
}

const BOLT = [[57, 42], [40, 74], [51, 74], [43, 100], [64, 66], [52, 66], [62, 42]];

/** drawBadge(c, {x, y, w}) — x,y is the top-left of the crest box. */
export function drawBadge(c, box) {
  const s = box.w / 100;
  c.save();
  c.translate(box.x, box.y);
  c.scale(s, s);

  // halo
  c.save();
  c.globalCompositeOperation = 'lighter';
  const halo = c.createRadialGradient(50, 56, 4, 50, 56, 96);
  halo.addColorStop(0, 'rgba(206,220,245,0.16)');
  halo.addColorStop(0.45, 'rgba(150,170,220,0.05)');
  halo.addColorStop(1, 'rgba(120,140,200,0)');
  c.fillStyle = halo;
  c.fillRect(-50, -34, 200, 210);
  c.restore();

  // cast shadow
  c.save();
  c.translate(1.4, 4.2);
  pathOf(c, CREST);
  c.fillStyle = 'rgba(2,2,6,0.75)';
  c.fill();
  c.restore();

  // chrome rim
  pathOf(c, CREST);
  c.fillStyle = stopsInto(c.createLinearGradient(0, 0, 0, 125), [
    [0, '#ffffff'], [0.12, '#e7ecf3'], [0.30, '#9aa4b3'], [0.42, '#4a515d'],
    [0.5, '#c8d0da'], [0.72, '#8b94a2'], [1, '#3d434e'],
  ]);
  c.fill();
  c.lineJoin = 'miter';
  c.strokeStyle = '#04060c';
  c.lineWidth = 2.4;
  c.stroke();

  // navy field
  const field = inset(CREST, 7.2);
  pathOf(c, field);
  c.fillStyle = stopsInto(c.createLinearGradient(0, 6, 0, 118), [
    [0, '#1d3f7e'], [0.30, '#122c5c'], [0.62, '#0a1c40'], [1, '#03071a'],
  ]);
  c.fill();
  c.strokeStyle = 'rgba(0,0,0,0.85)';
  c.lineWidth = 1.6;
  c.stroke();

  c.save();
  pathOf(c, field);
  c.clip();

  // raised star band
  c.fillStyle = stopsInto(c.createLinearGradient(0, 20, 0, 35), [
    [0, '#eef2f8'], [0.42, '#c3cbd7'], [1, '#6b7482'],
  ]);
  c.fillRect(6, 21, 88, 12.4);
  c.fillStyle = 'rgba(0,0,0,0.42)';
  c.fillRect(6, 32.8, 88, 1.7);
  for (let i = 0; i < 5; i++) {
    const cx = 50 + (i - 2) * 14.2;
    star(c, cx, 27.0, 4.0, 0);
    c.fillStyle = stopsInto(c.createLinearGradient(cx - 5, 22, cx + 5, 33), [
      [0, '#1b3d78'], [0.6, '#0a1c40'], [1, '#01040e'],
    ]);
    c.fill();
  }

  // chromed bolt
  c.save();
  c.translate(0, 1);
  pathOf(c, BOLT);
  c.fillStyle = 'rgba(2,4,10,0.9)';
  c.save(); c.translate(1.4, 2.0); c.fill(); c.restore();
  pathOf(c, BOLT);
  c.fillStyle = stopsInto(c.createLinearGradient(0, 40, 0, 102), [
    [0, '#ffd7a2'], [0.16, '#ff8a3c'], [0.36, '#e8321a'],
    [0.50, '#b81410'], [0.62, '#ff5a22'], [0.82, '#d81c12'], [1, '#6e0a08'],
  ]);
  c.fill();
  c.strokeStyle = '#0a0406';
  c.lineWidth = 1.8;
  c.stroke();
  c.save();
  c.globalCompositeOperation = 'lighter';
  pathOf(c, BOLT);
  c.strokeStyle = 'rgba(255,150,80,0.55)';
  c.lineWidth = 0.9;
  c.stroke();
  c.restore();
  c.restore();

  // inner falloff
  c.fillStyle = stopsInto(c.createLinearGradient(10, 4, 90, 122), [
    [0, 'rgba(255,255,255,0.13)'], [0.34, 'rgba(255,255,255,0)'], [1, 'rgba(0,0,0,0.45)'],
  ]);
  c.fillRect(0, 0, 100, 128);
  c.restore();

  // rim specular, upper left
  c.beginPath();
  c.moveTo(11, 14); c.lineTo(21, 5); c.lineTo(50, 5); c.lineTo(50, 9.5); c.lineTo(23, 9.5); c.lineTo(15, 17);
  c.closePath();
  c.fillStyle = 'rgba(255,255,255,0.55)';
  c.fill();

  c.restore();
  return box;
}

export default { drawBadge };
