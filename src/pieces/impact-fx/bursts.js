// PIECE impact-fx — THE RECIPES. One function per FX kind, each one a pure function of
// (position, direction, power, birth time, seed).
//
// FX_KINDS in foundation/contracts.js is ['hit','truck','catch','cleat'] and makeShot()
// coerces anything else to 'hit'. That matters more than it looks: the play simulation
// emits throw / catch / incomplete / interception / tackle / sack / fumble /
// broken-tackle / scramble / throwaway, and scenes.js passes ev.kind straight into
// makeShot, so EVERY collision event in a live scene arrives here as 'hit'. The kinds
// below are therefore the four *visual* families, and `power` is what separates a
// broken tackle from a leveller inside the 'hit' family.
//
// EMISSION COUNTS AT power = 2.2 (the `leveler` hero shot), counted by instrumenting
// emit() and running the recipe under plain node. The previous version of this table was
// wrong for all four kinds and its derived headroom figures were wrong too; both columns
// below are re-counted, and the harness is a fake batch object with the same fields emit()
// writes, so `head` after one emitBurst IS the quad count.
//
//                         BEFORE round 2      AFTER round 2     the table used to claim
//     hit     glow            174                 112                   161
//             debris          110                 200                    84
//     truck   glow             82                  77                    77
//             debris          130                 224                   111
//     catch   glow             65                  50                    61
//             debris           33                  62                    29
//     cleat   glow             14                  14                    12
//             debris           81                 139                    75
//
// A power-2.2 hit is therefore 312 quads / 624 triangles.
//
// The glow pool holds 1100 and the debris pool 760, so a power-2.2 hit fits 9.8 times
// over in the glow pool and 3.8 times in the debris pool before the ring buffer starts
// eating its own tail. At the clamp (power 3, 151 glow + 273 debris) it is 7.3 and 2.8.
// The old note claimed "six concurrent maximum-power hits"; at the counts it was actually
// written against, the true figures were 6.3 and 6.9. After round 2 the debris pool is
// deliberately the tight one — see the note on POOL_DEBRIS in config.js.

import { makeRng, hash } from '../../foundation/rng.js';
import { emit } from './quads.js';
import {
  CELL, MODE, COL, DIRT, PRIO_CORE,
  SPARK_DRAG, SPARK_GRAV, DEBRIS_DRAG, DEBRIS_GRAV, DUST_DRAG, DUST_GRAV,
} from './config.js';

/* --------------------------------------------------------------- scratch */
// Module-level scratch so a burst allocates nothing. A burst is not on the frame path,
// but it IS on the "the player just landed a hit" path, and that is the frame you least
// want a GC pause on.
const N = new Float32Array(3);
const T1 = new Float32Array(3);
const T2 = new Float32Array(3);
const D = new Float32Array(3);

function basis(dx, dy, dz) {
  let L = Math.hypot(dx, dy, dz);
  if (L < 1e-5) { dx = 0; dy = 1; dz = 0; L = 1; }
  N[0] = dx / L; N[1] = dy / L; N[2] = dz / L;
  // Reference axis chosen away from N so the cross product never degenerates.
  const rx = Math.abs(N[1]) > 0.86 ? 1 : 0;
  const ry = Math.abs(N[1]) > 0.86 ? 0 : 1;
  T1[0] = ry * N[2] - 0 * N[1];
  T1[1] = 0 * N[0] - rx * N[2];
  T1[2] = rx * N[1] - ry * N[0];
  const l1 = Math.hypot(T1[0], T1[1], T1[2]) || 1;
  T1[0] /= l1; T1[1] /= l1; T1[2] /= l1;
  T2[0] = N[1] * T1[2] - N[2] * T1[1];
  T2[1] = N[2] * T1[0] - N[0] * T1[2];
  T2[2] = N[0] * T1[1] - N[1] * T1[0];
}

/**
 * A direction in the burst's frame, written into D.
 *   `along`  push along the impact axis (0 = a flat splash ring, 1 = a cone)
 *   `flat`   vertical squash of the splash plane (< 1 flattens it toward the turf)
 *   `lift`   push along world +Y
 */
function dirIn(rng, along, flat, lift) {
  const th = rng() * Math.PI * 2;
  const ph = (rng() - 0.5) * 2.0;
  const c = Math.cos(ph), s = Math.sin(ph);
  const ct = Math.cos(th), st = Math.sin(th);
  D[0] = (T1[0] * ct + T2[0] * st) * c + N[0] * (s + along);
  D[1] = ((T1[1] * ct + T2[1] * st) * c + N[1] * (s + along)) * flat + lift;
  D[2] = (T1[2] * ct + T2[2] * st) * c + N[2] * (s + along);
  const L = Math.hypot(D[0], D[1], D[2]) || 1;
  D[0] /= L; D[1] /= L; D[2] /= L;
}

function lerp3(out, a, b, t) {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
}
const CTMP = new Float32Array(3);

/* ------------------------------------------------------------------ parts */

/** The four quads that survive every rung, including the floor. See config.prioCut. */
function core(S, x, y, z, t0, p, opts) {
  const g = S.glow;
  const o = opts || {};
  const flashS = o.flash === undefined ? 1 : o.flash;
  if (flashS > 0) {
    // The instant of contact: a starburst that lives 0.17 s and a warm core behind it.
    // SIZES ARE QUAD DIAMETERS IN METRES, and they were still 2.4x too big after the
    // first correction. Projected into the `leveler` frame at 205 px/m the starburst
    // alone was a 1.52 m quad at 3.1 linear — a 311 px white disc before bloom, in a
    // frame whose entire debris field was only 380 px wide. In the bar panel the flash
    // core is about one and a half HELMETS across (0.26 m each) with spikes reaching three
    // or four times that, and it sits behind the bodies rather than in front of them. At
    // power 2.2 these numbers are a 0.38 m core growing to 0.61 m over its 0.17 s life —
    // 78 px at the hero camera, against the 311 px it was.
    emit(g, x, y, z, 0, 0, 0, t0, 0.125 * (0.7 + p * 0.15),
      (0.16 + 0.10 * p) * flashS, (0.26 + 0.16 * p) * flashS,
      COL.flashCore[0], COL.flashCore[1], COL.flashCore[2],
      CELL.STAR, MODE.BILLBOARD, 0, 0, 0.13, 0.9, 0, 2.6, PRIO_CORE);
    emit(g, x, y, z, 0, 0.35, 0, t0, 0.19,
      (0.11 + 0.075 * p) * flashS, (0.24 + 0.17 * p) * flashS,
      COL.flashWarm[0], COL.flashWarm[1], COL.flashWarm[2],
      CELL.GLOW, MODE.BILLBOARD, 2.0, 0, 0.41, 0, 0, 2.1, PRIO_CORE);
  }
  // A pool of warm light thrown down onto the turf, and the ground shockwave riding it.
  // Without the pool the flash floats; with it, the hit is attached to the field.
  emit(g, x, 0.012, z, 0, 0, 0, t0, 0.30,
    0.55 * p, 1.9 * p,
    COL.groundPool[0], COL.groundPool[1], COL.groundPool[2],
    CELL.GLOW, MODE.GROUND, 0, 0, 0, 0, 0, 1.9, PRIO_CORE);
  // The RING sprite's bright annulus sits at 0.82 of the quad radius, so the visible
  // shockwave diameter is 0.82 * this number: 2.9 m at power 2.2.
  emit(g, x, 0.014, z, 0, 0, 0, t0, 0.40,
    0.4, (o.ring === undefined ? 1.6 : o.ring) * p,
    COL.ringHot[0], COL.ringHot[1], COL.ringHot[2],
    CELL.RING, MODE.GROUND, 0, 0, 0, 0, 0, 1.45, PRIO_CORE);
}

function sparks(S, x, y, z, t0, p, n, rng, along, flat, lift, vlo, vhi) {
  const g = S.glow;
  for (let i = 0; i < n; i++) {
    dirIn(rng, along, flat, lift);
    const v = (vlo + rng() * (vhi - vlo)) * (0.62 + 0.38 * p);
    const heat = rng();
    // Hot white-yellow at the head of the population, deep orange at the tail — a real
    // spark shower is not one colour.
    lerp3(CTMP, heat < 0.5 ? COL.sparkHot : COL.sparkMid, heat < 0.5 ? COL.sparkMid : COL.sparkCool,
      heat < 0.5 ? heat * 2 : (heat - 0.5) * 2);
    const s = 0.030 + rng() * 0.038;
    // STRETCH is the sprite length multiplier per m/s of CURRENT speed, and it is a
    // multiplier, which is why 0.15-0.25 turned into needles. At the `leveler` age of
    // 30 ms a power-2.2 spark is still doing 29 m/s, so 0.25 made the sprite 1 + 7.25 =
    // 8.25x its own length: a 0.097 m sprite drawn 0.80 m long, 164 px, and then the
    // 1/55 s shutter smeared another 0.53 m on top of that. Ninety-seven of those
    // radiating from one point IS the firework the critic saw. 0.045-0.080 against the
    // reduced v0 puts the drawn streak at 0.04-0.19 m and lets the shutter do the rest.
    emit(g, x, y, z, D[0] * v, D[1] * v, D[2] * v,
      t0, 0.26 + rng() * 0.38, s, s * 0.35,
      CTMP[0], CTMP[1], CTMP[2],
      CELL.SPARK, MODE.STREAK, SPARK_DRAG, SPARK_GRAV,
      rng(), 0, 0.045 + rng() * 0.035, 1.35,
      0.05 + (i / n) * 0.55);
  }
}

function embers(S, x, y, z, t0, p, n, rng) {
  const g = S.glow;
  for (let i = 0; i < n; i++) {
    dirIn(rng, 0.2, 0.9, 0.55);
    const v = (5 + rng() * 11) * (0.6 + 0.4 * p);
    const s = 0.022 + rng() * 0.036;
    emit(g, x, y, z, D[0] * v, D[1] * v, D[2] * v,
      t0, 0.45 + rng() * 0.6, s, s * 0.5,
      COL.ember[0], COL.ember[1], COL.ember[2],
      CELL.EMBER, MODE.BILLBOARD, 3.2, 5.5, rng(), 0, 0, 1.15,
      0.45 + (i / n) * 0.35);
  }
}

function dust(S, x, y, z, t0, p, n, rng, lift) {
  const g = S.glow;
  for (let i = 0; i < n; i++) {
    dirIn(rng, 0.15, 0.7, lift);
    const v = 1.6 + rng() * 4.2 * p;
    // SMALLER PUFFS, MORE OF THEM. At (0.30 + rng*0.45) * p a single puff was up to
    // 1.65 m across — one sprite covering a third of the frame height, which reads as a
    // flat wash rather than as a billow, and thirteen of them stacked into the white core
    // rather than into a cloud with structure. The dust is doing real work now (the turf
    // chips are legible against it and not against the night sky) so it has to have
    // texture: 26 puffs of 0.29-0.73 m instead of 13 of 0.66-1.65 m.
    const s0 = 0.13 + rng() * 0.20;
    // Dust nearest the flash is lit by it; dust further out is not.
    lerp3(CTMP, COL.dustLit, COL.dust, i / Math.max(1, n - 1));
    emit(g, x, y + 0.05, z, D[0] * v, D[1] * v, D[2] * v,
      t0, 0.55 + rng() * 0.7, s0 * p, (0.36 + rng() * 0.42) * p,
      CTMP[0], CTMP[1], CTMP[2],
      CELL.DUST, MODE.BILLBOARD, DUST_DRAG, DUST_GRAV,
      rng(), (rng() - 0.5) * 1.2, 0, 1.3,
      0.20 + (i / n) * 0.25);
  }
}

function smoke(S, x, y, z, t0, p, n, rng) {
  const g = S.glow;
  for (let i = 0; i < n; i++) {
    dirIn(rng, 0.1, 0.6, 0.8);
    const v = 1.0 + rng() * 2.6;
    emit(g, x, y + 0.12, z, D[0] * v, D[1] * v, D[2] * v,
      t0, 0.9 + rng() * 0.8, (0.22 + rng() * 0.22) * p, (0.55 + rng() * 0.50) * p,
      COL.smoke[0], COL.smoke[1], COL.smoke[2],
      rng() < 0.45 ? CELL.WISP : CELL.SMOKE, MODE.BILLBOARD, 2.4, -0.7,
      rng(), (rng() - 0.5) * 0.8, 0, 1.5,
      0.62 + (i / n) * 0.33);
  }
}

const CLOD_CELLS = [CELL.CLOD_A, CELL.CLOD_B, CELL.CLOD_C, CELL.SPLAT];
const CLOD_TINTS = [DIRT.soil, DIRT.soilDark, DIRT.mud, DIRT.sod];

/**
 * Torn turf. This is the element bar/panel-leveler.png leans on hardest — the frame is
 * full of near-black lumps of ground at every scale, and getting the SIZE SPREAD right
 * mattered more than getting the count right. A uniform size distribution read as
 * gravel; the cubed distribution below gives a few big slabs and a lot of grit.
 */
function clods(S, x, y, z, t0, p, n, rng, along, lift, vlo, vhi) {
  const d = S.debris;
  for (let i = 0; i < n; i++) {
    // ALONG THE HIT, NOT AROUND IT. `along` at 0.30 is a near-isotropic sphere sample, so
    // the shower came out as a radially symmetric dandelion with no impact axis. The bar's
    // leveler panel is a low, DIRECTIONAL, ground-hugging smear. 0.72 keeps the cone about
    // the contact normal while still leaving spread.
    dirIn(rng, Math.max(along, 0.72), 0.85, lift);
    // A DEBRIS FIELD IS SPREAD IN SPACE, NOT IN VELOCITY — and this is the correction
    // that finally made the chips visible, after two rounds of raising v0 did not.
    //
    // The capture path renders `accum` sub-frames spread across the shot's shutter (1/55 s
    // on `leveler`) and averages them. A chip moving at v is therefore drawn as accum
    // ghosts strung over v/55 metres, each at 1/accum of full opacity. At the v0 x 3.4 of
    // the previous round a clod was still doing 45 m/s at 30 ms: 0.82 m of travel inside
    // one shutter, 168 px, spread over 8 ghosts at 12.5% each — against a 7 px chip. The
    // debris was not missing from the frame, it was DIVIDED BY TWENTY-FOUR across it, and
    // that is why raising the count and the speed both failed to show anything.
    //
    // So the field is spread by BIRTH POSITION instead. The ground under a collision does
    // not tear at a point; it tears over the patch the two bodies cover, which is about a
    // metre. Emitting along D at a radius sampled to 0.35 + 0.33p metres puts the field
    // where the panel has it (2.0-2.5 m across, measured off the defender's helmet at
    // 40 px / 0.26 m = 154 px/m) while leaving v0 low enough that a chip is a chip and not
    // a 12%-opacity streak: 2.0-7.5 m/s here, which is 6-24 px of shutter smear.
    //
    // Recorded because it is the trap: "93% of the frame width" in the bar panel is 93% of
    // a 2.66 m crop. Our own `leveler` camera is 7.88 m out on a 37 degree lens and sees
    // 9.38 m, so the SAME field is 93% of one frame and 26% of the other. Metres, always.
    const spread = (0.35 + 0.33 * p) * Math.pow(rng(), 0.55);
    const v = (vlo + rng() * (vhi - vlo)) * (0.65 + 0.35 * p) * 0.35;
    const q = rng();
    // AND IT HAS TO BE TURF, NOT BOULDERS. Measured against panel-leveler.png with the
    // same top-hat operator used on our own captures: the bar's chips have a MEDIAN
    // diameter of 0.019 m and 264 of them are separable in a 2.66 x 2.44 m frame. Ours
    // measured p50 0.061 m over 110 quads (clods 0.037, tufts 0.095). The cube keeps a few
    // real slabs (max 0.104 m, median 0.027 m) and puts everything else in the 0.02-0.04 m
    // grit band the panel is actually made of; over 200 quads that is 0.20 m^2 of sprite
    // against the panel's 0.147 m^2 of measured chip.
    const s = 0.020 + q * q * q * 0.100;
    const c = CLOD_TINTS[hash(i, 3) % 4];
    emit(d, x + D[0] * spread, y + D[1] * spread, z + D[2] * spread,
      D[0] * v, D[1] * v, D[2] * v,
      t0, 1.15 + rng() * 1.0, s, s * 0.9,
      c[0], c[1], c[2],
      CLOD_CELLS[hash(i, 11) % 4], MODE.BILLBOARD, DEBRIS_DRAG, DEBRIS_GRAV,
      rng(), (rng() - 0.5) * 26, 0, 0.55,
      0.12 + (i / n) * 0.50);
  }
}

function tufts(S, x, y, z, t0, p, n, rng, along, lift) {
  const d = S.debris;
  for (let i = 0; i < n; i++) {
    dirIn(rng, along, 0.9, lift);
    // Same spatial spread and the same low v0 as clods(), for the same shutter reason.
    const spread = (0.30 + 0.28 * p) * Math.pow(rng(), 0.55);
    const v = (3 + rng() * 9) * (0.65 + 0.35 * p) * 0.40;
    // Tufts were the LARGEST debris in the frame after the clods were cut (p50 0.095 m
    // against the clods' 0.037 m), which is backwards — a severed clump of grass is
    // smaller than a torn clod of sod, not twice the size.
    const s = 0.022 + rng() * 0.050;
    const sod = rng() < 0.32;
    const c = sod ? DIRT.sod : DIRT.grass;
    emit(d, x + D[0] * spread, y + D[1] * spread, z + D[2] * spread,
      D[0] * v, D[1] * v, D[2] * v,
      t0, 0.7 + rng() * 0.7, s, s * 0.85,
      c[0], c[1], c[2],
      sod ? CELL.SOD : CELL.TUFT, MODE.BILLBOARD, DEBRIS_DRAG * 1.35, DEBRIS_GRAV * 0.8,
      rng(), (rng() - 0.5) * 20, 0, 0.6,
      0.35 + (i / n) * 0.35);
  }
}

/**
 * Anamorphic lens response on the flash. Two bars, crossed, very short.
 *
 * THESE TWO QUADS WERE 41% OF THE ENTIRE ADDITIVE AREA OF A HERO BURST. At 1.7p/2.9p they
 * were 3.74 m growing to 6.38 m — 765 to 1307 px across a 1920 px frame — at a near-white
 * [0.85,0.98,1.45], and a 0.095 s life put them at full size in the 30 ms frame the
 * `leveler` panel is captured at. 13.6 m^2 of the burst's 32.8 m^2 of additive sprite came
 * from here. A lens flare is a RESPONSE to a bright point, not the brightest thing in the
 * frame; sized to roughly twice the flash core and dimmed well below it.
 */
function lensBars(S, x, y, z, t0, p) {
  const g = S.glow;
  emit(g, x, y, z, 0, 0, 0, t0, 0.095, 0.42 * p, 0.72 * p,
    0.30, 0.35, 0.52, CELL.BAR, MODE.BILLBOARD, 0, 0, 0.0, 0, 0, 2.4, 0.03);
  emit(g, x, y, z, 0, 0, 0, t0, 0.075, 0.27 * p, 0.45 * p,
    0.40, 0.31, 0.23, CELL.BAR, MODE.BILLBOARD, 0, 0, 0.125, 0, 0, 2.4, 0.03);
}

/* ------------------------------------------------------------------ kinds */

/**
 * hit — the leveller. bar/panel-leveler.png and bar/panel-midair_hit.png.
 *
 * THE BALANCE, WHICH IS THE WHOLE RECIPE. In the bar panel the dominant FX element by
 * pixel count is a field of small near-black turf chips; the fire is a low directional
 * smear underneath it. Measured with a top-hat chip operator, the panel gives chip
 * coverage 2.263% of frame against hot-pixel coverage 1.268% — chips outweigh fire 1.79
 * to 1. Our own `leveler` capture before this pass gave 0.397% against 3.249%: 0.12 to 1.
 * So the sparks come down (97 -> 57) and go DIRECTIONAL and LOW (`along` 0.30 -> 0.82,
 * `flat` 0.78 -> 0.42, `lift` 0.10 -> 0.0 — 0.30 was a near-isotropic sphere sample, which
 * is exactly what "radially symmetric sunburst" means), and the debris count nearly
 * doubles while each chip gets a third of its old area.
 *
 * THE HONEST CAVEAT ON THAT RATIO. Ours ends at 0.409% against 1.513%, not at the panel's
 * 1.79 to 1, and the arithmetic will not get there in this frame: the panel is a 2.66 m
 * crop and this camera sees 9.38 m, so the same physical debris field is twelve times
 * smaller as a FRACTION of frame area. In metres the field is now 0.202 m^2 of chip
 * against the panel's 0.147 m^2 — MORE torn ground than the reference, in a wider shot —
 * and the fire is down to 0.895% of frame from 2.378% once the stadium lights and the gold
 * callout (0.62%, not this piece's) are excluded. That is the comparison that means
 * something; frame fractions across different focal lengths are not.
 *
 * The ground clods' `lift` also comes down (1.45 -> 1.05). It is not a physics number, it
 * is a legibility one: a near-black chip has no contrast against a night stadium, and the
 * one bright backdrop in this frame that costs nothing is the TURF under the ground light
 * pool. Keeping the bulk of the field below the horizon line puts the chips in front of it.
 */
function hit(S, x, y, z, t0, p, rng) {
  core(S, x, y, z, t0, p, null);
  lensBars(S, x, y, z, t0, p);
  // A second, wider air ring reads as the pressure wave leaving the bodies.
  emit(S.glow, x, y, z, 0, 0, 0, t0, 0.22, 0.28, 1.1 * p,
    COL.ringCool[0], COL.ringCool[1], COL.ringCool[2],
    CELL.RING, MODE.BILLBOARD, 0, 0, 0, 0, 0, 1.6, 0.02);
  sparks(S, x, y, z, t0, p, Math.round(26 * p), rng, 0.82, 0.42, 0.0, 8, 20);
  embers(S, x, y, z, t0, p, Math.round(6 * p), rng);
  dust(S, x, y, z, t0, p, Math.round(12 * p), rng, 0.45);
  smoke(S, x, y, z, t0, p, Math.round(4 * p), rng);
  // TURF COMES FROM THE TURF. My first version spawned every clod at the contact point,
  // which for a chest-height hit meant dirt appearing out of thin air 1.3 m above a
  // field that was visibly undisturbed. bar/panel-leveler.png has the ground ERUPTING
  // under the collision, so most of the debris is launched from just above the surface
  // directly beneath the contact, and only the rest comes off the bodies themselves.
  clods(S, x, 0.10, z, t0, p, Math.round(45 * p), rng, 0.20, 1.05, 4, 15);
  tufts(S, x, 0.08, z, t0, p, Math.round(17 * p), rng, 0.18, 1.00);
  clods(S, x, Math.min(y, 1.3), z, t0, p, Math.round(21 * p), rng, 0.45, 0.55, 3, 11);
  tufts(S, x, Math.min(y, 1.1), z, t0, p, Math.round(8 * p), rng, 0.40, 0.55);
}

/**
 * truck — a runner going THROUGH someone. bar/panel-truck.png.
 * Far less fire than a leveller and far more ground: the debris is thrown forward along
 * the direction of travel in a wake rather than radiating.
 */
function truck(S, x, y, z, t0, p, rng) {
  core(S, x, y, z, t0, p, { flash: 0.62, ring: 2.5 });
  sparks(S, x, y, z, t0, p, Math.round(9 * p), rng, 0.88, 0.40, 0.0, 9, 20);
  dust(S, x, y, z, t0, p, Math.round(16 * p), rng, 0.30);
  smoke(S, x, y, z, t0, p, Math.round(6 * p), rng);
  clods(S, x, 0.10, z, t0, p, Math.round(52 * p), rng, 0.85, 1.05, 4, 14);
  tufts(S, x, 0.08, z, t0, p, Math.round(24 * p), rng, 0.80, 1.00);
  clods(S, x, Math.min(y, 1.1), z, t0, p, Math.round(17 * p), rng, 0.90, 0.45, 3, 12);
  tufts(S, x, Math.min(y, 0.9), z, t0, p, Math.round(9 * p), rng, 0.85, 0.45);
  // The wake: low, wide, ground-hugging dust dragged along behind the runner.
  for (let i = 0; i < 5; i++) {
    const f = i / 4;
    emit(S.glow, x - N[0] * f * 1.5 * p, 0.10 + f * 0.15, z - N[2] * f * 1.5 * p,
      -N[0] * 1.2, 0.5, -N[2] * 1.2,
      t0 + f * 0.02, 0.8 + f * 0.4, 0.30 * p, (0.85 + 0.5 * f) * p,
      COL.dust[0], COL.dust[1], COL.dust[2],
      CELL.SMOKE, MODE.BILLBOARD, 2.2, -0.5, i * 0.19, 0.3, 0, 1.4, 0.30 + f * 0.2);
  }
}

/** catch — the ball arriving in the gloves. bar/panel-catch.png: a bright glove glint. */
function catchFx(S, x, y, z, t0, p, rng) {
  core(S, x, y, z, t0, p * 0.55, { flash: 0.62, ring: 1.2 });
  lensBars(S, x, y, z, t0, p * 0.7);
  sparks(S, x, y, z, t0, p, Math.round(12 * p), rng, 0.55, 0.7, 0.05, 7, 16);
  dust(S, x, y, z, t0, p * 0.6, Math.round(8 * p), rng, 0.5);
  clods(S, x, 0.08, z, t0, p * 0.6, Math.round(19 * p), rng, 0.2, 1.2, 3, 10);
  tufts(S, x, 0.06, z, t0, p * 0.6, Math.round(9 * p), rng, 0.2, 1.2);
}

/** cleat — a plant or a cut. No fire at all, just turf leaving the ground. */
function cleatFx(S, x, y, z, t0, p, rng) {
  emit(S.glow, x, 0.012, z, 0, 0, 0, t0, 0.5, 0.25 * p, 1.5 * p,
    COL.dust[0], COL.dust[1], COL.dust[2],
    CELL.DUST, MODE.GROUND, 0, 0, 0, 0, 0, 1.4, PRIO_CORE);
  dust(S, x, 0.06, z, t0, p * 0.7, Math.round(6 * p), rng, 0.5);
  clods(S, x, 0.05, z, t0, p, Math.round(38 * p), rng, 0.75, 1.0, 3, 11);
  tufts(S, x, 0.05, z, t0, p, Math.round(25 * p), rng, 0.7, 1.0);
}

const KIND = { hit, truck, catch: catchFx, cleat: cleatFx };

/**
 * emitBurst(state, kind, pos[3], dir[3], power, t0, seed)
 *
 * `seed` makes the burst reproducible: the same (seed, kind, quantised position) always
 * produces the same shower. Quantising the position into the seed is what stops two
 * simultaneous hits at different places from being mirror images of each other while
 * still keeping one hit identical across a re-capture.
 */
export function emitBurst(S, kind, px, py, pz, dx, dy, dz, power, t0, seed) {
  const fn = KIND[kind] || hit;
  const p = power > 0.05 ? (power > 3 ? 3 : power) : 0.05;
  basis(dx, dy, dz);
  const rng = makeRng(hash(seed | 0,
    Math.round(px * 64), Math.round(py * 64), Math.round(pz * 64),
    kind.charCodeAt(0), Math.round(power * 32)));
  fn(S, px, py, pz, t0, p, rng);
}

export default { emitBurst };
