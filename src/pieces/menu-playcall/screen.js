// PIECE menu-playcall — the whole screen: background, header, chip, 3x3 grid.
//
// COST MODEL. The screen is BAKED and BLITTED, exactly like hud-overlay's cluster,
// because nine cards is 27 routes or 63 assignment arrows plus nine plates of type and
// that is not a per-frame cost anyone should pay on a phone. Two surfaces:
//
//   SHEET  1920x1080. Background + header + chip + all nine cards unselected.
//          Re-baked only when (side, page, faces, brand, team) changes — i.e. on a
//          page flip or a side change, never on a selection move and never on a clock
//          tick.
//   SEL    436x241. The selected card in its selected state. Re-baked when `selected`
//          changes, which is once per input, not once per frame.
//
// The frame path is then: 1 drawImage of the sheet, 1 rounded-rect glow, 1 drawImage
// of the selected card, and ONE piece of live text — the play clock, which is the only
// thing on this screen that changes every tick and therefore the only thing kept out
// of the bake.
//
// WHY THE BACKGROUND IS NOT OPAQUE ON THE LEFT. bar/panel-defense_playcall.png shows a
// linebacker rendered by the WORLD layer occupying panel x 0..140 = logical 0..473,
// with the header band black across the full width above him. So the scrim here is a
// horizontal ramp: nothing at x<360, full by x=500, and a full-width opaque band over
// the header. That is what lets the character read through a screen that is otherwise
// near-black, and it is why this piece must never just fillRect the whole frame.

import TEAMDATA from '../../data/teams.json';
import { W, H, HEAD, CHIP, GRID, CARD, cellRect } from './layout.js';
import {
  BG, BG_DEEP, INK, INK_DIM, GOLD, GOLD_DEEP, CHIP_A, CHIP_B,
  CARD_RAIL_HOT, rgba,
} from './palette.js';
import { mkCanvas, rr, grain, vgrad, hgrad } from './chrome.js';
import { drawCard } from './card.js';
import { sheet, PAGES, REC_SLOTS } from './book.js';
import { quality } from './quality.js';
import { drawInk, inkWidth, resetInk } from './ink.js';

/* ------------------------------------------------------------------ scrims */

/**
 * The scrim, baked at the nominal 1920x1080 and only there.
 *
 * The first version read `ui.visible` here so an ultrawide would be covered edge to
 * edge — which cannot work: the bake surface IS 1920x1080, so a fill at a negative x
 * is simply clipped away and the margin ends up unpainted anyway. The margins are
 * handled live in drawScreen(), where the transform is the device's.
 */
function drawBackdrop(c, ui) {
  const vx = 0, vy = 0, vw = W, vh = H;

  // 1. the right-hand field, where the grid lives: near-opaque. The ramp starts at 360
  //    rather than 300 because the hero framing puts the player's silhouette at
  //    roughly x 160..460 (see CAM in index.js) and a ramp that began at 300 was
  //    already dimming his throwing side.
  c.fillStyle = hgrad(c, 360, 500, [
    [0, rgba(BG, 0)],
    [0.55, rgba(BG, 0.55)],
    [1, rgba(BG, 0.95)],
  ]);
  c.fillRect(vx, vy, vw, vh);
  c.fillStyle = rgba(BG, 0.95);
  c.fillRect(500, vy, vx + vw - 500, vh);

  // 2. the header band, full width and opaque — the bar's is black over the player.
  c.fillStyle = vgrad(c, vy, HEAD.bandBot + 40, [
    [0, rgba(BG_DEEP, 0.985)],
    [0.72, rgba(BG_DEEP, 0.95)],
    [1, rgba(BG, 0.0)],
  ]);
  c.fillRect(vx, vy, vw, HEAD.bandBot + 40 - vy);

  // 3. the blue-violet bloom the bar's gutters carry — measured (6,4,23) between cards
  //    against (0,0,3) at the header, so the tint belongs to the GRID region only.
  const g = c.createRadialGradient(1180, 640, 60, 1180, 640, 900);
  g.addColorStop(0, 'rgba(48,32,120,0.13)');
  g.addColorStop(0.6, 'rgba(28,20,80,0.06)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g;
  c.fillRect(500, vy, vx + vw - 500, vh);

  // 4. tooth over the whole scrim.
  const full = new Path2D();
  full.rect(vx, vy, vw, vh);
  grain(c, full, vx, vy, vw, vh, 4409, 0.5 * quality());

  // 5. the hairline the bar has under the header band.
  c.fillStyle = 'rgba(150,120,200,0.22)';
  c.fillRect(vx, HEAD.bandBot, vw, 1.5);
}

/* ------------------------------------------------------------------ header */

function clubAccent(teamId) {
  const t = TEAMDATA && TEAMDATA.teams ? TEAMDATA.teams[teamId] : null;
  if (!t || !Array.isArray(t.colors) || !t.colors.length) return null;
  return t.colors[0];
}

/**
 * The headline, set into the bar's own ink rectangle: left edge 102, cap band 56..155,
 * total ink width 1123 (measured — see layout.js). Two strings rather than one, so the
 * wide gap the bar has between the shout and the instruction survives. Measured by
 * running a column profile across the headline's ink band: the runs are 35..172,
 * 193..254, 263..279, 291..318, 319..336, 338..354, and the widest gap in that list is
 * 172..193 — 21 panel px = 74 logical, against 9-12 px between the other words. So the
 * shout and the instruction are separated by about twice a word space, and that is a
 * layout fact, not a space character.
 */
function drawHeader(c, ui, S) {
  const word = S.side === 'offense' ? 'OFFENSE!' : 'DEFENSE!';
  const rest = 'PICK A PLAY';
  const gap = 74;
  const capH = HEAD.capBot - HEAD.capTop;
  const total = HEAD.maxInkW;
  // Split the width between the two runs in proportion to what each one needs, so the
  // pair lands on ONE common size instead of two.
  const wa = inkWidth(ui, word, 'blitz-brush', capH);
  const wb = inkWidth(ui, rest, 'blitz-brush', capH);
  const k = Math.min(1, (total - gap) / (wa + wb));
  const shadow = { color: 'rgba(0,0,0,0.8)', blur: 14, dy: 5 };
  // Whatever cap height the width constraint leaves, CENTRE it in the bar's cap band
  // (56..155). With the fallback face the ink comes out 71 px of a 99 px band; sitting
  // it at the top of the band would leave a 28 px hole under the headline that the bar
  // does not have.
  const h = capH * Math.max(k, 0.72);
  const top = HEAD.capTop + (capH - h) * 0.5;
  const a = drawInk(c, ui, word, 'blitz-brush', {
    x: HEAD.x, top, h, maxW: (total - gap) * (wa / (wa + wb)),
    minXScale: 0.88, fill: INK, shadow,
  });
  drawInk(c, ui, rest, 'blitz-brush', {
    x: HEAD.x + a.w + gap, top, h: a.h, maxW: (total - gap) * (wb / (wa + wb)),
    minXScale: 0.88, fill: INK, shadow,
  });
}

/**
 * The play clock. LIVE, not baked — it is the one thing on this screen that changes
 * every tick, and baking it would mean re-baking 1920x1080 once a second.
 * Ink box from the bar: 166 x 78, right edge on the safe inset.
 */
export function drawClock(c, ui, text) {
  const s = String(text === undefined || text === null ? ':09' : text);
  const o = {
    x: HEAD.clockRight, top: HEAD.capTop + 10, h: HEAD.clockCap, maxW: 260,
    align: 'right', fill: GOLD,
  };
  c.save();
  c.shadowColor = 'rgba(255,150,20,0.45)';
  c.shadowBlur = 26;
  drawInk(c, ui, s, 'blitz-num', o);
  c.restore();
  // A second, unshadowed pass for the crisp edge — the glow softens the glyph.
  drawInk(c, ui, s, 'blitz-num', o);
}

function drawChip(c, ui, S) {
  const x = CHIP.x, y = CHIP.y, h = CHIP.h;
  const p = rr(x, y, CHIP.w, h, h * 0.5);
  c.save();
  c.save();
  c.clip(p);
  c.fillStyle = hgrad(c, x, CHIP.fade, [
    [0, rgba(CHIP_A, 0.95)],
    [0.42, rgba(CHIP_B, 0.85)],
    [1, rgba(CHIP_B, 0)],
  ]);
  c.fillRect(x, y, CHIP.w, h);
  const accent = clubAccent(S.team);
  c.fillStyle = accent ? rgba(accent, 0.95) : rgba(CARD_RAIL_HOT, 0.9);
  c.fillRect(x, y, 7, h);
  c.restore();
  // The chip's outline fades with its fill. Stroking the whole pill at a constant
  // alpha drew a bright ring around the transparent right-hand end — the bar's chip
  // dissolves, it does not end.
  c.strokeStyle = hgrad(c, x, CHIP.fade, [
    [0, 'rgba(150,150,235,0.30)'],
    [0.45, 'rgba(150,150,235,0.16)'],
    [1, 'rgba(150,150,235,0)'],
  ]);
  c.lineWidth = 1.4;
  c.stroke(p);

  // The chip word, ink-fitted. Measured off the bar by row profile: NICKEL's ink runs
  // rows 68..78 = 11 panel px = 39 logical, inside a chip band 59..85 = 92 logical, so
  // it fills 42% of its pill. This pill is 62 px rather than 92 (the 3x3 grid wants the
  // height), and 42% of that would be a 26 px cap — smaller in absolute terms than the
  // bar's. 32 splits the difference: 52% of the pill, 82% of the bar's absolute cap.
  drawInk(c, ui, S.formation, 'blitz-block', {
    x: x + 28, top: y + (h - 32) * 0.5, h: 32, maxW: CHIP.w - 90,
    tracking: 0.10, fill: '#dfe3ee',
  });
  c.restore();
}

/**
 * Page pips, right-aligned with the grid. Only the offensive sheet is paged — the
 * playbook ships 18 offensive plays over 2 pages and 9 defensive calls over one, and
 * a pip row of length one would be a control that does nothing.
 */
function drawPages(c, ui, S) {
  if (S.side !== 'offense' || PAGES < 2) return;
  const y = CHIP.y + CHIP.h * 0.5;
  const r = 9, gap = 30;
  const right = GRID.x + GRID.cols * GRID.cw + (GRID.cols - 1) * GRID.gx;
  for (let i = PAGES - 1; i >= 0; i--) {
    const x = right - r - (PAGES - 1 - i) * gap;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    if (i + 1 === S.page) { c.fillStyle = GOLD; c.fill(); } else {
      c.strokeStyle = rgba(GOLD_DEEP, 0.7); c.lineWidth = 2.4; c.stroke();
    }
  }
  ui.faces.draw(c, `PAGE ${S.page} OF ${PAGES}`, right - PAGES * gap - 10, y + 9, {
    face: 'blitz-block', size: 24, tracking: 0.12, align: 'right', fill: INK_DIM,
  });
}

/* -------------------------------------------------------------------- bake */

let sheetCv = null;
let sheetKey = '';
let selCv = null;
let selKey = '';
let lastFaces = null;

/**
 * A face registration REPLACES ui.faces with a different object, and everything on
 * this screen is set through it. Comparing the identity is the whole test: it is one
 * reference compare per draw, and without it a piece that registers its faces after
 * the first bake would keep the fallback's type until the page changed.
 */
function faceGuard(ui) {
  if (ui.faces !== lastFaces) {
    lastFaces = ui.faces;
    resetInk();
    sheetKey = '';
    selKey = '';
  }
}

export function bakeSheet(ui, S) {
  faceGuard(ui);
  const key = `${S.side}|${S.page}|${S.formation}|${S.team}`;
  if (sheetCv && sheetKey === key) return sheetCv;
  const cv = sheetCv && sheetCv.width === W ? sheetCv : mkCanvas(W, H);
  const c = cv.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, W, H);
  drawBackdrop(c, ui);
  drawHeader(c, ui, S);
  drawChip(c, ui, S);
  drawPages(c, ui, S);

  const plays = sheet(S.side, S.page);
  for (let i = 0; i < plays.length; i++) {
    const r = cellRect(i);
    c.save();
    c.translate(r.x, r.y);
    drawCard(c, ui, plays[i], S.side, r.w, r.h, { selected: false, ordinal: i + 1 });
    c.restore();
  }
  sheetCv = cv;
  sheetKey = key;
  return cv;
}

export function bakeSelected(ui, S) {
  const plays = sheet(S.side, S.page);
  const i = S.selected;
  if (i < 0 || i >= plays.length) return null;
  const key = `${S.side}|${S.page}|${i}`;
  if (selCv && selKey === key) return selCv;
  const cv = selCv || mkCanvas(GRID.cw + 2, GRID.ch + 2);
  const c = cv.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, cv.width, cv.height);
  c.save();
  c.translate(1, 1);
  drawCard(c, ui, plays[i], S.side, GRID.cw, GRID.ch, { selected: true, ordinal: i + 1 });
  c.restore();
  selCv = cv;
  selKey = key;
  return cv;
}

export function invalidate() { sheetKey = ''; selKey = ''; }

/* -------------------------------------------------------------------- draw */

/**
 * The selection's halo. Drawn live so it can breathe with `t`; a 1.9 s cycle, which is
 * slow enough not to strobe and fast enough that a still frame at any t looks awake.
 * Pure function of t — no clock is read anywhere in this piece.
 */
function drawHalo(c, r, t) {
  const k = 0.5 + 0.5 * Math.sin(t * 3.3);
  c.save();
  c.shadowColor = rgba(CARD_RAIL_HOT, (0.28 + 0.34 * k) * quality());
  c.shadowBlur = (26 + 16 * k) * quality();
  c.strokeStyle = rgba(CARD_RAIL_HOT, 0.5 + 0.3 * k);
  c.lineWidth = 3;
  c.stroke(rr(r.x - 3, r.y - 3, r.w + 6, r.h + 6, CARD.radius + 3));
  c.restore();
}

export function drawScreen(c, t, S, ui) {
  const cv = bakeSheet(ui, S);
  // RUNTIME MARGINS. On anything that is not 16:9 the contain-fit makes `ui.visible`
  // LARGER than 1920x1080 with a negative origin, so the baked sheet does not reach
  // the screen edges. Four rects of the base black close the gap; on a 16:9 capture
  // every one of them is zero-sized and nothing is drawn.
  if (ui && ui.runtime && ui.visible) {
    const v = ui.visible;
    c.fillStyle = rgba(BG_DEEP, 0.96);
    if (v.x < 0) c.fillRect(v.x, v.y, -v.x, v.h);
    if (v.x + v.w > W) c.fillRect(W, v.y, v.x + v.w - W, v.h);
    if (v.y < 0) c.fillRect(0, v.y, W, -v.y);
    if (v.y + v.h > H) c.fillRect(0, H, W, v.y + v.h - H);
  }
  c.drawImage(cv, 0, 0, W, H);
  drawClock(c, ui, S.clock);
  const sel = bakeSelected(ui, S);
  if (sel) {
    const r = cellRect(S.selected);
    drawHalo(c, r, t);
    c.drawImage(sel, r.x - 1, r.y - 1);
  }
}

export const SLOT_LEGEND = REC_SLOTS;

export default { drawScreen, bakeSheet, bakeSelected, invalidate };
