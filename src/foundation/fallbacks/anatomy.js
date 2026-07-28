// FOUNDATION FALLBACK — replaced by piece `character-anatomy` via registerWorld('anatomy', ...).
// Deliberately plain: untextured grey capsules, one per bone segment, rigidly skinned
// (every vertex bound 100% to a single bone) to the FROZEN 26-bone rig in rig.js.
// No muscle, no pads, no cloth, no helmet detail — but it *is* a real SkinnedMesh, so
// pose-animation and uniform-kit can both be built and judged against it on round 1.

import * as THREE from 'three';
import { BONES, REST, SOCKETS, PROPORTIONS, makeSkeleton } from '../rig.js';
import { MAT_SLOTS } from '../contracts.js';

const UP = new THREE.Vector3(0, 1, 0);

/** Which material slot each bone segment reads. */
const SEG_SLOT = {
  hips: 'pants', spine01: 'jersey', spine02: 'jersey', chest: 'jersey',
  neck: 'skin', head: 'helmetShell',
  clavicle_L: 'pad', clavicle_R: 'pad',
  upperarm_L: 'jersey', upperarm_R: 'jersey',
  forearm_L: 'skin', forearm_R: 'skin',
  hand_L: 'glove', hand_R: 'glove',
  thigh_L: 'pants', thigh_R: 'pants',
  shin_L: 'sock', shin_R: 'sock',
  foot_L: 'cleat', foot_R: 'cleat',
  toe_L: 'cleat', toe_R: 'cleat',
};

/** Segment radius (metres, reference actor) before limbGirth scaling. */
const SEG_R = {
  hips: 0.155, spine01: 0.150, spine02: 0.155, chest: 0.150,
  neck: 0.070, head: 0.115,
  clavicle_L: 0.075, clavicle_R: 0.075,
  upperarm_L: 0.062, upperarm_R: 0.062,
  forearm_L: 0.050, forearm_R: 0.050,
  hand_L: 0.048, hand_R: 0.048,
  thigh_L: 0.093, thigh_R: 0.093,
  shin_L: 0.068, shin_R: 0.068,
  foot_L: 0.052, foot_R: 0.052,
  toe_L: 0.045, toe_R: 0.045,
};

const CHILD = {
  hips: 'spine01', spine01: 'spine02', spine02: 'chest', chest: 'neck',
  neck: 'head', head: null,
  clavicle_L: 'upperarm_L', clavicle_R: 'upperarm_R',
  upperarm_L: 'forearm_L', upperarm_R: 'forearm_R',
  forearm_L: 'hand_L', forearm_R: 'hand_R',
  hand_L: null, hand_R: null,
  thigh_L: 'shin_L', thigh_R: 'shin_R',
  shin_L: 'foot_L', shin_R: 'foot_R',
  foot_L: 'toe_L', foot_R: 'toe_R',
  toe_L: null, toe_R: null,
};
function childOf(n) { return CHILD[n] || null; }

/** Append one source geometry, transformed, bound rigidly to boneIndex. */
function appendGeo(acc, geo, matrix, boneIndex) {
  const g = geo.clone();
  g.applyMatrix4(matrix);
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  const uv = g.attributes.uv;
  const idx = g.index;
  const base = acc.pos.length / 3;
  for (let i = 0; i < pos.count; i++) {
    acc.pos.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    acc.nrm.push(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
    acc.uv.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
    acc.si.push(boneIndex, 0, 0, 0);
    acc.sw.push(1, 0, 0, 0);
  }
  if (idx) for (let i = 0; i < idx.count; i++) acc.idx.push(base + idx.getX(i));
  else for (let i = 0; i < pos.count; i++) acc.idx.push(base + i);
  g.dispose();
}

const impl = {
  piece: 'foundation-fallback',

  /**
   * build(ctx, {archetype, heightM, massKg, seed}) -> Actor
   * Actor = { root, mesh, skeleton, sockets, slotOrder }
   */
  build(ctx, opts = {}) {
    const archetype = PROPORTIONS[opts.archetype] ? opts.archetype : 'skill';
    const rig = makeSkeleton({ archetype, heightM: opts.heightM });
    const { bones, boneByName, skeleton, root: boneRoot, proportions: P, globalScale: gs } = rig;
    for (const b of bones) b.userData.gs = gs;

    const root = new THREE.Group();
    root.name = `actor.${archetype}`;
    root.add(boneRoot);

    // --- build one capsule per segment, in bind-pose world space --------------
    const acc = { pos: [], nrm: [], uv: [], si: [], sw: [], idx: [] };
    const groups = [];      // {slot, start, count}
    const bySlot = new Map();

    boneRoot.updateMatrixWorld(true);
    const wp = new THREE.Vector3();
    const cp = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const m = new THREE.Matrix4();

    const order = BONES.filter((n) => n !== 'root' && SEG_R[n] !== undefined);
    // Sort so same-slot segments are contiguous -> one geometry group per slot.
    order.sort((a, b) => MAT_SLOTS.indexOf(SEG_SLOT[a]) - MAT_SLOTS.indexOf(SEG_SLOT[b]));

    for (const name of order) {
      const bone = boneByName[name];
      bone.getWorldPosition(wp);
      const child = childOf(name);
      let len;
      if (child) {
        boneByName[child].getWorldPosition(cp);
        dir.copy(cp).sub(wp);
        len = dir.length();
        dir.normalize();
      } else {
        len = REST[name].len * gs;
        dir.fromArray(REST[name].dir);
      }
      if (len < 1e-4) { len = 0.05 * gs; }

      const girth = (name === 'head' || name === 'neck') ? P.headScale : P.limbGirth;
      const pad = (name === 'chest' || name.startsWith('clavicle')) ? P.padBulk : 1;
      const r = SEG_R[name] * gs * girth * pad;

      let geo;
      if (name === 'head') geo = new THREE.SphereGeometry(r * 1.35, 16, 12);
      else geo = new THREE.CapsuleGeometry(r, Math.max(0.01, len - r * 0.6), 4, 12);

      q.setFromUnitVectors(UP, dir);
      const mid = wp.clone().addScaledVector(dir, len * 0.5);
      if (name === 'head') mid.copy(wp).addScaledVector(dir, len * 0.55);
      m.compose(mid, q, new THREE.Vector3(1, 1, 1));

      const startIdx = acc.idx.length;
      appendGeo(acc, geo, m, BONES.indexOf(name));
      geo.dispose();
      const slot = SEG_SLOT[name] || 'jersey';
      const count = acc.idx.length - startIdx;
      const last = groups[groups.length - 1];
      if (last && last.slot === slot) last.count += count;
      else groups.push({ slot, start: startIdx, count });
      bySlot.set(slot, true);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(acc.pos, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(acc.nrm, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(acc.uv, 2));
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(acc.si, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(acc.sw, 4));
    geometry.setIndex(acc.idx);
    geometry.computeBoundingSphere();

    const slotOrder = [];
    for (const g of groups) {
      let mi = slotOrder.indexOf(g.slot);
      if (mi < 0) { slotOrder.push(g.slot); mi = slotOrder.length - 1; }
      geometry.addGroup(g.start, g.count, mi);
    }

    const placeholder = slotOrder.map(() => new THREE.MeshStandardMaterial({
      color: 0x8e8e93, roughness: 0.85, metalness: 0.0,
    }));

    const mesh = new THREE.SkinnedMesh(geometry, placeholder);
    mesh.name = 'actor.mesh';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    root.add(mesh);
    mesh.bind(skeleton, new THREE.Matrix4());

    const sockets = {};
    for (const k of Object.keys(SOCKETS)) sockets[k] = boneByName[SOCKETS[k]];

    return {
      root, mesh, skeleton, sockets, slotOrder,
      bones, boneByName,
      archetype,
      heightM: rig.heightM,
      massKg: opts.massKg || P.massKg,
      proportions: P,
      globalScale: gs,
    };
  },

  /** Assign a matSet (MAT_SLOTS-keyed) onto an actor built by this module. */
  setMaterials(actor, matSet) {
    if (!actor || !actor.mesh) return;
    const fallbackMat = new THREE.MeshStandardMaterial({ color: 0x8e8e93, roughness: 0.85 });
    const arr = actor.slotOrder.map((s) => (matSet && matSet[s]) || fallbackMat);
    actor.mesh.material = arr.length === 1 ? arr[0] : arr;
  },
};

export default impl;
