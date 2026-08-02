// PIECE menu-playcall — the two audit surfaces.
//
// These are not the game screen. They exist so a critic with no context can check the
// claims this piece makes instead of taking them on trust:
//
//   iso:playcall-legend    all 27 cards in the shipped book on one surface, at card
//                          scale, plus the two colour keys. If two plays rendered the
//                          same, this is where it would be obvious.
//   iso:playcall-geometry  the depth curve as a ruler with its numbers, one offensive
//                          and one defensive card at 2x with every waypoint and every
//                          assignment labelled, and the bar-panel measurements the
//                          layout was derived from, printed.
//
// Both draw through the SAME drawCard/drawPlay path the screen uses, so a sheet can
// never advertise geometry the game does not draw.

import {
  W, H, MAX_DEPTH, MAX_BACK, DEPTH_POW, BACK_POW, DEF_MAX_DEPTH, HALF_WIDTH,
  BAR, GRID, CARD, diagramRect,
} from './layout.js';
import { BG_DEEP, INK, INK_DIM, GOLD, SLOT, ASSIGN, rgba } from './palette.js';
import { drawCard } from './card.js';
import { makeProj } from './diagram.js';
import { allOffense, defense, offensePage, FORMATION, DEF_SLOTS, REC_SLOTS } from './book.js';
import { rr } from './chrome.js';

function bg(c) {
  c.fillStyle = BG_DEEP;
  c.fillRect(0, 0, W, H);
  const g = c.createRadialGradient(W * 0.5, H * 0.42, 80, W * 0.5, H * 0.42, 1150);
  g.addColorStop(0, 'rgba(40,30,96,0.20)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
}

function label(c, ui, text, x, y, size, fill, align) {
  ui.faces.draw(c, text, x, y, {
    face: 'blitz-block', size, tracking: 0.08, fill: fill || INK_DIM, align: align || 'left',
  });
}
function title(c, ui, text, x, y) {
  ui.faces.draw(c, text, x, y, { face: 'blitz-brush', size: 44, fill: INK });
}

/* ============================================================ LEGEND SHEET */

export function drawProofSheet(c, t, ui) {
  bg(c);

  const rows = [
    { head: 'OFFENSE — PAGE 1', plays: offensePage(1), side: 'offense' },
    { head: 'OFFENSE — PAGE 2', plays: offensePage(2), side: 'offense' },
    { head: 'DEFENSE', plays: defense(), side: 'defense' },
  ];

  // Nine cards per band, three bands. 9 x 196 + 8 x 10 = 1844 wide, which fits inside
  // the 48 px insets; the card scale that follows is 196/436 = 0.45.
  const cw = 196, ch = 196 * (GRID.ch / GRID.cw), gx = 10;
  const scale = cw / GRID.cw;

  title(c, ui, 'EVERY PLAY IN THE BOOK', 48, 62);
  label(c, ui, `src/data/playbook.json — ${rows[0].plays.length + rows[1].plays.length} offensive plays over two `
    + `pages of nine, ${rows[2].plays.length} defensive calls. Same drawCard() as the screen, at `
    + `${scale.toFixed(2)} scale.`, 48, 96, 22, INK_DIM);

  let y = 140;
  for (const band of rows) {
    label(c, ui, band.head, 48, y + 18, 26, GOLD);
    label(c, ui, `${band.plays.length} CARDS`, 1872, y + 18, 20, INK_DIM, 'right');
    const y0 = y + 30;
    for (let i = 0; i < band.plays.length; i++) {
      const x = 48 + i * (cw + gx);
      c.save();
      c.translate(x, y0);
      drawCard(c, ui, band.plays[i], band.side, cw, ch, { selected: i === 0, scale, ordinal: i + 1 });
      c.restore();
    }
    y = y0 + ch + 40;
  }

  /* ---- the selection treatment, at 1.15x, both states of the same play ---- */
  const dScale = 1.0;
  const dw = GRID.cw * dScale, dh = GRID.ch * dScale;
  const demo = offensePage(1)[2];              // HAIL MARY: the deepest card in the book
  const dy = y + 34;
  label(c, ui, 'THE TWO CARD STATES, SAME PLAY, AT SCREEN SCALE', 48, y + 16, 24, GOLD);
  for (const [i, s] of [[0, false], [1, true]]) {
    c.save();
    c.translate(48 + i * (dw + 40), dy);
    drawCard(c, ui, demo, 'offense', dw, dh, { selected: s, scale: dScale, ordinal: 3 });
    c.restore();
  }

  /* ---- the two colour keys ---- */
  const kx0 = 48 + 2 * (dw + 40) + 20;
  let ky = dy + 6;
  label(c, ui, 'RECEIVER SLOT = HUE', kx0, ky, 22, INK);
  ky += 34;
  for (const s of REC_SLOTS.concat(['QB', 'OL'])) {
    c.fillStyle = SLOT[s];
    c.beginPath(); c.arc(kx0 + 10, ky - 7, 10, 0, Math.PI * 2); c.fill();
    label(c, ui, s, kx0 + 28, ky, 22, INK);
    ky += 30;
  }
  label(c, ui, 'constant across all 18 offensive cards', kx0, ky + 4, 19, INK_DIM);

  let ay = dy + 6;
  const ax = kx0 + 420;
  label(c, ui, 'ASSIGNMENT FAMILY = HUE', ax, ay, 22, INK);
  ay += 34;
  for (const k of ['rush', 'man', 'press', 'spy', 'zone_flat']) {
    c.fillStyle = ASSIGN[k];
    c.beginPath(); c.arc(ax + 10, ay - 7, 10, 0, Math.PI * 2); c.fill();
    label(c, ui, k === 'zone_flat' ? 'ZONE (3 DEPTHS)' : k.toUpperCase(), ax + 28, ay, 22, INK);
    ay += 30;
  }
  label(c, ui, 'contain: in the schema, unused here', ax, ay + 4, 19, INK_DIM);
}

/* ========================================================== GEOMETRY SHEET */

/** The shared depth curve, drawn as a ruler with its yard ticks. */
function drawRuler(c, ui, x, y, w, h) {
  const r = { x, y, w, h };
  const P = makeProj(r, { mode: 'route', losFrac: 0.80, padX: 6 });
  c.save();
  c.fillStyle = 'rgba(255,255,255,0.02)';
  c.fillRect(x, y, w, h);
  c.strokeStyle = 'rgba(120,140,190,0.25)';
  c.lineWidth = 1;
  c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

  // The labels live OUTSIDE the box: the first pass hung them inside at x+w-78 and
  // x+w-4, and "44 yd" ran straight through the percentage next to it.
  // Six ticks, not ten: the curve packs 30..44 into the top 20% of the box and ten
  // labels there sat on top of each other.
  for (const yd of [0, 5, 10, 20, 30, 44]) {
    const py = P.py(yd);
    c.strokeStyle = yd === 0 ? 'rgba(200,215,240,0.8)' : 'rgba(120,150,210,0.28)';
    c.lineWidth = yd === 0 ? 2 : 1;
    c.beginPath(); c.moveTo(x, py); c.lineTo(x + w, py); c.stroke();
    const f = Math.pow(Math.min(1, yd / MAX_DEPTH), DEPTH_POW);
    label(c, ui, `${yd} yd`, x + w + 12, py + 7, 20, yd === 0 ? INK : INK_DIM);
    label(c, ui, `${(f * 100).toFixed(0)}%`, x + w + 130, py + 7, 19, 'rgba(130,150,190,0.8)', 'right');
  }
  // The backfield half, where the QB's drop lives.
  for (const yd of [-4, -8]) {
    const py = P.py(yd);
    c.strokeStyle = 'rgba(210,150,90,0.30)';
    c.setLineDash([5, 5]);
    c.beginPath(); c.moveTo(x, py); c.lineTo(x + w, py); c.stroke();
    c.setLineDash([]);
    label(c, ui, `${yd} yd`, x + w + 12, py + 7, 20, 'rgba(210,160,100,0.85)');
  }
  c.restore();
  return P;
}

export function drawGeometrySheet(c, t, ui) {
  bg(c);
  title(c, ui, 'HOW THIS SCREEN WAS MEASURED', 48, 62);
  label(c, ui, 'Nothing on this sheet is drawn by a second code path — the cards below go through the same '
    + 'drawCard() the game calls.', 48, 96, 22, INK_DIM);

  /* ---- 1. the two cards at 1.74x, annotated ---- */
  // 2x was the first try and it left the bottom third of the sheet colliding with the
  // captions; 760 px leaves 470 px of clear sheet below for the ruler and the tables.
  const cardW = 760, cardH = Math.round(cardW * (GRID.ch / GRID.cw));
  const scale = cardW / GRID.cw;
  const off = allOffense().find((p) => p.id === 'upper_cut') || allOffense()[0];
  const def = defense().find((p) => p.id === 'zone_blitz') || defense()[0];

  const boxes = [
    { play: off, side: 'offense', x: 48, y: 130 },
    { play: def, side: 'defense', x: 1080, y: 130 },
  ];
  for (const b of boxes) {
    c.save();
    c.translate(b.x, b.y);
    drawCard(c, ui, b.play, b.side, cardW, cardH, { selected: false, scale, ordinal: 0 });
    c.restore();

    const r = { x: b.x, y: b.y, w: cardW, h: cardH };
    const d = diagramRect(r, scale);
    // The SAME projection the card just drew through — mode and scale included, or the
    // annotations would label positions the card does not have.
    const P = makeProj(d, { mode: b.side === 'offense' ? 'route' : 'cover', scale });
    c.save();
    if (b.side === 'offense') {
      // Every waypoint, with its yard coordinates, straight out of the JSON.
      for (const s of REC_SLOTS) {
        const pts = b.play.routes[s];
        if (!pts) continue;
        for (let i = 0; i < pts.length; i++) {
          const x = P.px(pts[i][0]), y = P.py(pts[i][1]);
          c.strokeStyle = rgba(SLOT[s], 0.9);
          c.lineWidth = 1.4;
          c.beginPath(); c.arc(x, y, 13, 0, Math.PI * 2); c.stroke();
          label(c, ui, `${pts[i][0]},${pts[i][1]}`, x + 17, y - 10, 17, rgba(SLOT[s], 0.95));
        }
      }
      label(c, ui, `${b.play.name} · kind ${b.play.kind} · primary ${b.play.primary} · clock ${b.play.clock} ticks`,
        b.x, b.y + cardH + 34, 22, INK);
      label(c, ui, 'circles are the waypoints in playbook.json, labelled x,y in yards', b.x, b.y + cardH + 64, 20, INK_DIM);
    } else {
      // Per-slot label offsets. The first pass put every label at (x+16, y-12) and
      // RUSH1's ran straight through RUSH2's — the two rushers are 5.2 yards apart and
      // their labels are 130 px wide.
      const OFF = {
        RUSH1: [-160, 36], RUSH2: [26, 36], ROVER: [30, 6],
        DB1: [26, 6], DB2: [26, -18], DB3: [-150, -20], DB4: [26, -20],
      };
      for (const s of DEF_SLOTS) {
        const at = FORMATION.defense[s];
        const x = P.px(at[0]), y = P.py(at[1]);
        const kind = b.play.assign[s];
        const o = OFF[s] || [24, 4];
        label(c, ui, `${s} ${String(kind).toUpperCase()}`, x + o[0], y + o[1], 17, rgba(ASSIGN[kind] || INK_DIM, 0.95));
      }
      label(c, ui, `${b.play.name} · rush ${b.play.rush} · cover ${b.play.cover} · risk ${b.play.risk}`,
        b.x, b.y + cardH + 34, 22, INK);
      label(c, ui, 'labels are the assign map, at the shipped formation coordinates',
        b.x, b.y + cardH + 64, 20, INK_DIM);
    }
    c.restore();
  }

  /* ---- 2. the depth ruler ---- */
  const ry = 690;
  label(c, ui, 'THE ROUTE DEPTH CURVE', 48, ry - 16, 24, GOLD);
  drawRuler(c, ui, 48, ry, 250, 240);
  label(c, ui, `up = (yd / ${MAX_DEPTH}) ^ ${DEPTH_POW}`, 48, ry + 272, 21, INK);
  label(c, ui, `down = (|yd| / ${MAX_BACK}) ^ ${BACK_POW}`, 48, ry + 298, 21, INK);
  label(c, ui, `half-width ${HALF_WIDTH} yd, widest route 20 yd`, 48, ry + 324, 19, INK_DIM);
  label(c, ui, `defence uses a LINEAR map over ${DEF_MAX_DEPTH} yd`, 48, ry + 348, 19, INK_DIM);

  /* ---- 3. the depth table, printed ---- */
  const tx = 560;
  label(c, ui, 'EVERY ROUTE DEPTH IN THE BOOK', tx, ry - 16, 24, GOLD);
  // Every distinct `depth` the book ships, in two columns of nine — one column of
  // eighteen ran 130 px off the bottom of the sheet.
  const depths = [...new Set(allOffense().map((p) => p.depth))].filter((d) => d > 0).sort((a, b) => a - b);
  const half = Math.ceil(depths.length / 2);
  for (let i = 0; i < depths.length; i++) {
    const yd = depths[i];
    const col = (i / half) | 0;
    const cx = tx + col * 250;
    const ty = ry + 20 + (i % half) * 30;
    const f = Math.pow(Math.min(1, yd / MAX_DEPTH), DEPTH_POW);
    label(c, ui, `${String(yd).padStart(2, ' ')} yd`, cx, ty, 21, INK);
    c.fillStyle = 'rgba(255,255,255,0.07)';
    c.fillRect(cx + 70, ty - 13, 110, 16);
    c.fillStyle = rgba(GOLD, 0.85);
    c.fillRect(cx + 70, ty - 13, 110 * f, 16);
    label(c, ui, `${(f * 100).toFixed(0)}%`, cx + 228, ty, 20, INK_DIM, 'right');
  }

  /* ---- 4. the bar measurements ---- */
  const bx = 1080;
  label(c, ui, 'MEASURED OFF bar/panel-defense_playcall.png', bx, ry - 16, 24, GOLD);
  const lines = [
    `panel ${BAR.panel[0]}x${BAR.panel[1]}, light frame at row 3 / cols 4-5`,
    `interior origin ${BAR.interiorOrigin[0]},${BAR.interiorOrigin[1]} size ${BAR.interior[0]}x${BAR.interior[1]}`,
    `scale 1080 / ${BAR.interior[1]} = ${BAR.scale.toFixed(4)} logical px per panel px`,
    `headline ink x ${BAR.headlineInk[0]}..${BAR.headlineInk[2]} y ${BAR.headlineInk[1]}..${BAR.headlineInk[3]}  -> cap ${Math.round((BAR.headlineInk[3] - BAR.headlineInk[1]) * BAR.scale)} px`,
    `clock ink x ${BAR.clockInk[0]}..${BAR.clockInk[2]}  -> cap ${Math.round((BAR.clockInk[3] - BAR.clockInk[1]) * BAR.scale)} px`,
    `card columns at ${BAR.cardCols.join(', ')}  pitch ${((BAR.cardCols[3] - BAR.cardCols[0]) / 3).toFixed(2)} px`,
    `bar card ${BAR.card[0]}x${BAR.card[1]} panel = ${Math.round(BAR.card[0] * BAR.scale)}x${Math.round(BAR.card[1] * BAR.scale)} logical`,
    `bar name plate = ${(((BAR.cardRows[0] + BAR.card[1] - BAR.cardDivider) / BAR.card[1]) * 100).toFixed(0)}% of the card; ours ${((CARD.plate / GRID.ch) * 100).toFixed(0)}%`,
    `bar grid 4x2 of 8; this book needs 3x3 of 9 -> card ${GRID.cw}x${GRID.ch}, gap ${GRID.gx}/${GRID.gy}`,
    `grid right edge ${GRID.x + GRID.cols * GRID.cw + (GRID.cols - 1) * GRID.gx} = the 48 px safe inset`,
  ];
  let ly = ry + 24;
  for (const s of lines) { label(c, ui, s, bx, ly, 21, INK_DIM); ly += 29; }

  c.save();
  c.strokeStyle = 'rgba(120,140,190,0.25)';
  c.lineWidth = 1;
  c.stroke(rr(bx - 18, ry - 44, 810, ly - ry + 44, 10));
  c.restore();
}

export default { drawProofSheet, drawGeometrySheet };
