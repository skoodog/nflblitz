// PIECE menu-team-select — ONE CLUB CARD.
//
// The card is BAKED to an offscreen canvas and cached by
// (club id, selected, raster). Nothing about a card changes between frames — a menu
// is not an animation — so the shipping frame path for four cards is four
// drawImage calls with numeric arguments plus the selected card's glow. That is the
// same discipline hud-overlay and score-callout hold, and it is what keeps a
// full-screen 1920x1080 menu inside the overlay budget on a phone.
//
// SELECTED vs UNSELECTED, and why it is three things at once. On a 390 px phone the
// whole 1920 logical space is 0.36 CSS px per logical px, so a 2 px keyline
// difference is under half a device pixel and simply does not exist. The state is
// therefore carried by:
//   1. VALUE      unselected cards are composited under a 44% ink veil — most of a
//                 stop of separation, which survives any downscale. It started at
//                 52% and came down after looking at the first render: at 52% the
//                 mascots on the three unselected cards were mud, and the crest is
//                 the thing that tells you which club you are about to page past.
//   2. POSITION   the selected card is lifted 14 px clear of the row.
//   3. COLOUR     the selected card keeps its club keyline at full chroma and gains
//                 an outer bloom in the club's own glow colour; unselected keylines
//                 drop to 30% alpha.
// Any one of those alone fails on some surface; the three together do not.

import { mkCanvas, rr, lin, rad, rgba, mix, drawFit, sizeForCap } from './chrome.js';
import { paletteOf, PAPER, PAPER_DIM, GOLD, GOLD_HI, GOLD_LO, TRACK, TRACK_EDGE, GROUND } from './palette.js';
import { CARD, C, SEGMENTS, STAT_LABELS } from './layout.js';
import { statsOf, starOf, shortName } from './league.js';

const CACHE = new Map();
const CACHE_MAX = 24;

export function invalidate() { CACHE.clear(); }

/**
 * card(ui, team, selected, raster) -> canvas of CARD.w*raster x CARD.h*raster.
 * `raster` lets the runtime overlay bake at the resolution it actually blits at
 * instead of always paying for 1920-wide art on a 390 px screen.
 */
export function card(ui, team, selected, raster) {
  const r = Math.max(0.25, Math.min(1, raster || 1));
  const key = `${team ? team.id : '?'}|${selected ? 1 : 0}|${Math.round(r * 100)}`;
  const hit = CACHE.get(key);
  if (hit) return hit;
  const cv = bake(ui, team, selected, r);
  if (CACHE.size >= CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
  CACHE.set(key, cv);
  return cv;
}

function bake(ui, team, selected, r) {
  const W = CARD.w, H = CARD.h;
  const cv = mkCanvas(W * r, H * r);
  const c = cv.getContext('2d');
  c.scale(r, r);
  const P = paletteOf(team);
  const faces = ui.faces;

  c.save();
  rr(c, 0, 0, W, H, CARD.r);
  c.clip();

  /* ---- ground: the club's own primary, crushed, over the screen black ------ */
  c.fillStyle = lin(c, 0, 0, 0, H, [
    [0.00, P.mid],
    [0.42, P.deep],
    [1.00, GROUND],
  ]);
  c.fillRect(0, 0, W, H);

  // A soft club-colour bloom behind the crest. This is the card's only "effect"
  // and it is the club's glow colour at 14% — the crest itself carries the shard
  // burst, so a second one here would just mud the mascot's silhouette.
  c.save();
  c.globalCompositeOperation = 'lighter';
  c.fillStyle = rad(c, W / 2, 150, 0, W / 2, 150, W * 0.72, [
    [0, rgba(P.glow, 0.16)], [0.55, rgba(P.glow, 0.05)], [1, rgba(P.glow, 0)],
  ]);
  c.fillRect(0, 0, W, 340);
  c.restore();

  /* ---- crest ------------------------------------------------------------- */
  drawCrest(c, ui, team);

  // Ground the type: everything below the crest sits on a hard floor so a bright
  // mascot can never bleed into the nickname.
  c.fillStyle = lin(c, 0, C.crest.y + C.crest.s - 70, 0, C.crest.y + C.crest.s + 30, [
    [0, rgba(GROUND, 0)], [1, rgba(GROUND, 0.92)],
  ]);
  c.fillRect(0, C.crest.y + C.crest.s - 70, W, 100);
  c.fillStyle = rgba(GROUND, 0.92);
  c.fillRect(0, C.crest.y + C.crest.s + 28, W, H - (C.crest.y + C.crest.s + 28));

  /* ---- names ------------------------------------------------------------- */
  const cityTxt = String((team && team.city) || '').toUpperCase();
  const nickTxt = String((team && team.name) || '').toUpperCase();
  const inner = W - C.pad * 2;

  drawFit(c, faces, cityTxt, W / 2, C.cityBase, {
    face: 'blitz-block', cap: C.cityCap, align: 'center',
    fill: PAPER_DIM, tracking: 0.14, maxW: inner,
  });

  // The nickname is the card's loudest element and it is set in the CLUB's own
  // colour, raised to a readable luminance. A black keyline under it keeps it off
  // whatever the ground tint happens to be.
  drawFit(c, faces, nickTxt, W / 2, C.nickBase, {
    face: 'blitz-block', cap: C.nickCap, align: 'center',
    fill: P.name, stroke: '#04050a', strokeWidth: Math.max(2, C.nickCap * 0.085),
    tracking: 0.02, maxW: inner,
    shadow: { color: 'rgba(0,0,0,0.85)', blur: 14, dy: 3 },
  });

  /* ---- the club-colour lens ---------------------------------------------- */
  // The panel puts a shallow lit lens in club colour directly under the nickname
  // (measured rows 217..221 of 310, i.e. 0.704..0.722 of the card). It is the one
  // place on the card where the club colour is shown FLAT rather than as type.
  lens(c, W / 2, C.ruleY, W * 0.78, C.ruleH, P.key);

  /* ---- star player ------------------------------------------------------- */
  const star = starOf(team);
  if (star) {
    const numTxt = String(star.num === undefined ? '' : star.num);
    const nameTxt = shortName(star.name);
    const posTxt = String(star.pos || '').toUpperCase();
    const gap = 12;
    const numW = numTxt ? measureCap(faces, numTxt, 'blitz-num', C.starCap * 1.15) : 0;
    const posW = posTxt ? measureCap(faces, posTxt, 'blitz-block', C.starCap * 0.82, 0.1) : 0;
    const nameMax = inner - numW - posW - gap * 2;
    const nameW = Math.min(measureCap(faces, nameTxt, 'blitz-block', C.starCap, 0.02), nameMax);
    let x = (W - (numW + posW + nameW + gap * 2)) / 2;
    if (numTxt) {
      drawFit(c, faces, numTxt, x, C.starBase, {
        face: 'blitz-num', cap: C.starCap * 1.15, fill: GOLD,
      });
      x += numW + gap;
    }
    drawFit(c, faces, nameTxt, x, C.starBase, {
      face: 'blitz-block', cap: C.starCap, fill: PAPER, tracking: 0.02, maxW: nameMax,
    });
    x += nameW + gap;
    if (posTxt) {
      drawFit(c, faces, posTxt, x, C.starBase, {
        face: 'blitz-block', cap: C.starCap * 0.82, fill: PAPER_DIM, tracking: 0.1,
      });
    }
  }

  /* ---- stat bars --------------------------------------------------------- */
  const vals = statsOf(team);
  for (let i = 0; i < 3; i++) {
    const y = C.barY[i];
    drawFit(c, faces, STAT_LABELS[i], C.labelX, y + C.barH * 0.78, {
      face: 'blitz-block', cap: C.barH * 0.5, fill: PAPER_DIM,
      tracking: 0.05, maxW: C.trackX - C.labelX - 10,
    });
    segBar(c, C.trackX, y, C.trackW, C.barH, vals[i]);
  }

  c.restore();

  /* ---- the veil that says "not this one" --------------------------------- */
  if (!selected) {
    c.save();
    rr(c, 0, 0, W, H, CARD.r);
    c.clip();
    c.fillStyle = 'rgba(4,5,9,0.44)';
    c.fillRect(0, 0, W, H);
    c.restore();
  }

  /* ---- keyline + corner brackets ----------------------------------------- */
  keyline(c, W, H, P, selected);

  return cv;
}

/* ------------------------------------------------------------------ pieces */

function measureCap(faces, text, face, cap, tracking) {
  const size = sizeForCap(faces, face, cap);
  return faces.measure(text, face, size, { face, size, tracking }).w;
}

function drawCrest(c, ui, team) {
  const brand = ui && ui.brand;
  if (!brand || typeof brand.crest !== 'function' || !team) return;
  let img = null;
  try { img = brand.crest(team.id, C.crest.s); } catch (e) { img = null; }
  if (!img) return;
  c.drawImage(img, C.crest.x, C.crest.y, C.crest.s, C.crest.s);
}

/**
 * The lit lens under the nickname. Not a rectangle: the panel's band is widest at
 * the centre and fades out before the card edge, which is what stops it reading as
 * a divider rule and makes it read as light coming off the card.
 */
function lens(c, cx, y, w, h, colour) {
  c.save();
  c.globalCompositeOperation = 'lighter';
  c.beginPath();
  c.ellipse(cx, y + h, w / 2, h, 0, Math.PI, Math.PI * 2);
  c.closePath();
  c.fillStyle = lin(c, cx - w / 2, 0, cx + w / 2, 0, [
    [0.00, rgba(colour, 0)],
    [0.22, rgba(colour, 0.55)],
    [0.50, rgba(colour, 0.95)],
    [0.78, rgba(colour, 0.55)],
    [1.00, rgba(colour, 0)],
  ]);
  c.fill();
  // the hot top edge
  c.strokeStyle = lin(c, cx - w / 2, 0, cx + w / 2, 0, [
    [0.0, rgba(colour, 0)], [0.5, rgba(mix(colour, '#ffffff', 0.55), 0.9)], [1.0, rgba(colour, 0)],
  ]);
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(cx - w / 2, y + h);
  c.lineTo(cx + w / 2, y + h);
  c.stroke();
  c.restore();
}

/**
 * The segmented meter. 11 cells, counted off the concept panel's 6x crop (card 0
 * reads 9 / 7 / 5 lit). The LAST lit cell is drawn to a fractional width rather
 * than rounded up: the club stats are continuous and a bar that quantises to
 * elevenths would show two clubs 4 points apart as identical.
 */
export function segBar(c, x, y, w, h, v01) {
  const pitch = w / SEGMENTS;
  const cell = pitch - 3;
  const lit = Math.max(0, Math.min(1, v01)) * SEGMENTS;
  for (let i = 0; i < SEGMENTS; i++) {
    const cx = x + i * pitch;
    // the unlit cell always draws — it is the track
    c.fillStyle = TRACK;
    c.fillRect(cx, y, cell, h);
    c.fillStyle = TRACK_EDGE;
    c.fillRect(cx, y, cell, 1.5);
    c.fillStyle = 'rgba(0,0,0,0.55)';
    c.fillRect(cx, y + h - 1.5, cell, 1.5);

    const f = Math.max(0, Math.min(1, lit - i));
    if (f <= 0) continue;
    const cw = cell * f;
    c.fillStyle = lin(c, 0, y, 0, y + h, [
      [0.00, GOLD_HI],
      [0.30, GOLD],
      [0.72, GOLD],
      [1.00, GOLD_LO],
    ]);
    c.fillRect(cx, y, cw, h);
    c.fillStyle = 'rgba(255,244,204,0.85)';
    c.fillRect(cx, y, cw, 1.5);
  }
}

/**
 * Keyline. A thin club-colour rule all the way round plus heavier brackets at the
 * four corners — the concept panel's cards do exactly this, and the brackets are
 * what make the card read as a card at thumbnail size once the 1 px rule has been
 * scaled below a device pixel.
 */
function keyline(c, W, H, P, selected) {
  const a = selected ? 1 : 0.30;
  const lw = selected ? 3 : 2;
  c.save();
  rr(c, lw / 2, lw / 2, W - lw, H - lw, CARD.r - lw / 2);
  c.strokeStyle = rgba(P.key, 0.55 * a);
  c.lineWidth = lw;
  c.stroke();

  // brackets
  const L = selected ? 74 : 52;
  c.strokeStyle = rgba(P.key, a);
  c.lineWidth = lw + (selected ? 2 : 0);
  c.lineCap = 'butt';
  const k = CARD.r;
  const corners = [
    [lw / 2, lw / 2, 1, 1], [W - lw / 2, lw / 2, -1, 1],
    [lw / 2, H - lw / 2, 1, -1], [W - lw / 2, H - lw / 2, -1, -1],
  ];
  for (const [x, y, sx, sy] of corners) {
    c.beginPath();
    c.moveTo(x + sx * (k + L), y);
    c.lineTo(x + sx * k, y);
    c.arcTo(x, y, x, y + sy * k, k);
    c.lineTo(x, y + sy * (k + L));
    c.stroke();
  }
  c.restore();
}

/**
 * The selected card's outer bloom, drawn around the card rather than into it so the
 * card canvas stays exactly CARD.w x CARD.h and the cache key stays simple. Static —
 * see the note at the top of screen.js for why nothing on this screen breathes.
 */
export function glow(c, x, y, team) {
  const P = paletteOf(team);
  c.save();
  c.globalCompositeOperation = 'lighter';
  c.shadowColor = rgba(P.glow, 0.55);
  c.shadowBlur = 46;
  c.strokeStyle = rgba(P.glow, 0.30);
  c.lineWidth = 4;
  rr(c, x - 2, y - 2, CARD.w + 4, CARD.h + 4, CARD.r + 2);
  c.stroke();
  c.restore();
}

export default { card, glow, invalidate, segBar };
