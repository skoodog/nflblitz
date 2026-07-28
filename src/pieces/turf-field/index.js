// PIECE: turf-field
// OWNER: this directory ONLY. Never edit anything outside src/pieces/turf-field/.
// SLOT:  world.turf
// REGISTER VIA: registerWorld('turf', impl)
// JUDGED ON: wet torn turf that scatters and holds cleat marks
// HERO PANELS: truck, touchdown
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
//   import { FIELD } from '../../foundation/contracts.js';
//   // registerWorld('turf', { piece:PIECE, build(ctx), addDivot(x,z,dx,dz,s), addCleatMark(x,z,rotY,depth), addSkid(x0,z0,x1,z1,w), reset(), update(t,ctx) });
//
// 3. Register at least ONE isolation scene you alone own, so a blind critic can
//    pose exactly your contribution and score it without a neighbour masking it:
//
//   import { registerIsoShot } from '../../foundation/registry.js';
//   registerIsoShot('iso:turf-field', {
//     piece: PIECE,
//     panel: 'truck',                 // the bar panel this is judged against
//     camera: { pos:[0,1.6,6], target:[0,1.2,0], fov:35 },
//     actors: [ /* ... */ ],
//     hud: { visible:false },
//     note: 'what this shot is meant to prove',
//   });
//
// 4. Capture:
//   node scripts/shoot.mjs --piece=turf-field
//   node scripts/shoot.mjs --scene=truck --out=shots/turf-field/truck.png
//   node scripts/shoot.mjs --scene=touchdown --out=shots/turf-field/touchdown.png
//   node scripts/compare.mjs --panel=truck --shot=shots/turf-field/truck.png --out=shots/turf-field/cmp.png
//
// 5. DETERMINISM IS ENFORCED. No Math.random / Date.now / performance.now anywhere
//    under src/pieces/ — use makeRng(seed) from ../../foundation/rng.js and make all
//    animation a pure function of the simulated time `t`.
//    node scripts/lint-determinism.mjs

export const PIECE = 'turf-field';
