// PIECE menu-team-select — the isolation specimen sheets.
//
// Three sheets that pose things the shipping screen cannot pose at once:
//
//   iso_team_select_league   all 32 clubs, each with its crest, its official colour
//                            strip straight out of teams.json, and the three club
//                            stats as NUMBERS beside the bars. This is the audit
//                            sheet: if a bar disagrees with the number, or a colour
//                            disagrees with the strip, it is visible here.
//   iso_team_select_states   selected against unselected, the meter at eleven fills,
//                            the four clubs whose official primary is darkest, and
//                            the measured panel geometry printed over the live layout.
//   iso_team_select_touch    hit rectangles with their real millimetre sizes on two
//                            device surfaces, computed through the overlay's own fit.
//
// They are drawn INTO THE ui.teamSelect SLOT, which this piece owns, only when the
// running scene id is one of this piece's own iso scenes. Nothing else is affected.

import { rr, lin, rgba, drawFit, luma } from './chrome.js';
import { paletteOf, PAPER, PAPER_DIM, GOLD, GOLD_HI, GROUND } from './palette.js';
import {
  W, H, CARD, C, SEGMENTS, STAT_LABELS, cardX, LIFT, hitTargets, reachReport,
} from './layout.js';
import { card as bakeCard, segBar } from './card.js';
import { drawScreen } from './screen.js';
import { statsOf, starOf, shortName, divisionsOf } from './league.js';

const SHEETS = {
  iso_team_select_league: league,
  iso_team_select_states: states,
  iso_team_select_touch: touch,
};

export function isSheet(id) { return !!SHEETS[id]; }
export function drawSheet(id, c, t, state, ui) {
  const fn = SHEETS[id];
  if (!fn) return;
  c.save();
  try { fn(c, t, state, ui); } finally { c.restore(); }
}

/* ------------------------------------------------------------------ shared */

function ground(c) {
  c.fillStyle = GROUND;
  c.fillRect(0, 0, W, H);
  c.fillStyle = 'rgba(255,255,255,0.02)';
  for (let y = 0; y < H; y += 4) c.fillRect(0, y, W, 1);
}

function head(c, faces, title, sub) {
  drawFit(c, faces, title, 64, 74, {
    face: 'blitz-brush', cap: 52, fill: PAPER, maxW: 1200,
  });
  if (sub) {
    drawFit(c, faces, sub, 64, 108, {
      face: 'blitz-block', cap: 19, fill: PAPER_DIM, tracking: 0.06, maxW: 1790,
    });
  }
}

function note(c, faces, lines, x, y, cap, fill, maxW) {
  let yy = y;
  for (const s of lines) {
    drawFit(c, faces, s, x, yy, { face: 'blitz-block', cap: cap || 16, fill: fill || PAPER_DIM, tracking: 0.04, maxW: maxW || 1800 });
    yy += (cap || 16) * 1.85;
  }
  return yy;
}

/* ================================================================== LEAGUE */

function league(c, t, state, ui) {
  const faces = ui.faces;
  ground(c);
  head(c, faces, 'THE LEAGUE', '32 CLUBS. CREST, OFFICIAL COLOURS FROM SRC/DATA/TEAMS.JSON, AND THE THREE CLUB STATS AS NUMBERS - BRAND-IDENTITYS RATINGS-DERIVED VALUES X100, THE SAME NUMBERS THE BARS DRAW.');

  const groups = divisionsOf(ui.brand);
  const teams = [];
  for (const g of groups) for (const tm of g.teams) teams.push(tm);

  const cols = 8, rows = 4;
  const tw = 212, th = 207, gx = 12, gy = 30;
  const x0 = Math.round((W - (cols * tw + (cols - 1) * gx)) / 2);
  const y0 = 150;

  for (let i = 0; i < teams.length && i < cols * rows; i++) {
    const tm = teams[i];
    const x = x0 + (i % cols) * (tw + gx);
    const y = y0 + Math.floor(i / cols) * (th + gy);
    miniCard(c, ui, tm, x, y, tw, th);
  }

  // division ladder down the left of each row is implicit in the ordering; name it.
  for (let r = 0; r < rows; r++) {
    const g0 = groups[r * 2], g1 = groups[r * 2 + 1];
    if (!g0) continue;
    const y = y0 + r * (th + gy) - 12;
    drawFit(c, faces, `${g0.label}   /   ${g1 ? g1.label : ''}`, x0, y, {
      face: 'blitz-block', cap: 14, fill: rgba(GOLD, 0.75), tracking: 0.12, maxW: 900,
    });
  }
}

function miniCard(c, ui, team, x, y, w, h) {
  const faces = ui.faces;
  const P = paletteOf(team);
  c.save();
  rr(c, x, y, w, h, 10);
  c.clip();
  c.fillStyle = lin(c, 0, y, 0, y + h, [[0, P.mid], [0.5, P.deep], [1, GROUND]]);
  c.fillRect(x, y, w, h);

  let img = null;
  try { img = ui.brand.crest(team.id, 96); } catch (e) { img = null; }
  if (img) c.drawImage(img, x + 6, y + 8, 96, 96);

  drawFit(c, faces, team.abbr || team.id, x + 110, y + 44, {
    face: 'blitz-block', cap: 30, fill: P.name, tracking: 0.02, maxW: w - 118,
  });
  drawFit(c, faces, String(team.city || ''), x + 110, y + 66, {
    face: 'blitz-block', cap: 13, fill: PAPER_DIM, tracking: 0.06, maxW: w - 118,
  });
  drawFit(c, faces, String(team.name || ''), x + 110, y + 88, {
    face: 'blitz-block', cap: 16, fill: PAPER, tracking: 0.02, maxW: w - 118,
  });

  const vals = statsOf(team);
  for (let i = 0; i < 3; i++) {
    const by = y + 106 + i * 24;
    drawFit(c, faces, STAT_LABELS[i], x + 8, by + 13, {
      face: 'blitz-block', cap: 12, fill: PAPER_DIM, tracking: 0.04, maxW: 62,
    });
    segBar(c, x + 74, by, 100, 16, vals[i]);
    drawFit(c, faces, String(Math.round(vals[i] * 100)), x + w - 8, by + 13, {
      face: 'blitz-num', cap: 15, align: 'right', fill: GOLD_HI,
    });
  }

  // official colour strip — every hex on this row is literally in teams.json
  const offs = P.officials.slice(0, 4);
  const sw = (w - 16) / Math.max(1, offs.length);
  for (let i = 0; i < offs.length; i++) {
    c.fillStyle = offs[i];
    c.fillRect(x + 8 + i * sw, y + h - 30, sw - 3, 10);
  }
  const st = starOf(team);
  if (st) {
    drawFit(c, faces, `${st.num}  ${shortName(st.name)}  ${st.pos}`, x + 8, y + h - 8, {
      face: 'blitz-block', cap: 12, fill: rgba(PAPER, 0.7), tracking: 0.03, maxW: w - 16,
    });
  }
  c.restore();
  c.lineWidth = 1.5;
  c.strokeStyle = rgba(P.key, 0.55);
  rr(c, x, y, w, h, 10);
  c.stroke();
}

/* ================================================================== STATES */

function states(c, t, state, ui) {
  const faces = ui.faces;
  ground(c);
  head(c, faces, 'CARD STATES', 'SELECTED AGAINST UNSELECTED, THE METER AT ELEVEN FILLS, AND THE SIX CLUBS WHOSE OFFICIAL PRIMARY IS DARKEST.');

  const brand = ui.brand;
  const pick = (id) => (brand && brand.byId ? brand.byId(id) : null);

  /* ---- 1. the two states, full size ------------------------------------- */
  // The SAME club in both states, so the only difference on screen is the state.
  const kc = pick('KC');
  const y = 138;
  c.drawImage(bakeCard(ui, kc, true, 1), 64, y - LIFT, CARD.w, CARD.h);
  c.drawImage(bakeCard(ui, kc, false, 1), 64 + CARD.w + 36, y, CARD.w, CARD.h);
  drawFit(c, faces, 'SELECTED - LIFTED 14, KEYLINE 3PX FULL CHROMA, BLOOM', 64, y + CARD.h + 32, {
    face: 'blitz-block', cap: 15, fill: GOLD, tracking: 0.05, maxW: CARD.w + 16,
  });
  drawFit(c, faces, 'UNSELECTED - 44 PCT INK VEIL, KEYLINE 2PX AT 30 PCT', 64 + CARD.w + 36, y + CARD.h + 32, {
    face: 'blitz-block', cap: 15, fill: PAPER_DIM, tracking: 0.05, maxW: CARD.w + 16,
  });

  /* ---- 2. the meter ladder ---------------------------------------------- */
  const lx = 856, ly = 150;
  drawFit(c, faces, 'THE METER, 0.00 TO 1.00 IN ELEVENTHS', lx, ly, {
    face: 'blitz-block', cap: 17, fill: PAPER, tracking: 0.07, maxW: 500,
  });
  for (let i = 0; i <= SEGMENTS; i++) {
    const v = i / SEGMENTS;
    const by = ly + 20 + i * 32;
    drawFit(c, faces, v.toFixed(2), lx, by + 20, { face: 'blitz-num', cap: 16, fill: PAPER_DIM });
    segBar(c, lx + 72, by, C.trackW, 26, v);
  }
  drawFit(c, faces, 'THE LAST LIT CELL IS FRACTIONAL - THE CLUB STATS ARE', lx, ly + 20 + 12 * 32 + 26, {
    face: 'blitz-block', cap: 14, fill: PAPER_DIM, tracking: 0.04, maxW: 440,
  });
  drawFit(c, faces, 'CONTINUOUS AND ROUNDING TO ELEVENTHS WOULD SHOW TWO', lx, ly + 20 + 12 * 32 + 50, {
    face: 'blitz-block', cap: 14, fill: PAPER_DIM, tracking: 0.04, maxW: 440,
  });
  drawFit(c, faces, 'CLUBS FOUR POINTS APART AS IDENTICAL.', lx, ly + 20 + 12 * 32 + 74, {
    face: 'blitz-block', cap: 14, fill: PAPER_DIM, tracking: 0.04, maxW: 440,
  });

  /* ---- 3. the same pair at the phone fit --------------------------------- */
  const k = 0.3611;
  const px = 856, py = 648;
  c.drawImage(bakeCard(ui, kc, true, 1), px, py, CARD.w * k, CARD.h * k);
  c.drawImage(bakeCard(ui, kc, false, 1), px + CARD.w * k + 12, py, CARD.w * k, CARD.h * k);
  note(c, faces, [
    'THE SAME PAIR AT 0.361 - THE CONTAIN-FIT OF A',
    '844 X 390 LANDSCAPE PHONE, AND THE SIZE THE',
    'SELECTED STATE ACTUALLY HAS TO SURVIVE.',
  ], px + 2 * CARD.w * k + 28, py + 40, 14, PAPER_DIM, 262);

  /* ---- 4. the dark-primary clubs ---------------------------------------- */
  const dark = ['LV', 'CHI', 'HOU', 'NE', 'JAX', 'CLE'].map(pick).filter(Boolean);
  const dx = 1420, dy = 150;
  drawFit(c, faces, 'DARK PRIMARIES, RESCUED BY BEACON()', dx, dy, {
    face: 'blitz-block', cap: 17, fill: PAPER, tracking: 0.07, maxW: 440,
  });
  drawFit(c, faces, 'OFFICIAL PRIMARY / ITS LUMA / THE NAME COLOUR DRAWN', dx, dy + 26, {
    face: 'blitz-block', cap: 13, fill: PAPER_DIM, tracking: 0.04, maxW: 440,
  });
  for (let i = 0; i < dark.length; i++) {
    const tm = dark[i];
    const P = paletteOf(tm);
    const yy = dy + 56 + i * 92;
    const prim = (tm.colors && tm.colors.primary) || '#000';
    c.fillStyle = prim;
    c.fillRect(dx, yy, 60, 60);
    c.strokeStyle = 'rgba(255,255,255,0.25)'; c.lineWidth = 1;
    c.strokeRect(dx + 0.5, yy + 0.5, 59, 59);
    c.fillStyle = P.name;
    c.fillRect(dx + 68, yy, 60, 60);
    drawFit(c, faces, `${prim.toUpperCase()}  L=${luma(prim).toFixed(2)}  ->  ${P.name.toUpperCase()}  L=${luma(P.name).toFixed(2)}`, dx + 140, yy + 26, {
      face: 'blitz-block', cap: 14, fill: PAPER_DIM, tracking: 0.03, maxW: 360,
    });
    drawFit(c, faces, String(tm.name), dx + 140, yy + 56, {
      face: 'blitz-block', cap: 22, fill: P.name, tracking: 0.02, maxW: 360,
    });
  }

  /* ---- 5. the measured geometry ----------------------------------------- */
  note(c, faces, [
    'PANEL-TEAM_SELECT.PNG IS 480X310. CARD BORDERS MEASURED AT X 25.0 / 137.5 / 250.0 / 362.0 AND 127.5 / 240.5 / 353.0 / 464.5',
    'CARD 102.8 WIDE X 228.0 TALL, ASPECT 0.451. GOLD BAR ROWS AT 0.752 / 0.840 / 0.923 OF THE CARD, 11 SEGMENTS PER TRACK.',
    `SHIPPED: 4 CARDS ${CARD.w}X${CARD.h} (ASPECT ${(CARD.w / CARD.h).toFixed(3)}) AT X ${cardX(0)} / ${cardX(1)} / ${cardX(2)} / ${cardX(3)}, BAR ROWS AT ${(C.barY[0] / CARD.h).toFixed(3)} / ${(C.barY[1] / CARD.h).toFixed(3)} / ${(C.barY[2] / CARD.h).toFixed(3)}.`,
    'THE CARDS ARE 20 PCT WIDER IN PROPORTION THAN THE PANELS BECAUSE THE REAL NICKNAMES RUN TO PHILADELPHIA AND BUCCANEERS WHERE THE ART ONLY HAD TO FIT STRYKERS.',
  ], 64, 932, 15, PAPER_DIM, 1790);
}

/* =================================================================== TOUCH */

function touch(c, t, state, ui) {
  const faces = ui.faces;
  // Draw the real screen first, then dim it and lay the rectangles over the top, so
  // the targets can be checked against the artwork they are supposed to belong to.
  drawScreen(c, t, state, ui);
  c.fillStyle = 'rgba(3,4,8,0.72)';
  c.fillRect(0, 0, W, H);

  const R844 = reachReport(844, 390);
  const R1024 = reachReport(1024, 768);
  const byId = new Map(R844.targets.map((x) => [x.id, x]));

  for (const r of hitTargets()) {
    const m = byId.get(r.id);
    const ok = m.short >= 9;
    c.lineWidth = 2;
    c.setLineDash([10, 7]);
    c.strokeStyle = ok ? 'rgba(120,230,150,0.95)' : 'rgba(240,90,80,0.95)';
    c.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    c.setLineDash([]);
    c.fillStyle = ok ? 'rgba(120,230,150,0.08)' : 'rgba(240,90,80,0.12)';
    c.fillRect(r.x, r.y, r.w, r.h);
    drawFit(c, faces, `${m.wmm.toFixed(1)} X ${m.hmm.toFixed(1)} MM`, r.x + r.w / 2, r.y + r.h / 2 + 6, {
      face: 'blitz-block', cap: 17, align: 'center',
      fill: ok ? '#c9f4d4' : '#ffc9c4', tracking: 0.05, maxW: r.w - 12,
    });
  }

  // an opaque band so the sheet's own head never fights the screen's title
  c.fillStyle = '#04050a';
  c.fillRect(0, 0, W, 126);
  head(c, faces, 'REACH', 'EVERY HIT RECTANGLE ON THIS SCREEN, MEASURED IN MILLIMETRES THROUGH THE OVERLAYS OWN CONTAIN-FIT.');

  const lines = [
    `844 X 390 LANDSCAPE PHONE : FIT ${R844.fit.toFixed(4)}, 1 LOGICAL PX = ${(R844.mmPerLogicalPx).toFixed(4)} MM`,
    `1024 X 768 TABLET : FIT ${R1024.fit.toFixed(4)}, 1 LOGICAL PX = ${(R1024.mmPerLogicalPx).toFixed(4)} MM`,
    'MM PER CSS PX = 0.18333, THE CONSTANT TOUCH-CONTROLLER/LAYOUT.JS PINS THE PHYSICAL SCALE AT.',
  ];

  c.fillStyle = 'rgba(4,6,11,0.94)';
  c.fillRect(56, 782, 1210, 272);
  c.strokeStyle = rgba(GOLD, 0.5); c.lineWidth = 2;
  c.strokeRect(56, 782, 1210, 272);
  note(c, faces, lines, 76, 814, 15, PAPER, 1170);

  // The table is drawn as COLUMNS, not as padded strings: blitz-block is
  // proportional, so a monospace-style pad() lines nothing up. (It was tried; the
  // 207.75 and the 13.8 ran into each other.)
  const COL = [76, 300, 470, 700, 940];
  const rows = [['TARGET', 'LOGICAL PX', '844X390 MM', '1024X768 MM', 'SHORT AXIS']];
  for (const id of ['page-prev', 'card-0', 'div-0']) {
    const a = byId.get(id);
    const b = R1024.targets.find((x) => x.id === id);
    const rect = hitTargets().find((x) => x.id === id);
    rows.push([
      id.toUpperCase(),
      `${Math.round(rect.w * 100) / 100} X ${rect.h}`,
      `${a.wmm.toFixed(1)} X ${a.hmm.toFixed(1)}`,
      `${b.wmm.toFixed(1)} X ${b.hmm.toFixed(1)}`,
      `${a.short.toFixed(1)} MM`,
    ]);
  }
  for (let r = 0; r < rows.length; r++) {
    const yy = 900 + r * 30;
    for (let k = 0; k < rows[r].length; k++) {
      drawFit(c, faces, rows[r][k], COL[k], yy, {
        face: 'blitz-block', cap: 15,
        fill: r === 0 ? rgba(GOLD, 0.9) : PAPER, tracking: 0.04, maxW: 210,
      });
    }
  }

  const worst = R844.targets.reduce((m, x) => (x.short < m.short ? x : m), R844.targets[0]);
  drawFit(c, faces, `SMALLEST SHORT AXIS ANYWHERE ON THIS SCREEN: ${worst.id.toUpperCase()} AT ${worst.short.toFixed(1)} MM. THE FLOOR IS 9 MM.`, 76, 1032, {
    face: 'blitz-block', cap: 16, fill: '#c9f4d4', tracking: 0.04, maxW: 1170,
  });
}

export default { isSheet, drawSheet };
