// PIECE impact-fx — the world.fx slot implementation.
//
// THE INTERFACE (foundation/fallbacks/fx.js, foundation/world.js):
//   build(ctx) -> Object3D                     added to the world root
//   emitImpact(pos, dir, power, kind)          called once per ShotSpec.fx entry
//   ball(ctx) -> { mesh, setFlame, setSpin, update }
//   reset()                                    before every build
//   update(t, ctx)                             every frame
//   applyRung(rung, spec, ctx)                 whenever the quality ladder moves
//
// ---------------------------------------------------------------------------------
// THE PART OF THIS FILE THAT IS NOT OBVIOUS: WHERE AN IMPACT ACTUALLY IS.
//
// The brief says to drive the effects off the simulation's real event log, and that is
// exactly what happens here — but not through the route it looks like it should.
//
// What play-sim publishes (sim.js) is:
//     { tick, kind, slot }          e.g. { tick: 91, kind: 'fumble', slot: 'ROVER',
//                                          by: 'REC2', sack: true }
// and adapt.js re-times it into seconds. There is no POSITION on an event, and no
// POWER. foundation/scenes.js then does
//     fx: events.map(ev => ({ kind: ev.kind, pos: ev.pos, dir: [0,1,0], power: ev.power,
//                             age: t - ev.t }))
// and `ev.pos` / `ev.power` are undefined, so contracts.makeShot() defaults them to
// [0,1,0] and 1. On top of that, FX_KINDS is only ['hit','truck','catch','cleat'], so
// makeShot coerces tackle / sack / fumble / broken-tackle / interception / throw /
// scramble / throwaway ALL to 'hit'.
//
// So by the time world.js calls emitImpact for a live scene, every event in a down is a
// power-1 'hit' at the origin, one metre up. I found this by capturing `live_play` at
// t=1.6 and getting a single burst hanging in mid-air at midfield while the tackle it
// belonged to was fifteen metres away.
//
// scenes.js and world.js are frozen foundation, so the fix is on this side: for a live
// shot this piece asks REG.sim for the event log ITSELF — the same create/seekTo/
// snapshot calls scenes.js makes, with the same seed and the same t, therefore the same
// bytes — and recovers `kind`, `slot` and `tick` before they are flattened. The slot
// names the man, the snapshot actors carry that man's world position, and the impact
// goes where the bodies are. Non-live shots (every hero panel and every iso shot) hand
// over real coordinates in the ShotSpec and none of this runs.
// ---------------------------------------------------------------------------------

import * as THREE from 'three';
import { REG } from '../../foundation/registry.js';
import { POOL_GLOW, POOL_DEBRIS, prioCut } from './config.js';
import { fxAtlas } from './atlas.js';
import { makeQuadMaterial, makeBatch, flush, resetBatch, disposeBatch } from './quads.js';
import { emitBurst } from './bursts.js';
import { makeBall } from './ball.js';

/** sim event kind -> (visual family, power, where on the body). */
const EVENT_MAP = {
  tackle: { kind: 'hit', power: 1.75, y: 1.02, mid: true },
  sack: { kind: 'hit', power: 2.05, y: 1.05, mid: true },
  fumble: { kind: 'hit', power: 2.30, y: 1.05, mid: true },
  'broken-tackle': { kind: 'truck', power: 1.30, y: 1.00, mid: true },
  interception: { kind: 'catch', power: 1.45, y: 1.35, mid: false },
  catch: { kind: 'catch', power: 1.20, y: 1.38, mid: false },
  incomplete: { kind: 'catch', power: 0.55, y: 1.30, mid: false },
  scramble: { kind: 'cleat', power: 1.00, y: 0.05, mid: false },
  throw: { kind: 'cleat', power: 0.70, y: 0.05, mid: false },
  throwaway: null,
};

/** Anything older than this cannot still be on screen; do not spend quads on it. */
const MAX_AGE = 1.9;

const impl = {
  piece: 'impact-fx',

  _state: null,
  _ball: null,
  _rung: 15,

  build(ctx) {
    const atlas = fxAtlas();
    const fogD = (ctx.scene && ctx.scene.fog && ctx.scene.fog.density) || 0.0082;

    const group = new THREE.Group();
    group.name = 'fx';

    const glowMat = makeQuadMaterial(atlas, { additive: true, fogD });
    const debrisMat = makeQuadMaterial(atlas, { additive: false, fogD });
    const glow = makeBatch(POOL_GLOW, glowMat, 'fx.glow', 12);
    const debris = makeBatch(POOL_DEBRIS, debrisMat, 'fx.debris', 1);
    group.add(debris.mesh);
    group.add(glow.mesh);

    const S = {
      ctx, group, glow, debris, glowMat, debrisMat,
      seed: (ctx.seed | 0) || 7,
      // Live-scene event recovery, resolved lazily on the first emitImpact so a scene
      // that has no fx entries never pays for it.
      liveTried: false,
      liveEvents: null,
    };
    this._state = S;
    this.applyRung(this._rung, null, ctx);
    return group;
  },

  /**
   * Re-derive the simulation's event log with its kinds and slots intact.
   * Identical inputs to the ones scenes.js used, so identical output.
   */
  _liveEvents(S) {
    if (S.liveTried) return S.liveEvents;
    S.liveTried = true;
    const shot = S.ctx.shot;
    if (!shot || !shot.live || !REG.sim || !REG.sim.create) return null;
    try {
      const st = REG.sim.create(S.ctx.seed, { teamA: 'NYC', teamB: 'CHI' });
      REG.sim.seekTo(st, S.ctx.t);
      const snap = REG.sim.snapshot(st);
      S.liveEvents = (snap && snap.events) || null;
    } catch (e) {
      S.liveEvents = null;
    }
    return S.liveEvents;
  },

  /**
   * emitImpact(pos, dir, power, kind)
   *
   * `age` is not a parameter — world.js drops it — so it is recovered by finding the
   * ShotSpec entry this call came from. world.js passes `f.pos` BY REFERENCE, so an
   * identity search over shot.fx is exact, and it also gives the entry's index, which is
   * what lines the call up with the simulation event it came from.
   */
  emitImpact(pos, dir, power = 1, kind = 'hit') {
    const S = this._state;
    if (!S) return;
    const shot = S.ctx.shot;

    let px = Array.isArray(pos) ? pos[0] : (pos && pos.x) || 0;
    let py = Array.isArray(pos) ? pos[1] : (pos && pos.y) || 1;
    let pz = Array.isArray(pos) ? pos[2] : (pos && pos.z) || 0;
    let dx = Array.isArray(dir) ? dir[0] : (dir && dir.x) || 0;
    let dy = Array.isArray(dir) ? dir[1] : (dir && dir.y) || 1;
    let dz = Array.isArray(dir) ? dir[2] : (dir && dir.z) || 0;
    let p = power;
    let k = kind;
    let age = 0;
    let index = -1;

    if (shot && shot.fx) {
      for (let i = 0; i < shot.fx.length; i++) {
        if (shot.fx[i].pos === pos) { index = i; age = shot.fx[i].age || 0; break; }
      }
    }

    if (shot && shot.live && index >= 0) {
      const evs = this._liveEvents(S);
      const ev = evs && evs[index] ? evs[index] : null;
      const m = ev ? EVENT_MAP[ev.kind] : undefined;
      if (m === null) return;                       // throwaway: nothing happens
      if (ev) age = S.ctx.t - ev.t;
      const spec = m || EVENT_MAP.tackle;
      k = spec.kind; p = spec.power;
      if (!this._placeFromSlot(S, ev && ev.slot, spec, shot)) return;
      px = PLACE[0]; py = PLACE[1]; pz = PLACE[2];
      dx = PLACE[3]; dy = PLACE[4]; dz = PLACE[5];
    }

    if (age > MAX_AGE || age < -0.001) return;
    emitBurst(S, k, px, py, pz, dx, dy, dz, p, S.ctx.t - age, S.seed + index * 7919);
    flush(S.glow);
    flush(S.debris);
  },

  /**
   * Put the burst on the men involved. Returns false if the scene cannot say where they
   * are, in which case the impact is dropped rather than drawn at the origin.
   * Writes into the module-level PLACE scratch: [x, y, z, dirX, dirY, dirZ].
   */
  _placeFromSlot(S, slot, spec, shot) {
    const actors = shot.actors;
    if (!actors || !actors.length) return false;
    let man = null, hero = null;
    const want = slot ? String(slot).toLowerCase() : null;
    for (let i = 0; i < actors.length; i++) {
      const a = actors[i];
      if (a.hero && !hero) hero = a;
      if (want && !man && (a.id === `d_${want}` || a.id === `o_${want}`)) man = a;
    }
    if (!man) man = hero;
    if (!man) return false;

    let ax = man.pos[0], az = man.pos[2];
    let bx = ax, bz = az;
    if (spec.mid && hero && hero !== man) { bx = hero.pos[0]; bz = hero.pos[2]; }
    // Contact is on the tackler's side of the midpoint — that is where the helmet is.
    PLACE[0] = ax + (bx - ax) * 0.58;
    PLACE[1] = spec.y;
    PLACE[2] = az + (bz - az) * 0.58;
    let vx = bx - ax, vz = bz - az;
    const L = Math.hypot(vx, vz);
    if (L < 0.05) { vx = Math.cos(man.rotY || 0); vz = Math.sin(man.rotY || 0); }
    else { vx /= L; vz /= L; }
    // A tackle drives slightly UP through the ball carrier; a plant does not.
    PLACE[3] = vx; PLACE[4] = spec.mid ? 0.34 : 0.9; PLACE[5] = vz;
    return true;
  },

  ball(ctx) {
    const b = makeBall(ctx);
    this._ball = b;
    b.applyRung(this._rung, RUNG_CACHE);
    return b;
  },

  /**
   * Two uniform writes for the impact batches; the ball owns its own. No allocation,
   * no branching on scene contents, and nothing that grows with the number of live
   * particles — which is the whole point of the closed-form vertex integration.
   */
  update(t) {
    const S = this._state;
    if (!S) return;
    S.glowMat.uniforms.uTime.value = t;
    S.debrisMat.uniforms.uTime.value = t;
  },

  /**
   * The quality ladder. One uniform per batch. Allocates nothing, compiles nothing,
   * creates no render target, and applyRung(9) twice is applyRung(9) once — the four
   * conditions foundation/registry.js puts on this method.
   */
  applyRung(rung, spec, ctx) {
    this._rung = rung;
    if (spec) RUNG_CACHE = spec;
    const s = spec || RUNG_CACHE;
    const cut = s ? prioCut(s.particles) : 1;
    const S = this._state;
    if (S) {
      S.glowMat.uniforms.uPrioCut.value = cut;
      S.debrisMat.uniforms.uPrioCut.value = cut;
    }
    if (this._ball) this._ball.applyRung(rung, s);
    void ctx;
  },

  reset() {
    const S = this._state;
    if (!S) return;
    resetBatch(S.glow);
    resetBatch(S.debris);
    S.liveTried = false;
    S.liveEvents = null;
  },

  dispose() {
    const S = this._state;
    if (!S) return;
    disposeBatch(S.glow);
    disposeBatch(S.debris);
    S.glowMat.dispose();
    S.debrisMat.dispose();
    this._state = null;
  },
};

// Scratch for _placeFromSlot: [x, y, z, dx, dy, dz]. Impact placement is not on the
// frame path, but it is on the "the player just got hit" path, and that is the worst
// possible frame to allocate on.
const PLACE = new Float64Array(6);

// The last rung spec seen. applyRung may be called before build() (createRuntime forces
// a rung during pre-warm) and after a rebuild, so the spec has to survive both.
let RUNG_CACHE = null;

export default impl;
