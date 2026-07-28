// PIECE hud-overlay — the top-left scoreboard cluster.
//
// GEOMETRY comes off bar/panel-qb_dropback.png measured pixel by pixel:
// the panel is 553x338 for a 1080-tall frame, so 1 panel px = 3.195 logical px.
// The plate's left edge sits at 15 panel px from the frame edge = 48 logical =
// exactly ui.safe.l; the plate measures 197 x 33 panel px = 630 x 106 logical.
// Score numerals cap out at 18.4 panel px = 59 logical. Those four numbers fix
// the whole cluster, and they are what a matched-height A/B is actually judging.
//
// COST: the cluster is baked to one offscreen canvas whenever the score state
// changes and blitted with a single drawImage on the frame path. No text is
// rasterised, no gradient is built and nothing is allocated per frame.

import {
  mkCanvas, rr, vgrad, hgrad, rgba, mix, lighten, darken, vivid, lum,
  grain, brushed, innerEdge, gloss,
} from './chrome.js';

/* ------------------------------------------------------------- geometry */

export const PLATE = { x: 48, y: 42, w: 640, h: 106, r: 13 };
const MG = 22;                                   // bake margin for the drop shadow

const CELL = {
  cap: { x: 6, w: 30 },
  clock: { x: 40, w: 122 },
  A: { x: 166, w: 226 },
  B: { x: 396, w: 238 },
};
const CT = 6, CB = 100;                          // cell top / bottom inside the plate

/* --------------------------------------------------------------- palette */

const PLATE_STOPS = [
  [0.00, 'rgba(41,50,66,0.93)'],
  [0.07, 'rgba(24,31,44,0.90)'],
  [0.52, 'rgba(12,17,26,0.88)'],
  [0.88, 'rgba(8,11,18,0.90)'],
  [1.00, 'rgba(15,20,30,0.92)'],
];

/* ----------------------------------------------------------------- bake */

let cv = null, cx = null;
let quality = 1;                                  // scaled by applyRung

export function setQuality(q) { quality = q; }

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

function cellPlate(c, x, y, w, h, tint, tintA) {
  const p = rr(x, y, w, h, 7);
  c.fillStyle = vgrad(c, y, y + h, [
    [0, `rgba(${tint[0]},${tint[1]},${tint[2]},${(tintA * 1.25).toFixed(3)})`],
    [0.5, `rgba(${tint[0]},${tint[1]},${tint[2]},${(tintA * 0.72).toFixed(3)})`],
    [1, `rgba(${Math.round(tint[0] * 0.55)},${Math.round(tint[1] * 0.55)},${Math.round(tint[2] * 0.6)},${(tintA * 0.95).toFixed(3)})`],
  ]);
  c.fill(p);
  innerEdge(c, p, 0, 1.1, 'rgba(196,222,255,0.20)', 'rgba(0,0,0,0.42)', 1.4);
  c.strokeStyle = 'rgba(146,178,220,0.13)';
  c.lineWidth = 1;
  c.stroke(p);
  return p;
}

/**
 * The momentum strip. Inset dark track, team-colour fill with a longitudinal
 * gloss, a hot leading edge and segment ticks — never a flat rectangle.
 */
function momentum(c, x, y, w, h, v, accent, primary) {
  const val = Math.max(0, Math.min(1, v));
  const track = rr(x, y, w, h, h * 0.5);
  c.fillStyle = vgrad(c, y, y + h, [
    [0, 'rgba(2,3,6,0.94)'],
    [0.55, 'rgba(9,12,19,0.90)'],
    [1, 'rgba(26,32,45,0.85)'],
  ]);
  c.fill(track);
  innerEdge(c, track, 0, 1.0, 'rgba(0,0,0,0.55)', 'rgba(150,180,220,0.16)', 1.2);

  const fw = Math.max(0, w * val);
  if (fw > 1.5) {
    const hot = lighten(accent, 0.42);
    const deep = mix(primary, accent, 0.35);
    c.save();
    c.clip(track);
    c.fillStyle = hgrad(c, x, x + fw, [
      [0.00, rgba(darken(deep, 0.28), 0.95)],
      [0.35, rgba(accent, 0.97)],
      [1.00, rgba(hot, 1)],
    ]);
    c.fillRect(x, y, fw, h);
    // longitudinal gloss: bright upper third, shadowed lower third
    c.fillStyle = vgrad(c, y, y + h, [
      [0.00, 'rgba(255,255,255,0.34)'],
      [0.34, 'rgba(255,255,255,0.10)'],
      [0.50, 'rgba(255,255,255,0.00)'],
      [1.00, 'rgba(0,0,0,0.34)'],
    ]);
    c.fillRect(x, y, fw, h);
    // hot leading edge + spill
    c.shadowColor = rgba(hot, 0.9);
    c.shadowBlur = 9;
    c.fillStyle = rgba(lighten(accent, 0.75), 0.95);
    c.fillRect(x + fw - 2.2, y, 2.2, h);
    c.shadowBlur = 0;
    c.restore();
  }
  // segment ticks — read as a meter, not a progress bar
  c.save();
  c.clip(track);
  c.fillStyle = 'rgba(0,0,0,0.42)';
  const seg = 9;
  for (let i = 1; i < seg; i++) c.fillRect(x + (w * i) / seg - 0.7, y, 1.4, h);
  c.restore();
  c.strokeStyle = 'rgba(160,190,230,0.14)';
  c.lineWidth = 1;
  c.stroke(track);
}

function scoreType(F, c, txt, x, y, size, align) {
  F.draw(c, txt, x, y, {
    face: 'blitz-num',
    size,
    align,
    fill: null,
    gradient: [
      [0.00, '#ffffff'],
      [0.42, '#f4f7fc'],
      [0.70, '#cbd6e6'],
      [0.90, '#9dabc2'],
      [1.00, '#7f8ea6'],
    ],
    outline: 'rgba(3,6,12,0.94)',
    outlineWidth: size * 0.055,
    shadow: { color: 'rgba(0,4,11,0.78)', blur: size * 0.17, dy: size * 0.05 },
    emboss: 0.16 * quality,
    grain: 0,
  });
}

function labelType(F, c, txt, x, y, size, align, tint) {
  F.draw(c, txt, x, y, {
    face: 'blitz-block',
    size,
    align,
    gradient: tint || [
      [0.00, '#ffffff'],
      [0.55, '#e6ecf5'],
      [1.00, '#a9b7cb'],
    ],
    outline: 'rgba(3,6,12,0.88)',
    outlineWidth: size * 0.062,
    shadow: { color: 'rgba(0,4,11,0.62)', blur: size * 0.16, dy: size * 0.05 },
    emboss: 0,
    grain: 0,
  });
}

function teamCell(c, ui, S, cell, id, score, mom, possess) {
  const F = ui.faces;
  const team = (ui.brand && ui.brand.byId) ? ui.brand.byId(id) : null;
  const col = (team && team.colors) || { primary: '#20242c', accent: '#8fa8c8' };
  let accent = vivid(col.accent, 1.12);
  if (lum(accent) < 0.30) accent = lighten(accent, 0.34);
  const primary = col.primary;

  const x = cell.x, w = cell.w;
  cellPlate(c, x, CT, w, CB - CT, [30, 40, 56], 0.30);

  // team-colour wash down the leading edge of the cell
  const p = rr(x, CT, w, CB - CT, 7);
  c.save();
  c.clip(p);
  c.fillStyle = hgrad(c, x, x + w * 0.62, [
    [0, rgba(accent, 0.17)],
    [0.5, rgba(accent, 0.05)],
    [1, rgba(accent, 0)],
  ]);
  c.fillRect(x, CT, w, CB - CT);
  c.restore();

  // crest
  const CS = 40;
  const crx = x + 7, cry = CT + 8;
  if (ui.brand && ui.brand.crest) {
    try {
      const img = ui.brand.crest(id, 96);
      if (img) {
        c.save();
        c.shadowColor = 'rgba(0,3,8,0.72)';
        c.shadowBlur = 5;
        c.shadowOffsetY = 2;
        c.drawImage(img, crx, cry, CS, CS);
        c.restore();
      }
    } catch (e) { /* a brand that throws must not take the HUD with it */ }
  }

  // possession pip — small accent chevron above the crest
  if (possess) {
    c.save();
    c.fillStyle = rgba(lighten(accent, 0.5), 0.95);
    c.shadowColor = rgba(accent, 0.9);
    c.shadowBlur = 7;
    c.beginPath();
    c.moveTo(x + w - 9, CT + 6);
    c.lineTo(x + w - 1.5, CT + 6);
    c.lineTo(x + w - 1.5, CT + 15);
    c.closePath();
    c.fill();
    c.restore();
  }

  labelType(F, c, String(id || '').toUpperCase(), crx + CS + 8, 74, 42, 'left');
  scoreType(F, c, String(score), x + w - 9, 78, 76, 'right');

  momentum(c, crx, 84, w - 16, 10, mom, accent, primary);

  // team accent hairline riding the bottom of the cell
  c.fillStyle = hgrad(c, x, x + w, [
    [0, rgba(accent, 0)],
    [0.14, rgba(accent, 0.62)],
    [0.86, rgba(accent, 0.62)],
    [1, rgba(accent, 0)],
  ]);
  c.fillRect(x, CB - 2, w, 2);
}

/**
 * Rebuild the whole cluster into the offscreen canvas.
 * `k` supersamples the bake (the state sheet renders its detail crop at k=2 so
 * the crop is genuinely re-rendered rather than an upscaled blit).
 */
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

  // ---- body -------------------------------------------------------------
  shadowRing(c, plate, 22, 7, 0.72);
  c.fillStyle = vgrad(c, 0, PLATE.h, PLATE_STOPS);
  c.fill(plate);

  brushed(c, plate, 0, 0, PLATE.w, PLATE.h, 0x51a7, 0.85 * quality);
  grain(c, plate, 0, 0, PLATE.w, PLATE.h, 0x2c19, 0.75 * quality);
  gloss(c, plate, 0, 0, PLATE.w, PLATE.h * 0.62, 0.055, 0.5);

  // machined edge: bright top hairline, dark bottom hairline, cool rim
  innerEdge(c, plate, 0, 1.4, 'rgba(206,228,255,0.34)', 'rgba(0,0,0,0.55)', 1.6);
  c.strokeStyle = 'rgba(128,158,198,0.26)';
  c.lineWidth = 1.1;
  c.stroke(plate);

  // ---- left cap: vertical micro-wordmark --------------------------------
  const cap = CELL.cap;
  cellPlate(c, cap.x, CT, cap.w, CB - CT, [40, 52, 72], 0.26);
  c.save();
  c.translate(cap.x + cap.w * 0.5, (CT + CB) * 0.5);
  c.rotate(-Math.PI / 2);
  F.draw(c, 'BLITZ', 0, 4.5, {
    face: 'blitz-block', size: 13, align: 'center',
    tracking: 0.20, fill: 'rgba(196,216,242,0.62)',
    outline: 'rgba(0,0,0,0.5)', outlineWidth: 1.1, grain: 0,
  });
  c.restore();
  // quarter chip under the wordmark is folded into the clock cell instead —
  // the cap stays a pure spine so the cluster's left edge reads as one form.

  // ---- clock cell -------------------------------------------------------
  const cl = CELL.clock;
  cellPlate(c, cl.x, CT, cl.w, CB - CT, [46, 76, 122], 0.44);
  const clp = rr(cl.x, CT, cl.w, CB - CT, 7);
  c.save();
  c.clip(clp);
  c.fillStyle = vgrad(c, CT, CB, [
    [0, 'rgba(96,150,224,0.20)'],
    [0.6, 'rgba(40,72,120,0.06)'],
    [1, 'rgba(10,18,32,0.24)'],
  ]);
  c.fillRect(cl.x, CT, cl.w, CB - CT);
  c.restore();

  scoreType(F, c, S.clock, cl.x + cl.w - 8, 66, 62, 'right');

  // down & distance: gold down, cool distance — the bar's warm/cool split
  const dY = 94;
  const dw = F.measure(S.dist, 'blitz-block', 22).w;
  labelType(F, c, S.dist, cl.x + 8, dY, 22, 'left', [
    [0.00, '#ffe6a8'], [0.5, '#f0bd48'], [1.00, '#c9902a'],
  ]);
  labelType(F, c, S.yards, cl.x + 12 + dw, dY, 22, 'left', [
    [0.00, '#ffffff'], [0.6, '#d6dfec'], [1.00, '#9caabf'],
  ]);

  // ---- team cells -------------------------------------------------------
  teamCell(c, ui, S, CELL.A, S.teamA, S.scoreA, S.momA, S.possess === 0);
  teamCell(c, ui, S, CELL.B, S.teamB, S.scoreB, S.momB, S.possess === 1);

  // ---- separator between the two team chips -----------------------------
  const sx = (CELL.A.x + CELL.A.w + CELL.B.x) * 0.5;
  c.fillStyle = vgrad(c, CT, CB, [
    [0, 'rgba(150,180,220,0.02)'],
    [0.5, 'rgba(178,206,244,0.30)'],
    [1, 'rgba(150,180,220,0.02)'],
  ]);
  c.fillRect(sx - 0.6, CT + 6, 1.2, CB - CT - 12);

  c.setTransform(1, 0, 0, 1, 0, 0);
  return cv;
}

export function canvas() { return cv; }
export function invalidate() { if (cv) { cv.width = 1; cv.height = 1; } }
export const ORIGIN = { x: PLATE.x - MG, y: PLATE.y - MG };
export const BOX = { w: PLATE.w + MG * 2, h: PLATE.h + MG * 2, mg: MG };
