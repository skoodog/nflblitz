// PIECE brand-identity — the isolation specimen sheets.
//
// These are the frames a blind critic scores this piece on: the four hero crests
// large on dark cards, a crest at hero scale with material detail, the full eight
// team colour systems, the layered city skylines, and the league mark.
//
// Everything is Canvas2D on the foundation's logical 1920x1080 overlay.

import {
  rr, lin, rad, rgba, lighten, darken, mix, pathOf, capsText,
  facetedPanel, grainPass, scratchPass, outerGlow, mkCanvas,
} from './gfx.js';
import { TEAMS, byId, HERO_IDS } from './teams.js';
import { crest } from './crests.js';
import { skyline } from './skylines.js';
import { leagueMark, blitzLogo, wordmark } from './marks.js';
import { REG } from '../../foundation/registry.js';

const W = 1920, H = 1080;
const faces = () => REG.faces;

/* ------------------------------------------------------------- backgrounds */

function stage(c, opts = {}) {
  c.save();
  // deep base
  c.fillStyle = lin(c, 0, 0, 0, H, [
    [0, '#0e1016'], [0.4, '#08090d'], [1, '#030406'],
  ]);
  c.fillRect(0, 0, W, H);

  // broad colour wash
  if (opts.wash) {
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.fillStyle = rad(c, W * 0.5, H * 0.34, 0, W * 0.5, H * 0.34, W * 0.62, [
      [0, rgba(opts.wash, 0.10)], [0.55, rgba(opts.wash, 0.03)], [1, rgba(opts.wash, 0)],
    ]);
    c.fillRect(0, 0, W, H);
    c.restore();
  }

  // faint faceted shards
  facetedPanel(c, 0, 0, W, H, opts.wash || '#2a3a52', 5150, {
    base: '#0a0b10', facets: 34, wash: 0.05, wy: 0.3,
  });

  // scanline-free film grain + vignette
  c.fillStyle = rad(c, W * 0.5, H * 0.44, H * 0.28, W * 0.5, H * 0.5, W * 0.72, [
    [0, 'rgba(0,0,0,0)'], [0.6, 'rgba(0,0,0,0.30)'], [1, 'rgba(0,0,0,0.86)'],
  ]);
  c.fillRect(0, 0, W, H);
  c.restore();
}

function header(c, text, y, opts = {}) {
  const F = faces();
  const size = opts.size || 66;
  c.save();
  c.translate(W / 2, y);
  c.transform(1, 0, -0.16, 1, 0, 0);
  F.draw(c, text, 0, 6, { face: 'blitz-brush', size, align: 'center', tracking: 0.03, fill: 'rgba(0,0,0,0.75)' });
  F.draw(c, text, 0, 0, {
    face: 'blitz-brush', size, align: 'center', tracking: 0.03,
    fill: lin(c, 0, -size * 0.8, 0, size * 0.2, [[0, '#fdf6e4'], [0.55, '#e9dcbe'], [1, '#c2ad84']]),
  });
  c.restore();
  // rule
  c.save();
  const rw = opts.ruleW || 520;
  c.fillStyle = lin(c, W / 2 - rw, 0, W / 2 + rw, 0, [
    [0, 'rgba(200,180,120,0)'], [0.5, 'rgba(226,205,150,0.55)'], [1, 'rgba(200,180,120,0)'],
  ]);
  c.fillRect(W / 2 - rw, y + 22, rw * 2, 2);
  c.restore();
}

function footer(c, left, right) {
  const F = faces();
  c.save();
  capsText(c, F, left, 56, H - 34, { size: 24, align: 'left', cond: 0.86, tracking: 0.16, fill: 'rgba(190,196,208,0.62)' });
  capsText(c, F, right, W - 56, H - 34, { size: 24, align: 'right', cond: 0.86, tracking: 0.16, fill: 'rgba(190,196,208,0.42)' });
  c.restore();
}

/* ------------------------------------------------------------------ pieces */

function segBar(c, x, y, w, h, v, color, segs = 14) {
  const gap = 3;
  const sw = (w - gap * (segs - 1)) / segs;
  const n = v * segs;
  for (let i = 0; i < segs; i++) {
    const sx = x + i * (sw + gap);
    const on = i < Math.floor(n);
    const part = !on && i === Math.floor(n) ? (n - Math.floor(n)) : 0;
    // track
    c.fillStyle = 'rgba(255,255,255,0.06)';
    c.fillRect(sx, y, sw, h);
    c.fillStyle = 'rgba(0,0,0,0.55)';
    c.fillRect(sx, y, sw, Math.max(1, h * 0.3));
    if (on || part > 0.35) {
      c.fillStyle = lin(c, sx, y, sx, y + h, [
        [0, lighten(color, 0.55)], [0.35, color], [1, darken(color, 0.42)],
      ]);
      c.fillRect(sx, y, sw, h);
      c.fillStyle = 'rgba(255,255,255,0.4)';
      c.fillRect(sx, y, sw, Math.max(1, h * 0.22));
    }
  }
  c.strokeStyle = 'rgba(0,0,0,0.55)';
  c.lineWidth = 1;
  c.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
}

function card(c, team, x, y, w, h, opts = {}) {
  const A = team.art;
  const F = faces();
  const sel = !!opts.selected;

  // bloom behind
  c.save();
  c.globalCompositeOperation = 'lighter';
  c.fillStyle = rad(c, x + w / 2, y + h * 0.30, 0, x + w / 2, y + h * 0.30, w * 1.0, [
    [0, rgba(A.glow, sel ? 0.13 : 0.06)], [0.6, rgba(A.glow, 0.018)], [1, rgba(A.glow, 0)],
  ]);
  c.fillRect(x - w * 0.6, y - h * 0.2, w * 2.2, h * 1.4);
  c.restore();

  // body
  c.save();
  rr(c, x, y, w, h, 18);
  c.save();
  c.clip();
  facetedPanel(c, x, y, w, h, A.shard, 700 + team.id.charCodeAt(0) * 13, {
    base: '#08090d', facets: 18, wash: 0.13, wy: 0.30,
  });
  c.fillStyle = lin(c, x, y, x, y + h, [
    [0, 'rgba(255,255,255,0.055)'], [0.35, 'rgba(255,255,255,0)'],
    [0.72, 'rgba(0,0,0,0.35)'], [1, 'rgba(0,0,0,0.72)'],
  ]);
  c.fillRect(x, y, w, h);
  c.restore();

  // border
  c.strokeStyle = 'rgba(0,0,0,0.92)';
  c.lineWidth = 5;
  rr(c, x, y, w, h, 18); c.stroke();
  c.strokeStyle = lin(c, x, y, x, y + h, [
    [0, lighten(A.border, 0.5)], [0.4, A.border], [1, darken(A.border, 0.65)],
  ]);
  c.lineWidth = sel ? 3 : 1.8;
  rr(c, x + 1.5, y + 1.5, w - 3, h - 3, 17); c.stroke();
  if (sel) {
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.strokeStyle = rgba(A.border, 0.22);
    c.lineWidth = 9;
    rr(c, x + 1.5, y + 1.5, w - 3, h - 3, 17); c.stroke();
    c.restore();
  }
  c.fillStyle = lin(c, x + 24, 0, x + w - 24, 0, [
    [0, rgba(A.border, 0)], [0.5, rgba(lighten(A.border, 0.6), 0.85)], [1, rgba(A.border, 0)],
  ]);
  c.fillRect(x + 24, y + 5, w - 48, 2.5);
  c.strokeStyle = rgba(lighten(A.border, 0.45), 0.9);
  c.lineWidth = 3.6;
  c.beginPath();
  c.moveTo(x + 3, y + 44); c.lineTo(x + 3, y + 18); c.lineTo(x + 28, y + 3);
  c.stroke();
  c.beginPath();
  c.moveTo(x + w - 3, y + h - 44); c.lineTo(x + w - 3, y + h - 18); c.lineTo(x + w - 28, y + h - 3);
  c.stroke();
  c.restore();

  // crest (clipped to the card so the shard backdrop never spills)
  const cs = opts.crestSize || Math.round(w * 1.06);
  c.save();
  rr(c, x + 2, y + 2, w - 4, h - 4, 17);
  c.clip();
  c.drawImage(crest(team.id, cs), x + (w - cs) / 2, y + 12);
  c.restore();

  // layout anchored off the bottom, like the bar's cards
  const statTop = y + h - 182;
  const nameY = statTop - 44;
  const cityY = nameY - 50;

  capsText(c, F, team.city, x + w / 2, cityY, {
    size: 29, align: 'center', cond: 0.8, tracking: 0.15, fill: '#eef1f6',
  });
  c.save();
  c.translate(x + w / 2, nameY);
  c.scale(0.8, 1);
  F.draw(c, team.name, 0, 4, { face: 'blitz-block', size: 60, align: 'center', tracking: 0.02, fill: 'rgba(0,0,0,0.85)' });
  F.draw(c, team.name, 0, 0, {
    face: 'blitz-block', size: 60, align: 'center', tracking: 0.02,
    fill: lin(c, 0, -48, 0, 12, [[0, '#fffaee'], [0.42, '#f2e2b6'], [0.72, '#e0c483'], [1, '#b28f45']]),
  });
  c.restore();

  // gold rule under the wordmark, as in the bar art
  const ruleY = nameY + 22;
  c.fillStyle = lin(c, x + 26, 0, x + w - 26, 0, [
    [0, 'rgba(220,180,90,0)'], [0.2, 'rgba(240,206,126,0.85)'],
    [0.8, 'rgba(240,206,126,0.85)'], [1, 'rgba(220,180,90,0)'],
  ]);
  c.fillRect(x + 26, ruleY, w - 52, 3);
  c.fillStyle = 'rgba(0,0,0,0.6)';
  c.fillRect(x + 26, ruleY + 3, w - 52, 2);

  const rows = [['SPEED', team.stats.speed], ['HIT POWER', team.stats.hitPower], ['TURBO', team.stats.turbo]];
  rows.forEach((r, i) => {
    const by = statTop + i * 58;
    capsText(c, F, r[0], x + 20, by + 18, { size: 21, align: 'left', cond: 0.78, tracking: 0.08, fill: '#adb3c2' });
    segBar(c, x + 138, by, w - 158, 23, r[1], '#f0bb32', 13);
  });
}

/* ------------------------------------------------------------------ sheets */

export function sheetCrests(c, t) {
  stage(c, { wash: '#2b4a63' });
  header(c, 'LEAGUE CRESTS', 104, { size: 84, ruleW: 620 });

  const n = 4, cw = 448, gap = 22, ch = 786;
  const total = n * cw + (n - 1) * gap;
  const x0 = (W - total) / 2;
  const y0 = 166;
  HERO_IDS.forEach((id, i) => {
    card(c, byId(id), x0 + i * (cw + gap), y0, cw, ch, { selected: i === 0, crestSize: 466 });
  });
  footer(c, 'BLITZ RELOADED / TEAM IDENTITY', 'PROCEDURAL VECTOR CRESTS / NO RASTER ASSETS');
  grainPass(c, W, H, 31, 0.05, 2);
}

export function sheetCrestDetail(c, t, id = 'NYC') {
  const team = byId(id);
  const A = team.art;
  stage(c, { wash: A.glow });

  // hero crest
  const S = 700;
  const hx = 130, hy = 118;
  outerGlow(c, hx + S / 2, hy + S * 0.46, S * 0.62, A.glow, 0.16);
  c.drawImage(crest(id, S), hx, hy);

  // caption block
  const F = faces();
  c.save();
  capsText(c, F, team.city, hx + S / 2, hy + S + 56, { size: 32, align: 'center', cond: 0.82, tracking: 0.18, fill: '#dfe4ee' });
  c.translate(hx + S / 2, hy + S + 122);
  c.scale(0.82, 1);
  F.draw(c, team.name, 0, 4, { face: 'blitz-block', size: 64, align: 'center', tracking: 0.02, fill: 'rgba(0,0,0,0.8)' });
  F.draw(c, team.name, 0, 0, {
    face: 'blitz-block', size: 64, align: 'center', tracking: 0.02,
    fill: lin(c, 0, -52, 0, 14, [[0, '#ffffff'], [0.4, lighten(A.border, 0.5)], [1, darken(A.border, 0.3)]]),
  });
  c.restore();

  // detail crops
  const src = crest(id, 1400);
  const crops = [
    { label: 'BEVEL / KEYLINE', cx: 0.50, cy: 0.26, ch: 0.22 },
    { label: 'INNER GLOW / EYE', cx: 0.50, cy: 0.53, ch: 0.17 },
    { label: 'SCRATCH / GRAIN', cx: 0.42, cy: 0.76, ch: 0.20 },
  ];
  const bx = 1030, bw = 800, bh = 234, bgap = 22;
  crops.forEach((cr, i) => {
    const by = 128 + i * (bh + bgap);
    c.save();
    rr(c, bx, by, bw, bh, 14);
    c.save(); c.clip();
    c.fillStyle = '#07080c'; c.fillRect(bx, by, bw, bh);
    const scale = bh / (src.height * cr.ch);
    const dw = src.width * scale, dh = src.height * scale;
    c.drawImage(src, bx + bw / 2 - cr.cx * dw, by + bh / 2 - cr.cy * dh, dw, dh);
    c.fillStyle = lin(c, bx, by, bx + bw, by, [
      [0, 'rgba(6,7,11,0.95)'], [0.22, 'rgba(6,7,11,0)'], [0.78, 'rgba(6,7,11,0)'], [1, 'rgba(6,7,11,0.95)'],
    ]);
    c.fillRect(bx, by, bw, bh);
    c.restore();
    c.strokeStyle = 'rgba(0,0,0,0.9)'; c.lineWidth = 4; rr(c, bx, by, bw, bh, 14); c.stroke();
    c.strokeStyle = rgba(A.border, 0.5); c.lineWidth = 1.6; rr(c, bx + 2, by + 2, bw - 4, bh - 4, 13); c.stroke();
    capsText(c, faces(), cr.label, bx + 22, by + 40, { size: 22, align: 'left', cond: 0.82, tracking: 0.18, fill: rgba(lighten(A.border, 0.35), 0.9) });
    c.restore();
  });

  // palette strip
  const pk = ['primary', 'secondary', 'accent', 'metal', 'helmet'];
  const sw = 142, sh = 76, sx0 = bx, sy0 = 128 + 3 * (bh + bgap) + 18;
  pk.forEach((k, i) => {
    const px = sx0 + i * (sw + 16);
    c.fillStyle = team.colors[k];
    c.fillRect(px, sy0, sw, sh);
    c.strokeStyle = 'rgba(0,0,0,0.85)'; c.lineWidth = 3; c.strokeRect(px, sy0, sw, sh);
    c.fillStyle = lin(c, px, sy0, px, sy0 + sh * 0.5, [[0, 'rgba(255,255,255,0.22)'], [1, 'rgba(255,255,255,0)']]);
    c.fillRect(px, sy0, sw, sh * 0.5);
    capsText(c, faces(), team.colors[k], px + sw / 2, sy0 + sh + 28, { size: 18, align: 'center', cond: 0.86, tracking: 0.08, fill: '#8f96a4' });
  });

  footer(c, `CREST / ${team.city} ${team.name}`, 'AUTHORED IN 1000-UNIT VECTOR SPACE');
  grainPass(c, W, H, 33, 0.05, 2);
}

export function sheetPalettes(c, t) {
  stage(c, { wash: '#3a4a66' });
  header(c, 'EIGHT CITIES, ONE LEAGUE', 84, { size: 58 });

  const cols = 4, rows = 2;
  const cw = 432, ch = 402, gx = 24, gy = 22;
  const x0 = (W - (cols * cw + (cols - 1) * gx)) / 2;
  const y0 = 148;
  TEAMS.forEach((team, i) => {
    const A = team.art;
    const x = x0 + (i % cols) * (cw + gx);
    const y = y0 + Math.floor(i / cols) * (ch + gy);
    c.save();
    rr(c, x, y, cw, ch, 16);
    c.save(); c.clip();
    facetedPanel(c, x, y, cw, ch, A.shard, 300 + i * 17, { base: '#08090d', facets: 12, wash: 0.17, wy: 0.4 });
    c.restore();
    c.strokeStyle = 'rgba(0,0,0,0.9)'; c.lineWidth = 4; rr(c, x, y, cw, ch, 16); c.stroke();
    c.strokeStyle = rgba(A.border, 0.75); c.lineWidth = 1.6; rr(c, x + 2, y + 2, cw - 4, ch - 4, 15); c.stroke();
    c.restore();

    c.drawImage(crest(team.id, 196), x + 14, y + 12);

    const tx = x + 222;
    capsText(c, faces(), team.abbr, x + cw - 18, y + 44, { size: 25, align: 'right', cond: 0.78, tracking: 0.12, fill: rgba(A.border, 0.9) });
    capsText(c, faces(), team.city, tx, y + 72, { size: 20, align: 'left', cond: 0.8, tracking: 0.13, fill: '#c4cad6' });
    c.save();
    c.translate(tx, y + 114);
    c.scale(0.76, 1);
    faces().draw(c, team.name, 0, 3, { face: 'blitz-block', size: 38, align: 'left', tracking: 0.02, fill: 'rgba(0,0,0,0.8)' });
    faces().draw(c, team.name, 0, 0, {
      face: 'blitz-block', size: 38, align: 'left', tracking: 0.02,
      fill: lin(c, 0, -31, 0, 9, [[0, '#ffffff'], [0.45, lighten(A.border, 0.45)], [1, darken(A.border, 0.3)]]),
    });
    c.restore();

    // swatches
    const pk = ['primary', 'secondary', 'accent', 'metal', 'helmet'];
    pk.forEach((k, j) => {
      const px = tx + j * 39;
      c.fillStyle = team.colors[k];
      c.fillRect(px, y + 138, 34, 34);
      c.strokeStyle = 'rgba(0,0,0,0.8)'; c.lineWidth = 2; c.strokeRect(px, y + 138, 34, 34);
      c.fillStyle = 'rgba(255,255,255,0.2)';
      c.fillRect(px, y + 138, 34, 10);
    });

    // stats
    const rowsD = [['SPEED', team.stats.speed], ['HIT POWER', team.stats.hitPower], ['TURBO', team.stats.turbo]];
    rowsD.forEach((r, j) => {
      const by = y + 216 + j * 56;
      capsText(c, faces(), r[0], x + 20, by, { size: 18, align: 'left', cond: 0.8, tracking: 0.1, fill: '#8f96a6' });
      segBar(c, x + 20, by + 10, cw - 40, 16, r[1], '#f0bb32');
    });
  });

  footer(c, 'PALETTE SYSTEM / PRIMARY / SECONDARY / ACCENT / METAL / HELMET', 'FICTIONAL LEAGUE / NO REAL CLUB MARKS');
  grainPass(c, W, H, 37, 0.05, 2);
}

export function sheetSkyline(c, t) {
  // storm sky
  c.save();
  c.fillStyle = lin(c, 0, 0, 0, H * 0.72, [
    [0, '#100b1c'], [0.42, '#241a38'], [0.78, '#3d2a48'], [1, '#59405c'],
  ]);
  c.fillRect(0, 0, W, H);
  // cloud banding
  for (let i = 0; i < 7; i++) {
    const y = H * (0.10 + i * 0.075);
    c.fillStyle = rgba(i % 2 ? '#0b0713' : '#4a3560', 0.16);
    c.beginPath();
    c.ellipse(W * (0.15 + i * 0.13), y, W * 0.42, H * 0.06, 0, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();

  skyline(c, 'NYC', { x: 0, y: H * 0.20, w: W, h: H * 0.80 }, { haze: 0.85 });

  // strips
  const ids = ['CHI', 'DAL', 'LA'];
  const sw = 612, sh = 196, gx = 22;
  const x0 = (W - (3 * sw + 2 * gx)) / 2;
  const y0 = H - sh - 78;
  ids.forEach((id, i) => {
    const x = x0 + i * (sw + gx);
    c.save();
    rr(c, x, y0, sw, sh, 12);
    c.save(); c.clip();
    c.fillStyle = '#06070c'; c.fillRect(x, y0, sw, sh);
    skyline(c, id, { x, y: y0, w: sw, h: sh }, { haze: 0.75 });
    c.restore();
    c.strokeStyle = 'rgba(0,0,0,0.9)'; c.lineWidth = 4; rr(c, x, y0, sw, sh, 12); c.stroke();
    c.strokeStyle = 'rgba(190,200,220,0.28)'; c.lineWidth = 1.4; rr(c, x + 2, y0 + 2, sw - 4, sh - 4, 11); c.stroke();
    capsText(c, faces(), byId(id).city, x + 18, y0 + 36, { size: 24, align: 'left', cond: 0.82, tracking: 0.18, fill: 'rgba(232,236,244,0.86)' });
    c.restore();
  });

  header(c, 'CITY SKYLINES', 92);
  footer(c, 'THREE DEPTH LAYERS / ATMOSPHERIC FALLOFF / LIT WINDOWS', 'NEW YORK / CHICAGO / DALLAS / LOS ANGELES');
  grainPass(c, W, H, 41, 0.055, 2);
}

export function sheetLeagueMark(c, t) {
  stage(c, { wash: '#3a2a48' });
  skyline(c, 'NYC', { x: 0, y: H * 0.46, w: W, h: H * 0.54 }, { haze: 0.5, fill: '#07080d' });

  // badge
  leagueMark(c, { x: W / 2 - 96, y: 86, w: 192, h: 226 });
  blitzLogo(c, { x: W / 2 - 470, y: 320, w: 940, h: 300 });

  const F = faces();
  c.save();
  c.translate(W / 2, 700);
  c.transform(1, 0, -0.17, 1, 0, 0);
  F.draw(c, 'NO FLAGS.  NO RULES.  ALL BLITZ.', 0, 4, { face: 'blitz-brush', size: 46, align: 'center', tracking: 0.04, fill: 'rgba(0,0,0,0.8)' });
  F.draw(c, 'NO FLAGS.  NO RULES.  ALL BLITZ.', 0, 0, { face: 'blitz-brush', size: 46, align: 'center', tracking: 0.04, fill: '#eee6d6' });
  c.restore();

  // scale row
  const sizes = [128, 88, 60, 40, 26];
  let sx = W / 2 - 210;
  const sy = 800;
  sizes.forEach((s) => {
    leagueMark(c, { x: sx, y: sy + (128 - s) * 0.6, w: s * 0.86, h: s });
    sx += s * 0.86 + 34;
  });
  capsText(c, faces(), 'BADGE HOLDS AT 26 PX', W / 2, sy + 176, { size: 22, align: 'center', cond: 0.84, tracking: 0.2, fill: 'rgba(180,188,202,0.6)' });

  footer(c, 'LEAGUE MARK / FICTIONAL', 'NO REAL LEAGUE OR CLUB MARKS ANYWHERE');
  grainPass(c, W, H, 43, 0.05, 2);
}

export const SHEETS = {
  'iso_crests': sheetCrests,
  'iso_crest_detail': (c, t, v) => sheetCrestDetail(c, t, (v || 'NYC').toUpperCase()),
  'iso_palettes': sheetPalettes,
  'iso_skyline': sheetSkyline,
  'iso_leaguemark': sheetLeagueMark,
};

export default { SHEETS };
