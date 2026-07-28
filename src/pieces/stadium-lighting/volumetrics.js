// PIECE stadium-lighting — the atmosphere: flares, haze, rain and the shafts.
//
// THE SHAFTS ARE THE POINT. They are the single most distinctive feature of the bar
// art and the single most expensive thing you can do on a phone, so they are built as
// cylindrically-billboarded ribbons — one quad per beam, thirty beams, ONE draw call,
// sixty triangles — with all the volume happening in the fragment shader. A raymarched
// screen-space pass would be prettier on this box and unshippable on the target one.
//
// Occlusion is analytic rather than depth-buffer based: each actor contributes a
// capsule swept ALONG THE BEAM AXIS, so a body standing in a beam carves a real
// cylinder of darkness downstream of itself. That needs no depth texture, no extra
// render target and no second pass, and it survives the rung ladder untouched.

import * as THREE from 'three';
import { hash01 } from '../../foundation/rng.js';
import { PAL } from './config.js';
import { makeSpriteBuf, push, toGeometry, GRP } from './spritebuf.js';

/* --------------------------------------------------- flares + haze: ONE mesh */

/**
 * Flare cores. Deliberately layered the way a real anamorphic lens flares: a blown
 * core, a sodium halo, a cool horizontal streak and a faint iris star. There is no
 * bloom pass in this project's post chain yet, so this IS the bloom, and it is
 * authored geometry rather than a filter — which means it survives to the floor tier
 * and it never costs a render target.
 */
function addFlares(buf, towers, capture) {
  const H = PAL.lightHalo, S = PAL.streak, C = PAL.lightCore;
  for (let i = 0; i < towers.length; i++) {
    const t = towers[i];
    const p = t.power;
    const j = hash01(i, 5, 401);
    const j2 = hash01(i, 6, 401);

    // SIZES ARE THE BUDGET HERE, twice over. A 30 m streak at 90 m covers a sixth of
    // the frame, and thirty of them is fifteen screens of additive overdraw — which
    // both costs fill and, worse, lifts every black in the image into milk. The bar's
    // flares are SMALL and INTENSE. So is this.

    // the core: tiny, very hot — the only thing in the frame allowed to blow
    push(buf, t.x, t.y, t.z, 6.6 + j * 1.7, 4.7 + j * 1.2,
      [C[0] * p * 4.60, C[1] * p * 4.45, C[2] * p * 4.10], 'flare', 0, 0, 0, 0);
    // the sodium halo around it
    push(buf, t.x, t.y, t.z, 17.0 + j2 * 4.6, 11.0 + j2 * 3.2,
      [H[0] * p * 0.52, H[1] * p * 0.46, H[2] * p * 0.35], 'flare', 0, 0, 0, 0);
    // the anamorphic streak — horizontal in SCREEN space, so it rolls with the camera
    push(buf, t.x, t.y, t.z, 21.0 + j * 6.0, 1.7 + j2 * 0.6,
      [S[0] * p * 0.34, S[1] * p * 0.37, S[2] * p * 0.43], 'streak', 0, 0, 0, 0);
    if (i % 3 === 1) {
      push(buf, t.x, t.y, t.z, 10.5 + j2 * 3.0, 10.5 + j2 * 3.0,
        [C[0] * p * 0.20, C[1] * p * 0.17, C[2] * p * 0.13], 'star', 0, 0, 0,
        (j - 0.5) * 0.5);
    }
    void capture;
  }
}

/* -------------------------------------------------------------------- haze */

/**
 * The haze layer, in three registers:
 *   1. a warm billow wrapped around each light bank — light scattering out of the
 *      luminaire, which is what actually sells "there is air in this stadium";
 *   2. a mid-height drift over the field, cooling as it leaves the rig;
 *   3. low ground steam clinging to the turf on the far side.
 * All of it is fBm-torn (see textures.js) — never a clean radial gradient, because a
 * clean gradient at panel scale is the fastest way to be spotted.
 */
function addHaze(buf, towers, capture, rng) {
  const W = PAL.hazeWarm, K = PAL.hazeCool;

  // 1. light scattering out of each luminaire — small, warm, hugging the rig
  for (let i = 0; i < towers.length; i++) {
    const t = towers[i];
    const p = t.power;
    const j = hash01(i, 11, 907);
    push(buf, t.x + (j - 0.5) * 3.0, t.y - 1.9 - j * 1.2, t.z,
      17.0 + j * 6.0, 9.5 + j * 3.5,
      [W[0] * p * 0.100, W[1] * p * 0.086, W[2] * p * 0.066],
      (i % 2) ? 'puffA' : 'puffB', 0, 0, 0, (j - 0.5) * 1.6);
  }

  // 2. mid-air drift. Kept BEHIND the action (z < 2) and ABOVE head height, because
  //    a haze card between the camera and the subject is a grey veil over the whole
  //    frame — which is exactly what the first pass produced.
  const drift = capture ? 10 : 6;
  for (let i = 0; i < drift; i++) {
    const x = (rng() - 0.5) * 108;
    const z = 2 - rng() * 52;
    const y = 5.5 + rng() * 9.0;
    const k = Math.min(1, y / 14);
    const s = 0.0225 * (0.55 + rng() * 0.9);
    push(buf, x, y, z, 22 + rng() * 16, 9 + rng() * 6,
      [(W[0] * (1 - k) + K[0] * k) * s, (W[1] * (1 - k) + K[1] * k) * s, (W[2] * (1 - k) + K[2] * k) * s],
      (i % 2) ? 'puffB' : 'puffA', 0, 0, 0, (rng() - 0.5) * 2.2);
  }

  // 3. ground steam on the far half only
  const steam = capture ? 9 : 5;
  for (let i = 0; i < steam; i++) {
    const x = (rng() - 0.5) * 92;
    const z = -14 - rng() * 30;
    push(buf, x, 0.85 + rng() * 0.9, z, 18 + rng() * 12, 3.4 + rng() * 2.0,
      [K[0] * 0.030, K[1] * 0.032, K[2] * 0.038],
      (i % 2) ? 'puffA' : 'puffB', 0, 0, 0, (rng() - 0.5) * 0.7);
  }
}

/** The whole always-on additive layer, merged: ONE geometry, ONE draw call. */
export function buildAtmos(towers, capture, rng) {
  const buf = makeSpriteBuf(GRP.atmos);
  addFlares(buf, towers, capture);
  addHaze(buf, towers, capture, rng);
  return toGeometry(buf, 'sl.atmos');
}

/* -------------------------------------------------------------------- rain */

/**
 * Rain, entirely in the vertex shader: each streak's fall and wind sway is a pure
 * function of `uT` and its own phase, so it costs zero CPU, allocates nothing per
 * frame, and reproduces byte-for-byte at any `t`.
 */
export function buildRain(capture, rng) {
  const buf = makeSpriteBuf(GRP.rain);
  // MANY, SHORT, FAINT AND LEANING. The first pass drew 560 long bright vertical
  // streaks and they read as scratches on the lens, not as rain. Real rain at a
  // 1/60 s shutter is a dense field of short dim strokes all leaning the same way.
  const n = capture ? 1150 : 420;
  const SPAN = 26.0;
  for (let i = 0; i < n; i++) {
    const x = (rng() - 0.5) * 80;
    const z = -32 + rng() * 58;
    const y = 25.0;
    const len = 0.62 + rng() * 0.85;
    const spd = 15.0 + rng() * 11.0;
    const b = 0.16 + rng() * 0.30;
    push(buf, x, y, z, 0.042 + rng() * 0.022, len,
      [PAL.rain[0] * b, PAL.rain[1] * b, PAL.rain[2] * b],
      'rain', 1, rng(), spd, SPAN, null, -0.185 + (rng() - 0.5) * 0.055);
  }
  return toGeometry(buf, 'sl.rain');
}

/* ------------------------------------------------------------------ shafts */

/**
 * One ribbon per light bank, aimed across the field. The apparent brightness falls
 * off hard along the beam, so what you see is a bright cone hanging under each bank
 * and dissolving before it reaches the turf — which is exactly how a god-ray reads in
 * a photograph, and exactly what the bar art shows.
 */
export function buildShafts(towers, capture) {
  const pos = [], nrm = [], quad = [], shaft = [], idx = [];
  let n = 0;
  // EVERY OTHER BANK. Thirty beams crossing the field summed into a fog blanket that
  // lifted every black in the frame — the exact opposite of the bar's value structure.
  // A real god-ray is a short bright cone hanging under its luminaire that dissolves
  // long before it reaches the ground; fifteen of those read as a rig, thirty
  // full-length ones read as weather.
  for (let i = 0; i < towers.length; i += 2) {
    const t = towers[i];
    const h1 = hash01(i, 21, 613);
    const h2 = hash01(i, 22, 613);
    const h3 = hash01(i, 23, 613);
    const hero = (i % 6) === 2;

    const sx = t.x, sy = t.y - 0.55, sz = t.z;
    // AIM STEEPLY DOWN AND INWARD, not across the bowl. A beam aimed at the far side
    // travels almost along the view ray, and a cylindrical billboard seen end-on has
    // no ribbon to show — the `facing` term correctly kills it and the whole shaft
    // system rendered as nothing. Real god-rays in the bar art descend; so do these.
    // THE BEAM HAS TO CLEAR THE SEATING RAKE. The bowl's rake runs from r=29.5,y=20.3
    // down to r=14.1,y=9.35 — a slope of 0.71 y per metre of inward reach. A luminaire
    // at r=30.8,y=22 aiming at its OWN side of the field descends at exactly that
    // slope and spends its whole length buried inside the upper deck, which is why a
    // steep beam rendered as a 20-pixel wedge and nothing else. A real bank throws
    // 55-95 m ACROSS the bowl at about 17 degrees below horizontal; that clears the
    // rake by a wide margin and it is the only aim that is actually visible from a
    // sideline camera standing on the grass.
    const reach = 56 + h1 * 40;
    const ax = t.x + t.inX * reach + (h2 - 0.5) * 16;
    const az = t.z + t.inZ * reach + (h3 - 0.5) * 12;
    const ay = 0.40;
    let dx = ax - sx, dy = ay - sy, dz = az - sz;
    const L = Math.hypot(dx, dy, dz) || 1;
    dx /= L; dy /= L; dz /= L;
    const len = L * (hero ? 0.96 : 0.80);
    const ex = sx + dx * len, ey = sy + dy * len, ez = sz + dz * len;

    const w0 = 2.2 + h3 * 1.2;
    const w1 = (9.0 + h1 * 4.5) * (hero ? 1.30 : 1.0);
    const power = t.power * (hero ? 1.00 : 0.22 + h2 * 0.20) * (capture ? 1.0 : 0.9);

    const base = n * 4;
    const Q = [[0, -1], [1, -1], [1, 1], [0, 1]];
    for (let k = 0; k < 4; k++) {
      pos.push(sx, sy, sz);
      nrm.push(ex, ey, ez);
      quad.push(Q[k][0], Q[k][1]);
      shaft.push(w0, w1, power, i * 0.137);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    n++;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aQuad', new THREE.Float32BufferAttribute(quad, 2));
  g.setAttribute('aShaft', new THREE.Float32BufferAttribute(shaft, 4));
  g.setIndex(idx);
  g.name = 'sl.shafts';
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 12, 0), 220);
  return g;
}

/* ------------------------------------------------------------------- veil */

/** One quad. The lightning flash, and nothing else — a permanent veil would lift the
 *  blacks, and near-black midtones are the whole value structure. */
export function buildVeil() {
  const buf = makeSpriteBuf(GRP.veil);
  push(buf, 0, 0, 0, 1, 1, [1.0, 0.97, 1.0], 'disc', 0, 0, 0, 0);
  const g = toGeometry(buf, 'sl.veil');
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 60);
  return g;
}

export default { buildAtmos, buildRain, buildShafts, buildVeil };
