// PIECE hud-overlay — INK: exact ink-box typesetting for the scoreboard.
//
// WHY THIS EXISTS. Round 1 set every string with `faces.draw(..., size)` and let
// the face's default tracking through. That is the wrong control surface for a
// scoreboard. A scoreboard cell is a fixed rectangle and the type has to FILL it:
// the bar's `NYC` is 74 x 46 logical and its `22` is 99 x 61, edge to edge in
// cells 96 and 109 wide. Asking for "size 55" and hoping is how you end up with
// "N Y C" floating in air, which is exactly what happened.
//
// So this module works in INK RECTANGLES, not point sizes:
//
//   inkBox()   exact ink extents, computed from the glyph outline data the face
//              already exposes (`faces.data`). No rasterisation, no getImageData,
//              no per-frame cost — the commands are all M/L polygons, so the box
//              is a min/max walk over a few hundred points.
//   inkText()  set `text` so that its INK lands on a given rect, with an explicit
//              horizontal scale applied to the PATH (not to the pen), so the black
//              keyline stays a uniform width instead of turning into an ellipse.
//   inkSet()   the one the scoreboard actually uses: lays a run out INK TO INK
//              with a fixed gap and solves one horizontal scale for the target
//              width, so "NYC" packs instead of letterspacing.
//
// The keyline / halation / fill treatment lives here too, because the bar's
// numerals have a very specific contour: a hard true-black keyline about 5% of the
// ink height, a warm low-alpha halation bloom outside that, and a flat paper-white
// fill with only a slight cool foot. Not a bevel, not a metal ramp.

/* ------------------------------------------------------------------ metrics */

import { mkCanvas } from './chrome.js';

function fontOf(F, face) {
  const d = F && F.data ? F.data[face] : null;
  return d && d.glyphs ? d : null;
}

function glyphOf(f, ch) {
  return f.glyphs[ch] || f.glyphs[ch.toUpperCase()] || f.glyphs[ch.toLowerCase()] || null;
}

/* -------------------------------------------------- the ROUND 2 metric bug
 * Round 1 (and round 2's first pass) took a glyph's ink box straight off the
 * outline's COMMAND POINTS. That is exact only if every command point is on the
 * filled boundary, and in these faces it is not: the glyphs are stroke outlines
 * with mitred joins, and a sharp join emits control points that stick out past
 * the region the nonzero fill actually paints.
 *
 * It is not a rounding error. `blitz-num` '5' has command extremes at y = -88 and
 * y = 828 (916 units tall) where the shape it paints is ~763 units — 20% short. So
 * `sizeForInk(':05', 48)` solved the size against a 916-unit phantom and the clock
 * rendered 42 px of ink where the bar's is 47.9. The abbreviations and the score
 * were right only because 'N', 'Y', 'C' and '2' happen not to have the spike, which
 * is exactly the kind of coincidence that makes a bug look like a style choice.
 *
 * So the ink box is now MEASURED OFF THE RASTER: each glyph is filled once into a
 * scratch canvas and its alpha bounds are read back, in em units, memoised per
 * (face, char). It costs one 224x224 readback per distinct character ever drawn —
 * a bake-time cost paid once, never on the frame path — and it makes every box in
 * this file true. If the canvas cannot be read (no 2D context), it falls back to
 * the command-point box, which is what shipped before.
 */

const EM_CACHE = new Map();
const PROBE = 160;            // px per em while probing
const PROBE_W = 288, PROBE_H = 288;
const PROBE_OX = 48, PROBE_OY = 224;
let probeCv = null, probeCx = null;
let probeOk = true;
const probeCols = new Uint16Array(PROBE_W);
/* horizontal slices used for the optical side profile, in em units */
const NB = 32, BAND_LO = -260, BAND_H = 1300 / 32;

/* ------------------------------------------------------- THE MISSING JOINS
 * ROUND 3. `blitz-num`'s '2', '3' and '5' render as BROKEN glyphs. The defect is
 * in the shared face — reported upward, worked around here — and it is worth
 * writing down exactly, because the repair is derived from it rather than tuned.
 *
 * Every glyph in these faces is a union of pen-swept subpaths (stroker.js). For
 * blitz-num the pen is CIRCULAR (cfg a = b = 75, nib 0), and every terminal is
 * declared `c:['butt','butt']` — see num-digits.js. A butt cap on a circular pen
 * is a contradiction: where two subpaths meet end-to-end the stroker emits no
 * JOIN, so the union is two flat-ended sausages laid against each other and the
 * outside of the turn is left as a sharp empty wedge. The geometric faces avoid
 * this by extending both strokes onto one corner point (`ext: E` in geo-glyphs);
 * the digits never do.
 *
 * MEASURED, by re-running stroker.js's own Catmull-Rom sampler over the authored
 * centrelines (scratch/joints.py) — every number below is derived, not chosen:
 *
 *   '2'  curve tail ends at (112,170) heading (-0.447,-0.895); its butt cap runs
 *        (44.9,203.5) -> (179.1,136.5). The foot bar (w 0.94, ext E both ends) is
 *        x 49.5..416.5, y 5.5..146.5. The cap crosses the bar's TOP at x = 158.7,
 *        so between the cap and the bar top there is an EMPTY WEDGE 109 em wide,
 *        57 em deep, closing at 26.7 degrees. At the score's 62 px ink that wedge
 *        is 12 x 4 px, and a 3.2 px keyline paints all of it: the '2' reads as a
 *        "?" sitting above a detached dash. THIS IS THE TELL.
 *   '5'  stem ends (114,470) heading (-0.040,-0.999); bowl starts (112,484)
 *        heading (0.951,0.311). Left turn, so the outer flank is -x: the stem's
 *        outer cap corner is (39.1,473) and the bowl's is (141.8,415.2), and the
 *        103 em between them is empty. That is the bite out of the '5's waist.
 *   '3'  same shape: C1 ends (224,514), C2 starts (192,508); outer corners
 *        (185.2,578.2) and (187.5,433.1).
 *
 * THE REPAIR IS THE JOIN THE STROKER OWED: for each break, the BEVEL between the
 * two outer cap corners, hinged on the join centre. Three triangles, in em units,
 * authored here. It is not a dilation — it adds ink ONLY inside the wedge, so
 * nothing else about the glyph moves: no counter closes, no inter-digit gap
 * shrinks, no stroke thickens. (Round 3's first pass tried an anisotropic
 * dilation instead — `smear` — which did reconnect the parts but painted a flat
 * band under every horizontal and left the foot bar looking glued on. Measured:
 * darkest pixel inside the '22' body 158/255 against the bar's floor of 220.)
 *
 * A round join (a disc of the pen radius at the join centre) was the other
 * candidate and is wrong here: on the '5' it extends the stem 75 em past its
 * authored end and hangs a bump below the bowl's underside. The bevel closes the
 * same wedge and stays inside the letter.
 */
const JOINTS = {
  'blitz-num': {
    2: [[[44.9, 203.5], [179.1, 136.5], [49.5, 146.5]]],
    3: [[[208, 511], [185.2, 578.2], [187.5, 433.1]]],
    5: [[[113, 477], [39.1, 473], [141.8, 415.2]]],
  },
};

/**
 * The join polygons for one glyph, appended to `sink` in the same frame emit()
 * uses: screen y = -emY*k, screen x = penX + emX*k - screenY*slant.
 * Returns the sink, or null if this glyph needs no repair.
 */
function jointsOf(face, ch, k, slant, penX, sink) {
  const tbl = JOINTS[face];
  const polys = tbl ? tbl[ch] : null;
  if (!polys) return null;
  const p = sink || new Path2D();
  for (let i = 0; i < polys.length; i++) {
    const q = polys[i];
    for (let j = 0; j < q.length; j++) {
      const yy = -q[j][1] * k;
      const xx = penX + q[j][0] * k - yy * slant;
      if (j === 0) p.moveTo(xx, yy); else p.lineTo(xx, yy);
    }
    p.closePath();
  }
  return p;
}
function hasJoints(face, ch) {
  const tbl = JOINTS[face];
  return !!(tbl && tbl[ch]);
}

/** Command-point box of one glyph, in em units, y up-positive. */
function cmdBox(g) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const cm = g.cmds;
  for (let j = 0; j < cm.length; j++) {
    const c = cm[j];
    if (c[0] === 'Z') continue;
    if (c[1] < x0) x0 = c[1];
    if (c[1] > x1) x1 = c[1];
    if (c[2] < y0) y0 = c[2];
    if (c[2] > y1) y1 = c[2];
  }
  return x0 === Infinity ? null : { x0, x1, y0, y1 };
}

/** True filled box of one glyph, in em units, y up-positive. Memoised. */
function emBox(F, f, face, ch) {
  const g = glyphOf(f, ch);
  if (!g || !g.cmds || !g.cmds.length) return null;
  const ck = face + '\u0000' + ch;
  const hit = EM_CACHE.get(ck);
  if (hit !== undefined) return hit;

  let box = cmdBox(g);
  if (probeOk && box) {
    try {
      if (!probeCv) {
        probeCv = mkCanvas(PROBE_W, PROBE_H);
        probeCx = probeCv.getContext('2d', { willReadFrequently: true });
      }
      const c = probeCx;
      const kp = PROBE / (f.unitsPerEm || 1000);
      // Read back only the command-point box, padded. That box is a strict SUPERSET
      // of the filled shape (it is built from control points), so nothing can be
      // outside it — and it turns an 82k-pixel readback per glyph into ~12k.
      const rx = Math.max(0, Math.floor(PROBE_OX + box.x0 * kp) - 2);
      const ry = Math.max(0, Math.floor(PROBE_OY - box.y1 * kp) - 2);
      const rw = Math.min(PROBE_W - rx, Math.ceil((box.x1 - box.x0) * kp) + 5);
      const rh = Math.min(PROBE_H - ry, Math.ceil((box.y1 - box.y0) * kp) + 5);
      if (!(rw > 0 && rh > 0)) throw new Error('probe box');
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(rx, ry, rw, rh);
      c.fillStyle = '#fff';
      c.save();
      c.translate(PROBE_OX, PROBE_OY);
      // probe upright and untracked: the box is a per-glyph property, and slant
      // and tracking are re-applied analytically by inkBox().
      c.fill(F.path(ch, face, PROBE, { tracking: 0, slant: 0 }));
      // ...INCLUDING the join repair, so the box and the side profile describe the
      // shape that is drawn rather than the shape the face hands over.
      const jp = jointsOf(face, ch, PROBE / (f.unitsPerEm || 1000), 0, 0, null);
      if (jp) c.fill(jp);
      c.restore();
      const d = c.getImageData(rx, ry, rw, rh).data;
      // Row/column coverage counts, then a bbox over the rows and columns that
      // carry at least MIN_RUN covered pixels. The erosion matters: a mitred join
      // can throw a one-pixel needle several per-cent of an em past the letter, and
      // a needle 2/160 of an em wide is a fraction of a pixel at any size this
      // scoreboard sets — it must not be what decides the ink height. >= 50%
      // coverage is the geometric edge; a fringe below that is antialias, not ink.
      const MIN_RUN = 2;
      let px0 = Infinity, px1 = -Infinity, py0 = Infinity, py1 = -Infinity;
      const colN = probeCols;
      colN.fill(0);
      for (let sy = 0; sy < rh; sy++) {
        const row = sy * rw * 4;
        let n = 0;
        for (let sx = 0; sx < rw; sx++) {
          if (d[row + sx * 4 + 3] >= 128) { n++; colN[sx]++; }
        }
        if (n >= MIN_RUN) { const y = ry + sy; if (y < py0) py0 = y; if (y > py1) py1 = y; }
      }
      for (let sx = 0; sx < rw; sx++) {
        if (colN[sx] >= MIN_RUN) { const x = rx + sx; if (x < px0) px0 = x; if (x > px1) px1 = x; }
      }
      if (px0 === Infinity || py0 === Infinity) px0 = Infinity;
      if (px0 !== Infinity) {
        // pixel px covers [px, px+1), so the covered span is px0 .. px1+1
        const s = (f.unitsPerEm || 1000) / PROBE;
        // SIDE PROFILE, band by band. A bounding box cannot see that an R's leg
        // kicks out at the foot while its shoulder is 40 units narrower, so butting
        // R's box against B's box leaves a hole at every height except the foot.
        // The profile is the left and right silhouette edge in each of NB horizontal
        // slices, which is what optical spacing actually needs.
        const bl = new Float32Array(NB), br = new Float32Array(NB);
        bl.fill(Infinity); br.fill(-Infinity);
        for (let y = py0; y <= py1; y++) {
          const emY = (PROBE_OY - y - 0.5) * s;
          const bi = Math.floor((emY - BAND_LO) / BAND_H);
          if (bi < 0 || bi >= NB) continue;
          const row = (y - ry) * rw * 4;
          for (let x = px0; x <= px1; x++) {
            if (d[row + (x - rx) * 4 + 3] >= 128) {
              const emL = (x - PROBE_OX) * s, emR = (x + 1 - PROBE_OX) * s;
              if (emL < bl[bi]) bl[bi] = emL;
              if (emR > br[bi]) br[bi] = emR;
            }
          }
        }
        box = {
          bl, br,
          x0: (px0 - PROBE_OX) * s,
          x1: (px1 + 1 - PROBE_OX) * s,
          y0: (PROBE_OY - (py1 + 1)) * s,
          y1: (PROBE_OY - py0) * s,
        };
      }
    } catch (e) { probeOk = false; }
  }
  EM_CACHE.set(ck, box);
  return box;
}

/**
 * Exact ink bounds of `text` at `size`, in the same coordinate frame draw() uses
 * (origin = pen start on the baseline, y up-negative). Slant is applied to the
 * box corners the same way emit() shears the outline.
 */
export function inkBox(F, face, text, size, o) {
  const f = fontOf(F, face);
  const s = String(text === undefined || text === null ? '' : text);
  if (!f) {
    const m = F.measure(s, face, size, o || {});
    return { x0: 0, x1: m.w, y0: -m.ascent, y1: 0, w: m.w, h: m.ascent, adv: m.w };
  }
  const upm = f.unitsPerEm || 1000;
  const k = size / upm;
  const tracking = o && o.tracking !== undefined ? o.tracking : (f.defaultTracking || 0);
  const slant = o && o.slant !== undefined ? o.slant : (f.defaultSlant || 0);
  let x = 0;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const g = glyphOf(f, ch);
    const b = emBox(F, f, face, ch);
    if (b) {
      // screen y is up-negative: yTop = -b.y1*k, yBot = -b.y0*k
      const yt = -b.y1 * k, yb = -b.y0 * k;
      // shear: ax = x + emX*k - yScreen*slant. Take all four corners so a
      // negative slant (a back-lean) boxes correctly too.
      const l = x + b.x0 * k, r = x + b.x1 * k;
      const ax0 = Math.min(l - yt * slant, l - yb * slant);
      const ax1 = Math.max(r - yt * slant, r - yb * slant);
      if (ax0 < x0) x0 = ax0;
      if (ax1 > x1) x1 = ax1;
      if (yt < y0) y0 = yt;
      if (yb > y1) y1 = yb;
    }
    x += (g ? g.adv : upm * 0.42) * k;
    if (f.kern && i < s.length - 1) {
      const kv = f.kern[ch + s[i + 1]];
      if (kv) x += kv * k;
    }
    x += tracking * size;
  }
  if (x0 === Infinity) return { x0: 0, x1: 0, y0: 0, y1: 0, w: 0, h: 0, adv: x };
  return { x0, x1, y0, y1, w: x1 - x0, h: y1 - y0, adv: x };
}

/** Point size that lands `text`'s ink height exactly on `h`. */
export function sizeForInk(F, face, text, h, o) {
  const b = inkBox(F, face, text, 100, o);
  if (!(b.h > 0.001)) return h;
  return (100 * h) / b.h;
}

/* -------------------------------------------------------------------- paths */

let matOk = true;
function scaledPath(p0, xs) {
  if (Math.abs(xs - 1) < 0.002 || !matOk) return null;
  try {
    const p = new Path2D();
    p.addPath(p0, new DOMMatrix([xs, 0, 0, 1, 0, 0]));
    return p;
  } catch (e) { matOk = false; return null; }
}

/* ------------------------------------------------------------------- runs */

/**
 * THE FIX FOR "N Y C".
 *
 * A face lays glyphs out by ADVANCE, and blitz-block's advances carry generous
 * sidebearings — so at the size that makes `NYC` 46 px tall the three letters sit
 * in 77 px with 9 px holes between them, which reads as a thin letterspaced techno
 * readout. The bar sets the same three glyphs 74 px wide with ~3 px between the
 * ink, chunky and packed. Tracking cannot fix that on its own: closing the holes
 * with negative tracking leaves the letters thin, and widening the letters with a
 * scale re-opens the holes.
 *
 * So a run is laid out by INK, not by advance: every glyph's exact ink box is
 * measured, the boxes are butted together with a fixed ink-to-ink gap, and one
 * horizontal scale is solved so the whole run lands on the target width. The
 * result is a single combined Path2D, so the black keyline strokes the run once
 * and never doubles up where two glyphs are close.
 *
 * PACK UPRIGHT, DRAW OBLIQUE (round 2). An oblique glyph's bounding box is a
 * parallelogram's box, which is wider than the letter by slant x ink height — 7.7 px
 * on TURBO. Butting THOSE boxes together with a 3.4 px gap puts 11 px of air between
 * the letters at mid-height, because at any given height each letter sits well inside
 * its own box. That is what made round 2's first pass at TURBO still read "T U R B O"
 * even after the word was cut to the bar's 31 px ink height. So the run packs the
 * UPRIGHT boxes — the real letter widths — and the shear is added back once, at the
 * end, as the run's overhang. `gap` then means what it says: the space you see
 * between two letters at the same height.
 */
export function inkRun(F, face, text, size, gap, xs, o) {
  const s = String(text === undefined || text === null ? '' : text);
  const f = fontOf(F, face);
  const slant = o && o.slant !== undefined ? o.slant : (f ? (f.defaultSlant || 0) : 0);
  const upright = { tracking: 0, slant: 0 };
  const k = f ? size / (f.unitsPerEm || 1000) : 0;
  const items = [];
  let y0 = Infinity, y1 = -Infinity;
  let at = 0, left = 0, right = -Infinity;
  let prevEm = null, prevB = null, prevAt = 0, first = true;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === ' ') { at = (right > -Infinity ? right : at) + size * 0.30; prevEm = null; continue; }
    const b = inkBox(F, face, ch, size, upright);
    if (!(b.w > 0) && !(b.h > 0)) { at += size * 0.30; prevEm = null; continue; }
    const em = f ? emBox(F, f, face, ch) : null;
    if (first) {
      at = -b.x0 * xs;
      left = at + b.x0 * xs;
      first = false;
    } else {
      // Optical advance. Round 2 slid this glyph left until the tightest band
      // ANYWHERE over the full ink height was exactly `gap`. That is the wrong
      // height to measure at. 'T' is the clear case: its crossbar is the widest
      // thing in the glyph and it lives in the top band, so a full-height rule
      // spaces the whole word off the crossbar and leaves a hole beside the STEM,
      // which is where the eye reads the gap. MEASURED on TURBO at the shipped
      // 182 x 32 box, gaps at cap-band height:
      //     T-U 12.67   U-R 2.50   R-B 6.33   B-O 2.33   (spread 173% of mean)
      // — "TUR BO", which is exactly how it read.
      //
      // So the gap is now measured across the CAP BAND (the middle `capBand` of
      // the pair's combined ink height), where the stems are, and the extremities
      // — 'T's crossbar, 'R'/'K'/'A's diagonal foot — are held off by a separate,
      // much smaller CLEARANCE floor so they still cannot collide. Two rules, two
      // jobs: `gap` sets what the eye sees, `clear` stops the ink touching.
      let adv = null;
      if (prevEm && prevEm.br && em && em.bl) {
        // capBand DEFAULTS TO 1 — the full ink height, i.e. the round-2 rule — and
        // is opted into per call, for the same reason the weld is. Making the
        // narrow band the default tightened the yardage run as well, and at
        // `167`'s 3.0 px gap that was enough to push the digits into contact:
        // measured inter-digit gap 2.25 px -> -0.25 px, i.e. touching. Only TURBO
        // has a glyph whose extremities lie about its spacing.
        const yLo = Math.min(prevEm.y0, em.y0), yHi = Math.max(prevEm.y1, em.y1);
        const frac = o && o.capBand !== undefined ? o.capBand : 1;
        const m = (1 - frac) / 2;
        const cLo = yLo + (yHi - yLo) * m, cHi = yHi - (yHi - yLo) * m;
        let worstAll = -Infinity, worstCap = -Infinity;
        for (let bnd = 0; bnd < NB; bnd++) {
          const pr = prevEm.br[bnd], cl = em.bl[bnd];
          if (pr === -Infinity || cl === Infinity) continue;
          const d = (pr - cl) * k;
          if (d > worstAll) worstAll = d;
          const cy = BAND_LO + (bnd + 0.5) * BAND_H;
          if (cy >= cLo && cy <= cHi && d > worstCap) worstCap = d;
        }
        if (worstCap === -Infinity) worstCap = worstAll;
        if (worstAll > -Infinity) {
          const clear = gap * (o && o.clear !== undefined ? o.clear : 1);
          adv = Math.max(worstCap * xs + gap, worstAll * xs + clear);
        }
      }
      if (adv === null) adv = ((prevB ? prevB.x1 : 0) - b.x0) * xs + gap;
      // Floor: never let a pathological pair of profiles collapse one glyph into
      // the previous one. A quarter of the previous glyph's own width is far below
      // anything the art does and far above zero.
      if (prevB) {
        const floor = (prevB.x1 - prevB.x0) * xs * 0.25;
        if (adv < floor) adv = floor;
      }
      at = prevAt + adv;
    }
    const l = at + b.x0 * xs, r = at + b.x1 * xs;
    if (l < left) left = l;
    if (r > right) right = r;
    if (b.y0 < y0) y0 = b.y0;
    if (b.y1 > y1) y1 = b.y1;
    items.push({ ch, b, at });
    prevEm = em; prevB = b; prevAt = at;
  }
  const packed = items.length ? right - left : 0;
  const yy0 = y0 === Infinity ? 0 : y0, yy1 = y1 === -Infinity ? 0 : y1;
  // the oblique overhang: the top of the last glyph leans past its upright box
  const shear = Math.abs(slant) * (yy1 - yy0) * xs;
  // items are anchored so the run's own ink starts at 0
  if (left !== 0) for (let i = 0; i < items.length; i++) items[i].at -= left;
  return { items, w: packed + shear, packed, shear, slant, y0: yy0, y1: yy1, size, xs };
}

/**
 * The run's outlines, plus — as a SECOND path — the join repair.
 *
 * The two are kept apart on purpose. `fill()` is nonzero, so merging a repair
 * polygon into the glyph's own path would subtract its area wherever the two
 * wind opposite; two paths, filled in the same passes, can only ever union.
 */
function runPath(F, face, run, o) {
  const p = new Path2D();
  let q = null;
  const f = fontOf(F, face);
  const k = f ? run.size / (f.unitsPerEm || 1000) : 0;
  const slant = o && o.slant !== undefined ? o.slant : (f ? (f.defaultSlant || 0) : 0);
  for (const it of run.items) {
    const gp = F.path(it.ch, face, run.size, o);
    try {
      const m = new DOMMatrix([run.xs, 0, 0, 1, it.at, 0]);
      p.addPath(gp, m);
      if (f && hasJoints(face, it.ch)) {
        const j = jointsOf(face, it.ch, k, slant, 0, null);
        if (j) { if (!q) q = new Path2D(); q.addPath(j, m); }
      }
    } catch (e) {
      matOk = false;
      return null;
    }
  }
  return { p, q };
}

/* --------------------------------------------------------------- treatment */

/** Halo-only pass: push the shape off-canvas and keep just its shadow. */
function haloPass(c, p, color, blur, alpha, reps) {
  c.save();
  c.globalAlpha = alpha;
  c.shadowColor = color;
  c.shadowBlur = blur;
  c.shadowOffsetX = 6000;
  c.fillStyle = '#000';
  c.translate(-6000, 0);
  for (let i = 0; i < (reps || 1); i++) c.fill(p);
  c.restore();
}

/* ------------------------------------------------------------------ the FUSE
 * A hairline seam can also open where two subpaths are supposed to terminate on
 * exactly the same point (`ext: E` in geo-glyphs) and land a floating-point
 * apart. `fuse` is the belt to the join repair's braces: the SAME path, stroked
 * in the SAME paint with round joins and caps, at a fraction of the ink height.
 * It welds abutting subpaths without moving any edge more than fuse/2, and it is
 * taken out of the requested ink height so the drawn ink still lands exactly on
 * the measured rectangle. 0.015 = 0.9 px at the score's 62 px ink.
 */
const FUSE = 0.015;
function fuseOf(o) {
  const k = o.fuse === undefined ? FUSE : o.fuse;
  return k > 0 ? o.h * k : 0;
}

/**
 * Set `text` so its INK box lands where the caller asked.
 *
 *   o.h        ink height in logical px (REQUIRED — this is the real control)
 *   o.xs       horizontal scale applied to the PATH (1 = natural aspect)
 *   o.w        optional: solve xs so the ink is exactly this wide (overrides o.xs)
 *   o.x, o.y   ink-box anchor; o.align picks which edge o.x refers to
 *   o.keyline  {color, k}  k = fraction of ink height OUTSIDE the glyph
 *   o.fuse     weld stroke as a fraction of ink height (default 0.015; 0 disables)
 *   o.halo     {color, blur, alpha, reps}
 *   o.shadow   {color, blur, dy, alpha}
 *   o.grad     [[t,color],...] vertical across the ink box
 *   o.lit      {top, topH, foot, footH}  silhouette-only top rim / cool foot
 *
 * Returns the ink rect actually drawn.
 */
export function inkText(F, c, text, face, o) {
  const s = String(text === undefined || text === null ? '' : text);
  if (!s.length) return { x: o.x, y: o.y, w: 0, h: 0 };
  const topt = { tracking: o.tracking, slant: o.slant };
  if (o.tracking === undefined) delete topt.tracking;
  if (o.slant === undefined) delete topt.slant;

  const fuse = fuseOf(o);
  // the fuse grows the ink by fuse/2 on all four sides, so it comes out of the
  // requested height and the drawn ink still lands on the measured rectangle.
  const hEff = Math.max(1, o.h - fuse);
  const size = sizeForInk(F, face, s, hEff, topt);
  const b = inkBox(F, face, s, size, topt);
  let xs = o.xs === undefined ? 1 : o.xs;
  if (o.w !== undefined && b.w > 0.01) xs = Math.max(0.05, o.w - fuse) / b.w;
  if (o.maxXs !== undefined && xs > o.maxXs) xs = o.maxXs;
  if (o.minXs !== undefined && xs < o.minXs) xs = o.minXs;

  const inkW = b.w * xs + fuse;
  let ix = o.x;
  if (o.align === 'right') ix = o.x - inkW;
  else if (o.align === 'center') ix = o.x - inkW / 2;

  const p0 = F.path(s, face, size, topt);
  const p = scaledPath(p0, xs) || p0;
  const useCtxScale = p === p0 && Math.abs(xs - 1) >= 0.002;

  // the join repair, laid out along the same advances emit() uses
  let q = null;
  const f0 = fontOf(F, face);
  if (f0) {
    const upm = f0.unitsPerEm || 1000;
    const k = size / upm;
    const tracking = topt.tracking !== undefined ? topt.tracking : (f0.defaultTracking || 0);
    const slant = topt.slant !== undefined ? topt.slant : (f0.defaultSlant || 0);
    let pen = 0;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      const g = glyphOf(f0, ch);
      if (hasJoints(face, ch)) q = jointsOf(face, ch, k, slant, pen, q);
      pen += (g ? g.adv : upm * 0.42) * k;
      if (f0.kern && i < s.length - 1) {
        const kv = f0.kern[ch + s[i + 1]];
        if (kv) pen += kv * k;
      }
      pen += tracking * size;
    }
    if (q && !useCtxScale) q = scaledPath(q, xs) || q;
  }

  c.save();
  c.translate(ix + fuse / 2 - b.x0 * (useCtxScale ? 1 : xs), o.y + fuse / 2 - b.y0);
  if (useCtxScale) c.scale(xs, 1);
  const lw = useCtxScale ? fuse / xs : fuse;
  paint(c, p, q, b.x0 * (useCtxScale ? 1 : xs), b.x1 * (useCtxScale ? 1 : xs), b.y0, b.y1, o, lw);
  c.restore();
  return { x: ix, y: o.y, w: inkW, h: o.h, size, xs };
}

/**
 * The scoreboard setter. Same treatment vocabulary as inkText(), but the run is
 * laid out ink-to-ink with a fixed `gap` and one solved horizontal scale, so the
 * string lands on `o.w` x `o.h` PACKED instead of letterspaced.
 *
 *   o.gap    ink-to-ink gap in logical px (bar: ~3.5 for abbreviations, ~6 for
 *            score numerals, ~4 for the clock)
 */
export function inkSet(F, c, text, face, o) {
  const s = String(text === undefined || text === null ? '' : text);
  if (!s.length) return { x: o.x, y: o.y, w: 0, h: 0 };
  const topt = {};
  if (o.tracking !== undefined) topt.tracking = o.tracking;
  if (o.slant !== undefined) topt.slant = o.slant;
  topt.tracking = 0;                       // a run controls its own spacing
  // inkRun's spacing controls ride on the same options object. `F.path()` reads
  // only tracking/slant and ignores the rest, so one object serves both without
  // allocating a second one per string.
  if (o.capBand !== undefined) topt.capBand = o.capBand;
  if (o.clear !== undefined) topt.clear = o.clear;

  const gap = o.gap === undefined ? 3.5 : o.gap;
  const fuse = fuseOf(o);
  const hEff = Math.max(1, o.h - fuse);
  const size = sizeForInk(F, face, s, hEff, topt);
  const nat1 = inkRun(F, face, s, size, gap, 1, topt);
  const gaps = gap * Math.max(0, nat1.items.length - 1);
  let xs = o.xs === undefined ? 1 : o.xs;
  if (o.w !== undefined && nat1.w - gaps > 0.01) {
    xs = Math.max(0.05, o.w - fuse - gaps) / (nat1.w - gaps);
  }
  if (o.maxXs !== undefined && xs > o.maxXs) xs = o.maxXs;
  if (o.minXs !== undefined && xs < o.minXs) xs = o.minXs;

  const run = inkRun(F, face, s, size, gap, xs, topt);
  const rp = runPath(F, face, run, topt);
  if (!rp) {
    return inkText(F, c, s, face, Object.assign({}, o, { xs, w: undefined }));
  }
  const inkW = run.w + fuse;
  let ix = o.x;
  if (o.align === 'right') ix = o.x - inkW;
  else if (o.align === 'center') ix = o.x - inkW / 2;

  c.save();
  c.translate(ix + fuse / 2, o.y + fuse / 2 - run.y0);
  paint(c, rp.p, rp.q, 0, run.w, run.y0, run.y1, o, fuse);
  c.restore();
  return { x: ix, y: o.y, w: inkW, h: o.h, size, xs };
}

/* ------------------------------------------------------------- the LAYER
 * ONE scratch canvas, shaped like whatever surface is being baked, reused for
 * every string. It exists so the black keyline can be composited UNDERNEATH the
 * ink instead of merely being painted before it. `destination-over` is the only
 * construction that makes "the keyline is outside the letter" a property of the
 * compositor rather than an argument about coverage — and round 2 shipped that
 * argument and was wrong.
 *
 * Bake-time only. Both bakes in this piece are invalidated by state, never by
 * the frame clock, and the frame path never reaches this file.
 */
const TRANSPARENT = 'rgba(0,0,0,0)';
let layCv = null, layCx = null;
function layerFor(c) {
  const dst = c.canvas;
  if (!dst || !(dst.width > 0) || !(dst.height > 0)) return null;
  if (!layCv) {
    layCv = mkCanvas(dst.width, dst.height);
    layCx = layCv.getContext('2d');
  } else if (layCv.width !== dst.width || layCv.height !== dst.height) {
    layCv.width = dst.width; layCv.height = dst.height;
    layCx = layCv.getContext('2d');
  }
  return layCx ? layCv : null;
}

/**
 * Shared passes, in the order the compositor needs them.
 *
 *   1  FILL      the body: `p` and the join repair `q`, in the fill or gradient.
 *   2  FUSE      the SAME two paths, STROKED in the SAME paint, round join and
 *                round cap, at `fuse`. This is what welds abutting subpaths: a
 *                round-joined stroke bridges any hairline where two outlines
 *                are meant to touch and land a rounding error apart.
 *   3  LIT       an optional top rim / cool foot, `source-atop` so it can only
 *                land on the silhouette that already exists. This replaces round
 *                2's `shade` (clip to p, fill p shifted down), which painted a
 *                lit rim along the top of EVERY subpath — including the ones
 *                buried inside the letter. That is what drew a bright hairline
 *                straight across the '2's diagonal where the foot bar passes
 *                under it, and a dark one under that: measured, the darkest
 *                pixel inside the '22' body was 158/255 against the bar's 220.
 *   4  KEYLINE   `destination-over`, stroked at 2*k*h + fuse. Because the body
 *                is already down, the keyline can only reach pixels the body
 *                does not own — i.e. exactly the band OUTSIDE the silhouette.
 *                No coverage argument, no ordering trap: it is not possible for
 *                this pass to darken a pixel inside the letter.
 *   5  SHADOW    `destination-over`, behind the keyline.
 *   6  HALO      `destination-over`, behind that.
 *
 * then one blit of the dirty rect back onto `c`.
 *
 * If the surface cannot give a canvas or a CTM (no `c.canvas`, no
 * `getTransform`), it falls back to painting in place with the keyline first —
 * the round-2 order, which is right for every glyph whose fill is a superset of
 * its keyline and is only unsafe at a broken join, which the join repair has
 * already closed.
 */
function paint(c, p, q, x0, x1, y0, y1, o, fuse) {
  const wd = fuse || 0;
  let M = null, lay = null;
  try { M = c.getTransform(); lay = layerFor(c); } catch (e) { M = null; lay = null; }
  if (!M || !lay) { paintInPlace(c, p, q, y0, y1, o, wd); return; }

  // dirty rect: the ink box, opened by everything that can paint outside it,
  // pushed through the CTM. Keeps the clear and the blit proportional to the
  // string rather than to the surface.
  const pad = wd + (o.keyline ? o.h * o.keyline.k * 2 + 2 : 0)
    + (o.shadow ? o.shadow.blur * 2 + Math.abs(o.shadow.dy || 0) : 0)
    + (o.halo ? o.halo.blur * 2 : 0) + 3;
  const bx0 = x0 - pad, bx1 = x1 + pad, by0 = y0 - pad, by1 = y1 + pad;
  let dx0 = Infinity, dy0 = Infinity, dx1 = -Infinity, dy1 = -Infinity;
  for (let i = 0; i < 4; i++) {
    const ux = i & 1 ? bx1 : bx0, uy = i & 2 ? by1 : by0;
    const vx = M.a * ux + M.c * uy + M.e;
    const vy = M.b * ux + M.d * uy + M.f;
    if (vx < dx0) dx0 = vx; if (vx > dx1) dx1 = vx;
    if (vy < dy0) dy0 = vy; if (vy > dy1) dy1 = vy;
  }
  const rx = Math.max(0, Math.floor(dx0)), ry = Math.max(0, Math.floor(dy0));
  const rw = Math.min(lay.width, Math.ceil(dx1)) - rx;
  const rh = Math.min(lay.height, Math.ceil(dy1)) - ry;
  if (!(rw > 0 && rh > 0)) return;

  const l = layCx;
  l.setTransform(1, 0, 0, 1, 0, 0);
  l.clearRect(rx, ry, rw, rh);
  l.setTransform(M.a, M.b, M.c, M.d, M.e, M.f);
  l.lineJoin = 'round';
  l.lineCap = 'round';
  l.globalAlpha = 1;
  l.globalCompositeOperation = 'source-over';

  /* 1-2 — body, then the fuse stroke in the same paint */
  if (o.grad) {
    const g = l.createLinearGradient(0, y0, 0, y1);
    for (const st of o.grad) g.addColorStop(st[0], st[1]);
    l.fillStyle = g; l.strokeStyle = g;
  } else {
    l.fillStyle = o.fill || '#ffffff';
    l.strokeStyle = o.fill || '#ffffff';
  }
  l.fill(p);
  if (q) l.fill(q);
  if (wd > 0) { l.lineWidth = wd; l.stroke(p); if (q) l.stroke(q); }

  /* 3 — top rim / cool foot, on the silhouette only */
  if (o.lit) {
    const g = l.createLinearGradient(0, y0, 0, y1);
    const topH = o.lit.topH === undefined ? 0.16 : o.lit.topH;
    const footH = o.lit.footH === undefined ? 0.34 : o.lit.footH;
    if (o.lit.top) { g.addColorStop(0, o.lit.top); g.addColorStop(topH, TRANSPARENT); }
    else g.addColorStop(0, TRANSPARENT);
    g.addColorStop(Math.max(topH, 1 - footH), TRANSPARENT);
    g.addColorStop(1, o.lit.foot || TRANSPARENT);
    l.globalCompositeOperation = 'source-atop';
    l.fillStyle = g;
    l.fillRect(x0 - 2, y0, (x1 - x0) + 4, y1 - y0);
  }

  /* 4 — the keyline, UNDER everything above */
  l.globalCompositeOperation = 'destination-over';
  if (o.keyline) {
    l.lineWidth = o.h * o.keyline.k * 2 + wd;
    l.strokeStyle = o.keyline.color;
    l.stroke(p);
    if (q) l.stroke(q);
  }

  /* 5-6 — shadow, then halation, each behind what is already there */
  if (o.shadow) {
    l.save();
    l.globalAlpha = o.shadow.alpha === undefined ? 1 : o.shadow.alpha;
    l.shadowColor = o.shadow.color;
    l.shadowBlur = o.shadow.blur;
    l.shadowOffsetX = 6000;
    l.shadowOffsetY = o.shadow.dy || 0;
    l.fillStyle = '#000';
    l.translate(-6000, 0);
    l.fill(p);
    if (q) l.fill(q);
    l.restore();
  }
  if (o.halo) {
    l.save();
    l.globalAlpha = o.halo.alpha === undefined ? 1 : o.halo.alpha;
    l.shadowColor = o.halo.color;
    l.shadowBlur = o.halo.blur;
    l.shadowOffsetX = 6000;
    l.fillStyle = '#000';
    l.translate(-6000, 0);
    for (let i = 0; i < (o.halo.reps || 1); i++) l.fill(p);
    l.restore();
  }
  l.globalCompositeOperation = 'source-over';
  l.setTransform(1, 0, 0, 1, 0, 0);

  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'source-over';
  c.drawImage(layCv, rx, ry, rw, rh, rx, ry, rw, rh);
  c.restore();
}

/** Fallback for a surface with no readable canvas or CTM. Keyline first. */
function paintInPlace(c, p, q, y0, y1, o, wd) {
  c.save();
  c.lineJoin = 'round';
  c.lineCap = 'round';
  if (o.halo) {
    haloPass(c, p, o.halo.color, o.halo.blur, o.halo.alpha === undefined ? 1 : o.halo.alpha, o.halo.reps);
  }
  if (o.shadow) {
    c.save();
    c.globalAlpha = o.shadow.alpha === undefined ? 1 : o.shadow.alpha;
    c.shadowColor = o.shadow.color;
    c.shadowBlur = o.shadow.blur;
    c.shadowOffsetX = 6000;
    c.shadowOffsetY = o.shadow.dy || 0;
    c.fillStyle = '#000';
    c.translate(-6000, 0);
    c.fill(p);
    if (q) c.fill(q);
    c.restore();
  }
  if (o.keyline) {
    c.lineWidth = o.h * o.keyline.k * 2 + wd;
    c.strokeStyle = o.keyline.color;
    c.stroke(p);
    if (q) c.stroke(q);
  }
  if (o.grad) {
    const g = c.createLinearGradient(0, y0, 0, y1);
    for (const st of o.grad) g.addColorStop(st[0], st[1]);
    c.fillStyle = g; c.strokeStyle = g;
  } else {
    c.fillStyle = o.fill || '#ffffff';
    c.strokeStyle = o.fill || '#ffffff';
  }
  c.fill(p);
  if (q) c.fill(q);
  if (wd > 0) { c.lineWidth = wd; c.stroke(p); if (q) c.stroke(q); }
  c.restore();
}

export default { inkBox, sizeForInk, inkText, inkSet, inkRun };
