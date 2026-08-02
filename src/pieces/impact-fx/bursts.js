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
// emit() and running the recipe under plain node:
//     hit    161 glow +  84 debris = 245 quads   (490 triangles)
//     truck   77 glow + 111 debris = 188
//     catch   61 glow +  29 debris =  90
//     cleat   12 glow +  75 debris =  87
// The glow pool holds 1100 and the debris pool 760, so six concurrent maximum-power hits
// fit before the ring buffer starts eating its own tail — and a hit is only 0.9 s long,
// so six at once is already an unreasonable amount of football.

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
    // SIZES ARE QUAD DIAMETERS IN METRES and the first pass got them badly wrong — a
    // 5 m starburst and an 8 m shockwave, which at the hero shots' 7-9 m camera distance
    // filled the frame with orange and buried the actors. Halved after looking at the
    // first capture: in bar/panel-leveler.png the flash core is roughly one player's
    // shoulder width across, with thin spikes reaching maybe three times that.
    emit(g, x, y, z, 0, 0, 0, t0, 0.125 * (0.7 + p * 0.15),
      (0.60 + 0.42 * p) * flashS, (1.00 + 0.62 * p) * flashS,
      COL.flashCore[0], COL.flashCore[1], COL.flashCore[2],
      CELL.STAR, MODE.BILLBOARD, 0, 0, 0.13, 0.9, 0, 2.6, PRIO_CORE);
    emit(g, x, y, z, 0, 0.35, 0, t0, 0.19,
      (0.30 + 0.20 * p) * flashS, (0.70 + 0.50 * p) * flashS,
      COL.flashWarm[0], COL.flashWarm[1], COL.flashWarm[2],
      CELL.GLOW, MODE.BILLBOARD, 2.0, 0, 0.41, 0, 0, 2.1, PRIO_CORE);
  }
  // A pool of warm light thrown down onto the turf, and the ground shockwave riding it.
  // Without the pool the flash floats; with it, the hit is attached to the field.
  emit(g, x, 0.012, z, 0, 0, 0, t0, 0.30,
    0.9 * p, 3.2 * p,
    COL.groundPool[0], COL.groundPool[1], COL.groundPool[2],
    CELL.GLOW, MODE.GROUND, 0, 0, 0, 0, 0, 1.9, PRIO_CORE);
  // The RING sprite's bright annulus sits at 0.82 of the quad radius, so the visible
  // shockwave diameter is 0.82 * this number: 4.0 m at power 2.2.
  emit(g, x, 0.014, z, 0, 0, 0, t0, 0.40,
    0.5, (o.ring === undefined ? 2.2 : o.ring) * p,
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
    const s = 0.042 + rng() * 0.055;
    // STRETCH is the sprite length multiplier per m/s of current speed, and 0.05 was far
    // too timid: at 18 m/s (a spark 85 ms after a power-2.2 hit) it gave a 15 cm dash,
    // ~24 px at the hero camera distance. In bar/panel-leveler.png the spark trails are
    // nearer an eighth of the frame width. 0.15-0.25 puts them at 30-45 cm before the
    // shutter's own motion blur (which at 1/55 s adds another ~30 cm) is applied.
    emit(g, x, y, z, D[0] * v, D[1] * v, D[2] * v,
      t0, 0.26 + rng() * 0.38, s, s * 0.35,
      CTMP[0], CTMP[1], CTMP[2],
      CELL.SPARK, MODE.STREAK, SPARK_DRAG, SPARK_GRAV,
      rng(), 0, 0.150 + rng() * 0.100, 1.35,
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
    const s0 = 0.30 + rng() * 0.45;
    // Dust nearest the flash is lit by it; dust further out is not.
    lerp3(CTMP, COL.dustLit, COL.dust, i / Math.max(1, n - 1));
    emit(g, x, y + 0.05, z, D[0] * v, D[1] * v, D[2] * v,
      t0, 0.55 + rng() * 0.7, s0 * p, (0.85 + rng() * 0.95) * p,
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
      t0, 0.9 + rng() * 0.8, (0.4 + rng() * 0.4) * p, (1.05 + rng() * 0.95) * p,
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
    // AND IT HAS TO TRAVEL. Measured against the panel, scaled off the defender's helmet:
    // the bar's debris field spans ~93% of the frame width and rises above the helmet;
    // ours spanned 13%, because at the age the hero shots hand this piece (0.03-0.06 s)
    // clods launched at 5.7-21 m/s against drag 4.5 have gone 0.16-0.60 m and no further.
    // config.js already records that spark v0 was raised for exactly this reason and that
    // the same correction was never applied to the debris. This is that correction.
    const v = (vlo + rng() * (vhi - vlo)) * (0.65 + 0.35 * p) * 3.4;
    const q = rng();
    // AND IT HAS TO BE TURF, NOT BOULDERS. Measured p50 0.109 m / p90 0.364 m / max 0.460 m
    // against a bar whose typical chip is 0.03-0.07 m and whose largest slab is ~0.14 m --
    // three times too big, which is the other half of why the debris read as a smudge
    // rather than as a field: a few big soft billboards instead of many small hard ones.
    const s = 0.022 + q * q * q * 0.12;
    const c = CLOD_TINTS[hash(i, 3) % 4];
    emit(d, x, y, z, D[0] * v, D[1] * v, D[2] * v,
      t0, 0.85 + rng() * 0.9, s, s * 0.9,
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
    const v = (3 + rng() * 9) * (0.65 + 0.35 * p);
    const s = 0.045 + rng() * 0.10;
    const sod = rng() < 0.32;
    const c = sod ? DIRT.sod : DIRT.grass;
    emit(d, x, y, z, D[0] * v, D[1] * v, D[2] * v,
      t0, 0.7 + rng() * 0.7, s, s * 0.85,
      c[0], c[1], c[2],
      sod ? CELL.SOD : CELL.TUFT, MODE.BILLBOARD, DEBRIS_DRAG * 1.35, DEBRIS_GRAV * 0.8,
      rng(), (rng() - 0.5) * 20, 0, 0.6,
      0.35 + (i / n) * 0.35);
  }
}

/** Anamorphic lens response on the flash. Two bars, crossed, very short. */
function lensBars(S, x, y, z, t0, p) {
  const g = S.glow;
  emit(g, x, y, z, 0, 0, 0, t0, 0.095, 1.7 * p, 2.9 * p,
    0.85, 0.98, 1.45, CELL.BAR, MODE.BILLBOARD, 0, 0, 0.0, 0, 0, 2.4, 0.03);
  emit(g, x, y, z, 0, 0, 0, t0, 0.075, 1.1 * p, 1.8 * p,
    1.10, 0.86, 0.62, CELL.BAR, MODE.BILLBOARD, 0, 0, 0.125, 0, 0, 2.4, 0.03);
}

/* ------------------------------------------------------------------ kinds */

/**
 * hit — the leveller. bar/panel-leveler.png and bar/panel-midair_hit.png.
 * A near-spherical shower of sparks flattened toward the turf, a full skirt of torn
 * ground, warm dust hanging in the flash, and a ground shockwave under it all.
 */
function hit(S, x, y, z, t0, p, rng) {
  core(S, x, y, z, t0, p, null);
  lensBars(S, x, y, z, t0, p);
  // A second, wider air ring reads as the pressure wave leaving the bodies.
  emit(S.glow, x, y, z, 0, 0, 0, t0, 0.22, 0.35, 1.5 * p,
    COL.ringCool[0], COL.ringCool[1], COL.ringCool[2],
    CELL.RING, MODE.BILLBOARD, 0, 0, 0, 0, 0, 1.6, 0.02);
  sparks(S, x, y, z, t0, p, Math.round(52 * p), rng, 0.30, 0.78, 0.10, 9, 27);
  embers(S, x, y, z, t0, p, Math.round(15 * p), rng);
  dust(S, x, y, z, t0, p, Math.round(6 * p), rng, 0.45);
  smoke(S, x, y, z, t0, p, Math.round(3 * p), rng);
  // TURF COMES FROM THE TURF. My first version spawned every clod at the contact point,
  // which for a chest-height hit meant dirt appearing out of thin air 1.3 m above a
  // field that was visibly undisturbed. bar/panel-leveler.png has the ground ERUPTING
  // under the collision, so most of the debris is launched from just above the surface
  // directly beneath the contact, and only the rest comes off the bodies themselves.
  clods(S, x, 0.10, z, t0, p, Math.round(23 * p), rng, 0.20, 1.45, 4, 15);
  tufts(S, x, 0.08, z, t0, p, Math.round(11 * p), rng, 0.18, 1.35);
  clods(S, x, Math.min(y, 1.3), z, t0, p, Math.round(12 * p), rng, 0.45, 0.55, 3, 11);
  tufts(S, x, Math.min(y, 1.1), z, t0, p, Math.round(4 * p), rng, 0.40, 0.55);
}

/**
 * truck — a runner going THROUGH someone. bar/panel-truck.png.
 * Far less fire than a leveller and far more ground: the debris is thrown forward along
 * the direction of travel in a wake rather than radiating.
 */
function truck(S, x, y, z, t0, p, rng) {
  core(S, x, y, z, t0, p, { flash: 0.62, ring: 3.4 });
  sparks(S, x, y, z, t0, p, Math.round(18 * p), rng, 0.75, 0.72, 0.05, 10, 24);
  dust(S, x, y, z, t0, p, Math.round(10 * p), rng, 0.30);
  smoke(S, x, y, z, t0, p, Math.round(5 * p), rng);
  clods(S, x, 0.10, z, t0, p, Math.round(30 * p), rng, 0.85, 1.05, 4, 14);
  tufts(S, x, 0.08, z, t0, p, Math.round(15 * p), rng, 0.80, 1.00);
  clods(S, x, Math.min(y, 1.1), z, t0, p, Math.round(10 * p), rng, 0.90, 0.45, 3, 12);
  tufts(S, x, Math.min(y, 0.9), z, t0, p, Math.round(4 * p), rng, 0.85, 0.45);
  // The wake: low, wide, ground-hugging dust dragged along behind the runner.
  for (let i = 0; i < 5; i++) {
    const f = i / 4;
    emit(S.glow, x - N[0] * f * 1.5 * p, 0.10 + f * 0.15, z - N[2] * f * 1.5 * p,
      -N[0] * 1.2, 0.5, -N[2] * 1.2,
      t0 + f * 0.02, 0.8 + f * 0.4, 0.5 * p, (1.6 + f) * p,
      COL.dust[0], COL.dust[1], COL.dust[2],
      CELL.SMOKE, MODE.BILLBOARD, 2.2, -0.5, i * 0.19, 0.3, 0, 1.4, 0.30 + f * 0.2);
  }
}

/** catch — the ball arriving in the gloves. bar/panel-catch.png: a bright glove glint. */
function catchFx(S, x, y, z, t0, p, rng) {
  core(S, x, y, z, t0, p * 0.55, { flash: 0.62, ring: 1.6 });
  lensBars(S, x, y, z, t0, p * 0.7);
  sparks(S, x, y, z, t0, p, Math.round(22 * p), rng, 0.25, 0.9, 0.15, 7, 19);
  dust(S, x, y, z, t0, p * 0.6, Math.round(5 * p), rng, 0.5);
  clods(S, x, 0.08, z, t0, p * 0.6, Math.round(10 * p), rng, 0.2, 1.2, 3, 10);
  tufts(S, x, 0.06, z, t0, p * 0.6, Math.round(5 * p), rng, 0.2, 1.2);
}

/** cleat — a plant or a cut. No fire at all, just turf leaving the ground. */
function cleatFx(S, x, y, z, t0, p, rng) {
  emit(S.glow, x, 0.012, z, 0, 0, 0, t0, 0.5, 0.25 * p, 1.5 * p,
    COL.dust[0], COL.dust[1], COL.dust[2],
    CELL.DUST, MODE.GROUND, 0, 0, 0, 0, 0, 1.4, PRIO_CORE);
  dust(S, x, 0.06, z, t0, p * 0.7, Math.round(6 * p), rng, 0.5);
  clods(S, x, 0.05, z, t0, p, Math.round(22 * p), rng, 0.75, 1.0, 3, 11);
  tufts(S, x, 0.05, z, t0, p, Math.round(15 * p), rng, 0.7, 1.0);
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
