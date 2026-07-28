// PIECE: cinematography
// OWNER: this directory ONLY. Never edit anything outside src/pieces/cinematography/.
// SLOT:  cinema
// REGISTER VIA: registerCinema(impl)
// JUDGED ON: camera staging, lens, bokeh DOF, bloom, grade, vignette, composition
// HERO PANELS: midair_hit, touchdown
//
// ---------------------------------------------------------------------------
// PLACEHOLDER. Registers nothing, exports nothing. The foundation fallback stays
// installed until you replace this file. Delete this comment block when you build.
// ---------------------------------------------------------------------------
//
// 1. Build your implementation in files inside this directory.
// 2. Register it here as an import side effect:
//
//   import { registerCinema } from '../../foundation/registry.js';
//   // registerCinema({ piece:PIECE, shots:{...}, applyShot(cam,shot,t,ctx){...}, buildPost(ctx,shot){...}, apertureOffset(i,n,shot,cam,ctx){...} });
//
// 3. Register at least ONE isolation scene you alone own, so a blind critic can
//    pose exactly your contribution and score it without a neighbour masking it:
//
//   import { registerIsoShot } from '../../foundation/registry.js';
//   registerIsoShot('iso:cinematography', {
//     piece: PIECE,
//     panel: 'midair_hit',                 // the bar panel this is judged against
//     camera: { pos:[0,1.6,6], target:[0,1.2,0], fov:35 },
//     actors: [ /* ... */ ],
//     hud: { visible:false },
//     note: 'what this shot is meant to prove',
//   });
//
// 4. Capture:
//   node scripts/shoot.mjs --piece=cinematography
//   node scripts/shoot.mjs --scene=midair_hit --out=shots/cinematography/midair_hit.png
//   node scripts/shoot.mjs --scene=touchdown --out=shots/cinematography/touchdown.png
//   node scripts/compare.mjs --panel=midair_hit --shot=shots/cinematography/midair_hit.png --out=shots/cinematography/cmp.png
//
// 5. DETERMINISM IS ENFORCED. No Math.random / Date.now / performance.now anywhere
//    under src/pieces/ — use makeRng(seed) from ../../foundation/rng.js and make all
//    animation a pure function of the simulated time `t`.
//    node scripts/lint-determinism.mjs

export const PIECE = 'cinematography';
