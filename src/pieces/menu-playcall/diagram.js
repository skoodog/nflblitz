// PIECE menu-playcall — the play diagram. This is the part that has to be TRUE.
//
// Every line on a card comes out of src/data/playbook.json. The offensive cards draw
// the `routes` waypoint chains; the defensive cards draw the `assign` map against the
// shipped `formation`. Nothing is stylised into existence: if a play has three
// waypoints, three waypoints are what is drawn, projected through one shared mapping
// (see layout.js for the depth curve and why it is a curve).
//
// WHAT A ROUTE LOOKS LIKE AND WHY.
//   underdraw   a 7 px near-black stroke under everything, because the cards sit over
//               a dark bowl and a 3 px magenta line on near-black loses its edge
//   spine       the rounded polyline at 45% alpha — the geometry, continuous
//   beads       dots every 11 px along the spine — the bar's playbook art is beaded,
//               and the beads also read as the receiver's steps
//   head        a filled arrowhead at the last waypoint, so the break direction reads
//   foot        a ringed dot at the first waypoint = where the man lines up
// The beads are laid down with ONE arc per bead rather than a dashed stroke because a
// dash pattern is laid along the path in the CURRENT transform and would smear on the
// rounded corners; `walk()` puts them at a true uniform arc length.
//
// A NOTE ON THE PRIMARY READ. `primary` is drawn with a ring at the foot and a fatter
// bead, never a different colour — the colour is the slot's identity and has to stay
// learnable across all 18 cards (see palette.js).

import {
  HALF_WIDTH, DEF_HALF_WIDTH, MAX_DEPTH, MAX_BACK, DEPTH_POW, BACK_POW,
  DEF_MAX_DEPTH, DEF_MAX_BACK,
} from './layout.js';
import { FORMATION, REC_SLOTS, OL_SLOTS, DEF_SLOTS } from './book.js';
import { SLOT, ASSIGN, ZONE_FILL, ZONE_EDGE, GHOST, LOS, YARD_RULE, rgba } from './palette.js';
import { arrowHead, roundedPolyPath, walk } from './chrome.js';

/**
 * Yard-space -> pixel-space projection inside a diagram rect.
 *
 * `opts.mode` picks the mapping: 'route' (the compressive curve, offensive sheet) or
 * 'cover' (linear over 34 yards, defensive sheet). See layout.js for why there are two
 * and what was measured to justify the second one.
 *
 * HEADROOM. The first version mapped the deepest route to exactly r.y, which put HAIL
 * MARY's arrowhead ON the clip edge and sheared the top off all three of its arrows —
 * visible in the first 1920x1080 render of offence page 1. The box now reserves
 * `topPad` (10 px at card scale) so a full-depth arrow lands inside.
 */
export function makeProj(r, opts = {}) {
  const cover = opts.mode === 'cover';
  const losFrac = opts.losFrac === undefined ? (cover ? 0.86 : 0.80) : opts.losFrac;
  const scale = opts.scale === undefined ? 1 : opts.scale;
  const maxD = opts.maxDepth === undefined ? (cover ? DEF_MAX_DEPTH : MAX_DEPTH) : opts.maxDepth;
  const maxB = opts.maxBack === undefined ? (cover ? DEF_MAX_BACK : MAX_BACK) : opts.maxBack;
  const cx = r.x + r.w * 0.5;
  const losY = r.y + r.h * losFrac;
  const top = 10 * scale;
  const up = Math.max(8, losY - r.y - top);
  const down = Math.max(6, r.y + r.h - losY - 2 * scale);
  const halfW = opts.halfWidth || (cover ? DEF_HALF_WIDTH : HALF_WIDTH);
  const kx = (r.w * 0.5 - (opts.padX === undefined ? 6 * scale : opts.padX)) / halfW;
  const px = (yd) => cx + yd * kx;
  const py = (yd) => {
    if (yd >= 0) {
      const f = Math.min(1, yd / maxD);
      return losY - up * (cover ? f : Math.pow(f, DEPTH_POW));
    }
    const f = Math.min(1, -yd / maxB);
    return losY + down * (cover ? f : Math.pow(f, BACK_POW));
  };
  return { px, py, cx, losY, up, down, kx, halfW, rect: r, mode: cover ? 'cover' : 'route' };
}

/** The field furniture: the line of scrimmage and two compressed depth rules. */
export function drawField(c, P, scale) {
  const r = P.rect;
  c.save();
  c.lineWidth = Math.max(1, 1.4 * scale);
  c.strokeStyle = YARD_RULE;
  // 10 and 20 yards. Only two, because at 149 px of box a third rule is noise; the
  // bar's own cards carry no rules at all and this is already one step busier.
  for (const yd of [10, 20]) {
    const y = Math.round(P.py(yd)) + 0.5;
    c.beginPath(); c.moveTo(r.x + 4, y); c.lineTo(r.x + r.w - 4, y); c.stroke();
  }
  // The line of scrimmage, brighter, with the hash ticks the field carries.
  const y0 = Math.round(P.losY) + 0.5;
  c.strokeStyle = LOS;
  c.lineWidth = Math.max(1, 2 * scale);
  c.beginPath(); c.moveTo(r.x + 2, y0); c.lineTo(r.x + r.w - 2, y0); c.stroke();
  c.strokeStyle = rgba([196, 206, 224], 0.30);
  c.lineWidth = Math.max(1, 1.4 * scale);
  for (let yd = -Math.floor(P.halfW / 5) * 5; yd <= P.halfW; yd += 5) {
    if (yd === 0) continue;
    const x = Math.round(P.px(yd)) + 0.5;
    c.beginPath(); c.moveTo(x, y0 - 4 * scale); c.lineTo(x, y0 + 4 * scale); c.stroke();
  }
  c.restore();
}

function dot(c, x, y, r, fill) {
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fillStyle = fill; c.fill();
}

/** The five blockers-and-passer marks that are the same on every offensive card. */
export function drawPocket(c, P, scale, opts = {}) {
  const F = FORMATION.offense;
  c.save();
  // Offensive line: three squat slabs on the line, dark steel, with a lit top edge so
  // they read as bodies rather than as holes in the plate.
  for (const s of OL_SLOTS) {
    const x = P.px(F[s][0]), y = P.py(F[s][1]);
    const w = 11 * scale, h = 7 * scale;
    c.fillStyle = SLOT.OL;
    c.fillRect(x - w / 2, y - h / 2, w, h);
    c.fillStyle = 'rgba(190,200,220,0.35)';
    c.fillRect(x - w / 2, y - h / 2, w, Math.max(1, 1.4 * scale));
  }
  if (opts.qb !== false) {
    const qx = P.px(F.QB[0]), qy = P.py(F.QB[1]);
    dot(c, qx, qy, 6.2 * scale, SLOT.QB);
    dot(c, qx, qy, 2.6 * scale, '#0a0a10');
  }
  c.restore();
}

/**
 * One route. `pts` is the raw yard-space waypoint chain out of the JSON.
 * Returns the pixel-space chain so callers (the proof sheet) can annotate it.
 */
export function drawRoute(c, P, pts, colour, scale, opts = {}) {
  const px = pts.map((p) => [P.px(p[0]), P.py(p[1])]);
  const path = roundedPolyPath(px, 9 * scale);
  const primary = !!opts.primary;
  const w = (primary ? 3.6 : 2.8) * scale;

  c.save();
  c.lineCap = 'round';
  c.lineJoin = 'round';
  // 1. underdraw
  c.strokeStyle = 'rgba(3,4,8,0.86)';
  c.lineWidth = w + 4.4 * scale;
  c.stroke(path);
  // 2. spine
  c.strokeStyle = rgba(colour, primary ? 0.60 : 0.42);
  c.lineWidth = w;
  c.stroke(path);
  // 3. beads
  const bead = (primary ? 3.5 : 3.0) * scale;
  const head = 13 * scale;
  const samples = walk(px, 11 * scale, 4 * scale, head * 0.9);
  for (const s of samples) dot(c, s[0], s[1], bead, colour);
  // 4. head
  const a = px[px.length - 2] || px[0];
  const b = px[px.length - 1];
  arrowHead(c, b[0], b[1], b[0] - a[0], b[1] - a[1], head, colour);
  // 5. foot
  const f = px[0];
  dot(c, f[0], f[1], 5.4 * scale, colour);
  dot(c, f[0], f[1], 2.2 * scale, '#08080e');
  if (primary) {
    c.strokeStyle = rgba(colour, 0.95);
    c.lineWidth = 1.8 * scale;
    c.beginPath(); c.arc(f[0], f[1], 8.6 * scale, 0, Math.PI * 2); c.stroke();
  }
  c.restore();
  return px;
}

/** The hand-off / flip: a dashed link from the passer to where the ball is going. */
function drawBallPath(c, P, from, to, scale, colour) {
  c.save();
  c.setLineDash([5 * scale, 5 * scale]);
  c.lineWidth = 1.8 * scale;
  c.strokeStyle = rgba(colour, 0.42);
  c.beginPath();
  const mx = (from[0] + to[0]) * 0.5;
  const my = Math.min(from[1], to[1]) - 12 * scale;
  c.moveTo(from[0], from[1]);
  c.quadraticCurveTo(mx, my, to[0], to[1]);
  c.stroke();
  c.restore();
}

/**
 * The gap a run is aimed at: a chevron sitting on the line at that x. Drawn AFTER the
 * offensive line, not before — the first version put it under the three OL slabs,
 * which is exactly where a gap marker is invisible (UP THE GUT's gap is 0, dead behind
 * the centre). It now sits just above the line, in the hole.
 */
function drawGap(c, P, gapYards, scale) {
  const x = P.px(gapYards);
  const y = P.losY;
  c.save();
  c.strokeStyle = 'rgba(3,4,8,0.85)';
  c.lineWidth = 5.6 * scale;
  c.lineJoin = 'round';
  c.beginPath();
  c.moveTo(x - 9 * scale, y - 2 * scale);
  c.lineTo(x, y - 12 * scale);
  c.lineTo(x + 9 * scale, y - 2 * scale);
  c.stroke();
  c.strokeStyle = 'rgba(255,196,60,0.9)';
  c.lineWidth = 2.8 * scale;
  c.stroke();
  c.restore();
}

/** A whole offensive play. */
export function drawOffense(c, play, rect, scale, opts = {}) {
  const P = makeProj(rect, Object.assign({ mode: 'route', scale }, opts));
  drawField(c, P, scale);
  drawPocket(c, P, scale);
  if (play.gap !== undefined && play.gap !== null) drawGap(c, P, play.gap, scale);

  // Draw the non-primary routes first so the primary's beads win every overlap.
  const order = REC_SLOTS.filter((s) => play.routes[s] && s !== play.primary)
    .concat(REC_SLOTS.filter((s) => play.routes[s] && s === play.primary));
  let primaryEnd = null;
  for (const s of order) {
    const isP = s === play.primary;
    const px = drawRoute(c, P, play.routes[s], SLOT[s], scale, { primary: isP });
    if (isP) primaryEnd = px[px.length - 1];
  }

  // WHERE THE BALL GOES.
  //   pass / screen  a dashed arc from the passer to the primary's break point
  //   run, carrier is a receiver slot  a short dashed hand-off to his first waypoint
  //   run, primary === 'QB'  the QB keeps it, and the book gives no QB route — only
  //     `gap`. So the carry is drawn from the passer's own spot THROUGH that gap. That
  //     is not invented geometry: it is the two fields the row does carry (primary and
  //     gap) drawn as what they mean. QB KEEPER would otherwise be the one card in the
  //     book with nothing on it but two blockers, which is how a bug hides.
  const qbPx = [P.px(FORMATION.offense.QB[0]), P.py(FORMATION.offense.QB[1])];
  if ((play.kind === 'pass' || play.kind === 'screen') && primaryEnd) {
    drawBallPath(c, P, qbPx, primaryEnd, scale, '#ffcf4a');
  } else if (play.kind === 'run') {
    if (play.primary === 'QB') {
      const g = play.gap === undefined || play.gap === null ? 0 : play.gap;
      drawRoute(c, P, [FORMATION.offense.QB, [g * 0.7, -1], [g, 5]], SLOT.QB, scale, { primary: true });
    } else if (play.routes[play.primary]) {
      const start = play.routes[play.primary][0];
      drawBallPath(c, P, qbPx, [P.px(start[0]), P.py(start[1])], scale, '#ffcf4a');
    }
  }
  return P;
}

/* ------------------------------------------------------------------ DEFENCE */

function drawZone(c, P, g, scale) {
  const x = P.px(g.zone[0]);
  const yTop = P.py(g.zone[1] + g.ry);
  const yBot = P.py(Math.max(-2, g.zone[1] - g.ry));
  const cy = (yTop + yBot) * 0.5;
  const rx = g.rx * P.kx;
  const ry = Math.max(6 * scale, (yBot - yTop) * 0.5);
  c.save();
  c.beginPath();
  c.ellipse(x, cy, rx, ry, 0, 0, Math.PI * 2);
  c.fillStyle = ZONE_FILL;
  c.fill();
  c.setLineDash([4 * scale, 4 * scale]);
  c.lineWidth = 1.8 * scale;
  c.strokeStyle = ZONE_EDGE;
  c.stroke();
  c.restore();
  return [x, cy];
}

/** A defender's mark: a hollow diamond, so it never reads as an offensive dot. */
function defenderMark(c, x, y, scale, colour) {
  c.save();
  c.translate(x, y);
  c.rotate(Math.PI * 0.25);
  const s = 6.4 * scale;
  c.fillStyle = '#0a0a10';
  c.fillRect(-s, -s, s * 2, s * 2);
  c.lineWidth = 2.2 * scale;
  c.strokeStyle = colour;
  c.strokeRect(-s, -s, s * 2, s * 2);
  c.restore();
}

/** A whole defensive call. */
export function drawDefense(c, play, rect, scale, opts = {}) {
  const P = makeProj(rect, Object.assign({ mode: 'cover', scale }, opts));
  drawField(c, P, scale);

  // The offence it is being run against — the same seven marks on every defensive
  // card, at 42% alpha, so the assignments have something to be aimed at.
  const F = FORMATION.offense;
  c.save();
  for (const s of OL_SLOTS) {
    const x = P.px(F[s][0]), y = P.py(F[s][1]);
    c.fillStyle = GHOST;
    c.fillRect(x - 5 * scale, y - 3.4 * scale, 10 * scale, 6.8 * scale);
  }
  for (const s of REC_SLOTS.concat(['QB'])) {
    const x = P.px(F[s][0]), y = P.py(F[s][1]);
    c.beginPath(); c.arc(x, y, 5.2 * scale, 0, Math.PI * 2);
    c.lineWidth = 1.8 * scale; c.strokeStyle = GHOST; c.stroke();
  }
  c.restore();

  // Zones first (they are fills and must sit under every line), then the arrows.
  for (const slot of DEF_SLOTS) {
    const g = play.geom[slot];
    if (g && g.zone) drawZone(c, P, g, scale);
  }

  for (const slot of DEF_SLOTS) {
    const g = play.geom[slot];
    if (!g) continue;
    const at = FORMATION.defense[slot];
    const x0 = P.px(at[0]), y0 = P.py(at[1]);
    const colour = ASSIGN[g.kind] || ASSIGN.zone_hook;
    let x1, y1;
    if (g.zone) {
      x1 = P.px(g.zone[0]);
      y1 = (P.py(g.zone[1] + g.ry) + P.py(Math.max(-2, g.zone[1] - g.ry))) * 0.5;
    } else {
      x1 = P.px(g.to[0]); y1 = P.py(g.to[1]);
    }

    const dx = x1 - x0, dy = y1 - y0;
    const L = Math.hypot(dx, dy) || 1;
    const head = 12 * scale;
    // Stop the shaft short of the target so the head lands ON the man, not through him.
    const stop = g.zone ? 0.55 : 0.80;
    const ex = x0 + dx * stop, ey = y0 + dy * stop;

    c.save();
    c.lineCap = 'round';
    if (g.kind === 'spy') {
      // A spy commits to nobody: a flat two-headed sweep across the passer's face.
      const w = 13 * scale;
      c.strokeStyle = 'rgba(3,4,8,0.85)'; c.lineWidth = 6.4 * scale;
      c.beginPath(); c.moveTo(x0 - w, y0 + 3 * scale); c.lineTo(x0 + w, y0 + 3 * scale); c.stroke();
      c.strokeStyle = colour; c.lineWidth = 2.6 * scale;
      c.beginPath(); c.moveTo(x0 - w, y0 + 3 * scale); c.lineTo(x0 + w, y0 + 3 * scale); c.stroke();
      arrowHead(c, x0 + w, y0 + 3 * scale, 1, 0, head * 0.8, colour);
      arrowHead(c, x0 - w, y0 + 3 * scale, -1, 0, head * 0.8, colour);
    } else {
      c.strokeStyle = 'rgba(3,4,8,0.85)';
      c.lineWidth = (g.kind === 'rush' ? 3.4 : 2.6) * scale + 4 * scale;
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(ex - (dx / L) * head * 0.5, ey - (dy / L) * head * 0.5); c.stroke();
      c.strokeStyle = colour;
      if (g.kind === 'man' || g.kind === 'press') c.setLineDash([7 * scale, 4.5 * scale]);
      c.lineWidth = (g.kind === 'rush' ? 3.4 : 2.6) * scale;
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(ex - (dx / L) * head * 0.5, ey - (dy / L) * head * 0.5); c.stroke();
      c.setLineDash([]);
      arrowHead(c, ex, ey, dx, dy, head, colour);
      // A press corner jams first: a bar across the tip.
      if (g.kind === 'press') {
        const px2 = -dy / L, py2 = dx / L;
        c.strokeStyle = colour; c.lineWidth = 2.6 * scale;
        c.beginPath();
        c.moveTo(ex + px2 * 8 * scale, ey + py2 * 8 * scale);
        c.lineTo(ex - px2 * 8 * scale, ey - py2 * 8 * scale);
        c.stroke();
      }
    }
    c.restore();
    defenderMark(c, x0, y0, scale, colour);
  }
  return P;
}

export function drawPlay(c, play, side, rect, scale, opts) {
  return side === 'offense'
    ? drawOffense(c, play, rect, scale, opts || {})
    : drawDefense(c, play, rect, scale, opts || {});
}

export default { drawPlay, drawOffense, drawDefense, makeProj };
