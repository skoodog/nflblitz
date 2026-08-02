// PIECE menu-playcall — one play card.
//
// CARD ANATOMY, and where each number came from (see layout.js for the full derivation
// of the bar measurements):
//
//   plate      436 x 241, radius 14, fill #070709 — FLAT, because the bar's card
//              interior measures (5,5,5)..(7,7,7), i.e. an interior std of about 1.
//              Everything that makes it read as an object is on its EDGES.
//   rail       6 px of magenta down the left edge of EVERY card. The bar has this on
//              card 1 AND card 2 (measured (172,16,105) and (205,39,181)), so it is
//              the card's style and not a selection marker; the selected card widens
//              it to 12 and takes it to #ff54d8.
//   border     1.6 px violet-grey (#4a3050), brightening at the corners toward
//              #9d2da0 — the corner flare is in the bar at (157,45,160).
//   diagram    the box above the plate; see diagram.js
//   plate type play name left, tag right, on a 80 px strip. The bar's strip is 45% of
//              its card; this one is 33%, because a 3x3 grid makes cards wider and
//              shorter and the diagram needs the height more than the type does.
//
// THE NAME IS FITTED, NOT TRUSTED. The longest name in the shipped book is 12
// characters ("OVER THE TOP") and the plate has 436 - 6 - 32 = 398 px minus whatever
// the tag takes. Both strings are set through ink.js by INK BOX, so the two cap
// heights line up whatever the strings are, and a longer name added to the JSON later
// squeezes (to 0.84) and then shrinks instead of colliding with the tag.

import { CARD, diagramRect, plateRect } from './layout.js';
import {
  CARD_FILL, CARD_FILL_SEL, CARD_EDGE, CARD_EDGE_HI, CARD_RAIL, CARD_RAIL_HOT,
  NAME, INK_DIM, GOLD, rgba,
} from './palette.js';
import { rr, grain, vgrad } from './chrome.js';
import { quality } from './quality.js';
import { drawPlay } from './diagram.js';
import { tagOf } from './book.js';
import { drawInk, inkWidth } from './ink.js';

/**
 * Draw one card at (0,0)-(w,h) in the CURRENT transform. The caller positions it; that
 * is what lets the same routine bake into the screen sheet and into a standalone
 * selected-card surface without a second code path.
 */
export function drawCard(c, ui, play, side, w, h, opts = {}) {
  const sel = !!opts.selected;
  const scale = opts.scale === undefined ? 1 : opts.scale;
  const r = { x: 0, y: 0, w, h };
  const plate = rr(0, 0, w, h, CARD.radius * scale);

  c.save();

  // ---- body -------------------------------------------------------------
  c.fillStyle = sel ? CARD_FILL_SEL : CARD_FILL;
  c.fill(plate);
  // A single cool wash down from the top edge. 4% at the top, gone by a third of the
  // card: enough to stop the plate reading as a hole, not enough to become a gradient.
  c.save();
  c.clip(plate);
  c.fillStyle = vgrad(c, 0, h * 0.34, [[0, 'rgba(120,140,200,0.055)'], [1, 'rgba(120,140,200,0)']]);
  c.fillRect(0, 0, w, h);
  c.restore();
  grain(c, plate, 0, 0, w, h, 1301 + (play.index | 0), (sel ? 0.8 : 0.55) * quality());

  // ---- diagram ----------------------------------------------------------
  const d = diagramRect(r, scale);
  c.save();
  c.beginPath();
  c.rect(d.x, d.y, d.w, d.h);
  c.clip();
  drawPlay(c, play, side, d, scale);
  c.restore();

  // ---- name plate -------------------------------------------------------
  const p = plateRect(r, scale);
  c.save();
  c.beginPath();
  c.rect(p.x, p.y, p.w, p.h);
  c.clip();
  if (sel) {
    c.fillStyle = vgrad(c, p.y, p.y + p.h, [[0, 'rgba(158,20,132,0.92)'], [1, 'rgba(76,10,74,0.92)']]);
    c.fillRect(p.x, p.y, p.w, p.h);
  } else {
    c.fillStyle = 'rgba(255,255,255,0.022)';
    c.fillRect(p.x, p.y, p.w, p.h);
  }
  c.restore();
  // the divider the bar has between diagram and plate
  c.fillStyle = sel ? rgba([255, 120, 220], 0.55) : rgba([120, 96, 128], 0.42);
  c.fillRect(p.x, p.y, p.w, Math.max(1, 1.4 * scale));

  // BOTH strings are set by ink box, so the name's cap and the tag's cap sit on one
  // line whatever the strings are. Cap heights 30 and 16 at card scale, i.e. 37% and
  // 20% of the 80 px plate. Measured off the bar for comparison (row profile across
  // card 1's plate): its name ink is rows 145..151 = 7 panel px = 25 logical, in a
  // plate 132..170 = 134 logical, so 18% of a much taller plate. This card's name is
  // therefore 20% BIGGER in absolute pixels on a plate that is 40% shorter — deliberate:
  // the name is the only thing a player reads at a glance, and the plate's spare height
  // was worth more to the diagram.
  const padX = 16 * scale;
  const tag = tagOf(play, side);
  const tagCap = 16 * scale;
  const tagW = inkWidth(ui, tag, 'blitz-block', tagCap, { tracking: 0.10 });
  const nameCap = 30 * scale;
  const nameMax = p.w - padX * 2 - tagW - 20 * scale;
  const mid = p.y + p.h * 0.5;

  drawInk(c, ui, play.name, 'blitz-block', {
    x: p.x + padX, top: mid - nameCap * 0.5, h: nameCap, maxW: nameMax,
    minXScale: 0.84, tracking: 0.03,
    fill: sel ? '#ffffff' : NAME,
    shadow: { color: 'rgba(0,0,0,0.75)', blur: 6 * scale, dy: 2 * scale },
  });
  drawInk(c, ui, tag, 'blitz-block', {
    x: p.x + p.w - padX, top: mid - tagCap * 0.5, h: tagCap, align: 'right',
    tracking: 0.10, fill: sel ? 'rgba(255,220,245,0.92)' : INK_DIM,
  });

  // ---- edges ------------------------------------------------------------
  // Border, then the corner flare, then the rail. Order matters: the rail is the
  // brightest thing on the card and must not be dimmed by the border's stroke.
  c.lineWidth = 1.6 * scale;
  c.strokeStyle = sel ? rgba([255, 84, 216], 0.85) : CARD_EDGE;
  c.stroke(plate);
  const flare = c.createLinearGradient(0, 0, w, h);
  flare.addColorStop(0, rgba(CARD_EDGE_HI, sel ? 0.95 : 0.55));
  flare.addColorStop(0.35, 'rgba(0,0,0,0)');
  flare.addColorStop(0.72, 'rgba(0,0,0,0)');
  flare.addColorStop(1, rgba(CARD_EDGE_HI, sel ? 0.8 : 0.4));
  c.strokeStyle = flare;
  c.lineWidth = 2.2 * scale;
  c.stroke(plate);

  const railW = (sel ? CARD.railSel : CARD.rail) * scale;
  c.save();
  c.clip(plate);
  c.fillStyle = vgrad(c, 0, h, [
    [0, rgba(sel ? CARD_RAIL_HOT : CARD_RAIL, sel ? 1 : 0.85)],
    [0.55, rgba(sel ? CARD_RAIL_HOT : CARD_RAIL, sel ? 0.92 : 0.62)],
    [1, rgba(sel ? CARD_RAIL_HOT : CARD_RAIL, sel ? 0.7 : 0.30)],
  ]);
  c.fillRect(0, 0, railW, h);
  c.restore();

  // The ordinal. Nine cards, nine positions: the number is the tile's address on the
  // 3x3, which is how a thumb finds it without reading.
  if (opts.ordinal) {
    ui.faces.draw(c, String(opts.ordinal), w - 12 * scale, 30 * scale, {
      face: 'blitz-num', size: 26 * scale, align: 'right',
      fill: sel ? rgba(GOLD, 0.95) : 'rgba(150,160,185,0.42)',
    });
  }

  c.restore();
}

export default { drawCard };
