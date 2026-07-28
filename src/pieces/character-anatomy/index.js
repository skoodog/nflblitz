// PIECE: character-anatomy — player geometry, LOD chain, imposter proxy.
// OWNER: this directory ONLY.
// SLOT:  world.anatomy   (registerWorld('anatomy', impl))
//
// WHAT THIS PIECE OWNS
//   The body. Geometry only: no materials (uniform-kit), no posing (pose-animation).
//   One merged SkinnedMesh per actor, bound to the foundation's frozen 26-bone rig,
//   procedurally generated per archetype with seeded variation, plus a four-step LOD
//   chain whose levels share ONE silhouette and differ only in ring density and how
//   many material slots they expose (slots == draw calls).
//
// UV CONVENTION (uniform-kit reads this; nothing else does)
//   Torso, pelvis: u = 0.25 front centre, 0.75 back centre, seam under the left arm.
//   v = 0 at the jersey hem, 1 at the collar. Limbs: u wraps the tube, v runs distally.
//
// STRUCTURAL COST, per actor, measured by scripts/budget.mjs via userData.piece:
//   LOD0 12 draw calls   LOD1 6   LOD2 1   LOD3 1 (instanced batch)

import * as THREE from 'three';
import { registerWorld, registerIsoShot } from '../../foundation/registry.js';
import { MAT_SLOTS } from '../../foundation/contracts.js';
import { RUNGS } from '../../foundation/quality.js';
import { buildActor } from './actor.js';
import { installStudio, enforceStudio } from './studio.js';

export const PIECE = 'character-anatomy';

/* --------------------------------------------------------------- LOD policy */

/**
 * Rung -> LOD mix. The structural table gives each tier a skinned/imposter split and a
 * draw-call cap; this turns that into "how many actors get which level", nearest first.
 * lod0 is reserved for the focal actor(s) — the ones a player is actually looking at.
 */
function lodPlan(rung) {
  const r = RUNGS[rung === undefined ? 15 : rung];
  if (!r) return { lod0: 1, lod1: 3, lod2: 10, lod3: 0 };
  // Draw calls per actor: LOD0 12, LOD1 6, LOD2 1, LOD3 1. The mixes below are chosen
  // so the total lands inside the piece's per-tier cap (8 / 16 / 42 / 64):
  //   high 2*12 + 4*6 + 8*1 = 56    mid 3*6 + 11*1 = 29
  //   low  0*6 + 10*1 + 4*1 = 14    floor 6*1 + 8*1 = 14  <-- OVER the floor cap of 8
  // Floor only closes once LOD2/LOD3 actors share one instanced batch, which is the
  // next structural task for this piece. Stated, not hidden.
  if (rung >= 12) return { lod0: 2, lod1: 4, lod2: 8, lod3: 0 };
  if (rung >= 7) return { lod0: 0, lod1: 3, lod2: r.skinned - 3, lod3: r.imposter };
  if (rung >= 3) return { lod0: 0, lod1: 0, lod2: r.skinned, lod3: r.imposter };
  return { lod0: 0, lod1: 0, lod2: r.skinned, lod3: r.imposter };
}

let currentRung = 15;
let actorSerial = 0;
let lastShot = null;

/**
 * Per-scene studio config. `makeShot()` normalises a ShotSpec down to its declared
 * fields, so anything this piece wants to carry alongside a scene lives here and is
 * looked up by scene id. Keeping it out of the ShotSpec also keeps the frozen schema
 * frozen.
 */
const ISO = Object.create(null);

/** LOD level for the actor currently being built. */
function pickLod(ctx, index) {
  if (ctx.mode === 'capture') {
    const cfg = ctx.shot && ISO[ctx.shot.id];
    if (cfg && cfg.lodByActor) {
      return cfg.lodByActor[index] !== undefined ? cfg.lodByActor[index] : 0;
    }
    return 0;                      // fidelity path: always full detail
  }
  const plan = lodPlan(currentRung);
  const spec = ctx.shot && ctx.shot.actors && ctx.shot.actors[index];
  const hero = spec && (spec.hero || spec.role === 'carrier');
  if (hero && plan.lod0 > 0) return 0;
  let n = index;
  if (n < plan.lod0) return 0;
  n -= plan.lod0;
  if (n < plan.lod1) return 1;
  n -= plan.lod1;
  if (n < plan.lod2) return 2;
  return 3;
}

/* -------------------------------------------------------------- clay looks */

/**
 * The clay look. Deliberately NOT one flat grey: a real uniform's VALUE STRUCTURE — dark
 * jersey, light pants, dark gloves and cleats, bright helmet and pads — is half of what
 * makes a football player readable in silhouette, and a critic scoring proportion needs
 * to be able to tell the jersey hem from the belt from the sock line. Hue stays neutral
 * so nothing here trespasses on uniform-kit.
 */
const CLAY = {
  skin: { c: 0x8a8480, r: 0.58, m: 0.02 },
  undershirt: { c: 0x3f434b, r: 0.86, m: 0.0 },
  jersey: { c: 0x5e626b, r: 0.74, m: 0.02 },
  pants: { c: 0x878d97, r: 0.60, m: 0.02 },
  sock: { c: 0x53575f, r: 0.82, m: 0.0 },
  cleat: { c: 0x24262b, r: 0.28, m: 0.14 },
  glove: { c: 0x33363c, r: 0.36, m: 0.10 },
  helmetShell: { c: 0xb4bac4, r: 0.12, m: 0.34 },
  facemask: { c: 0x1e2025, r: 0.38, m: 0.42 },
  visor: { c: 0x0e1014, r: 0.08, m: 0.55 },
  pad: { c: 0xc7cbd2, r: 0.48, m: 0.04 },
  towel: { c: 0xd8dbe0, r: 0.94, m: 0.0 },
};

let clayCache = null;
function clayMaterials() {
  if (clayCache) return clayCache;
  clayCache = {};
  for (const s of MAT_SLOTS) {
    const c = CLAY[s];
    const m = new THREE.MeshStandardMaterial({
      color: c.c, roughness: c.r, metalness: c.m,
    });
    m.name = `ca.clay.${s}`;
    clayCache[s] = m;
  }
  return clayCache;
}

let inkCache = null;
function inkMaterial() {
  if (inkCache) return inkCache;
  inkCache = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false, fog: false });
  inkCache.name = 'ca.ink';
  return inkCache;
}

/* ------------------------------------------------------------------- impl */

const impl = {
  piece: PIECE,

  build(ctx, opts = {}) {
    if (ctx.shot !== lastShot) { lastShot = ctx.shot; actorSerial = 0; }
    const index = actorSerial++;
    const lod = pickLod(ctx, index);
    const actor = buildActor(THREE, ctx, opts, lod);
    actor.index = index;
    actor.root.userData.piece = PIECE;
    actor.mesh.userData.piece = PIECE;

    const cfg = ctx.shot && ISO[ctx.shot.id];
    if (cfg) {
      actor.isoLook = cfg.look || 'clay';
      if (index === 0) {
        const studio = installStudio(ctx, {
          silhouette: actor.isoLook === 'ink',
          camAz: cfg.camAz !== undefined ? cfg.camAz : 0.5,
          exposure: cfg.studioExposure !== undefined ? cfg.studioExposure : 1.0,
          keyBoost: cfg.keyBoost || 1,
        });
        actor.update = function update() { enforceStudio(ctx, studio); };
      }
    }
    return actor;
  },

  setMaterials(actor, matSet) {
    if (!actor || !actor.mesh) return;
    let source = matSet;
    if (actor.isoLook === 'ink') {
      const ink = inkMaterial();
      actor.mesh.material = actor.slotOrder.length === 1 ? ink : actor.slotOrder.map(() => ink);
      actor.mesh.castShadow = false;
      return;
    }
    if (actor.isoLook === 'clay') source = clayMaterials();
    const fallback = clayMaterials().jersey;
    const arr = actor.slotOrder.map((s) => (source && source[s]) || fallback);
    actor.mesh.material = arr.length === 1 ? arr[0] : arr;
  },

  /**
   * applyRung — allocation-free, no shader compile, no render target. It only records
   * the rung; the LOD mix is consumed the next time actors are built, which is at a play
   * boundary (game-flow's enterPlay), never mid-play. That is deliberate: swapping an
   * actor's geometry inside a frame is exactly the kind of hitch the contract forbids.
   */
  applyRung(rung) {
    currentRung = rung;
  },

  /** Diagnostics for scripts/budget.mjs and the critic. */
  lodPlan,
};

registerWorld('anatomy', impl);

/* ------------------------------------------------------------- iso scenes */

const HERO_CAM_AZ = Math.atan2(1.94, 3.46);

ISO.iso_player = { look: 'clay', camAz: HERO_CAM_AZ, studioExposure: 1.14 };
registerIsoShot('iso_player', {
  piece: PIECE,
  panel: 'uniform',
  camera: { pos: [1.94, 1.06, 3.46], target: [0.00, 0.99, 0], fov: 30, roll: 0 },
  lens: { fStop: 4.0, focusDist: 3.95, bokehScale: 0.5, shutter: 0 },
  exposure: 1.0,
  actors: [
    {
      id: 'hero', team: 'CHI', variant: 'home', number: '24', name: 'HERO',
      archetype: 'skill', pose: 'idle', pos: [0, 0, 0], rotY: -0.22,
      hero: true, seed: 4211, dirt: 0, wet: 0,
    },
  ],
  hud: { visible: false },
  callout: { visible: false },
  ui: { screen: null },
  note: 'Single figure, neutral clay, 3/4 hero framing. Judge silhouette, pad shelf, helmet profile, limb proportion against the figure in bar/panel-uniform.',
});

ISO.iso_player_silhouette = { look: 'ink', camAz: 0.0, studioExposure: 1.0 };
registerIsoShot('iso_player_silhouette', {
  piece: PIECE,
  panel: 'uniform',
  camera: { pos: [0.0, 0.96, 4.05], target: [0.0, 0.96, 0], fov: 27, roll: 0 },
  lens: { fStop: 16, focusDist: 4.6, bokehScale: 0, shutter: 0 },
  exposure: 1.0,
  actors: [
    {
      id: 'front', archetype: 'skill', pose: 'idle', pos: [-0.62, 0, 0], rotY: 0,
      seed: 4211, hero: true,
    },
    {
      id: 'side', archetype: 'skill', pose: 'idle', pos: [0.62, 0, 0], rotY: 1.5708,
      seed: 4211,
    },
  ],
  hud: { visible: false },
  callout: { visible: false },
  ui: { screen: null },
  note: 'Pure black on white, front and side. The silhouette must read as an armoured football player with no shading help at all.',
});

ISO.iso_player_lineup = { look: 'clay', camAz: 0.10, studioExposure: 1.02, keyBoost: 1.1 };
registerIsoShot('iso_player_lineup', {
  piece: PIECE,
  panel: 'uniform',
  camera: { pos: [0.62, 1.24, 7.30], target: [0.10, 1.02, 0], fov: 30, roll: 0 },
  lens: { fStop: 5.0, focusDist: 7.3, bokehScale: 0.4, shutter: 0 },
  exposure: 1.0,
  actors: [
    { id: 'qb', archetype: 'qb', pose: 'idle', pos: [-1.86, 0, 0.10], rotY: -0.30, seed: 31 },
    { id: 'skill', archetype: 'skill', pose: 'idle', pos: [-0.62, 0, 0], rotY: -0.16, seed: 4211 },
    { id: 'lb', archetype: 'lb', pose: 'idle', pos: [0.66, 0, 0], rotY: 0.16, seed: 77 },
    { id: 'lineman', archetype: 'lineman', pose: 'idle', pos: [2.02, 0, 0.10], rotY: 0.32, seed: 903 },
  ],
  hud: { visible: false },
  callout: { visible: false },
  ui: { screen: null },
  note: 'qb / skill / lb / lineman. The four archetypes must be distinguishable by silhouette alone: pad flare, mass, limb girth, neck.',
});

ISO.iso_helmet = { look: 'clay', camAz: 0.62, studioExposure: 1.10, keyBoost: 1.15 };
registerIsoShot('iso_helmet', {
  piece: PIECE,
  panel: 'truck',
  camera: { pos: [0.72, 1.72, 1.10], target: [0.0, 1.655, 0.02], fov: 26, roll: 0 },
  lens: { fStop: 5.6, focusDist: 1.3, bokehScale: 0.35, shutter: 0 },
  exposure: 1.0,
  actors: [
    { id: 'head', archetype: 'lb', pose: 'idle', pos: [0, 0, 0], rotY: -0.24, seed: 4211, hero: true },
  ],
  hud: { visible: false },
  callout: { visible: false },
  ui: { screen: null },
  note: 'Helmet close-up: dome and jaw profile, tubular multi-bar facemask with a centre bar, chin strap and cup, moulded shell rim round the face port.',
});

ISO.iso_player_lod = { look: 'ink', camAz: 0.0, studioExposure: 1.0, lodByActor: [0, 1, 2, 3] };
registerIsoShot('iso_player_lod', {
  piece: PIECE,
  panel: 'uniform',
  camera: { pos: [0.0, 0.96, 6.60], target: [0.0, 0.96, 0], fov: 24, roll: 0 },
  lens: { fStop: 16, focusDist: 6.6, bokehScale: 0, shutter: 0 },
  exposure: 1.0,
  actors: [
    { id: 'lod0', archetype: 'skill', pose: 'idle', pos: [-1.44, 0, 0], rotY: -0.30, seed: 4211 },
    { id: 'lod1', archetype: 'skill', pose: 'idle', pos: [-0.48, 0, 0], rotY: -0.30, seed: 4211 },
    { id: 'lod2', archetype: 'skill', pose: 'idle', pos: [0.48, 0, 0], rotY: -0.30, seed: 4211 },
    { id: 'lod3', archetype: 'skill', pose: 'idle', pos: [1.44, 0, 0], rotY: -0.30, seed: 4211 },
  ],
  hud: { visible: false },
  callout: { visible: false },
  ui: { screen: null },
  note: 'LOD0 / LOD1 / LOD2 / LOD3 left to right, in pure silhouette. All four must read as the SAME player — a popping silhouette is worse than a low-detail one.',
});

export default impl;
