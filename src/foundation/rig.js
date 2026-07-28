// FOUNDATION — FROZEN after t=0. Do not edit.
//
// THE RIG. 26 bones. This file is the seam that lets three different agents build
// geometry (character-anatomy), materials (uniform-kit) and motion (pose-animation)
// without ever touching the same file.
//
//   anatomy  : skins a SkinnedMesh to makeSkeleton(). Writes geometry + skin weights.
//   uniform  : writes ONLY materials (matSet keyed by MAT_SLOTS).
//   pose     : writes ONLY bone .quaternion / .position. Never geometry, never materials.
//
// CONVENTIONS (do not renegotiate):
//   * +Y up, +Z forward (the player faces +Z), +X to the player's LEFT.
//   * metres. Canonical actor is 1.88 m tall with the hip bone at y = 0.98.
//   * The bind pose is a wide A-pose.
//   * EVERY bone's rest quaternion is IDENTITY and every bone's local axes are
//     world-aligned at bind. This is deliberate: a pose author reasons in plain
//     world axes ("rotate upperarm_L about -Z to raise the arm") with no bone-roll
//     bookkeeping. REST[name].dir gives the unit vector toward the primary child so
//     limb-space maths is still available when you want it.

import * as THREE from 'three';

/** Ordered bone list. Index in this array === skinIndex. FROZEN. */
export const BONES = Object.freeze([
  'root',
  'hips',
  'spine01',
  'spine02',
  'chest',
  'neck',
  'head',
  'clavicle_L',
  'clavicle_R',
  'upperarm_L',
  'upperarm_R',
  'forearm_L',
  'forearm_R',
  'hand_L',
  'hand_R',
  'thigh_L',
  'thigh_R',
  'shin_L',
  'shin_R',
  'foot_L',
  'foot_R',
  'toe_L',
  'toe_R',
]);

/** Parent of each bone (null for root). FROZEN. */
export const PARENT = Object.freeze({
  root: null,
  hips: 'root',
  spine01: 'hips',
  spine02: 'spine01',
  chest: 'spine02',
  neck: 'chest',
  head: 'neck',
  clavicle_L: 'chest',
  clavicle_R: 'chest',
  upperarm_L: 'clavicle_L',
  upperarm_R: 'clavicle_R',
  forearm_L: 'upperarm_L',
  forearm_R: 'upperarm_R',
  hand_L: 'forearm_L',
  hand_R: 'forearm_R',
  thigh_L: 'hips',
  thigh_R: 'hips',
  shin_L: 'thigh_L',
  shin_R: 'thigh_R',
  foot_L: 'shin_L',
  foot_R: 'shin_R',
  toe_L: 'foot_L',
  toe_R: 'foot_R',
});

/**
 * Canonical A-pose WORLD positions, metres, for the 1.88 m reference actor.
 * Local rest positions in REST are derived from these (all rest rotations identity,
 * so local position == worldPos - parentWorldPos).
 * FROZEN.
 */
const WORLD_REST = Object.freeze({
  root: [0.000, 0.000, 0.000],
  hips: [0.000, 0.980, 0.000],
  spine01: [0.000, 1.085, 0.000],
  spine02: [0.000, 1.200, 0.000],
  chest: [0.000, 1.325, 0.000],
  neck: [0.000, 1.540, 0.005],
  head: [0.000, 1.635, 0.010],
  clavicle_L: [0.040, 1.480, 0.010],
  clavicle_R: [-0.040, 1.480, 0.010],
  upperarm_L: [0.195, 1.455, 0.005],
  upperarm_R: [-0.195, 1.455, 0.005],
  forearm_L: [0.415, 1.235, 0.005],
  forearm_R: [-0.415, 1.235, 0.005],
  hand_L: [0.610, 1.040, 0.005],
  hand_R: [-0.610, 1.040, 0.005],
  thigh_L: [0.095, 0.945, 0.000],
  thigh_R: [-0.095, 0.945, 0.000],
  shin_L: [0.100, 0.500, 0.005],
  shin_R: [-0.100, 0.500, 0.005],
  foot_L: [0.105, 0.075, -0.010],
  foot_R: [-0.105, 0.075, -0.010],
  toe_L: [0.108, 0.030, 0.145],
  toe_R: [-0.108, 0.030, 0.145],
});

/** Primary child used to define a bone's `dir` / `len`. */
const PRIMARY_CHILD = Object.freeze({
  root: 'hips',
  hips: 'spine01',
  spine01: 'spine02',
  spine02: 'chest',
  chest: 'neck',
  neck: 'head',
  head: null,
  clavicle_L: 'upperarm_L',
  clavicle_R: 'upperarm_R',
  upperarm_L: 'forearm_L',
  upperarm_R: 'forearm_R',
  forearm_L: 'hand_L',
  forearm_R: 'hand_R',
  hand_L: null,
  hand_R: null,
  thigh_L: 'shin_L',
  thigh_R: 'shin_R',
  shin_L: 'foot_L',
  shin_R: 'foot_R',
  foot_L: 'toe_L',
  foot_R: 'toe_R',
  toe_L: null,
  toe_R: null,
});

/** Terminal-bone tip offsets (world, at bind) so anatomy can cap the chain. */
export const TIPS = Object.freeze({
  head: [0.000, 1.880, 0.010],     // crown
  hand_L: [0.700, 0.955, 0.005],
  hand_R: [-0.700, 0.955, 0.005],
  toe_L: [0.110, 0.022, 0.235],
  toe_R: [-0.110, 0.022, 0.235],
});

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function len3(a) { return Math.hypot(a[0], a[1], a[2]); }
function norm3(a) { const l = len3(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

/**
 * REST[name] = {
 *   name, parent, index,
 *   pos:[x,y,z]      local rest translation (parent-relative)
 *   quat:[0,0,0,1]   local rest rotation — ALWAYS identity, by contract
 *   world:[x,y,z]    world rest position
 *   dir:[x,y,z]      unit vector toward the primary child (or tip) at bind
 *   len:number       distance to that child / tip (0 for pure leaf)
 * }
 */
export const REST = (() => {
  const out = {};
  BONES.forEach((name, index) => {
    const p = PARENT[name];
    const w = WORLD_REST[name];
    const pw = p ? WORLD_REST[p] : [0, 0, 0];
    out[name] = {
      name,
      parent: p,
      index,
      pos: sub(w, pw),
      quat: [0, 0, 0, 1],
      world: w.slice(),
      dir: [0, 1, 0],
      len: 0,
    };
  });
  BONES.forEach((name) => {
    const child = PRIMARY_CHILD[name];
    const to = child ? WORLD_REST[child] : TIPS[name];
    if (!to) return;
    const d = sub(to, WORLD_REST[name]);
    out[name].len = len3(d);
    out[name].dir = norm3(d);
  });
  return Object.freeze(out);
})();

/** Socket name -> bone name. Actors expose Object3D handles at these bones. */
export const SOCKETS = Object.freeze({
  head: 'head',
  rightHand: 'hand_R',
  leftHand: 'hand_L',
  chest: 'chest',
  hips: 'hips',
  rightFoot: 'foot_R',
  leftFoot: 'foot_L',
});

/**
 * Per-archetype build parameters. anatomy MUST honour these; pose MAY read them.
 * Multipliers are applied to the canonical rest skeleton by makeSkeleton({archetype}).
 */
export const PROPORTIONS = Object.freeze({
  qb: Object.freeze({
    heightM: 1.91, massKg: 100,
    arm: 1.02, leg: 1.03, torso: 1.00,
    shoulderWidth: 1.00, hipWidth: 0.97, neckGirth: 1.00,
    padBulk: 0.85, limbGirth: 0.95, headScale: 1.00,
  }),
  skill: Object.freeze({
    heightM: 1.85, massKg: 96,
    arm: 1.03, leg: 1.05, torso: 0.98,
    shoulderWidth: 1.02, hipWidth: 0.96, neckGirth: 1.02,
    padBulk: 0.90, limbGirth: 1.00, headScale: 1.00,
  }),
  lineman: Object.freeze({
    heightM: 1.96, massKg: 145,
    arm: 1.00, leg: 0.96, torso: 1.06,
    shoulderWidth: 1.20, hipWidth: 1.18, neckGirth: 1.28,
    padBulk: 1.25, limbGirth: 1.30, headScale: 1.02,
  }),
  lb: Object.freeze({
    heightM: 1.89, massKg: 115,
    arm: 1.01, leg: 1.00, torso: 1.02,
    shoulderWidth: 1.12, hipWidth: 1.03, neckGirth: 1.16,
    padBulk: 1.10, limbGirth: 1.14, headScale: 1.00,
  }),
});

export const REFERENCE_HEIGHT_M = 1.88;
export const HIP_HEIGHT_M = 0.98;

const ARM_CHAIN = ['clavicle_L', 'clavicle_R', 'upperarm_L', 'upperarm_R', 'forearm_L', 'forearm_R', 'hand_L', 'hand_R'];
const LEG_CHAIN = ['thigh_L', 'thigh_R', 'shin_L', 'shin_R', 'foot_L', 'foot_R', 'toe_L', 'toe_R'];
const TORSO_CHAIN = ['spine01', 'spine02', 'chest', 'neck', 'head'];

/**
 * Build the bone hierarchy + THREE.Skeleton.
 *
 *   const { bones, boneByName, skeleton, root } = makeSkeleton({ archetype:'lb', heightM:1.9 });
 *
 * `bones` is in BONES order, so skinIndex i === BONES[i].
 * The returned root Bone must be added to the actor's root Object3D by anatomy.
 * Nothing here is shared between actors — call it once per actor.
 */
export function makeSkeleton(opts = {}) {
  const archetype = PROPORTIONS[opts.archetype] ? opts.archetype : 'skill';
  const P = PROPORTIONS[archetype];
  const heightM = Number(opts.heightM) || P.heightM;
  const globalScale = heightM / REFERENCE_HEIGHT_M;

  const bones = [];
  const boneByName = Object.create(null);

  for (const name of BONES) {
    const r = REST[name];
    const b = new THREE.Bone();
    b.name = name;
    let [x, y, z] = r.pos;

    // Segment-length multipliers.
    if (ARM_CHAIN.includes(name)) { x *= P.arm; y *= P.arm; z *= P.arm; }
    else if (LEG_CHAIN.includes(name)) { x *= P.leg; y *= P.leg; z *= P.leg; }
    else if (TORSO_CHAIN.includes(name)) { y *= P.torso; }

    // Width multipliers (applied to the lateral component of the girdle bones).
    if (name === 'clavicle_L' || name === 'clavicle_R') x *= P.shoulderWidth;
    if (name === 'upperarm_L' || name === 'upperarm_R') x *= P.shoulderWidth;
    if (name === 'thigh_L' || name === 'thigh_R') x *= P.hipWidth;

    b.position.set(x * globalScale, y * globalScale, z * globalScale);
    b.quaternion.set(0, 0, 0, 1);
    b.scale.set(1, 1, 1);
    bones.push(b);
    boneByName[name] = b;
  }

  for (const name of BONES) {
    const p = PARENT[name];
    if (p) boneByName[p].add(boneByName[name]);
  }

  const root = boneByName.root;
  root.updateMatrixWorld(true);

  const skeleton = new THREE.Skeleton(bones);
  skeleton.userData = { archetype, heightM, globalScale, proportions: P };

  return { bones, boneByName, skeleton, root, archetype, heightM, globalScale, proportions: P };
}

/**
 * Reset every bone to its rest transform. pose.apply() implementations should call
 * this first (or write every bone) so a pose never inherits the previous pose.
 */
export function resetToRest(skeletonOrBones) {
  const bones = skeletonOrBones.bones || skeletonOrBones;
  const s = (skeletonOrBones.userData && skeletonOrBones.userData.globalScale) || 1;
  for (const b of bones) {
    const r = REST[b.name];
    if (!r) continue;
    b.quaternion.set(0, 0, 0, 1);
    // position is left alone for `root`/`hips` so a pose may translate the actor.
    if (b.name !== 'root' && b.name !== 'hips') {
      // keep the archetype-scaled rest translation the skeleton was built with
      // (do not overwrite; poses must not change bone lengths)
      continue;
    }
    if (b.name === 'root') b.position.set(0, 0, 0);
    if (b.name === 'hips') b.position.set(0, REST.hips.pos[1] * s, 0);
  }
}

/** Convenience: world-space rest position of a bone for a given global scale. */
export function restWorld(name, globalScale = 1) {
  const r = REST[name];
  return [r.world[0] * globalScale, r.world[1] * globalScale, r.world[2] * globalScale];
}

/** Quaternion that rotates unit vector `from` onto unit vector `to`. */
export function aimQuat(from, to, out) {
  const q = out || new THREE.Quaternion();
  const a = new THREE.Vector3().fromArray(from).normalize();
  const b = new THREE.Vector3().fromArray(to).normalize();
  q.setFromUnitVectors(a, b);
  return q;
}

export default { BONES, PARENT, REST, TIPS, SOCKETS, PROPORTIONS, makeSkeleton, resetToRest, restWorld, aimQuat };
