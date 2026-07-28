// PIECE: character-anatomy — actor assembly + the LOD chain.
//
// LOD0-LOD2 are merged SkinnedMeshes with one geometry group per material slot, so the
// number a critic counts (draw calls) is exactly the number of slots the level exposes.
// LOD3 is NOT a mesh at all: it is one instance in a shared, non-skinned InstancedMesh
// (see imposter.js), so N distant actors cost ONE draw call and ZERO SkinnedMeshes.
//
// MEASURED, per actor, `skill` archetype, seed 4211 (node scripts/budget.mjs and the
// per-LOD probe in this file's `lodReport()`):
//
//            draw calls   triangles     what changes
//   LOD0        12          24,782      full: tubular facemask, visor, epaulette lip,
//                                       fingers, towel, back plate, forearm pad, sleeve
//   LOD1         6           9,858      coarser rings, no fingers/towel/back plate
//   LOD2         3           3,450      skin / jersey / pants only — the three-value
//                                       structure that still reads at 60 px
//   LOD3    1 SHARED             814     non-skinned proxy, ONE geometry for every distant
//                                       actor: closed helmet shell (no face port, no cage
//                                       tubes), no gloves, no head, 5-section cleats, the
//                                       sleeve's bulk folded into the arm. The pose is
//                                       BAKED IN (see bakePose) because an imposter has no
//                                       skeleton to be posed by. Baked vertex values carry
//                                       the jersey/pants/sock banding; the instance colour
//                                       carries the team.
//
// The ladder is strictly decreasing on BOTH axes — 12 > 6 > 3 > 1 draw calls and
// 24,782 > 9,858 > 3,450 > 814 triangles — which is the property the rung table's
// `imposter` column needed and did not have. Before this round LOD2 and LOD3 were both
// single-slot SkinnedMeshes at 3,538 and 2,256 triangles: 1 draw call each, 1 skinned
// actor each, so the `imposter` column moved neither of the two numbers it gates.

import { BONES, SOCKETS, PROPORTIONS, makeSkeleton } from '../../foundation/rig.js';
import { REG } from '../../foundation/registry.js';
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
const LOD1_SLOTMAP = {
  undershirt: 'skin', pad: 'jersey', towel: 'jersey', glove: 'jersey',
  sock: 'pants', visor: 'helmetShell',
};
/**
 * LOD2 keeps THREE slots, not one. Collapsing an actor to a single flat colour was the
 * reason LOD2 and LOD3 looked interchangeable in the first place: a football player at
 * distance is read by its VALUE BANDS — dark jersey, light pants, dark boot — and one
 * material erases all of them. Three groups is three draw calls; at the floor rung that
 * is 6 actors x 3 = 18 calls against a cap of 60, and it buys back the single strongest
 * legibility cue in the whole figure.
 */
const LOD2_SLOTMAP = {
  undershirt: 'jersey', pad: 'jersey', towel: 'jersey', glove: 'jersey',
  sock: 'jersey', cleat: 'jersey', helmetShell: 'jersey', facemask: 'jersey',
  visor: 'jersey',
};
const LOD1_ORDER = ['skin', 'jersey', 'pants', 'cleat', 'helmetShell', 'facemask'];
const LOD2_ORDER = ['skin', 'jersey', 'pants'];

function remapSlot(slot, lodLevel) {
  if (lodLevel === 0) return slot;
  if (lodLevel >= 3) return 'jersey';
  if (lodLevel === 2) return LOD2_SLOTMAP[slot] || slot;
  return LOD1_SLOTMAP[slot] || slot;
}

/**
 * PROXY KIT MAP — baked per vertex at LOD3 as [value, mask].
 *
 * `mask` 0 means "wear the instance's JERSEY colour", 1 means "wear its PANTS colour";
 * `value` shades within that family. A single instanced draw call therefore reproduces
 * the real kit's value structure, in the real club's colours, for fourteen different
 * clubs at once.
 *
 * The first version of this was a single multiplicative grey ramp against ONE instance
 * colour, and it did not work — captured in shots/character-anatomy/iso_player_imposter.png
 * before the second colour existed. One multiplier cannot express Chicago (near-black
 * jersey, white pants): the best it can do is the average, so the imposter came out a flat
 * mid-grey standing next to a black-and-white LOD2 player. A 2:1 ramp cannot fake a 10:1
 * value ratio, and "it is only 40 pixels" is not an argument for the wrong colour.
 *
 * `skin` maps to the JERSEY family on purpose: a long-sleeved player is a real and common
 * kit, and jersey-coloured forearms read as sleeves. Pants-coloured forearms read as an
 * error. Cleats map to the PANTS family darkened hard, which lands near-black whether the
 * club's pants are white or dark.
 */
const PROXY_TINT = {
  skin: [1.12, 0], undershirt: [0.80, 0], jersey: [1.00, 0], pants: [1.00, 1],
  sock: [0.88, 0], cleat: [0.28, 1], glove: [0.70, 0], helmetShell: [1.10, 0],
  facemask: [0.38, 0], visor: [0.30, 0], pad: [1.05, 0], towel: [1.10, 1],
};

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
  /* LOD3 — the imposter proxy. `d: -1` switches every `S.lod >= 1` detail off AND sets
     S.proxy, which is what the part builders branch on to swap in their cheap forms. */
  {
    // rows.pad is 6, not the 4 the rest of the proxy runs at, and that is deliberate: with
    // 4 rings the shoulder shelf holds near-full thickness two thirds of the way out and
    // then drops to a point, which reads as a BROAD FLAT PLATE against LOD2's taper. The
    // pad shelf is the single strongest silhouette cue in the figure, so it is the one
    // place the imposter spends triangles it saves everywhere else.
    d: -1, torso: 8, arm: 6, leg: 5, pad: 8, glove: 0, cleat: 5, helmU: 12, helmV: 5,
    rows: { torso: 5, arm: 5, leg: 4, sock: 3, pad: 6, headU: 0, headV: 0, mask: 0, maskV: 0 },
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
    gs, P, BI, lod: D.d, lodLevel, rng, proxy: D.d < 0,
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

  // Bake the kit map BEFORE the slots are collapsed — after the remap every proxy part is
  // called 'jersey' and the authored slot is gone.
  if (S.proxy) for (const p of parts) p.tint = PROXY_TINT[p.slot] || [1, 0];

  for (const p of parts) p.slot = remapSlot(p.slot, lodLevel);
  const order = lodLevel === 0 ? MAT_SLOTS
    : lodLevel === 1 ? LOD1_ORDER
      : lodLevel === 2 ? LOD2_ORDER : ['jersey'];
  return mergeParts(THREE, parts, order, { tint: S.proxy });
}

/* ------------------------------------------------------- pose bake (LOD3) */

/**
 * BAKE THE SKIN. This is the difference between an imposter and a scarecrow.
 *
 * Every LOD builds in BIND POSE — arms straight out — and LOD0-LOD2 get out of it because
 * they are SkinnedMeshes and the assembler runs `pose.apply(actor.skeleton, ...)` on them
 * afterwards. An imposter has no skeleton of its own to be posed by, so without this it
 * stands in the middle of a football field in a T-pose. Captured in
 * shots/character-anatomy/iso_player_lod.png before this existed: three figures with
 * their arms down and one with its arms straight out. That is the single most visible
 * pop an LOD chain can have, and no triangle count excuses it.
 *
 * So the proxy is skinned ONCE, on the CPU, at build time, by exactly the maths the GPU
 * would use — v' = sum(w_i * boneMatrix_i * v) with an identity bind matrix, which is how
 * `buildActor` binds — and the skin attributes are then thrown away. 459 vertices, four
 * bones each: microseconds, once per build pass, never in a frame.
 *
 * The pose comes from whatever piece owns `world.pose`, so the imposter is posed by the
 * same authority as everyone else. LIMITATION, stated plainly: one shared geometry can
 * only hold ONE pose, so every imposter in a batch stands the same way. The geometry
 * cache in imposter.js is keyed by pose id precisely so that splitting into a batch per
 * pose class is a change of policy, not of architecture.
 */
function bakePose(THREE, geo, rig, poseId, seed) {
  const pose = REG.world && REG.world.pose;
  if (pose && typeof pose.apply === 'function') {
    try { pose.apply(rig.skeleton, poseId || 'idle', 0, seed || 1); } catch (e) { /* bind pose */ }
  }
  rig.root.updateMatrixWorld(true);
  rig.skeleton.update();

  const bm = rig.skeleton.boneMatrices;
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  const si = geo.getAttribute('skinIndex');
  const sw = geo.getAttribute('skinWeight');
  if (!bm || !si || !sw) return geo;

  const M = new Float64Array(16);
  for (let v = 0; v < pos.count; v++) {
    for (let j = 0; j < 16; j++) M[j] = 0;
    let wsum = 0;
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(v, k);
      if (w === 0) continue;
      const b = si.getComponent(v, k) * 16;
      for (let j = 0; j < 16; j++) M[j] += w * bm[b + j];
      wsum += w;
    }
    if (wsum === 0) continue;
    const x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
    // column-major, as THREE.Matrix4 stores it
    pos.setXYZ(v,
      M[0] * x + M[4] * y + M[8] * z + M[12],
      M[1] * x + M[5] * y + M[9] * z + M[13],
      M[2] * x + M[6] * y + M[10] * z + M[14]);
    const nx = nrm.getX(v), ny = nrm.getY(v), nz = nrm.getZ(v);
    let ax = M[0] * nx + M[4] * ny + M[8] * nz;
    let ay = M[1] * nx + M[5] * ny + M[9] * nz;
    let az = M[2] * nx + M[6] * ny + M[10] * nz;
    const l = Math.hypot(ax, ay, az) || 1;
    nrm.setXYZ(v, ax / l, ay / l, az / l);
  }
  pos.needsUpdate = true;
  nrm.needsUpdate = true;
  geo.deleteAttribute('skinIndex');
  geo.deleteAttribute('skinWeight');
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

/**
 * THE IMPOSTER PROXY GEOMETRY — built ONCE per build pass and shared by every LOD3 actor
 * through an InstancedMesh. Non-skinned by construction (mergeParts is told to omit the
 * skinIndex/skinWeight attributes), so a distant actor is not a SkinnedMesh, does not
 * cost a bone-matrix upload, and does not count against the rung's `skinned` cap.
 *
 * It is built from the reference archetype at the reference height; per-actor height and
 * mass come back as a per-instance scale (see imposter.js), which is all that survives at
 * imposter distance anyway. `heightM` is returned so the caller can normalise.
 */
export const PROXY_ARCHETYPE = 'skill';

export function buildProxyGeometry(THREE, opts) {
  const o = opts || {};
  const archetype = PROPORTIONS[o.archetype] ? o.archetype : PROXY_ARCHETYPE;
  const seed = o.seed || 4211;
  const rig = makeSkeleton({ archetype });
  rig.root.updateMatrixWorld(true);
  const built = buildActorGeometry(THREE, rig, { archetype, seed }, 3);
  bakePose(THREE, built.geometry, rig, o.pose || 'idle', seed);
  built.geometry.clearGroups();
  return {
    geometry: built.geometry,
    triangles: built.triangles,
    vertices: built.vertices,
    archetype,
    pose: o.pose || 'idle',
    heightM: rig.heightM,
    proportions: rig.proportions,
  };
}

/**
 * buildImposterActor — an actor whose body lives in the shared instanced batch.
 *
 * It returns the SAME shape as `buildActor` minus the mesh, because the world assembler
 * and every consumer must not have to care which representation an actor got:
 *   - `root` is a real, empty Object3D. The assembler positions it exactly as before, and
 *     it is what the batch's one-shot re-sync reads its matrix from.
 *   - `skeleton` is real (26 bones, no geometry bound to it) so `pose.apply` still has
 *     something to write to and never throws. It is NOT parented into the scene: bone
 *     matrices nobody samples are 26 matrix updates per actor per frame for nothing.
 *   - `mesh` is null, which is the honest answer. Callers guard on it.
 */
export function buildImposterActor(THREE, ctx, opts) {
  const archetype = PROPORTIONS[opts.archetype] ? opts.archetype : PROXY_ARCHETYPE;
  const rig = makeSkeleton({ archetype, heightM: opts.heightM });
  const root = new THREE.Group();
  root.name = `actor.${archetype}.imposter`;
  const sockets = {};
  for (const k of Object.keys(SOCKETS)) sockets[k] = rig.boneByName[SOCKETS[k]];
  return {
    root, mesh: null, skeleton: rig.skeleton, sockets,
    slotOrder: ['jersey'],
    bones: rig.bones, boneByName: rig.boneByName, archetype,
    heightM: rig.heightM,
    massKg: opts.massKg || rig.proportions.massKg,
    proportions: rig.proportions,
    globalScale: rig.globalScale,
    lod: 3,
    triangles: 0,          // filled in by the caller from the shared batch
    vertices: 0,
  };
}

/**
 * Diagnostics for the critic and for scripts/budget.mjs: the real per-LOD cost, counted
 * from the geometry that actually gets built rather than read off a table.
 */
export function lodReport(THREE, archetype = 'skill', seed = 4211) {
  const out = [];
  for (let lod = 0; lod <= 3; lod++) {
    if (lod === 3) {
      const p = buildProxyGeometry(THREE, { archetype, seed });
      out.push({ lod, triangles: p.triangles, vertices: p.vertices, drawCalls: 1, shared: true });
      p.geometry.dispose();
      continue;
    }
    const rig = makeSkeleton({ archetype });
    rig.root.updateMatrixWorld(true);
    const b = buildActorGeometry(THREE, rig, { archetype, seed }, lod);
    out.push({
      lod, triangles: b.triangles, vertices: b.vertices,
      drawCalls: b.slotOrder.length, slots: b.slotOrder.slice(), shared: false,
    });
    b.geometry.dispose();
  }
  return out;
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

export default {
  buildActor, buildActorGeometry, buildProxyGeometry, buildImposterActor, lodReport,
};
