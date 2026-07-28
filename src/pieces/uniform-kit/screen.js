// PIECE uniform-kit — the PICK YOUR UNIFORM screen (Canvas2D, logical 1920x1080).
//
// Composition is lifted from bar/panel-uniform.png and re-proportioned for 16:9:
// crest watermark on a dark faceted plate bleeding off the LEFT edge, the club lockup
// under it, the figure (3D, centred, lit by stage.js), the variant button column on the
// RIGHT with the selected button outlined and glowing in the CLUB'S OWN colour, and the
// A SELECT / B BACK footer.
//
// PERFORMANCE. Almost none of this changes between frames, so the screen is split:
//   STATIC layer   plate + crest + lockup + button chrome + footer, rendered once per
//                  (club, variant, rung) into an offscreen canvas and blitted.
//   DYNAMIC layer  the selected button's glow pulse and the press flash only.
// The static layer is rebaked exactly once per selection change, never per frame.
//
// TOUCH. `hitTest(x, y)` returns a target id for the controller/flow pieces; buttons are
// 300 x 100 logical px, which is 9.6 mm on a 844x390 landscape phone (fit 0.361), above
// the 9 mm floor the re-cut demands, and they carry a real pressed state.

import { REG } from '../../foundation/registry.js';
import { makeRng } from '../../foundation/rng.js';
import { kitFor, roles, hexToRgb, rgba, shade, mixHex, desat, luma, VARIANT_IDS, VARIANT_LABELS } from './palette.js';

// Sizes are set from the BAR MEASURED AS A FRACTION OF FRAME HEIGHT, because that is the
// axis compare.mjs normalises on (both images scaled to 720 px tall). The bar's title cap
// height is 10.1% of frame height, its club name 8.0%, its city 3.5%, its buttons 8.5%
// tall with a 8.5% right margin — all reproduced here at 1080p. blitz-* faces have a cap
// height of 0.70 em, so `size` = capFraction * 1080 / 0.70.
export const LAYOUT = {
  title: { x: 960, y: 150, size: 146 },
  crest: { x: 360, y: 412, size: 586 },
  city: { x: 364, y: 726, size: 55 },
  club: { x: 364, y: 842, size: 128 },
  col: { x: 1508, y: 208, w: 306, h: 100, gap: 36 },
  footer: { y: 1034, size: 52 },
};

/* ------------------------------------------------------------------ paths */

function rr(c, x, y, w, h, r) {
  const k = Math.min(r, w * 0.5, h * 0.5);
  c.beginPath();
  c.moveTo(x + k, y);
  c.lineTo(x + w - k, y);
  c.quadraticCurveTo(x + w, y, x + w, y + k);
  c.lineTo(x + w, y + h - k);
  c.quadraticCurveTo(x + w, y + h, x + w - k, y + h);
  c.lineTo(x + k, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - k);
  c.lineTo(x, y + k);
  c.quadraticCurveTo(x, y, x + k, y);
  c.closePath();
}

function lin(c, x0, y0, x1, y1, stops) {
  const g = c.createLinearGradient(x0, y0, x1, y1);
  for (const s of stops) g.addColorStop(Math.max(0, Math.min(1, s[0])), s[1]);
  return g;
}
function rad(c, x0, y0, r0, x1, y1, r1, stops) {
  const g = c.createRadialGradient(x0, y0, r0, x1, y1, r1);
  for (const s of stops) g.addColorStop(Math.max(0, Math.min(1, s[0])), s[1]);
  return g;
}

function mkCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  return cv;
}

/* -------------------------------------------------------------- fragments */

/**
 * The plate the crest sits on. In the bar this is a dark faceted shield that runs off the
 * left edge and carries the club's colour as a deep wash rather than a flat fill.
 */
function drawPlate(c, R, kit) {
  const x0 = -240, x1 = 778;
  const yTop = 62, yBot = 1006;
  const deep = mixHex(R.shell, '#05070c', 0.30);

  c.save();
  // the faceted silhouette
  c.beginPath();
  c.moveTo(x0, yTop);
  c.lineTo(x1 - 118, yTop);
  c.lineTo(x1, yTop + 128);
  c.lineTo(x1, yBot - 236);
  c.lineTo(x1 - 190, yBot);
  c.lineTo(x0, yBot);
  c.closePath();
  c.save();
  c.clip();

  c.fillStyle = lin(c, x0, yTop, x1, yBot, [
    [0.00, mixHex(deep, '#000000', 0.55)],
    [0.30, mixHex(deep, '#000000', 0.20)],
    [0.60, mixHex(deep, R.hot, 0.10)],
    [1.00, '#030409'],
  ]);
  c.fillRect(x0, yTop, x1 - x0, yBot - yTop);

  // facet shards — flat planes catching a raking light, in the club's own hues
  const rng = makeRng(0x5ea1);
  for (let i = 0; i < 22; i++) {
    const cx = x0 + rng() * (x1 - x0);
    const cy = yTop + rng() * (yBot - yTop);
    const s = 70 + rng() * 230;
    const a = rng() * Math.PI * 2;
    c.save();
    c.translate(cx, cy);
    c.rotate(a);
    c.globalAlpha = 0.022 + rng() * 0.042;
    c.fillStyle = rng() < 0.45 ? R.hot : shade(R.shell, 0.28);
    c.beginPath();
    c.moveTo(-s * 0.5, -s * 0.22);
    c.lineTo(s * 0.42, -s * 0.42);
    c.lineTo(s * 0.5, s * 0.30);
    c.lineTo(-s * 0.30, s * 0.44);
    c.closePath();
    c.fill();
    c.restore();
  }

  // club wash behind where the crest will land
  c.globalCompositeOperation = 'lighter';
  c.fillStyle = rad(c, 356, 428, 20, 356, 428, 690, [
    [0.00, rgba(R.hot, 0.46)],
    [0.26, rgba(R.hot, 0.20)],
    [0.60, rgba(R.hot, 0.055)],
    [1.00, rgba(R.hot, 0)],
  ]);
  c.fillRect(x0, yTop, x1 - x0, yBot - yTop);
  c.globalCompositeOperation = 'source-over';

  // inner darkening toward the top and bottom so the plate has a body
  c.fillStyle = lin(c, 0, yTop, 0, yBot, [
    [0.00, 'rgba(0,0,0,0.72)'],
    [0.20, 'rgba(0,0,0,0.10)'],
    [0.72, 'rgba(0,0,0,0.18)'],
    [1.00, 'rgba(0,0,0,0.86)'],
  ]);
  c.fillRect(x0, yTop, x1 - x0, yBot - yTop);
  c.restore();

  // rim: a dark keyline plus a club-coloured hairline inboard of it.
  // The path has to be rebuilt — the facet loop above left its own path current.
  c.beginPath();
  c.moveTo(x0, yTop);
  c.lineTo(x1 - 118, yTop);
  c.lineTo(x1, yTop + 128);
  c.lineTo(x1, yBot - 236);
  c.lineTo(x1 - 190, yBot);
  c.lineTo(x0, yBot);
  c.closePath();
  c.lineJoin = 'miter';
  c.strokeStyle = 'rgba(0,0,0,0.85)';
  c.lineWidth = 7;
  c.stroke();
  c.strokeStyle = rgba(R.hot, 0.28);
  c.lineWidth = 2.0;
  c.stroke();
  c.restore();
}

/** The club's own illustrated mascot, treated as a desaturated backdrop watermark. */
function drawCrest(c, team, kit, L) {
  let img = null;
  try { img = REG.brand.crest(team.id, Math.round(L.size), { backdrop: false }); } catch (e) { img = null; }
  if (!img) return;
  const s = L.size;
  c.save();
  // a soft dark drop so the mascot sits ON the plate
  c.save();
  c.globalAlpha = 0.55;
  c.filter = 'blur(0px)';
  c.drawImage(img, L.x - s * 0.5 + 12, L.y - s * 0.5 + 16, s, s);
  c.globalCompositeOperation = 'source-atop';
  c.fillStyle = 'rgba(0,0,0,0.9)';
  c.fillRect(L.x - s, L.y - s, s * 2, s * 2);
  c.restore();

  c.globalAlpha = 1;
  c.drawImage(img, L.x - s * 0.5, L.y - s * 0.5, s, s);
  // Treat it as a WATERMARK, not a sticker: a cool wash pulls it back toward the plate,
  // a top-down light/shade ramp gives it a light direction, and a club-coloured screen
  // pass puts a faint rim on it so it does not go dead in the shadows.
  c.globalCompositeOperation = 'source-atop';
  c.globalAlpha = 0.11;
  c.fillStyle = mixHex(kit.helmet, '#1a2130', 0.5);
  c.fillRect(L.x - s, L.y - s, s * 2, s * 2);
  c.globalAlpha = 1;
  c.fillStyle = lin(c, 0, L.y - s * 0.5, 0, L.y + s * 0.5, [
    [0, 'rgba(255,255,255,0.20)'], [0.42, 'rgba(255,255,255,0.05)'],
    [0.70, 'rgba(0,0,0,0.20)'], [1, 'rgba(0,0,0,0.55)'],
  ]);
  c.fillRect(L.x - s, L.y - s, s * 2, s * 2);
  c.globalCompositeOperation = 'lighter';
  c.globalAlpha = 0.16;
  c.fillStyle = rad(c, L.x - s * 0.18, L.y - s * 0.22, s * 0.05, L.x - s * 0.1, L.y - s * 0.1, s * 0.62, [
    [0, rgba(kit.accent, 0.9)], [1, rgba(kit.accent, 0)],
  ]);
  c.fillRect(L.x - s, L.y - s, s * 2, s * 2);
  c.restore();
}

/** CITY over CLUB, the bar's stacked lockup. */
function drawLockup(c, F, team, kit, R) {
  const Lc = LAYOUT.city, Lk = LAYOUT.club;
  c.save();
  F.draw(c, team.city, Lc.x, Lc.y, {
    face: 'blitz-block', size: Lc.size, align: 'center', tracking: 0.155,
    fill: '#cfd4dd', stroke: 'rgba(0,0,0,0.85)', strokeWidth: Lc.size * 0.10,
    shadow: { color: 'rgba(0,0,0,0.8)', blur: 14, dy: 3 },
  });
  c.save();
  c.translate(Lk.x, Lk.y);
  c.scale(0.90, 1);
  F.draw(c, team.name, 0, 0, {
    face: 'blitz-block', size: Lk.size, align: 'center', tracking: 0.018,
    fill: 'rgba(3,4,8,0.92)', stroke: 'rgba(3,4,8,0.92)', strokeWidth: Lk.size * 0.16,
    shadow: { color: 'rgba(0,0,0,0.86)', blur: 26, dy: 8, reps: 2 },
  });
  F.draw(c, team.name, 0, 0, {
    face: 'blitz-block', size: Lk.size, align: 'center', tracking: 0.018,
    gradient: [[0, '#ffffff'], [0.30, '#f4efe2'], [0.62, '#ded6c4'], [1, '#9b9385']],
    stroke: 'rgba(4,5,10,0.95)', strokeWidth: Lk.size * 0.045,
    emboss: 0.22,
  });
  c.restore();
  // a club-coloured underline, clipped to the lockup width
  const w = Math.min(560, F.measure(team.name, 'blitz-block', Lk.size, { tracking: 0.018 }).w * 0.90);
  c.fillStyle = lin(c, Lk.x - w / 2, 0, Lk.x + w / 2, 0, [
    [0, rgba(R.hot, 0)], [0.5, rgba(R.hot, 0.85)], [1, rgba(R.hot, 0)],
  ]);
  c.fillRect(Lk.x - w / 2, Lk.y + 26, w, 3);
  c.restore();
}

/** One variant button. `sel` draws the bar's outlined + glowing selected state. */
function drawButton(c, F, x, y, w, h, label, sel, accent, press) {
  const r = 16;
  c.save();
  if (press) { c.translate(0, 2); }

  if (sel) {
    // outer bloom, strongest toward the left edge exactly as the bar has it
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.fillStyle = rad(c, x + w * 0.30, y + h * 0.5, 4, x + w * 0.34, y + h * 0.5, w * 0.95, [
      [0.00, rgba(accent, 0.42)], [0.35, rgba(accent, 0.16)], [1.00, rgba(accent, 0)],
    ]);
    c.fillRect(x - w * 0.75, y - h * 0.9, w * 2.4, h * 2.8);
    c.restore();
  } else {
    c.save();
    c.globalAlpha = 0.55;
    c.fillStyle = 'rgba(0,0,0,0.75)';
    rr(c, x + 3, y + 5, w, h, r);
    c.fill();
    c.restore();
  }

  // plate
  rr(c, x, y, w, h, r);
  c.fillStyle = sel
    ? lin(c, 0, y, 0, y + h, [
      [0.00, mixHex('#2a1b18', accent, 0.24)],
      [0.42, '#241713'],
      [0.60, '#180f0d'],
      [1.00, mixHex('#12100f', accent, 0.10)],
    ])
    : lin(c, 0, y, 0, y + h, [
      [0.00, '#3a3f47'],
      [0.06, '#2b3038'],
      [0.50, '#1d2128'],
      [0.94, '#15181e'],
      [1.00, '#252a31'],
    ]);
  c.fill();

  // inner top light + bottom shade: the bevel
  c.save();
  c.clip();
  c.fillStyle = lin(c, 0, y, 0, y + h * 0.42, [
    [0, 'rgba(255,255,255,0.16)'], [1, 'rgba(255,255,255,0)'],
  ]);
  c.fillRect(x, y, w, h * 0.42);
  c.fillStyle = lin(c, 0, y + h * 0.62, 0, y + h, [
    [0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.42)'],
  ]);
  c.fillRect(x, y + h * 0.62, w, h * 0.38);
  if (press) {
    c.fillStyle = 'rgba(0,0,0,0.28)';
    c.fillRect(x, y, w, h);
  }
  c.restore();

  // border
  rr(c, x + 1.4, y + 1.4, w - 2.8, h - 2.8, r - 1.2);
  c.lineWidth = sel ? 3.4 : 2.2;
  c.strokeStyle = sel ? accent : 'rgba(150,158,170,0.92)';
  c.stroke();
  if (sel) {
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.shadowColor = accent;
    c.shadowBlur = 22;
    c.lineWidth = 2.0;
    c.strokeStyle = rgba(accent, 0.9);
    c.stroke();
    c.restore();
  } else {
    rr(c, x + 3.4, y + 3.4, w - 6.8, h - 6.8, r - 3);
    c.lineWidth = 1.2;
    c.strokeStyle = 'rgba(0,0,0,0.55)';
    c.stroke();
  }

  // label — sized off the bar (cap height 4.0% of frame height) and horizontally
  // condensed only when a long word like THROWBACK would otherwise crowd the plate,
  // so all five labels share one optical weight instead of one shrinking.
  const size = h * 0.64;
  const cx = x + w * 0.5, cy = y + h * 0.5 + size * 0.35;
  const mw = F.measure(label, 'blitz-block', size, { tracking: 0.035 }).w;
  const room = w - 40;
  c.save();
  if (mw > room) {
    c.translate(cx, 0);
    c.scale(room / mw, 1);
    c.translate(-cx, 0);
  }
  F.draw(c, label, cx, cy, {
    face: 'blitz-block', size, align: 'center', tracking: 0.035,
    fill: 'rgba(0,0,0,0.9)', stroke: 'rgba(0,0,0,0.9)', strokeWidth: size * 0.16,
  });
  F.draw(c, label, cx, cy, {
    face: 'blitz-block', size, align: 'center', tracking: 0.035,
    gradient: sel
      ? [[0, mixHex(accent, '#ffffff', 0.55)], [0.5, accent], [1, shade(accent, -0.28)]]
      : [[0, '#ffffff'], [0.55, '#e6e9ee'], [1, '#b9bec7']],
    stroke: sel ? shade(accent, -0.62) : 'rgba(0,0,0,0.55)',
    strokeWidth: size * 0.055,
  });
  if (sel) {
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = 0.5;
    F.draw(c, label, cx, cy, {
      face: 'blitz-block', size, align: 'center', tracking: 0.035,
      fill: rgba(accent, 0.6),
      glow: { color: rgba(accent, 0.85), blur: 26, alpha: 0.7, reps: 2 },
    });
    c.restore();
  }
  c.restore();       // label condense
  c.restore();       // button
}

/** (A) SELECT  (B) BACK */
function drawFooter(c, F, y, size) {
  const items = [
    { g: 'A', col: '#4ad65f', label: 'SELECT' },
    { g: 'B', col: '#ee3a3a', label: 'BACK' },
  ];
  const gap = 74;
  let total = 0;
  const widths = items.map((it) => {
    const w = size * 1.02 + 18 + F.measure(it.label, 'blitz-block', size, { tracking: 0.06 }).w;
    total += w;
    return w;
  });
  total += gap;
  let x = 960 - total / 2;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const r = size * 0.50;
    const cx = x + r, cy = y - size * 0.30;
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.fillStyle = rad(c, cx, cy, 1, cx, cy, r * 2.3, [[0, rgba(it.col, 0.30)], [1, rgba(it.col, 0)]]);
    c.beginPath(); c.arc(cx, cy, r * 2.3, 0, Math.PI * 2); c.fill();
    c.restore();
    c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2);
    c.fillStyle = lin(c, 0, cy - r, 0, cy + r, [[0, 'rgba(26,28,33,0.95)'], [1, 'rgba(8,9,12,0.95)']]);
    c.fill();
    c.lineWidth = 3.0;
    c.strokeStyle = it.col;
    c.stroke();
    F.draw(c, it.g, cx, cy + size * 0.24, {
      face: 'blitz-block', size: size * 0.62, align: 'center', fill: it.col,
      stroke: 'rgba(0,0,0,0.75)', strokeWidth: size * 0.045,
    });
    F.draw(c, it.label, x + size * 1.02 + 18, y, {
      face: 'blitz-block', size, align: 'left', tracking: 0.06,
      gradient: [[0, '#ffffff'], [1, '#c3c8d1']],
      stroke: 'rgba(0,0,0,0.85)', strokeWidth: size * 0.09,
      shadow: { color: 'rgba(0,0,0,0.7)', blur: 10, dy: 3 },
    });
    x += widths[i] + gap;
  }
}

/* ------------------------------------------------------------ static bake */

let cacheKey = '';
let cacheCv = null;
let bakes = 0;

function bakeStatic(team, kit, R, variantIndex, F) {
  const cv = mkCanvas(1920, 1080);
  const c = cv.getContext('2d');
  c.clearRect(0, 0, 1920, 1080);

  /* ---- backdrop ---------------------------------------------------------- */
  // Everything painted behind the model is composed on its own layer and then has a soft
  // vertical keyhole punched out of it. Without the keyhole a bottom-of-frame darkening
  // strong enough to sell the studio floor would also swallow the model's socks and
  // cleats — the overlay draws OVER the 3D layer, so any wash it lays down is a wash over
  // the figure too. The 3D stage owns the value structure inside the keyhole.
  {
    const bd = mkCanvas(1920, 1080);
    const b = bd.getContext('2d');

    b.fillStyle = rad(b, 960, 470, 260, 960, 560, 1250, [
      [0.00, 'rgba(0,0,0,0)'],
      [0.46, 'rgba(3,4,8,0.34)'],
      [0.78, 'rgba(2,3,6,0.76)'],
      [1.00, 'rgba(1,2,4,0.96)'],
    ]);
    b.fillRect(0, 0, 1920, 1080);

    // The club's own city, dropped to a near-black silhouette. In the bar the skyline is
    // barely there: it gives the backdrop depth without ever competing with the figure.
    try {
      const cityId = ({ ARI: 'PHX', LA: 'LA', LAC: 'LA', LAR: 'LA', NYG: 'NYC', NYJ: 'NYC', SF: 'SF', TB: 'TPA', NE: 'BOS', MIN: 'MSP', TEN: 'NSH', WAS: 'DC', IND: 'CLT', NO: 'NOLA' })[team.id] || team.id;
      const sk = mkCanvas(1920, 430);
      const sc = sk.getContext('2d');
      REG.brand.skyline(sc, cityId, { x: 0, y: 0, w: 1920, h: 430 }, {
        layers: 3, haze: 0, windows: true, fill: '#04050b',
        sky: mixHex(R.shell, '#04060c', 0.62),
      });
      sc.globalCompositeOperation = 'destination-out';
      sc.fillStyle = lin(sc, 0, 0, 0, 250, [[0, 'rgba(0,0,0,1)'], [1, 'rgba(0,0,0,0)']]);
      sc.fillRect(0, 0, 1920, 250);
      b.save();
      b.globalAlpha = 0.60;
      b.drawImage(sk, 0, 596, 1920, 430);
      b.restore();
    } catch (e) { /* skyline is decoration */ }

    b.fillStyle = lin(b, 0, 660, 0, 1080, [
      [0, 'rgba(2,3,7,0)'], [0.5, 'rgba(2,3,7,0.62)'], [1, 'rgba(1,2,5,0.95)'],
    ]);
    b.fillRect(0, 660, 1920, 420);

    // keyhole
    b.globalCompositeOperation = 'destination-out';
    b.save();
    b.translate(960, 620);
    b.scale(1, 1.62);
    b.fillStyle = rad(b, 0, 0, 40, 0, 0, 330, [
      [0.00, 'rgba(0,0,0,1)'], [0.58, 'rgba(0,0,0,0.92)'],
      [0.84, 'rgba(0,0,0,0.42)'], [1.00, 'rgba(0,0,0,0)'],
    ]);
    b.fillRect(-520, -520, 1040, 1040);
    b.restore();

    c.drawImage(bd, 0, 0);
  }

  /* ---- left plate + crest + lockup -------------------------------------- */
  drawPlate(c, R, kit);
  drawCrest(c, team, kit, LAYOUT.crest);
  drawLockup(c, F, team, kit, R);

  /* ---- title ------------------------------------------------------------ */
  const T = LAYOUT.title;
  c.save();
  // Fill the FULL canvas, not a 300 px strip: the strip's bottom edge cut the radial at
  // alpha 0.54 and left a hard horizontal seam across the whole frame. The gradient
  // reaches zero at r = 780 on its own.
  c.fillStyle = rad(c, T.x, T.y - T.size * 0.34, 20, T.x, T.y - T.size * 0.34, 780, [
    [0, 'rgba(6,9,16,0.74)'], [0.42, 'rgba(4,6,12,0.36)'],
    [0.74, 'rgba(4,6,12,0.10)'], [1, 'rgba(4,6,12,0)'],
  ]);
  c.fillRect(0, 0, 1920, 1080);
  c.restore();
  F.draw(c, 'PICK YOUR UNIFORM', T.x, T.y, {
    face: 'blitz-brush', size: T.size, align: 'center', tracking: 0.012,
    gradient: [[0, '#ffffff'], [0.42, '#fbf4e4'], [0.72, '#e9dcc0'], [1, '#b8a986']],
    stroke: 'rgba(6,5,10,0.92)', strokeWidth: T.size * 0.055,
    shadow: { color: 'rgba(0,0,0,0.85)', blur: T.size * 0.34, dy: T.size * 0.085, reps: 2 },
    grain: 0.34,
  });

  /* ---- button column ---------------------------------------------------- */
  const C = LAYOUT.col;
  for (let i = 0; i < 5; i++) {
    const y = C.y + i * (C.h + C.gap);
    drawButton(c, F, C.x, y, C.w, C.h, VARIANT_LABELS[i], i === variantIndex, kit.accent, false);
  }

  /* ---- footer ----------------------------------------------------------- */
  drawFooter(c, F, LAYOUT.footer.y, LAYOUT.footer.size);

  /* ---- grade: vignette + fine grain ------------------------------------- */
  // Source-over black, NOT a multiply. The overlay canvas is transparent wherever the
  // 3D layer shows through, and `multiply` against a zero-alpha destination resolves to
  // the source colour at full alpha — it would paint an opaque grey wash over the model.
  c.save();
  c.fillStyle = rad(c, 960, 512, 340, 960, 560, 1240, [
    [0.00, 'rgba(0,0,0,0)'],
    [0.52, 'rgba(2,3,7,0.16)'],
    [0.80, 'rgba(2,3,7,0.46)'],
    [1.00, 'rgba(1,2,4,0.74)'],
  ]);
  c.fillRect(0, 0, 1920, 1080);
  c.restore();

  const rng = makeRng(0x9911);
  c.save();
  c.globalAlpha = 0.055;
  for (let i = 0; i < 5200; i++) {
    const x = rng() * 1920, y = rng() * 1080;
    c.fillStyle = rng() < 0.5 ? '#ffffff' : '#000000';
    c.fillRect(x, y, 1.4, 1.4);
  }
  c.restore();

  bakes++;
  return cv;
}

/* ------------------------------------------------------------------ hooks */

/** Preallocated hit result — the runtime path must not allocate per touch. */
const HIT = { kind: '', index: -1 };

export function hitTest(x, y) {
  const C = LAYOUT.col;
  for (let i = 0; i < 5; i++) {
    const by = C.y + i * (C.h + C.gap);
    if (x >= C.x - 12 && x <= C.x + C.w + 12 && y >= by - 10 && y <= by + C.h + 10) {
      HIT.kind = 'variant'; HIT.index = i; return HIT;
    }
  }
  if (y > 950) { HIT.kind = 'footer'; HIT.index = -1; return HIT; }
  if (x > 690 && x < 1360) { HIT.kind = 'rotate'; HIT.index = -1; return HIT; }
  HIT.kind = ''; HIT.index = -1;
  return null;
}

/**
 * The screen's touch surface, declared as data so `touch.mjs` and a critic can measure
 * tap targets without reverse-engineering the paint code. `mm` is the physical size of
 * the SHORT edge on a 844x390 landscape phone, where the overlay's fit scale is
 * min(844/1920, 390/1080) = 0.3611 and 1 CSS px = 1/96 inch:
 *     mm = h * 0.3611 * 25.4 / 96
 * The 9 mm floor in the re-cut therefore needs h >= 94 logical px; the buttons are 100.
 */
export function zones() {
  const C = LAYOUT.col;
  const out = [];
  const mm = (h) => +(h * 0.3611 * 25.4 / 96).toFixed(2);
  for (let i = 0; i < 5; i++) {
    out.push({
      id: `variant:${VARIANT_IDS[i]}`, kind: 'tap',
      x: C.x, y: C.y + i * (C.h + C.gap), w: C.w, h: C.h,
      mmShort: mm(C.h), mmLong: mm(C.w),
    });
  }
  out.push({ id: 'rotate', kind: 'swipe-x', x: 690, y: 180, w: 670, h: 760, mmShort: mm(670) });
  out.push({ id: 'back', kind: 'tap', x: 690, y: 950, w: 540, h: 110, mmShort: mm(110) });
  return out;
}

/**
 * Turn screen state into the model's turntable angle, so a swipe on the figure rotates
 * it. game-flow owns the ShotSpec; this is the function it calls, kept here because the
 * mapping (drag distance -> radians, plus the idle drift) belongs to this screen.
 */
export function modelRotY(state, t) {
  const drag = (state && state.spin) || 0;          // logical px of accumulated drag
  const idle = (state && state.idleTurn === false) ? 0 : Math.sin(t * 0.22) * 0.16;
  return drag * 0.0042 + idle;
}

export function bakeCount() { return bakes; }

/* ------------------------------------------------------------------ draw */

export const screen = {
  piece: 'uniform-kit',

  draw(c, t, state, ui) {
    const F = ui.faces;
    const brand = REG.brand;
    const teamId = (state && state.team) || 'CHI';
    const team = brand.byId(teamId);
    const vi = Math.max(0, Math.min(4, (state && state.variantIndex) || 0));
    const kit = kitFor(team, VARIANT_IDS[vi]);
    const R = roles(team);
    const pressed = state && state.pressed !== undefined && state.pressed !== null ? state.pressed : -1;

    const key = `${team.id}|${vi}|${ui.W}`;
    if (key !== cacheKey || !cacheCv) {
      cacheCv = bakeStatic(team, kit, R, vi, F);
      cacheKey = key;
    }
    c.drawImage(cacheCv, 0, 0, 1920, 1080);

    // ---- dynamic layer: the selected button's breath and any press flash ----
    const C = LAYOUT.col;
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.1);
    const by = C.y + vi * (C.h + C.gap);
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = 0.16 + pulse * 0.20;
    c.fillStyle = rad(c, C.x + C.w * 0.34, by + C.h * 0.5, 6, C.x + C.w * 0.36, by + C.h * 0.5, C.w * 0.92, [
      [0, rgba(kit.accent, 0.55)], [0.42, rgba(kit.accent, 0.16)], [1, rgba(kit.accent, 0)],
    ]);
    c.fillRect(C.x - C.w * 0.8, by - C.h, C.w * 2.4, C.h * 3);
    c.restore();

    if (pressed >= 0 && pressed < 5) {
      const py = C.y + pressed * (C.h + C.gap);
      drawButton(c, F, C.x, py, C.w, C.h, VARIANT_LABELS[pressed], pressed === vi, kit.accent, true);
    }
  },

  hitTest,
  zones,
  modelRotY,
  bakeCount,
  LAYOUT,
};

export default screen;
