// PIECE stadium-env — everything at field level, merged into ONE geometry.
//
// Goalposts, pylons, benches, heaters, camera scaffolds, the chain crew, and ~150
// sideline bodies (coaches, subs, officials, security, photographers) all end up in a
// single non-indexed BufferGeometry with vertex colours. One draw, one program.
//
// The sideline population is not decoration. In every bar panel the band between the
// green and the stands is a busy dark silhouette of people, and an empty apron there
// is the single most obvious "this is a tech demo" tell in the whole frame.

import * as THREE from 'three';
import { hash01 } from '../../foundation/rng.js';
import { FIELDX } from './config.js';

const V = new THREE.Vector3();
const NV = new THREE.Vector3();
const NM = new THREE.Matrix3();
const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const S = new THREE.Vector3(1, 1, 1);

function hex(c) {
  let t = String(c).replace('#', '');
  if (t.length === 3) t = t[0] + t[0] + t[1] + t[1] + t[2] + t[2];
  const v = parseInt(t, 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

class Builder {
  constructor() { this.pos = []; this.nor = []; this.col = []; }
  add(geo, mat, color) {
    const p = geo.attributes.position, n = geo.attributes.normal, idx = geo.index;
    NM.getNormalMatrix(mat);
    const count = idx ? idx.count : p.count;
    for (let i = 0; i < count; i++) {
      const j = idx ? idx.getX(i) : i;
      V.set(p.getX(j), p.getY(j), p.getZ(j)).applyMatrix4(mat);
      this.pos.push(V.x, V.y, V.z);
      NV.set(n.getX(j), n.getY(j), n.getZ(j)).applyMatrix3(NM).normalize();
      this.nor.push(NV.x, NV.y, NV.z);
      this.col.push(color[0], color[1], color[2]);
    }
  }
  box(w, h, d, x, y, z, ry, color) {
    Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry || 0);
    M.compose(V.set(x, y, z), Q, S);
    this.add(CACHE.box(w, h, d), M, color);
  }
  cyl(r0, r1, h, x, y, z, rx, rz, color, seg) {
    Q.setFromEuler(new THREE.Euler(rx || 0, 0, rz || 0));
    M.compose(V.set(x, y, z), Q, S);
    this.add(CACHE.cyl(r0, r1, h, seg || 10), M, color);
  }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
  get tris() { return this.pos.length / 9; }
}

const CACHE = {
  _b: new Map(), _c: new Map(),
  box(w, h, d) {
    const k = `${w}|${h}|${d}`;
    if (!this._b.has(k)) this._b.set(k, new THREE.BoxGeometry(w, h, d));
    return this._b.get(k);
  },
  cyl(r0, r1, h, s) {
    const k = `${r0}|${r1}|${h}|${s}`;
    if (!this._c.has(k)) this._c.set(k, new THREE.CylinderGeometry(r0, r1, h, s, 1, false));
    return this._c.get(k);
  },
  dispose() {
    this._b.forEach((g) => g.dispose()); this._c.forEach((g) => g.dispose());
    this._b.clear(); this._c.clear();
  },
};

/* -------------------------------------------------------------- goalposts */

// Over-range vertex colours. Everything in this mesh is scaled by K = 0.46 at the end
// of buildProps to survive the fallback key light; the goalpost and the pylons are the
// two things in the bar that stay saturated and bright at night, so they are authored
// past 1.0 and come back out the far side at the value the panel has.
const YELLOW = [2.05, 1.62, 0.30];
const YELLOW_LO = [1.42, 1.14, 0.20];
const PAD_DK = hex('#101216');

function goalpost(B, sign) {
  const ex = FIELDX.endLineX * sign;
  const back = ex + 0.95 * sign;
  const CB = 3.05;                 // crossbar height
  const HALF = 2.82;               // uprights 18'6" apart
  const UP = 10.7;                 // uprights above the crossbar
  // base post + pad
  B.cyl(0.085, 0.10, CB + 0.35, back, (CB + 0.35) / 2, 0, 0, 0, YELLOW, 10);
  B.cyl(0.20, 0.22, 1.85, back, 0.92, 0, 0, 0, PAD_DK, 10);
  // gooseneck: three chords from the post top forward to the crossbar centre
  const steps = 4;
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps, t1 = (i + 1) / steps;
    const x0 = back + (ex - back) * t0, x1 = back + (ex - back) * t1;
    const y0 = CB - 0.30 + 0.30 * Math.sin(t0 * Math.PI * 0.5);
    const y1 = CB - 0.30 + 0.30 * Math.sin(t1 * Math.PI * 0.5);
    const dx = x1 - x0, dy = y1 - y0;
    const L = Math.hypot(dx, dy);
    B.cyl(0.082, 0.082, L, (x0 + x1) / 2, (y0 + y1) / 2, 0, 0, Math.atan2(dx, dy) * -1, YELLOW, 8);
  }
  // crossbar + uprights
  B.cyl(0.075, 0.075, HALF * 2, ex, CB, 0, Math.PI / 2, 0, YELLOW, 10);
  for (const s of [-1, 1]) {
    B.cyl(0.072, 0.062, UP, ex, CB + UP / 2, HALF * s, 0, 0, YELLOW, 10);
    B.box(0.13, 0.13, 0.13, ex, CB + UP, HALF * s, 0, YELLOW_LO);
  }
}

/* ------------------------------------------------------------- sideline set */

const COACH = [
  '#0d0f14', '#16181f', '#232733', '#2c3140', '#0a0c10', '#3a4050',
];
const SKIN = ['#c58f66', '#8b5c3a', '#e0b492', '#5f3d27', '#a9744c'];

/** One standing body: legs, torso, head. ~44 triangles. */
function body(B, x, z, ry, h, coat, skin, lean) {
  const legH = h * 0.47, torH = h * 0.36, headR = h * 0.075;
  B.box(h * 0.20, legH, h * 0.13, x, legH / 2, z, ry, coat);
  B.box(h * 0.27, torH, h * 0.17, x + lean * 0.06, legH + torH / 2, z, ry, coat);
  B.box(headR * 1.7, headR * 2.0, headR * 1.7, x + lean * 0.10, legH + torH + headR, z, ry, skin);
}

function crouched(B, x, z, ry, coat, skin) {
  B.box(0.34, 0.44, 0.26, x, 0.22, z, ry, coat);
  B.box(0.30, 0.42, 0.22, x, 0.62, z, ry, coat);
  B.box(0.15, 0.17, 0.15, x, 0.93, z, ry, skin);
  // the long white lens every touchline photographer is holding
  B.cyl(0.055, 0.075, 0.42, x + Math.sin(ry) * 0.26, 0.90, z + Math.cos(ry) * 0.26,
    Math.PI / 2, 0, hex('#d8d9dc'), 8);
}

function sidelinePopulation(B, seed, teamA, teamB) {
  const A = hex(teamA || '#1b2a4a');
  const Bc = hex(teamB || '#3a1418');
  const HIVIS = hex('#c8b414');
  const REF = hex('#c9ccd2');
  let k = 0;
  for (const side of [-1, 1]) {
    const teamCol = side < 0 ? A : Bc;
    for (let i = 0; i < 62; i++) {
      const h0 = hash01(i, side, seed);
      const h1 = hash01(i, side, seed ^ 0x1234);
      const h2 = hash01(i, side, seed ^ 0x9ab1);
      const h3 = hash01(i, side, seed ^ 0x55f2);
      // clustered, not evenly spaced: a real touchline bunches around the bench
      // and the coaches' box and leaves gaps, and even spacing reads as a fence.
      const x = -52 + (i / 61) * 104 + (h0 - 0.5) * 7.0 + Math.sin(i * 1.7 + side) * 3.2;
      const z = side * (FIELDX.halfWidth + 1.15 + h1 * 4.6);
      const ry = side > 0 ? Math.PI + (h2 - 0.5) * 0.9 : (h2 - 0.5) * 0.9;
      const h = 1.72 + h2 * 0.24;
      let coat = COACH[Math.floor(h1 * COACH.length) % COACH.length];
      if (h3 > 0.92) coat = '#c9ccd2';                       // officials
      else if (h3 > 0.86) coat = '#c8b414';                  // security
      else if (h3 < 0.44) coat = null;                       // players in kit
      const c = coat ? hex(coat) : [teamCol[0] * 1.15, teamCol[1] * 1.15, teamCol[2] * 1.15];
      body(B, x, z, ry, h, c, hex(SKIN[Math.floor(h0 * SKIN.length) % SKIN.length]), side > 0 ? -1 : 1);
      k++;
    }
    // photographers hug the end lines and the corners
    for (let i = 0; i < 9; i++) {
      const h0 = hash01(i, side * 7, seed ^ 0x77);
      const x = (i < 5 ? -1 : 1) * (FIELDX.endLineX + 1.6 + h0 * 2.2);
      const z = side * (FIELDX.halfWidth * (0.15 + h0 * 0.85));
      crouched(B, x, z, x > 0 ? -Math.PI / 2 : Math.PI / 2, hex(COACH[i % COACH.length]), hex(SKIN[i % SKIN.length]));
    }
    void REF; void HIVIS;
  }
  return k;
}

/* ----------------------------------------------------------------- benches */

function benchRow(B, side) {
  const z = side * (FIELDX.halfWidth + 6.2);
  const DK = hex('#0c0e13');
  const MT = hex('#2a2f3a');
  for (let i = 0; i < 4; i++) {
    const x = -26 + i * 17;
    B.box(14.0, 0.42, 0.80, x, 0.52, z, 0, DK);
    B.box(14.0, 0.86, 0.14, x, 0.95, z + 0.36 * side, 0, MT);
    for (let l = 0; l < 6; l++) B.box(0.10, 0.52, 0.10, x - 6.4 + l * 2.55, 0.26, z, 0, MT);
  }
  // heaters and equipment carts
  for (let i = 0; i < 5; i++) {
    const x = -34 + i * 17;
    B.box(0.9, 1.5, 0.9, x, 0.75, z + side * 1.6, 0, hex('#171a20'));
    B.box(1.1, 0.24, 1.1, x, 1.58, z + side * 1.6, 0, hex('#3a1c0c'));
  }
}

/** Broadcast camera scaffolds on the far touchline and in the corners. */
function scaffold(B, x, z, h) {
  const DK = hex('#14171d');
  const MT = hex('#31363f');
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      B.box(0.10, h, 0.10, x + sx * 0.75, h / 2, z + sz * 0.75, 0, MT);
    }
  }
  for (let i = 1; i < 4; i++) {
    B.box(1.7, 0.07, 0.07, x, (h * i) / 4, z - 0.75, 0, MT);
    B.box(1.7, 0.07, 0.07, x, (h * i) / 4, z + 0.75, 0, MT);
  }
  B.box(2.0, 0.14, 2.0, x, h, z, 0, DK);
  B.box(0.62, 0.34, 0.90, x, h + 0.5, z, 0, hex('#0a0c10'));
  B.cyl(0.10, 0.13, 0.42, x, h + 0.56, z - 0.55, Math.PI / 2, 0, hex('#cfd2d8'), 8);
  body(B, x - 0.45, z + 0.4, 0, 1.75, hex('#0d0f14'), hex(SKIN[2]), 0);
}

/* --------------------------------------------------------------- assemble */

/**
 * buildProps(THREE, opts) -> { geometry, tris }
 * opts: { seed, teamA, teamB, camPos, hazeCol, density }
 */
export function buildProps(opts) {
  const o = opts || {};
  const B = new Builder();
  const seed = o.seed || 4407;

  goalpost(B, +1);
  goalpost(B, -1);

  // pylons at both ends of both end zones
  const ORANGE = [2.30, 0.86, 0.24];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      B.box(0.10, 0.46, 0.10, FIELDX.goalLineX * sx, 0.23, FIELDX.halfWidth * sz, 0, ORANGE);
      B.box(0.10, 0.46, 0.10, FIELDX.endLineX * sx, 0.23, FIELDX.halfWidth * sz, 0, ORANGE);
    }
  }

  benchRow(B, -1);
  benchRow(B, +1);

  scaffold(B, -26, -(FIELDX.halfWidth + 8.4), 3.4);
  scaffold(B, 26, -(FIELDX.halfWidth + 8.4), 3.4);
  scaffold(B, 0, -(FIELDX.halfWidth + 9.0), 4.2);
  scaffold(B, -(FIELDX.endLineX + 5.0), -(FIELDX.halfWidth + 4.0), 3.0);
  scaffold(B, (FIELDX.endLineX + 5.0), -(FIELDX.halfWidth + 4.0), 3.0);

  // chain crew, far side
  const CHAIN = hex('#ff7a1a');
  for (const x of [-9.14, 0.0]) {
    B.cyl(0.035, 0.035, 1.9, x, 0.95, -(FIELDX.halfWidth + 0.9), 0, 0, CHAIN, 6);
    B.box(0.34, 0.34, 0.06, x, 1.95, -(FIELDX.halfWidth + 0.9), 0, CHAIN);
  }

  const people = sidelinePopulation(B, seed, o.teamA, o.teamB);

  const g = B.geo();

  // --- bake the haze into vertex colour ------------------------------------
  // These are MeshStandard props lit by whatever the lighting piece installed, so
  // they cannot use the bowl's fog shader. Baking the wash into albedo is exact for a
  // static prop set and costs nothing per frame.
  if (o.camPos) {
    const col = g.attributes.color, pos = g.attributes.position;
    const hz = hex(o.hazeCol || '#414a5e');
    const cx = o.camPos[0], cy = o.camPos[1], cz = o.camPos[2];
    // K compensates for the fallback key light: these are MeshStandard props under a
    // 2.4-intensity directional, and authored albedo would come back as daylight-bright
    // touchline furniture in a night frame.
    const K = 0.32;
    for (let i = 0; i < col.count; i++) {
      const dx = pos.getX(i) - cx, dy = pos.getY(i) - cy, dz = pos.getZ(i) - cz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      let f = 1 - Math.exp(-d * 0.0110);
      f = f * (0.35 + 0.65 * f) * 0.80;
      if (f > 0.66) f = 0.66;
      col.setXYZ(i,
        col.getX(i) * K * (1 - f) + hz[0] * 0.5 * f,
        col.getY(i) * K * (1 - f) + hz[1] * 0.5 * f,
        col.getZ(i) * K * (1 - f) + hz[2] * 0.5 * f);
    }
    col.needsUpdate = true;
  }

  return { geometry: g, tris: B.tris, people };
}

/* -------------------------------------------------------------- glow quads */

/**
 * buildGlows(list) -> BufferGeometry of view-aligned quads.
 * list entries: { x, y, z, w, h, power }
 * `position` is the quad's CENTRE (so bounds and culling are honest); the corner
 * offset and size ride on their own attributes and are applied in view space.
 */
export function buildGlows(list) {
  const n = list.length;
  const pos = new Float32Array(n * 6 * 3);
  const cor = new Float32Array(n * 6 * 2);
  const siz = new Float32Array(n * 6 * 2);
  const pw = new Float32Array(n * 6);
  const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
  for (let i = 0; i < n; i++) {
    const g = list[i];
    for (let k = 0; k < 6; k++) {
      const o = i * 6 + k;
      pos[o * 3] = g.x; pos[o * 3 + 1] = g.y; pos[o * 3 + 2] = g.z;
      cor[o * 2] = CORNERS[k][0]; cor[o * 2 + 1] = CORNERS[k][1];
      siz[o * 2] = g.w; siz[o * 2 + 1] = g.h;
      pw[o] = g.power;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aCorner', new THREE.BufferAttribute(cor, 2));
  geo.setAttribute('aSize', new THREE.BufferAttribute(siz, 2));
  geo.setAttribute('aPower', new THREE.BufferAttribute(pw, 1));
  geo.computeBoundingSphere();
  return geo;
}

export function disposeCaches() { CACHE.dispose(); }

export default { buildProps, buildGlows, disposeCaches };
