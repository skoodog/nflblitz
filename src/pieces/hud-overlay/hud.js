// PIECE hud-overlay — the top-left scoreboard cluster.
//
// EVERY NUMBER BELOW IS A MEASUREMENT, NOT A GUESS. bar/panel-qb_dropback.png is
// 553x338 for a 1080-tall frame; the concept sheet's panel border sits at panel
// x=30, so logical x = (panelX - 31) * 3.1953 and logical y = panelY * 3.1953.
// Under that mapping the cluster reads:
//
//   cluster bounds          44.7 .. 681  x  41.5 .. 144.5    (636 x 103)
//   SIX tiles, black gutters ~6.4 wide (panel x 45|61 62|85 86|117 118|154
//   155|205 206|..., measured off a contrast-stretched 7x crop):
//     chips     45..93     clock   99..169    abbrA  179..275
//     scoreA   281..390    teamB  396..553    scoreB 559..681
//   ink boxes (logical, cluster-local y) — RE-MEASURED IN ROUND 2, per cell,
//   with the meter row masked so the bright accents cannot inflate the box:
//     :05    70.3 x 47.9  y 12.8..60.7      167   63.9 x 32.0  y 54.3..86.3
//     NYC    73.5 x 41.5  y 22.4..63.9      22    99.1 x 60.7  y  9.6..70.3
//     crest  54 x 74      tile-local 0..54  CHI   63.9 x 47.9  y 19.2..63.9
//     14     92.7 x 63.9  y  6.4..70.3      meters      y 83..102, flush to foot
//
// WHAT THE ROUNDS GOT WRONG AND THIS FIXES.
//   * There is NO carrier plate in the bar. No perimeter stroke, no outer halo,
//     no 12 px radius. Six independently recessed near-black tiles butted against
//     opaque black gutters, each with a light hairline on its TOP edge only.
//     Sampled: tile interior rgb(13,17,23), gutter rgb(10,11,10), the top hairline
//     rgb(16,18,20) — three values of separation. The chrome is nearly invisible
//     and all the value is in the type, the chips, the crest and the meters, so
//     round 2 cut the hairline to a fifth of its alpha and took the blue out of
//     the tile fill, which is where the cluster's cool cast was coming from.
//   * The type has to FILL its cell, and the two abbreviations are NOT one size:
//     the left is 73.5 x 41.5 (0.54 aspect) and the crested right is 63.9 x 47.9
//     (0.40). The YARDAGE is not a caption either — 32 logical of ink, a third
//     shorter than the clock, stacked so tight the boxes nearly touch, with the
//     gold sitting down on the METER ROW rather than hung under the type.
//   * The palette has exactly three accents: an orange->red ramp, a steel blue
//     with light segment pips, and a saturated GOLD meter which is the brightest
//     thing in the cluster. No pink, no purple, no team wash: brand.colors never
//     reaches a letterform at all (that is how round one got a magenta NYC), the
//     abbreviation's cast is picked by SIDE — cool left, warm right — and the club
//     identity is carried entirely by the crest, which is the right place for it.
//     The two TIMEOUT rows are nearly all dark track in the art; driving them to a
//     full blue fill put two more bright bars in a row the bar keeps quiet.
//   * ROUND 3 — the digits themselves were BROKEN, and no amount of layout was
//     going to matter until they were not. `blitz-num`'s '2', '3' and '5' are
//     assembled from butt-capped strokes that meet without a join, so the union
//     carries a sharp empty wedge exactly where the eye looks for the letter's
//     spine, and the keyline paints it black: '22' read as two question marks
//     over two floating dashes. The wedges are closed here by the bevel the
//     stroker owed (JOINTS in ink.js) and the keyline is now composited UNDER
//     the ink rather than merely painted before it. MEASURED, darkest pixel
//     inside the glyph body after a 2 px erosion, this piece vs the art:
//         before  '22' 183.9   ':05' 206.2      (round-3 first pass)
//         after   '22' 225.4   ':05' 227.3
//         bar     '22' 220.3   '14'  218.9
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

/* INK RECTANGLES, plate-local, y from the cluster's top edge.
 * ROUND 2 re-measurement. Every number here was re-derived by thresholding
 * bar/panel-qb_dropback.png cell by cell with the meter row excluded, because
 * round 1's boxes were contaminated by the bright meters underneath and came out
 * short. Panel ink -> logical is (panelPx) * 3.1953 with the cluster top at
 * panel y = 13:
 *
 *   cell     panel ink box        LOGICAL ink   local y
 *   :05      x 62..83  y 17..31   70.3 x 47.9   12.8 .. 60.7
 *   167      x 63..82  y 30..39   63.9 x 32.0   54.3 .. 86.3
 *   NYC      x 88..110 y 20..32   73.5 x 41.5   22.4 .. 63.9
 *   22       x 120..150 y 16..34  99.1 x 60.7    9.6 .. 70.3
 *   CHI      x 173..192 y 19..33  63.9 x 47.9   19.2 .. 63.9
 *   14       x 210..238 y 15..34  92.7 x 63.9    6.4 .. 70.3
 *   meters                y 39..44              83.1 ..102.2  (flush to the foot)
 *
 * Two things fall out of that table which round 1 had wrong. The YARDAGE is not a
 * caption — it is 32 logical of ink, only a third smaller than the clock above it,
 * and the two are stacked so tightly they nearly touch. And the two abbreviations
 * are NOT the same size: the left one is 73.5 x 41.5 (wide letters, 0.54 aspect)
 * and the crested right one is 63.9 x 47.9 (tall condensed letters, 0.40 aspect).
 * Setting both from one box is what left the right cell looking loose. */
const IH_CLOCK = 48, IY_CLOCK = 12;
const IH_YARD = 31, IY_YARD = 54;
const IH_ABBR = 42, IY_ABBR = 21;
const IH_ABBR_R = 46, IY_ABBR_R = 19;
const IH_SCORE = 62, IY_SCORE = 8;
const MOM = { y: 86, h: 13 };

/** Per-glyph ink widths and ink-to-ink gaps, measured off the bar. The score and
 * abbreviation cells were re-run glyph by glyph in round 2 (column-run
 * segmentation, meter row masked off):
 *   score digit  44.7 wide x 61 tall, 9.6 px between the ink  ("22" = 99.1)
 *   clock digit  33 wide x 48 tall, 4 px between              (":05" = 70.3)
 *   yard digit   19.5 wide x 32 tall, 3 px between            ("167" = 64.5)
 *   abbr cap L   22.4 wide x 41.5 tall, 4.8 px between        ("NYC" = 74.5)
 *   abbr cap R   20.5 wide x 47.9 tall, 1.5 px between        ("CHI" = 64.5)
 * A run solves ONE horizontal scale to land on those totals, which is what makes
 * the type fill its cell instead of floating in it. */
const G_SCORE = { cell: 44.7, gap: 9.6 };
const G_CLOCK = { cell: 33.0, gap: 4.0 };
const G_YARD = { cell: 19.5, gap: 3.0 };
const G_ABBR = { cell: 22.5, gap: 3.5 };
const G_ABBR_R = { cell: 20.5, gap: 1.5 };

function runW(g, n) { return g.cell * n + g.gap * Math.max(0, n - 1); }

/* --------------------------------------------------------------- palette */

const BONE = '#e9e3d2';
const GOLD_RAMP = ['#fff6b4', '#ffd21e', '#e0a010', '#a97505'];
const FIRE_RAMP = ['#ffc24a', '#ff8a12', '#ef3a17', '#c0121b'];
const STEEL = '#3d6b96';
const STEEL_PIP = '#bcdcec';

/* type treatments -------------------------------------------------------- */

// The bar's numerals are FLAT paper white with only a whisper of cool in the last
// eighth — not a silver ramp. Round 1's ramp turned over at 0.52 and, with the
// inner top-light on top of it, put a visible seam across the waist of every digit.
const NUM_GRAD = [
  [0.00, '#ffffff'],
  [0.70, '#ffffff'],
  [0.90, '#f6f9fd'],
  [1.00, '#e7edf5'],
];
const KEY = { color: '#000000', k: 0.052 };
const HALO = { color: 'rgba(255,202,124,0.52)', blur: 8, alpha: 0.7, reps: 1 };
const SHADOW = { color: 'rgba(0,3,9,0.92)', blur: 5, dy: 2.4, alpha: 0.62 };
/* The modelling, MEASURED off the bar and applied to the SILHOUETTE, never to
 * each subpath (see the `lit` pass in ink.js). Eroded interior of the bar's own
 * numerals, panel-qb_dropback at 1:1:
 *     '22'  mean 237.7  std 7.2  min 220  corr(lum,y) -0.38
 *     '14'  mean 241.3  std 6.4  min 219  corr(lum,y) -0.13
 * i.e. a gentle bright-top / cool-foot ramp with a floor around 220 and NO
 * internal seam anywhere. Round 2's per-subpath top-light produced the same std
 * and the same sign of correlation and a floor of 158, because the seams it drew
 * inside the '2' and the '5' are exactly the pixels that set the minimum. */
const LIT_NUM = { top: 'rgba(255,255,255,0.30)', topH: 0.12, foot: 'rgba(16,26,44,0.075)', footH: 0.34 };
const LIT_ABBR = { top: 'rgba(255,255,255,0.30)', topH: 0.14, foot: 'rgba(12,20,36,0.11)', footH: 0.36 };

let cv = null, cx = null;
let quality = 1;
export function setQuality(q) { quality = q; }

/* ------------------------------------------------------------ grain layer
 * The cluster re-bakes every time the CLOCK STRING CHANGES — once a second — and
 * `grain()` paints w*h*0.10 individual fillRects, 3600 of them across a 636x103
 * cluster, each one setting a freshly built `rgba(...)` string. Measured on the
 * perf harness that put the overlay's p95 at 6.4 ms against a 4.15 ms budget while
 * its p50 sat at 0.30 ms: the median frame is just the blit, and every clock tick
 * was a spike. The speckle does not depend on game state, so it is baked ONCE per
 * (quality, scale) and composited as a single drawImage. */
let grainCv = null, grainQ = -1, grainS = -1;
function grainLayer(s) {
  const W = Math.max(1, Math.round(PLATE.w * s)), H = Math.max(1, Math.round(PLATE.h * s));
  if (grainCv && grainQ === quality && grainS === s && grainCv.width === W) return grainCv;
  if (!grainCv) grainCv = mkCanvas(W, H);
  if (grainCv.width !== W || grainCv.height !== H) { grainCv.width = W; grainCv.height = H; }
  const g = grainCv.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, W, H);
  g.setTransform(s, 0, 0, s, 0, 0);
  grain(g, rr(0, 0, PLATE.w, PLATE.h, TR), 0, 0, PLATE.w, PLATE.h, 0x2c19, 0.55 * quality);
  g.setTransform(1, 0, 0, 1, 0, 0);
  grainQ = quality; grainS = s;
  return grainCv;
}

/* -------------------------------------------------------------- primitives */

/**
 * One recessed glass tile. No outer stroke, no glow: a near-black fill, a lit
 * hairline on the TOP edge only, and a black line under the bottom.
 */
function tile(c, t, h) {
  const p = rr(t.x, 0, t.w, h, TR);
  // NEUTRAL, not blue. Sampled off the bar the tile interior is rgb(13,17,23) and
  // the gutter rgb(10,11,10): a 4-value step, essentially no hue. Round 1's top
  // stop was rgba(26,33,46) — a distinctly blue band across the top of every cell,
  // which is where the cluster's cool cast was coming from.
  c.fillStyle = vgrad(c, 0, h, [
    [0.00, 'rgba(23,26,31,0.22)'],
    [0.16, 'rgba(12,14,17,0.16)'],
    [0.68, 'rgba(5,6,8,0.12)'],
    [1.00, 'rgba(9,11,14,0.18)'],
  ]);
  c.fill(p);
  // Top hairline. The bar's is rgb(16,18,20) against a rgb(13,17,23) interior —
  // three values of separation, all but invisible. It is a recess cue, not a frame,
  // so it runs at a fifth of round 1's alpha.
  c.save();
  c.clip(p);
  c.fillStyle = hgrad(c, t.x, t.x + t.w, [
    [0.00, 'rgba(150,170,196,0.03)'],
    [0.07, 'rgba(178,196,220,0.11)'],
    [0.91, 'rgba(166,184,208,0.08)'],
    [1.00, 'rgba(150,170,196,0.03)'],
  ]);
  c.fillRect(t.x, 0, t.w, 1.1);
  c.fillStyle = 'rgba(126,148,180,0.06)';
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

let crestScratch = null, crestKeyed = null, crestCacheKey = '';
/**
 * The bar's crest is a saturated hard-edged red mark and one of the three
 * brightest things in the cluster. `ui.brand.crest` at 42 px on near-black comes
 * back a dark brown smudge, so: pull a 256 px source, key the chroma up through
 * a source-atop pass, add an additive self-composite for luminance, and lay a
 * true-black keyline under it built from the mark's own alpha.
 */
function drawCrest(c, ui, id, x, y, s, accent) {
  const R = 128;
  // Keyed once per (club, accent). The keying is four canvas ops and a gradient on
  // a 128 px surface, and the club does not change when the clock ticks — paying it
  // on every re-bake was the second-largest thing in the bake after the grain.
  const want = String(id) + '|' + accent[0] + ',' + accent[1] + ',' + accent[2];
  if (crestCacheKey !== want) {
    let img = null;
    try { img = ui.brand && ui.brand.crest ? ui.brand.crest(id, 256) : null; } catch (e) { img = null; }
    if (!img) { crestCacheKey = ''; return; }
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
    crestCacheKey = want;
  }
  if (!crestScratch) return;

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
  // The bar's crest is one of the three brightest things in the cluster — a hard
  // saturated red silhouette, not a dark mark on a dark tile. Two additive passes
  // rather than one, because a single 0.38 pass still left it reading as a smudge
  // against rgb(13,17,23).
  c.globalCompositeOperation = 'lighter';
  c.globalAlpha = 0.42;
  c.drawImage(crestScratch, x, y, s, s);
  c.globalAlpha = 0.26;
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

/**
 * A club abbreviation, packed into its cell. `side` picks the measured box: the
 * bar's left cell is wide-and-shorter, the crested right cell is tall-and-tighter,
 * and the two really are different sizes in the art (see the table above).
 */
function abbr(F, c, id, x, maxW, grad, halo, side) {
  const s = String(id || '').toUpperCase();
  if (!s) return;
  const G = side === 1 ? G_ABBR_R : G_ABBR;
  return inkSet(F, c, s, 'blitz-block', {
    x, y: side === 1 ? IY_ABBR_R : IY_ABBR, h: side === 1 ? IH_ABBR_R : IH_ABBR,
    align: 'left',
    w: Math.min(maxW, runW(G, s.length)),
    gap: G.gap, maxXs: 1.9, minXs: 0.72,
    keyline: { color: '#000000', k: 0.055 },
    shadow: SHADOW,
    halo: { color: halo, blur: 9, alpha: 0.7, reps: 1 },
    grad,
    lit: LIT_ABBR,
  });
}

/** A score numeral, right-aligned and packed to the cell. */
function score(F, c, v, xRight, maxW) {
  const s = String(v);
  return inkSet(F, c, s, 'blitz-num', {
    x: xRight, y: IY_SCORE, h: IH_SCORE, align: 'right',
    w: Math.min(maxW, runW(G_SCORE, s.length)),
    // minXs 0.62, not 1.0: a three-digit score wants 153 of ink in a 102-wide cell,
    // and a floor of 1.0 made the run refuse to compress and overrun its tile.
    gap: G_SCORE.gap, maxXs: 1.85, minXs: 0.62,
    keyline: KEY, halo: HALO, shadow: SHADOW, grad: NUM_GRAD,
    lit: LIT_NUM,
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
  if (quality > 0.01) c.drawImage(grainLayer(s), 0, 0, PLATE.w, PLATE.h);

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
    x: T_CLK.x + T_CLK.w - 1, y: IY_CLOCK, h: IH_CLOCK, align: 'right',
    w: Math.min(T_CLK.w - 2, runW(G_CLOCK, ck.length) - (ck.indexOf(':') >= 0 ? 20 : 0)),
    gap: G_CLOCK.gap, maxXs: 1.6, minXs: 0.9,
    keyline: KEY, halo: { color: 'rgba(190,214,255,0.42)', blur: 8, alpha: 0.75, reps: 1 },
    shadow: SHADOW, grad: NUM_GRAD,
    lit: LIT_NUM,
  });

  /* ---- second line: the YARDAGE. Round 1 made this a caption at half the ink
     height with a 3 px hairline hung immediately under it. Re-measured, the bar's
     `167` is 63.9 x 32.0 — only a third shorter than the clock, stacked so tight
     the two boxes nearly touch — and the gold does not hang off the type at all:
     it sits down on the METER ROW with the other three accents, spanning the whole
     tile. So the clock cell's meter-row element IS the gold rule. ----------- */
  const yard = String(S.yards === undefined || S.yards === null ? '' : S.yards);
  inkSet(F, c, yard, 'blitz-num', {
    x: T_CLK.x + 3, y: IY_YARD, h: IH_YARD, align: 'left',
    w: Math.min(T_CLK.w - 6, runW(G_YARD, yard.length)),
    gap: G_YARD.gap, maxXs: 1.7, minXs: 0.82,
    keyline: { color: '#000000', k: 0.06 },
    shadow: { color: 'rgba(0,3,9,0.85)', blur: 5, dy: 2, alpha: 0.85 },
    grad: NUM_GRAD,
  });
  const rx = T_CLK.x + 2, rw = T_CLK.w - 4;
  c.fillStyle = hgrad(c, rx, rx + rw, [
    [0.00, 'rgba(255,248,196,0.98)'],
    [0.34, 'rgba(255,214,42,0.96)'],
    [1.00, 'rgba(190,132,12,0.80)'],
  ]);
  c.fillRect(rx, MOM.y + 2, rw, MOM.h - 3);
  c.fillStyle = 'rgba(255,255,255,0.42)';
  c.fillRect(rx, MOM.y + 2, rw, 1.4);
  c.fillStyle = 'rgba(0,0,0,0.45)';
  c.fillRect(rx, MOM.y + MOM.h - 1.6, rw, 1.6);

  /* ---- team A: abbreviation + score + fire meter ------------------------- */
  abbr(F, c, S.teamA, T_ABA.x + 3, T_ABA.w - 18, ABBR_COOL, 'rgba(150,190,240,0.26)', 0);
  score(F, c, S.scoreA, T_SCA.x + T_SCA.w - 5, T_SCA.w - 7);

  /* ---- team B: crest + abbreviation + possession mark + score + gold ----- */
  // The bar's crest is 54 x 74 logical at tile-local 0..54 and its abbreviation
  // starts at tile-local 58 — the mark is nearly as tall as the tile, not a small
  // square badge floated in the corner.
  drawCrest(c, ui, S.teamB, T_TMB.x + 1, 7, 58, castB);
  abbr(F, c, S.teamB, T_TMB.x + 60, 74, ABBR_WARM, 'rgba(255,206,130,0.28)', 1);
  score(F, c, S.scoreB, T_SCB.x + T_SCB.w - 5, T_SCB.w - 7);

  // possession: the bar's tiny amber mark tucked to the right of the crested
  // team's abbreviation, measured at tile-local 129. Drawn on whichever side
  // actually has the ball.
  const pv = [
    [T_ABA.x + T_ABA.w - 13, 27],
    [T_TMB.x + 130, 27],
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
  // THE ACCENT COUNT IS PART OF THE READ. Sampling the bar's meter row: under the
  // scores it is a saturated ORANGE->RED bar on the left and a saturated GOLD bar
  // on the right, and both are the brightest things down there. Under the two
  // ABBREVIATIONS it is almost entirely DARK TRACK — a near-black well with a
  // short steel-blue stub and two light segment pips. Round 1 drove the timeout
  // rows to a full-width blue fill, which put two more bright bars in a row that
  // the art keeps quiet and diluted the three real accents. So the steel rows now
  // run 0.06 + 0.10 per timeout: three timeouts is a 36% stub, not a full bar.
  const toA = Math.max(0, Math.min(3, S.timeouts | 0));
  const toB = Math.max(0, Math.min(3, S.timeoutsB === undefined ? 2 : S.timeoutsB | 0));
  meter(c, T_ABA.x + 1, T_ABA.w - 2, [STEEL, STEEL, STEEL, STEEL],
    0.05 * toA, { pips: toA });
  meter(c, T_SCA.x + 1, T_SCA.w - 2, FIRE_RAMP, S.momA, { rule: '#e2a428' });
  meter(c, T_TMB.x + 1, T_TMB.w - 2, [STEEL, STEEL, STEEL, STEEL],
    0.05 * toB, { pips: toB });
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
