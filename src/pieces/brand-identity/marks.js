// PIECE brand-identity — league mark, BLITZ logotype, team wordmark lockups.
//
// The league badge is the NFL shield, drawn the way the concept sheet's title
// panel draws it: not a flat vector reproduction but a heavy illustrated plate
// with a chrome rim, a deep navy field, a raised star band, cut-in NFL letters
// and a bevelled football. Authored in a 100 x 118 unit space and scaled, so it
// stays readable from a 26 px HUD chip up to a 300 px title lockup.

import { REG } from '../../foundation/registry.js';
import {
  lin, rad, rgba, lighten, darken, mix, metal, rr, pathOf, plate, spec, capsText,
  scratchPass, grainPass, mkCanvas,
} from './gfx.js';
import { byId } from './teams.js';

const faces = () => REG.faces;

/* ------------------------------------------------------------- league mark */

/** Shield outline in the 100 x 118 local space. `k` insets it toward the centre. */
function shieldPath(k) {
  const sx = (v) => 50 + (v - 50) * k;
  const sy = (v) => 59 + (v - 59) * k;
  return [
    ['m', sx(5), sy(20)],
    ['c', sx(20), sy(6), sx(80), sy(6), sx(95), sy(20)],
    ['c', sx(95), sy(46), sx(88), sy(74), sx(66), sy(96)],
    ['c', sx(59), sy(103), sx(53), sy(110), sx(50), sy(116)],
    ['c', sx(47), sy(110), sx(41), sy(103), sx(34), sy(96)],
    ['c', sx(12), sy(74), sx(5), sy(46), sx(5), sy(20)],
  ];
}

/** The NFL shield, as an illustrated metal badge. */
export function leagueMark(c, box, opts = {}) {
  const { x, y, w, h } = box;
  const s = Math.min(w / 100, h / 118);
  const navy = opts.field || '#0b2049';
  const met = opts.metal || '#d3dae4';
  const accent = opts.accent || '#e8eef6';
  const tiny = Math.min(w, h) < 46;

  c.save();
  c.translate(x + w / 2, y);
  c.scale(s, s);
  c.translate(-50, 0);

  // outer bloom
  c.save();
  c.globalCompositeOperation = 'lighter';
  c.fillStyle = rad(c, 50, 56, 6, 50, 56, 96, [[0, rgba(accent, 0.16)], [0.55, rgba(accent, 0.05)], [1, rgba(accent, 0)]]);
  c.fillRect(-46, -34, 192, 208);
  c.restore();

  // drop shadow
  c.save();
  c.translate(0, 3.2);
  pathOf(c, shieldPath(1.03), true);
  c.fillStyle = 'rgba(0,0,0,0.55)';
  c.fill();
  c.restore();

  // chrome rim
  pathOf(c, shieldPath(1.0), true);
  c.fillStyle = metal(c, [4, 0, 92, 118], met, { dir: 1.25, hi: 0.8, lo: 0.62 });
  c.fill();
  c.lineJoin = 'round';
  c.strokeStyle = '#04070d';
  c.lineWidth = 3.0;
  c.stroke();

  // navy field
  pathOf(c, shieldPath(0.885), true);
  c.fillStyle = lin(c, 16, 6, 84, 112, [
    [0, lighten(navy, 0.34)], [0.32, lighten(navy, 0.08)], [0.62, navy], [1, '#03060f'],
  ]);
  c.fill();
  c.strokeStyle = 'rgba(0,0,0,0.85)';
  c.lineWidth = 1.9;
  c.stroke();

  c.save();
  pathOf(c, shieldPath(0.885), true);
  c.clip();

  // raised star band
  c.fillStyle = lin(c, 12, 24, 12, 40, [[0, '#ffffff'], [0.55, '#dfe6ef'], [1, '#8d97a5']]);
  c.beginPath();
  c.moveTo(6, 26.5); c.lineTo(94, 26.5); c.lineTo(94, 40); c.lineTo(6, 40); c.closePath();
  c.fill();
  c.fillStyle = 'rgba(0,0,0,0.35)';
  c.fillRect(6, 39.4, 88, 1.8);
  // eight stars, cut dark out of the band
  const starN = tiny ? 5 : 8;
  for (let i = 0; i < starN; i++) {
    const cx = 50 + (i - (starN - 1) / 2) * (tiny ? 15 : 10.6);
    c.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + (k / 10) * Math.PI * 2;
      const r = k % 2 ? 1.5 : 4.0;
      const px = cx + Math.cos(a) * r, py = 33.3 + Math.sin(a) * r;
      if (k === 0) c.moveTo(px, py); else c.lineTo(px, py);
    }
    c.closePath();
    c.fillStyle = lin(c, cx - 4, 29, cx + 4, 38, [[0, lighten(navy, 0.2)], [0.6, navy], [1, '#020509']]);
    c.fill();
  }

  // NFL letters — heavy chrome, cut into the field
  const F = faces();
  c.save();
  c.translate(50, 68);
  c.scale(0.98, 1);
  if (F && typeof F.draw === 'function') {
    F.draw(c, 'NFL', 0, 1.1, { face: 'blitz-block', size: 27, align: 'center', tracking: -0.01, fill: 'rgba(2,4,10,0.9)' });
    F.draw(c, 'NFL', 0, 0, {
      face: 'blitz-block', size: 27, align: 'center', tracking: -0.01,
      fill: lin(c, 0, -22, 0, 4, [[0, '#ffffff'], [0.42, '#f0f4f9'], [0.68, '#b3bcc8'], [1, '#5d6672']]),
    });
  }
  c.restore();

  // football, bevelled, lower third
  c.save();
  c.translate(50, 88);
  c.rotate(-0.38);
  c.beginPath();
  c.ellipse(0, 0, 15.5, 8.4, 0, 0, Math.PI * 2);
  c.fillStyle = lin(c, -15, -9, 15, 9, [[0, '#ffffff'], [0.4, '#e2e8f0'], [1, '#7c8592']]);
  c.fill();
  c.strokeStyle = '#04070d'; c.lineWidth = 1.7; c.stroke();
  c.strokeStyle = 'rgba(11,32,73,0.9)'; c.lineWidth = 1.5;
  c.beginPath(); c.moveTo(-9, -5.6); c.lineTo(-9, 5.6); c.stroke();
  c.beginPath(); c.moveTo(9, -5.6); c.lineTo(9, 5.6); c.stroke();
  c.lineWidth = 1.2;
  c.beginPath(); c.moveTo(-4.4, 0); c.lineTo(4.8, 0); c.stroke();
  for (let i = -1; i <= 1; i++) {
    c.beginPath(); c.moveTo(i * 3, -2.1); c.lineTo(i * 3, 2.1); c.stroke();
  }
  c.restore();

  // internal light falloff
  c.fillStyle = lin(c, 10, 4, 90, 116, [
    [0, 'rgba(255,255,255,0.16)'], [0.35, 'rgba(255,255,255,0)'], [1, 'rgba(0,0,0,0.42)'],
  ]);
  c.fillRect(0, 0, 100, 118);
  c.restore();

  // rim specular along the top-left
  pathOf(c, [
    ['m', 6, 20], ['c', 21, 7, 50, 5, 50, 5], [50, 10],
    ['c', 50, 10, 23, 12, 10, 24],
  ], true);
  c.fillStyle = 'rgba(255,255,255,0.55)';
  c.fill();

  c.restore();
  return box;
}

/* -------------------------------------------------------------- BLITZ logo */

/**
 * blitzLogo(c, box, opts) — chrome BLITZ over red italic RELOADED inside the red
 * angular bracket. Lettering comes from REG.faces so a real face upgrades it.
 */
export function blitzLogo(c, box, opts = {}) {
  const { x, y, w, h } = box;
  const cx = x + w / 2;
  const F = faces();
  const red = opts.accent || '#e01f26';

  c.save();

  // --- red angular bracket -------------------------------------------------
  if (opts.bracket !== false) {
    const bw = w * 0.99, bh = h * 0.86;
    const bx = cx - bw / 2, by = y + h * 0.04;
    const notch = bw * 0.11;
    const pts = [
      [bx + notch, by], [bx + bw - notch, by], [bx + bw, by + bh * 0.20],
      [cx, by + bh], [bx, by + bh * 0.20],
    ];
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.strokeStyle = rgba(red, 0.32);
    c.lineWidth = h * 0.09;
    c.lineJoin = 'miter';
    pathOf(c, pts, true); c.stroke();
    c.restore();
    c.strokeStyle = lin(c, bx, by, bx + bw, by + bh, [
      [0, lighten(red, 0.45)], [0.35, red], [0.7, darken(red, 0.25)], [1, lighten(red, 0.2)],
    ]);
    c.lineWidth = h * 0.040;
    c.lineJoin = 'miter';
    pathOf(c, pts, true); c.stroke();
    c.strokeStyle = 'rgba(255,210,205,0.55)';
    c.lineWidth = h * 0.007;
    pathOf(c, pts, true); c.stroke();
  }

  // --- BLITZ ---------------------------------------------------------------
  const size = h * 0.50;
  const by2 = y + h * 0.545;
  const cond = 0.86;
  const drawWord = (fill, dy) => {
    c.save();
    c.translate(cx, by2 + dy);
    c.scale(cond, 1);
    F.draw(c, 'BLITZ', 0, 0, { face: 'blitz-block', size, align: 'center', tracking: 0.015, fill });
    c.restore();
  };
  // contact spread underneath
  for (let i = 6; i >= 1; i--) drawWord('rgba(3,5,9,0.24)', i * (h * 0.007));
  drawWord('#04060b', h * 0.016);

  // chrome body — gradient built in the glyphs' own local space
  c.save();
  c.translate(cx, by2);
  c.scale(cond, 1);
  const g = lin(c, 0, -size * 0.76, 0, size * 0.12, [
    [0.00, '#ffffff'],
    [0.13, '#cfd8e2'],
    [0.40, '#5d6673'],
    [0.455, '#7d8794'],
    [0.50, '#f2f8ff'],
    [0.66, '#ffffff'],
    [0.82, '#949dab'],
    [1.00, '#3d434f'],
  ]);
  F.draw(c, 'BLITZ', 0, 0, { face: 'blitz-block', size, align: 'center', tracking: 0.015, fill: g });
  // top light band
  c.save();
  c.beginPath();
  c.rect(-w, -size * 0.80, w * 2, size * 0.20);
  c.clip();
  F.draw(c, 'BLITZ', 0, 0, { face: 'blitz-block', size, align: 'center', tracking: 0.015, fill: 'rgba(255,255,255,0.9)' });
  c.restore();
  // warm bounce along the bottom edge
  c.save();
  c.beginPath();
  c.rect(-w, -size * 0.10, w * 2, size * 0.16);
  c.clip();
  F.draw(c, 'BLITZ', 0, 0, { face: 'blitz-block', size, align: 'center', tracking: 0.015, fill: 'rgba(120,90,70,0.55)' });
  c.restore();
  c.restore();

  // --- RELOADED ------------------------------------------------------------
  const rsize = h * 0.235;
  const ry = y + h * 0.79;
  c.save();
  c.translate(cx + w * 0.02, ry);
  c.transform(1, 0, -0.22, 1, 0, 0);
  c.scale(0.94, 1);
  c.save();
  c.globalCompositeOperation = 'lighter';
  F.draw(c, 'RELOADED', 0, 0, { face: 'blitz-brush', size: rsize, align: 'center', tracking: 0.03, fill: rgba(red, 0.35) });
  c.restore();
  F.draw(c, 'RELOADED', 0, h * 0.008, { face: 'blitz-brush', size: rsize, align: 'center', tracking: 0.03, fill: 'rgba(4,4,8,0.9)' });
  F.draw(c, 'RELOADED', 0, 0, {
    face: 'blitz-brush', size: rsize, align: 'center', tracking: 0.03,
    fill: lin(c, 0, -rsize * 0.8, 0, rsize * 0.2, [[0, '#ff6a5e'], [0.45, red], [1, '#7d0d10']]),
  });
  c.restore();

  c.restore();
  return box;
}

/* ----------------------------------------------------------------- wordmark */

/** City (small, tracked) over team name (large, metal-filled, dark-outlined). */
export function wordmark(c, id, box, opts = {}) {
  const team = byId(id);
  const { x, y, w, h } = box;
  const align = opts.align || 'center';
  const cx = align === 'left' ? x : align === 'right' ? x + w : x + w / 2;
  const citySize = opts.citySize || h * 0.26;
  const nameSize = opts.nameSize || h * 0.52;
  const F = faces();
  const accent = opts.accent || team.art.border;

  c.save();
  capsText(c, F, team.city, cx, y + citySize, {
    size: citySize, align, cond: opts.cond || 0.84, tracking: 0.14,
    fill: opts.cityFill || '#cfd2d8',
  });

  const ny = y + citySize + nameSize * 0.98;
  c.save();
  c.translate(cx, ny);
  c.scale(opts.cond || 0.84, 1);
  F.draw(c, team.name, 0, h * 0.016, {
    face: 'blitz-block', size: nameSize, align, tracking: 0.03, fill: 'rgba(2,3,6,0.85)',
  });
  F.draw(c, team.name, 0, 0, {
    face: 'blitz-block', size: nameSize, align, tracking: 0.03,
    fill: opts.nameFill || lin(c, 0, -nameSize * 0.78, 0, nameSize * 0.12, [
      [0, '#ffffff'], [0.32, lighten(accent, 0.68)], [0.55, accent], [1, darken(accent, 0.42)],
    ]),
  });
  c.restore();
  c.restore();
  return box;
}

/* ------------------------------------------------------------------ helpers */

/** A framed, beveled card in the team's language — used by the specimen sheets. */
export function teamCard(c, team, x, y, w, h, opts = {}) {
  const A = team.art;
  const r = opts.radius === undefined ? 22 : opts.radius;
  c.save();
  // outer glow
  c.save();
  c.globalCompositeOperation = 'lighter';
  c.fillStyle = rad(c, x + w / 2, y + h * 0.36, 0, x + w / 2, y + h * 0.36, w * 0.95, [
    [0, rgba(A.glow, opts.selected ? 0.17 : 0.09)], [1, rgba(A.glow, 0)],
  ]);
  c.fillRect(x - w * 0.5, y - h * 0.2, w * 2, h * 1.4);
  c.restore();
  c.restore();
  return { x, y, w, h, r };
}

export default { leagueMark, blitzLogo, wordmark, teamCard };
