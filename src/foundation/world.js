// FOUNDATION — FROZEN after t=0. Do not edit.
// The world assembler. Turns a ShotSpec into a live THREE.Scene, in a FIXED order
// so that whichever slots are real and whichever are still fallbacks, the result is
// always the same shape.
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
  if (turfObj) { root.add(turfObj); world.turf = turfObj; }

  // 2. STADIUM --------------------------------------------------------------
  const stadObj = safe('stadium.build', () => REG.world.stadium.build(ctx), null);
  if (stadObj) { root.add(stadObj); world.stadium = stadObj; }

  // 3. LIGHTING -------------------------------------------------------------
  const lit = safe('lighting.build', () => REG.world.lighting.build(ctx), null);
  if (lit) {
    if (lit.group) root.add(lit.group);
    if (lit.env !== undefined && lit.env !== null) scene.environment = lit.env;
    if (typeof lit.applyToRenderer === 'function') {
      safe('lighting.applyToRenderer', () => lit.applyToRenderer(ctx.renderer));
    }
    world.lighting = lit;
  }

  // 4. ACTORS ---------------------------------------------------------------
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
    actor.root.name = `actor:${a.id}`;
    actor.spec = a;
    root.add(actor.root);
    world.actors.push(actor);
  });

  // 5. FX + BALL ------------------------------------------------------------
  const fxImpl = REG.world.fx;
  safe('fx.reset', () => fxImpl.reset && fxImpl.reset());
  const fxObj = safe('fx.build', () => fxImpl.build(ctx), null);
  if (fxObj) { root.add(fxObj); world.fx = fxObj; }

  if (shot.ball && shot.ball.visible) {
    const ball = safe('fx.ball', () => fxImpl.ball(ctx), null);
    if (ball && ball.mesh) {
      ball.mesh.position.set(shot.ball.pos[0], shot.ball.pos[1], shot.ball.pos[2]);
      if (shot.ball.rotQ) {
        ball.mesh.quaternion.set(shot.ball.rotQ[0], shot.ball.rotQ[1], shot.ball.rotQ[2], shot.ball.rotQ[3]);
      }
      safe('ball.setFlame', () => ball.setFlame && ball.setFlame(shot.ball.flame || 0));
      safe('ball.setSpin', () => ball.setSpin && ball.setSpin(shot.ball.spin || 0));
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
  world.update = function update(t, c) {
    const cc = c || ctx;
    safe('turf.update', () => turfImpl.update && turfImpl.update(t, cc));
    safe('stadium.update', () => REG.world.stadium.update && REG.world.stadium.update(t, cc));
    safe('lighting.update', () => REG.world.lighting.update && REG.world.lighting.update(t, cc));
    safe('fx.update', () => fxImpl.update && fxImpl.update(t, cc));
    if (world.ball && world.ball.update) safe('ball.update', () => world.ball.update(t, cc));
    safe('cinema.update', () => REG.cinema.update && REG.cinema.update(t, cc));
    safe('cinema.applyShot', () => REG.cinema.applyShot(cc.camera, shot, t, cc));
    for (const actor of world.actors) {
      if (actor.update) safe('actor.update', () => actor.update(t, cc));
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

export default { buildFromShot };
