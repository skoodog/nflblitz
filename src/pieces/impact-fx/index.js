// PIECE: impact-fx
// OWNER: this directory ONLY. Never edit anything outside src/pieces/impact-fx/.
// SLOT:  world.fx
// REGISTER VIA: registerWorld('fx', impl)
// JUDGED ON: impact sparks, turf spray, debris, smoke, the flaming ball
// HERO PANELS: leveler, midair_hit
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
//   // registerWorld('fx', { piece:PIECE, build(ctx), emitImpact(pos,dir,power,kind), ball(ctx), update(t,ctx) });
//
// 3. Register at least ONE isolation scene you alone own, so a blind critic can
//    pose exactly your contribution and score it without a neighbour masking it:
//
//   import { registerIsoShot } from '../../foundation/registry.js';
//   registerIsoShot('iso:impact-fx', {
//     piece: PIECE,
//     panel: 'leveler',                 // the bar panel this is judged against
//     camera: { pos:[0,1.6,6], target:[0,1.2,0], fov:35 },
//     actors: [ /* ... */ ],
//     hud: { visible:false },
//     note: 'what this shot is meant to prove',
//   });
//
// 4. Capture:
//   node scripts/shoot.mjs --piece=impact-fx
//   node scripts/shoot.mjs --scene=leveler --out=shots/impact-fx/leveler.png
//   node scripts/shoot.mjs --scene=midair_hit --out=shots/impact-fx/midair_hit.png
//   node scripts/compare.mjs --panel=leveler --shot=shots/impact-fx/leveler.png --out=shots/impact-fx/cmp.png
//
// 5. DETERMINISM IS ENFORCED. No Math.random / Date.now / performance.now anywhere
//    under src/pieces/ — use makeRng(seed) from ../../foundation/rng.js and make all
//    animation a pure function of the simulated time `t`.
//    node scripts/lint-determinism.mjs

export const PIECE = 'impact-fx';
