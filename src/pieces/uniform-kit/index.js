// PIECE: uniform-kit  (plan id "uniform-and-locker")
// OWNER: this directory ONLY.  SLOTS: world.uniform + ui.uniformScreen
//
// WHAT THIS PIECE OWNS
//   (1) Every material a player wears — jersey, pants, socks, gloves, cleats, helmet,
//       facemask, visor, pads, towel, undershirt and skin — for all 32 REAL NFL clubs in
//       five variants, built from the clubs' OFFICIAL colours in src/data/teams.json and
//       carrying real jersey numbers and names from src/data/players.json.
//   (2) The PICK YOUR UNIFORM screen, and the locker stage the model stands on.
//
// THE COST STORY, because this piece is judged on a counted budget first:
//   2 shader programs total for 32 clubs x 5 variants x 12 slots (one define, one shared
//   onBeforeCompile — see shader.js). 6 shared detail maps for the whole game plus one
//   small decal sheet per kit on the field. 0 draw calls of its own: the materials ride
//   character-anatomy's geometry groups. Every bake happens at load; applyRung only
//   writes scalars into uniforms that already exist, so no rung change ever compiles a
//   program or allocates a render target.
//
// CAPTURE
//   node scripts/shoot.mjs --piece=uniform-kit
//   node scripts/compare.mjs --panel=uniform --shot=shots/uniform-kit/uniform.png \
//                            --out=shots/uniform-kit/cmp-r1.png

import { registerWorld, registerUI, registerIsoShot, REG } from '../../foundation/registry.js';
import { materials, applyRung, accentOf, stats } from './materials.js';
import { kitFor, roles } from './palette.js';
import { installStage } from './stage.js';
import screenImpl, { hitTest } from './screen.js';

export const PIECE = 'uniform-kit';

/* ------------------------------------------------------- the locker scenes */

/** Scenes on which the 3D layer becomes a studio rather than a stadium. */
// `stance` is only ever set on scenes this piece owns outright — see stance.js for why
// it exists and when it gets deleted. It is never set on `uniform`, which belongs to
// cinematography's shot library and to pose-animation's pose.
const STAGED = {
  uniform: { camAz: 0.0, exposure: 1.04, stance: false },
  iso_uniform_hero: { camAz: 0.0, exposure: 1.04, stance: true },
  iso_uniform_closeup: { camAz: 0.30, exposure: 1.10, stance: true },
  iso_uniform_variants: { camAz: 0.0, exposure: 1.02, stance: true },
  iso_uniform_dirty: { camAz: 0.22, exposure: 1.06, stance: true },
  iso_uniform_rungs: { camAz: 0.0, exposure: 1.02, stance: true },
};

let stagedShot = null;

function maybeStage(ctx, teamId, variant) {
  const shot = ctx && ctx.shot;
  if (!shot) return;
  const cfg = STAGED[shot.id] || (shot.ui && shot.ui.screen === 'uniform' ? STAGED.uniform : null);
  if (!cfg) return;
  if (stagedShot === shot) return;
  stagedShot = shot;
  const team = REG.brand.byId(teamId);
  const R = roles(team);
  try {
    installStage(ctx, {
      accent: accentOf(teamId, variant),
      shell: R.shell,
      camAz: cfg.camAz,
      exposure: cfg.exposure,
      stance: !!cfg.stance,
    });
  } catch (e) {
    console.error('[uniform-kit] stage failed', e);
    (window.__BLITZ_ERRORS__ = window.__BLITZ_ERRORS__ || []).push(`[uniform-kit] stage: ${e && e.message}`);
  }
}

/* -------------------------------------------------------------- the world */

const impl = {
  piece: PIECE,

  /** The `uniform` slot owns no geometry — the assembler never calls this. */
  build() { return null; },

  materials(ctx, teamId, variant, opts) {
    maybeStage(ctx, teamId, variant);
    return materials(ctx, teamId, variant, opts);
  },

  applyRung,
  stats,
  screen: screenImpl,
};

registerWorld('uniform', impl);
registerUI('uniformScreen', screenImpl);

/* ------------------------------------------------------------- iso scenes */
//
// Real club, real player, real number: Rome Odunze, WR, #15, Chicago Bears
// (src/data/players.json — ovr 79, 6'3", 215 lb). The Bears' official colours are
// #0B162A navy and #E64100 orange, which is the same VALUE structure the bar panel
// runs on: a near-black kit carrying one hot accent.

const HERO = {
  team: 'CHI', variant: 'home', number: '15', name: 'ODUNZE',
  archetype: 'skill', heightM: 1.905, massKg: 97.5, seed: 1503,
};

function actor(o) {
  return Object.assign({
    id: 'model', pose: 'idle', phase: 0, pos: [0, 0, 0], rotY: 0,
    hero: true, dirt: 0, wet: 0.08,
  }, HERO, o);
}

const BASE = {
  piece: PIECE,
  panel: 'uniform',
  lens: { fStop: 3.6, focusDist: 5.9, bokehScale: 0.55, shutter: 0 },
  exposure: 1.0,
  weather: { rain: 0, lightning: 0, haze: 0 },
  ball: { visible: false },
  hud: { visible: false },
  callout: { visible: false },
};

// The camera is shifted -0.20 m laterally rather than the actor being moved, so the
// stage rig, the halo and the floor pool all stay centred on the model while the model
// itself lands right of frame centre — balanced between the crest plate and the button
// column exactly as the bar balances its figure between its own two columns.
registerIsoShot('iso_uniform_hero', Object.assign({}, BASE, {
  camera: { pos: [-0.22, 1.05, 5.97], target: [-0.22, 1.05, 0], fov: 26, roll: 0 },
  actors: [actor({})],
  ui: { screen: 'uniform', state: { team: 'CHI', variantIndex: 0 } },
  note: 'The screen exactly as the bar stages it: crest plate left, model centred under the locker rig, variant column right.',
}));

registerIsoShot('iso_uniform_closeup', Object.assign({}, BASE, {
  camera: { pos: [0.58, 1.50, 2.05], target: [0.02, 1.42, 0], fov: 32, roll: -0.02 },
  lens: { fStop: 2.4, focusDist: 2.12, bokehScale: 0.9, shutter: 0 },
  actors: [actor({ rotY: -0.24, wet: 0.22 })],
  ui: { screen: null, state: {} },
  note: 'Torso/helmet macro. Judge the knit weave, the three-layer tackle-twill number, the stitched piping and the helmet clearcoat hotspot.',
}));

registerIsoShot('iso_uniform_variants', Object.assign({}, BASE, {
  camera: { pos: [0.0, 1.16, 7.55], target: [0.0, 1.02, 0], fov: 32, roll: 0 },
  lens: { fStop: 6.0, focusDist: 7.6, bokehScale: 0.28, shutter: 0 },
  actors: [
    actor({ id: 'v0', variant: 'home', pos: [-2.44, 0, 0], rotY: -0.14, hero: false }),
    actor({ id: 'v1', variant: 'away', pos: [-1.22, 0, 0], rotY: -0.07, hero: false }),
    actor({ id: 'v2', variant: 'alt1', pos: [0.00, 0, 0], rotY: 0.0, hero: true }),
    actor({ id: 'v3', variant: 'alt2', pos: [1.22, 0, 0], rotY: 0.07, hero: false }),
    actor({ id: 'v4', variant: 'throwback', pos: [2.44, 0, 0], rotY: 0.14, hero: false }),
  ],
  ui: { screen: null, state: {} },
  note: 'HOME / AWAY / ALT 1 / ALT 2 / THROWBACK on one club. Five arrangements of the SAME official colour set, two shader programs, one decal sheet each.',
}));

registerIsoShot('iso_uniform_dirty', Object.assign({}, BASE, {
  camera: { pos: [0.86, 1.20, 2.62], target: [0.0, 1.08, 0], fov: 32, roll: 0.01 },
  lens: { fStop: 2.8, focusDist: 2.75, bokehScale: 0.8, shutter: 0 },
  actors: [
    actor({ id: 'clean', pos: [-0.68, 0, 0], rotY: -0.16, dirt: 0.0, wet: 0.05, hero: false }),
    actor({ id: 'wrecked', pos: [0.68, 0, 0], rotY: 0.14, dirt: 0.92, wet: 0.85 }),
  ],
  ui: { screen: null, state: {} },
  note: 'Fourth quarter, left is dirt 0 / wet 0.05, right is dirt 0.92 / wet 0.85. Same material set, two uniform writes.',
}));

registerIsoShot('iso_uniform_rungs', Object.assign({}, BASE, {
  camera: { pos: [0.0, 1.16, 6.4], target: [0.0, 1.02, 0], fov: 32, roll: 0 },
  lens: { fStop: 6.0, focusDist: 6.4, bokehScale: 0.3, shutter: 0 },
  actors: [
    actor({ id: 'r0', team: 'KC', number: '15', name: 'MAHOMES', pos: [-1.86, 0, 0], rotY: -0.10, hero: false }),
    actor({ id: 'r1', team: 'PHI', number: '26', name: 'BARKLEY', pos: [-0.62, 0, 0], rotY: -0.04, hero: false }),
    actor({ id: 'r2', team: 'BAL', number: '8', name: 'JACKSON', pos: [0.62, 0, 0], rotY: 0.04, hero: true }),
    actor({ id: 'r3', team: 'DAL', number: '11', name: 'PARSONS', pos: [1.86, 0, 0], rotY: 0.10, hero: false }),
  ],
  ui: { screen: null, state: {} },
  note: 'Four real clubs, real players and real numbers, all home kits — proof the colour system generalises off the hero club. Still two shader programs.',
}));

export default impl;
export { hitTest };
