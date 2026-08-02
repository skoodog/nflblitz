// PIECE menu-team-select — THE SCREEN.
//
// Composition, top to bottom:
//
//   CHOOSE YOUR CITY          brush italic, cream, flanked by two rules — the panel's
//                             own header, at the panel's own proportions.
//   AFC EAST                  which of the eight real divisions is on the cards.
//   4 club cards              one division. The NFL is 8 divisions of exactly 4, and
//                             the concept art's row is exactly 4 wide, so the paging
//                             unit and the art's unit are the same thing. That is not
//                             a coincidence anyone should take credit for, but it is
//                             the reason this screen can show 4 clubs at hero size and
//                             still reach all 32 in one tap.
//   division rail             all eight divisions, each listing its four clubs by
//                             abbreviation. 32 clubs on screen at once, the current
//                             one filled with its own colour.
//
// WHY NOT A 32-CARD GRID, which is the obvious reading of "32 clubs legible at a
// glance". It was drawn — sheets.js's iso_team_select_league IS that grid, 8 x 4 on
// this exact surface — and then measured. The largest tile that fits is 212 x 207,
// which puts the crest at 96 px and the nickname at cap 16. Multiply by the
// contain-fit of an 844 x 390 landscape phone (0.3611) and that nickname is 5.8 CSS
// px of cap height: 1.06 mm. It is unreadable in the hand, and it is unreadable
// there whatever else the layout does, because 32 tiles simply do not leave room.
// A grid that shows everything and lets you read nothing is not legibility, it is a
// colour swatch. So the grid stays as a specimen sheet where it is looked at on a
// desk, and the shipping screen spends its legibility budget on the four clubs
// actually being chosen between, while the rail carries the other 28 identities as
// abbreviation + club colour — the two things that survive any downscale.

import { makeRng } from '../../foundation/rng.js';
import { rr, lin, rad, rgba, luma, drawFit, sizeForCap, mkCanvas } from './chrome.js';
import { paletteOf, PAPER, PAPER_DIM, GOLD, GOLD_HI, GROUND } from './palette.js';
import {
  W, H, HEAD, CARD, COLS, LIFT, cardX, RAIL, tabX, CHEV, CHEV_L, CHEV_R,
} from './layout.js';
import { card as bakeCard, glow as cardGlow } from './card.js';
import { resolve } from './league.js';

/* --------------------------------------------------------------- backdrop */

let bgCanvas = null;
let bgKey = '';

/**
 * The ground is baked once. It is a black field with a warm low vignette and a few
 * very faint diagonal streaks — the concept sheet's backdrop is not flat black, it
 * has a slow diagonal grain that keeps the cards from floating. Seeded, never
 * random: makeRng('menu-team-select/bg') gives the same field every capture.
 */
function backdrop(raster) {
  const key = String(Math.round(raster * 100));
  if (bgCanvas && bgKey === key) return bgCanvas;
  const cv = mkCanvas(W * raster, H * raster);
  const c = cv.getContext('2d');
  c.scale(raster, raster);
  c.fillStyle = GROUND;
  c.fillRect(0, 0, W, H);

  const rng = makeRng('menu-team-select/bg');
  c.save();
  c.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 26; i++) {
    const x = rng() * W * 1.3 - W * 0.15;
    const w = 30 + rng() * 190;
    const a = 0.012 + rng() * 0.022;
    c.fillStyle = rgba(i % 3 === 0 ? '#4a3a20' : '#1d2733', a);
    c.beginPath();
    c.moveTo(x, -40);
    c.lineTo(x + w, -40);
    c.lineTo(x + w - 300, H + 40);
    c.lineTo(x - 300, H + 40);
    c.closePath();
    c.fill();
  }
  c.restore();

  // vignette — darkest at the corners, so the card row is the brightest band.
  c.fillStyle = rad(c, W / 2, H * 0.46, H * 0.20, W / 2, H * 0.46, W * 0.70, [
    [0, 'rgba(0,0,0,0)'], [0.62, 'rgba(0,0,0,0.35)'], [1, 'rgba(0,0,0,0.86)'],
  ]);
  c.fillRect(0, 0, W, H);

  bgCanvas = cv; bgKey = key;
  return cv;
}

export function invalidateBackdrop() { bgCanvas = null; }

/* ----------------------------------------------------------------- header */

function header(c, faces, label) {
  const title = 'CHOOSE YOUR CITY';
  const size = sizeForCap(faces, 'blitz-brush', HEAD.titleCap);
  const m = faces.measure(title, 'blitz-brush', size, { face: 'blitz-brush', size });
  const half = Math.min(m.w, W * 0.62) / 2;

  faces.draw(c, title, W / 2, HEAD.titleBase, {
    face: 'blitz-brush', size, align: 'center', fill: PAPER,
    stroke: 'rgba(0,0,0,0.9)', strokeWidth: Math.max(2, HEAD.titleCap * 0.05),
    shadow: { color: 'rgba(0,0,0,0.8)', blur: 22, dy: 5 },
  });

  // the two flanking rules, fading outward
  const y = HEAD.ruleY;
  const inL = W / 2 - half - HEAD.ruleGap;
  const inR = W / 2 + half + HEAD.ruleGap;
  c.save();
  c.lineWidth = 3;
  c.strokeStyle = lin(c, HEAD.ruleX0, 0, inL, 0, [
    [0, 'rgba(232,225,210,0)'], [1, 'rgba(232,225,210,0.55)'],
  ]);
  c.beginPath(); c.moveTo(HEAD.ruleX0, y); c.lineTo(inL, y); c.stroke();
  c.strokeStyle = lin(c, inR, 0, W - HEAD.ruleX0, 0, [
    [0, 'rgba(232,225,210,0.55)'], [1, 'rgba(232,225,210,0)'],
  ]);
  c.beginPath(); c.moveTo(inR, y); c.lineTo(W - HEAD.ruleX0, y); c.stroke();
  c.restore();

  if (label) {
    drawFit(c, faces, label, W / 2, HEAD.subBase, {
      face: 'blitz-techno', cap: HEAD.subCap, align: 'center',
      fill: GOLD, tracking: 0.22, maxW: W * 0.5,
    });
  }
}

/* ------------------------------------------------------------------- rail */

/**
 * The eight divisions. Each tab names a division and lists its four clubs by
 * abbreviation on a chip tinted with that club's own colour. The active division's
 * tab is lit; the selected club's chip is filled solid.
 *
 * THIS IS THE "32 CLUBS AT A GLANCE" HALF OF THE SCREEN. Every abbreviation in the
 * league is on it at cap 22, which is 7.9 CSS px (1.45 mm) at the 844x390 phone fit —
 * small, but an abbreviation is three known letters and it survives that where a
 * nickname would not. The tab is the touch target (207.75 x 145 logical = 13.8 x 9.6
 * mm on the same phone); the chips are read, not tapped.
 */
function rail(c, faces, model) {
  const groups = model.groups;
  const tw = RAIL.tabW;
  for (let i = 0; i < groups.length && i < 8; i++) {
    const g = groups[i];
    const x = tabX(i);
    const active = i === model.division;

    rr(c, x, RAIL.y, tw, RAIL.h, RAIL.r);
    c.fillStyle = active ? 'rgba(28,26,18,0.95)' : 'rgba(10,11,15,0.82)';
    c.fill();
    c.lineWidth = active ? 2.5 : 1.5;
    c.strokeStyle = active ? rgba(GOLD, 0.85) : 'rgba(150,155,168,0.22)';
    c.stroke();

    if (active) {
      // a lit lip along the top of the active tab
      c.save();
      rr(c, x, RAIL.y, tw, RAIL.h, RAIL.r);
      c.clip();
      c.fillStyle = lin(c, 0, RAIL.y, 0, RAIL.y + 30, [
        [0, rgba(GOLD, 0.42)], [1, rgba(GOLD, 0)],
      ]);
      c.fillRect(x, RAIL.y, tw, 30);
      c.restore();
    }

    drawFit(c, faces, g.label, x + tw / 2, RAIL.y + 28, {
      face: 'blitz-block', cap: 19, align: 'center',
      fill: active ? GOLD_HI : PAPER_DIM, tracking: 0.1, maxW: tw - 16,
    });

    // four club chips, 2 x 2
    const cw = (tw - 7) / 2, ch = 48, gap = 7;
    for (let k = 0; k < g.teams.length && k < 4; k++) {
      const t = g.teams[k];
      const P = paletteOf(t);
      const cx = x + (k % 2) * (cw + gap) + 0;
      const cy = RAIL.y + 42 + Math.floor(k / 2) * (ch + gap);
      // Lit by IDENTITY, not by position: on a row that is not a division (the
      // legacy 4-team ShotSpec state) there is no active tab, but the club the player
      // has picked must still show where it lives.
      const on = !!(model.team && t.id === model.team.id);
      // The chip uses the club's NAME colour — the same primary-derived colour its
      // nickname is set in on the card — so a player who has just read BEARS in blue
      // finds the blue CHI chip without having to translate between two palettes.
      rr(c, cx, cy, cw, ch, 6);
      c.fillStyle = on ? P.name : rgba(P.name, active ? 0.24 : 0.16);
      c.fill();
      c.lineWidth = 1.5;
      c.strokeStyle = on ? 'rgba(255,255,255,0.9)' : rgba(P.name, 0.55);
      c.stroke();
      drawFit(c, faces, t.abbr || t.id, cx + cw / 2, cy + ch * 0.72, {
        face: 'blitz-block', cap: 22, align: 'center',
        fill: on ? pickInk(P.name) : (active ? PAPER : PAPER_DIM),
        tracking: 0.04, maxW: cw - 10,
      });
    }
  }
}

/** Black or paper on a filled chip, whichever wins on contrast. */
function pickInk(hex) { return luma(hex) > 0.48 ? '#0a0a0d' : PAPER; }

/* --------------------------------------------------------------- chevrons */

function chevron(c, box, dir) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const s = CHEV.glyph;
  c.save();
  c.translate(cx, cy);
  c.scale(dir, 1);
  for (let i = 0; i < 2; i++) {
    const ox = i * s * 0.42 - s * 0.16;
    const a = i === 0 ? 0.95 : 0.45;
    c.beginPath();
    c.moveTo(ox - s * 0.24, -s * 0.5);
    c.lineTo(ox + s * 0.22, 0);
    c.lineTo(ox - s * 0.24, s * 0.5);
    c.lineTo(ox - s * 0.02, s * 0.5);
    c.lineTo(ox + s * 0.44, 0);
    c.lineTo(ox - s * 0.02, -s * 0.5);
    c.closePath();
    c.fillStyle = rgba(GOLD, a);
    c.fill();
  }
  c.restore();
}

/* ------------------------------------------------------------------ draw */

/**
 * THE WHOLE SCREEN IS ONE BAKE, AND IT DOES NOT ANIMATE. That is a decision I
 * reversed once, so it is worth writing down.
 *
 * The first version breathed the selected card's bloom and drifted the chevrons on
 * closed-form functions of `t`, and called `ui.markDirty(0,0,W,H)` every draw so the
 * motion would survive the runtime overlay's redraw-on-change gate. Reading
 * foundation/overlay.js's own measurements back, that is the exact pattern its
 * header warns about: touching the Canvas2D surface re-uploads the WHOLE layer to
 * the compositor whatever the dirty rect said, and marking dirty every draw makes
 * `shouldDraw` return true on every frame. It measured, on that file's own numbers,
 * as an entire per-frame layer upload of a 2.07 MP surface — bought for a glow that
 * pulses by 18% and two chevrons that move three pixels.
 *
 * So: everything static, baked once into a single canvas keyed by
 * (division, selected, raster), and the frame path is ONE drawImage. `markDirty` is
 * called only when that key changes, which for a menu is when the player actually
 * does something. A card the thumb has not touched costs nothing.
 *
 * The bake is at the raster the overlay blits at, so on a 390 px phone the sheet is
 * a 693x390 canvas rather than a 1920x1080 one.
 */
let sheetCv = null;
let sheetKey = '';

export function invalidateSheet() { sheetCv = null; sheetKey = ''; }

function bakeScreen(ui, model, raster) {
  const cv = mkCanvas(W * raster, H * raster);
  const c = cv.getContext('2d');
  c.scale(raster, raster);
  const faces = ui.faces;

  c.drawImage(backdrop(raster), 0, 0, W, H);
  header(c, faces, model.label);

  for (let i = 0; i < model.shown.length && i < COLS; i++) {
    const team = model.shown[i];
    const sel = i === model.selected;
    const x = cardX(i);
    const y = CARD.y - (sel ? LIFT : 0);
    if (sel) cardGlow(c, x, y, team);
    // A hard drop shadow under every card so the row has depth even on black.
    c.save();
    c.shadowColor = 'rgba(0,0,0,0.85)';
    c.shadowBlur = sel ? 30 : 16;
    c.shadowOffsetY = sel ? 16 : 8;
    c.fillStyle = '#000';
    rr(c, x + 6, y + 8, CARD.w - 12, CARD.h - 12, CARD.r);
    c.fill();
    c.restore();
    c.drawImage(bakeCard(ui, team, sel, raster), x, y, CARD.w, CARD.h);
  }

  chevron(c, CHEV_L, -1);
  chevron(c, CHEV_R, 1);
  rail(c, faces, model);
  return cv;
}

/**
 * drawScreen(c2d, t, state, ui) — the whole team-select screen.
 * Draws opaque: this is a menu and it owns the frame. Returns the resolved model so
 * a caller (or a specimen sheet) can ask what is shown and what is picked.
 */
export function drawScreen(c, t, state, ui) {
  const model = resolve(state, ui.brand);
  const raster = ui.runtime
    ? Math.min(1, Math.max(0.34, (ui.fit || 1) * (ui.dpr || 1) * 1.2))
    : 1;
  const key = `${model.division}|${model.selected}|${Math.round(raster * 100)}`;
  if (!sheetCv || sheetKey !== key) {
    sheetCv = bakeScreen(ui, model, raster);
    sheetKey = key;
    // Only NOW does the layer need re-uploading, and it needs all of it: the screen
    // is opaque and every pixel of it just changed.
    if (ui.markDirty) ui.markDirty(0, 0, W, H);
  }
  c.drawImage(sheetCv, 0, 0, W, H);
  return model;
}

export default { drawScreen, invalidateBackdrop, invalidateSheet };
