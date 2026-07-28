// FOUNDATION — FROZEN after t=0. Do not edit.
// The single plug board every piece registers into. A later call overwrites the
// fallback that foundation installed at boot, so round 1 always runs.

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

export const WORLD_SLOTS = ['stadium', 'lighting', 'turf', 'anatomy', 'uniform', 'pose', 'fx'];
export const UI_SLOTS = ['hud', 'callout', 'teamSelect', 'uniformScreen', 'playcall', 'title'];

/** The 16 pieces, in the exact order src/pieces/index.js imports them. */
export const PIECE_IDS = [
  'brand-identity',
  'character-anatomy',
  'cinematography',
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
