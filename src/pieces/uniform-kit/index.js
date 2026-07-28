// PIECE: uniform-kit
// OWNER: this directory ONLY. Never edit anything outside src/pieces/uniform-kit/.
// SLOT:  world.uniform + ui.uniformScreen
// REGISTER VIA: registerWorld('uniform', impl) AND registerUI('uniformScreen', impl.screen)
// JUDGED ON: jersey/pants/helmet materials per team+variant, numbers, dirt, wetness
// HERO PANELS: uniform, truck
//
// ---------------------------------------------------------------------------
// PLACEHOLDER. Registers nothing, exports nothing. The foundation fallback stays
// installed until you replace this file. Delete this comment block when you build.
// ---------------------------------------------------------------------------
//
// 1. Build your implementation in files inside this directory.
// 2. Register it here as an import side effect:
//
//   import { registerWorld, registerUI } from '../../foundation/registry.js';
//   import { MAT_SLOTS } from '../../foundation/contracts.js';
//   // const impl = { piece:PIECE, materials(ctx, teamId, variant, o){...}, screen:{ draw(c2d,t,state,ui){...} } };
//   // registerWorld('uniform', impl); registerUI('uniformScreen', impl.screen);
//
// 3. Register at least ONE isolation scene you alone own, so a blind critic can
//    pose exactly your contribution and score it without a neighbour masking it:
//
//   import { registerIsoShot } from '../../foundation/registry.js';
//   registerIsoShot('iso:uniform-kit', {
//     piece: PIECE,
//     panel: 'uniform',                 // the bar panel this is judged against
//     camera: { pos:[0,1.6,6], target:[0,1.2,0], fov:35 },
//     actors: [ /* ... */ ],
//     hud: { visible:false },
//     note: 'what this shot is meant to prove',
//   });
//
// 4. Capture:
//   node scripts/shoot.mjs --piece=uniform-kit
//   node scripts/shoot.mjs --scene=uniform --out=shots/uniform-kit/uniform.png
//   node scripts/shoot.mjs --scene=truck --out=shots/uniform-kit/truck.png
//   node scripts/compare.mjs --panel=uniform --shot=shots/uniform-kit/uniform.png --out=shots/uniform-kit/cmp.png
//
// 5. DETERMINISM IS ENFORCED. No Math.random / Date.now / performance.now anywhere
//    under src/pieces/ — use makeRng(seed) from ../../foundation/rng.js and make all
//    animation a pure function of the simulated time `t`.
//    node scripts/lint-determinism.mjs

export const PIECE = 'uniform-kit';
