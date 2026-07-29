// PIECE hud-overlay — the top-left scoreboard cluster.
//
// EVERY NUMBER BELOW IS A MEASUREMENT, NOT A GUESS. bar/panel-qb_dropback.png is
// 553x338 for a 1080-tall frame; the concept sheet's panel border sits at panel
// x=30, so logical x = (panelX - 31) * 3.1953 and logical y = panelY * 3.1953.
// Under that mapping the cluster reads:
//
//   cluster bounds          45 .. 681  x  44.7 .. 146.9      (636 x 102)
//   SIX tiles, black gutters ~6.4 wide:
//     chips     45..93     clock   99..169    abbrA  179..275
//     scoreA   281..390    teamB  396..553    scoreB 559..681
//   ink boxes (logical, absolute)
//     clock   99..169 x  54..105     h 51    yards  105..166 x 109..141  h 32
//     NYC    182..256 x  59..105     h 46    22     284..383 x  51..112  h 61
//     crest  403..451               CHI     454..514 x  56..105  h 49
//     14     572..665 x  48..112     h 64    meters       y 128..144    h 16
//
// WHAT ROUND 1 GOT WRONG AND THIS FIXES.
//   * There is NO carrier plate in the bar. No perimeter stroke, no outer halo,
//     no 12 px radius. Six independently recessed near-black glass tiles butted
//     against opaque black gutters, each with a light hairline on its TOP edge
//     only. Sampled: tile interior rgb(13,17,23), gutter rgb(10,11,10), the top
//     hairline rgb(16,18,20) — the chrome is nearly invisible and all the value
//     is in the type, the chips, the crest and the meters.
//   * The type has to FILL its cell. `NYC` is 74 x 46 in a 96-wide tile; `22` is
//     99 x 61 in a 109-wide tile. That is why this file works in ink rectangles
//     (see ink.js) instead of point sizes.
//   * The palette has exactly three accents: an orange->red ramp, a steel blue
//     with light segment pips, and a saturated GOLD meter which is the brightest
//     thing in the cluster. No pink, no purple, no team wash: brand.colors never
//     reaches a letterform at all (that is how round one got a magenta NYC), the
//     abbreviation's cast is picked by SIDE — cool left, warm right — and the club
//     identity is carried entirely by the crest, which is the right place for it.
//
// COST: baked to one offscreen canvas on state change, blitted once per frame.

import {
  mkCanvas, rr, vgrad, hgrad, rgba, mix, lighten, darken, hudColor, lum, chroma, vivid,
  grain, innerEdge,
} from './chrome.js';
import { inkSet } from './ink.js';

/* ------------------------------------------------------------- geometry */

export const PLATE = { x: 46, y: 44, w: 636, h: 103 };
const MG = 22;

/** Tiles, plate-local. Gutters are the 6.4 px gaps BETWEEN these. */
const T_CHIP = { x: 0, w: 48 };
const T_CLK = { x: 54, w: 71 };
const T_ABA = { x: 134, w: 96 };
const T_SCA = { x: 236, w: 109 };
const T_TMB = { x: 352, w: 157 };
const T_SCB = { x: 515, w: 121 };
const TILES = [T_CHIP, T_CLK, T_ABA, T_SCA, T_TMB, T_SCB];

const TR = 3.5;                          // tile corner radius (bar: hard, ~3-4)

/* ink rectangles, plate-local (y measured from the cluster's top edge) */
const IH_CLOCK = 50, IY_CLOCK = 10;
const IH_YARD = 27, IY_YARD = 66;
const IH_ABBR = 46, IY_ABBR = 14;
const IH_SCORE = 61, IY_SCORE = 6;
const MOM = { y: 84, h: 14 };

/** Per-glyph ink widths and ink-to-ink gaps, measured off the bar:
 *   score digit  47 wide x 61 tall, 6 px between the ink   ("22" = 99 wide)
 *   clock digit  33 wide x 51 tall, 4 px between            (":05" = 70)
 *   yard digit   20 wide x 32 tall, 3 px between            ("167" = 61)
 *   abbr cap     22 wide x 46 tall, 3.5 px between          ("NYC" = 74)
 * A run solves ONE horizontal scale to land on those totals, which is what makes
 * the type fill its cell instead of floating in it. */
const G_SCORE = { cell: 47.0, gap: 6.0 };
const G_CLOCK = { cell: 33.0, gap: 4.0 };
const G_YARD = { cell: 20.0, gap: 3.0 };
const G_ABBR = { cell: 22.5, gap: 3.5 };

function runW(g, n) { return g.cell * n + g.gap * Math.max(0, n - 1); }

/* --------------------------------------------------------------- palette */

const BONE = '#e9e3d2';
const GOLD_RAMP = ['#fff6b4', '#ffd21e', '#e0a010', '#a97505'];
const FIRE_RAMP = ['#ffc24a', '#ff8a12', '#ef3a17', '#c0121b'];
const STEEL = '#3d6b96';
const STEEL_PIP = '#bcdcec';

/* type treatments -------------------------------------------------------- */

const NUM_GRAD = [
  [0.00, '#ffffff'],
  [0.52, '#ffffff'],
  [0.84, '#f2f6fb'],
  [1.00, '#dfe7f1'],
];
const KEY = { color: '#000000', k: 0.052 };
const HALO = { color: 'rgba(255,202,124,0.52)', blur: 8, alpha: 0.7, reps: 1 };
const SHADOW = { color: 'rgba(0,3,9,0.92)', blur: 5, dy: 2.4, alpha: 0.62 };

let cv = null, cx = null;
let quality = 1;
export function setQuality(q) { quality = q; }

/* -------------------------------------------------------------- primitives */

/**
 * One recessed glass tile. No outer stroke, no glow: a near-black fill, a lit
 * hairline on the TOP edge only, and a black line under the bottom.
 */
function tile(c, t, h) {
  const p = rr(t.x, 0, t.w, h, TR);
  c.fillStyle = vgrad(c, 0, h, [
    [0.00, 'rgba(26,33,46,0.26)'],
    [0.16, 'rgba(11,14,20,0.17)'],
    [0.68, 'rgba(5,7,11,0.12)'],
    [1.00, 'rgba(9,12,17,0.18)'],
  ]);
  c.fill(p);
  // top hairline, and the faintest wrap down the first fifth of each side
  c.save();
  c.clip(p);
  c.fillStyle = hgrad(c, t.x, t.x + t.w, [
    [0.00, 'rgba(150,180,222,0.05)'],
    [0.07, 'rgba(184,210,246,0.24)'],
    [0.91, 'rgba(172,198,232,0.18)'],
    [1.00, 'rgba(150,180,222,0.05)'],
  ]);
  c.fillRect(t.x, 0, t.w, 1.1);
  c.fillStyle = 'rgba(126,158,200,0.10)';
  c.fillRect(t.x, 0, 1, h * 0.20);
  c.fillRect(t.x + t.w - 1, 0, 1, h * 0.20);
  c.fillStyle = 'rgba(0,0,0,0.55)';
  c.fillRect(t.x, h - 1.2, t.w, 1.2);
  c.restore();
  return p;
}

/** A bone chip: the panel's two little cream blocks at the far left. */
function boneChip(c, x, y, w, h) {
  const p = rr(x, y, w, h, 3);
  c.save();
  c.shadowColor = 'rgba(0,2,6,0.85)';
  c.shadowBlur = 5;
  c.shadowOffsetY = 2;
  c.fillStyle = vgrad(c, y, y + h, [
    [0.00, '#fdfaf1'],
    [0.38, BONE],
    [0.86, '#bdb7a6'],
    [1.00, '#98917f'],
  ]);
  c.fill(p);
  c.restore();
  innerEdge(c, p, 0, 1.0, 'rgba(255,255,255,0.9)', 'rgba(58,52,38,0.5)', 1.2);
  c.strokeStyle = 'rgba(22,20,15,0.7)';
  c.lineWidth = 1;
  c.stroke(p);
  return p;
}

/**
 * A meter. Recessed track, a saturated ramp fill with a specular band and a hot
 * leading edge, and a thin amber baseline rule under the whole cell — all three
 * of those are in the bar and none of them is a flat rectangle.
 */
function meter(c, x, w, ramp, fill, opts) {
  const y = MOM.y, h = MOM.h;
  const o = opts || {};
  const track = rr(x, y, w, h, 2);
  c.fillStyle = vgrad(c, y, y + h, [
    [0.00, 'rgba(2,3,5,0.95)'],
    [0.34, 'rgba(16,19,24,0.92)'],
    [1.00, 'rgba(30,35,42,0.88)'],
  ]);
  c.fill(track);
  innerEdge(c, track, 0, 0.9, 'rgba(0,0,0,0.8)', 'rgba(150,172,200,0.16)', 1.1);

  const v = Math.max(0, Math.min(1, fill));
  const fw = Math.round(w * v);
  if (fw > 1) {
    c.save();
    c.clip(track);
    c.fillStyle = hgrad(c, x, x + Math.max(6, fw), [
      [0.00, ramp[0]],
      [0.34, ramp[1]],
      [0.74, ramp[2]],
      [1.00, ramp[3]],
    ]);
    c.fillRect(x, y, fw, h);
    // glossy cylinder: bright lip near the top, deep foot
    c.fillStyle = vgrad(c, y, y + h, [
      [0.00, 'rgba(255,255,255,0.34)'],
      [0.20, 'rgba(255,255,255,0.12)'],
      [0.44, 'rgba(255,255,255,0.00)'],
      [1.00, 'rgba(0,0,0,0.40)'],
    ]);
    c.fillRect(x, y, fw, h);
    if (v < 0.995 && fw > 4) {
      c.fillStyle = 'rgba(255,255,255,0.55)';
      c.fillRect(x + fw - 1.6, y + 1, 1.6, h - 2);
    }
    c.restore();
  }
  if (o.pips) {
    // the bar's steel-blue cell carries two bright segment pips
    c.save();
    c.clip(track);
    for (let i = 0; i < o.pips; i++) {
      const px = x + w * (0.56 + i * 0.13);
      c.fillStyle = STEEL_PIP;
      c.fillRect(px, y + 2.4, 7.5, h - 4.8);
      c.fillStyle = 'rgba(255,255,255,0.45)';
      c.fillRect(px, y + 2.4, 7.5, 1.6);
      c.fillStyle = 'rgba(0,0,0,0.45)';
      c.fillRect(px + 3.4, y + 2.4, 1, h - 4.8);
    }
    c.restore();
  }
  if (o.rule) {
    c.fillStyle = hgrad(c, x, x + w, [
      [0.00, rgba(o.rule, 0.85)],
      [0.72, rgba(o.rule, 0.55)],
      [1.00, rgba(o.rule, 0.10)],
    ]);
    c.fillRect(x, y + h + 1.4, w, 1.6);
  }
}

/* -------------------------------------------------------------- the crest */

let crestScratch = null, crestKeyed = null;
/**
 * The bar's crest is a saturated hard-edged red mark and one of the three
 * brightest things in the cluster. `ui.brand.crest` at 42 px on near-black comes
 * back a dark brown smudge, so: pull a 256 px source, key the chroma up through
 * a source-atop pass, add an additive self-composite for luminance, and lay a
 * true-black keyline under it built from the mark's own alpha.
 */
function drawCrest(c, ui, id, x, y, s, accent) {
  let img = null;
  try { img = ui.brand && ui.brand.crest ? ui.brand.crest(id, 256) : null; } catch (e) { img = null; }
  if (!img) return;
  const R = 128;
  if (!crestScratch) { crestScratch = mkCanvas(R, R); crestKeyed = mkCanvas(R + 8, R + 8); }
  const a = crestScratch.getContext('2d');
  a.setTransform(1, 0, 0, 1, 0, 0);
  a.clearRect(0, 0, R, R);
  a.imageSmoothingEnabled = true;
  a.imageSmoothingQuality = 'high';
  a.drawImage(img, 0, 0, R, R);
  // key the mark up: saturate toward the club accent, then lift luminance
  a.globalCompositeOperation = 'source-atop';
  const g = a.createLinearGradient(0, 0, 0, R);
  g.addColorStop(0, rgba(lighten(accent, 0.30), 0.50));
  g.addColorStop(0.55, rgba(accent, 0.44));
  g.addColorStop(1, rgba(darken(accent, 0.22), 0.52));
  a.fillStyle = g;
  a.fillRect(0, 0, R, R);
  a.globalCompositeOperation = 'source-over';

  const b = crestKeyed.getContext('2d');
  b.setTransform(1, 0, 0, 1, 0, 0);
  b.clearRect(0, 0, R + 8, R + 8);
  b.drawImage(crestScratch, 4, 4);
  b.globalCompositeOperation = 'source-in';
  b.fillStyle = '#000';
  b.fillRect(0, 0, R + 8, R + 8);
  b.globalCompositeOperation = 'source-over';

  const k = s / R;
  c.save();
  // accent bloom so the mark never dies against near-black
  const gx = x + s / 2, gy = y + s / 2;
  const rg = c.createRadialGradient(gx, gy, 1, gx, gy, s * 0.72);
  rg.addColorStop(0, rgba(accent, 0.26));
  rg.addColorStop(0.55, rgba(accent, 0.08));
  rg.addColorStop(1, rgba(accent, 0));
  c.fillStyle = rg;
  c.fillRect(x - s * 0.25, y - s * 0.2, s * 1.5, s * 1.4);
  // black keyline from the mark's own silhouette
  c.globalAlpha = 0.85;
  for (let i = 0; i < 4; i++) {
    const dx = (i === 0 ? -1 : i === 1 ? 1 : 0) * 1.4;
    const dy = (i === 2 ? -1 : i === 3 ? 1 : 0) * 1.4;
    c.drawImage(crestKeyed, x - 4 * k + dx, y - 4 * k + dy, (R + 8) * k, (R + 8) * k);
  }
  c.globalAlpha = 1;
  c.drawImage(crestScratch, x, y, s, s);
  c.globalCompositeOperation = 'lighter';
  c.globalAlpha = 0.38;
  c.drawImage(crestScratch, x, y, s, s);
  c.restore();
}

/* ------------------------------------------------------------- team block */

/** Club colour, clamped into the cluster's sanctioned family. */
function castOf(ui, id) {
  const team = (ui.brand && ui.brand.byId) ? ui.brand.byId(id) : null;
  const col = (team && team.colors) || null;
  let a = col ? hudColor(col) : [150, 176, 214];
  // A magenta or purple club must not paint a magenta HUD: push anything in the
  // pink/violet wedge onto the nearest sanctioned hue (warm red or steel blue).
  const mx = Math.max(a[0], a[1], a[2]);
  if (mx > 0 && chroma(a) > 0.10) {
    const r = a[0] / mx, g = a[1] / mx, b = a[2] / mx;
    if (r > 0.55 && b > 0.55 && g < 0.72) {
      a = b > r ? vivid(mix(a, [90, 150, 210], 0.72), 1.15) : vivid(mix(a, [214, 60, 40], 0.72), 1.15);
    }
  }
  if (lum(a) < 0.34) a = lighten(a, 0.24);
  return a;
}

/**
 * ABBREVIATION COLOUR IS NOT THE CLUB COLOUR.
 * The bar sets its left abbreviation cool white and its right one warm cream, and
 * there is no pink and no purple anywhere in the cluster. Feeding brand.colors
 * into the letterforms is exactly how round one ended up with a magenta NYC, so
 * the club never touches the fill: the SIDE picks the cast, and that is all. The
 * club identity is carried by the crest, which is the right place for it.
 */
const ABBR_COOL = [
  [0.00, '#ffffff'],
  [0.50, '#fdfeff'],
  [0.88, '#eaf0f8'],
  [1.00, '#ccd7e4'],
];
const ABBR_WARM = [
  [0.00, '#fffdf4'],
  [0.50, '#fff8e6'],
  [0.88, '#f2e2bd'],
  [1.00, '#d9c396'],
];

/** A three-letter club abbreviation, packed into its cell. */
function abbr(F, c, id, x, maxW, grad, halo) {
  const s = String(id || '').toUpperCase();
  if (!s) return;
  return inkSet(F, c, s, 'blitz-block', {
    x, y: IY_ABBR, h: IH_ABBR, align: 'left',
    w: Math.min(maxW, runW(G_ABBR, s.length)),
    gap: G_ABBR.gap, maxXs: 1.9, minXs: 0.85,
    keyline: { color: '#000000', k: 0.055 },
    shadow: SHADOW,
    halo: { color: halo, blur: 9, alpha: 0.7, reps: 1 },
    grad,
    shade: { color: 'rgba(10,16,28,0.14)', dy: 2.2, alpha: 1 },
  });
}

/** A score numeral, right-aligned and packed to the cell. */
function score(F, c, v, xRight, maxW) {
  const s = String(v);
  return inkSet(F, c, s, 'blitz-num', {
    x: xRight, y: IY_SCORE, h: IH_SCORE, align: 'right',
    w: Math.min(maxW, runW(G_SCORE, s.length)),
    gap: G_SCORE.gap, maxXs: 1.85, minXs: 1.0,
    keyline: KEY, halo: HALO, shadow: SHADOW, grad: NUM_GRAD,
    shade: { color: 'rgba(12,20,34,0.15)', dy: 2.6, alpha: 1 },
  });
}

/* ------------------------------------------------------------------ bake */

export function bake(ui, S, k) {
  const s = k || 1;
  const W = Math.round(BOX.w * s), H = Math.round(BOX.h * s);
  if (!cv) { cv = mkCanvas(W, H); cx = cv.getContext('2d'); }
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const c = cx;
  const F = ui.faces;
  const PH = PLATE.h;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, W, H);
  c.setTransform(s, 0, 0, s, 0, 0);
  c.translate(MG, MG);
  c.lineJoin = 'round';
  c.miterLimit = 2;

  /* ---- carrier: opaque black gutters, then six recessed tiles ----------- */
  const bounds = rr(-1, -1, PLATE.w + 2, PH + 2, TR + 1);
  c.save();
  c.shadowColor = 'rgba(0,2,6,0.62)';
  c.shadowBlur = 9;
  c.shadowOffsetY = 3.5;
  c.fillStyle = 'rgba(0,0,0,0.90)';
  c.fill(bounds);
  c.restore();
  for (const t of TILES) tile(c, t, PH);
  grain(c, bounds, 0, 0, PLATE.w, PH, 0x2c19, 0.55 * quality);

  const castB = castOf(ui, S.teamB);

  /* ---- left cap: two cream chips, each holding a tiny dark mark ----------
     The bar's left chip is a TALL cream tile carrying two dark marks over a
     SHORT one carrying a single mark. Round one rotated "2ND" -90 degrees into
     this slot, which is illegible at 1x and appears nowhere in the art. Here the
     tall chip is the DOWN as up-to-four dark bars and the short chip is the
     quarter as an upright dark numeral. ----------------------------------- */
  const chipX = 10, chipW = 28;
  boneChip(c, chipX, 7, chipW, 55);
  const down = Math.max(1, Math.min(4, parseInt(String(S.dist || '1'), 10) || 1));
  for (let i = 0; i < 4; i++) {
    const on = i < down;
    c.fillStyle = on ? '#191d25' : 'rgba(124,118,102,0.30)';
    c.fill(rr(chipX + 7, 12 + i * 11, 14, 6.4, 1.8));
    if (on) {
      c.fillStyle = 'rgba(255,255,255,0.26)';
      c.fillRect(chipX + 7, 17.4 + i * 11, 14, 0.9);
    }
  }
  boneChip(c, chipX, 66, chipW, 30);
  inkSet(F, c, String(S.quarter || '').replace(/[^0-9A-Z]/g, '').slice(0, 1) || '1',
    'blitz-block', {
      x: chipX + chipW / 2, y: 71, h: 19, align: 'center', gap: 2,
      fill: '#14171d',
    });

  /* ---- clock cell ------------------------------------------------------- */
  const ck = String(S.clock);
  inkSet(F, c, ck, 'blitz-num', {
    x: T_CLK.x + T_CLK.w - 2, y: IY_CLOCK, h: IH_CLOCK, align: 'right',
    w: Math.min(T_CLK.w - 4, runW(G_CLOCK, ck.length) - (ck.indexOf(':') >= 0 ? 20 : 0)),
    gap: G_CLOCK.gap, maxXs: 1.6, minXs: 0.95,
    keyline: KEY, halo: { color: 'rgba(190,214,255,0.42)', blur: 8, alpha: 0.75, reps: 1 },
    shadow: SHADOW, grad: NUM_GRAD,
    shade: { color: 'rgba(12,20,34,0.15)', dy: 2.2, alpha: 1 },
  });

  /* ---- second line: the YARDAGE, white outlined, with a gold rule under it.
     Round 1 had this inverted — small gold text at half the size. The bar sets it
     in the same numeral face at ~63% of the clock's ink height and puts the gold
     in a stripe beneath, not in the letterforms. ---------------------------- */
  const yard = String(S.yards === undefined || S.yards === null ? '' : S.yards);
  const yr = inkSet(F, c, yard, 'blitz-num', {
    x: T_CLK.x + 6, y: IY_YARD, h: IH_YARD, align: 'left',
    w: Math.min(T_CLK.w - 12, runW(G_YARD, yard.length)),
    gap: G_YARD.gap, maxXs: 1.7, minXs: 0.9,
    keyline: { color: '#000000', k: 0.06 },
    shadow: { color: 'rgba(0,3,9,0.85)', blur: 5, dy: 2, alpha: 0.85 },
    grad: NUM_GRAD,
  });
  const rw = Math.max(26, Math.min(T_CLK.w - 8, yr.w + 6));
  c.fillStyle = hgrad(c, T_CLK.x + 4, T_CLK.x + 4 + rw, [
    [0.00, 'rgba(255,246,180,0.95)'],
    [0.42, 'rgba(255,210,30,0.92)'],
    [1.00, 'rgba(170,118,10,0.55)'],
  ]);
  c.fillRect(T_CLK.x + 4, IY_YARD + IH_YARD + 2.5, rw, 3.2);
  c.fillStyle = 'rgba(255,255,255,0.35)';
  c.fillRect(T_CLK.x + 4, IY_YARD + IH_YARD + 2.5, rw, 1);

  /* ---- team A: abbreviation + score + fire meter ------------------------- */
  abbr(F, c, S.teamA, T_ABA.x + 3, T_ABA.w - 20, ABBR_COOL, 'rgba(150,190,240,0.26)');
  score(F, c, S.scoreA, T_SCA.x + T_SCA.w - 6, T_SCA.w - 8);

  /* ---- team B: crest + abbreviation + possession mark + score + gold ----- */
  drawCrest(c, ui, S.teamB, T_TMB.x + 5, 7, 50, castB);
  abbr(F, c, S.teamB, T_TMB.x + 58, 78, ABBR_WARM, 'rgba(255,206,130,0.28)');
  score(F, c, S.scoreB, T_SCB.x + T_SCB.w - 6, T_SCB.w - 8);

  // possession: the bar's tiny amber mark tucked to the right of the crested
  // team's abbreviation. Drawn on whichever side actually has the ball.
  const pv = [
    [T_ABA.x + T_ABA.w - 14, 24],
    [T_TMB.x + 138, 24],
  ][S.possess === 1 ? 1 : 0];
  c.save();
  c.shadowColor = 'rgba(255,140,26,0.8)';
  c.shadowBlur = 6;
  c.fillStyle = vgrad(c, pv[1], pv[1] + 17, [
    [0, '#ffc663'], [0.45, '#f47c0c'], [1, '#b23c06'],
  ]);
  c.beginPath();
  c.moveTo(pv[0], pv[1]);
  c.lineTo(pv[0] + 9, pv[1] + 8.5);
  c.lineTo(pv[0], pv[1] + 17);
  c.closePath();
  c.fill();
  c.restore();
  c.strokeStyle = 'rgba(0,0,0,0.85)';
  c.lineWidth = 1.2;
  c.beginPath();
  c.moveTo(pv[0], pv[1]);
  c.lineTo(pv[0] + 9, pv[1] + 8.5);
  c.lineTo(pv[0], pv[1] + 17);
  c.closePath();
  c.stroke();

  /* ---- meters ----------------------------------------------------------- */
  // Under the abbreviations: the timeout row, steel blue with light pips.
  // Under the scores: momentum. Left team burns orange->red, right team gold —
  // and the gold is the brightest accent in the whole cluster, exactly as in the
  // bar. Neither is derived from brand.colors, because the bar's cluster has no
  // pink and no purple in it anywhere.
  meter(c, T_ABA.x + 1, T_ABA.w - 2, [STEEL, STEEL, STEEL, STEEL],
    0.34 + 0.22 * Math.max(0, Math.min(3, S.timeouts | 0)), { pips: Math.max(0, Math.min(3, S.timeouts | 0)) });
  meter(c, T_SCA.x + 1, T_SCA.w - 2, FIRE_RAMP, S.momA, { rule: '#e2a428' });
  meter(c, T_TMB.x + 1, T_TMB.w - 2, [STEEL, STEEL, STEEL, STEEL],
    0.30 + 0.20 * Math.max(0, Math.min(3, S.timeoutsB === undefined ? 2 : S.timeoutsB | 0)),
    { pips: Math.max(0, Math.min(3, S.timeoutsB === undefined ? 2 : S.timeoutsB | 0)) });
  meter(c, T_SCB.x + 1, T_SCB.w - 2, GOLD_RAMP, S.momB, { rule: '#e2a428' });

  c.setTransform(1, 0, 0, 1, 0, 0);
  return cv;
}

/* ------------------------------------------- timing-feedback surfaces (FX)
 * The timing-windows piece emits PERFECT and MISSED events. Both are baked once
 * into their own layer and blitted with a scalar alpha, so a 180 ms fade costs
 * one extra drawImage and never re-rasterises anything.
 */

let fxA = null, fxB = null, fxK = -1;

/** Scale-only: the timing surfaces do not depend on game state, so this is a
 *  no-op after the first call at a given blit scale. */
export function bakeFx(k) {
  const s = k || 1;
  if (fxA && fxK === s && fxA.width > 4) return;
  fxK = s;
  const W = Math.round(BOX.w * s), H = Math.round(BOX.h * s);
  if (!fxA) { fxA = mkCanvas(W, H); fxB = mkCanvas(W, H); }
  if (fxA.width !== W) { fxA.width = W; fxA.height = H; fxB.width = W; fxB.height = H; }
  const h = PLATE.h;
  const p = rr(-1, -1, PLATE.w + 2, h + 2, TR + 1);

  // PERFECT: a white-hot rim plus a warm inner wash.
  const a = fxA.getContext('2d');
  a.setTransform(1, 0, 0, 1, 0, 0);
  a.clearRect(0, 0, W, H);
  a.setTransform(s, 0, 0, s, 0, 0);
  a.translate(MG, MG);
  a.save();
  a.shadowColor = 'rgba(255,226,150,0.95)';
  a.shadowBlur = 18;
  a.strokeStyle = 'rgba(255,248,220,0.95)';
  a.lineWidth = 2.8;
  a.stroke(p);
  a.stroke(p);
  a.restore();
  a.save();
  a.clip(p);
  a.fillStyle = vgrad(a, 0, h, [
    [0, 'rgba(255,236,180,0.30)'],
    [0.55, 'rgba(255,196,90,0.10)'],
    [1, 'rgba(255,170,60,0.00)'],
  ]);
  a.fillRect(0, 0, PLATE.w, h);
  a.restore();
  a.setTransform(1, 0, 0, 1, 0, 0);

  // MISSED: a hard red tick down the left cap plus a red rim on the clock tile.
  const b = fxB.getContext('2d');
  b.setTransform(1, 0, 0, 1, 0, 0);
  b.clearRect(0, 0, W, H);
  b.setTransform(s, 0, 0, s, 0, 0);
  b.translate(MG, MG);
  b.save();
  b.shadowColor = 'rgba(240,60,40,0.95)';
  b.shadowBlur = 13;
  b.fillStyle = vgrad(b, 0, h, [
    [0, 'rgba(255,120,90,0.95)'],
    [0.5, 'rgba(226,32,28,0.95)'],
    [1, 'rgba(120,10,10,0.92)'],
  ]);
  b.fillRect(-5, 3, 4, h - 6);
  b.fillRect(-5, 3, 4, h - 6);
  b.restore();
  b.save();
  b.strokeStyle = 'rgba(228,44,34,0.85)';
  b.lineWidth = 1.8;
  b.stroke(rr(T_CLK.x - 1, -1, T_CLK.w + 2, h + 2, TR + 1));
  b.restore();
  b.setTransform(1, 0, 0, 1, 0, 0);
}

/** Blit the timing surfaces. Two numeric-arg drawImage calls at most. */
export function drawFx(c, ox, oy, flash, miss, k) {
  const d = k || 1;
  if (flash > 0.002 && fxA) {
    c.save();
    c.globalAlpha = flash > 1 ? 1 : flash;
    c.globalCompositeOperation = 'lighter';
    c.drawImage(fxA, ox, oy, BOX.w * d, BOX.h * d);
    c.restore();
  }
  if (miss > 0.002 && fxB) {
    c.save();
    c.globalAlpha = miss > 1 ? 1 : miss;
    c.drawImage(fxB, ox, oy, BOX.w * d, BOX.h * d);
    c.restore();
  }
}

export function canvas() { return cv; }
export function invalidate() { if (cv) { cv.width = 1; cv.height = 1; } }
export const ORIGIN = { x: PLATE.x - MG, y: PLATE.y - MG };
export const BOX = { w: PLATE.w + MG * 2, h: PLATE.h + MG * 2, mg: MG };
/**
 * The six tile rects, plate-local. Exported so a dirty-rect caller can invalidate
 * exactly the cell whose value changed — the clock ticks once a second and nothing
 * else in the cluster moves with it — rather than the whole 636 x 103 strip.
 */
export const CELLS = { T_CHIP, T_CLK, T_ABA, T_SCA, T_TMB, T_SCB };
