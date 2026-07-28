// PIECE brand-identity — league mark, BLITZ logotype, team wordmark lockups.
//
// FICTIONAL LEAGUE ONLY. The badge below is an angular hex-chevron plate with a
// bolt-through-ball device — deliberately unlike any real league shield, and it
// carries no real club marks.

import { REG } from '../../foundation/registry.js';
import {
  lin, rad, rgba, lighten, darken, mix, metal, rr, pathOf, plate, spec, capsText,
  scratchPass, grainPass, mkCanvas,
} from './gfx.js';
import { byId } from './teams.js';

const faces = () => REG.faces;

/* ------------------------------------------------------------- league mark */

/** Fictional league badge. Angular hex-chevron plate, bolt through a football. */
export function leagueMark(c, box, opts = {}) {
  const { x, y, w, h } = box;
  const s = Math.min(w / 100, h / 118);
  const navy = opts.field || '#101a34';
  const met = opts.metal || '#c9d2de';
  const accent = opts.accent || '#d8342e';

  c.save();
  c.translate(x + w / 2, y);
  c.scale(s, s);
  c.translate(-50, 0);

  const outline = [
    [50, 0], [96, 20], [96, 62], [50, 118], [4, 62], [4, 20],
  ];

  // outer glow
  c.save();
  c.globalCompositeOperation = 'lighter';
  c.fillStyle = rad(c, 50, 56, 6, 50, 56, 92, [[0, rgba(accent, 0.20)], [1, rgba(accent, 0)]]);
  c.fillRect(-40, -30, 180, 200);
  c.restore();

  // metal rim
  pathOf(c, outline, true);
  c.fillStyle = metal(c, [4, 0, 92, 118], met, { dir: 1.25, hi: 0.75, lo: 0.6 });
  c.fill();
  c.lineJoin = 'round';
  c.strokeStyle = '#05080e';
  c.lineWidth = 3.2;
  c.stroke();

  // inner field
  const inner = [[50, 8], [88, 25], [88, 60], [50, 108], [12, 60], [12, 25]];
  pathOf(c, inner, true);
  c.fillStyle = lin(c, 20, 8, 80, 108, [[0, lighten(navy, 0.22)], [0.42, navy], [1, '#05070e']]);
  c.fill();
  c.strokeStyle = 'rgba(0,0,0,0.85)';
  c.lineWidth = 2.4;
  c.stroke();

  // top band
  c.save();
  pathOf(c, inner, true);
  c.clip();
  c.fillStyle = lin(c, 12, 22, 12, 40, [[0, rgba(met, 0.9)], [1, rgba(met, 0.45)]]);
  c.fillRect(12, 24, 76, 12);
  c.fillStyle = 'rgba(0,0,0,0.75)';
  for (let i = 0; i < 5; i++) {
    const cx = 22 + i * 14;
    c.beginPath();
    c.moveTo(cx, 27); c.lineTo(cx + 5, 33); c.lineTo(cx, 33.5); c.lineTo(cx - 5, 33);
    c.closePath(); c.fill();
  }
  // bolt behind
  c.fillStyle = lin(c, 30, 42, 74, 100, [[0, '#ffe58a'], [0.5, accent], [1, darken(accent, 0.55)]]);
  c.beginPath();
  c.moveTo(66, 40); c.lineTo(40, 70); c.lineTo(53, 72); c.lineTo(34, 104);
  c.lineTo(66, 66); c.lineTo(52, 64); c.closePath();
  c.fill();
  c.strokeStyle = 'rgba(0,0,0,0.8)'; c.lineWidth = 1.6; c.stroke();

  // football
  c.save();
  c.translate(50, 66);
  c.rotate(-0.34);
  c.beginPath();
  c.ellipse(0, 0, 26, 14, 0, 0, Math.PI * 2);
  c.fillStyle = lin(c, -26, -14, 26, 14, [[0, '#8c5a30'], [0.35, '#6a3d1c'], [1, '#2c1608']]);
  c.fill();
  c.strokeStyle = '#05060a'; c.lineWidth = 2.2; c.stroke();
  c.strokeStyle = 'rgba(240,240,244,0.92)'; c.lineWidth = 2.4;
  c.beginPath(); c.moveTo(-16, -9.5); c.lineTo(-16, 9.5); c.stroke();
  c.beginPath(); c.moveTo(16, -9.5); c.lineTo(16, 9.5); c.stroke();
  c.lineWidth = 1.7;
  c.beginPath(); c.moveTo(-7, 0); c.lineTo(8, 0); c.stroke();
  for (let i = -2; i <= 2; i++) {
    c.beginPath(); c.moveTo(i * 4 + 0.5, -3.2); c.lineTo(i * 4 + 0.5, 3.2); c.stroke();
  }
  c.restore();
  c.restore();

  // rim specular
  pathOf(c, [[50, 1], [94, 21], [94, 30], [50, 11], [6, 30], [6, 21]], true);
  c.fillStyle = 'rgba(255,255,255,0.42)';
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
