// PIECE: score-callout
// OWNER: this directory ONLY. Never edit anything outside src/pieces/score-callout/.
// SLOT:  ui.callout
// REGISTER VIA: registerUI('callout', impl)
// JUDGED ON: hand-lettered italic score callouts with gold numerals
// HERO PANELS: midair_hit, truck
//
// ---------------------------------------------------------------------------
// PLACEHOLDER. Registers nothing, exports nothing. The foundation fallback stays
// installed until you replace this file. Delete this comment block when you build.
// ---------------------------------------------------------------------------
//
// 1. Build your implementation in files inside this directory.
// 2. Register it here as an import side effect:
//
//   import { registerUI } from '../../foundation/registry.js';
//   // registerUI('callout', { piece:PIECE, draw(c2d, t, calloutState, ui){...} });
//
// 3. Register at least ONE isolation scene you alone own, so a blind critic can
//    pose exactly your contribution and score it without a neighbour masking it:
//
//   import { registerIsoShot } from '../../foundation/registry.js';
//   registerIsoShot('iso:score-callout', {
//     piece: PIECE,
//     panel: 'midair_hit',                 // the bar panel this is judged against
//     camera: { pos:[0,1.6,6], target:[0,1.2,0], fov:35 },
//     actors: [ /* ... */ ],
//     hud: { visible:false },
//     note: 'what this shot is meant to prove',
//   });
//
// 4. Capture:
//   node scripts/shoot.mjs --piece=score-callout
//   node scripts/shoot.mjs --scene=midair_hit --out=shots/score-callout/midair_hit.png
//   node scripts/shoot.mjs --scene=truck --out=shots/score-callout/truck.png
//   node scripts/compare.mjs --panel=midair_hit --shot=shots/score-callout/midair_hit.png --out=shots/score-callout/cmp.png
//
// 5. DETERMINISM IS ENFORCED. No Math.random / Date.now / performance.now anywhere
//    under src/pieces/ — use makeRng(seed) from ../../foundation/rng.js and make all
//    animation a pure function of the simulated time `t`.
//    node scripts/lint-determinism.mjs

export const PIECE = 'score-callout';
