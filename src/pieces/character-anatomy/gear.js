// PIECE: character-anatomy — gloves, cleats, back plate, towel.
//
// These are small on screen but they are the difference between "armoured athlete" and
// "mannequin". The bar's figures always terminate in a chunky glove and a chunky shoe;
// a limb that tapers to a point is the single loudest tell that a body is procedural.

import {
  V, mix, smooth01, clamp01, newPart, addVert, addQuad, computeNormals, loft, tube, frame,
} from './mesh.js';
import { chainPoint, chainDir, w2 } from './chain.js';

const UP = [0, 1, 0];

/** Non-wrapping grid plate with an extruded rim — back plate, towel, any panel. */
function gridPlate(part, rimPart, NU, NV, fn, weights, thickness) {
  const ids = [];
  const pts = [];
  const nrms = [];
  for (let iv = 0; iv < NV; iv++) {
    const row = [], prow = [], nrow = [];
    for (let iu = 0; iu < NU; iu++) {
      const s = fn(iu / (NU - 1), iv / (NV - 1));
      row.push(addVert(part, s.p, iu / (NU - 1), iv / (NV - 1), s.w || weights));
      prow.push(s.p); nrow.push(s.n);
    }
    ids.push(row); pts.push(prow); nrms.push(nrow);
  }
  for (let iv = 0; iv < NV - 1; iv++) {
    for (let iu = 0; iu < NU - 1; iu++) {
      const a = ids[iv][iu], b = ids[iv][iu + 1], c = ids[iv + 1][iu + 1], d = ids[iv + 1][iu];
      const P = part.pos;
      const e1 = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]];
      const e2 = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
      const fnm = V.cross(e1, e2);
      if (V.dot(fnm, nrms[iv][iu]) >= 0) addQuad(part, a, b, c, d);
      else addQuad(part, a, d, c, b);
    }
  }
  if (rimPart && thickness > 0) {
    const inner = [];
    for (let iv = 0; iv < NV; iv++) {
      const row = [];
      for (let iu = 0; iu < NU; iu++) row.push(V.madd(pts[iv][iu], nrms[iv][iu], -thickness));
      inner.push(row);
    }
    const seam = (p0, p1, q0, q1) => {
      const a = addVert(rimPart, p0, 0, 0, weights);
      const b = addVert(rimPart, p1, 1, 0, weights);
      const c = addVert(rimPart, q1, 1, 1, weights);
      const d = addVert(rimPart, q0, 0, 1, weights);
      addQuad(rimPart, a, b, c, d);
      addQuad(rimPart, a, d, c, b);
    };
    for (let iu = 0; iu < NU - 1; iu++) {
      seam(pts[0][iu], pts[0][iu + 1], inner[0][iu], inner[0][iu + 1]);
      seam(pts[NV - 1][iu], pts[NV - 1][iu + 1], inner[NV - 1][iu], inner[NV - 1][iu + 1]);
    }
    for (let iv = 0; iv < NV - 1; iv++) {
      seam(pts[iv][0], pts[iv + 1][0], inner[iv][0], inner[iv + 1][0]);
      seam(pts[iv][NU - 1], pts[iv + 1][NU - 1], inner[iv][NU - 1], inner[iv + 1][NU - 1]);
    }
    // the back face, so the plate is solid from behind
    for (let iv = 0; iv < NV - 1; iv++) {
      for (let iu = 0; iu < NU - 1; iu++) {
        const a = addVert(rimPart, inner[iv][iu], 0, 0, weights);
        const b = addVert(rimPart, inner[iv][iu + 1], 1, 0, weights);
        const c = addVert(rimPart, inner[iv + 1][iu + 1], 1, 1, weights);
        const d = addVert(rimPart, inner[iv + 1][iu], 0, 1, weights);
        addQuad(rimPart, a, d, c, b);
      }
    }
  }
  return ids;
}

/* ----------------------------------------------------------------- gloves */

export function buildGlove(S, parts, side) {
  const ch = S.chains[side === 'L' ? 'armL' : 'armR'];
  const { gs, BI } = S;
  const hand = BI[side === 'L' ? 'hand_L' : 'hand_R'];
  const W = [[hand, 1]];
  const wristW = [[hand, 0.72], [BI[side === 'L' ? 'forearm_L' : 'forearm_R'], 0.28]];

  const t0 = 1.985;
  const o = chainPoint(ch, t0);
  const d = V.norm(chainDir(ch, t0));
  const f = frame(d, [0, 0, 1]);
  // `frame()` picks u with a sign that flips between the two arms, which silently
  // curled the right hand's fingers over the BACK of the glove. Force the dorsal normal
  // to point up-and-out on both sides so "curl toward -palmN" means the same thing twice.
  const across = f.v;                                   // across the palm, front-to-back
  const palmN = f.u[1] >= 0 ? f.u : V.mul(f.u, -1);     // dorsal (back-of-hand) normal
  const hs = gs * S.handS;

  const g = newPart('glove');
  // cuff + palm block
  const rings = [];
  const prof = (rad, i, th) => {
    const n = 2.5;
    const c = Math.abs(Math.cos(th)), s = Math.abs(Math.sin(th));
    return 1 / Math.pow(Math.pow(c, n) + Math.pow(s, n), 1 / n);
  };
  const secs = [
    { t: -0.046, w: 0.052, h: 0.038 },
    { t: -0.016, w: 0.057, h: 0.037 },
    { t: 0.014, w: 0.054, h: 0.031 },
    { t: 0.054, w: 0.060, h: 0.031 },
    { t: 0.090, w: 0.061, h: 0.030 },
    { t: 0.114, w: 0.057, h: 0.028 },
  ];
  for (let i = 0; i < secs.length; i++) {
    const s = secs[i];
    const c = V.madd(o, d, s.t * hs);
    rings.push({
      c, u: across, v: palmN,
      rx: s.w * hs, ry: s.h * hs,
      w: i < 2 ? wristW : W, vc: i / (secs.length - 1), prof,
    });
  }
  loft(g, rings, S.seg.glove, { capStart: true, capEnd: false });

  // fingers — curled, tapering, with a knuckle bulge at the base
  const nF = S.lod >= 1 ? 4 : 0;
  for (let k = 0; k < nF; k++) {
    const lat = mix(-0.040, 0.040, k / 3) * hs;
    const len = (0.076 - 0.009 * Math.abs(k - 1.2)) * hs;
    const base = V.add(V.madd(o, d, 0.104 * hs), V.mul(across, lat));
    const pts = [];
    const nSeg = 5;
    for (let i = 0; i < nSeg; i++) {
      const a = i / (nSeg - 1);
      const curl = 1.05 * a * a;
      const dir = V.norm(V.add(V.mul(d, Math.cos(curl)), V.mul(palmN, -Math.sin(curl))));
      pts.push(V.madd(base, dir, len * a));
    }
    tube(g, pts, (a) => (0.0155 - 0.0048 * a) * hs, S.lod >= 1 ? 7 : 5, W);
  }
  // thumb
  if (nF) {
    const lat = 0.046 * hs;   // thumb is anterior on both hands
    const base = V.add(V.madd(o, d, 0.045 * hs), V.mul(across, lat));
    const pts = [];
    for (let i = 0; i < 4; i++) {
      const a = i / 3;
      const curl = 0.85 * a;
      const dir = V.norm(V.add(
        V.add(V.mul(d, Math.cos(curl) * 0.55), V.mul(across, 0.75)),
        V.mul(palmN, -Math.sin(curl) * 0.7),
      ));
      pts.push(V.madd(base, dir, 0.058 * hs * a));
    }
    tube(g, pts, (a) => (0.018 - 0.005 * a) * hs, 6, W);
  }

  computeNormals(g);
  parts.push(g);
}

/* ------------------------------------------------------------------ cleat */

const SHOE = [
  /* z,      halfW,  yTop,  yBot */
  [-0.080, 0.036, 0.092, 0.012],
  [-0.054, 0.046, 0.136, 0.009],
  [-0.014, 0.054, 0.150, 0.008],
  [0.030, 0.057, 0.124, 0.007],
  [0.072, 0.059, 0.098, 0.007],
  [0.112, 0.058, 0.082, 0.007],
  [0.148, 0.056, 0.070, 0.008],
  [0.178, 0.052, 0.060, 0.009],
  [0.200, 0.048, 0.050, 0.012],
  [0.216, 0.036, 0.040, 0.018],
];

export function buildCleat(S, parts, side) {
  const { gs, BI } = S;
  const foot = BI[side === 'L' ? 'foot_L' : 'foot_R'];
  const toe = BI[side === 'L' ? 'toe_L' : 'toe_R'];
  const ch = S.chains[side === 'L' ? 'legL' : 'legR'];
  const ankle = chainPoint(ch, 2.0);
  const x = ankle[0];
  const z0 = ankle[2];

  const shoe = newPart('cleat');
  const rings = [];
  const N = SHOE.length;
  for (let i = 0; i < N; i++) {
    const s = SHOE[i];
    const z = z0 + s[0] * gs;
    const w = s[1] * gs * S.footS;
    const yT = s[2] * gs, yB = s[3] * gs;
    const cy = (yT + yB) * 0.5;
    const ry = (yT - yB) * 0.5;
    const blend = clamp01((s[0] - 0.075) / 0.09);
    rings.push({
      c: [x, cy, z],
      u: [1, 0, 0], v: [0, 1, 0],
      rx: w, ry,
      w: w2(foot, toe, blend), vc: i / (N - 1),
      prof: (rad, _i, th) => {
        // flat sole, rounded upper
        const n = rad[1] < 0 ? 5.0 : 2.4;
        const c = Math.abs(Math.cos(th)), sn = Math.abs(Math.sin(th));
        return 1 / Math.pow(Math.pow(c, n) + Math.pow(sn, n), 1 / n);
      },
    });
  }
  loft(shoe, rings, S.seg.cleat, { capStart: true, capEnd: true });

  // midsole plate: a visible outsole lip, which is what makes a shoe read as a shoe
  const sole = newPart('cleat', { flat: true });
  const sRings = [];
  for (let i = 0; i < N; i++) {
    const s = SHOE[i];
    const z = z0 + s[0] * gs;
    const w = (s[1] + 0.0030) * gs * S.footS * (i >= N - 3 ? 0.74 : 1);
    sRings.push({
      c: [x, 0.0070 * gs, z],
      u: [1, 0, 0], v: [0, 1, 0],
      rx: w, ry: 0.0070 * gs,
      w: w2(foot, toe, clamp01((s[0] - 0.075) / 0.09)), vc: i / (N - 1),
      prof: (rad, _i, th) => {
        const n = 4.5;
        const c = Math.abs(Math.cos(th)), sn = Math.abs(Math.sin(th));
        return 1 / Math.pow(Math.pow(c, n) + Math.pow(sn, n), 1 / n);
      },
    });
  }
  loft(sole, sRings, Math.max(6, S.seg.cleat - 2), { capStart: true, capEnd: true });

  computeNormals(shoe);
  computeNormals(sole);
  parts.push(shoe, sole);
}

/* ------------------------------------------------------------- back plate */

export function buildBackPlate(S, parts) {
  if (S.lod < 1) return;
  const { gs, BI } = S;
  const plate = newPart('pad');
  const rim = newPart('pad', { flat: true });
  const yA = S.yHem + 0.085 * gs;
  const yB = S.yHem + 0.235 * gs;
  gridPlate(plate, rim, 11, 6, (u, v) => {
    const az = mix(-1.02, 1.02, u);
    const y = mix(yB, yA, v);
    const q = clamp01((y - S.yHem) / (S.yTop - S.yHem));
    const rx = (0.176 + 0.030 * q) * gs * S.torsoW * S.hipW;
    const rz = (0.130 + 0.024 * q) * gs * S.torsoD;
    const sx = Math.sin(az), sz = -Math.cos(az);
    const drop = 0.012 * gs * Math.pow(Math.abs(u - 0.5) * 2, 2);
    const p = [sx * rx * 1.02, y - drop, sz * rz * 1.03 - 0.006 * gs];
    const n = V.norm([sx / rx, 0.12, sz / rz]);
    return { p: [p[0], p[1], p[2]], n, w: w2(BI.spine01, BI.hips, 0.35) };
  }, [[BI.spine01, 1]], 0.010 * gs);
  computeNormals(plate);
  computeNormals(rim);
  parts.push(plate, rim);
}

/* ------------------------------------------------------------------ towel */

export function buildTowel(S, parts) {
  if (S.lod < 1) return;
  const { gs, BI } = S;
  const towel = newPart('towel');
  const x0 = 0.070 * gs * (S.towelSide === 'L' ? 1 : -1);
  const yTop = S.yHem + 0.014 * gs;
  const rings = [];
  const N = 8;
  for (let i = 0; i < N; i++) {
    const a = i / (N - 1);
    const y = yTop - 0.185 * gs * a;
    const swing = 0.020 * gs * Math.sin(a * 2.6) * a;
    rings.push({
      c: [x0 + swing * 0.5, y, (0.098 + 0.014 * a) * gs * S.torsoD + swing],
      u: [1, 0, 0], v: [0, 0, 1],
      rx: (0.024 + 0.004 * a) * gs, ry: 0.0050 * gs,
      w: [[BI.hips, 1]], vc: a,
      prof: (rad) => 1 + 0.10 * S.noise(rad[0] * 6.0, a * 5.0 + 71.0),
    });
  }
  loft(towel, rings, 10, { capStart: true, capEnd: true });
  computeNormals(towel);
  parts.push(towel);
}

export default { buildGlove, buildCleat, buildBackPlate, buildTowel };
