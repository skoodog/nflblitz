// PIECE: character-anatomy — the body: torso-over-pads, arms, legs, socks, neck, head.
//
// The silhouette targets in bar/panel-uniform, panel-truck and panel-catch are arcade
// heroic, not anatomical: a flat-topped shoulder shelf far wider than the hips, a hard
// V-taper into a small waist, thighs as thick as the waist is wide, and gear that reads
// as gear even at 340 px. Every number below is in metres for the 1.88 m reference actor
// and is multiplied by the skeleton's own globalScale, so a 1.96 m lineman is not just a
// scaled-up receiver — his width multipliers come from rig.PROPORTIONS on top.

import { V, curve, lobe, bump, mix, clamp01, smooth01, newPart, loft, addVert, addQuad, computeNormals, frame } from './mesh.js';
import { makeChain, chainPoint, chainDir, chainWeights, w2 } from './chain.js';

const FRONT = [0, 0, 1];
const BACK = [0, 0, -1];
const UP = [0, 1, 0];
const DOWN = [0, -1, 0];

/* ------------------------------------------------------------------ torso */

/** Half-width (lateral) of the jersey-over-pads shell, q = 0 at hem, 1 at collar. */
const TORSO_RX = [
  0.00, 0.176, 0.09, 0.164, 0.20, 0.168, 0.36, 0.194,
  0.54, 0.236, 0.70, 0.262, 0.82, 0.262, 0.92, 0.230,
  0.98, 0.160, 1.00, 0.112,
];
const TORSO_RZ = [
  0.00, 0.132, 0.09, 0.122, 0.20, 0.126, 0.36, 0.146,
  0.54, 0.176, 0.70, 0.198, 0.82, 0.200, 0.92, 0.172,
  0.98, 0.130, 1.00, 0.104,
];

export function buildTorso(S, parts) {
  const { gs, sp } = S;
  const jersey = newPart('jersey');
  const yHem = S.yHem;
  const yTop = S.yTop;
  const span = yTop - yHem;

  const rows = S.rows.torso;
  const seg = S.seg.torso;
  const rings = [];
  for (let i = 0; i < rows; i++) {
    const q = i / (rows - 1);
    const y = yHem + span * q;
    const t = paramAtY(sp, y);
    const c = chainPoint(sp, t);
    // spine S-curve: hips sit back, chest carries forward
    const zoff = (-0.014 + 0.030 * smooth01((q - 0.15) / 0.6)) * gs;
    const widen = mix(1, S.shw, smooth01((q - 0.40) / 0.45));
    const padF = mix(1, S.padBulk, smooth01((q - 0.46) / 0.30));
    const rx = curve(TORSO_RX, q) * gs * widen * padF * S.torsoW;
    const rz = curve(TORSO_RZ, q) * gs * padF * S.torsoD;
    rings.push({
      c: [c[0], y, c[2] + zoff],
      u: [1, 0, 0], v: [0, 0, 1],
      rx, ry: rz,
      w: chainWeights(sp, t),
      vc: q,
      prof: torsoProf(S, q),
    });
  }
  loft(jersey, rings, seg, { capEnd: false, uFn: (x) => (x + 0.25) % 1 });

  // untucked hem: a short flared skirt below the last ring so the jersey ends in cloth,
  // not in a hard ring
  const hemRings = [];
  for (let i = 0; i < 3; i++) {
    const q = -0.012 * i;
    const y = yHem + span * q;
    const t = paramAtY(sp, y);
    const c = chainPoint(sp, t);
    const rx = curve(TORSO_RX, 0) * gs * S.torsoW * (1 + 0.05 * i);
    const rz = curve(TORSO_RZ, 0) * gs * S.torsoD * (1 + 0.05 * i);
    hemRings.push({
      c: [c[0], y, c[2] - 0.014 * gs],
      u: [1, 0, 0], v: [0, 0, 1],
      rx, ry: rz, w: chainWeights(sp, t), vc: 0,
      prof: hemProf(S, i),
    });
  }
  loft(jersey, hemRings, seg, { uFn: (x) => (x + 0.25) % 1 });

  computeNormals(jersey);
  parts.push(jersey);
  return jersey;
}

function torsoProf(S, q) {
  const nz = S.noise;
  const pec = smooth01((q - 0.50) / 0.16) * (1 - smooth01((q - 0.80) / 0.14));
  const abs = smooth01((q - 0.12) / 0.14) * (1 - smooth01((q - 0.46) / 0.14));
  const spineQ = smooth01((q - 0.20) / 0.25) * (1 - smooth01((q - 0.86) / 0.12));
  const foldAmp = S.foldAmp;
  return (rad) => {
    let s = 1;
    // pectoral shelf: two lobes either side of the sternum
    if (pec > 0.001) {
      const lx = Math.abs(rad[0]);
      const f = Math.max(0, rad[2]);
      s += pec * 0.024 * f * f * (1 - 0.45 * bump(lx, 0.10));
    }
    // lat spread under the arm
    s += smooth01((q - 0.35) / 0.25) * (1 - smooth01((q - 0.78) / 0.18)) * 0.05 * Math.pow(Math.max(0, Math.abs(rad[0])), 2.2);
    // abdominal compression + the visible seam of the jersey over the ribs
    if (abs > 0.001) s -= abs * 0.012 * Math.max(0, rad[2]);
    // spinal groove
    if (spineQ > 0.001) s -= spineQ * 0.05 * bump(rad[0], 0.30) * Math.max(0, -rad[2]);
    // cloth folds — low frequency, anisotropic (mostly vertical creases)
    const a = Math.atan2(rad[2], rad[0]);
    const calm = smooth01(q / 0.14);
    s += foldAmp * calm * (nz(a * 1.9, q * 7.0) * 0.65 + nz(a * 4.3, q * 2.1) * 0.35);
    return s;
  };
}

function hemProf(S, i) {
  const nz = S.noise;
  return (rad) => 1 + S.foldAmp * 1.5 * nz(Math.atan2(rad[2], rad[0]) * 3.1, 40 + i * 0.9);
}

/** Chain parameter of the spine chain at a given world Y. */
function paramAtY(sp, y) {
  const p = sp.p;
  if (y <= p[0][1]) {
    const d = p[1][1] - p[0][1];
    return (y - p[0][1]) / (d || 1);
  }
  for (let i = 0; i < sp.n - 1; i++) {
    if (y <= p[i + 1][1]) return i + (y - p[i][1]) / ((p[i + 1][1] - p[i][1]) || 1);
  }
  const k = sp.n - 1;
  const d = p[k][1] - p[k - 1][1];
  return k + (y - p[k][1]) / (d || 1);
}

/* --------------------------------------------------- shoulder pads / rolls */

const PAD_RY = [0.00, 0.048, 0.16, 0.088, 0.40, 0.114, 0.68, 0.110, 0.86, 0.090, 0.95, 0.052, 1.00, 0.012];
const PAD_RZ = [0.00, 0.092, 0.16, 0.146, 0.40, 0.188, 0.68, 0.182, 0.86, 0.154, 0.95, 0.094, 1.00, 0.022];

/**
 * The shoulder shelf. This is THE silhouette element — it is what makes a football
 * player read as a football player in one glance, and it is deliberately a separate
 * swept volume rather than a bulge in the torso so its top stays FLAT and its outer
 * edge stays SQUARE. It is bound mostly to the chest (pads do not follow the arm).
 */
export function buildShoulderPads(S, parts, side) {
  const { gs, BI } = S;
  const sgn = side === 'L' ? 1 : -1;
  const jersey = newPart('jersey');
  const rings = [];
  const N = S.rows.pad;
  const x0 = 0.052 * gs;
  const x1 = 0.418 * gs * S.shw * S.padBulk;
  const clav = BI[side === 'L' ? 'clavicle_L' : 'clavicle_R'];
  for (let i = 0; i < N; i++) {
    const a = i / (N - 1);
    const x = mix(x0, x1, a) * sgn;
    const cy = S.yShoulder - 0.030 * gs * a * a;
    const cz = (0.010 - 0.020 * a) * gs;
    const ry = curve(PAD_RY, a) * gs * S.padBulk;
    const rz = curve(PAD_RZ, a) * gs * S.padBulk * S.torsoD;
    rings.push({
      c: [x, cy, cz],
      u: [0, 1, 0], v: [0, 0, 1],
      rx: ry, ry: rz,
      w: w2(BI.chest, clav, 0.55 * a),
      vc: a,
      prof: padProf(S, a),
    });
  }
  loft(jersey, rings, S.seg.pad, { capStart: false, capEnd: true });
  computeNormals(jersey);
  parts.push(jersey);

  // The epaulette lip: a narrow band of exposed pad shell along the OUTER LOWER edge,
  // lofted in its own right rather than scaled off the jersey pad — a scaled copy
  // intersects the surface it was copied from and sprays white chunks along the shelf.
  if (S.lod >= 1) {
    const lip = newPart('pad');
    const lipRings = [];
    const M = 6;
    for (let i = 0; i < M; i++) {
      const a = mix(0.66, 0.985, i / (M - 1));
      const x = mix(x0, x1, a) * sgn;
      const cy = S.yShoulder - 0.030 * gs * a * a;
      const cz = (0.010 - 0.020 * a) * gs;
      const ry = curve(PAD_RY, a) * gs * S.padBulk;
      const rz = curve(PAD_RZ, a) * gs * S.padBulk * S.torsoD;
      lipRings.push({
        c: [x, cy - ry * 0.30, cz],
        u: [0, 1, 0], v: [0, 0, 1],
        rx: ry * 0.42, ry: rz * 0.965,
        w: w2(BI.chest, clav, 0.55 * a), vc: i / (M - 1),
        prof: (rad, _i, th) => {
          const n = 3.0;
          const c = Math.abs(Math.cos(th)), sn = Math.abs(Math.sin(th));
          let k = 1 / Math.pow(Math.pow(c, n) + Math.pow(sn, n), 1 / n);
          if (rad[1] > 0) k *= mix(1, 0.55, rad[1]);
          return k;
        },
      });
    }
    loft(lip, lipRings, Math.max(10, S.seg.pad - 8), { capEnd: true });
    computeNormals(lip);
    parts.push(lip);
  }
}

function padProf(S, a) {
  const n = 4.0;              // superellipse: flat top, square outer corner
  const nz = S.noise;
  return (rad, _i, th) => {
    const c = Math.abs(Math.cos(th)), s = Math.abs(Math.sin(th));
    let k = 1 / Math.pow(Math.pow(c, n) + Math.pow(s, n), 1 / n);
    // CUT THE UNDERSIDE. A shoulder pad is a dome that sits ON the shoulder; leave it a
    // full ellipse and it becomes a sausage hanging off the arm, which is exactly what
    // it looked like the first time.
    if (rad[1] < 0) k *= mix(1, 0.52, -rad[1]);
    // arch-plate seam across the top of the pad
    // chamfer line where the pad's top plane rolls into its front and back faces
    k *= 1 - 0.024 * bump(Math.abs(rad[1]) - 0.62, 0.16);
    k += S.foldAmp * 0.6 * nz(th * 2.2, a * 5.0 + 13.0);
    return k;
  };
}

/* ------------------------------------------------------------------- arms */

const ARM_R = [
  0.00, 0.087, 0.14, 0.087, 0.34, 0.082, 0.62, 0.069,
  0.86, 0.057, 1.00, 0.053, 1.16, 0.061, 1.40, 0.055,
  1.70, 0.043, 1.95, 0.036, 2.00, 0.035,
];

export function buildArm(S, parts, side) {
  const ch = S.chains[side === 'L' ? 'armL' : 'armR'];
  const skin = newPart('skin');
  const N = S.rows.arm;
  const rings = [];
  const tMax = 1.97;
  for (let i = 0; i < N; i++) {
    const t = (i / (N - 1)) * tMax;
    const c = chainPoint(ch, t);
    const d = chainDir(ch, t);
    const f = frame(d, UP);
    const r = curve(ARM_R, t) * S.gs * S.gir * S.armGirth;
    rings.push({
      c, u: f.u, v: f.v, rx: r, ry: r,
      w: chainWeights(ch, t, 0.30), vc: t / tMax,
      prof: armProf(S, t, side),
    });
  }
  loft(skin, rings, S.seg.arm, { capStart: true });
  computeNormals(skin);
  parts.push(skin);

  // JERSEY SLEEVE. Without it the arm reads as a bare limb bolted to a torso; with it
  // the eye gets the fabric-to-skin break at mid-bicep that every bar panel has.
  const sleeve = newPart('jersey');
  const sN = Math.max(6, Math.round(S.rows.arm * 0.42));
  const sRings = [];
  const sEnd = 0.46 + 0.06 * (S.gir - 1);
  for (let i = 0; i < sN; i++) {
    const a = i / (sN - 1);
    const t = mix(-0.10, sEnd, a);
    const c = chainPoint(ch, t);
    const d = chainDir(ch, t);
    const f = frame(d, UP);
    const base = curve(ARM_R, Math.max(0, t)) * S.gs * S.gir * S.armGirth;
    // thick at the shoulder, hugging by mid-bicep, then a flared cuff at the hem
    const grow = mix(1.17, 1.045, smooth01(a * 1.25)) + 0.085 * smooth01((a - 0.80) / 0.20);
    sRings.push({
      c, u: f.u, v: f.v, rx: base * grow, ry: base * grow,
      w: chainWeights(ch, t, 0.30), vc: a,
      prof: sleeveProf(S, a),
    });
  }
  loft(sleeve, sRings, S.seg.arm, { capEnd: false });
  computeNormals(sleeve);
  parts.push(sleeve);

  // compression sleeve (undershirt) on the far arm — asymmetry reads as a real kit
  if (S.sleeveSide === side && S.lod >= 1) {
    const sl = newPart('undershirt');
    const slRings = [];
    for (let i = 0; i < 9; i++) {
      const t = mix(0.02, 0.98, i / 8);
      const c = chainPoint(ch, t);
      const d = chainDir(ch, t);
      const f = frame(d, UP);
      const r = curve(ARM_R, t) * S.gs * S.gir * S.armGirth * (1.012 + 0.02 * (i === 0 ? 1 : 0));
      slRings.push({
        c, u: f.u, v: f.v, rx: r, ry: r,
        w: chainWeights(ch, t, 0.30), vc: i / 8, prof: armProf(S, t, side),
      });
    }
    loft(sl, slRings, S.seg.arm, {});
    computeNormals(sl);
    parts.push(sl);
  }

  // forearm wrap — one arm only, so the figure is never mirror-symmetric
  if (S.lod >= 1 && S.wrapSide === side) {
    const pad = newPart('pad');
    const pr = [];
    for (let i = 0; i < 5; i++) {
      const t = mix(1.52, 1.86, i / 4);
      const c = chainPoint(ch, t);
      const d = chainDir(ch, t);
      const f = frame(d, UP);
      const r = curve(ARM_R, t) * S.gs * S.gir * S.armGirth * (1.10 - 0.03 * Math.abs(i - 2));
      pr.push({ c, u: f.u, v: f.v, rx: r, ry: r, w: chainWeights(ch, t, 0.30), vc: i / 4 });
    }
    loft(pad, pr, S.seg.arm, {});
    computeNormals(pad);
    parts.push(pad);
  }
}

function sleeveProf(S, a) {
  const nz = S.noise;
  return (rad) => 1
    + S.foldAmp * 1.5 * nz(Math.atan2(rad[2], rad[0]) * 2.6, a * 6.0 + 61.0)
    - 0.05 * smooth01((a - 0.86) / 0.14) * lobe(rad, [0, -1, 0], 2.0);
}

function armProf(S, t, side) {
  const nz = S.noise;
  const delt = smooth01((0.26 - t) / 0.26);
  const bi = smooth01((t - 0.14) / 0.22) * (1 - smooth01((t - 0.62) / 0.22));
  const fore = smooth01((t - 1.02) / 0.16) * (1 - smooth01((t - 1.36) / 0.24));
  const front = side === 'L' ? FRONT : FRONT;
  return (rad) => {
    let s = 1;
    if (delt > 0.001) s += delt * 0.14 * Math.pow(Math.max(0, rad[1]), 1.4);
    if (bi > 0.001) {
      s += bi * 0.13 * lobe(rad, front, 2.0) * S.muscle;
      s += bi * 0.09 * lobe(rad, BACK, 2.4) * S.muscle;   // triceps
    }
    if (fore > 0.001) {
      s += fore * 0.10 * lobe(rad, BACK, 1.8) * S.muscle;
      s += fore * 0.05 * lobe(rad, front, 2.6) * S.muscle;
    }
    s += S.foldAmp * 0.5 * nz(rad[0] * 6.0 + 5.0, t * 6.0);
    return s;
  };
}

/* -------------------------------------------------------- pelvis and pants */

const LEG_R = [
  0.00, 0.104, 0.14, 0.121, 0.32, 0.125, 0.56, 0.116,
  0.80, 0.101, 1.00, 0.094, 1.10, 0.092, 1.20, 0.094, 1.26, 0.099,
];
const SOCK_R = [
  1.17, 0.080, 1.33, 0.089, 1.52, 0.075, 1.72, 0.057, 1.90, 0.046, 1.98, 0.045,
];

export function buildPelvis(S, parts) {
  const { gs, BI } = S;
  const pants = newPart('pants');
  const rings = [];
  const N = Math.max(6, S.rows.pad - 3);
  const yTopP = S.yHem + 0.055 * gs;
  const yBot = S.yHip - 0.100 * gs;
  for (let i = 0; i < N; i++) {
    const a = i / (N - 1);
    const y = mix(yTopP, yBot, a);
    const rx = mix(0.126, 0.194, smooth01(a * 0.98)) * gs * S.hipW;
    const rz = mix(0.096, 0.156, smooth01(a * 0.98)) * gs * S.torsoD;
    rings.push({
      c: [0, y, (-0.004 - 0.010 * a) * gs],
      u: [1, 0, 0], v: [0, 0, 1],
      rx, ry: rz, w: [[BI.hips, 1]], vc: a,
      prof: pelvisProf(S, a),
    });
  }
  loft(pants, rings, S.seg.torso, { capStart: true, uFn: (x) => (x + 0.25) % 1 });
  computeNormals(pants);
  parts.push(pants);
}

function pelvisProf(S) {
  const n = 2.3;
  return (rad, _i, th) => {
    const c = Math.abs(Math.cos(th)), s = Math.abs(Math.sin(th));
    let k = 1 / Math.pow(Math.pow(c, n) + Math.pow(s, n), 1 / n);
    k += 0.055 * lobe(rad, BACK, 2.0);   // seat
    return k;
  };
}

export function buildLeg(S, parts, side) {
  const ch = S.chains[side === 'L' ? 'legL' : 'legR'];
  const pants = newPart('pants');
  const N = S.rows.leg;
  const rings = [];
  for (let i = 0; i < N; i++) {
    const t = (i / (N - 1)) * 1.255;
    const c = chainPoint(ch, t);
    const d = chainDir(ch, t);
    const f = frame(d, FRONT);
    const r = curve(LEG_R, t) * S.gs * S.gir * S.legGirth;
    rings.push({
      c, u: f.u, v: f.v, rx: r, ry: r,
      w: chainWeights(ch, t, 0.28), vc: t / 1.255,
      prof: pantProf(S, t),
    });
  }
  loft(pants, rings, S.seg.leg, { capStart: true, capEnd: true });
  computeNormals(pants);
  parts.push(pants);

  // sock: knee-high, thick over the calf, tapering hard into the ankle
  const sock = newPart('sock');
  const M = S.rows.sock;
  const sRings = [];
  for (let i = 0; i < M; i++) {
    const t = mix(1.172, 1.975, i / (M - 1));
    const c = chainPoint(ch, t);
    const d = chainDir(ch, t);
    const f = frame(d, FRONT);
    const r = curve(SOCK_R, t) * S.gs * S.gir * S.legGirth;
    sRings.push({
      c, u: f.u, v: f.v, rx: r, ry: r,
      w: chainWeights(ch, t, 0.28), vc: i / (M - 1),
      prof: sockProf(S, t),
    });
  }
  loft(sock, sRings, S.seg.leg, { capStart: true });
  computeNormals(sock);
  parts.push(sock);
}

function pantProf(S, t) {
  const nz = S.noise;
  const thighPad = smooth01((t - 0.13) / 0.12) * (1 - smooth01((t - 0.50) / 0.16));
  const kneePad = smooth01((t - 0.86) / 0.10) * (1 - smooth01((t - 1.10) / 0.10));
  const glute = smooth01((0.22 - t) / 0.22);
  return (rad) => {
    let s = 1;
    if (thighPad > 0.001) s += thighPad * 0.105 * lobe(rad, FRONT, 1.7);
    if (kneePad > 0.001) s += kneePad * 0.125 * lobe(rad, FRONT, 1.5);
    if (glute > 0.001) s += glute * 0.06 * lobe(rad, BACK, 2.0);
    s += S.foldAmp * 0.75 * nz(rad[0] * 5.0 + 21.0, t * 5.5);
    return s;
  };
}

function sockProf(S, t) {
  const nz = S.noise;
  const calf = smooth01((t - 1.20) / 0.12) * (1 - smooth01((t - 1.48) / 0.18));
  return (rad) => {
    let s = 1;
    if (calf > 0.001) s += calf * 0.10 * lobe(rad, BACK, 1.8);
    s += S.foldAmp * 0.5 * nz(rad[0] * 7.0 + 44.0, t * 9.0);
    return s;
  };
}

/* --------------------------------------------------------- neck and head */

export function buildNeck(S, parts) {
  const { gs, BI } = S;
  const skin = newPart('skin');
  const rings = [];
  const yA = S.yNeck - 0.120 * gs;
  const yB = S.yNeck + 0.085 * gs;
  const N = 7;
  for (let i = 0; i < N; i++) {
    const a = i / (N - 1);
    const y = mix(yA, yB, a);
    const r = mix(0.112, 0.082, smooth01(a)) * gs * S.neckG;
    rings.push({
      c: [0, y, 0.006 * gs],
      u: [1, 0, 0], v: [0, 0, 1],
      rx: r, ry: r * 0.94,
      w: w2(BI.chest, BI.neck, smooth01((a - 0.1) / 0.7)), vc: a,
      prof: (rad) => 1 + 0.10 * lobe(rad, BACK, 1.6) * (1 - a) - 0.03 * lobe(rad, FRONT, 3.0),
    });
  }
  loft(skin, rings, 14, {});
  computeNormals(skin);
  parts.push(skin);

  // collar band of the undershirt, visible above the jersey neckline
  if (S.lod >= 1) {
    const us = newPart('undershirt');
    const r2 = [];
    for (let i = 0; i < 4; i++) {
      const a = i / 3;
      const y = mix(S.yNeck - 0.085 * gs, S.yNeck - 0.020 * gs, a);
      const r = mix(0.098, 0.082, a) * gs * S.neckG;
      r2.push({
        c: [0, y, 0.006 * gs], u: [1, 0, 0], v: [0, 0, 1],
        rx: r, ry: r * 0.94, w: [[BI.neck, 1]], vc: a,
      });
    }
    loft(us, r2, 14, {});
    computeNormals(us);
    parts.push(us);
  }
}

/**
 * The head. Almost all of it is inside the helmet — what matters is that the face fills
 * the eye port so the mask reads as bars over a face rather than bars over a hole.
 */
export function buildHead(S, parts) {
  const { gs, BI } = S;
  const skin = newPart('skin');
  const c0 = [0, S.yHeadC - 0.004 * gs, 0.016 * gs];
  const NU = S.rows.headU;
  const NV = S.rows.headV;
  const rx = 0.090 * gs * S.headS, ry = 0.110 * gs * S.headS, rz = 0.108 * gs * S.headS;
  const rowIds = [];
  for (let iv = 0; iv < NV; iv++) {
    const ph = (iv / (NV - 1)) * Math.PI;
    const row = [];
    for (let iu = 0; iu < NU; iu++) {
      const th = (iu / NU) * Math.PI * 2;
      const sx = Math.sin(ph) * Math.cos(th);
      const sy = Math.cos(ph);
      const sz = Math.sin(ph) * Math.sin(th);
      let x = sx * rx, y = sy * ry, z = sz * rz;
      const down = clamp01(-sy);
      // jaw: narrows and pushes forward
      x *= 1 - 0.26 * down * down;
      z += 0.030 * gs * down * down * S.headS;
      y -= 0.020 * gs * down;
      // brow + nose
      const f = clamp01(sz);
      z += 0.012 * gs * f * bump(sy - 0.12, 0.34) * S.headS;
      z += 0.020 * gs * Math.pow(f, 3) * bump(sy + 0.06, 0.20) * bump(sx, 0.30) * S.headS;
      row.push(addVert(skin, [c0[0] + x, c0[1] + y, c0[2] + z], iu / NU, iv / (NV - 1), [[BI.head, 1]]));
    }
    rowIds.push(row);
  }
  for (let iv = 0; iv < NV - 1; iv++) {
    for (let iu = 0; iu < NU; iu++) {
      const iu2 = (iu + 1) % NU;
      addQuad(skin, rowIds[iv][iu], rowIds[iv + 1][iu], rowIds[iv + 1][iu2], rowIds[iv][iu2]);
    }
  }
  computeNormals(skin);
  parts.push(skin);
}

export default {
  buildTorso, buildShoulderPads, buildArm, buildPelvis, buildLeg, buildNeck, buildHead,
};
