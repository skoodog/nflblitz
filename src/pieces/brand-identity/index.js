// PIECE: brand-identity
// OWNER: this directory ONLY. Never edit anything outside src/pieces/brand-identity/.
// SLOT:  brand
// REGISTER VIA: registerBrand(impl)
// JUDGED ON: team crests, wordmarks, city skylines, league chevron badge, BLITZ logotype
// HERO PANELS: team_select, title
//
// ---------------------------------------------------------------------------
// PLACEHOLDER. Registers nothing, exports nothing. The foundation fallback stays
// installed until you replace this file. Delete this comment block when you build.
// ---------------------------------------------------------------------------
//
// 1. Build your implementation in files inside this directory.
// 2. Register it here as an import side effect:
//
//   import { registerBrand } from '../../foundation/registry.js';
//   // registerBrand({ piece:PIECE, teams:[...], byId, crest, wordmark, skyline, leagueMark, blitzLogo });
//
// 3. Register at least ONE isolation scene you alone own, so a blind critic can
//    pose exactly your contribution and score it without a neighbour masking it:
//
//   import { registerIsoShot } from '../../foundation/registry.js';
//   registerIsoShot('iso:brand-identity', {
//     piece: PIECE,
//     panel: 'team_select',                 // the bar panel this is judged against
//     camera: { pos:[0,1.6,6], target:[0,1.2,0], fov:35 },
//     actors: [ /* ... */ ],
//     hud: { visible:false },
//     note: 'what this shot is meant to prove',
//   });
//
// 4. Capture:
//   node scripts/shoot.mjs --piece=brand-identity
//   node scripts/shoot.mjs --scene=team_select --out=shots/brand-identity/team_select.png
//   node scripts/shoot.mjs --scene=title --out=shots/brand-identity/title.png
//   node scripts/compare.mjs --panel=team_select --shot=shots/brand-identity/team_select.png --out=shots/brand-identity/cmp.png
//
// 5. DETERMINISM IS ENFORCED. No Math.random / Date.now / performance.now anywhere
//    under src/pieces/ — use makeRng(seed) from ../../foundation/rng.js and make all
//    animation a pure function of the simulated time `t`.
//    node scripts/lint-determinism.mjs

export const PIECE = 'brand-identity';
