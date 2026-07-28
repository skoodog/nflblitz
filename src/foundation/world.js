// FOUNDATION — the BUILD ORDER below is frozen. Turns a ShotSpec into a live
// THREE.Scene, in a FIXED order so that whichever slots are real and whichever are still
// fallbacks, the result is always the same shape.
//
// ROUND 2 amendment: the actor loop is factored out into `buildActors()` and exported,
// with the build order and every call inside it byte-for-byte unchanged. The runtime
// needs to re-run JUST that loop when the quality rung crosses an actor-LOD boundary,
// because `character-anatomy` picks an actor's LOD when the actor is BUILT and never
// again. Nothing else about the assembler moved.
//
//   turf.build
//   stadium.build
//   lighting.build
//   for each actor: anatomy.build -> uniform.materials -> anatomy.setMaterials -> pose.apply
//   fx.build + fx.ball
//   shot.turfDamage -> turf.addDivot / addCleatMark / addSkid
//   cinema.applyShot
//   cinema.buildPost

import * as THREE from 'three';
import { REG } from './registry.js';
import { MAT_SLOTS } from './contracts.js';
import { tagPiece } from './budget.js';

/**
 * Which PIECE owns each world slot. `budget.mjs` attributes every draw call and every
 * triangle through `userData.piece`, so the assembler stamps it as it builds — a piece
 * must not have to remember, and a piece that forgets must not become "unattributed"
 * and therefore un-billable. Before this existed, 119 of 120 drawables in `live_play`
 * were unattributed and the per-piece table was useless.
 */
const SLOT_PIECE = {
  turf: 'turf-field',
  stadium: 'stadium-env',
  lighting: 'stadium-lighting',
  anatomy: 'character-anatomy',
  fx: 'impact-fx',
  post: 'cinematography',
};

function safe(label, fn, fallbackValue) {
  try {
    return fn();
  } catch (e) {
    const msg = `[world] ${label} threw: ${e && e.message}`;
    console.error(msg, e);
    (window.__BLITZ_ERRORS__ = window.__BLITZ_ERRORS__ || []).push(msg);
    return fallbackValue;
  }
}

/**
 * Step 4 of the assembler, extracted verbatim so the runtime can re-run it alone.
 * Appends to `world.actors` and to `root`. Every call, and their order, is unchanged
 * from when this was inline.
 */
export function buildActors(shot, ctx, root, world) {
  const anatomy = REG.world.anatomy;
  const uniform = REG.world.uniform;
  const pose = REG.world.pose;

  shot.actors.forEach((a, i) => {
    const actor = safe(`anatomy.build[${a.id}]`, () => anatomy.build(ctx, {
      archetype: a.archetype,
      heightM: a.heightM,
      massKg: a.massKg,
      seed: a.seed !== undefined ? a.seed : (ctx.seed * 977 + i * 131),
    }), null);
    if (!actor || !actor.root) return;

    const matSet = safe(`uniform.materials[${a.team}/${a.variant}]`, () => uniform.materials(ctx, a.team, a.variant, {
      number: a.number, name: a.name, dirt: a.dirt, wet: a.wet,
    }), null);
    if (matSet) {
      // Contract guard: every MAT_SLOTS key must exist. Missing keys become plain grey.
      for (const k of MAT_SLOTS) {
        if (!matSet[k]) matSet[k] = new THREE.MeshStandardMaterial({ color: 0x8e8e93, roughness: 0.9 });
      }
      safe(`anatomy.setMaterials[${a.id}]`, () => anatomy.setMaterials(actor, matSet));
    }

    safe(`pose.apply[${a.pose}]`, () => pose.apply(actor.skeleton, a.pose, a.phase, a.seed !== undefined ? a.seed : ctx.seed + i));

    actor.root.position.set(a.pos[0], a.pos[1], a.pos[2]);
    actor.root.rotation.y = a.rotY;
    if (a.scale !== 1) actor.root.scale.setScalar(a.scale);
    tagPiece(actor.root, SLOT_PIECE.anatomy);
    actor.root.name = `actor:${a.id}`;
    actor.spec = a;
    root.add(actor.root);
    world.actors.push(actor);
  });
}

/**
 * Tear down just the actors, leaving turf, stadium, lighting, fx and post alone.
 *
 * ONLY the per-actor GEOMETRY is disposed. Materials are NOT: `uniform-kit` hands out a
 * cached, shared material set per team+variant, so disposing them here would blank every
 * other actor wearing the same kit and would force a re-bake (and a shader recompile) on
 * the next rebuild — the exact hitch this whole mechanism exists to avoid.
 */
export function disposeActors(world) {
  const acts = world.actors;
  for (let i = 0; i < acts.length; i++) {
    const a = acts[i];
    if (!a || !a.root) continue;
    if (a.root.parent) a.root.parent.remove(a.root);
    if (a.mesh && a.mesh.geometry && a.mesh.geometry.dispose) a.mesh.geometry.dispose();
  }
  acts.length = 0;
}

export function buildFromShot(shot, ctx) {
  const scene = ctx.scene;
  const root = new THREE.Group();
  root.name = 'world';
  scene.add(root);

  const world = {
    root,
    shot,
    turf: null,
    stadium: null,
    lighting: null,
    actors: [],
    fx: null,
    ball: null,
    post: null,
    _disposed: false,
  };

  // 1. TURF -----------------------------------------------------------------
  const turfImpl = REG.world.turf;
  safe('turf.reset', () => turfImpl.reset && turfImpl.reset());
  const turfObj = safe('turf.build', () => turfImpl.build(ctx), null);
  if (turfObj) { tagPiece(turfObj, SLOT_PIECE.turf); root.add(turfObj); world.turf = turfObj; }

  // 2. STADIUM --------------------------------------------------------------
  const stadObj = safe('stadium.build', () => REG.world.stadium.build(ctx), null);
  if (stadObj) { tagPiece(stadObj, SLOT_PIECE.stadium); root.add(stadObj); world.stadium = stadObj; }

  // 3. LIGHTING -------------------------------------------------------------
  const lit = safe('lighting.build', () => REG.world.lighting.build(ctx), null);
  if (lit) {
    if (lit.group) { tagPiece(lit.group, SLOT_PIECE.lighting); root.add(lit.group); }
    if (lit.env !== undefined && lit.env !== null) scene.environment = lit.env;
    if (typeof lit.applyToRenderer === 'function') {
      safe('lighting.applyToRenderer', () => lit.applyToRenderer(ctx.renderer));
    }
    world.lighting = lit;
  }

  // 4. ACTORS ---------------------------------------------------------------
  buildActors(shot, ctx, root, world);

  // 5. FX + BALL ------------------------------------------------------------
  const fxImpl = REG.world.fx;
  safe('fx.reset', () => fxImpl.reset && fxImpl.reset());
  const fxObj = safe('fx.build', () => fxImpl.build(ctx), null);
  if (fxObj) { tagPiece(fxObj, SLOT_PIECE.fx); root.add(fxObj); world.fx = fxObj; }

  if (shot.ball && shot.ball.visible) {
    const ball = safe('fx.ball', () => fxImpl.ball(ctx), null);
    if (ball && ball.mesh) {
      ball.mesh.position.set(shot.ball.pos[0], shot.ball.pos[1], shot.ball.pos[2]);
      if (shot.ball.rotQ) {
        ball.mesh.quaternion.set(shot.ball.rotQ[0], shot.ball.rotQ[1], shot.ball.rotQ[2], shot.ball.rotQ[3]);
      }
      safe('ball.setFlame', () => ball.setFlame && ball.setFlame(shot.ball.flame || 0));
      safe('ball.setSpin', () => ball.setSpin && ball.setSpin(shot.ball.spin || 0));
      tagPiece(ball.mesh, SLOT_PIECE.fx);
      root.add(ball.mesh);
      world.ball = ball;
    }
  }

  for (const f of shot.fx) {
    safe(`fx.emitImpact[${f.kind}]`, () => fxImpl.emitImpact(f.pos, f.dir, f.power, f.kind));
  }

  // 6. TURF DAMAGE ----------------------------------------------------------
  for (const d of shot.turfDamage) {
    if (d.type === 'divot') {
      safe('turf.addDivot', () => turfImpl.addDivot(d.x, d.z, Math.cos(d.rot), Math.sin(d.rot), d.strength));
    } else if (d.type === 'cleat') {
      safe('turf.addCleatMark', () => turfImpl.addCleatMark(d.x, d.z, d.rot, d.strength));
    } else if (d.type === 'skid') {
      safe('turf.addSkid', () => turfImpl.addSkid(d.x, d.z, d.x1 !== undefined ? d.x1 : d.x + 1, d.z1 !== undefined ? d.z1 : d.z, d.w !== undefined ? d.w : 0.5));
    }
  }

  // 7. CAMERA + POST --------------------------------------------------------
  safe('cinema.applyShot', () => REG.cinema.applyShot(ctx.camera, shot, ctx.t, ctx));
  world.post = safe('cinema.buildPost', () => REG.cinema.buildPost(ctx, shot), null) || null;

  // ---- per-frame ----------------------------------------------------------
  //
  // ZERO ALLOCATION. This runs every frame on the runtime path, so it may not allocate
  // — and the obvious spelling of it did. `safe(label, () => impl.update(t, cc))`
  // allocates a closure per subsystem per frame, and `for (const a of world.actors)`
  // allocates an array iterator. At 60 Hz with ~10 subsystems and 14 actors that is
  // roughly 1.4 million short-lived objects a minute, which is exactly the heap
  // sawtooth the contract caps at 8 MB — measured at 8.45 MB before this was fixed,
  // together with GC pauses showing up as dropped frames in otherwise clean windows.
  //
  // try/catch itself costs nothing when nothing throws, so per-subsystem isolation is
  // kept; it is only the CLOSURE that had to go. A subsystem that throws repeatedly is
  // latched off rather than re-throwing (and re-reporting) sixty times a second.
  const updFail = new Uint8Array(8);
  const UPD_NAMES = ['turf.update', 'stadium.update', 'lighting.update', 'fx.update',
    'ball.update', 'cinema.update', 'cinema.applyShot', 'actor.update'];

  function updErr(i, e) {
    if (updFail[i] >= 3) return;
    updFail[i]++;
    const msg = `[world] ${UPD_NAMES[i]} threw: ${e && e.message}`
      + (updFail[i] >= 3 ? ' (latched off after 3 failures)' : '');
    console.error(msg, e);
    (window.__BLITZ_ERRORS__ = window.__BLITZ_ERRORS__ || []).push(msg);
  }

  world.update = function update(t, c) {
    const cc = c || ctx;
    if (updFail[0] < 3) { try { if (turfImpl.update) turfImpl.update(t, cc); } catch (e) { updErr(0, e); } }
    if (updFail[1] < 3) { try { if (REG.world.stadium.update) REG.world.stadium.update(t, cc); } catch (e) { updErr(1, e); } }
    if (updFail[2] < 3) { try { if (REG.world.lighting.update) REG.world.lighting.update(t, cc); } catch (e) { updErr(2, e); } }
    if (updFail[3] < 3) { try { if (fxImpl.update) fxImpl.update(t, cc); } catch (e) { updErr(3, e); } }
    if (updFail[4] < 3 && world.ball && world.ball.update) { try { world.ball.update(t, cc); } catch (e) { updErr(4, e); } }
    if (updFail[5] < 3) { try { if (REG.cinema.update) REG.cinema.update(t, cc); } catch (e) { updErr(5, e); } }
    if (updFail[6] < 3) { try { REG.cinema.applyShot(cc.camera, shot, t, cc); } catch (e) { updErr(6, e); } }
    const acts = world.actors;
    for (let i = 0; i < acts.length; i++) {
      const a = acts[i];
      if (!a.update) continue;
      if (updFail[7] >= 3) break;
      try { a.update(t, cc); } catch (e) { updErr(7, e); }
    }
  };

  world.dispose = function dispose() {
    if (world._disposed) return;
    world._disposed = true;
    scene.remove(root);
    root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const m = o.material;
      if (Array.isArray(m)) m.forEach((mm) => mm && mm.dispose && mm.dispose());
      else if (m && m.dispose) m.dispose();
    });
    if (world.post && world.post.dispose) world.post.dispose();
  };

  return world;
}

export default { buildFromShot, buildActors, disposeActors };
