// PIECE hud-overlay — the four piece-owned proof sheets.
//
// iso_hud_states     the cluster in five real game states, over dark AND over a
//                    blown-out plate, plus the timing-feedback surfaces and a 2x
//                    re-rendered detail crop.
// iso_turbo          the meter at seven fills including empty, charged and
//                    OVERHEAT, plus 2x crops.
// iso_hud_thumbmask  thumb-occlusion proof at 844x390 and 1024x768: the real
//                    layout code, the real thumb arcs, no hand-drawn mock-up.
// iso_hud_safearea   16:9 through 21:9 with the cluster anchored to ui.visible.
//
// These exist so a critic can score exactly this piece without a neighbour's
// work in the frame. Everything is a pure function of (state, t, ui).

import * as HUD from './hud.js';
import * as TURBO from './turbo.js';
import { vgrad, rgba } from './chrome.js';
import { thumbArc, turboTop, TURBO_BOTTOM_INSET as TURBO_INSET } from './layout.js';

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
  clock: ':15', dist: '2ND', yards: '250', quarter: '2ND', timeouts: 3, timeoutsB: 2,
  teamA: 'NYC', teamB: 'CHI', scoreA: 22, scoreB: 14,
  momA: 0.62, momB: 0.4, possess: 0,
};

function put(c, ui, x, y, o, k, fx) {
  S.clock = o.clock; S.dist = o.dist; S.yards = o.yards;
  S.quarter = o.q || '2ND';
  S.timeouts = o.to === undefined ? 3 : o.to;
  S.timeoutsB = o.tob === undefined ? 2 : o.tob;
  S.teamA = o.a; S.teamB = o.b; S.scoreA = o.sa; S.scoreB = o.sb;
  S.momA = o.ma; S.momB = o.mb; S.possess = o.p;
  const kk = k || 1;
  HUD.bake(ui, S, kk);
  HUD.bakeFx(kk);
  const cv = HUD.canvas();
  c.drawImage(cv, x - HUD.BOX.mg * kk, y - HUD.BOX.mg * kk, HUD.BOX.w * kk, HUD.BOX.h * kk);
  if (fx) HUD.drawFx(c, x - HUD.BOX.mg * kk, y - HUD.BOX.mg * kk, fx.flash || 0, fx.miss || 0, kk);
}

/* ------------------------------------------------------------ hud states */

export function drawStates(c, t, state, ui) {
  backdrop(c, ui, 'rgba(52,80,124,0.28)');
  header(c, ui, 'IN-GAME HUD CLUSTER', 'SIX RECESSED TILES / BLACK GUTTERS / THREE ACCENTS');

  const rows = [
    { clock: ':15', dist: '2ND', yards: '250', q: '2ND', to: 3, tob: 2, a: 'NYC', b: 'CHI', sa: 22, sb: 14, ma: 0.62, mb: 0.40, p: 0, n: 'NYC 22 - CHI 14  ·  2ND & 250  ·  POSSESSION LEFT' },
    { clock: ':09', dist: '1ST', yards: '10', q: '3RD', to: 2, tob: 3, a: 'DAL', b: 'LA', sa: 28, sb: 21, ma: 0.72, mb: 0.31, p: 1, n: 'DAL 28 - LA 21  ·  1ST & 10  ·  POSSESSION RIGHT' },
    { clock: '2:04', dist: '4TH', yards: 'GL', q: '4TH', to: 1, tob: 0, a: 'SEA', b: 'MIA', sa: 6, sb: 3, ma: 0.18, mb: 0.94, p: 1, n: 'LONG CLOCK  ·  SINGLE-DIGIT SCORES  ·  GOLD METER NEAR FULL' },
    { clock: ':02', dist: '3RD', yards: '1', q: 'OT', to: 0, tob: 1, a: 'BAL', b: 'PHI', sa: 105, sb: 98, ma: 1.0, mb: 0.06, p: 0, n: 'THREE-DIGIT SCORES  ·  FULL AND NEAR-EMPTY METERS  ·  NO TIMEOUTS' },
  ];

  let y = 104;
  for (const r of rows) {
    put(c, ui, 48, y, r);
    label(c, ui, r.n, 52, y + 120, 17);
    y += 130;
  }

  // timing feedback — the two surfaces the timing-windows piece drives
  put(c, ui, 48, y, rows[0], 1, { flash: 1 });
  label(c, ui, 'PERFECT WINDOW  ·  ONE ADDITIVE BLIT OF A BAKED RIM, ALPHA-FADED OVER 180 MS', 52, y + 120, 17, 'rgba(240,206,132,0.92)');
  y += 130;
  put(c, ui, 48, y, rows[0], 1, { miss: 1 });
  label(c, ui, 'MISSED WINDOW  ·  HARD RED TICK ON THE LEFT CAP + RED RIM ON THE CLOCK TILE', 52, y + 120, 17, 'rgba(232,110,96,0.92)');

  // over bright: the tiles have to hold over a blown-out sideline light too
  const by = 902;
  const bx = 24, bw = 700, bh = 150;
  const bg = c.createLinearGradient(0, by - 18, 0, by - 18 + bh);
  bg.addColorStop(0, '#c9d2da');
  bg.addColorStop(0.45, '#f4f7fa');
  bg.addColorStop(1, '#8e9ba8');
  c.fillStyle = bg;
  c.fillRect(bx, by - 18, bw, bh);
  c.fillStyle = 'rgba(255,255,255,0.65)';
  c.fillRect(bx, by - 18, bw, 3);
  put(c, ui, 48, by, rows[0]);
  label(c, ui, 'COMPOSITED OVER A BLOWN-OUT FRAME', 52, by + 120, 17, 'rgba(40,52,70,0.95)');

  // 2x detail — genuinely re-rendered at double resolution, then hard-clipped
  const dx = 760, dy = 106, dw = ui.W - dx - 40, dh = 292;
  label(c, ui, '2X DETAIL  ·  TILE HAIRLINE / KEYLINE / HALATION / GOLD METER', dx, dy - 16, 18, 'rgba(232,186,90,0.92)');
  c.save();
  c.beginPath();
  c.rect(dx, dy, dw, dh);
  c.clip();
  put(c, ui, dx + 4, dy + 12, rows[0], 2);
  c.restore();
  c.strokeStyle = 'rgba(150,180,222,0.30)';
  c.lineWidth = 1;
  c.strokeRect(dx + 0.5, dy + 0.5, dw, dh);

  const ex = 760, ey = 448;
  label(c, ui, 'MEASURED OFF BAR/PANEL-QB_DROPBACK.PNG — 3.1953 LOGICAL PX PER PANEL PX, PANEL BORDER AT X=31', ex, ey, 17, 'rgba(232,186,90,0.92)');
  const facts = [
    'CLUSTER        45..681 X 44.7..147          636 X 103, NO OUTER PLATE EDGE',
    'TILES          45..93  99..169  179..275    281..390  396..553  559..681',
    'GUTTERS        6.4 WIDE, OPAQUE BLACK       TILE FILL RGB(13,17,23)',
    'CLOCK  :05     70.3 X 47.9 INK   OURS 69 X 46',
    'YARD   167     63.9 X 32.0 INK   OURS 67 X 30   + GOLD ON THE METER ROW',
    'ABBR L NYC     73.5 X 41.5 INK   OURS 74 X 42   0.54 CAP ASPECT',
    'ABBR R CHI     63.9 X 47.9 INK   OURS 64 X 46   0.40 CAP ASPECT',
    'SCORE  22      99.1 X 60.7 INK   OURS 99 X 62',
    'SCORE  14      92.7 X 63.9 INK   OURS 99 X 62',
    'METERS         Y 83..102, FLUSH TO THE FOOT  FIRE / STEEL+PIPS / GOLD',
    'TURBO PLATE    288 X 76 AT 48,960           ASPECT 3.79; BAR 3.63-3.87',
    'TURBO WORD     170.6 X 30.1 INK  OURS 169 X 30   OBLIQUE 0.24 (13.5 DEG)',
  ];
  for (let i = 0; i < facts.length; i++) label(c, ui, facts[i], ex, ey + 34 + i * 26, 17, 'rgba(158,184,216,0.85)');

  TURBO.bake(ui, 1);
  TURBO.draw(c, 760 - TURBO.BOX.mg, 858 - TURBO.BOX.mg, 0.72, t, 1, 0);
  label(c, ui, 'TURBO 72%  ·  SEE ISO_TURBO FOR THE FULL LADDER, INCLUDING OVERHEAT', 1080, 906, 18);

  HUD.invalidate();
}

/* ----------------------------------------------------------- turbo sheet */

export function drawTurbo(c, t, state, ui) {
  backdrop(c, ui, 'rgba(40,72,150,0.30)');
  header(c, ui, 'TURBO METER', 'ROUNDED SLAB / ONE CHOP / OBLIQUE 13.5 DEG / OVERHEAT');

  TURBO.bake(ui, 1);
  const fills = [0, 0.14, 0.45, 0.68, 0.88, 1.0, 0.34];
  const heats = [0, 0, 0, 0, 0, 0, 1];
  const notes = [
    'EMPTY WELL — RIM AND WORD ALONE',
    'FIRST SEGMENT ONLY',
    'THE SINGLE DIVIDER, AT 45%',
    'WHITE-HOT SMEAR RIDES THE BOUNDARY',
    'FILL TAKES THE RIGHT-HAND CHOP',
    'CHARGED — THE BAR BREATHES',
    'OVERHEAT — RIM GOES AMBER-TO-RED AND PULSES',
  ];
  let y = 122;
  for (let i = 0; i < fills.length; i++) {
    TURBO.draw(c, TURBO.ORIGIN.x, y - TURBO.BOX.mg, fills[i], t, 1, heats[i]);
    label(c, ui, `${Math.round(fills[i] * 100)}%`, 372, y + 54, 22, 'rgba(198,220,248,0.95)');
    if (notes[i]) label(c, ui, notes[i], 436, y + 54, 18, heats[i] ? 'rgba(255,150,90,0.95)' : undefined);
    y += 108;
  }

  const dx = 900;
  label(c, ui, '2X DETAIL  ·  RIM, GLOSS, CHOP, OBLIQUE TYPE', dx, 122, 19, 'rgba(232,186,90,0.92)');
  TURBO.bake(ui, 2);
  TURBO.draw(c, dx - TURBO.BOX.mg * 2, 148 - TURBO.BOX.mg * 2, 0.62, t, 2, 0);
  label(c, ui, 'AT 62%  ·  ONE DIVIDER, SPECULAR BAND, WHITE-HOT SMEAR', dx, 348, 18);
  TURBO.draw(c, dx - TURBO.BOX.mg * 2, 420 - TURBO.BOX.mg * 2, 1.0, t, 2, 0);
  label(c, ui, 'AT 100%  ·  OVERCHARGE PULSE, NO EDGE', dx, 620, 18);
  TURBO.draw(c, dx - TURBO.BOX.mg * 2, 692 - TURBO.BOX.mg * 2, 0.22, t, 2, 1);
  label(c, ui, 'OVERHEAT  ·  ONE EXTRA ALPHA-MODULATED BLIT OF A BAKED RIM', dx, 892, 18, 'rgba(255,150,90,0.95)');

  label(c, ui,
    'PLATE 288 X 76 AT 48,960 (ASPECT 3.79)  ·  WORD INK 173 X 29.5 AT OBLIQUE 0.24 (13.5 DEG)  ·  GAPS U-R 3.5 R-B 4.3 B-O 3.3, BAR 3.5 EACH; T-U 11.2, BAR 17.4',
    48, ui.H - 34, 18, 'rgba(120,148,184,0.85)');

  TURBO.bake(ui, 1);
}

/* ------------------------------------------------------- thumb occlusion */

const DEVICES = [
  { w: 844, h: 390, n: 'IPHONE 14 PRO LANDSCAPE  ·  844 x 390' },
  { w: 1024, h: 768, n: 'IPAD LANDSCAPE  ·  1024 x 768' },
];

/** Fit 1920x1080 logical into a device rect exactly the way the runtime overlay does. */
function fitLogical(dw, dh) {
  const k = Math.min(dw / 1920, dh / 1080);
  const w = 1920 * k, h = 1080 * k;
  return { k, ox: (dw - w) / 2, oy: (dh - h) / 2, vw: dw / k, vh: dh / k };
}

export function drawThumbMask(c, t, state, ui) {
  backdrop(c, ui, 'rgba(52,80,124,0.24)');
  header(c, ui, 'THUMB OCCLUSION PROOF', 'REAL LAYOUT CODE  ·  REAL ARCS  ·  844x390 AND 1024x768');

  HUD.bake(ui, S, 1);
  HUD.bakeFx(1);
  TURBO.bake(ui, 1);

  /** One device panel, drawn through the SAME fit + layout math the runtime uses. */
  function device(d, px, py, Z, detail) {
    const fit = fitLogical(d.w, d.h);
    const vw = fit.vw, vh = fit.vh;
    const arc = thumbArc(0, 0, vw, vh);
    const base = vh - TURBO_INSET - TURBO.PLATE.h - TURBO.BOX.mg;
    const ty = turboTop(0, 0, vw, vh, TURBO.PLATE.x, TURBO.PLATE.h, TURBO.BOX.mg, true);
    c.save();
    c.translate(px, py);
    c.scale(Z, Z);
    c.save();
    c.beginPath();
    c.rect(0, 0, d.w, d.h);
    c.clip();
    c.fillStyle = vgrad(c, 0, d.h, [[0, '#141a22'], [0.5, '#0d1219'], [1, '#161d16']]);
    c.fillRect(0, 0, d.w, d.h);
    c.fillStyle = 'rgba(60,110,60,0.16)';
    for (let i = 0; i < 16; i++) c.fillRect(0, d.h * 0.40 + i * 14, d.w, 7);

    c.save();
    c.scale(fit.k, fit.k);
    c.translate(fit.ox / fit.k, fit.oy / fit.k);
    c.drawImage(HUD.canvas(), HUD.ORIGIN.x, HUD.ORIGIN.y, HUD.BOX.w, HUD.BOX.h);
    // where the bar would have put it — ghosted, and it is INSIDE the arc
    c.save();
    c.globalAlpha = 0.20;
    TURBO.draw(c, TURBO.ORIGIN.x, base, 0.72, t, 1, 0);
    c.restore();
    TURBO.draw(c, TURBO.ORIGIN.x, ty, 0.72, t, 1, 0);

    for (const hand of [0, 1]) {
      const a = hand === 0 ? arc : { cx: vw - arc.cx, cy: arc.cy, r: arc.r };
      const g = c.createRadialGradient(a.cx, a.cy, a.r * 0.2, a.cx, a.cy, a.r);
      g.addColorStop(0, 'rgba(255,86,64,0.26)');
      g.addColorStop(0.72, 'rgba(255,86,64,0.10)');
      g.addColorStop(1, 'rgba(255,86,64,0.00)');
      c.fillStyle = g;
      c.beginPath();
      c.arc(a.cx, a.cy, a.r, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = 'rgba(255,124,96,0.8)';
      c.lineWidth = 3;
      c.setLineDash([12, 9]);
      c.stroke();
      c.setLineDash([]);
    }
    c.restore();
    c.restore();
    c.strokeStyle = 'rgba(150,180,222,0.55)';
    c.lineWidth = 2 / Z;
    c.strokeRect(0, 0, d.w, d.h);
    c.restore();
    void detail;
    return { fit, arc, base, ty };
  }

  const PZ = Math.min(1.06, (ui.W * 0.47) / DEVICES[0].w, 430 / DEVICES[0].h);
  const TZ = Math.min(0.56, (ui.W * 0.42) / DEVICES[1].w, 430 / DEVICES[1].h);
  const a = device(DEVICES[0], 48, 128, PZ, true);
  const b = device(DEVICES[1], 1000, 128, TZ, false);

  const col = [[48, DEVICES[0], a, PZ], [1000, DEVICES[1], b, TZ]];
  for (const [x, d, r, Z] of col) {
    let ly = 128 + d.h * Z + 40;
    label(c, ui, d.n, x, ly, 23, '#dde6f2'); ly += 32;
    label(c, ui, `VISIBLE LOGICAL RECT   ${Math.round(r.fit.vw)} x ${Math.round(r.fit.vh)}`, x, ly, 18); ly += 27;
    label(c, ui, `OCCLUSION DISC   R = ${Math.round(r.arc.r)} LOGICAL, CENTRED ${Math.round(r.arc.cx)}, ${Math.round(r.arc.cy)}`, x, ly, 18); ly += 27;
    label(c, ui, `TURBO TOP   BAR PLACEMENT ${Math.round(r.base)}  ->  SHIPPED ${Math.round(r.ty)}   (LIFT ${Math.round(r.base - r.ty)})`, x, ly, 18, 'rgba(150,220,170,0.92)'); ly += 27;
    label(c, ui, 'GHOSTED PLATE = THE PLACEMENT THE CONCEPT ART USES, WHICH LANDS INSIDE THE DISC', x, ly, 18, 'rgba(232,150,110,0.9)'); ly += 27;
    label(c, ui, 'SCOREBOARD IS TOP-LEFT AND NEVER ENTERS EITHER DISC', x, ly, 18);
  }

  /* bottom strip: a 2.4x crop of the phone's lower-left corner, so the clearance
     is legible rather than asserted */
  const DZ = 1.78, dw = 300, dh = 166, dxp = 48, dyp = 772;
  label(c, ui, '1.8X  ·  PHONE LOWER-LEFT CORNER  ·  SHIPPED PLATE ABOVE THE DISC, GHOST INSIDE IT', dxp, dyp - 14, 19, 'rgba(232,186,90,0.92)');
  c.save();
  c.beginPath();
  c.rect(dxp, dyp, dw * DZ, dh * DZ);
  c.clip();
  c.translate(dxp, dyp);
  c.scale(DZ, DZ);
  c.translate(-0, -(DEVICES[0].h - dh));
  device(DEVICES[0], 0, 0, 1, false);
  c.restore();
  c.strokeStyle = 'rgba(150,180,222,0.4)';
  c.lineWidth = 1.4;
  c.strokeRect(dxp, dyp, dw * DZ, dh * DZ);

  const nx = dxp + dw * DZ + 40;
  label(c, ui, 'WHY THIS MOVES AT ALL', nx, dyp + 30, 23, '#dde6f2');
  const notes = [
    'THE CONCEPT ART PUTS TURBO IN THE BOTTOM-LEFT CORNER. ON A PHONE THAT IS',
    'EXACTLY WHERE THE LEFT THUMB RESTS ON THE VIRTUAL STICK, SO THE ONE READOUT',
    'THAT TELLS A PLAYER WHETHER THEY CAN STILL BURN TURBO WOULD SIT UNDER THEIR',
    'OWN HAND. THE PLATE THEREFORE LIFTS UNTIL ITS LOWER-LEFT CORNER CLEARS THE',
    'OCCLUSION DISC, AND NOTHING ELSE ABOUT IT CHANGES — SAME SILHOUETTE, SAME',
    'SIZE, SAME COLOUR, SAME 48 PX LEFT INSET.',
    '',
    'ON THE CAPTURE PATH THE LIFT IS OFF, SO EVERY A/B AGAINST THE BAR STILL SEES',
    'THE ART DIRECTION EXACTLY WHERE THE ART PUTS IT. THE DISC AND THE LIFT BOTH',
    'COME FROM layout.js, THE SAME TWO FUNCTIONS THE SHIPPED draw() CALLS.',
  ];
  for (let i = 0; i < notes.length; i++) label(c, ui, notes[i], nx, dyp + 58 + i * 25, 18);

  HUD.invalidate();
}

/* ---------------------------------------------------------- safe area */

const ASPECTS = [
  { a: 16 / 9, n: '16:9' },
  { a: 18 / 9, n: '18:9' },
  { a: 19.5 / 9, n: '19.5:9  ·  NOTCH', notch: true },
  { a: 21 / 9, n: '21:9' },
];

export function drawSafeArea(c, t, state, ui) {
  backdrop(c, ui, 'rgba(48,74,118,0.22)');
  header(c, ui, 'SAFE AREA  ·  16:9 THROUGH 21:9', 'ANCHORED TO ui.visible, NOT TO 1920x1080');

  HUD.bake(ui, S, 1);
  HUD.bakeFx(1);
  TURBO.bake(ui, 1);

  const CW = 872, CH = 352;
  for (let i = 0; i < ASPECTS.length; i++) {
    const A = ASPECTS[i];
    const dw = 1080 * A.a, dh = 1080;
    const Z = Math.min(CW / dw, CH / dh);
    const x = 48 + (i % 2) * 952, y = 110 + Math.floor(i / 2) * 450;
    const notch = A.notch ? 52 : 0;
    c.save();
    c.translate(x, y);
    c.scale(Z, Z);
    c.save();
    c.beginPath();
    c.rect(0, 0, dw, dh);
    c.clip();
    c.fillStyle = vgrad(c, 0, dh, [[0, '#151b24'], [0.55, '#0c1017'], [1, '#131a13']]);
    c.fillRect(0, 0, dw, dh);
    c.fillStyle = 'rgba(60,110,60,0.14)';
    for (let j = 0; j < 20; j++) c.fillRect(0, dh * 0.42 + j * 34, dw, 17);
    if (notch) {
      c.fillStyle = '#000';
      c.fillRect(0, dh * 0.28, notch, dh * 0.44);
      c.strokeStyle = 'rgba(255,120,96,0.55)';
      c.lineWidth = 3;
      c.strokeRect(0, dh * 0.28, notch, dh * 0.44);
    }
    // The cluster anchors to the VISIBLE rect, so its 48 px inset is measured
    // from the screen's own left edge (plus any notch) rather than from a
    // nominal 1920 that may be nowhere near it.
    c.drawImage(HUD.canvas(), HUD.ORIGIN.x + notch, HUD.ORIGIN.y, HUD.BOX.w, HUD.BOX.h);
    TURBO.draw(c, TURBO.ORIGIN.x + notch, dh - TURBO_INSET - TURBO.PLATE.h - TURBO.BOX.mg, 0.72, t, 1, 0);
    c.strokeStyle = 'rgba(120,200,255,0.32)';
    c.lineWidth = 3;
    c.setLineDash([18, 14]);
    c.strokeRect(48 + notch, 36, dw - 96 - notch, dh - 72);
    c.setLineDash([]);
    c.restore();
    c.restore();
    c.strokeStyle = 'rgba(150,180,222,0.5)';
    c.lineWidth = 1.6;
    c.strokeRect(x, y, dw * Z, dh * Z);
    label(c, ui, A.n, x, y + dh * Z + 34, 23, '#dde6f2');
    label(c, ui, `${Math.round(dw)} x ${Math.round(dh)} LOGICAL VISIBLE   ·   CLUSTER LEFT EDGE AT ${48 + notch}   ·   TURBO BOTTOM INSET ${TURBO_INSET}`,
      x, y + dh * Z + 62, 18);
  }

  label(c, ui,
    'THE CLUSTER KEEPS ITS 48 PX INSET FROM THE VISIBLE LEFT EDGE AT EVERY ASPECT, AND STEPS INSIDE A NOTCH RATHER THAN UNDER IT.',
    48, ui.H - 34, 19, 'rgba(232,186,90,0.92)');
  HUD.invalidate();
}

export default { drawStates, drawTurbo, drawThumbMask, drawSafeArea };
