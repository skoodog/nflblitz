// PIECE: score-callout — the ink engine.
//
// One styled display line, painted the way the bar's lettering is painted:
//
//   1. hand-set layout      per-glyph scale / baseline bounce / rotation jitter,
//                           line-initial cap emphasis, tight negative tracking.
//   2. dark keyline         stroked UNDER the fill so internal subpath seams never show
//   3. gradient fill        ramps sampled off the bar (see palette.js)
//   4. inner crown light    a soft top-lit band + a deep foot, clipped to the glyphs
//   5. specular sweep       one raking band across the gold — material response
//   6. dry-brush skips      streaks ALONG the brush axis, thinning the ink
//   7. torn edge            silhouette MINUS an eroded copy = an edge band; noise is
//                           intersected with that band and punched out, so terminals
//                           come out ragged instead of vector-clean
//   8. outward flecks       the same trick with a DILATED band, filled with ink, so a
//                           few specks of spatter sit off the letter
//   9. shadow + halo        derived from the FINISHED, already-chewed silhouette, blurred
//                           with ctx.filter — so the shadow follows the torn edge and no
//                           dark under-fill shows through the bite marks
//  10. warm glow            same silhouette, tinted, added — gold only
//
// Everything here runs at BAKE time only. The frame path never enters this file.

import { makeRng, seedFromString, hash } from '../../foundation/rng.js';
import { OUTLINE, SHADOW_RGB, RAMPS, ramp } from './palette.js';

/* ----------------------------------------------------------- scratch pool */

const POOL = [];
function scratch(i, w, h) {
  let s = POOL[i];
  if (!s) {
    const cv = newCanvas(w, h);
    s = POOL[i] = { cv, ctx: cv.getContext('2d') };
  }
  if (s.cv.width < w || s.cv.height < h) {
    s.cv.width = Math.max(s.cv.width, w);
    s.cv.height = Math.max(s.cv.height, h);
  }
  const c = s.ctx;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'source-over';
  c.globalAlpha = 1;
  c.filter = 'none';
  c.clearRect(0, 0, s.cv.width, s.cv.height);
  return s;
}

export function newCanvas(w, h) {
  const W = Math.max(2, Math.ceil(w)), H = Math.max(2, Math.ceil(h));
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(W, H);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  return cv;
}

/* -------------------------------------------------------------- cap ratio */

const CAP_CACHE = new Map();
function capRatioOf(faces, face) {
  const k = (faces.piece || 'f') + '|' + face;
  let v = CAP_CACHE.get(k);
  if (v === undefined) {
    let m = null;
    try { m = faces.measure('H', face, 100, { tracking: 0 }); } catch (e) { m = null; }
    v = (m && (m.cap || m.ascent)) ? (m.cap || m.ascent) / 100 : 0.72;
    if (!(v > 0.2) || !(v < 1.4)) v = 0.72;
    CAP_CACHE.set(k, v);
  }
  return v;
}

function advOf(faces, ch, face, size) {
  try { return faces.measure(ch, face, size, { tracking: 0 }).w; } catch (e) { return size * 0.5; }
}

/* ----------------------------------------------------------------- layout */

/**
 * Hand-set a single line. Origin is the line's baseline at x = 0.
 *
 * `minor` is the bar's most characteristic move: after the line-initial cap, every
 * following cap drops to ~85%. Measured off panel-touchdown (O/T = 0.83) and
 * panel-midair_hit (D/M = 0.85). Setting every cap to the same height is the clearest
 * way to look like a FONT instead of like LETTERING.
 */
export function layoutLine(faces, text, o) {
  const face = o.face || 'blitz-brush';
  const capH = o.capH;
  const size = capH / capRatioOf(faces, face);
  const track = (o.tracking || 0) * capH;
  const jit = o.jitter === undefined ? 1 : o.jitter;
  const minor = o.minor === undefined ? 0.855 : o.minor;
  const s = String(text);
  const n = s.length;
  const rng = makeRng(hash(seedFromString('sc.line|' + s + '|' + face), Math.round(capH * 4)));

  const scales = new Array(n);
  let seenFirst = false;
  for (let i = 0; i < n; i++) {
    const ch = s[i];
    if (ch === ' ') { scales[i] = 1; continue; }
    let sc;
    if (!seenFirst) { sc = 1.0; seenFirst = true; }
    else if (ch === '!' || ch === '?') sc = o.excl === undefined ? 1.0 : o.excl;
    else sc = minor;
    sc *= 1 + rng.range(-0.024, 0.024) * jit;
    scales[i] = sc;
  }

  const adv = new Array(n);
  for (let i = 0; i < n; i++) adv[i] = advOf(faces, s[i], face, size);

  const glyphs = [];
  let x = 0, top = 0, bot = 0;
  for (let i = 0; i < n; i++) {
    const dy = rng.range(-0.028, 0.028) * capH * jit;
    const rot = rng.range(-0.021, 0.021) * jit;
    glyphs.push({ ch: s[i], x, s: scales[i], dy, rot });
    top = Math.min(top, dy - capH * scales[i] * 1.10);
    bot = Math.max(bot, dy + capH * scales[i] * 0.34);
    let step = adv[i] * scales[i];
    if (i < n - 1) {
      let pair;
      try { pair = faces.measure(s[i] + s[i + 1], face, size, { tracking: 0 }).w; } catch (e) { pair = adv[i] + adv[i + 1]; }
      step += (pair - adv[i] - adv[i + 1]) * Math.min(scales[i], scales[i + 1]);
      step += track;
    }
    x += step;
  }

  return { glyphs, width: x, size, capH, face, top, bot };
}

/** All glyphs of a laid-out line as one Path2D, origin = baseline at x = 0. */
export function linePath(faces, L) {
  const P = new Path2D();
  for (let i = 0; i < L.glyphs.length; i++) {
    const g = L.glyphs[i];
    if (g.ch === ' ') continue;
    let gp = null;
    try { gp = faces.path(g.ch, L.face, L.size, { tracking: 0 }); } catch (e) { gp = null; }
    if (!gp) continue;
    const co = Math.cos(g.rot), si = Math.sin(g.rot), sc = g.s;
    P.addPath(gp, { a: sc * co, b: sc * si, c: -sc * si, d: sc * co, e: g.x, f: g.dy });
  }
  return P;
}

/* ------------------------------------------------------------- treatments */

/** Dry-brush skips: thin streaks running ALONG the italic axis, thinning the ink. */
function dryBrush(ctx, P, box, capH, slant, seed, amount) {
  if (amount <= 0) return;
  const rng = makeRng(seed);
  const w = box.x1 - box.x0, h = box.y1 - box.y0;
  ctx.save();
  ctx.clip(P);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.lineCap = 'butt';
  const n = Math.round(16 + (w / capH) * 12 * amount);
  for (let i = 0; i < n; i++) {
    const x = box.x0 + rng() * w;
    const y = box.y0 + rng() * h;
    const len = capH * (0.18 + rng() * 0.85);
    ctx.lineWidth = capH * (0.005 + rng() * rng() * 0.018);
    ctx.strokeStyle = `rgba(0,0,0,${(0.10 + rng() * 0.40) * amount})`;
    ctx.beginPath();
    ctx.moveTo(x + len * slant * 0.5, y - len * 0.5);
    ctx.lineTo(x - len * slant * 0.5, y + len * 0.5);
    ctx.stroke();
  }
  // Fine tooth so a flat gradient never reads as vector-flat.
  ctx.globalCompositeOperation = 'source-over';
  const m = Math.round(60 + (w / capH) * 40 * amount);
  for (let i = 0; i < m; i++) {
    const x = box.x0 + rng() * w;
    const y = box.y0 + rng() * h;
    const r = capH * (0.003 + rng() * 0.009);
    ctx.fillStyle = rng() < 0.46
      ? `rgba(255,246,226,${(0.035 + rng() * 0.070) * amount})`
      : `rgba(24,12,16,${(0.035 + rng() * 0.080) * amount})`;
    ctx.fillRect(x, y, r * 1.5, r * 3.1);
  }
  ctx.restore();
}

const RING = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7],
];

/**
 * The torn edge.
 *
 *   band  = silhouette  MINUS  erode(silhouette, r)     a ring r px wide, inside
 *   chew  = noise  INTERSECT  band                      ragged bites, edge only
 *   layer = layer  MINUS  chew
 *
 * Erosion is the intersection of translated copies, which Canvas2D gives for free with
 * `destination-in`. Doing it this way rather than by stroking means internal subpath
 * seams — brush glyphs are unions of overlapping strokes — simply do not exist.
 */
function tornEdge(lctx, P, box, capH, slant, seed, amount, W, H, ox, oy) {
  if (amount <= 0) return;
  const r = Math.max(0.9, capH * 0.030 * amount);
  const A = scratch(0, W, H);
  const B = scratch(1, W, H);
  A.ctx.translate(ox, oy);
  B.ctx.translate(ox, oy);

  A.ctx.fillStyle = '#fff';
  A.ctx.fill(P);
  A.ctx.globalCompositeOperation = 'destination-in';
  for (let i = 0; i < RING.length; i++) {
    A.ctx.save();
    A.ctx.translate(RING[i][0] * r, RING[i][1] * r);
    A.ctx.fill(P);
    A.ctx.restore();
  }

  const rng = makeRng(seed);
  const bx = box.x1 - box.x0, by = box.y1 - box.y0;
  B.ctx.strokeStyle = '#fff';
  B.ctx.lineCap = 'round';
  const nb = Math.round((bx / capH) * 165 * amount);
  for (let i = 0; i < nb; i++) {
    const x = box.x0 + rng() * bx;
    const y = box.y0 + rng() * by;
    const len = capH * (0.012 + rng() * rng() * 0.085);
    B.ctx.lineWidth = capH * (0.004 + rng() * 0.016);
    B.ctx.globalAlpha = 0.45 + rng() * 0.55;
    B.ctx.beginPath();
    B.ctx.moveTo(x + len * slant, y - len);
    B.ctx.lineTo(x - len * slant, y + len);
    B.ctx.stroke();
  }
  B.ctx.globalAlpha = 1;
  B.ctx.globalCompositeOperation = 'destination-out';
  B.ctx.setTransform(1, 0, 0, 1, 0, 0);
  B.ctx.drawImage(A.cv, 0, 0);                 // drop everything inside the eroded core
  B.ctx.setTransform(1, 0, 0, 1, ox, oy);
  B.ctx.globalCompositeOperation = 'destination-in';
  B.ctx.fill(P);                               // keep only what is inside the letters

  lctx.save();
  lctx.setTransform(1, 0, 0, 1, 0, 0);
  lctx.globalCompositeOperation = 'destination-out';
  lctx.drawImage(B.cv, 0, 0);
  lctx.restore();
}

/** Brush spatter: a few specks of ink sitting just OFF the letter. */
function fleck(lctx, P, box, capH, slant, seed, amount, colour, W, H, ox, oy) {
  if (amount <= 0) return;
  const r = Math.max(1.0, capH * 0.040);
  const A = scratch(0, W, H);
  const B = scratch(1, W, H);
  A.ctx.translate(ox, oy);
  B.ctx.translate(ox, oy);

  A.ctx.fillStyle = '#fff';
  for (let i = 0; i < RING.length; i++) {
    A.ctx.save();
    A.ctx.translate(RING[i][0] * r, RING[i][1] * r);
    A.ctx.fill(P);
    A.ctx.restore();
  }
  A.ctx.globalCompositeOperation = 'destination-out';
  A.ctx.fill(P);

  const rng = makeRng(seed);
  const bx = box.x1 - box.x0, by = box.y1 - box.y0;
  B.ctx.strokeStyle = '#fff';
  B.ctx.lineCap = 'round';
  const n = Math.round((bx / capH) * 40 * amount);
  for (let i = 0; i < n; i++) {
    const x = box.x0 + rng() * bx;
    const y = box.y0 + rng() * by;
    const len = capH * (0.008 + rng() * rng() * 0.050);
    B.ctx.lineWidth = capH * (0.005 + rng() * 0.011);
    B.ctx.globalAlpha = 0.30 + rng() * 0.70;
    B.ctx.beginPath();
    B.ctx.moveTo(x + len * slant, y - len);
    B.ctx.lineTo(x - len * slant, y + len);
    B.ctx.stroke();
  }
  B.ctx.globalAlpha = 1;
  B.ctx.setTransform(1, 0, 0, 1, 0, 0);
  B.ctx.globalCompositeOperation = 'destination-in';
  B.ctx.drawImage(A.cv, 0, 0);
  B.ctx.globalCompositeOperation = 'source-in';
  B.ctx.fillStyle = colour;
  B.ctx.fillRect(0, 0, W, H);

  lctx.save();
  lctx.setTransform(1, 0, 0, 1, 0, 0);
  lctx.globalAlpha = 0.86;
  lctx.drawImage(B.cv, 0, 0);
  lctx.restore();
}

/** Tint a finished layer's alpha to a flat colour on a scratch canvas. */
function silhouette(idx, cv, W, H, colour) {
  const S = scratch(idx, W, H);
  S.ctx.drawImage(cv, 0, 0);
  S.ctx.globalCompositeOperation = 'source-in';
  S.ctx.fillStyle = colour;
  S.ctx.fillRect(0, 0, W, H);
  S.ctx.globalCompositeOperation = 'source-over';
  return S;
}

function midColour(key) {
  const st = RAMPS[key] || RAMPS.white;
  return st[Math.min(st.length - 1, 2)][1];
}

/* ------------------------------------------------------------------ paint */

/**
 * paintLine(target, faces, spec)
 * `spec.x` is the line's CENTRE, `spec.y` its BASELINE, in target space.
 */
export function paintLine(target, faces, spec) {
  const capH = spec.capH;
  const L = spec.layout || layoutLine(faces, spec.text, spec);
  const P = spec.path || linePath(faces, L);
  const slant = spec.slant === undefined ? 0.28 : spec.slant;
  const key = spec.rampKey || 'white';
  const seed = hash(seedFromString('sc.ink|' + spec.text), Math.round(capH * 8), spec.seed | 0);

  const pad = Math.ceil(capH * 0.58);
  const y0 = L.top, y1 = L.bot;
  const W = Math.ceil(L.width + pad * 2);
  const H = Math.ceil((y1 - y0) + pad * 2);
  const ox = pad, oy = pad - y0;
  const box = { x0: -pad * 0.55, y0: y0 - pad * 0.25, x1: L.width + pad * 0.55, y1: y1 + pad * 0.25 };
  const ax = spec.x - L.width * 0.5;
  const ay = spec.y;

  /* ---------------------------------------------------------- the ink layer */
  const cv = newCanvas(W, H);
  const g = cv.getContext('2d');
  g.translate(ox, oy);

  if (spec.keyline !== 0) {
    g.save();
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.lineWidth = capH * (spec.keylineW === undefined ? 0.072 : spec.keylineW);
    g.strokeStyle = spec.keylineColor || OUTLINE;
    g.stroke(P);
    g.restore();
  }

  g.fillStyle = spec.fillStyle || ramp(g, key, y0 * 0.94, capH * 0.05);
  g.fill(P);

  if (spec.crown !== 0) {
    const ca = spec.crown === undefined ? 1 : spec.crown;
    g.save();
    g.clip(P);
    const cg = g.createLinearGradient(0, -capH * 1.02, 0, -capH * 0.52);
    cg.addColorStop(0, `rgba(255,252,238,${0.30 * ca})`);
    cg.addColorStop(0.6, `rgba(255,248,226,${0.08 * ca})`);
    cg.addColorStop(1, 'rgba(255,248,226,0)');
    g.fillStyle = cg;
    g.fillRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
    const fg = g.createLinearGradient(0, -capH * 0.36, 0, capH * 0.05);
    fg.addColorStop(0, 'rgba(38,14,6,0)');
    fg.addColorStop(1, `rgba(38,14,6,${0.24 * ca})`);
    g.fillStyle = fg;
    g.fillRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
    g.restore();
  }

  if (spec.sweep) {
    g.save();
    g.clip(P);
    g.globalCompositeOperation = 'lighter';
    const cx = L.width * (spec.sweep.at === undefined ? 0.34 : spec.sweep.at);
    const wdt = capH * (spec.sweep.w === undefined ? 0.80 : spec.sweep.w);
    g.translate(cx, 0);
    g.rotate(-Math.atan(slant) - 0.06);
    const sg = g.createLinearGradient(-wdt, 0, wdt, 0);
    sg.addColorStop(0, 'rgba(255,255,255,0)');
    sg.addColorStop(0.5, `rgba(255,250,230,${spec.sweep.a === undefined ? 0.26 : spec.sweep.a})`);
    sg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = sg;
    g.fillRect(-wdt, -capH * 3, wdt * 2, capH * 6);
    g.restore();
  }

  dryBrush(g, P, box, capH, slant, hash(seed, 11), spec.grain === undefined ? 0.62 : spec.grain);
  tornEdge(g, P, box, capH, slant, hash(seed, 23), spec.torn === undefined ? 1 : spec.torn, W, H, ox, oy);
  fleck(g, P, box, capH, slant, hash(seed, 37), spec.flecks === undefined ? 1 : spec.flecks,
    spec.fleckColour || midColour(key), W, H, ox, oy);

  /* ------------------------------------------------- shadow / halo / glow */
  // All three are derived from the FINISHED, already-chewed silhouette, so the shadow
  // hugs the torn edge and no dark under-fill bleeds through the bite marks.
  const dx = ax - ox, dy = ay - oy;
  const sh = spec.shadow === undefined ? 1 : spec.shadow;
  if (sh > 0) {
    const S = silhouette(2, cv, W, H, `rgb(${SHADOW_RGB})`);
    target.save();
    const ha = spec.halo === undefined ? 1 : spec.halo;
    if (ha > 0) {
      target.filter = `blur(${(capH * 0.30).toFixed(2)}px)`;
      target.globalAlpha = 0.44 * ha;
      target.drawImage(S.cv, dx + capH * 0.02, dy + capH * 0.10);
      target.drawImage(S.cv, dx + capH * 0.02, dy + capH * 0.10);
    }
    target.filter = `blur(${(capH * 0.062).toFixed(2)}px)`;
    target.globalAlpha = 0.80 * sh;
    target.drawImage(S.cv, dx + capH * 0.030, dy + capH * 0.075);
    target.drawImage(S.cv, dx + capH * 0.030, dy + capH * 0.075);
    target.filter = 'none';
    target.restore();
  }
  if (spec.glow) {
    const G = silhouette(2, cv, W, H, spec.glow.color);
    target.save();
    target.globalCompositeOperation = 'lighter';
    target.filter = `blur(${(capH * (spec.glow.blur === undefined ? 0.30 : spec.glow.blur)).toFixed(2)}px)`;
    target.globalAlpha = spec.glow.alpha === undefined ? 0.42 : spec.glow.alpha;
    const reps = spec.glow.reps === undefined ? 2 : spec.glow.reps;
    for (let i = 0; i < reps; i++) target.drawImage(G.cv, dx, dy);
    target.filter = 'none';
    target.restore();
  }

  target.drawImage(cv, dx, dy);
  L.layerCanvas = cv;
  L.layerOx = ox;
  L.layerOy = oy;
  return L;
}

export default { layoutLine, linePath, paintLine, newCanvas };
