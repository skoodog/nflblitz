// PIECE: menu-playcall
// OWNER: this directory ONLY. Never edit anything outside src/pieces/menu-playcall/.
// SLOT:  ui.playcall
// REGISTER VIA: registerUI('playcall', impl)
// JUDGED ON: DEFENSE! PICK A PLAY screen, 8 route-diagram tiles, :09 clock
// HERO PANELS: playcall_def
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
//   // registerUI('playcall', { piece:PIECE, draw(c2d, t, state, ui){...} });
//
// 3. Register at least ONE isolation scene you alone own, so a blind critic can
//    pose exactly your contribution and score it without a neighbour masking it:
//
//   import { registerIsoShot } from '../../foundation/registry.js';
//   registerIsoShot('iso:menu-playcall', {
//     piece: PIECE,
//     panel: 'playcall_def',                 // the bar panel this is judged against
//     camera: { pos:[0,1.6,6], target:[0,1.2,0], fov:35 },
//     actors: [ /* ... */ ],
//     hud: { visible:false },
//     note: 'what this shot is meant to prove',
//   });
//
// 4. Capture:
//   node scripts/shoot.mjs --piece=menu-playcall
//   node scripts/shoot.mjs --scene=playcall_def --out=shots/menu-playcall/playcall_def.png
//   node scripts/compare.mjs --panel=defense_playcall --shot=shots/menu-playcall/playcall_def.png --out=shots/menu-playcall/cmp.png
//
// 5. DETERMINISM IS ENFORCED. No Math.random / Date.now / performance.now anywhere
//    under src/pieces/ — use makeRng(seed) from ../../foundation/rng.js and make all
//    animation a pure function of the simulated time `t`.
//    node scripts/lint-determinism.mjs

export const PIECE = 'menu-playcall';
