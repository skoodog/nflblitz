// PIECE: score-callout
// OWNER: this directory ONLY. Never edit anything outside src/pieces/score-callout/.
// SLOT:  ui.callout   (registerUI('callout', impl))
// JUDGED ON: hand-lettered italic score callouts with gold numerals
// HERO PANELS: midair_hit, truck
// ISO SCENES: iso_callout_hero, iso_callout_truck, iso_callouts,
//             iso_callout_anim, iso_callout_hostile
//
// CAPTURE
//   node scripts/shoot.mjs --piece=score-callout --layer=overlay
//   node scripts/shoot.mjs --piece=score-callout
//   node scripts/compare.mjs --panel=midair_hit --shot=shots/score-callout/iso_callout_hero.png \
//                            --out=shots/score-callout/cmp-r1.png
//
// HOW IT IS BUILT
//   The whole lockup is BAKED ONCE into an offscreen canvas (lockup.js -> ink.js) and
//   keyed by (line1, line2, pts, accent, scale). The frame path is then a transform and
//   one drawImage — no text rasterisation, no path work, no allocation. `age` drives a
//   closed-form animation (anim.js) that never touches a clock.
//
// DETERMINISM: every random draw goes through makeRng/hash seeded from the callout's
// own text, so the same words always tear the same way.

import { registerUI, registerIsoShot } from '../../foundation/registry.js';
import { lockupFor } from './lockup.js';
import { END_T } from './anim.js';
import { drawLockup } from './draw.js';
import { drawIsoScene, isIsoScene } from './sheets.js';

export const PIECE = 'score-callout';

/* --------------------------------------------------------------- placement */
// Line-2 centre x and points-line baseline y, in the overlay's logical 1920x1080.
// midair_hit puts them at (1348, 1014); truck at (1442, 923). This sits between,
// clear of the top-left HUD and the bottom-left TURBO meter in both hero frames.
export const ANCHOR_X = 1404;
export const ANCHOR_Y = 966;

/* -------------------------------------------------------------- the slot */

const impl = {
  piece: PIECE,

  draw(c2d, t, state, ui) {
    if (!state || !state.visible) return;
    const faces = ui && ui.faces;
    if (!faces) return;

    // This piece's own isolation scenes paint themselves end to end.
    if (isIsoScene(ui)) { drawIsoScene(c2d, t, state, ui); return; }

    const age = state.age || 0;
    if (age >= END_T) return;
    const scale = state.scale || 1;
    const ax = state.x === undefined ? ANCHOR_X : state.x;
    const ay = state.y === undefined ? ANCHOR_Y : state.y;
    const lk = drawLockup(c2d, faces, state, ax, ay, scale, (ui.seed | 0) || 7);

    // Keep the runtime overlay alive over the callout's rectangle while it animates.
    if (ui.markDirty && lk) {
      const r = Math.max(lk.w, lk.h) * 0.85 + 220;
      ui.markDirty(ax - r, ay - lk.oy - 120, r * 2, lk.h + 260);
    }
  },

  /** Optional: bake a callout's plate before it is first shown, off the frame path. */
  prewarm(faces, list) {
    if (!faces || !list) return;
    for (let i = 0; i < list.length; i++) {
      try { lockupFor(faces, list[i], { scale: list[i].scale || 1, seed: 7 }); } catch (e) { /* ignore */ }
    }
  },

  /** The quality ladder never needs to change a baked plate. Idempotent no-op. */
  applyRung() {},
};

registerUI('callout', impl);

/* --------------------------------------------------------- capture scenes */

const ISO = {
  piece: PIECE,
  camera: { pos: [0, 1.7, 9], target: [0, 1.5, 0], fov: 34 },
  actors: [],
  ball: { visible: false },
  hud: { visible: false },
  ui: { screen: null, state: {} },
};

registerIsoShot('iso_callout_hero', Object.assign({}, ISO, {
  panel: 'midair_hit',
  callout: { visible: true, line1: 'MID-AIR', line2: 'MURDER!', pts: 250, accent: 'red', age: 0.30 },
  note: 'The shipping MID-AIR / MURDER! / 250 PTS lockup at exact frame geometry over a night field — the direct A/B against bar/panel-midair_hit.png.',
}));

registerIsoShot('iso_callout_truck', Object.assign({}, ISO, {
  panel: 'truck',
  callout: { visible: true, line1: '', line2: 'TRUCK!', pts: 150, accent: 'gold', age: 0.30 },
  note: 'Single-line white lockup, TRUCK! / 150 PTS — the A/B against bar/panel-truck.png.',
}));

registerIsoShot('iso_callouts', Object.assign({}, ISO, {
  panel: 'midair_hit',
  callout: { visible: true, line1: 'MID-AIR', line2: 'MURDER!', pts: 250, accent: 'red', age: 0.30 },
  note: 'All five bar lockups at once: MID-AIR/MURDER!, TRUCK!, TOUCHDOWN!, LEVELER!, WHAT A/CATCH! — colour rule, stacking, gold numerals, PTS.',
}));

registerIsoShot('iso_callout_anim', Object.assign({}, ISO, {
  panel: 'truck',
  callout: { visible: true, line1: '', line2: 'TOUCHDOWN!', pts: 200, accent: 'gold', age: 0.30 },
  note: 'Filmstrip of the age curve: slam-in streak, impact flash, shake settle, hold, fade.',
}));

registerIsoShot('iso_callout_hostile', Object.assign({}, ISO, {
  panel: 'catch',
  callout: { visible: true, line1: 'WHAT A', line2: 'CATCH!', pts: 175, accent: 'gold', age: 0.30 },
  note: 'The same lockup over blown-out white, a lit crowd and flat mid-grey — proof the halo/keyline/shadow keep it legible on any background.',
}));
