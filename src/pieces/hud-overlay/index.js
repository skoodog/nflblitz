// PIECE: hud-overlay
// OWNER: this directory ONLY. Never edit anything outside src/pieces/hud-overlay/.
// SLOT:  ui.hud
// REGISTER VIA: registerUI('hud', impl)
// JUDGED ON: compact top-left HUD + blue TURBO meter bottom-left
// HERO PANELS: qb_dropback, truck
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
//   // registerUI('hud', { piece:PIECE, draw(c2d, t, hudState, ui){...} });
//
// 3. Register at least ONE isolation scene you alone own, so a blind critic can
//    pose exactly your contribution and score it without a neighbour masking it:
//
//   import { registerIsoShot } from '../../foundation/registry.js';
//   registerIsoShot('iso:hud-overlay', {
//     piece: PIECE,
//     panel: 'qb_dropback',                 // the bar panel this is judged against
//     camera: { pos:[0,1.6,6], target:[0,1.2,0], fov:35 },
//     actors: [ /* ... */ ],
//     hud: { visible:false },
//     note: 'what this shot is meant to prove',
//   });
//
// 4. Capture:
//   node scripts/shoot.mjs --piece=hud-overlay
//   node scripts/shoot.mjs --scene=qb_dropback --out=shots/hud-overlay/qb_dropback.png
//   node scripts/shoot.mjs --scene=truck --out=shots/hud-overlay/truck.png
//   node scripts/compare.mjs --panel=qb_dropback --shot=shots/hud-overlay/qb_dropback.png --out=shots/hud-overlay/cmp.png
//
// 5. DETERMINISM IS ENFORCED. No Math.random / Date.now / performance.now anywhere
//    under src/pieces/ — use makeRng(seed) from ../../foundation/rng.js and make all
//    animation a pure function of the simulated time `t`.
//    node scripts/lint-determinism.mjs

export const PIECE = 'hud-overlay';
