// PIECE: typeface-lettering — the isolation capture scenes.
//
// Four specimen sheets a blind critic can crop-compare string-for-string against the
// bar panels. Everything is drawn in Canvas2D at logical 1920x1080 and is a pure
// function of (t, seed).

import { makeRng } from '../../foundation/rng.js';

const GOLD = [[0, '#fff0ad'], [0.30, '#ffd63f'], [0.70, '#f5aa14'], [1, '#d8830c']];
const RED = [[0, '#e2373e'], [0.55, '#c8232b'], [1, '#a5161d']];
const WHITE = [[0, '#ffffff'], [0.62, '#f7f4ef'], [1, '#dcd6cd']];
const CREAM = [[0, '#fbeed4'], [0.5, '#eed9b0'], [1, '#c9a878']];
const INK = 'rgba(9,7,10,0.94)';

/* ------------------------------------------------------------- backgrounds */

function bgBase(c, W, H, seed, tint) {
  const g = c.createLinearGradient(0, 0, W * 0.35, H);
  g.addColorStop(0, tint ? tint[0] : '#15161b');
  g.addColorStop(0.55, tint ? tint[1] : '#0c0d11');
  g.addColorStop(1, tint ? tint[2] : '#050506');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);

  // faint diagonal weave
  c.save();
  c.globalAlpha = 0.05;
  c.strokeStyle = '#8fa7c4';
  c.lineWidth = 1;
  for (let x = -H; x < W; x += 13) {
    c.beginPath(); c.moveTo(x, 0); c.lineTo(x + H, H); c.stroke();
  }
  c.restore();

  // warm centre bloom
  const r = c.createRadialGradient(W * 0.42, H * 0.30, 40, W * 0.42, H * 0.30, W * 0.62);
  r.addColorStop(0, 'rgba(255,176,84,0.10)');
  r.addColorStop(0.5, 'rgba(120,90,60,0.035)');
  r.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = r;
  c.fillRect(0, 0, W, H);

  // vignette
  const v = c.createRadialGradient(W / 2, H * 0.48, H * 0.30, W / 2, H * 0.5, W * 0.72);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.72)');
  c.fillStyle = v;
  c.fillRect(0, 0, W, H);

  grainField(c, W, H, seed, 0.055);
}

function grainField(c, W, H, seed, amt) {
  const rng = makeRng(seed | 0);
  c.save();
  for (let i = 0; i < 2600; i++) {
    const x = rng() * W, y = rng() * H;
    const a = rng() * amt;
    c.fillStyle = rng() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a * 1.6})`;
    c.fillRect(x, y, 1 + rng() * 1.6, 1 + rng() * 1.2);
  }
  c.restore();
}

/** A blurred night-turf swatch — proves the lockup survives a real game frame. */
function turfSwatch(c, x, y, w, h, seed) {
  c.save();
  c.beginPath();
  c.rect(x, y, w, h);
  c.clip();
  const g = c.createLinearGradient(x, y, x + w * 0.4, y + h);
  g.addColorStop(0, '#20301c');
  g.addColorStop(0.45, '#16240f');
  g.addColorStop(1, '#080d06');
  c.fillStyle = g;
  c.fillRect(x, y, w, h);
  // mow stripes, receding
  const rng = makeRng(seed | 0);
  for (let i = 0; i < 9; i++) {
    const yy = y + h * (i / 9) + rng() * 8;
    c.fillStyle = i % 2 ? 'rgba(120,168,92,0.055)' : 'rgba(0,0,0,0.10)';
    c.fillRect(x, yy, w, h / 9);
  }
  // yard line
  c.save();
  c.globalAlpha = 0.24;
  c.strokeStyle = '#dfe6dc';
  c.lineWidth = 7;
  c.beginPath(); c.moveTo(x + w * 0.12, y + h); c.lineTo(x + w * 0.44, y - 10); c.stroke();
  c.lineWidth = 5;
  c.beginPath(); c.moveTo(x + w * 0.62, y + h); c.lineTo(x + w * 0.90, y - 10); c.stroke();
  c.restore();
  // hot rim from the light banks
  const r = c.createRadialGradient(x + w * 0.85, y - h * 0.1, 10, x + w * 0.85, y - h * 0.1, w * 0.7);
  r.addColorStop(0, 'rgba(255,214,150,0.30)');
  r.addColorStop(1, 'rgba(255,190,110,0)');
  c.fillStyle = r;
  c.fillRect(x, y, w, h);
  grainField(c, W_OF(x, w), H_OF(y, h), seed + 3, 0.05);
  c.restore();
}
// helpers so grainField's loop stays in the clipped box
function W_OF(x, w) { return x + w; }
function H_OF(y, h) { return y + h; }

/* ------------------------------------------------------------------ chrome */

function panel(c, x, y, w, h, o = {}) {
  const r = o.r === undefined ? 10 : o.r;
  c.save();
  roundRect(c, x, y, w, h, r);
  const g = c.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, o.top || 'rgba(38,42,52,0.82)');
  g.addColorStop(1, o.bot || 'rgba(12,13,17,0.86)');
  c.fillStyle = g;
  c.fill();
  c.lineWidth = 1.4;
  c.strokeStyle = o.border || 'rgba(150,168,196,0.28)';
  c.stroke();
  // inner top highlight
  c.save();
  c.clip();
  c.strokeStyle = 'rgba(255,255,255,0.09)';
  c.lineWidth = 2;
  c.beginPath(); c.moveTo(x + 4, y + 1.5); c.lineTo(x + w - 4, y + 1.5); c.stroke();
  c.restore();
  c.restore();
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y);
  c.closePath();
}

function label(c, ui, text, x, y, size, col) {
  ui.faces.draw(c, text, x, y, {
    face: 'blitz-block', size: size || 20, fill: col || 'rgba(150,166,190,0.9)', tracking: 0.14,
  });
}

function headerBar(c, ui, title, sub) {
  const W = ui.W;
  c.save();
  const g = c.createLinearGradient(0, 0, 0, 92);
  g.addColorStop(0, 'rgba(24,26,33,0.96)');
  g.addColorStop(1, 'rgba(9,10,13,0.9)');
  c.fillStyle = g;
  c.fillRect(0, 0, W, 92);
  c.fillStyle = 'rgba(190,32,42,0.95)';
  c.beginPath();
  c.moveTo(0, 0); c.lineTo(150, 0); c.lineTo(118, 92); c.lineTo(0, 92); c.closePath(); c.fill();
  c.fillStyle = 'rgba(255,255,255,0.10)';
  c.beginPath(); c.moveTo(0, 0); c.lineTo(150, 0); c.lineTo(140, 26); c.lineTo(0, 26); c.closePath(); c.fill();
  c.strokeStyle = 'rgba(255,90,90,0.55)';
  c.lineWidth = 2;
  c.beginPath(); c.moveTo(150, 0); c.lineTo(118, 92); c.stroke();
  c.strokeStyle = 'rgba(160,178,206,0.30)';
  c.lineWidth = 1.5;
  c.beginPath(); c.moveTo(0, 91); c.lineTo(W, 91); c.stroke();
  ui.faces.draw(c, title, 176, 60, { face: 'blitz-block', size: 34, fill: '#eef1f6', tracking: 0.10 });
  ui.faces.draw(c, sub, W - 48, 58, { face: 'blitz-block', size: 21, fill: 'rgba(146,164,190,0.92)', align: 'right', tracking: 0.17 });
  c.restore();
}

/* -------------------------------------------------------- the score lockup */

/** The bar's signature lockup, right-aligned and rotated a couple of degrees. */
export function scoreLockup(c, ui, cx, cy, scale, line1, line2, pts, line2Grad) {
  const F = ui.faces;
  const s = scale;
  c.save();
  c.translate(cx, cy);
  c.rotate(-0.058);

  F.ink(c, line1, 0, -138 * s, {
    face: 'blitz-brush', size: 106 * s, align: 'right', gradient: WHITE,
    outline: INK, outlineWidth: 106 * s * 0.046,
    shadow: { color: 'rgba(0,0,0,0.82)', blur: 30 * s, dy: 9 * s, reps: 2 },
    emboss: 0, grain: 0.3,
  });
  F.ink(c, line2, 6 * s, 0, {
    face: 'blitz-brush', size: 152 * s, align: 'right', gradient: line2Grad || RED,
    outline: INK, outlineWidth: 152 * s * 0.044,
    shadow: { color: 'rgba(0,0,0,0.85)', blur: 40 * s, dy: 12 * s, reps: 2 },
    emboss: 0, grain: 0.3,
  });

  if (pts) {
    const numSize = 104 * s;
    const ptsSize = 62 * s;
    const wPts = F.measure(' PTS', 'blitz-brush', ptsSize, {}).w;
    F.draw(c, 'PTS', 0, 104 * s, {
      face: 'blitz-brush', size: ptsSize, align: 'right', gradient: GOLD,
      outline: INK, outlineWidth: ptsSize * 0.07,
      shadow: { color: 'rgba(0,0,0,0.8)', blur: 18 * s, dy: 6 * s },
      emboss: 0, grain: 0.3,
    });
    F.draw(c, String(pts), -wPts - 6 * s, 106 * s, {
      face: 'blitz-num', size: numSize, align: 'right', slant: 0.20, gradient: GOLD,
      outline: INK, outlineWidth: numSize * 0.055,
      glow: { color: 'rgba(255,168,40,0.55)', blur: 44 * s, alpha: 0.7, reps: 2 },
      shadow: { color: 'rgba(0,0,0,0.82)', blur: 26 * s, dy: 8 * s },
      emboss: 0, grain: 0,
    });
  }
  c.restore();
}

/* ------------------------------------------------------------ HUD fragment */

function hudStrip(c, ui, x, y) {
  const F = ui.faces;
  c.save();
  // angled plate
  c.beginPath();
  c.moveTo(x, y); c.lineTo(x + 486, y); c.lineTo(x + 466, y + 66); c.lineTo(x, y + 66); c.closePath();
  const g = c.createLinearGradient(0, y, 0, y + 66);
  g.addColorStop(0, 'rgba(30,34,43,0.92)');
  g.addColorStop(1, 'rgba(9,10,13,0.93)');
  c.fillStyle = g; c.fill();
  c.strokeStyle = 'rgba(160,178,206,0.32)'; c.lineWidth = 1.4; c.stroke();

  F.draw(c, ':15', x + 20, y + 48, { face: 'blitz-num', size: 46, fill: '#ffffff', tracking: -0.01 });
  F.draw(c, 'SEA', x + 116, y + 46, { face: 'blitz-block', size: 34, fill: '#eef2f7' });
  F.draw(c, '14', x + 214, y + 50, { face: 'blitz-num', size: 50, fill: '#ffffff' });
  c.fillStyle = 'rgba(150,168,196,0.25)';
  c.fillRect(x + 282, y + 10, 1.6, 46);
  F.draw(c, 'MIA', x + 300, y + 46, { face: 'blitz-block', size: 34, fill: '#eef2f7' });
  F.draw(c, '6', x + 398, y + 50, { face: 'blitz-num', size: 50, fill: '#ffffff' });
  // momentum bars
  c.fillStyle = 'rgba(255,255,255,0.09)'; c.fillRect(x + 116, y + 54, 84, 7);
  c.fillStyle = '#d3232c'; c.fillRect(x + 116, y + 54, 60, 7);
  c.fillStyle = 'rgba(255,255,255,0.09)'; c.fillRect(x + 300, y + 54, 84, 7);
  c.fillStyle = '#3f7fd0'; c.fillRect(x + 300, y + 54, 30, 7);
  c.restore();
}

function turboPlate(c, ui, x, y, w, h, fill) {
  const F = ui.faces;
  const sk = h * 0.42;
  c.save();
  c.beginPath();
  c.moveTo(x + sk, y); c.lineTo(x + w, y); c.lineTo(x + w - sk, y + h); c.lineTo(x, y + h); c.closePath();
  const g = c.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, '#1c3f76');
  g.addColorStop(0.5, '#12294d');
  g.addColorStop(1, '#0a1830');
  c.fillStyle = g; c.fill();
  c.strokeStyle = '#4d8ce0'; c.lineWidth = 3; c.stroke();
  c.save();
  c.clip();
  c.strokeStyle = 'rgba(160,205,255,0.5)'; c.lineWidth = 2;
  c.beginPath(); c.moveTo(x + sk, y + 2); c.lineTo(x + w, y + 2); c.stroke();
  // segmented fill
  const bx = x + w * 0.06, by = y + h * 0.62, bw = w * 0.86, bh = h * 0.20;
  c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(bx, by, bw, bh);
  const fg = c.createLinearGradient(bx, 0, bx + bw * fill, 0);
  fg.addColorStop(0, '#3d7ad6'); fg.addColorStop(0.75, '#8fc4ff'); fg.addColorStop(1, '#eaf5ff');
  c.fillStyle = fg; c.fillRect(bx, by, bw * fill, bh);
  c.fillStyle = 'rgba(0,0,0,0.55)';
  for (let i = 1; i < 14; i++) c.fillRect(bx + bw * (i / 14), by, 2, bh);
  c.restore();
  F.draw(c, 'TURBO', x + w * 0.20, y + h * 0.52, {
    face: 'blitz-techno', size: h * 0.46, fill: '#ffffff',
    outline: 'rgba(6,12,24,0.85)', outlineWidth: h * 0.045,
    shadow: { color: 'rgba(0,0,0,0.7)', blur: h * 0.12, dy: h * 0.03 },
    emboss: 0.7,
  });
  c.restore();
}

/* ---------------------------------------------------------------- screens */

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const PUNCT = "!.,:'-/";

function alphabetRow(c, ui, x, y, face, size, name, note) {
  label(c, ui, name, x, y - size * 0.98, 20, 'rgba(255,206,110,0.92)');
  label(c, ui, note, x + 300, y - size * 0.98, 18, 'rgba(132,148,172,0.8)');
  const F = ui.faces;
  const a = F.draw(c, ALPHA, x, y, { face, size, fill: '#e9edf3', grain: 0 });
  const b = F.draw(c, DIGITS, x + a.w + size * 0.55, y, { face, size, fill: '#ffd34a', grain: 0 });
  F.draw(c, PUNCT, x + a.w + b.w + size * 1.1, y, { face, size, fill: '#9fb0c8', grain: 0 });
}

export function drawIsoType(c, t, state, ui) {
  const W = ui.W, H = ui.H;
  bgBase(c, W, H, ui.seed * 17 + 5);
  headerBar(c, ui, 'BLITZ RELOADED  TYPE SYSTEM', 'BLITZ-BRUSH / BLITZ-BLOCK / BLITZ-NUM / BLITZ-TECHNO');

  // ---- hero lockup over a night-turf swatch -----------------------------
  turfSwatch(c, 56, 116, 902, 392, ui.seed * 31 + 11);
  panelEdge(c, 56, 116, 902, 392);
  scoreLockup(c, ui, 906, 292, 1.0, 'MID-AIR', 'MURDER!', 250);
  label(c, ui, 'SCORE CALLOUT LOCKUP', 74, 146, 19, 'rgba(220,232,246,0.55)');

  // ---- menu header -------------------------------------------------------
  panel(c, 984, 116, 880, 186);
  ui.faces.ink(c, 'CHOOSE YOUR CITY', 1424, 244, {
    face: 'blitz-brush', size: 86, align: 'center', gradient: CREAM,
    outline: 'rgba(20,12,6,0.75)', outlineWidth: 5,
    glow: { color: 'rgba(255,196,110,0.5)', blur: 44, alpha: 0.7 },
    shadow: { color: 'rgba(0,0,0,0.7)', blur: 22, dy: 7 },
    emboss: 0, grain: 0.3,
  });
  label(c, ui, 'MENU HEADER  BLITZ-BRUSH 86', 1004, 146, 19, 'rgba(220,232,246,0.5)');

  panel(c, 984, 316, 880, 192);
  ui.faces.ink(c, 'TOUCHDOWN!', 1424, 452, {
    face: 'blitz-brush', size: 112, align: 'center', gradient: WHITE,
    outline: INK, outlineWidth: 8,
    shadow: { color: 'rgba(0,0,0,0.8)', blur: 30, dy: 9, reps: 2 },
    emboss: 0, grain: 0.3,
  });
  label(c, ui, 'CALLOUT LINE  BLITZ-BRUSH 112', 1004, 346, 19, 'rgba(220,232,246,0.5)');

  // ---- HUD + TURBO -------------------------------------------------------
  panel(c, 56, 528, 902, 190);
  label(c, ui, 'IN-GAME HUD  BLITZ-BLOCK + BLITZ-NUM', 74, 558, 19, 'rgba(220,232,246,0.5)');
  hudStrip(c, ui, 78, 576);
  ui.faces.draw(c, 'NYC', 596, 664, { face: 'blitz-block', size: 62, fill: '#eef2f7' });
  ui.faces.draw(c, '22', 762, 670, { face: 'blitz-num', size: 84, gradient: GOLD, outline: 'rgba(8,6,4,0.85)', outlineWidth: 4, emboss: 0.18 });

  panel(c, 984, 528, 880, 190);
  label(c, ui, 'TURBO METER  BLITZ-TECHNO', 1004, 558, 19, 'rgba(220,232,246,0.5)');
  turboPlate(c, ui, 1006, 578, 380, 92, 0.62);
  ui.faces.draw(c, 'TURBO', 1440, 664, {
    face: 'blitz-techno', size: 96, fill: '#dfe9f6',
    outline: 'rgba(8,14,26,0.9)', outlineWidth: 6, emboss: 0.75,
    shadow: { color: 'rgba(0,0,0,0.7)', blur: 20, dy: 6 },
  });

  // ---- character sets ----------------------------------------------------
  panel(c, 56, 738, 1808, 296);
  alphabetRow(c, ui, 82, 830, 'blitz-brush', 58, 'BLITZ-BRUSH', 'DISPLAY  15 DEG  BROAD NIB  TORN EDGE');
  alphabetRow(c, ui, 82, 916, 'blitz-block', 50, 'BLITZ-BLOCK', 'HUD LABELS  CONDENSED  CHAMFERED');
  alphabetRow(c, ui, 82, 994, 'blitz-num', 52, 'BLITZ-NUM', 'SCORES  TALL  HEAVY');
  ui.faces.draw(c, 'TURBO 0123456789', 1230, 994, { face: 'blitz-techno', size: 46, fill: '#9fd0ff' });
  label(c, ui, 'BLITZ-TECHNO', 1230, 930, 20, 'rgba(255,206,110,0.92)');
}

function panelEdge(c, x, y, w, h) {
  c.save();
  c.strokeStyle = 'rgba(150,168,196,0.28)';
  c.lineWidth = 1.4;
  c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  c.restore();
}

export function drawIsoBrush(c, t, state, ui) {
  const W = ui.W, H = ui.H;
  bgBase(c, W, H, ui.seed * 23 + 9, ['#191218', '#0d0a0d', '#050405']);
  headerBar(c, ui, 'BLITZ-BRUSH  HAND-LETTERED DISPLAY', 'BROAD NIB  15 DEG  CHISEL TERMINALS  TORN EDGE');

  ui.faces.ink(c, 'MURDER!', 1806, 330, {
    face: 'blitz-brush', size: 224, align: 'right', gradient: RED,
    outline: INK, outlineWidth: 15,
    shadow: { color: 'rgba(0,0,0,0.85)', blur: 60, dy: 18, reps: 2 },
    emboss: 0, grain: 0.3,
  });
  label(c, ui, 'CAP 700/1000  STEM 0.20 CAP  THIN 0.38 STEM  SLANT 15 DEG', 60, 190, 21, 'rgba(180,196,220,0.8)');

  ui.faces.ink(c, 'TRUCK!', 66, 566, {
    face: 'blitz-brush', size: 176, gradient: WHITE,
    outline: INK, outlineWidth: 12,
    shadow: { color: 'rgba(0,0,0,0.8)', blur: 44, dy: 14, reps: 2 },
    emboss: 0, grain: 0.3,
  });
  ui.faces.ink(c, 'LEVELER!', 1812, 566, {
    face: 'blitz-brush', size: 176, align: 'right', gradient: GOLD,
    outline: INK, outlineWidth: 12,
    glow: { color: 'rgba(255,170,40,0.45)', blur: 60, alpha: 0.6 },
    shadow: { color: 'rgba(0,0,0,0.8)', blur: 44, dy: 14, reps: 2 },
    emboss: 0, grain: 0.3,
  });

  ui.faces.ink(c, 'WHAT A CATCH!', 960, 730, {
    face: 'blitz-brush', size: 116, align: 'center', gradient: WHITE,
    outline: INK, outlineWidth: 8,
    shadow: { color: 'rgba(0,0,0,0.8)', blur: 28, dy: 9, reps: 2 },
    emboss: 0, grain: 0.3,
  });
  ui.faces.ink(c, 'DEFENSE!  PICK A PLAY', 960, 848, {
    face: 'blitz-brush', size: 84, align: 'center', gradient: WHITE,
    outline: INK, outlineWidth: 6,
    shadow: { color: 'rgba(0,0,0,0.8)', blur: 22, dy: 7 },
    emboss: 0, grain: 0.3,
  });

  panel(c, 56, 890, 1808, 150);
  const F = ui.faces;
  const a = F.draw(c, ALPHA, 82, 990, { face: 'blitz-brush', size: 70, fill: '#eef2f7', grain: 0.3 });
  F.draw(c, DIGITS + " !.,:'-/", 92 + a.w, 990, { face: 'blitz-brush', size: 70, fill: '#ffd34a', grain: 0.3 });
}

export function drawIsoHud(c, t, state, ui) {
  const W = ui.W, H = ui.H;
  // half dark / half bright, to prove the faces survive both
  bgBase(c, W, H, ui.seed * 41 + 3, ['#12161d', '#0a0d12', '#050608']);
  c.save();
  const g = c.createLinearGradient(W * 0.5, 0, W, H);
  g.addColorStop(0, 'rgba(214,218,212,0)');
  g.addColorStop(0.35, 'rgba(222,220,208,0.72)');
  g.addColorStop(1, 'rgba(238,236,226,0.97)');
  c.fillStyle = g;
  c.fillRect(W * 0.5, 92, W * 0.5, H - 92);
  c.restore();
  headerBar(c, ui, 'BLITZ-BLOCK / BLITZ-NUM / BLITZ-TECHNO', 'HUD FACES OVER DARK AND BRIGHT');

  hudStrip(c, ui, 60, 140);
  hudStrip(c, ui, 1180, 140);

  const F = ui.faces;
  const rows = [
    ['SPEED', 'HIT POWER', 'TURBO', 'NICKEL'],
    ['SAFE COVER', 'STUFF IT', '2 MAN BLITZ', 'ZONE HOOK'],
    ['SLAM WALL', 'LB ATTACK', 'IN YOUR FACE', 'DEATH WISH'],
  ];
  label(c, ui, 'BLITZ-BLOCK  UI LABELS', 60, 268, 21, 'rgba(255,206,110,0.92)');
  rows.forEach((r, i) => {
    r.forEach((s2, j) => {
      F.draw(c, s2, 60 + j * 220, 320 + i * 54, { face: 'blitz-block', size: 34, fill: '#e6ecf4' });
    });
  });

  label(c, ui, 'BLITZ-NUM  SCORES AND CLOCKS', 60, 540, 21, 'rgba(255,206,110,0.92)');
  F.draw(c, '0123456789', 60, 660, { face: 'blitz-num', size: 120, fill: '#ffffff' });
  F.draw(c, ':15  22  250  4TH', 60, 780, { face: 'blitz-num', size: 84, gradient: GOLD, outline: 'rgba(8,6,4,0.85)', outlineWidth: 4, emboss: 0.18 });

  label(c, ui, 'BLITZ-TECHNO  TURBO / TECH LABELS', 60, 850, 21, 'rgba(255,206,110,0.92)');
  turboPlate(c, ui, 60, 880, 460, 110, 0.62);
  F.draw(c, 'TURBO', 552, 966, { face: 'blitz-techno', size: 80, fill: '#cfe3fb', outline: 'rgba(8,14,26,0.9)', outlineWidth: 5.5, emboss: 0.75 });

  // right (bright) half — same faces in dark ink
  label(c, ui, 'OVER BRIGHT', 1180, 268, 21, 'rgba(60,50,40,0.9)');
  F.draw(c, 'SEA 14  MIA 6', 1180, 340, { face: 'blitz-block', size: 46, fill: '#14161b' });
  F.draw(c, '0123456789', 1180, 470, { face: 'blitz-num', size: 104, fill: '#14161b' });
  F.draw(c, 'TURBO', 1180, 600, { face: 'blitz-techno', size: 92, fill: '#14161b' });
  ui.faces.ink(c, 'TOUCHDOWN!', 1180, 760, {
    face: 'blitz-brush', size: 104, gradient: WHITE, outline: INK, outlineWidth: 8,
    shadow: { color: 'rgba(0,0,0,0.75)', blur: 26, dy: 9, reps: 2 }, emboss: 0, grain: 0.3,
  });
  ui.faces.ink(c, 'MURDER!', 1180, 900, {
    face: 'blitz-brush', size: 110, gradient: RED, outline: INK, outlineWidth: 8,
    shadow: { color: 'rgba(0,0,0,0.75)', blur: 26, dy: 9, reps: 2 }, emboss: 0, grain: 0.3,
  });
}

export function drawIsoSpecimen(c, t, state, ui) {
  const W = ui.W, H = ui.H;
  bgBase(c, W, H, ui.seed * 7 + 19);
  headerBar(c, ui, 'BLITZ RELOADED  TYPE SPECIMEN', 'FOUR VECTOR FACES  NO FONT FILES  NO NETWORK');
  const F = ui.faces;

  // waterfall
  panel(c, 56, 116, 1120, 470);
  label(c, ui, 'BLITZ-BRUSH  WATERFALL', 76, 148, 20, 'rgba(255,206,110,0.92)');
  const sizes = [116, 86, 64, 47, 34];
  let yy = 238;
  for (const s of sizes) {
    F.draw(c, 'MID-AIR MURDER!', 84, yy, {
      face: 'blitz-brush', size: s, fill: '#eaeef4', grain: s > 50 ? 0.35 : 0,
      outline: 'rgba(8,6,10,0.8)', outlineWidth: s * 0.05,
    });
    F.draw(c, String(s), 1150, yy, { face: 'blitz-block', size: 19, fill: 'rgba(130,146,170,0.8)', align: 'right' });
    yy += s * 0.86 + 15;
  }

  // grid of the four faces at one size
  panel(c, 1200, 116, 664, 470);
  label(c, ui, 'ONE STRING  FOUR FACES', 1220, 148, 20, 'rgba(255,206,110,0.92)');
  const strings = [
    ['blitz-brush', 'BLITZ 250', 58],
    ['blitz-block', 'BLITZ 250', 54],
    ['blitz-num', 'BLITZ 250', 54],
    ['blitz-techno', 'BLITZ 250', 48],
  ];
  strings.forEach((sd, i) => {
    label(c, ui, sd[0].toUpperCase(), 1224, 214 + i * 96, 18, 'rgba(130,146,170,0.85)');
    F.draw(c, sd[1], 1224, 274 + i * 96, { face: sd[0], size: sd[2], fill: '#e9eef5', grain: 0 });
  });

  // full character sets
  panel(c, 56, 606, 1808, 428);
  const faces = [
    ['blitz-brush', 62, 'BLITZ-BRUSH'],
    ['blitz-block', 54, 'BLITZ-BLOCK'],
    ['blitz-num', 56, 'BLITZ-NUM'],
    ['blitz-techno', 46, 'BLITZ-TECHNO'],
  ];
  faces.forEach((fd, i) => {
    const y0 = 700 + i * 100;
    label(c, ui, fd[2], 80, y0 - fd[1] * 0.95, 19, 'rgba(255,206,110,0.92)');
    // auto-fit: the techno face is 2x the advance of the others, so measure and shrink
    const avail = 1560;
    let size = fd[1];
    const total = () => F.measure(ALPHA, fd[0], size, {}).w + F.measure(DIGITS, fd[0], size, {}).w
      + F.measure(PUNCT, fd[0], size, {}).w + size * 1.5;
    if (total() > avail) size = Math.floor(size * avail / total());
    const a = F.draw(c, ALPHA, 296, y0, { face: fd[0], size, fill: '#e9eef5', grain: 0 });
    const b = F.draw(c, DIGITS, 296 + a.w + size * 0.5, y0, { face: fd[0], size, fill: '#ffd34a', grain: 0 });
    F.draw(c, PUNCT, 296 + a.w + b.w + size, y0, { face: fd[0], size, fill: '#9fb0c8', grain: 0 });
  });
}

export const SPECIMENS = {
  iso_type: drawIsoType,
  iso_type_brush: drawIsoBrush,
  iso_type_hud: drawIsoHud,
  iso_type_specimen: drawIsoSpecimen,
};

export default { SPECIMENS, scoreLockup };
