// PIECE: pose-animation
// OWNER: this directory ONLY. Never edit anything outside src/pieces/pose-animation/.
// SLOT:  world.pose
// REGISTER VIA: registerWorld('pose', impl)
// JUDGED ON: pose language: weight, extension, follow-through, contact deformation
// HERO PANELS: truck, catch
//
// ---------------------------------------------------------------------------
// PLACEHOLDER. Registers nothing, exports nothing. The foundation fallback stays
// installed until you replace this file. Delete this comment block when you build.
// ---------------------------------------------------------------------------
//
// 1. Build your implementation in files inside this directory.
// 2. Register it here as an import side effect:
//
//   import { registerWorld } from '../../foundation/registry.js';
//   import { REST, resetToRest } from '../../foundation/rig.js';
//   // registerWorld('pose', { piece:PIECE, list(), apply(skeleton, poseId, phase, seed), velocityHint(poseId, phase) });
//
// 3. Register at least ONE isolation scene you alone own, so a blind critic can
//    pose exactly your contribution and score it without a neighbour masking it:
//
//   import { registerIsoShot } from '../../foundation/registry.js';
//   registerIsoShot('iso:pose-animation', {
//     piece: PIECE,
//     panel: 'truck',                 // the bar panel this is judged against
//     camera: { pos:[0,1.6,6], target:[0,1.2,0], fov:35 },
//     actors: [ /* ... */ ],
//     hud: { visible:false },
//     note: 'what this shot is meant to prove',
//   });
//
// 4. Capture:
//   node scripts/shoot.mjs --piece=pose-animation
//   node scripts/shoot.mjs --scene=truck --out=shots/pose-animation/truck.png
//   node scripts/shoot.mjs --scene=catch --out=shots/pose-animation/catch.png
//   node scripts/compare.mjs --panel=truck --shot=shots/pose-animation/truck.png --out=shots/pose-animation/cmp.png
//
// 5. DETERMINISM IS ENFORCED. No Math.random / Date.now / performance.now anywhere
//    under src/pieces/ — use makeRng(seed) from ../../foundation/rng.js and make all
//    animation a pure function of the simulated time `t`.
//    node scripts/lint-determinism.mjs

export const PIECE = 'pose-animation';
