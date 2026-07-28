// FOUNDATION — FROZEN after t=0. Do not edit.
// The ShotSpec schema: the single serialisable description of one capturable frame.
// Everything downstream (world assembler, cinema, overlay, sim) speaks ShotSpec.
//
// FIELD COORDINATES (shared by turf, stadium, pose, sim, cinema):
//   origin at midfield, +X toward the RIGHT sideline, +Z toward the NEAR sideline
//   (the camera side), +Y up. 1 unit = 1 metre.
//   Playing surface 91.44 x 48.8; endzones are |X| > 45.72 (goal lines at X = +-45.72).
//   Players stand on Y=0; a 1.88 m actor has its hip bone at Y=0.98.

export const FIELD = Object.freeze({
  length: 109.728,      // incl. both 9.144 m endzones
  playLength: 91.44,
  width: 48.8,
  goalLineX: 45.72,
  endzoneDepth: 9.144,
  halfWidth: 24.4,
  yardM: 0.9144,
});

export const ARCHETYPES = Object.freeze(['qb', 'skill', 'lineman', 'lb']);
export const VARIANTS = Object.freeze(['home', 'away', 'alt1', 'alt2', 'throwback']);
export const FX_KINDS = Object.freeze(['hit', 'truck', 'catch', 'cleat']);
export const MAT_SLOTS = Object.freeze([
  'skin', 'undershirt', 'jersey', 'pants', 'sock', 'cleat',
  'glove', 'helmetShell', 'facemask', 'visor', 'pad', 'towel',
]);

export const DEFAULT_HUD = Object.freeze({
  visible: true,
  clock: ':15',
  quarter: 2,
  down: 2,
  dist: '2ND',
  yards: '250',
  teamA: 'NYC',
  teamB: 'CHI',
  scoreA: 22,
  scoreB: 14,
  turbo: 0.62,
  momentumA: 0.5,
  momentumB: 0.3,
});

export const DEFAULT_CALLOUT = Object.freeze({
  visible: false,
  line1: '',
  line2: '',
  pts: 0,
  accent: 'gold',
  age: 0,
});

export const DEFAULT_LENS = Object.freeze({
  fStop: 2.2,
  focusDist: 12,
  bokehScale: 1.0,
  shutter: 1 / 90,
});

export const DEFAULT_WEATHER = Object.freeze({ rain: 0.25, lightning: 0.35, haze: 0.55 });

function v3(a, d) {
  if (Array.isArray(a) && a.length >= 3) return [Number(a[0]) || 0, Number(a[1]) || 0, Number(a[2]) || 0];
  return d.slice();
}

let actorAutoId = 0;

export function normalizeActor(a = {}) {
  return {
    id: a.id !== undefined ? a.id : `actor${actorAutoId++}`,
    team: a.team || 'NYC',
    variant: VARIANTS.includes(a.variant) ? a.variant : 'home',
    number: a.number !== undefined ? String(a.number) : '7',
    name: a.name !== undefined ? String(a.name) : 'STRYKER',
    archetype: ARCHETYPES.includes(a.archetype) ? a.archetype : 'skill',
    pose: a.pose || 'idle',
    phase: clamp01(a.phase !== undefined ? a.phase : 0),
    pos: v3(a.pos, [0, 0, 0]),
    rotY: Number(a.rotY) || 0,
    scale: a.scale !== undefined ? Number(a.scale) : 1,
    airborne: !!a.airborne,
    heightM: a.heightM !== undefined ? Number(a.heightM) : undefined,
    massKg: a.massKg !== undefined ? Number(a.massKg) : undefined,
    seed: a.seed !== undefined ? (a.seed | 0) : undefined,
    dirt: a.dirt !== undefined ? clamp01(a.dirt) : 0.35,
    wet: a.wet !== undefined ? clamp01(a.wet) : 0.5,
    role: a.role || null,          // free string: 'carrier' | 'tackler' | 'qb' | ...
    hero: !!a.hero,                // the actor the shot is about
  };
}

function clamp01(x) {
  x = Number(x);
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * makeShot(partial) -> a fully-populated, frozen-shape ShotSpec.
 * Everything downstream may assume every field exists.
 */
export function makeShot(s = {}) {
  const cam = s.camera || {};
  const shot = {
    id: s.id || 'untitled',
    piece: s.piece || null,
    iso: !!s.iso,
    aspect: s.aspect !== undefined ? Number(s.aspect) : 1.777,
    camera: {
      pos: v3(cam.pos, [0, 2.2, 14]),
      target: v3(cam.target, [0, 1.4, 0]),
      fov: cam.fov !== undefined ? Number(cam.fov) : 38,
      roll: cam.roll !== undefined ? Number(cam.roll) : 0,
    },
    lens: Object.assign({}, DEFAULT_LENS, s.lens || {}),
    exposure: s.exposure !== undefined ? Number(s.exposure) : 1.0,
    tod: s.tod || 'night',
    weather: Object.assign({}, DEFAULT_WEATHER, s.weather || {}),
    actors: (s.actors || []).map(normalizeActor),
    ball: Object.assign(
      { pos: [0, 1.2, 0], rotQ: [0, 0, 0, 1], flame: 0, visible: false, spin: 0 },
      s.ball || {}
    ),
    fx: (s.fx || []).map((f) => ({
      kind: FX_KINDS.includes(f.kind) ? f.kind : 'hit',
      pos: v3(f.pos, [0, 1, 0]),
      dir: v3(f.dir, [0, 1, 0]),
      power: f.power !== undefined ? Number(f.power) : 1,
      age: f.age !== undefined ? Number(f.age) : 0,
    })),
    turfDamage: (s.turfDamage || []).map((d) => ({
      type: d.type || 'divot',
      x: Number(d.x) || 0,
      z: Number(d.z) || 0,
      rot: Number(d.rot) || 0,
      strength: d.strength !== undefined ? Number(d.strength) : 1,
      x1: d.x1 !== undefined ? Number(d.x1) : undefined,
      z1: d.z1 !== undefined ? Number(d.z1) : undefined,
      w: d.w !== undefined ? Number(d.w) : undefined,
    })),
    hud: Object.assign({}, DEFAULT_HUD, s.hud || {}),
    callout: Object.assign({}, DEFAULT_CALLOUT, s.callout || {}),
    ui: {
      screen: (s.ui && s.ui.screen) || null,
      state: (s.ui && s.ui.state) || {},
    },
    /** Optional: scene wants the sim to drive it. */
    live: !!s.live,
    /** Optional free-form notes for the critic / progress page. */
    note: s.note || '',
  };
  return shot;
}

/** Cheap structural validation — returns an array of human-readable problems. */
export function validateShot(shot) {
  const errs = [];
  if (!shot || typeof shot !== 'object') return ['shot is not an object'];
  if (!shot.id) errs.push('missing id');
  if (!shot.camera || !Array.isArray(shot.camera.pos)) errs.push('camera.pos must be [x,y,z]');
  if (!Array.isArray(shot.actors)) errs.push('actors must be an array');
  for (const a of shot.actors || []) {
    if (!ARCHETYPES.includes(a.archetype)) errs.push(`actor ${a.id}: bad archetype "${a.archetype}"`);
    if (!VARIANTS.includes(a.variant)) errs.push(`actor ${a.id}: bad variant "${a.variant}"`);
  }
  for (const k of ['visible', 'clock']) if (!(k in (shot.hud || {}))) errs.push(`hud.${k} missing`);
  return errs;
}

/** The UIScreen interface, for reference:  { draw(c2d, t, state, ui) } */
export const UI_SCREEN_KEYS = Object.freeze(['title', 'teamSelect', 'uniform', 'playcall']);

export default { makeShot, validateShot, normalizeActor, FIELD, MAT_SLOTS, ARCHETYPES, VARIANTS, FX_KINDS };
