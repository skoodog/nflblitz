// FOUNDATION — PERFCORE owns this file.
// The single plug board every piece registers into. A later call overwrites the
// fallback that foundation installed at boot, so round 1 always runs.
//
// THE applyRung CONTRACT. Every slot interface MAY expose `applyRung(rung, spec, ctx)`.
// The runtime calls it whenever the adaptive scaler moves the quality ladder. Rules,
// binding on every piece:
//   - It MUST NOT allocate. It runs during play.
//   - It MUST NOT compile a shader or create a material variant. Every program for
//     every rung is pre-warmed at load (engine.prewarmPrograms); a rung change that
//     compiles is a 5-50 ms stall on a real mobile driver.
//   - It MUST NOT create or resize a render target.
//   - It SHOULD be idempotent: applyRung(9) twice is applyRung(9) once.
//   - `spec` is the RUNGS[rung] row: renderScale, dprCap, shadowSize, shadowCasters,
//     postPasses, particles, skinned, imposter, bones, volumetric, turf, crowd.
// A piece whose applyRung is expensive is caught by `perf.mjs --thermal-ramp`, which
// forces a rung sweep under load and fails on the resulting frame spike.

import fbStadium from './fallbacks/stadium.js';
import fbLighting from './fallbacks/lighting.js';
import fbTurf from './fallbacks/turf.js';
import fbAnatomy from './fallbacks/anatomy.js';
import fbUniform from './fallbacks/uniform.js';
import fbPose from './fallbacks/pose.js';
import fbFx from './fallbacks/fx.js';
import fbCinema from './fallbacks/cinema.js';
import fbBrand from './fallbacks/brand.js';
import fbFaces from './fallbacks/faces.js';
import fbUI from './fallbacks/ui.js';
import fbSim from './fallbacks/sim.js';
import fbTiming from './fallbacks/timing.js';
import fbController from './fallbacks/controller.js';
import fbFlow from './fallbacks/flow.js';

export const WORLD_SLOTS = ['stadium', 'lighting', 'turf', 'anatomy', 'uniform', 'pose', 'fx'];
export const UI_SLOTS = ['hud', 'callout', 'teamSelect', 'uniformScreen', 'playcall', 'title'];

/**
 * The 18 pieces, in the exact order src/pieces/index.js imports them.
 *
 * The two new ones are the spine the re-cut plan put ahead of every fidelity piece:
 *   touch-controller  zones, gestures, feel  (foundation owns only the raw bus)
 *   game-flow         the state machine, and the play boundary where expensive rung
 *                     changes are committed so they cannot hitch mid-play
 *
 * `perf-core` is deliberately NOT in this list. It is the foundation itself — this
 * pass — and it has no piece directory, no hero panels and no capture scenes. It is
 * logged to the progress board under that name, and it is judged by the four harness
 * commands rather than by a screenshot.
 */
export const PIECE_IDS = [
  'brand-identity',
  'character-anatomy',
  'cinematography',
  'game-flow',
  'hud-overlay',
  'impact-fx',
  'menu-playcall',
  'menu-team-select',
  'menu-title',
  'play-sim',
  'pose-animation',
  'score-callout',
  'stadium-env',
  'stadium-lighting',
  'touch-controller',
  'turf-field',
  'typeface-lettering',
  'uniform-kit',
];

/**
 * Hero panels each piece is judged against, on top of its own iso shot.
 * `node scripts/shoot.mjs --piece=<id>` shoots these plus every isoShot the
 * piece registered. Foundation-owned so a piece never has to touch shared files
 * just to get its capture set.
 */
export const PIECE_HEROES = {
  'brand-identity': ['team_select', 'title'],
  'character-anatomy': ['truck', 'leveler'],
  'cinematography': ['midair_hit', 'touchdown'],
  'game-flow': ['live_play', 'playcall_def'],
  'touch-controller': ['live_play', 'truck'],
  'hud-overlay': ['qb_dropback', 'truck'],
  'impact-fx': ['leveler', 'midair_hit'],
  'menu-playcall': ['playcall_def'],
  'menu-team-select': ['team_select'],
  'menu-title': ['title'],
  'play-sim': ['live_play', 'qb_dropback'],
  'pose-animation': ['truck', 'catch'],
  'score-callout': ['midair_hit', 'truck'],
  'stadium-env': ['qb_dropback', 'catch'],
  'stadium-lighting': ['midair_hit', 'qb_dropback'],
  'turf-field': ['truck', 'touchdown'],
  'typeface-lettering': ['title', 'midair_hit'],
  'uniform-kit': ['uniform', 'truck'],
};

/** Which bar panel each hero scene must be compared against. */
export const SCENE_PANELS = {
  title: 'title',
  qb_dropback: 'qb_dropback',
  midair_hit: 'midair_hit',
  team_select: 'team_select',
  truck: 'truck',
  playcall_def: 'defense_playcall',
  leveler: 'leveler',
  touchdown: 'touchdown',
  uniform: 'uniform',
  catch: 'catch',
  live_play: 'qb_dropback',
};

export const REG = {
  world: {
    stadium: fbStadium,
    lighting: fbLighting,
    turf: fbTurf,
    anatomy: fbAnatomy,
    uniform: fbUniform,
    pose: fbPose,
    fx: fbFx,
  },
  ui: {
    hud: fbUI.hud,
    callout: fbUI.callout,
    teamSelect: fbUI.teamSelect,
    uniformScreen: fbUI.uniformScreen,
    playcall: fbUI.playcall,
    title: fbUI.title,
  },
  cinema: fbCinema,
  brand: fbBrand,
  faces: fbFaces,
  sim: fbSim,
  /** THE SPINE SLOTS. Owned by foundation fallbacks until their pieces land. */
  timing: fbTiming,          // tick-exact action windows      <- piece `play-sim`
  controller: fbController,  // zones, gestures, feel          <- piece `touch-controller`
  flow: fbFlow,              // state machine + play boundary  <- piece `game-flow`
  isoShots: {},
  /** slot -> piece id that claimed it (diagnostics only). */
  provenance: {},
};

// Best-effort provenance. A piece may set `impl.piece = '<piece-id>'` on anything
// it registers; it is diagnostics only and nothing depends on it.
function claim(kind, slot, impl) {
  REG.provenance[`${kind}.${slot}`] = (impl && impl.piece) || 'foundation-fallback';
}

export function registerWorld(slot, impl) {
  if (!WORLD_SLOTS.includes(slot)) throw new Error(`registerWorld: unknown slot "${slot}"`);
  if (!impl || typeof impl.build !== 'function') {
    throw new Error(`registerWorld("${slot}"): impl must expose build(ctx)`);
  }
  REG.world[slot] = impl;
  claim('world', slot, impl);
  return impl;
}

export function registerUI(slot, impl) {
  if (!UI_SLOTS.includes(slot)) throw new Error(`registerUI: unknown slot "${slot}"`);
  if (!impl || typeof impl.draw !== 'function') {
    throw new Error(`registerUI("${slot}"): impl must expose draw(c2d, t, state, ui)`);
  }
  REG.ui[slot] = impl;
  claim('ui', slot, impl);
  return impl;
}

export function registerCinema(impl) {
  if (!impl || typeof impl.applyShot !== 'function') {
    throw new Error('registerCinema: impl must expose applyShot(camera, shot, t, ctx)');
  }
  // Keep the fallback shot library reachable so a cinema piece may extend rather
  // than replace it: `shots` falls back per-key.
  const merged = Object.assign(Object.create(null), fbCinema.shots, impl.shots || {});
  REG.cinema = Object.assign({}, fbCinema, impl, { shots: merged });
  claim('cinema', 'cinema', impl);
  return REG.cinema;
}

export function registerBrand(impl) {
  if (!impl || !Array.isArray(impl.teams)) throw new Error('registerBrand: impl must expose teams[]');
  REG.brand = Object.assign({}, fbBrand, impl);
  claim('brand', 'brand', impl);
  return REG.brand;
}

export function registerFaces(impl) {
  if (!impl || typeof impl.draw !== 'function') {
    throw new Error('registerFaces: impl must expose draw(c2d, text, x, y, opts)');
  }
  REG.faces = Object.assign({}, fbFaces, impl);
  claim('faces', 'faces', impl);
  return REG.faces;
}

export function registerSim(impl) {
  if (!impl || typeof impl.create !== 'function') {
    throw new Error('registerSim: impl must expose create(seed, opts)');
  }
  REG.sim = Object.assign({}, fbSim, impl);
  claim('sim', 'sim', impl);
  return REG.sim;
}

/**
 * registerTiming — the tick-exact action window model. Owned by piece `play-sim`.
 * Everything must stay a PURE function of (state, action, tick): `simtest.mjs` imports
 * it under plain Node with no browser and asserts window boundaries tick by tick.
 */
export function registerTiming(impl) {
  if (!impl || typeof impl.attempt !== 'function' || typeof impl.windowFor !== 'function') {
    throw new Error('registerTiming: impl must expose attempt(state, action, tick) and windowFor(action, armTick)');
  }
  REG.timing = Object.assign({}, fbTiming, impl);
  claim('timing', 'timing', impl);
  return REG.timing;
}

/**
 * registerController — zones, gesture recognition and feel. Owned by piece
 * `touch-controller`. The foundation keeps the raw timestamped bus (touch.js); this
 * slot only ever reads it.
 *
 * `resolve(state, tick, touch, telemetry, scratch)` is called ONCE PER SIM TICK from
 * inside the fixed-step loop and must consume only the events bound to that tick.
 * Reading `touch.events` wholesale is a bug at 30 Hz — it double-applies input.
 */
export function registerController(impl) {
  if (!impl || typeof impl.resolve !== 'function' || typeof impl.create !== 'function') {
    throw new Error('registerController: impl must expose create() and resolve(state, tick, touch, tel, scratch)');
  }
  REG.controller = Object.assign({}, fbController, impl);
  claim('controller', 'controller', impl);
  return REG.controller;
}

/**
 * registerFlow — the game state machine. Owned by piece `game-flow`.
 * `enterPlay(state, tick)` is the ONLY place an expensive rung change may be committed.
 */
export function registerFlow(impl) {
  if (!impl || typeof impl.step !== 'function' || typeof impl.create !== 'function') {
    throw new Error('registerFlow: impl must expose create() and step(state, tick)');
  }
  REG.flow = Object.assign({}, fbFlow, impl);
  claim('flow', 'flow', impl);
  return REG.flow;
}

/**
 * A piece's own capture scene. Checked BEFORE cinema.shots by the scene
 * resolver, which is what keeps per-piece capture scenes file-disjoint.
 * `spec.piece` should be the registering piece's id so `--piece=<id>` finds it.
 */
export function registerIsoShot(sceneId, shotSpec) {
  if (!sceneId || typeof sceneId !== 'string') throw new Error('registerIsoShot: sceneId required');
  if (!shotSpec || typeof shotSpec !== 'object') throw new Error('registerIsoShot: shotSpec required');
  const pid = shotSpec.piece || 'unknown';
  REG.isoShots[sceneId] = Object.assign({}, shotSpec, { id: sceneId, piece: shotSpec.piece || pid, iso: true });
  return REG.isoShots[sceneId];
}

export default REG;
