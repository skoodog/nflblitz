// PIECE hud-overlay — the top-left scoreboard cluster.
//
// GEOMETRY IS MEASURED, NOT GUESSED. bar/panel-qb_dropback.png is 553x338 for a
// 1080-tall frame, so 1 panel px = 3.195 logical px. Every number below is a
// bounding box read off that panel and converted:
//
//   plate            48,42  ->  629 x 106      (left edge == ui.safe.l exactly)
//   clock ink        rel  51..118 x   12..70   ink height 58
//   down+dist ink    rel  54..137 x   73..99   ink height 26
//   abbr ink         rel 134..204 x   22..60   ink height 38
//   score ink        rel 236..332 x    9..67   ink height 61
//   crest chip       rel 358..399
//   momentum strip   rel        y   86..97
//
// The bar gives the LEFT team no crest and the RIGHT team one; that asymmetry is
// real and is reproduced. The left cap is the two bone-coloured chips the panel
// shows: quarter above, timeouts below.
//
// COST: baked to one offscreen canvas on state change, blitted once per frame.

import {
  mkCanvas, rr, vgrad, hgrad, rgba, mix, lighten, darken, brighten, hudColor,
  grain, brushed, innerEdge, gloss,
} from './chrome.js';

/* ------------------------------------------------------------- geometry */

export const PLATE = { x: 48, y: 42, w: 632, h: 106, r: 12 };
const MG = 24;

const CT = 5, CB = 101;                 // sub-panel top / bottom inside the plate

const CAP = { x: 4, w: 26 };
const CLK = { x: 34, w: 108 };
const A_AB = { x: 148, w: 76 };
const A_SC = { x: 228, w: 116 };
const DIV = 348;
const B_CR = { x: 354, w: 48 };
const B_AB = { x: 406, w: 76 };
const B_SC = { x: 490, w: 138 };

const Y_CLOCK = 70;                     // baselines, plate-relative
const Y_DD = 99;
const Y_ABBR = 60;
const Y_SCORE = 67;
const MOM = { y: 86, h: 11 };

const SZ_CLOCK = 69;                    // blitz-num ink height ~= 0.84 * size
const SZ_DD = 36;                       // blitz-block cap == 0.70 * size
const SZ_ABBR = 55;
const SZ_SCORE = 73;

/* --------------------------------------------------------------- palette */

const PLATE_STOPS = [
  [0.00, 'rgba(44,54,71,0.93)'],
  [0.06, 'rgba(25,32,45,0.91)'],
  [0.50, 'rgba(12,17,26,0.89)'],
  [0.86, 'rgba(8,11,18,0.91)'],
  [1.00, 'rgba(17,23,33,0.93)'],
];
const BONE = '#e7e2d4';

let cv = null, cx = null;
let quality = 1;
export function setQuality(q) { quality = q; }

/* ------------------------------------------------------------- primitives */

function shadowRing(c, path, blur, dy, alpha) {
  c.save();
  c.shadowColor = `rgba(2,5,11,${alpha})`;
  c.shadowBlur = blur;
  c.shadowOffsetY = dy;
  c.fillStyle = 'rgba(0,0,0,0.99)';
  c.fill(path);
  c.restore();
  c.save();
  c.globalCompositeOperation = 'destination-out';
  c.fill(path);
  c.restore();
}

/** A sub-panel: barely-there fill, a lit top edge and a shadowed bottom edge. */
function cellPlate(c, x, w, tint, tintA, r) {
  const y = CT, h = CB - CT;
  const p = rr(x, y, w, h, r === undefined ? 6 : r);
  c.fillStyle = vgrad(c, y, y + h, [
    [0, rgba(tint, tintA * 1.35)],
    [0.55, rgba(tint, tintA * 0.62)],
    [1, rgba(darken(tint, 0.5), tintA * 1.05)],
  ]);
  c.fill(p);
  innerEdge(c, p, 0, 1.0, 'rgba(196,222,255,0.14)', 'rgba(0,0,0,0.34)', 1.3);
  return p;
}

/**
 * The momentum strip. Inset track, saturated team-colour fill with a
 * longitudinal gloss and a hot leading edge. Never a flat rectangle.
 */
function momentumSeg(c, x, w, v0, v1, fill, accent, primary) {
  const y = MOM.y, h = MOM.h;
  const track = rr(x, y, w, h, 2.5);
  c.fillStyle = vgrad(c, y, y + h, [
    [0, 'rgba(1,2,5,0.95)'],
    [0.5, 'rgba(10,14,22,0.92)'],
    [1, 'rgba(34,42,58,0.88)'],
  ]);
  c.fill(track);
  innerEdge(c, track, 0, 1.0, 'rgba(0,0,0,0.6)', 'rgba(150,180,220,0.18)', 1.2);

  // v0..v1 is this segment's slice of the team's 0..1 meter
  const span = v1 - v0;
  const frac = span <= 0 ? 0 : Math.max(0, Math.min(1, (fill - v0) / span));
  const showLead = fill > v0 && fill < v1;
  const fw = w * frac;
  if (fw > 1) {
    const hot = brighten(accent, 1.30);
    const deep = mix(darken(primary, 0.25), accent, 0.42);
    c.save();
    c.clip(track);
    c.fillStyle = hgrad(c, x, x + Math.max(4, fw), [
      [0.00, rgba(deep, 1)],
      [0.45, rgba(accent, 1)],
      [1.00, rgba(hot, 1)],
    ]);
    c.fillRect(x, y, fw, h);
    c.fillStyle = vgrad(c, y, y + h, [
      [0.00, 'rgba(255,255,255,0.24)'],
      [0.26, 'rgba(255,255,255,0.06)'],
      [0.46, 'rgba(255,255,255,0.00)'],
      [1.00, 'rgba(0,0,0,0.42)'],
    ]);
    c.fillRect(x, y, fw, h);
    if (showLead && frac < 0.995) {
      c.shadowColor = rgba(hot, 0.95);
      c.shadowBlur = 8;
      c.fillStyle = rgba(lighten(accent, 0.55), 0.95);
      c.fillRect(x + fw - 2, y, 2, h);
      c.shadowBlur = 0;
    }
    c.restore();
  }
  c.save();
  c.clip(track);
  c.fillStyle = 'rgba(0,0,0,0.38)';
  const seg = Math.max(2, Math.round(w / 34));
  for (let i = 1; i < seg; i++) c.fillRect(x + (w * i) / seg - 0.6, y, 1.2, h);
  c.restore();
  c.strokeStyle = 'rgba(160,190,230,0.13)';
  c.lineWidth = 1;
  c.stroke(track);
}

/* ------------------------------------------------------------------- type */

function scoreType(F, c, txt, x, y, size, align) {
  F.draw(c, txt, x, y, {
    face: 'blitz-num',
    size,
    align,
    gradient: [
      [0.00, '#ffffff'],
      [0.46, '#fbfdff'],
      [0.74, '#dbe4f0'],
      [0.92, '#b3c0d2'],
      [1.00, '#9dabbf'],
    ],
    outline: 'rgba(3,6,12,0.95)',
    outlineWidth: size * 0.052,
    shadow: { color: 'rgba(0,4,11,0.80)', blur: size * 0.16, dy: size * 0.05 },
    emboss: 0.15 * quality,
    grain: 0,
  });
}

const ABBR_G = [[0.00, '#ffffff'], [0.5, '#eef3fa'], [1.00, '#b8c4d6']];

function labelType(F, c, txt, x, y, size, align, tint, track) {
  return F.draw(c, txt, x, y, {
    face: 'blitz-block',
    size,
    align,
    tracking: track,
    gradient: tint || ABBR_G,
    outline: 'rgba(3,6,12,0.90)',
    outlineWidth: size * 0.058,
    shadow: { color: 'rgba(0,4,11,0.66)', blur: size * 0.15, dy: size * 0.05 },
    emboss: 0,
    grain: 0,
  });
}

/* ------------------------------------------------------------------ chips */

/** A bone-coloured chip: the panel's two little light blocks at the far left. */
function boneChip(c, x, y, w, h) {
  const p = rr(x, y, w, h, 3);
  c.save();
  c.shadowColor = 'rgba(0,2,6,0.7)';
  c.shadowBlur = 5;
  c.shadowOffsetY = 2;
  c.fillStyle = vgrad(c, y, y + h, [
    [0, '#fbf8ef'],
    [0.42, BONE],
    [1, '#a9a496'],
  ]);
  c.fill(p);
  c.restore();
  innerEdge(c, p, 0, 1.0, 'rgba(255,255,255,0.85)', 'rgba(60,54,40,0.45)', 1.2);
  c.strokeStyle = 'rgba(30,28,22,0.55)';
  c.lineWidth = 1;
  c.stroke(p);
  return p;
}

/* ------------------------------------------------------------- team block */

function teamBlock(c, ui, id, score, mom, crestCell, abbrCell, scoreCell, possess) {
  const F = ui.faces;
  const team = (ui.brand && ui.brand.byId) ? ui.brand.byId(id) : null;
  const col = (team && team.colors) || { primary: '#20242c', accent: '#8fa8c8' };
  const accent = hudColor(col);

  const left = crestCell ? crestCell.x : abbrCell.x;
  const right = scoreCell.x + scoreCell.w;

  // ONE panel per team — the bar reads as four plates, not seven buttons.
  const block = cellPlate(c, left, right - left, [30, 41, 60], 0.28, 7);
  // internal hairlines where the crest and the score begin
  c.save();
  c.clip(block);
  c.fillStyle = 'rgba(0,0,0,0.42)';
  if (crestCell) c.fillRect(abbrCell.x - 3, CT + 4, 1, CB - CT - 8);
  c.fillRect(scoreCell.x - 3, CT + 4, 1, CB - CT - 8);
  c.fillStyle = 'rgba(176,204,244,0.13)';
  if (crestCell) c.fillRect(abbrCell.x - 2, CT + 4, 1, CB - CT - 8);
  c.fillRect(scoreCell.x - 2, CT + 4, 1, CB - CT - 8);

  // team-colour wash across the block, strongest at its leading edge
  c.fillStyle = hgrad(c, left, left + (right - left) * 0.46, [
    [0, rgba(accent, 0.085)],
    [0.5, rgba(accent, 0.025)],
    [1, rgba(accent, 0)],
  ]);
  c.fillRect(left, CT, right - left, CB - CT);
  c.restore();

  if (crestCell && ui.brand && ui.brand.crest) {
    try {
      const img = ui.brand.crest(id, 128);
      if (img) {
        const s = 42;
        // a soft accent bloom behind the mark so a dark crest does not read as
        // a brown smudge at 42 px on a near-black plate
        const gx = crestCell.x + crestCell.w / 2, gy = CT + 5 + s / 2;
        const rg = c.createRadialGradient(gx, gy, 1, gx, gy, s * 0.62);
        rg.addColorStop(0, rgba(accent, 0.30));
        rg.addColorStop(0.6, rgba(accent, 0.10));
        rg.addColorStop(1, rgba(accent, 0));
        c.fillStyle = rg;
        c.fillRect(crestCell.x, CT, crestCell.w, CB - CT);
        c.save();
        c.shadowColor = 'rgba(0,3,8,0.75)';
        c.shadowBlur = 6;
        c.shadowOffsetY = 2;
        c.drawImage(img, crestCell.x + (crestCell.w - s) / 2, CT + 5, s, s);
        c.restore();
      }
    } catch (e) { /* a brand that throws must not take the HUD with it */ }
  }

  labelType(F, c, String(id || '').toUpperCase(), abbrCell.x + 4, Y_ABBR, SZ_ABBR, 'left');
  scoreType(F, c, String(score), scoreCell.x + scoreCell.w - 8, Y_SCORE, SZ_SCORE, 'right');

  // possession: a lit accent bead on the block's leading edge
  if (possess) {
    c.save();
    c.shadowColor = rgba(accent, 0.8);
    c.shadowBlur = 5;
    c.fillStyle = rgba(lighten(accent, 0.45), 0.9);
    c.fillRect(left + 2, CT + 9, 2.2, CB - CT - 18);
    c.restore();
  }

  // momentum: one meter across the block, broken at the cell gaps so it reads
  // segmented exactly the way the panel's strip does
  const fill = Math.max(0, Math.min(1, mom));
  const segs = crestCell
    ? [[abbrCell.x - 1, abbrCell.w - 4], [scoreCell.x + 1, scoreCell.w - 8]]
    : [[abbrCell.x + 3, abbrCell.w - 6], [scoreCell.x + 1, scoreCell.w - 8]];
  let total = 0;
  for (const s of segs) total += s[1];
  let acc = 0;
  for (const s of segs) {
    const v0 = acc / total, v1 = (acc + s[1]) / total;
    momentumSeg(c, s[0], s[1], v0, v1, fill, accent, col.primary);
    acc += s[1];
  }

  // accent hairline riding the block's bottom edge
  c.fillStyle = hgrad(c, left, right, [
    [0, rgba(accent, 0)],
    [0.12, rgba(accent, 0.42)],
    [0.88, rgba(accent, 0.42)],
    [1, rgba(accent, 0)],
  ]);
  c.fillRect(left, CB - 1.6, right - left, 1.6);
}

/* ------------------------------------------------------------------ bake */

export function bake(ui, S, k) {
  const s = k || 1;
  const W = Math.round(BOX.w * s), H = Math.round(BOX.h * s);
  if (!cv) { cv = mkCanvas(W, H); cx = cv.getContext('2d'); }
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const c = cx;
  const F = ui.faces;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, W, H);
  c.setTransform(s, 0, 0, s, 0, 0);
  c.translate(MG, MG);
  c.lineJoin = 'round';
  c.miterLimit = 2;

  const plate = rr(0, 0, PLATE.w, PLATE.h, PLATE.r);

  shadowRing(c, plate, 20, 6, 0.74);
  c.fillStyle = vgrad(c, 0, PLATE.h, PLATE_STOPS);
  c.fill(plate);
  brushed(c, plate, 0, 0, PLATE.w, PLATE.h, 0x51a7, 0.8 * quality);
  grain(c, plate, 0, 0, PLATE.w, PLATE.h, 0x2c19, 0.7 * quality);
  gloss(c, plate, 0, 0, PLATE.w, PLATE.h * 0.6, 0.05, 0.5);
  innerEdge(c, plate, 0, 1.4, 'rgba(206,228,255,0.32)', 'rgba(0,0,0,0.55)', 1.6);
  c.strokeStyle = 'rgba(126,156,196,0.24)';
  c.lineWidth = 1.1;
  c.stroke(plate);

  /* ---- left cap: quarter chip over timeout chip ------------------------ */
  const chipW = 20, chipX = CAP.x + (CAP.w - chipW) / 2;
  boneChip(c, chipX, 10, chipW, 54);
  c.save();
  c.translate(chipX + chipW / 2, 37);
  c.rotate(-Math.PI / 2);
  F.draw(c, S.quarter, 0, 5, {
    face: 'blitz-block', size: 15, align: 'center', tracking: 0.07,
    fill: '#191d26', grain: 0,
  });
  c.restore();

  boneChip(c, chipX, 72, chipW, 24);
  for (let i = 0; i < 3; i++) {
    c.fillStyle = i < S.timeouts ? '#1d222c' : 'rgba(29,34,44,0.28)';
    c.beginPath();
    c.arc(chipX + chipW / 2, 78.5 + i * 5.6, 1.8, 0, Math.PI * 2);
    c.fill();
  }

  /* ---- clock cell ------------------------------------------------------ */
  const clp = cellPlate(c, CLK.x, CLK.w, [52, 86, 138], 0.42);
  c.save();
  c.clip(clp);
  c.fillStyle = vgrad(c, CT, CB, [
    [0, 'rgba(110,164,236,0.22)'],
    [0.55, 'rgba(44,78,130,0.07)'],
    [1, 'rgba(8,16,30,0.26)'],
  ]);
  c.fillRect(CLK.x, CT, CLK.w, CB - CT);
  c.restore();

  scoreType(F, c, S.clock, CLK.x + CLK.w - 6, Y_CLOCK, SZ_CLOCK, 'right');

  // Down and distance. The ordinal suffix is set SMALL AND RAISED: at 26 px ink
  // height the block face's flat-topped S sits next to a leading numeral and
  // reads as a 5 ("1ST" -> "15T"). Superscripting it removes the collision and
  // is what a real scoreboard does anyway.
  const GOLD = [[0.00, '#ffeaba'], [0.46, '#f3c452'], [1.00, '#c9932a']];
  const COOL = [[0.00, '#ffffff'], [0.55, '#dce4ef'], [1.00, '#a3b1c5']];
  const dnum = String(S.dist).replace(/[^0-9]/g, '') || S.dist;
  const dord = String(S.dist).replace(/[0-9]/g, '');
  let dx = CLK.x + 17;
  const m1 = F.draw(c, dnum, dx, Y_DD, {
    face: 'blitz-num', size: SZ_DD * 0.94, gradient: GOLD,
    outline: 'rgba(3,6,12,0.9)', outlineWidth: SZ_DD * 0.05,
    shadow: { color: 'rgba(0,4,11,0.6)', blur: 4, dy: 1.5 }, grain: 0,
  });
  dx += m1.w + 1;
  if (dord) {
    const m2 = labelType(F, c, dord, dx, Y_DD - SZ_DD * 0.30, SZ_DD * 0.56, 'left', GOLD, 0.02);
    dx += m2.w + 2;
  }
  c.fillStyle = 'rgba(226,190,108,0.8)';
  c.beginPath();
  c.arc(dx + 4, Y_DD - 8, 1.9, 0, Math.PI * 2);
  c.fill();
  F.draw(c, S.yards, dx + 10, Y_DD, {
    face: 'blitz-num', size: SZ_DD * 0.94, gradient: COOL,
    outline: 'rgba(3,6,12,0.9)', outlineWidth: SZ_DD * 0.05,
    shadow: { color: 'rgba(0,4,11,0.6)', blur: 4, dy: 1.5 }, grain: 0,
  });

  /* ---- teams ----------------------------------------------------------- */
  teamBlock(c, ui, S.teamA, S.scoreA, S.momA, null, A_AB, A_SC, S.possess === 0);
  teamBlock(c, ui, S.teamB, S.scoreB, S.momB, B_CR, B_AB, B_SC, S.possess === 1);

  /* ---- divider --------------------------------------------------------- */
  c.fillStyle = vgrad(c, CT, CB, [
    [0, 'rgba(150,180,220,0.02)'],
    [0.5, 'rgba(184,212,248,0.34)'],
    [1, 'rgba(150,180,220,0.02)'],
  ]);
  c.fillRect(DIV - 0.7, CT + 5, 1.4, CB - CT - 10);
  c.fillStyle = 'rgba(0,0,0,0.5)';
  c.fillRect(DIV + 0.9, CT + 5, 1, CB - CT - 10);

  c.setTransform(1, 0, 0, 1, 0, 0);
  return cv;
}

export function canvas() { return cv; }
export function invalidate() { if (cv) { cv.width = 1; cv.height = 1; } }
export const ORIGIN = { x: PLATE.x - MG, y: PLATE.y - MG };
export const BOX = { w: PLATE.w + MG * 2, h: PLATE.h + MG * 2, mg: MG };
