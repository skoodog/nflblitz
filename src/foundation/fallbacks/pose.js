// FOUNDATION FALLBACK — replaced by piece `pose-animation` via registerWorld('pose', ...).
// Deliberately plain: every pose id resolves to a stiff, near-A-pose stance with a
// single shoulder/hip offset so you can tell actors apart. No weight shift, no
// counter-rotation, no follow-through, no secondary motion.
//
// A pose implementation writes ONLY bone.quaternion / bone.position. Never geometry,
// never materials. See src/foundation/rig.js for the frozen bone list + axis contract.

import * as THREE from 'three';
import { REST, resetToRest } from '../rig.js';

/** The pose vocabulary every scene may request. pose-animation must cover all of these. */
export const POSE_IDS = [
  'idle',
  'stance_offense',
  'stance_defense',
  'dropback',
  'throw_release',
  'sprint',
  'juke',
  'truck',
  'truck_recoil',
  'dive_catch',
  'jump_catch',
  'contested_catch',
  'tackle_launch',
  'tackle_impact',
  'airborne_hit',
  'blown_back',
  'block',
  'celebrate',
  'downed',
];

const V = new THREE.Vector3();
const Q = new THREE.Quaternion();

function rot(bone, ax, ay, az) {
  Q.setFromEuler(new THREE.Euler(ax, ay, az, 'XYZ'));
  bone.quaternion.copy(Q);
}

const impl = {
  piece: 'foundation-fallback',

  list() { return POSE_IDS.slice(); },

  /**
   * apply(skeleton, poseId, phase, seed)
   * `skeleton` is a THREE.Skeleton whose .bones are in rig BONES order.
   */
  apply(skeleton, poseId, phase = 0, seed = 0) {
    if (!skeleton || !skeleton.bones) return;
    const bones = skeleton.bones;
    const by = Object.create(null);
    for (const b of bones) by[b.name] = b;
    resetToRest(skeleton);

    const k = Math.sin(phase * Math.PI) * 0.5 + 0.5;   // 0..1..0 shaping
    const gs = (skeleton.userData && skeleton.userData.globalScale) || 1;

    // Bring the arms down out of the wide A-pose to a neutral carriage.
    const armDrop = 0.55;
    if (by.upperarm_L) rot(by.upperarm_L, 0, 0, -armDrop);
    if (by.upperarm_R) rot(by.upperarm_R, 0, 0, armDrop);
    if (by.forearm_L) rot(by.forearm_L, 0, 0, -0.35);
    if (by.forearm_R) rot(by.forearm_R, 0, 0, 0.35);

    switch (poseId) {
      case 'sprint':
      case 'truck':
      case 'juke':
      case 'tackle_launch': {
        const s = Math.sin(phase * Math.PI * 2);
        if (by.thigh_L) rot(by.thigh_L, s * 0.9, 0, 0);
        if (by.thigh_R) rot(by.thigh_R, -s * 0.9, 0, 0);
        if (by.shin_L) rot(by.shin_L, Math.max(0, -s) * 1.2, 0, 0);
        if (by.shin_R) rot(by.shin_R, Math.max(0, s) * 1.2, 0, 0);
        if (by.spine02) rot(by.spine02, -0.22, 0, 0);
        if (by.upperarm_L) rot(by.upperarm_L, -s * 0.7, 0, -armDrop);
        if (by.upperarm_R) rot(by.upperarm_R, s * 0.7, 0, armDrop);
        break;
      }
      case 'dive_catch':
      case 'jump_catch':
      case 'contested_catch':
      case 'airborne_hit':
      case 'blown_back': {
        if (by.spine01) rot(by.spine01, -0.3, 0, 0);
        if (by.thigh_L) rot(by.thigh_L, -0.7, 0, 0);
        if (by.thigh_R) rot(by.thigh_R, -0.45, 0, 0);
        if (by.shin_L) rot(by.shin_L, 0.9, 0, 0);
        if (by.shin_R) rot(by.shin_R, 1.1, 0, 0);
        if (by.upperarm_L) rot(by.upperarm_L, -1.9, 0, -0.35);
        if (by.upperarm_R) rot(by.upperarm_R, -1.9, 0, 0.35);
        if (by.forearm_L) rot(by.forearm_L, -0.2, 0, 0);
        if (by.forearm_R) rot(by.forearm_R, -0.2, 0, 0);
        break;
      }
      case 'dropback':
      case 'throw_release': {
        if (by.upperarm_R) rot(by.upperarm_R, -2.1, 0, 0.5);
        if (by.forearm_R) rot(by.forearm_R, -1.2, 0, 0);
        if (by.upperarm_L) rot(by.upperarm_L, -0.9, 0, -0.7);
        if (by.spine02) rot(by.spine02, 0, 0.35, 0);
        if (by.thigh_L) rot(by.thigh_L, 0.35, 0, 0);
        if (by.thigh_R) rot(by.thigh_R, -0.35, 0, 0);
        break;
      }
      case 'downed': {
        if (by.hips) by.hips.position.set(0, 0.35 * gs, 0);
        if (by.spine01) rot(by.spine01, -1.2, 0, 0);
        break;
      }
      case 'stance_defense':
      case 'stance_offense':
      case 'block': {
        if (by.hips) by.hips.position.set(0, REST.hips.pos[1] * gs - 0.12 * gs, 0);
        if (by.thigh_L) rot(by.thigh_L, 0.5, 0, 0);
        if (by.thigh_R) rot(by.thigh_R, 0.5, 0, 0);
        if (by.shin_L) rot(by.shin_L, -0.8, 0, 0);
        if (by.shin_R) rot(by.shin_R, -0.8, 0, 0);
        if (by.spine01) rot(by.spine01, -0.4, 0, 0);
        break;
      }
      case 'celebrate': {
        if (by.upperarm_L) rot(by.upperarm_L, 0, 0, -2.3);
        if (by.upperarm_R) rot(by.upperarm_R, 0, 0, 2.3);
        break;
      }
      default:
        // 'idle', 'truck_recoil', 'tackle_impact' and anything unknown: stiff stance.
        if (by.spine01) rot(by.spine01, -0.08 * k, 0, 0);
        break;
    }
    void V; void seed;
    skeleton.bones[0].updateMatrixWorld(true);
  },

  /** Rough world-space velocity for motion blur / fx direction. */
  velocityHint(poseId, phase = 0) {
    const fast = { sprint: 9, truck: 8, juke: 6, tackle_launch: 8, airborne_hit: 7, blown_back: -6, dive_catch: 6 };
    const s = fast[poseId] || 0;
    return new THREE.Vector3(0, 0, s * (0.6 + 0.4 * Math.sin(phase * Math.PI)));
  },
};

export default impl;
