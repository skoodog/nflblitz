// PIECE hud-overlay — the two piece-owned proof sheets.
//
// iso_hud_states  : the cluster in five real game states, over dark AND over a
//                   bright blown-out plate, plus a 2x re-rendered detail crop.
// iso_turbo       : the meter at seven fills including empty and charged, plus a
//                   2x crop of the bevel, the gloss and the leading edge.
//
// These exist so a critic can score exactly this piece without a neighbour's
// work in the frame. Everything is a pure function of (state, t, ui).

import * as HUD from './hud.js';
import * as TURBO from './turbo.js';
import { vgrad, rgba } from './chrome.js';

function backdrop(c, ui, seedTint) {
  const W = ui.W, H = ui.H;
  c.fillStyle = vgrad(c, 0, H, [
    [0, '#12161e'],
    [0.42, '#0b0e14'],
    [1, '#05070b'],
  ]);
  c.fillRect(0, 0, W, H);
  const g = c.createRadialGradient(W * 0.5, H * 0.16, 40, W * 0.5, H * 0.16, W * 0.7);
  g.addColorStop(0, seedTint || 'rgba(60,86,130,0.24)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  // faint field striping so the sheet is not a flat grey card
  c.save();
  c.globalAlpha = 0.05;
  c.fillStyle = '#7fe08a';
  for (let i = 0; i < 22; i += 2) c.fillRect(0, H * 0.55 + i * 22, W, 22);
  c.restore();
}

function label(c, ui, txt, x, y, size, fill) {
  ui.faces.draw(c, txt, x, y, {
    face: 'blitz-block', size: size || 19, fill: fill || 'rgba(150,176,210,0.82)',
    tracking: 0.08, grain: 0,
  });
}

function header(c, ui, title, right) {
  c.fillStyle = vgrad(c, 0, 78, [[0, 'rgba(24,32,46,0.98)'], [1, 'rgba(8,11,17,0.98)']]);
  c.fillRect(0, 0, ui.W, 78);
  c.fillStyle = 'rgba(200,60,60,0.95)';
  c.beginPath();
  c.moveTo(0, 0); c.lineTo(120, 0); c.lineTo(92, 78); c.lineTo(0, 78); c.closePath();
  c.fill();
  c.fillStyle = 'rgba(150,180,222,0.28)';
  c.fillRect(0, 77, ui.W, 1.4);
  ui.faces.draw(c, title, 148, 52, { face: 'blitz-block', size: 30, fill: '#e9eef6', tracking: 0.10, grain: 0 });
  ui.faces.draw(c, right, ui.W - 48, 50, { face: 'blitz-block', size: 19, align: 'right', fill: 'rgba(140,178,224,0.85)', tracking: 0.10, grain: 0 });
}

const S = {
  clock: ':15', dist: '2ND', yards: '250',
  teamA: 'NYC', teamB: 'CHI', scoreA: 22, scoreB: 14,
  momA: 0.62, momB: 0.4, possess: 0,
};

function put(c, ui, x, y, o, k) {
  S.clock = o.clock; S.dist = o.dist; S.yards = o.yards;
  S.teamA = o.a; S.teamB = o.b; S.scoreA = o.sa; S.scoreB = o.sb;
  S.momA = o.ma; S.momB = o.mb; S.possess = o.p;
  HUD.bake(ui, S, k || 1);
  const cv = HUD.canvas();
  c.drawImage(cv, x - HUD.BOX.mg * (k || 1), y - HUD.BOX.mg * (k || 1), HUD.BOX.w * (k || 1), HUD.BOX.h * (k || 1));
}

/* ------------------------------------------------------------ hud states */

export function drawStates(c, t, state, ui) {
  backdrop(c, ui, 'rgba(52,80,124,0.28)');
  header(c, ui, 'IN-GAME HUD CLUSTER', 'SCOREBOARD / DOWN + DISTANCE / MOMENTUM / POSSESSION');

  const rows = [
    { clock: ':15', dist: '2ND', yards: '250', a: 'NYC', b: 'CHI', sa: 22, sb: 14, ma: 0.62, mb: 0.40, p: 0, n: 'NYC 22 - CHI 14   2ND & 250   POSSESSION LEFT' },
    { clock: ':09', dist: '1ST', yards: '10', a: 'DAL', b: 'LA', sa: 28, sb: 21, ma: 0.72, mb: 0.31, p: 1, n: 'DAL 28 - LA 21   1ST & 10   POSSESSION RIGHT' },
    { clock: '2:04', dist: '4TH', yards: 'GOAL', a: 'SEA', b: 'MIA', sa: 6, sb: 3, ma: 0.18, mb: 0.94, p: 1, n: 'LONG CLOCK / SINGLE DIGIT SCORES / MOMENTUM SWING' },
    { clock: ':02', dist: '3RD', yards: '1', a: 'BAL', b: 'PHI', sa: 105, sb: 98, ma: 1.0, mb: 0.06, p: 0, n: 'THREE-DIGIT SCORES / FULL AND NEAR-EMPTY METERS' },
  ];

  let y = 132;
  for (const r of rows) {
    put(c, ui, 48, y, r);
    label(c, ui, r.n, 716, y + 62, 19);
    y += 150;
  }

  // over bright: the HUD has to survive a blown-out sideline light too
  const by = 738;
  const bg = c.createLinearGradient(0, by - 16, 0, by + 146);
  bg.addColorStop(0, '#d8dfe6');
  bg.addColorStop(0.5, '#f2f5f8');
  bg.addColorStop(1, '#9aa6b2');
  c.fillStyle = bg;
  c.fillRect(24, by - 16, 700, 162);
  c.fillStyle = 'rgba(255,255,255,0.6)';
  c.fillRect(24, by - 16, 700, 3);
  put(c, ui, 48, by, rows[0]);
  label(c, ui, 'COMPOSITED OVER A BLOWN-OUT FRAME', 748, by + 62, 19);

  // 2x detail — re-rendered at double resolution, not an upscaled blit
  const dx = 748, dy = 132;
  label(c, ui, '2x DETAIL  ·  BEVEL / GRAIN / MOMENTUM GLOSS / CREST CHIP', dx, dy - 14, 18, 'rgba(232,186,90,0.9)');
  c.save();
  c.beginPath();
  c.rect(dx, dy, ui.W - dx - 48, 212);
  c.clip();
  put(c, ui, dx - 8, dy - 12, rows[0], 2);
  c.restore();
  c.strokeStyle = 'rgba(150,180,222,0.28)';
  c.lineWidth = 1;
  c.strokeRect(dx + 0.5, dy + 0.5, ui.W - dx - 48, 212);

  // measured-geometry callout
  label(c, ui, 'PLATE 640 x 106 AT 48,42 LOGICAL  ·  MEASURED OFF PANEL-QB_DROPBACK AT 3.195 PX / LOGICAL', 48, ui.H - 34, 19, 'rgba(120,148,184,0.8)');

  TURBO.bake(ui, 1);
  TURBO.draw(c, TURBO.ORIGIN.x + 760, TURBO.ORIGIN.y - 18, 0.72, t, 1);
  label(c, ui, 'TURBO 72%', 1130, 1000, 19);

  HUD.invalidate();
}

/* ----------------------------------------------------------- turbo sheet */

export function drawTurbo(c, t, state, ui) {
  backdrop(c, ui, 'rgba(40,72,150,0.30)');
  header(c, ui, 'TURBO METER', 'SILHOUETTE / ANODISED BEVEL / SEGMENTED GLOSS FILL / HOT EDGE');

  TURBO.bake(ui, 1);
  const fills = [0, 0.14, 0.33, 0.55, 0.78, 0.93, 1.0];
  let y = 118;
  for (let i = 0; i < fills.length; i++) {
    TURBO.draw(c, TURBO.ORIGIN.x, y - TURBO.BOX.mg, fills[i], t, 1);
    label(c, ui, `${Math.round(fills[i] * 100)}%`, 372, y + 54, 22, 'rgba(190,214,244,0.9)');
    y += 100;
  }
  label(c, ui, 'EMPTY WELL', 448, 172, 19);
  label(c, ui, 'SEGMENT DIVIDERS AND HOT LEADING EDGE TRACK THE FILL', 448, 372, 19);
  label(c, ui, 'CHARGED: THE BAR BREATHES INSTEAD OF SHOWING AN EDGE', 448, 772, 19);

  // 2x detail
  const dx = 900, dy = 150;
  label(c, ui, '2x DETAIL  ·  BEVEL, GLOSS, SPUR, TYPE', dx, dy - 16, 19, 'rgba(232,186,90,0.9)');
  TURBO.bake(ui, 2);
  TURBO.draw(c, dx - TURBO.BOX.mg * 2, dy - TURBO.BOX.mg * 2, 0.62, t, 2);
  TURBO.draw(c, dx - TURBO.BOX.mg * 2, dy + 240 - TURBO.BOX.mg * 2, 1.0, t, 2);
  label(c, ui, 'AT 62% — SEGMENTS, SPECULAR BAND, WHITE-HOT EDGE', dx, dy + 210, 19);
  label(c, ui, 'AT 100% — OVERCHARGE PULSE', dx, dy + 450, 19);

  label(c, ui, 'PLATE 306 x 82 AT 48,954 LOGICAL  ·  LEFT EDGE LEANS BACK, TOP-RIGHT CHOPPED, FILL RUNS OUT INTO THE SPUR',
    48, ui.H - 34, 19, 'rgba(120,148,184,0.8)');

  TURBO.bake(ui, 1);
}

export default { drawStates, drawTurbo };
