// PIECE: score-callout — this piece's own isolation scenes.
//
// Registered as iso shots so a blind critic can pose exactly this contribution with
// nothing else in the frame. They paint their own backdrop (backdrop.js) so the
// overlay-only capture is a complete image and a half-built neighbour cannot mask the
// thing being judged. Hero scenes (midair_hit / truck) get NO backdrop — there the
// lockup sits on the real 3D frame exactly as it ships.

import { backdrop } from './backdrop.js';
import { GEO } from './lockup.js';
import { animate } from './anim.js';
import { drawLockup } from './draw.js';

const W = 1920, H = 1080;

/** Only this piece's own iso scenes may repaint the frame. */
export function isIsoScene(ui) {
  const id = ui && ui.shot && ui.shot.piece === 'score-callout' ? ui.shot.id : null;
  return !!(id && SHEETS[id]);
}

export function drawIsoScene(c2d, t, state, ui) {
  const id = ui.shot.id;
  const fn = SHEETS[id];
  if (fn) fn(c2d, t, state, ui);
}

/* ------------------------------------------------------------------ chrome */

function label(c2d, faces, text, x, y, size, colour) {
  try {
    faces.draw(c2d, text, x, y, {
      face: 'blitz-block', size, align: 'left', fill: colour || 'rgba(196,204,216,0.72)',
      tracking: 0.16,
    });
  } catch (e) { /* a face piece that is still a stub must never break the sheet */ }
}

function frame(c2d, x, y, w, h) {
  c2d.save();
  c2d.strokeStyle = 'rgba(255,255,255,0.10)';
  c2d.lineWidth = 1;
  c2d.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  c2d.restore();
}

/* --------------------------------------------------- 1. the hero lockup */

function heroSheet(variant, defaults) {
  return function (c2d, t, state, ui) {
    const faces = ui.faces;
    c2d.drawImage(backdrop(variant, W, H, 7), 0, 0, W, H);
    const s = Object.assign({}, defaults, state, { visible: true });
    drawOne(c2d, faces, s, defaults.x, defaults.y, defaults.scale || 1, ui.seed | 0, s.age);
  };
}

/* --------------------------------------------------------------- helpers */

function drawOne(c2d, faces, state, x, y, scale, seed, age) {
  drawLockup(c2d, faces, state, x, y, scale, seed, age);
}

/* ------------------------------------------------ 2. all five lockups */

const FIVE = [
  { line1: 'MID-AIR', line2: 'MURDER!', pts: 250, accent: 'red', bg: 'night' },
  { line1: '', line2: 'TRUCK!', pts: 150, accent: 'gold', bg: 'nightWarm' },
  { line1: '', line2: 'TOUCHDOWN!', pts: 200, accent: 'gold', bg: 'night' },
  { line1: '', line2: 'LEVELER!', pts: 200, accent: 'gold', bg: 'nightWarm' },
  { line1: 'WHAT A', line2: 'CATCH!', pts: 175, accent: 'gold', bg: 'crowd' },
];

function fiveSheet(c2d, t, state, ui) {
  const faces = ui.faces;
  c2d.fillStyle = '#0a0b0e';
  c2d.fillRect(0, 0, W, H);

  const pad = 22, top = 74;
  const cols = 3, rows = 2;
  const cw = Math.floor((W - pad * (cols + 1)) / cols);
  const ch = Math.floor((H - top - pad * (rows + 1)) / rows);

  label(c2d, faces, 'SCORE CALLOUT LOCKUPS', 34, 46, 26, 'rgba(232,236,244,0.92)');
  label(c2d, faces, 'LINE 1 WHITE  ·  LINE 2 = ACCENT WHEN LINE 1 EXISTS, ELSE WHITE  ·  GOLD NUMERALS + PTS',
    360, 44, 15, 'rgba(150,160,176,0.72)');

  for (let i = 0; i < FIVE.length; i++) {
    const cx0 = pad + (i % cols) * (cw + pad);
    const cy0 = top + Math.floor(i / cols) * (ch + pad);
    c2d.save();
    c2d.beginPath();
    c2d.rect(cx0, cy0, cw, ch);
    c2d.clip();
    c2d.drawImage(backdrop(FIVE[i].bg, cw, ch, 11 + i * 3), cx0, cy0, cw, ch);
    const s = Object.assign({ visible: true, age: 0.30 }, FIVE[i]);
    // Fit the tile: the lockup is laid out for a 1920-wide frame.
    const k = cw / 900;
    drawOne(c2d, faces, s, cx0 + cw * 0.5, cy0 + ch * 0.74, k, 7 + i, 0.30);
    c2d.restore();
    frame(c2d, cx0, cy0, cw, ch);
    label(c2d, faces, (FIVE[i].line1 ? FIVE[i].line1 + ' ' : '') + FIVE[i].line2,
      cx0 + 14, cy0 + 26, 15, 'rgba(210,218,230,0.55)');
  }

  // colour-rule swatch strip in the empty sixth cell
  const cx0 = pad + 2 * (cw + pad);
  const cy0 = top + (ch + pad);
  c2d.save();
  c2d.fillStyle = '#101218';
  c2d.fillRect(cx0, cy0, cw, ch);
  const RAMPS = [
    ['LINE 2 · WHITE', ['#fffdf6', '#f1eee6', '#ddd7cc', '#c4bdb1', '#a49c91']],
    ['LINE 2 · RED', ['#f4705f', '#dd2c22', '#c11715', '#a41012', '#6d080d']],
    ['LINE 2 · GOLD', ['#ffeea4', '#f9d13a', '#eeb903', '#dfa000', '#a15f02']],
    ['NUMERALS · GOLD', ['#fff5b8', '#ffdd4e', '#f7c604', '#eaad00', '#b06803']],
  ];
  for (let r = 0; r < RAMPS.length; r++) {
    const y = cy0 + 60 + r * 74;
    label(c2d, faces, RAMPS[r][0], cx0 + 22, y - 12, 14, 'rgba(190,198,212,0.7)');
    const sw = (cw - 44) / RAMPS[r][1].length;
    for (let s = 0; s < RAMPS[r][1].length; s++) {
      c2d.fillStyle = RAMPS[r][1][s];
      c2d.fillRect(cx0 + 22 + s * sw, y, sw - 3, 40);
    }
  }
  label(c2d, faces, 'RAMPS SAMPLED OFF THE BAR PANELS', cx0 + 22, cy0 + ch - 22, 13, 'rgba(150,160,176,0.6)');
  c2d.restore();
  frame(c2d, cx0, cy0, cw, ch);
}

/* ------------------------------------------------------- 3. the filmstrip */

const AGES = [0.012, 0.032, 0.055, 0.080, 0.10, 0.14, 0.22, 0.45, 1.90, 2.10];

function animSheet(c2d, t, state, ui) {
  const faces = ui.faces;
  c2d.fillStyle = '#0a0b0e';
  c2d.fillRect(0, 0, W, H);
  label(c2d, faces, 'CALLOUT ANIMATION · PURE FUNCTION OF callout.age', 34, 46, 26, 'rgba(232,236,244,0.92)');
  label(c2d, faces, 'SLAM-IN STREAK → IMPACT FLASH → DAMPED SHAKE → HOLD DRIFT → LIFT-OFF FADE',
    700, 44, 15, 'rgba(150,160,176,0.72)');

  const pad = 14, top = 72;
  const cols = 5, rows = 2;
  const cw = Math.floor((W - pad * (cols + 1)) / cols);
  const ch = Math.floor((H - top - pad * (rows + 1)) / rows);
  const s = { visible: true, line1: '', line2: 'TOUCHDOWN!', pts: 200, accent: 'gold' };

  const scr = { alpha: 1, scale: 1, dx: 0, dy: 0, rot: 0, streak: 0, hot: 0, blur: 0 };
  for (let i = 0; i < AGES.length; i++) {
    const cx0 = pad + (i % cols) * (cw + pad);
    const cy0 = top + Math.floor(i / cols) * (ch + pad);
    c2d.save();
    c2d.beginPath();
    c2d.rect(cx0, cy0, cw, ch);
    c2d.clip();
    c2d.drawImage(backdrop('night', cw, ch, 5), cx0, cy0, cw, ch);
    drawOne(c2d, faces, s, cx0 + cw * 0.52, cy0 + ch * 0.70, cw / 1080, 7, AGES[i]);
    c2d.restore();
    frame(c2d, cx0, cy0, cw, ch);
    animate(AGES[i], scr);
    label(c2d, faces, `AGE ${AGES[i].toFixed(3)}S`, cx0 + 12, cy0 + 24, 15, 'rgba(240,215,138,0.85)');
    label(c2d, faces,
      `A ${scr.alpha.toFixed(2)}  S ${scr.scale.toFixed(2)}  DX ${scr.dx.toFixed(0)}  FLASH ${scr.hot.toFixed(2)}`,
      cx0 + 12, cy0 + ch - 14, 13, 'rgba(160,170,186,0.7)');
  }
}

/* --------------------------------------------------- 4. hostile backgrounds */

function hostileSheet(c2d, t, state, ui) {
  const faces = ui.faces;
  c2d.fillStyle = '#0a0b0e';
  c2d.fillRect(0, 0, W, H);
  label(c2d, faces, 'LEGIBILITY OVER HOSTILE BACKGROUNDS', 34, 46, 26, 'rgba(232,236,244,0.92)');
  label(c2d, faces, 'HALO + KEYLINE + TWO-PASS SHADOW · NO BACKGROUND SHOULD EAT THE LOCKUP',
    560, 44, 15, 'rgba(150,160,176,0.72)');

  const BG = ['bright', 'crowd', 'grey', 'night'];
  const NAME = ['BLOWN-OUT WHITE', 'LIT CROWD', 'FLAT MID-GREY', 'NIGHT FIELD'];
  const pad = 18, top = 72;
  const cw = Math.floor((W - pad * 3) / 2);
  const ch = Math.floor((H - top - pad * 3) / 2);
  const s = { visible: true, line1: 'WHAT A', line2: 'CATCH!', pts: 175, accent: 'gold' };

  for (let i = 0; i < 4; i++) {
    const cx0 = pad + (i % 2) * (cw + pad);
    const cy0 = top + Math.floor(i / 2) * (ch + pad);
    c2d.save();
    c2d.beginPath();
    c2d.rect(cx0, cy0, cw, ch);
    c2d.clip();
    c2d.drawImage(backdrop(BG[i], cw, ch, 3 + i), cx0, cy0, cw, ch);
    drawOne(c2d, faces, s, cx0 + cw * 0.52, cy0 + ch * 0.72, cw / 1180, 7, 0.30);
    c2d.restore();
    frame(c2d, cx0, cy0, cw, ch);
    label(c2d, faces, NAME[i], cx0 + 14, cy0 + 26, 16, 'rgba(240,215,138,0.85)');
  }
}

/* ------------------------------------------------------------------ table */

const SHEETS = {
  iso_callout_hero: heroSheet('night', {
    line1: 'MID-AIR', line2: 'MURDER!', pts: 250, accent: 'red', age: 0.30,
    x: 1404, y: 966, scale: 1,
  }),
  iso_callout_truck: heroSheet('nightWarm', {
    line1: '', line2: 'TRUCK!', pts: 150, accent: 'gold', age: 0.30,
    x: 1404, y: 966, scale: 1,
  }),
  iso_callouts: fiveSheet,
  iso_callout_anim: animSheet,
  iso_callout_hostile: hostileSheet,
};

export { GEO };
export default { isIsoScene, drawIsoScene };
