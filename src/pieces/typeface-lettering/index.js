// PIECE: typeface-lettering
// OWNER: this directory ONLY. Never edit anything outside src/pieces/typeface-lettering/.
// SLOT:  faces
// REGISTER VIA: registerFaces(impl)
// JUDGED ON: the four vector faces: blitz-brush / blitz-block / blitz-num / blitz-techno
// HERO PANELS: title, midair_hit
//
// ---------------------------------------------------------------------------
// PLACEHOLDER. Registers nothing, exports nothing. The foundation fallback stays
// installed until you replace this file. Delete this comment block when you build.
// ---------------------------------------------------------------------------
//
// 1. Build your implementation in files inside this directory.
// 2. Register it here as an import side effect:
//
//   import { registerFaces } from '../../foundation/registry.js';
//   import { makeFaces } from '../../foundation/typeface.js';
//   // const faces = makeFaces({ 'blitz-brush': {...glyph data...}, ... });
//   // registerFaces(Object.assign({ piece:PIECE }, faces));
//
// 3. Register at least ONE isolation scene you alone own, so a blind critic can
//    pose exactly your contribution and score it without a neighbour masking it:
//
//   import { registerIsoShot } from '../../foundation/registry.js';
//   registerIsoShot('iso:typeface-lettering', {
//     piece: PIECE,
//     panel: 'title',                 // the bar panel this is judged against
//     camera: { pos:[0,1.6,6], target:[0,1.2,0], fov:35 },
//     actors: [ /* ... */ ],
//     hud: { visible:false },
//     note: 'what this shot is meant to prove',
//   });
//
// 4. Capture:
//   node scripts/shoot.mjs --piece=typeface-lettering
//   node scripts/shoot.mjs --scene=title --out=shots/typeface-lettering/title.png
//   node scripts/shoot.mjs --scene=midair_hit --out=shots/typeface-lettering/midair_hit.png
//   node scripts/compare.mjs --panel=title --shot=shots/typeface-lettering/title.png --out=shots/typeface-lettering/cmp.png
//
// 5. DETERMINISM IS ENFORCED. No Math.random / Date.now / performance.now anywhere
//    under src/pieces/ — use makeRng(seed) from ../../foundation/rng.js and make all
//    animation a pure function of the simulated time `t`.
//    node scripts/lint-determinism.mjs

export const PIECE = 'typeface-lettering';
