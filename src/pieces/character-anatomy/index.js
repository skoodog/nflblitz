// PIECE: character-anatomy — player geometry, LOD chain, imposter proxy.
// OWNER: this directory ONLY.
// SLOT:  world.anatomy   (registerWorld('anatomy', impl))
//
// WHAT THIS PIECE OWNS
//   The body. Geometry only: no materials (uniform-kit), no posing (pose-animation).
//   For LOD0-LOD2, one merged SkinnedMesh per actor, bound to the foundation's frozen
//   26-bone rig, procedurally generated per archetype with seeded variation, differing
//   by ring density and by how many material slots they expose (slots == draw calls).
//   For LOD3 there is NO per-actor mesh at all: every distant actor is one instance in a
//   shared, non-skinned InstancedMesh built by the same part builders in their coarse
//   form (imposter.js). That is what makes the rung table's `imposter` column real —
//   before it existed, LOD3 was another SkinnedMesh and the floor rung counted 14 skinned
//   actors against a cap of 6.
//
// UV CONVENTION (uniform-kit reads this; nothing else does)
//   Torso, pelvis: u = 0.25 front centre, 0.75 back centre, seam under the left arm.
//   v = 0 at the jersey hem, 1 at the collar. Limbs: u wraps the tube, v runs distally.
//
// STRUCTURAL COST, measured by scripts/budget.mjs via userData.piece:
//   LOD0 12 draw calls / 24,782 tris    LOD1 6 / 9,858    LOD2 3 / 3,450
//   LOD3 ONE draw call and 814 triangles for ALL distant actors together — a single
//        non-skinned InstancedMesh, so a distant actor is not a SkinnedMesh at all.

import * as THREE from 'three';
import { registerWorld, registerIsoShot } from '../../foundation/registry.js';
import { MAT_SLOTS } from '../../foundation/contracts.js';
import { RUNGS } from '../../foundation/quality.js';
import { buildActor, buildImposterActor, lodReport } from './actor.js';
import { installStudio, enforceStudio } from './studio.js';
import {
  addInstance, setInstanceKit, setBatchMaterial, resetBatch, currentBatch, kitColor,
} from './imposter.js';

export const PIECE = 'character-anatomy';

/* --------------------------------------------------------------- LOD policy */

/**
 * Rung -> LOD mix. The structural table gives each tier a skinned/imposter split and a
 * draw-call cap; this turns that into "how many actors get which level", nearest first.
 * lod0 is reserved for the focal actor(s) — the ones a player is actually looking at.
 *
 * lod0 + lod1 + lod2 is the SkinnedMesh count and must equal the rung's `skinned`; lod3
 * is the rung's `imposter` and costs ONE shared draw call however many there are. The
 * draw-call totals per rung, counted not guessed (LOD0 12, LOD1 6, LOD2 3, LOD3 1 shared):
 *   high  2*12 + 4*6 + 8*3      = 72   of 280
 *   mid   3*6  + 11*3           = 51   of 180
 *   low   10*3 + 1              = 31   of 110
 *   floor 6*3  + 1              = 19   of 60      skinned 6 of 6
 * The floor row is the one that used to be impossible: 14 actors x 1 SkinnedMesh each,
 * 14 skinned against a cap of 6, whatever the `imposter` column said.
 */
function lodPlan(rung) {
  const r = RUNGS[rung === undefined ? 15 : rung];
  if (!r) return { lod0: 1, lod1: 3, lod2: 10, lod3: 0 };
  if (rung >= 12) return { lod0: 2, lod1: 4, lod2: 8, lod3: 0 };
  if (rung >= 7) return { lod0: 0, lod1: 3, lod2: r.skinned - 3, lod3: r.imposter };
  return { lod0: 0, lod1: 0, lod2: r.skinned, lod3: r.imposter };
}

let currentRung = 15;
let actorSerial = 0;
let lastShot = null;
let batchOwnerAssigned = false;

/**
 * DISTANCE RANK — which actor is "nearest" for LOD purposes.
 *
 * This used to be raw build order, which meant the LOD ladder handed full detail to
 * whichever actor the sim happened to emit first and an imposter to whoever was last,
 * regardless of where they stood. Ranking by distance to the shot's own camera (which is
 * known at build time, unlike the live camera, and is the same data the assembler places
 * the cast from) makes "nearest first" true instead of aspirational. Ties break on index
 * so the result is byte-identical for a given ShotSpec.
 */
const rankOf = [];
const rankScratch = [];

function computeRanks(shot) {
  rankOf.length = 0;
  rankScratch.length = 0;
  const acts = (shot && shot.actors) || [];
  const cam = (shot && shot.camera && shot.camera.pos) || [0, 2.2, 14];
  for (let i = 0; i < acts.length; i++) {
    const a = acts[i];
    const p = a.pos || [0, 0, 0];
    const dx = p[0] - cam[0], dy = p[1] - cam[1], dz = p[2] - cam[2];
    // Heroes and the ball carrier are pinned to the front of the queue: the actor a shot
    // is ABOUT never drops to an imposter, however far upfield the camera has drifted.
    const focal = a.hero || a.role === 'carrier' ? -1e6 : 0;
    rankScratch.push({ i, d: focal + dx * dx + dy * dy + dz * dz });
  }
  rankScratch.sort((x, y) => (x.d - y.d) || (x.i - y.i));
  for (let k = 0; k < rankScratch.length; k++) rankOf[rankScratch[k].i] = k;
}

/**
 * Start of a build pass, detected without a foundation hook.
 *
 * The old test was `ctx.shot !== lastShot`, and it was WRONG for the case that matters
 * most: the runtime's `rebuildActorLod()` re-runs the actor loop against the SAME shot
 * object, so the serial never reset, every index landed past the end of the plan, and
 * `pickLod` returned 3 for all fourteen actors. Measured: the floor rung drew 14 x 2,256
 * = 31,584 triangles — the LOD3 count, exactly — instead of its planned 6 x LOD2 +
 * 8 x LOD3. The rung ladder was rebuilding the cast into a single level and calling it a
 * mix. Length is the reliable signal: a pass is over when every actor in the shot has
 * been built.
 */
function beginPassIfNeeded(ctx) {
  const n = (ctx.shot && ctx.shot.actors && ctx.shot.actors.length) || 0;
  if (ctx.shot === lastShot && actorSerial < Math.max(1, n)) return;
  lastShot = ctx.shot;
  actorSerial = 0;
  batchOwnerAssigned = false;
  resetBatch();
  computeRanks(ctx.shot);
}

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
  // Rank, not build order — see computeRanks(). Falls back to the index if the shot has
  // no actor list to rank (a piece may build an actor outside a ShotSpec).
  let n = rankOf[index] !== undefined ? rankOf[index] : index;
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

// Scratch for the imposter's two kit colours. Written at build time only.
const IMP_A = new THREE.Color();
const IMP_B = new THREE.Color();

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
    beginPassIfNeeded(ctx);
    const index = actorSerial++;
    const lod = pickLod(ctx, index);
    const spec = ctx.shot && ctx.shot.actors && ctx.shot.actors[index];

    let actor;
    if (lod === 3) {
      actor = buildImposterActor(THREE, ctx, opts);
      const handle = addInstance(THREE, ctx, PIECE, spec, actor.root, {
        archetype: actor.archetype, heightM: actor.heightM,
      });
      if (handle) {
        actor.imposter = handle;
        actor.triangles = handle.batch.triangles;
        actor.vertices = handle.batch.vertices;
      } else {
        // Batch full. Fall back to a real LOD2 mesh rather than losing a player: a missing
        // actor is a correctness bug, an extra draw call is a budget line.
        actor = buildActor(THREE, ctx, opts, 2);
      }
    } else {
      actor = buildActor(THREE, ctx, opts, lod);
    }

    actor.index = index;
    actor.root.userData.piece = PIECE;
    if (actor.mesh) actor.mesh.userData.piece = PIECE;

    const cfg = ctx.shot && ISO[ctx.shot.id];
    if (cfg) {
      actor.isoLook = cfg.look || 'clay';
      if (index === 0) {
        const studio = installStudio(ctx, {
          silhouette: actor.isoLook === 'ink',
          camAz: cfg.camAz !== undefined ? cfg.camAz : 0.5,
          exposure: cfg.studioExposure !== undefined ? cfg.studioExposure : 1.0,
          keyBoost: cfg.keyBoost || 1,
          scale: cfg.studioScale,
          fog: cfg.studioFog,
        });
        actor.update = function update() { enforceStudio(ctx, studio); };
      }
    }
    // ONE actor per pass owns the batch's one-shot re-sync. See imposter.js `sync()`:
    // after the first frame it is a boolean test, and it exists so a root moved by
    // something other than the assembler cannot leave an imposter behind.
    if (actor.imposter && !batchOwnerAssigned) {
      batchOwnerAssigned = true;
      const prev = actor.update;
      const b = actor.imposter.batch;
      actor.update = function update(t, c) { b.sync(); if (prev) prev(t, c); };
    }
    return actor;
  },

  setMaterials(actor, matSet) {
    if (!actor) return;

    // IMPOSTER. One shared material for the whole batch; identity rides on two per-instance
    // colours, and the value structure within each is baked into the proxy's vertices.
    if (actor.imposter) {
      if (actor.isoLook === 'ink') { setBatchMaterial(inkMaterial()); return; }
      const source = actor.isoLook === 'clay' ? clayMaterials() : matSet;
      kitColor(THREE, source, 'jersey', 'jersey', CLAY.jersey.c, IMP_A);
      kitColor(THREE, source, 'pants', 'pants', CLAY.pants.c, IMP_B);
      setInstanceKit(actor.imposter, IMP_A, IMP_B);
      return;
    }

    if (!actor.mesh) return;
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

  /**
   * The LOD ladder as BUILT, not as documented — triangles and draw calls counted from
   * real geometry. `window.__BLITZ_WORLD__`-free so a critic can call it from any page:
   *   window.__BLITZ_ANATOMY__.lodCosts()
   */
  lodCosts(archetype, seed) { return lodReport(THREE, archetype, seed); },

  /** What the shared imposter batch is currently carrying. */
  imposterStats() {
    const b = currentBatch();
    if (!b) return { active: false, instances: 0, drawCalls: 0, triangles: 0 };
    return {
      active: true,
      instances: b.mesh.count,
      drawCalls: 1,
      trianglesEach: b.triangles,
      triangles: b.triangles * b.mesh.count,
      verticesEach: b.vertices,
      skinnedMeshes: 0,
    };
  },

  /** The plan the current rung is actually running, with its counted cost. */
  planStats(rung) {
    const p = lodPlan(rung === undefined ? currentRung : rung);
    const r = lodReport(THREE);
    const calls = p.lod0 * r[0].drawCalls + p.lod1 * r[1].drawCalls
      + p.lod2 * r[2].drawCalls + (p.lod3 > 0 ? 1 : 0);
    const tris = p.lod0 * r[0].triangles + p.lod1 * r[1].triangles
      + p.lod2 * r[2].triangles + p.lod3 * r[3].triangles;
    return { rung: rung === undefined ? currentRung : rung, plan: p, drawCalls: calls, triangles: tris, skinned: p.lod0 + p.lod1 + p.lod2 };
  },
};

if (typeof window !== 'undefined') window.__BLITZ_ANATOMY__ = impl;

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

/**
 * THE IMPOSTER TEST, taken at the distance imposters are actually used at.
 *
 * A triangle count proves nothing about whether an imposter POPS. The floor rung hands
 * LOD3 to the eight actors farthest from the camera, which in `live_play` — camera at
 * [3.0, 3.2, 13.0], cast spread from z -14.5 to +12.5 — puts them 18 to 32 m out. So this
 * shot stands three PAIRS at 22 m, each pair the same archetype, same seed, same kit, one
 * built as LOD2 and one as an instanced imposter, in real uniform-kit materials rather
 * than clay. If the imposter reads as a different player, a flat cutout, or the wrong
 * value, it shows here at 1920x1080 — a far harsher test than the 109x236 buffer the
 * floor rung actually renders into.
 *
 * Left pair skill, centre pair lineman, right pair lb. LOD2 is always the left of a pair.
 */
ISO.iso_player_imposter = {
  look: 'kit', camAz: 0.0, studioExposure: 1.06, keyBoost: 1.0,
  studioScale: 5.5, studioFog: 0.0075,
  lodByActor: [2, 3, 2, 3, 2, 3],
};
registerIsoShot('iso_player_imposter', {
  piece: PIECE,
  panel: 'truck',
  camera: { pos: [0.0, 3.05, 22.0], target: [0.0, 1.10, 0], fov: 40, roll: 0 },
  lens: { fStop: 8, focusDist: 22.0, bokehScale: 0, shutter: 0 },
  exposure: 1.0,
  actors: [
    { id: 'skill_lod2', team: 'CHI', variant: 'home', number: '24', name: 'RAZE', archetype: 'skill', pose: 'idle', pos: [-3.30, 0, 0], rotY: 0.34, seed: 4211, dirt: 0.2, wet: 0.1 },
    { id: 'skill_imp', team: 'CHI', variant: 'home', number: '24', name: 'RAZE', archetype: 'skill', pose: 'idle', pos: [-2.05, 0, 0], rotY: 0.34, seed: 4211, dirt: 0.2, wet: 0.1 },
    { id: 'line_lod2', team: 'LA', variant: 'away', number: '77', name: 'DRAKE', archetype: 'lineman', pose: 'idle', pos: [-0.62, 0, 0], rotY: 0.34, seed: 903, dirt: 0.2, wet: 0.1 },
    { id: 'line_imp', team: 'LA', variant: 'away', number: '77', name: 'DRAKE', archetype: 'lineman', pose: 'idle', pos: [0.68, 0, 0], rotY: 0.34, seed: 903, dirt: 0.2, wet: 0.1 },
    { id: 'lb_lod2', team: 'SEA', variant: 'home', number: '56', name: 'CROW', archetype: 'lb', pose: 'idle', pos: [2.05, 0, 0], rotY: 0.34, seed: 77, dirt: 0.2, wet: 0.1 },
    { id: 'lb_imp', team: 'SEA', variant: 'home', number: '56', name: 'CROW', archetype: 'lb', pose: 'idle', pos: [3.30, 0, 0], rotY: 0.34, seed: 77, dirt: 0.2, wet: 0.1 },
  ],
  hud: { visible: false },
  callout: { visible: false },
  ui: { screen: null },
  note: 'Three PAIRS at 22 m — the distance the floor rung actually uses LOD3 at. In each pair the LEFT figure is a skinned LOD2 mesh and the RIGHT is one instance of the shared imposter batch. Judge: does the right figure pop? Same height, same shoulder shelf, same helmet profile, same value banding (dark jersey, light pants, dark boot), same team colour?',
});

export default impl;
