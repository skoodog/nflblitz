// PIECE: stadium-env
// OWNER: this directory ONLY. Never edit anything outside src/pieces/stadium-env/.
// SLOT:  world.stadium
// REGISTER VIA: registerWorld('stadium', impl)
// JUDGED ON: night stadium bowl, crowd, jumbotron, goalposts, atmospheric depth
// HERO PANELS: qb_dropback, catch
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
//   // registerWorld('stadium', { piece:PIECE, build(ctx), update(t,ctx) });
//
// 3. Register at least ONE isolation scene you alone own, so a blind critic can
//    pose exactly your contribution and score it without a neighbour masking it:
//
//   import { registerIsoShot } from '../../foundation/registry.js';
//   registerIsoShot('iso:stadium-env', {
//     piece: PIECE,
//     panel: 'qb_dropback',                 // the bar panel this is judged against
//     camera: { pos:[0,1.6,6], target:[0,1.2,0], fov:35 },
//     actors: [ /* ... */ ],
//     hud: { visible:false },
//     note: 'what this shot is meant to prove',
//   });
//
// 4. Capture:
//   node scripts/shoot.mjs --piece=stadium-env
//   node scripts/shoot.mjs --scene=qb_dropback --out=shots/stadium-env/qb_dropback.png
//   node scripts/shoot.mjs --scene=catch --out=shots/stadium-env/catch.png
//   node scripts/compare.mjs --panel=qb_dropback --shot=shots/stadium-env/qb_dropback.png --out=shots/stadium-env/cmp.png
//
// 5. DETERMINISM IS ENFORCED. No Math.random / Date.now / performance.now anywhere
//    under src/pieces/ — use makeRng(seed) from ../../foundation/rng.js and make all
//    animation a pure function of the simulated time `t`.
//    node scripts/lint-determinism.mjs

export const PIECE = 'stadium-env';
