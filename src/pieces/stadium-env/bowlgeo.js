// PIECE stadium-env — the lofted bowl.
//
// ONE plan curve (an arc-length-resampled superellipse) swept along ONE profile
// polyline. Every band of the stadium is a strip of that loft, so the whole bowl is
// two BufferGeometries (crowd / structure), two draw calls, and its silhouette is
// guaranteed continuous — no seams between decks, ever.
//
// Arc-length resampling matters twice: seat pitch stays constant all the way round
// (a theta-sampled squircle bunches its samples at the corners and the crowd would
// visibly compress in the end zones), and the aisles stay RADIAL, which is what a
// real bowl looks like and what lets one tiling section texture serve the whole ring.

import { hash01 } from '../../foundation/rng.js';
import { BOWL } from './config.js';

/* ------------------------------------------------------------- plan curve */

function superellipse(t, A, B, p) {
  const th = t * Math.PI * 2;
  const c = Math.cos(th), s = Math.sin(th);
  const e = 2 / p;
  const x = A * Math.sign(c) * Math.pow(Math.abs(c), e);
  const z = B * Math.sign(s) * Math.pow(Math.abs(s), e);
  return [x, z];
}

/**
 * buildLoop(n) -> { x, z, nx, nz, s } typed arrays of length n+1 (closed, last == first),
 * sampled at EQUAL ARC LENGTH, with outward unit normals and normalised arc param s.
 */
export function buildLoop(n) {
  const A = BOWL.halfX, B = BOWL.halfZ, p = BOWL.power;
  const M = 4096;
  const px = new Float64Array(M + 1), pz = new Float64Array(M + 1), cum = new Float64Array(M + 1);
  for (let i = 0; i <= M; i++) {
    const q = superellipse(i / M, A, B, p);
    px[i] = q[0]; pz[i] = q[1];
    if (i > 0) cum[i] = cum[i - 1] + Math.hypot(px[i] - px[i - 1], pz[i] - pz[i - 1]);
  }
  const total = cum[M];

  const x = new Float32Array(n + 1), z = new Float32Array(n + 1);
  const nx = new Float32Array(n + 1), nz = new Float32Array(n + 1);
  const s = new Float32Array(n + 1);
  let j = 0;
  for (let i = 0; i <= n; i++) {
    const target = (i / n) * total;
    while (j < M && cum[j + 1] < target) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    const k = (target - cum[j]) / seg;
    x[i] = px[j] + (px[j + 1] - px[j]) * k;
    z[i] = pz[j] + (pz[j + 1] - pz[j]) * k;
    s[i] = i / n;
  }
  // Outward normal from the local tangent (rotate -90 deg; the loop runs CCW in XZ
  // with +Z at t=0.25, so this points away from the field).
  for (let i = 0; i <= n; i++) {
    const a = (i - 1 + n) % n, b = (i + 1) % n;
    const tx = x[b] - x[a], tz = z[b] - z[a];
    const L = Math.hypot(tx, tz) || 1;
    let ox = tz / L, oz = -tx / L;
    if (ox * x[i] + oz * z[i] < 0) { ox = -ox; oz = -oz; }
    nx[i] = ox; nz[i] = oz;
  }
  return { n, x, z, nx, nz, s, perimeter: total };
}

/* ------------------------------------------------------- large-scale variation */

/**
 * The bowl's low-frequency life, evaluated per (loop position, band). This is what
 * stops the crowd being flat noise at panel scale: real stands are unevenly lit and
 * unevenly full, and the eye reads that variation long before it reads a single fan.
 * Deterministic, hash-driven, and baked into vertex colour so it costs nothing.
 */
function sectionShade(s, sections, seed) {
  const f = s * sections;
  const i = Math.floor(f);
  const k = f - i;
  const a = hash01(i, seed);
  const b = hash01(i + 1, seed);
  const sm = k * k * (3 - 2 * k);
  const base = a + (b - a) * sm;
  // one octave up, so neighbouring sections are not all one flat value
  const f2 = s * sections * 3.0;
  const i2 = Math.floor(f2), k2 = f2 - i2;
  const a2 = hash01(i2, seed ^ 0x51ed);
  const b2 = hash01(i2 + 1, seed ^ 0x51ed);
  const sm2 = k2 * k2 * (3 - 2 * k2);
  return base * 0.72 + (a2 + (b2 - a2) * sm2) * 0.28;
}

/* ----------------------------------------------------------------- the loft */

function hex(c) {
  let t = String(c).replace('#', '');
  if (t.length === 3) t = t[0] + t[0] + t[1] + t[1] + t[2] + t[2];
  const v = parseInt(t, 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

/**
 * buildBowl(THREE, opts) -> { crowd: BufferGeometry, struct: BufferGeometry, loop }
 *
 * opts: { segments, teamPrimary, teamAccent, sectionSeed }
 *
 * Attributes on both:
 *   position, uv (u = section-tiled arc, v = 0..1 up the band), color (tint x shade),
 *   aMask (x = crowd amount / structure band id, y = team-colour bias)
 */
export function buildBowl(THREE, opts) {
  const o = opts || {};
  const n = o.segments || BOWL.segLive;
  const loop = buildLoop(n);
  const P = BOWL.profile;
  const seed = o.sectionSeed !== undefined ? o.sectionSeed : 91177;

  const prim = hex(o.teamPrimary || '#2a3550');
  const acc = hex(o.teamAccent || '#c9a24a');

  const crowd = { pos: [], uv: [], col: [], mask: [], idx: [] };
  const struct = { pos: [], uv: [], col: [], mask: [], idx: [] };

  // Per-loop-position shade fields, computed once and reused by every band.
  const shadeLo = new Float32Array(n + 1);
  const shadeHi = new Float32Array(n + 1);
  const shadeSt = new Float32Array(n + 1);
  for (let i = 0; i <= n; i++) {
    shadeLo[i] = sectionShade(loop.s[i], BOWL.sectionsLower, seed);
    shadeHi[i] = sectionShade(loop.s[i], BOWL.sectionsUpper, seed ^ 0x2f19);
    shadeSt[i] = sectionShade(loop.s[i], 11, seed ^ 0x77c1);
  }

  for (let b = 0; b < P.length - 1; b++) {
    const lo = P[b], hi = P[b + 1];
    const band = lo.band;
    if (band < 0) continue;
    const isCrowd = BOWL.crowdBands.indexOf(band) >= 0;
    const T = isCrowd ? crowd : struct;
    const sections = band === 2 ? BOWL.sectionsLower : BOWL.sectionsUpper;
    const base = T.pos.length / 3;

    for (let row = 0; row < 2; row++) {
      const lv = row === 0 ? lo : hi;
      const v = row;
      for (let i = 0; i <= n; i++) {
        const ox = loop.nx[i], oz = loop.nz[i];
        T.pos.push(loop.x[i] + ox * lv.r, lv.y, loop.z[i] + oz * lv.r);
        T.uv.push(loop.s[i] * sections, v);

        // ---- value structure, baked per vertex -------------------------------
        let r = 1, g = 1, bl = 1, crowdAmt = 0, teamBias = 0;
        if (isCrowd) {
          const sh = band === 2 ? shadeLo[i] : shadeHi[i];
          // THE TWO DECKS ARE LIT IN OPPOSITE DIRECTIONS, and that is the whole
          // value structure of the frame. The lower bowl's BACK rows sit under the
          // mezzanine overhang and fall away into it; the upper deck's back rows sit
          // closest to the light banks and are the brightest crowd in the stadium.
          // The result is bright / dark / DARK BAND / dark / bright reading upward —
          // the layered depth the bar has and a single flat crowd tint never gets.
          const vert = band === 2 ? (0.30 - v * 0.16) : (0.11 + v * 0.27);
          // horizontal: uneven fill / uneven lighting, section by section
          const lat = 0.40 + sh * 1.05;
          let e = vert * lat;
          // team-colour bias, strongest in the front rows of the lower bowl
          teamBias = band === 2 ? (1.0 - v) * 0.85 : (1.0 - v) * 0.30;
          const tw = teamBias * 0.34;
          r = e * (1 - tw) + e * tw * (prim[0] * 2.1 + acc[0] * 0.9);
          g = e * (1 - tw) + e * tw * (prim[1] * 2.1 + acc[1] * 0.9);
          bl = e * (1 - tw) + e * tw * (prim[2] * 2.1 + acc[2] * 0.9);
          // a touch of warmth overall — the bar's stands are amber, never neutral
          r *= 1.10; g *= 1.0; bl *= 0.86;
          crowdAmt = 1;
        } else {
          const sh = shadeSt[i];
          let e = 0.85 + sh * 0.42;
          // THE VALUE LADDER. A night bowl's structure is nearly black; only its
          // luminaires and its LEDs are bright. Every one of these multipliers exists
          // to keep a band from reading as daylight concrete, and band 5 — the deep
          // overhang under the upper deck — is deliberately the darkest thing in the
          // frame, because that dark mid band is what separates the two crowd masses
          // and it is the first thing the brief asks to be judged on.
          if (band === 0) e *= 0.24 + v * 0.22;   // padded field wall
          else if (band === 1) e *= 0.38;         // apron walkway
          else if (band === 3) e *= 0.46;         // concourse
          else if (band === 4) e *= 0.30;         // suite fascia (windows glow on top)
          else if (band === 5) e *= 0.20;         // the deep overhang shelf
          else if (band === 7) e *= 0.42;         // rim wall
          else if (band === 8) e *= 0.36;         // roof face
          else if (band === 9) e *= 0.24;         // roof soffit
          r = e * 1.02; g = e; bl = e * 1.08;
          crowdAmt = 0;
          teamBias = band;
        }
        T.col.push(r, g, bl);
        T.mask.push(crowdAmt, teamBias);
      }
    }

    const stride = n + 1;
    for (let i = 0; i < n; i++) {
      const a = base + i, c = base + i + 1;
      const d = base + stride + i, e = base + stride + i + 1;
      T.idx.push(a, d, c, c, d, e);
    }
  }

  function toGeo(T) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(T.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(T.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(T.col, 3));
    g.setAttribute('aMask', new THREE.Float32BufferAttribute(T.mask, 2));
    g.setIndex(T.idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }

  return { crowd: toGeo(crowd), struct: toGeo(struct), loop };
}

/* --------------------------------------------------------------- ribbon rings */

/**
 * A ring strip on a given profile band, between two heights of that band, facing the
 * field. Returns a BufferGeometry with u = arc length / periodMetres so one long
 * sponsor strip scrolls round the whole bowl at a constant real-world speed.
 */
export function pushRibbon(T, loop, band, f0, f1, texV0, texV1, periodM, inset, gain) {
  const P = BOWL.profile;
  const lo = P[band], hi = P[band + 1];
  const n = loop.n;
  const base = T.pos.length / 3;
  const g = gain || [1, 1, 1];
  const push = (f, vv) => {
    for (let i = 0; i <= n; i++) {
      const rr = lo.r + (hi.r - lo.r) * f - (inset || 0.06);
      const yy = lo.y + (hi.y - lo.y) * f;
      T.pos.push(loop.x[i] + loop.nx[i] * rr, yy, loop.z[i] + loop.nz[i] * rr);
      T.uv.push((loop.s[i] * loop.perimeter) / periodM, vv);
      T.col.push(g[0], g[1], g[2]);
      T.scr.push(1);
    }
  };
  push(f0, texV0);
  push(f1, texV1);
  const stride = n + 1;
  for (let i = 0; i < n; i++) {
    T.idx.push(base + i, base + stride + i, base + i + 1,
      base + i + 1, base + stride + i, base + stride + i + 1);
  }
}

/** A flat rectangular emissive panel (video wall) standing in the XY/ZY plane. */
export function pushPanel(T, corners, u0, v0, u1, v1, gain) {
  const base = T.pos.length / 3;
  const uvs = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  for (let i = 0; i < 4; i++) {
    T.pos.push(corners[i][0], corners[i][1], corners[i][2]);
    T.uv.push(uvs[i][0], uvs[i][1]);
    T.col.push(gain[0], gain[1], gain[2]);
    T.scr.push(0);
  }
  T.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

export function emissiveGeometry(THREE, T) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(T.pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(T.uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(T.col, 3));
  g.setAttribute('aScroll', new THREE.Float32BufferAttribute(T.scr, 1));
  g.setIndex(T.idx);
  g.computeBoundingSphere();
  return g;
}

/** World position + outward normal at (arc param s, radial offset r, height y). */
export function atLoop(loop, s, r, y, out) {
  const f = ((s % 1) + 1) % 1;
  const i = Math.min(loop.n - 1, Math.floor(f * loop.n));
  const k = f * loop.n - i;
  const x = loop.x[i] + (loop.x[i + 1] - loop.x[i]) * k;
  const z = loop.z[i] + (loop.z[i + 1] - loop.z[i]) * k;
  const nx = loop.nx[i] + (loop.nx[i + 1] - loop.nx[i]) * k;
  const nz = loop.nz[i] + (loop.nz[i + 1] - loop.nz[i]) * k;
  const L = Math.hypot(nx, nz) || 1;
  out[0] = x + (nx / L) * r;
  out[1] = y;
  out[2] = z + (nz / L) * r;
  out[3] = -nx / L;
  out[4] = -nz / L;
  return out;
}

export default { buildLoop, buildBowl, pushRibbon, pushPanel, emissiveGeometry, atLoop };
