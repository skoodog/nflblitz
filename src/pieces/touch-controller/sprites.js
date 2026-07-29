// PIECE touch-controller — BAKED ARTWORK.
//
// THE RULE THIS FILE EXISTS TO ENFORCE: the frame path draws the controller with
// `drawImage` and numeric sub-rectangles, and nothing else. Every gradient, every glyph,
// every rounded silhouette and every shadow is rendered ONCE into an offscreen canvas at
// the device's real pixel density, and after that the controller costs a handful of
// blits out of a 4.15 ms overlay budget.
//
// WHY THAT MATTERS MORE HERE THAN ANYWHERE ELSE ON THE OVERLAY. The HUD changes about
// ten times a second. The CONTROLLER changes on every frame the thumb is moving, which
// during a play is most of them, so it is the one overlay layer that genuinely redraws
// at the present rate. Gradients and text on that path are not a rounding error.
//
// BAKE RESOLUTION. Sprites are baked at `cssPx * dpr` device pixels and blitted at
// `cssPx / fit` logical units. The runtime overlay's transform is `fit * dpr`, so the
// blit lands at exactly `cssPx * dpr` device pixels: 1:1, no resampling, no blur, and
// the minimum possible fill. A change of dpr or of the fit re-bakes; nothing else does.
//
// WHERE THE COLOURS COME FROM. `bar/panel-truck.png` and `bar/panel-qb_dropback.png`.
// The TURBO gauge in the art is a near-black glass slab with a thin blue rim and a
// bright electric-blue fill bar occupying the lower part of the plate, one segment
// divider, a long white-hot leading smear, and the word set LARGE, HIGH and OBLIQUE. The
// blues are the same three the `hud-overlay` piece traced off the same panel, so the
// controller's turbo lozenge and the HUD's turbo gauge are visibly the same object.

const BLUE = '#1f57ef';
const BLUE_HI = '#8fb6ff';
const BLUE_LO = '#0b1d68';
const GOLD = '#ffc61e';
const GOLD_HI = '#ffe9a3';
const GLASS_HI = '#1b2230';
const GLASS_LO = '#05070c';
const RIM = 'rgba(150,178,225,0.55)';
const RIM_HOT = 'rgba(214,232,255,0.92)';
const INK = '#eef3ff';
const HEAT = '#ff4d1c';

/** Grade tint, indexed by GRADE: unarmed, early, perfect, late, missed. */
export const GRADE_TINT = ['rgba(150,178,225,0.55)', '#29c8ff', GOLD, HEAT, 'rgba(120,130,148,0.7)'];

/* --------------------------------------------------------------- canvases */

function mkCanvas(w, h) {
  const W = Math.max(1, Math.ceil(w)), H = Math.max(1, Math.ceil(h));
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(W, H);
    return { cv: c, c2d: c.getContext('2d') };
  }
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  return { cv: c, c2d: c.getContext('2d') };
}

/** Rounded rectangle path. No Path2D allocation on a hot path — this is bake-time only. */
function roundRect(c, x, y, w, h, r) {
  const rr = Math.min(r, w * 0.5, h * 0.5);
  c.beginPath();
  c.moveTo(x + rr, y);
  c.lineTo(x + w - rr, y);
  c.quadraticCurveTo(x + w, y, x + w, y + rr);
  c.lineTo(x + w, y + h - rr);
  c.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  c.lineTo(x + rr, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - rr);
  c.lineTo(x, y + rr);
  c.quadraticCurveTo(x, y, x + rr, y);
  c.closePath();
}

/** Regular octagon inscribed in a square. The plate silhouette for both action pads. */
function octagon(c, cx, cy, r) {
  c.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * 6.283185307179586 + 0.39269908;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
  }
  c.closePath();
}

/**
 * THE TURBO SILHOUETTE, traced off bar/panel-truck.png by the hud-overlay piece and
 * reused here verbatim so the control and the gauge are the same object: a soft-rounded
 * left lead, a flat top, ONE diagonal chop at the top right, and a rounded bottom.
 * There is no pointed spur — round one of that piece drew a hard-mitred hexagon and it
 * was wrong.
 */
function lozenge(c, x, y, w, h) {
  c.beginPath();
  c.moveTo(x + 0.055 * w, y);
  c.lineTo(x + 0.877 * w, y);
  c.lineTo(x + w, y + 0.64 * h);
  c.lineTo(x + 0.976 * w, y + h);
  c.lineTo(x + 0.032 * w, y + h);
  c.quadraticCurveTo(x, y + 0.72 * h, x, y + 0.42 * h);
  c.quadraticCurveTo(x, y + 0.10 * h, x + 0.055 * w, y);
  c.closePath();
}

function text(faces, c, s, x, y, size, face, fill, opts) {
  if (!faces || !faces.draw) return;
  const o = opts || EMPTY_OPTS;
  faces.draw(c, s, x, y, {
    face, size, fill,
    align: o.align || 'center',
    baseline: o.baseline || 'middle',
    slant: o.slant,
    tracking: o.tracking,
    stroke: o.stroke,
    strokeWidth: o.strokeWidth,
  });
}
const EMPTY_OPTS = {};

/* ============================================================== the sheets */

/**
 * Sprite sheet geometry, all in CSS px. Each sheet is a strip; the frame path indexes it
 * by column (and row where noted) with plain arithmetic.
 */
export const SHEET = Object.freeze({
  stick: { w: 132, h: 132, cols: 2 },     // 0 idle ghost, 1 live well
  head: { w: 56, h: 56, cols: 2 },        // 0 neutral, 1 boosting
  pad: { w: 152, h: 152, cols: 2, rows: 3 }, // cols: up / down.  rows: CARRY / QB / DEF
  ring: { w: 136, h: 136, cols: 5 },      // by GRADE
  pass: { w: 108, h: 108, cols: 2 },      // 0 idle, 1 aiming
  turbo: { w: 104, h: 42, rows: 5 },      // 0 plate, 1 fill, 2 lead, 3 overheat rim, 4 pressed rim
  recv: { w: 64, h: 64, cols: 6, rows: 2 }, // number 1..6, rows: idle / hot
});

/**
 * The four direction legends per side. Baked, so a gesture pad is learnable for free.
 *
 * UP and DOWN are set OUTSIDE the plate; LEFT and RIGHT are set INSIDE it, against the
 * rim. That asymmetry is not a style choice, it is a measurement: the ACTION pad's centre
 * sits 56 CSS px from the right edge of a 390 pt screen, so an outboard right-hand label
 * is CLIPPED BY THE SCREEN — which is exactly what the first capture showed — and an
 * outboard left-hand one collides with the PASS pad 6 px away. Vertically there is
 * 100+ px of room in both directions, so that is where the long words go. LEFT/RIGHT are
 * therefore limited to four characters, which is why they read JUKE and SWAP.
 */
const LEGEND = [
  ['HURDLE', 'DIVE', 'JUKE', 'JUKE'],       // CARRY: up, down, left, right
  ['THROW AWAY', 'SLIDE', 'JUKE', 'JUKE'],  // QB
  ['JUMP', 'HIT STICK', 'SWAP', 'SWAP'],    // DEF
];
const CENTRE = ['ARM', 'TUCK', 'TKL'];

export function createSprites() {
  return { dpr: 0, ok: false, stick: null, head: null, pad: null, ring: null, pass: null, turbo: null, recv: null };
}

/**
 * bake(SP, dpr, faces) — build every sheet. Called from `draw()` the first time, and
 * again only if the device pixel ratio changed. In practice it runs inside foundation's
 * overlay PRE-WARM, on the loading screen, before the loop starts — which is exactly
 * what that pre-warm exists for: lazy Canvas2D costs (font resolution, glyph outline
 * compilation, gradient object creation) all get paid there instead of on a frame in the
 * middle of a play.
 */
export function bake(SP, dpr, faces) {
  const S = Math.max(0.5, Math.min(3, dpr || 1));
  SP.dpr = S;

  SP.stick = bakeStick(S, faces);
  SP.head = bakeHead(S);
  SP.pad = bakePad(S, faces);
  SP.ring = bakeRing(S);
  SP.pass = bakePass(S, faces);
  SP.turbo = bakeTurbo(S, faces);
  SP.recv = bakeRecv(S, faces);
  SP.ok = true;
  return SP;
}

/* ------------------------------------------------------------------ stick */

/**
 * THE POCKET. Idle it is a ghost: a thin dashed ring with eight tick marks, sitting at
 * the pad's home so a first-time player knows where to plant a thumb. Live it is a solid
 * well drawn AT THE ANCHOR — wherever the thumb actually landed — with the eight ticks
 * brightened. The ghost is deliberately faint: after the first play nobody looks at it,
 * and a bright permanent ring in the corner of a 390 pt screen is UI litter.
 */
function bakeStick(S, faces) {
  const W = SHEET.stick.w, H = SHEET.stick.h;
  const { cv, c2d: c } = mkCanvas(W * 2 * S, H * S);
  c.scale(S, S);
  for (let col = 0; col < 2; col++) {
    const live = col === 1;
    const cx = col * W + W * 0.5, cy = H * 0.5;
    const R = 62;

    // Outer well: a dark glass ring, not a filled disc — a filled disc hides the field.
    const g = c.createRadialGradient(cx, cy - R * 0.3, R * 0.25, cx, cy, R);
    g.addColorStop(0, live ? 'rgba(16,22,34,0.30)' : 'rgba(10,14,24,0.22)');
    g.addColorStop(1, live ? 'rgba(6,8,14,0.55)' : 'rgba(5,7,13,0.34)');
    c.fillStyle = g;
    c.beginPath(); c.arc(cx, cy, R, 0, 6.283185307179586); c.fill();

    // EVERY LIGHT STROKE GETS A NEAR-BLACK UNDER-STROKE FIRST.
    //
    // The first capture of the idle pocket over a lit turf pitch was, in practice,
    // invisible: a 1.6 px line at 26% white against sunlit grass is not an affordance,
    // and the one control the left thumb has to find without looking had nothing to find.
    // A dark halo underneath costs one extra stroke at BAKE time and nothing at all on
    // the frame path, and it makes the ring hold over the brightest thing on screen.
    c.lineWidth = live ? 5 : 4.5;
    c.strokeStyle = 'rgba(4,6,12,0.55)';
    c.beginPath(); c.arc(cx, cy, R, 0, 6.283185307179586); c.stroke();
    c.lineWidth = live ? 2.4 : 2.2;
    c.strokeStyle = live ? RIM_HOT : 'rgba(214,232,255,0.62)';
    c.beginPath(); c.arc(cx, cy, R, 0, 6.283185307179586); c.stroke();

    // Eight ticks: the 8-way affordance. They are how the player reads deflection
    // without looking away from the field.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * 6.283185307179586;
      const ca = Math.cos(a), sa = Math.sin(a);
      const inner = R - (i % 2 === 0 ? 13 : 8), outer = R - 2;
      const x0 = cx + ca * inner, y0 = cy + sa * inner;
      const x1 = cx + ca * outer, y1 = cy + sa * outer;
      c.lineWidth = live ? 5.5 : 4.5;
      c.strokeStyle = 'rgba(4,6,12,0.5)';
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
      c.lineWidth = live ? 3 : 2.4;
      c.strokeStyle = live
        ? (i % 2 === 0 ? 'rgba(255,198,30,0.9)' : 'rgba(214,232,255,0.6)')
        : (i % 2 === 0 ? 'rgba(255,198,30,0.5)' : 'rgba(200,220,250,0.45)');
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    }

    if (!live) {
      // The resting dot: where the stick would sit if a thumb were on it. Without it the
      // idle pocket is an empty ring and reads as decoration rather than as a control.
      c.beginPath(); c.arc(cx, cy, 9, 0, 6.283185307179586);
      c.fillStyle = 'rgba(6,9,16,0.55)'; c.fill();
      c.lineWidth = 2;
      c.strokeStyle = 'rgba(214,232,255,0.5)'; c.stroke();
      // INSIDE the ring, not below it. Below it put the baseline at sprite-space y 137 in
      // a 132 px cell, so the label was clipped clean out of the bake and rendered
      // nowhere — visible in the first idle capture as a pocket with no name on it.
      text(faces, c, 'MOVE', cx, cy + 32, 10, 'blitz-block', 'rgba(226,240,255,0.9)',
        { tracking: 0.18, stroke: 'rgba(4,6,10,0.88)', strokeWidth: 2.6 });
    }
  }
  return cv;
}

/** The stick head. Gold when neutral, blue-hot when turbo is actually boosting. */
function bakeHead(S) {
  const W = SHEET.head.w, H = SHEET.head.h;
  const { cv, c2d: c } = mkCanvas(W * 2 * S, H * S);
  c.scale(S, S);
  for (let col = 0; col < 2; col++) {
    const boost = col === 1;
    const cx = col * W + W * 0.5, cy = H * 0.5, R = 24;
    const g = c.createRadialGradient(cx - R * 0.35, cy - R * 0.45, R * 0.1, cx, cy, R);
    g.addColorStop(0, boost ? BLUE_HI : GOLD_HI);
    g.addColorStop(0.55, boost ? BLUE : GOLD);
    g.addColorStop(1, boost ? BLUE_LO : '#8a5a00');
    c.fillStyle = g;
    c.beginPath(); c.arc(cx, cy, R, 0, 6.283185307179586); c.fill();
    c.lineWidth = 2;
    c.strokeStyle = 'rgba(8,10,16,0.85)';
    c.beginPath(); c.arc(cx, cy, R, 0, 6.283185307179586); c.stroke();
    c.lineWidth = 1.4;
    c.strokeStyle = 'rgba(255,255,255,0.5)';
    c.beginPath(); c.arc(cx, cy - 2, R - 5, 3.5, 5.6); c.stroke();
  }
  return cv;
}

/* -------------------------------------------------------------- action pad */

/**
 * THE ACTION PAD. A dark octagonal hit plate with a gold chevron rosette and a baked
 * four-word legend ring.
 *
 * THE LEGEND IS THE WHOLE REASON THE GESTURE PAD IS DEFENSIBLE. A pad with seven hidden
 * meanings is a pad nobody discovers. Four 7.5 px words at the compass points cost
 * nothing at runtime — they are inside the baked sprite — and they turn "swipe and hope"
 * into a control the player reads once and then never looks at again. They also change
 * with the side of the ball, which is the thing that makes one pad carry eleven actions.
 */
function bakePad(S, faces) {
  const W = SHEET.pad.w, H = SHEET.pad.h;
  const { cv, c2d: c } = mkCanvas(W * 2 * S, H * 3 * S);
  c.scale(S, S);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 2; col++) {
      const down = col === 1;
      const cx = col * W + W * 0.5, cy = row * H + H * 0.5;
      const R = 48;

      // plate
      const g = c.createLinearGradient(cx, cy - R, cx, cy + R);
      g.addColorStop(0, down ? '#2a3346' : GLASS_HI);
      g.addColorStop(1, down ? '#10151f' : GLASS_LO);
      octagon(c, cx, cy, R);
      c.fillStyle = g;
      c.fill();
      c.lineWidth = down ? 3.2 : 2.2;
      c.strokeStyle = down ? RIM_HOT : RIM;
      c.stroke();

      // inner bevel — a single light arc across the top, not a full ring. The bar's
      // furniture is lit from above and a full ring reads as a plastic toy.
      c.lineWidth = 1.6;
      c.strokeStyle = down ? 'rgba(255,255,255,0.30)' : 'rgba(255,255,255,0.13)';
      c.beginPath(); c.arc(cx, cy, R - 6, 3.55, 5.85); c.stroke();

      // Chevron rosette: four arrowheads pushed OUT against the rim (r 40..47 of a 48
      // plate). They used to sit at r 28..39, which is precisely the annulus the
      // horizontal legend words need, and the first capture showed the collision. Out
      // here they also read better: an arrow at the edge of a plate says "push past me".
      for (let i = 0; i < 4; i++) {
        const a = i * 1.5707963267948966 - 1.5707963267948966;
        const ca = Math.cos(a), sa = Math.sin(a);
        const r0 = R - 8, r1 = R - 1, wgt = 6;
        const px = -sa, py = ca;
        c.beginPath();
        c.moveTo(cx + ca * r1, cy + sa * r1);
        c.lineTo(cx + ca * r0 + px * wgt, cy + sa * r0 + py * wgt);
        c.lineTo(cx + ca * r0 - px * wgt, cy + sa * r0 - py * wgt);
        c.closePath();
        c.fillStyle = down ? 'rgba(255,198,30,0.92)' : 'rgba(255,198,30,0.55)';
        c.fill();
      }

      // centre disc + the TAP action's name
      c.beginPath(); c.arc(cx, cy, R - 28, 0, 6.283185307179586);
      c.fillStyle = down ? 'rgba(255,198,30,0.92)' : 'rgba(8,11,18,0.88)';
      c.fill();
      c.lineWidth = 1.6;
      c.strokeStyle = down ? 'rgba(60,40,0,0.6)' : 'rgba(150,178,225,0.40)';
      c.stroke();
      text(faces, c, CENTRE[row], cx, cy + 1, 12, 'blitz-block',
        down ? '#14161c' : INK, { tracking: 0.04 });

      // legend ring. Stroked in near-black first: these words sit over lit turf as often
      // as over a shadow, and a 7.5 px label with no keyline disappears over grass.
      const lg = LEGEND[row];
      const lc = down ? '#ffe9a3' : 'rgba(222,236,255,0.92)';
      const lo = { tracking: 0.13, stroke: 'rgba(4,6,10,0.88)', strokeWidth: 2.4 };
      const li = { tracking: 0.05, stroke: 'rgba(4,6,10,0.88)', strokeWidth: 2.0 };
      text(faces, c, lg[0], cx, cy - R - 12, 8.5, 'blitz-block', lc, lo);
      text(faces, c, lg[1], cx, cy + R + 12, 8.5, 'blitz-block', lc, lo);
      text(faces, c, lg[2], cx - R + 19, cy, 7, 'blitz-block', lc, li);
      text(faces, c, lg[3], cx + R - 19, cy, 7, 'blitz-block', lc, li);
    }
  }
  return cv;
}

/**
 * THE GRADE RING. One column per GRADE. Blitted over the ACTION pad for `flashTicks`
 * after a graded action, and it is the only teaching signal the timing model has: a
 * window whose result the player cannot see is a window the player cannot learn.
 */
function bakeRing(S) {
  const W = SHEET.ring.w, H = SHEET.ring.h;
  const { cv, c2d: c } = mkCanvas(W * 5 * S, H * S);
  c.scale(S, S);
  for (let col = 0; col < 5; col++) {
    const cx = col * W + W * 0.5, cy = H * 0.5;
    const tint = GRADE_TINT[col];
    c.lineWidth = col === 2 ? 6 : 4;
    c.strokeStyle = tint;
    octagon(c, cx, cy, 56);
    c.stroke();
    if (col === 2) {                    // PERFECT gets a second, wider halo ring
      c.lineWidth = 2;
      c.strokeStyle = 'rgba(255,233,163,0.55)';
      octagon(c, cx, cy, 63);
      c.stroke();
    }
  }
  return cv;
}

/* ---------------------------------------------------------------- pass pad */

function bakePass(S, faces) {
  const W = SHEET.pass.w, H = SHEET.pass.h;
  const { cv, c2d: c } = mkCanvas(W * 2 * S, H * S);
  c.scale(S, S);
  for (let col = 0; col < 2; col++) {
    const on = col === 1;
    const cx = col * W + W * 0.5, cy = H * 0.5, R = 38;
    const g = c.createLinearGradient(cx, cy - R, cx, cy + R);
    g.addColorStop(0, on ? '#3a2c10' : GLASS_HI);
    g.addColorStop(1, on ? '#150f04' : GLASS_LO);
    c.beginPath(); c.arc(cx, cy, R, 0, 6.283185307179586);
    c.fillStyle = g; c.fill();
    c.lineWidth = on ? 3.2 : 2.2;
    c.strokeStyle = on ? GOLD : RIM;
    c.stroke();

    // the ball: a lens shape with two laces. Reads at 76 px across.
    c.beginPath();
    c.moveTo(cx - 17, cy);
    c.quadraticCurveTo(cx, cy - 12, cx + 17, cy);
    c.quadraticCurveTo(cx, cy + 12, cx - 17, cy);
    c.closePath();
    c.fillStyle = on ? GOLD_HI : 'rgba(190,208,240,0.72)';
    c.fill();
    c.lineWidth = 1.6;
    c.strokeStyle = on ? '#3a2c10' : 'rgba(10,13,20,0.75)';
    c.beginPath(); c.moveTo(cx - 6, cy); c.lineTo(cx + 6, cy); c.stroke();
    for (let i = -1; i <= 1; i++) {
      c.beginPath(); c.moveTo(cx + i * 5, cy - 3.5); c.lineTo(cx + i * 5, cy + 3.5); c.stroke();
    }

    const po = { tracking: 0.16, stroke: 'rgba(4,6,10,0.88)', strokeWidth: 2.4 };
    text(faces, c, 'PASS', cx, cy + R + 11, 9, 'blitz-block',
      on ? GOLD_HI : 'rgba(222,236,255,0.92)', po);
    text(faces, c, 'HOLD TO AIM', cx, cy - R - 11, 7, 'blitz-block',
      on ? '#ffe9a3' : 'rgba(200,218,245,0.72)', po);
  }
  return cv;
}

/* ------------------------------------------------------------------ TURBO */

/**
 * THE TURBO LOZENGE — the control and the meter are the SAME OBJECT.
 *
 * The concept art puts a blue TURBO gauge in the bottom-left as a read-out. This is that
 * object, in the same silhouette and the same three blues, moved under the RIGHT thumb
 * and given a hit rectangle, because in an arcade football game the thumb lives on turbo
 * and a meter you have to look across the screen to read is a meter you do not read. One
 * object: press it, and watch it burn down under your own thumb.
 *
 * Four rows, blitted in this order:
 *   0 PLATE     the dark glass slab, blue rim, the word TURBO set high, large and oblique
 *   1 FILL      the electric-blue bar. Blitted with a horizontal SUB-RECT: the fuel level
 *               is a source-width, not a re-render, so a draining meter costs one blit.
 *   2 LEAD      the white-hot leading smear at the fill's right edge
 *   3 OVERHEAT  the red rim, blitted only when the meter has bottomed out
 */
function bakeTurbo(S, faces) {
  const W = SHEET.turbo.w, H = SHEET.turbo.h;
  const { cv, c2d: c } = mkCanvas(W * S, H * 5 * S);
  c.scale(S, S);
  const PX = 2, PY = 2, PW = W - 4, PH = H - 4;

  /**
   * THE FILL BAND. `bar/panel-truck.png` puts the electric-blue bar in the BOTTOM ~45%
   * of the plate with the word sitting above it, and the first capture of this piece
   * showed exactly why that is the right silhouette and not merely the accurate one: a
   * full-height fill is opaque, so at 52% fuel the meter had eaten the first two letters
   * and the control read "RBO". The word lives above the bar; the bar never touches it.
   */
  const FILL_TOP = 0.52, WORD_Y = 0.30;

  // ---- row 0: the plate ---------------------------------------------------
  {
    const y = 0;
    const g = c.createLinearGradient(0, y + PY, 0, y + PY + PH);
    g.addColorStop(0, '#141a26');
    g.addColorStop(0.55, '#080b12');
    g.addColorStop(1, '#03050a');
    lozenge(c, PX, y + PY, PW, PH);
    c.fillStyle = g; c.fill();
    c.lineWidth = 1.8;
    c.strokeStyle = 'rgba(90,140,255,0.75)';
    c.stroke();
    // the empty channel the bar runs in
    lozenge(c, PX + 1, y + PY + PH * FILL_TOP, PW - 2, PH * (1 - FILL_TOP) - 1);
    c.fillStyle = 'rgba(6,12,30,0.85)';
    c.fill();
    // one segment divider, exactly as in the art
    c.lineWidth = 1;
    c.strokeStyle = 'rgba(90,140,255,0.35)';
    c.beginPath();
    c.moveTo(PX + PW * 0.52, y + PY + PH * FILL_TOP + 1);
    c.lineTo(PX + PW * 0.52, y + PY + PH - 2);
    c.stroke();
    // The word: high, large, oblique. slant 0.24 (~13.5 deg) and packed tracking are the
    // numbers hud-overlay measured off the same panel; matching them is what makes the
    // control and the gauge read as one piece of furniture.
    text(faces, c, 'TURBO', PX + PW * 0.46, y + PY + PH * WORD_Y, 15, 'blitz-techno', INK,
      { slant: 0.24, tracking: 0.02 });
  }

  // ---- row 1: the fill bar (bottom band only) -----------------------------
  {
    const y = H;
    const by = y + PY + PH * FILL_TOP, bh = PH * (1 - FILL_TOP) - 1;
    lozenge(c, PX + 1, by, PW - 2, bh);
    c.save();
    c.clip();
    const g = c.createLinearGradient(0, by, 0, by + bh);
    g.addColorStop(0, BLUE_HI);
    g.addColorStop(0.35, BLUE);
    g.addColorStop(1, BLUE_LO);
    c.fillStyle = g;
    c.fillRect(PX, by, PW, bh);
    // The art's bar is brightest along its bottom-left, where it wraps the rounded lead.
    const g2 = c.createRadialGradient(PX + PW * 0.10, by + bh * 0.8, 1,
      PX + PW * 0.10, by + bh * 0.8, PW * 0.5);
    g2.addColorStop(0, 'rgba(200,226,255,0.65)');
    g2.addColorStop(1, 'rgba(200,226,255,0)');
    c.fillStyle = g2;
    c.fillRect(PX, by, PW, bh);
    c.restore();
  }

  // ---- row 2: the leading smear ------------------------------------------
  {
    const y = H * 2;
    const by = y + PY + PH * FILL_TOP, bh = PH * (1 - FILL_TOP) - 1;
    const g = c.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.7, 'rgba(226,240,255,0.7)');
    g.addColorStop(1, 'rgba(255,255,255,0.95)');
    c.fillStyle = g;
    c.fillRect(0, by, W, bh);
  }

  // ---- row 3: the overheat rim -------------------------------------------
  {
    const y = H * 3;
    lozenge(c, PX, y + PY, PW, PH);
    c.lineWidth = 2.6;
    c.strokeStyle = HEAT;
    c.stroke();
    c.lineWidth = 1;
    c.strokeStyle = 'rgba(255,150,90,0.6)';
    lozenge(c, PX - 1.5, y + PY - 1.5, PW + 3, PH + 3);
    c.stroke();
  }

  // ---- row 4: the pressed rim --------------------------------------------
  {
    const y = H * 4;
    lozenge(c, PX, y + PY, PW, PH);
    c.lineWidth = 2.6;
    c.strokeStyle = RIM_HOT;
    c.stroke();
    c.lineWidth = 1;
    c.strokeStyle = 'rgba(143,182,255,0.75)';
    lozenge(c, PX - 1.5, y + PY - 1.5, PW + 3, PH + 3);
    c.stroke();
  }
  return cv;
}

/* -------------------------------------------------------- receiver icons */

/**
 * Numbered receiver icons: a chevron-topped disc with a big numeral, in the game's gold.
 * Row 0 is the resting icon, row 1 is the one the thumb (or the bearing flick) is
 * currently pointing at. The "hot" row is what makes the bearing flick learnable — the
 * player sees which man their thumb has chosen BEFORE they let go.
 */
function bakeRecv(S, faces) {
  const W = SHEET.recv.w, H = SHEET.recv.h;
  const { cv, c2d: c } = mkCanvas(W * 6 * S, H * 2 * S);
  c.scale(S, S);
  for (let row = 0; row < 2; row++) {
    const hot = row === 1;
    for (let col = 0; col < 6; col++) {
      const cx = col * W + W * 0.5, cy = row * H + H * 0.5, R = 21;
      c.beginPath(); c.arc(cx, cy, R, 0, 6.283185307179586);
      const g = c.createLinearGradient(cx, cy - R, cx, cy + R);
      g.addColorStop(0, hot ? GOLD_HI : 'rgba(20,26,38,0.88)');
      g.addColorStop(1, hot ? '#c98a00' : 'rgba(6,9,15,0.9)');
      c.fillStyle = g; c.fill();
      c.lineWidth = hot ? 3 : 2;
      c.strokeStyle = hot ? '#fff3cf' : RIM;
      c.stroke();
      // pointer chevron below the disc — anchors the icon to a player on the field
      c.beginPath();
      c.moveTo(cx - 7, cy + R - 1);
      c.lineTo(cx, cy + R + 9);
      c.lineTo(cx + 7, cy + R - 1);
      c.closePath();
      c.fillStyle = hot ? GOLD : 'rgba(20,26,38,0.88)';
      c.fill();
      c.lineWidth = hot ? 2 : 1.6;
      c.strokeStyle = hot ? '#fff3cf' : RIM;
      c.stroke();
      text(faces, c, String(col + 1), cx, cy + 1, 22, 'blitz-num', hot ? '#1a1204' : INK, {});
    }
  }
  return cv;
}

export default { createSprites, bake, SHEET, GRADE_TINT };
