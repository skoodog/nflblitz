// PIECE: character-anatomy — actor assembly + the LOD chain.
//
// One actor == one merged SkinnedMesh with one geometry group per material slot, so the
// number a critic counts (draw calls) is exactly the number of slots the LOD level
// exposes. That is the whole reason the LOD chain is expressed as a SLOT MAP rather than
// as separate models: the silhouette is built once and never changes between levels, and
// only the material split (and the ring/segment density) comes down.
//
//   LOD0  12 slots  full: tubular facemask, visor, epaulette lip, fingers, towel,
//                   back plate, forearm pad, undershirt sleeve
//   LOD1   6 slots  same silhouette, coarser rings, no fingers/towel/back plate
//   LOD2   1 slot   same silhouette again, ~1/8 the triangles
//   LOD3   1 slot   ultra-coarse proxy for imposter batching (still the same read)

import { BONES, SOCKETS, PROPORTIONS, makeSkeleton } from '../../foundation/rig.js';
import { MAT_SLOTS } from '../../foundation/contracts.js';
import { makeRng } from '../../foundation/rng.js';
import texlab from '../../foundation/texlab.js';
import { mergeParts, mix, clamp01 } from './mesh.js';
import { makeChain } from './chain.js';
import {
  buildTorso, buildShoulderPads, buildArm, buildPelvis, buildLeg, buildNeck, buildHead,
} from './body.js';
import { buildHelmet } from './helmet.js';
import { buildGlove, buildCleat, buildBackPlate, buildTowel } from './gear.js';

/* -------------------------------------------------------------- LOD slots */

/** slot -> slot remap per LOD level. Absent key means "keep as authored". */
const LOD_SLOTMAP = [
  null,
  {
    undershirt: 'skin', pad: 'jersey', towel: 'jersey', glove: 'jersey',
    sock: 'pants', visor: 'helmetShell',
  },
  { /* LOD2: everything collapses to one */ },
  { },
];
const LOD1_ORDER = ['skin', 'jersey', 'pants', 'cleat', 'helmetShell', 'facemask'];

function remapSlot(slot, lodLevel) {
  if (lodLevel === 0) return slot;
  if (lodLevel >= 2) return 'jersey';
  const m = LOD_SLOTMAP[1][slot];
  return m || slot;
}

/* ------------------------------------------------------------------- spec */

const DETAIL = [
  /* LOD0 */ {
    d: 2, torso: 30, arm: 18, leg: 18, pad: 26, glove: 14, cleat: 16, helmU: 108, helmV: 60,
    rows: { torso: 30, arm: 26, leg: 22, sock: 12, pad: 13, headU: 20, headV: 14, mask: 13, maskV: 11 },
  },
  /* LOD1 */ {
    d: 1, torso: 20, arm: 11, leg: 11, pad: 16, glove: 9, cleat: 10, helmU: 44, helmV: 26,
    rows: { torso: 20, arm: 16, leg: 14, sock: 8, pad: 10, headU: 14, headV: 10, mask: 9, maskV: 7 },
  },
  /* LOD2 */ {
    d: 0, torso: 12, arm: 7, leg: 7, pad: 9, glove: 6, cleat: 7, helmU: 20, helmV: 12,
    rows: { torso: 12, arm: 9, leg: 9, sock: 6, pad: 7, headU: 10, headV: 7, mask: 7, maskV: 5 },
  },
  /* LOD3 */ {
    d: 0, torso: 8, arm: 5, leg: 5, pad: 6, glove: 5, cleat: 5, helmU: 12, helmV: 8,
    rows: { torso: 8, arm: 6, leg: 6, sock: 4, pad: 5, headU: 8, headV: 6, mask: 5, maskV: 4 },
  },
];

function worldPos(bone) {
  const e = bone.matrixWorld.elements;
  return [e[12], e[13], e[14]];
}

function buildSpec(rig, opts, lodLevel) {
  const { boneByName, proportions: P, globalScale: gs } = rig;
  const seed = (opts.seed | 0) || 1;
  const rng = makeRng(seed * 7919 + 13);
  const r = () => rng() * 2 - 1;
  const BI = {};
  for (let i = 0; i < BONES.length; i++) BI[BONES[i]] = i;

  const wp = (n) => worldPos(boneByName[n]);
  const D = DETAIL[lodLevel];

  const spineChain = makeChain(
    [wp('hips'), wp('spine01'), wp('spine02'), wp('chest'), wp('neck'), wp('head')],
    [BI.hips, BI.spine01, BI.spine02, BI.chest, BI.neck, BI.head],
  );

  const arm = (s) => {
    const ua = wp(`upperarm_${s}`), fa = wp(`forearm_${s}`), hd = wp(`hand_${s}`);
    const dir = [hd[0] - fa[0], hd[1] - fa[1], hd[2] - fa[2]];
    const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const tip = [hd[0] + dir[0] / l * 0.115 * gs, hd[1] + dir[1] / l * 0.115 * gs, hd[2] + dir[2] / l * 0.115 * gs];
    return makeChain([ua, fa, hd, tip], [BI[`upperarm_${s}`], BI[`forearm_${s}`], BI[`hand_${s}`], BI[`hand_${s}`]]);
  };
  const leg = (s) => makeChain(
    [wp(`thigh_${s}`), wp(`shin_${s}`), wp(`foot_${s}`), wp(`toe_${s}`)],
    [BI[`thigh_${s}`], BI[`shin_${s}`], BI[`foot_${s}`], BI[`toe_${s}`]],
  );

  const massR = clamp01(((opts.massKg || P.massKg) / P.massKg - 1) * 1.6 + 0.5);
  const hipsY = wp('hips')[1];
  const neckY = wp('neck')[1];
  const headY = wp('head')[1];

  const S = {
    gs, P, BI, lod: D.d, lodLevel, rng,
    seg: { torso: D.torso, arm: D.arm, leg: D.leg, pad: D.pad, glove: D.glove, cleat: D.cleat },
    helmU: D.helmU, helmV: D.helmV, rows: D.rows,
    sp: spineChain,
    chains: { armL: arm('L'), armR: arm('R'), legL: leg('L'), legR: leg('R') },

    // width knobs — archetype first, seeded variation second, and never enough to
    // break the read: an arcade lineman is still recognisably the same species.
    shw: P.shoulderWidth * (1 + 0.035 * r()),
    padBulk: P.padBulk * (1 + 0.030 * r()),
    gir: P.limbGirth * (1 + 0.035 * r()),
    hipW: P.hipWidth * (1 + 0.03 * r()),
    neckG: P.neckGirth * (1 + 0.04 * r()),
    headS: P.headScale * (1 + 0.025 * r()),
    torsoW: 1 + 0.055 * (massR - 0.5) * 2 + 0.02 * r(),
    torsoD: 1 + 0.075 * (massR - 0.5) * 2 + 0.02 * r(),
    armGirth: 1 + 0.05 * r(),
    legGirth: 1 + 0.05 * r(),
    handS: 1.06 + 0.06 * r(),
    footS: 1.0 + 0.05 * r(),
    muscle: mix(1.05, 0.72, clamp01((P.limbGirth - 0.95) / 0.4)),
    foldAmp: 0.020 + 0.008 * rng(),
    sleeveSide: rng() < 0.5 ? 'L' : 'R',
    wrapSide: rng() < 0.5 ? 'L' : 'R',
    towelSide: rng() < 0.55 ? 'L' : 'R',
    visor: lodLevel === 0 && rng() < 0.72,

    yHip: hipsY,
    yNeck: neckY,
    yHem: hipsY + 0.012 * gs,
    yTop: neckY - 0.010 * gs,
    yShoulder: neckY - 0.044 * gs,
    yHeadC: headY + 0.130 * gs * P.headScale,

    noise: (x, y) => texlab.noise2(x, y, seed & 0xffff),
  };
  S.yShoulder = neckY - 0.044 * gs + 0.010 * gs * (S.padBulk - 1) * 4;
  return S;
}

/* ------------------------------------------------------------------ build */

export function buildActorGeometry(THREE, rig, opts, lodLevel) {
  const S = buildSpec(rig, opts, lodLevel);
  const parts = [];

  buildPelvis(S, parts);
  buildLeg(S, parts, 'L');
  buildLeg(S, parts, 'R');
  buildCleat(S, parts, 'L');
  buildCleat(S, parts, 'R');
  buildTorso(S, parts);
  buildShoulderPads(S, parts, 'L');
  buildShoulderPads(S, parts, 'R');
  buildArm(S, parts, 'L');
  buildArm(S, parts, 'R');
  buildGlove(S, parts, 'L');
  buildGlove(S, parts, 'R');
  buildNeck(S, parts);
  buildHead(S, parts);
  buildHelmet(S, parts);
  buildBackPlate(S, parts);
  buildTowel(S, parts);

  for (const p of parts) p.slot = remapSlot(p.slot, lodLevel);
  const order = lodLevel === 0 ? MAT_SLOTS : lodLevel === 1 ? LOD1_ORDER : ['jersey'];
  return mergeParts(THREE, parts, order);
}

/**
 * build(ctx, {archetype, heightM, massKg, seed}) -> Actor
 * Actor = { root, mesh, skeleton, sockets, slotOrder, ... }
 */
export function buildActor(THREE, ctx, opts, lodLevel) {
  const archetype = PROPORTIONS[opts.archetype] ? opts.archetype : 'skill';
  const rig = makeSkeleton({ archetype, heightM: opts.heightM });
  const { bones, boneByName, skeleton, root: boneRoot, proportions: P, globalScale: gs } = rig;
  boneRoot.updateMatrixWorld(true);

  const root = new THREE.Group();
  root.name = `actor.${archetype}`;
  root.add(boneRoot);

  const built = buildActorGeometry(THREE, rig, opts, lodLevel);

  const placeholder = built.slotOrder.map(() => new THREE.MeshStandardMaterial({
    color: 0x8e8e93, roughness: 0.85, metalness: 0,
  }));
  const mesh = new THREE.SkinnedMesh(built.geometry, placeholder.length === 1 ? placeholder[0] : placeholder);
  mesh.name = 'actor.mesh';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  root.add(mesh);
  mesh.bind(skeleton, new THREE.Matrix4());

  const sockets = {};
  for (const k of Object.keys(SOCKETS)) sockets[k] = boneByName[SOCKETS[k]];

  return {
    root, mesh, skeleton, sockets,
    slotOrder: built.slotOrder,
    bones, boneByName, archetype,
    heightM: rig.heightM,
    massKg: opts.massKg || P.massKg,
    proportions: P,
    globalScale: gs,
    lod: lodLevel,
    triangles: built.triangles,
    vertices: built.vertices,
  };
}

export default { buildActor, buildActorGeometry };
