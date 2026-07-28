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
  // faint field striping so the sheet is not a flat card
  c.save();
  c.globalAlpha = 0.016;
  c.fillStyle = '#7fe08a';
  for (let i = 0; i < 22; i += 2) c.fillRect(0, H * 0.52 + i * 24, W, 24);
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
  clock: ':15', dist: '2ND', yards: '250', quarter: '2ND', timeouts: 3,
  teamA: 'NYC', teamB: 'CHI', scoreA: 22, scoreB: 14,
  momA: 0.62, momB: 0.4, possess: 0,
};

function put(c, ui, x, y, o, k) {
  S.clock = o.clock; S.dist = o.dist; S.yards = o.yards;
  S.quarter = o.q || '2ND'; S.timeouts = o.to === undefined ? 3 : o.to;
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
    { clock: ':15', dist: '2ND', yards: '250', q: '2ND', to: 3, a: 'NYC', b: 'CHI', sa: 22, sb: 14, ma: 0.62, mb: 0.40, p: 0, n: 'NYC 22 - CHI 14  ·  2ND & 250  ·  POSSESSION LEFT' },
    { clock: ':09', dist: '1ST', yards: '10', q: '3RD', to: 2, a: 'DAL', b: 'LA', sa: 28, sb: 21, ma: 0.72, mb: 0.31, p: 1, n: 'DAL 28 - LA 21  ·  1ST & 10  ·  POSSESSION RIGHT' },
    { clock: '2:04', dist: '4TH', yards: 'GL', q: '4TH', to: 1, a: 'SEA', b: 'MIA', sa: 6, sb: 3, ma: 0.18, mb: 0.94, p: 1, n: 'LONG CLOCK  ·  SINGLE-DIGIT SCORES  ·  MOMENTUM SWUNG RIGHT' },
    { clock: ':02', dist: '3RD', yards: '1', q: 'OT', to: 0, a: 'BAL', b: 'PHI', sa: 105, sb: 98, ma: 1.0, mb: 0.06, p: 0, n: 'THREE-DIGIT SCORES  ·  FULL AND NEAR-EMPTY METERS  ·  NO TIMEOUTS' },
  ];

  let y = 118;
  for (const r of rows) {
    put(c, ui, 48, y, r);
    label(c, ui, r.n, 52, y + 132, 18);
    y += 168;
  }

  // over bright: the plate has to hold over a blown-out sideline light too
  const by = 806;
  const bx = 24, bw = 700, bh = 154;
  const bg = c.createLinearGradient(0, by - 18, 0, by - 18 + bh);
  bg.addColorStop(0, '#c9d2da');
  bg.addColorStop(0.45, '#f4f7fa');
  bg.addColorStop(1, '#8e9ba8');
  c.fillStyle = bg;
  c.fillRect(bx, by - 18, bw, bh);
  c.fillStyle = 'rgba(255,255,255,0.65)';
  c.fillRect(bx, by - 18, bw, 3);
  put(c, ui, 48, by, rows[0]);
  label(c, ui, 'COMPOSITED OVER A BLOWN-OUT FRAME', 52, by + 132, 18);

  // 2x detail — genuinely re-rendered at double resolution, then hard-clipped
  const dx = 760, dy = 118, dw = ui.W - dx - 40, dh = 330;
  label(c, ui, '2X DETAIL  ·  BEVEL / GRAIN / MOMENTUM GLOSS / CREST CHIP', dx, dy - 16, 18, 'rgba(232,186,90,0.92)');
  c.save();
  c.beginPath();
  c.rect(dx, dy, dw, dh);
  c.clip();
  put(c, ui, dx + 4, dy + 12, rows[0], 2);
  c.restore();
  c.strokeStyle = 'rgba(150,180,222,0.30)';
  c.lineWidth = 1;
  c.strokeRect(dx + 0.5, dy + 0.5, dw, dh);

  const ex = 760, ey = 512;
  label(c, ui, 'GEOMETRY, MEASURED OFF BAR/PANEL-QB_DROPBACK.PNG AT 3.195 LOGICAL PX PER PANEL PX', ex, ey, 18, 'rgba(232,186,90,0.92)');
  const facts = [
    'PLATE          48, 42     640 X 106      LEFT EDGE == UI.SAFE.L',
    'CLOCK INK      REL 51..118      INK HEIGHT 58',
    'DOWN + DIST    REL 54..137      INK HEIGHT 26      ORDINAL RAISED',
    'ABBREVIATION   REL 134..204     INK HEIGHT 38      BLITZ-BLOCK',
    'SCORE          REL 236..332     INK HEIGHT 61      BLITZ-NUM',
    'MOMENTUM       REL Y 86..97     SPLIT AT THE CELL GAP',
    'TURBO PLATE    48, 954   306 X 82        POLYGON, NOT A ROUNDED RECT',
  ];
  for (let i = 0; i < facts.length; i++) label(c, ui, facts[i], ex, ey + 40 + i * 30, 19, 'rgba(158,184,216,0.85)');

  TURBO.bake(ui, 1);
  TURBO.draw(c, TURBO.ORIGIN.x + 712, TURBO.ORIGIN.y - 26, 0.72, t, 1);
  label(c, ui, 'TURBO 72%  ·  SEE ISO_TURBO FOR THE FULL LADDER', 1090, 1002, 18);

  HUD.invalidate();
}

/* ----------------------------------------------------------- turbo sheet */

export function drawTurbo(c, t, state, ui) {
  backdrop(c, ui, 'rgba(40,72,150,0.30)');
  header(c, ui, 'TURBO METER', 'SILHOUETTE / ANODISED BEVEL / SEGMENTED GLOSS FILL / HOT EDGE');

  TURBO.bake(ui, 1);
  const fills = [0, 0.14, 0.33, 0.55, 0.78, 0.93, 1.0];
  const notes = [
    'EMPTY WELL — NEAR-BLACK TRACK, NO FILL',
    'FIRST SEGMENT ONLY',
    'HOT LEADING EDGE RIDES THE BOUNDARY',
    'SPECULAR BAND RUNS THE LENGTH OF THE FILL',
    '',
    'FILL REACHES INTO THE SPUR',
    'CHARGED — THE BAR BREATHES INSTEAD OF SHOWING AN EDGE',
  ];
  let y = 122;
  for (let i = 0; i < fills.length; i++) {
    TURBO.draw(c, TURBO.ORIGIN.x, y - TURBO.BOX.mg, fills[i], t, 1);
    label(c, ui, `${Math.round(fills[i] * 100)}%`, 372, y + 54, 22, 'rgba(198,220,248,0.95)');
    if (notes[i]) label(c, ui, notes[i], 436, y + 54, 18);
    y += 108;
  }

  const dx = 900;
  label(c, ui, '2X DETAIL  ·  BEVEL, GLOSS, SPUR, TYPE', dx, 122, 19, 'rgba(232,186,90,0.92)');
  TURBO.bake(ui, 2);
  TURBO.draw(c, dx - TURBO.BOX.mg * 2, 148 - TURBO.BOX.mg * 2, 0.62, t, 2);
  label(c, ui, 'AT 62%  ·  FOUR SEGMENTS, SPECULAR BAND, WHITE-HOT EDGE', dx, 348, 18);
  TURBO.draw(c, dx - TURBO.BOX.mg * 2, 420 - TURBO.BOX.mg * 2, 1.0, t, 2);
  label(c, ui, 'AT 100%  ·  OVERCHARGE PULSE, NO EDGE', dx, 620, 18);
  TURBO.draw(c, dx - TURBO.BOX.mg * 2, 692 - TURBO.BOX.mg * 2, 0.0, t, 2);
  label(c, ui, 'AT 0%  ·  THE WELL, THE ANODISED FRAME AND THE TYPE ALONE', dx, 892, 18);

  label(c, ui,
    'PLATE 306 X 82 AT 48,954 LOGICAL  ·  LEFT EDGE LEANS BACK, TOP-RIGHT CHOPPED, THE FILL RUNS OUT INTO THE SPUR',
    48, ui.H - 34, 19, 'rgba(120,148,184,0.85)');

  TURBO.bake(ui, 1);
}

export default { drawStates, drawTurbo };
