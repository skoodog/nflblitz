// PIECE: pose-animation
// OWNER: this directory ONLY. Never edit anything outside src/pieces/pose-animation/.
// SLOT:  world.pose
// JUDGED ON: pose language: weight, extension, follow-through, contact deformation
// HERO PANELS: truck, catch
//
// WHAT REPLACED THE FALLBACK
//   rigkit.js  a world-direction posing kit + two-bone IK + a ground solver, because the
//              fallback's per-bone Euler approach makes every big angle fight its parent
//              and that is what keeps it stiff.
//   poses.js   all 19 pose ids, authored in degrees in the actor's own frame.
//
// CAPTURE
//   node scripts/shoot.mjs --piece=pose-animation --accum=8 --timeout=800000
//   node scripts/shoot.mjs --scene=iso_pose_truck --accum=8 --timeout=800000 \
//        --out=shots/pose-animation/truck.png
//   node scripts/compare.mjs --panel=truck --shot=shots/pose-animation/truck.png \
//        --out=shots/pose-animation/cmp-truck.png
//
// NOTE ON THE ISO SCENES BELOW. They are deliberately HUD-less and callout-less: the only
// thing in frame is bodies, so a blind critic scores the posing and not a neighbour's
// overlay. Actor `pos[1]` is literally height off the turf, because every pose grounds its
// lowest contact to the actor origin (see the convention note at the top of poses.js).

import * as THREE from 'three';
import { registerWorld, registerIsoShot } from '../../foundation/registry.js';
import { POSE_IDS, applyPose, velocityFor } from './poses.js';

export const PIECE = 'pose-animation';

const impl = {
  piece: PIECE,

  /**
   * The pose slot has no scene graph of its own — the assembler only ever calls
   * `pose.apply(actor.skeleton, ...)`. registerWorld validates every world slot the same
   * way and demands a build(ctx), so this is that contract and nothing more.
   */
  build() { return null; },

  list() { return POSE_IDS.slice(); },

  /** apply(skeleton, poseId, phase, seed) — writes ONLY bone.quaternion / bone.position. */
  apply(skeleton, poseId, phase = 0, seed = 0) {
    applyPose(skeleton, poseId, phase, seed);
  },

  /**
   * Rough velocity in the ACTOR's frame (+Z = the way he faces), m/s — same convention as
   * the foundation fallback, so callers keep rotating it by the actor's rotY.
   * `out` is an extension: pass a scratch Vector3 and this allocates nothing. The
   * fallback's signature returns a fresh vector, and fx could plausibly call this per
   * particle per frame, which is exactly the closure-and-vector garbage the foundation's
   * 8 MB heap-sawtooth cap exists to stop.
   */
  velocityHint(poseId, phase = 0, out) {
    return velocityFor(poseId, phase, out || new THREE.Vector3());
  },
};

registerWorld('pose', impl);

/* ------------------------------------------------------------------ iso set */

const OFF = { visible: false };
const NO_CALLOUT = { visible: false };
const NIGHT = { rain: 0.2, lightning: 0.25, haze: 0.55 };

function A(o) { return o; }

/**
 * HERO 1 — the collision. `truck` and `truck_recoil` are authored along the SAME force
 * line and this shot stages them on it.
 *
 * SOLVED, NOT EYEBALLED. The carrier is turned 61 deg off camera; the defender is placed
 * 0.75 m down the carrier's facing vector and rotated 180 deg to meet him, lifted 0.25 m
 * because he is already coming off the ground. Those two numbers come from measuring the
 * bones: the carrier's contact shoulder lands at world (-0.50, 1.25, 0.05) and the
 * defender's chest at (0.03, 1.41, 0.09) — 0.55 m apart, which is contact once you add
 * ~0.25 m of shoulder pad and ~0.20 m of chest. My first staging had them 1.35 m apart
 * (bone gap 1.14) and they read as two men near each other, not one collision.
 *
 * Read the frame along the line: trailing toe still dragging the turf -> hips -> dropped
 * right shoulder -> the defender's chest -> his head snapping back -> his feet leaving
 * the grass.
 */
registerIsoShot('iso_pose_truck', {
  piece: PIECE,
  panel: 'truck',
  // THIRD STAGING, and the previous two are worth recording.
  //  v1: camera 70 deg off the collision axis -> a clean side-on read of the force line,
  //      but we saw the carrier's BACK and the ball (carried on his left) was hidden.
  //  v2: same, plus the defender parked dead ahead of the carrier, so the defender simply
  //      eclipsed him.
  //  v3 (this one) copies bar/panel-truck.png instead: the hit is GLANCING. The defender
  //      is offset 0.62 m forward and 0.50 m to the carrier's RIGHT — his contact-shoulder
  //      side — which frees the front of the carrier for the lens. Camera sits 45 deg off
  //      his facing on the ball side, 4.2 m out, at chest height. Solved separation:
  //      11.1 deg, defender on the screen LEFT, which is where the panel puts him.
  //  v3.1: pulled in from 4.2 m to 3.7 m so the carrier fills more of the frame, and the
  //      two background actors moved: the chase LB was solving to 30.7 deg off-axis
  //      against a 30.0 deg horizontal half-FOV, i.e. sliced in half by the right edge
  //      (visible in shots/pose-animation/truck.png before this move). Now 22.2 deg.
  camera: { pos: [2.83, 1.50, -1.38], target: [-0.55, 1.18, -0.15], fov: 36, roll: 1.6 },
  lens: { fStop: 2.2, focusDist: 4.4, bokehScale: 1.15, shutter: 1 / 60 },
  exposure: 1.28,
  weather: NIGHT,
  actors: [
    A({
      id: 'carrier', team: 'CHI', variant: 'home', number: '32', name: 'RAZE', archetype: 'skill',
      pose: 'truck', phase: 0.62, pos: [-0.72, 0, -0.32], rotY: 1.07, hero: true, role: 'carrier',
      dirt: 0.6, seed: 11,
    }),
    A({
      id: 'trucked', team: 'LA', variant: 'away', number: '21', name: 'VANCE', archetype: 'skill',
      pose: 'truck_recoil', phase: 0.58, pos: [-0.42, 0.25, 0.42], rotY: 3.53, airborne: true,
      role: 'tackler', dirt: 0.7, seed: 12,
    }),
    A({
      id: 'down', team: 'LA', variant: 'away', number: '44', name: 'ORR', archetype: 'lb',
      pose: 'downed', phase: 0.7, pos: [-3.10, 0, 1.60], rotY: 2.35, dirt: 0.9, seed: 13,
    }),
    A({
      id: 'chase', team: 'LA', variant: 'away', number: '58', name: 'PIKE', archetype: 'lb',
      pose: 'sprint', phase: 0.28, pos: [-4.60, 0, -1.60], rotY: 1.15, seed: 14,
    }),
    A({
      id: 'blocker', team: 'CHI', variant: 'home', number: '77', name: 'DRAKE', archetype: 'lineman',
      pose: 'block', phase: 0.4, pos: [-6.20, 0, 0.90], rotY: -1.75, seed: 15,
    }),
  ],
  // Ball placed on the carrying hand: actor-local (0.50, 1.01, 0.59) -> world.
  ball: { pos: [0.05, 1.03, -0.47], flame: 0, visible: true },
  // FIRST CAPTURE PUT THE IMPACT FX ON THE CONTACT POINT AT POWER 1.7 AND IT ATE THE SHOT:
  // the flare covered both torsos, i.e. the exact thing this scene exists to show. Moved
  // to the trailing foot at power 0.45, so there is debris without a white hole where the
  // hero pose used to be. shots/pose-animation/it1_truck.png is the frame that taught me.
  fx: [{ kind: 'truck', pos: [-1.32, 0.22, -0.72], dir: [-0.80, 0.55, -0.24], power: 0.45, age: 0.08 }],
  hud: Object.assign({ teamA: 'DAL', teamB: 'LA' }, OFF),
  callout: NO_CALLOUT,
  turfDamage: [
    { type: 'skid', x: -1.9, z: -1.0, x1: -0.8, z1: -0.5, w: 0.5, strength: 1.0 },
    { type: 'divot', x: -0.55, z: -0.62, rot: 1.07, strength: 1.1 },
    { type: 'cleat', x: -1.25, z: -0.80, rot: 1.07, strength: 0.85 },
  ],
  note: 'HERO. truck + truck_recoil staged on one force line: driving knee at hip height, '
    + 'trailing toe still dragging, and the defender folded backward over the contact point.',
});

/**
 * HERO 2 — the catch. jump_catch at maximum extension with the ball placed exactly where
 * the IK put the fingertips (actor-local 0.07, 2.23, 0.28 -> world 0.14, 2.85, 0.25), and
 * a contested_catch defender raking up through it a beat late. Low camera looking UP,
 * which is the panel's staging and the only way an overhead reach reads as height.
 */
registerIsoShot('iso_pose_catch', {
  piece: PIECE,
  panel: 'catch',
  // Tightened after the first capture: the original 4.35 m / 34 deg left the top third of
  // the frame as empty sky. 3.65 m and the target raised to the chest fills it the way
  // bar/panel-catch.png does.
  camera: { pos: [0.86, 1.24, 3.65], target: [0.02, 2.06, 0.0], fov: 36, roll: 1.0 },
  lens: { fStop: 1.9, focusDist: 3.8, bokehScale: 1.3, shutter: 1 / 90 },
  exposure: 1.30,
  weather: NIGHT,
  actors: [
    A({
      id: 'wr', team: 'LA', variant: 'home', number: '87', name: 'BRAND', archetype: 'skill',
      pose: 'jump_catch', phase: 0.46, pos: [0, 0.62, 0], rotY: 0.25, airborne: true, hero: true,
      seed: 21,
    }),
    A({
      id: 'db', team: 'MIA', variant: 'away', number: '29', name: 'MERGE', archetype: 'skill',
      pose: 'contested_catch', phase: 0.62, pos: [-0.78, 0.72, -0.12], rotY: 0.62, airborne: true,
      dirt: 0.4, seed: 22,
    }),
  ],
  ball: { pos: [0.14, 2.90, 0.27], flame: 0, visible: true, spin: 4 },
  hud: Object.assign({ teamA: 'SEA', teamB: 'MIA' }, OFF),
  callout: NO_CALLOUT,
  note: 'HERO. Full-extension high point: fingertips 0.40 m above the crown, both hands on '
    + 'the ball, shoulders shrugged into the reach, one knee tucked and one leg trailing.',
});

/**
 * The pose sheet. Twelve grounded ids in two ranks so a critic can audit the whole
 * vocabulary — weight distribution, stance width, asymmetry — in one frame instead of
 * inferring it from two hero shots. Phases are staggered on purpose.
 */
const SHEET_FRONT = [
  ['sprint', 0.22, 'skill'], ['juke', 0.55, 'skill'], ['truck', 0.62, 'skill'],
  ['tackle_launch', 0.70, 'lb'], ['tackle_impact', 0.55, 'lb'], ['block', 0.45, 'lineman'],
];
const SHEET_BACK = [
  ['idle', 0.35, 'skill'], ['stance_offense', 0.5, 'lineman'], ['stance_defense', 0.4, 'lb'],
  ['dropback', 0.35, 'qb'], ['throw_release', 0.72, 'qb'], ['celebrate', 0.3, 'skill'],
];

registerIsoShot('iso_pose_sheet', {
  piece: PIECE,
  panel: 'truck',
  camera: { pos: [0.0, 2.35, 11.6], target: [0.0, 1.02, -0.55], fov: 40, roll: 0 },
  lens: { fStop: 6.3, focusDist: 12.0, bokehScale: 0.4, shutter: 1 / 200 },
  exposure: 1.20,
  weather: { rain: 0.12, lightning: 0.1, haze: 0.45 },
  actors: [].concat(
    SHEET_FRONT.map((p, i) => A({
      id: `f${i}`, team: 'CHI', variant: 'home', number: String(10 + i), name: p[0].toUpperCase(),
      archetype: p[2], pose: p[0], phase: p[1],
      pos: [(i - 2.5) * 1.62, 0, 1.75], rotY: 0.30, seed: 100 + i, dirt: 0.35,
    })),
    SHEET_BACK.map((p, i) => A({
      id: `b${i}`, team: 'LA', variant: 'away', number: String(60 + i), name: p[0].toUpperCase(),
      archetype: p[2], pose: p[0], phase: p[1],
      pos: [(i - 2.5) * 1.62 + 0.8, 0, -2.55], rotY: 0.30, seed: 200 + i, dirt: 0.3,
    })),
  ),
  hud: OFF,
  callout: NO_CALLOUT,
  note: 'Pose sheet: 12 grounded ids, two ranks, staggered phases. Audit weight, base '
    + 'width, hip/shoulder opposition and left-right asymmetry across the whole vocabulary.',
});

/**
 * The airborne set, which the sheet cannot show because those poses need height. Each
 * actor's pos[1] is real clearance above the turf, so the reach heights are comparable.
 */
const AIR = [
  ['dive_catch', 0.65, 0.35], ['jump_catch', 0.46, 0.62], ['contested_catch', 0.6, 0.55],
  ['airborne_hit', 0.6, 1.05], ['blown_back', 0.65, 0.85], ['truck_recoil', 0.58, 0.45],
];

registerIsoShot('iso_pose_air', {
  piece: PIECE,
  panel: 'catch',
  camera: { pos: [0.0, 1.95, 10.4], target: [0.0, 1.55, -0.2], fov: 38, roll: 0 },
  lens: { fStop: 6.3, focusDist: 10.6, bokehScale: 0.4, shutter: 1 / 200 },
  exposure: 1.20,
  weather: { rain: 0.15, lightning: 0.15, haze: 0.5 },
  actors: AIR.map((p, i) => A({
    id: `a${i}`, team: 'MIA', variant: 'home', number: String(20 + i), name: p[0].toUpperCase(),
    archetype: 'skill', pose: p[0], phase: p[1],
    pos: [(i - 2.5) * 1.85, p[2], 0], rotY: 0.55, airborne: true, seed: 300 + i, dirt: 0.4,
  })),
  hud: OFF,
  callout: NO_CALLOUT,
  note: 'Airborne set at true clearance: layout dive, high point, contest, flying hit, '
    + 'blown back, and the trucked body — the six poses the ground sheet cannot stage.',
});

export default impl;
