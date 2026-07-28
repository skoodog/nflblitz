// PIECE turf-field — the world.turf implementation.
//
// ONE draw call for the entire ground plane at every rung below 12 (plus one instanced
// draw for shell grass at 12-15). The field, the six-foot border, the apron and both
// end zones are the same mesh and the same material: the shader decides what each
// square metre is from its world position, so there is no seam, no z-fight and no
// second pass over the largest surface on screen.

import * as THREE from 'three';
import { tagPiece } from '../../foundation/budget.js';
import { REG } from '../../foundation/registry.js';
import TEAMDATA from '../../data/teams.json';
import {
  PLANE_X, PLANE_Z, BANKS, MAX_BANKS, rungConfig, CAPTURE_RUNG, clamp,
  GOAL_X, END_X, HALF_W,
} from './field.js';
import { bakeGrass, bakeMacro, bakeSoil, bakeNumerals, bakeWordmark, bakeCrest } from './textures.js';
import { makeTurfMaterial } from './shader.js';
import { createDamage } from './damage.js';
import { createShells } from './shells.js';

const PIECE = 'turf-field';

/* ------------------------------------------------------------------- teams */
// The shot library still speaks the pre-change abbreviations. Everything that is a
// real club abbreviation resolves straight through to src/data/teams.json; the one
// invented id maps to the club it stood in for. Colours are NEVER invented here.
const ALIAS = { NYC: 'NYG', LAR: 'LA', STL: 'LA', OAK: 'LV', SD: 'LAC', WSH: 'WAS' };

function teamOf(id) {
  const key = ALIAS[id] || id;
  const t = TEAMDATA.teams[key] || TEAMDATA.teams[String(key || '').toUpperCase()];
  return t || TEAMDATA.teams.DAL;
}

function hexToLinear(hex) {
  let s = String(hex || '#101010').replace('#', '');
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  const n = parseInt(s, 16);
  const c = new THREE.Color();
  c.setRGB(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, THREE.SRGBColorSpace);
  return c;
}

/** The end zone is painted grass, not a colour swatch: pull it down and desaturate. */
function endzoneColors(team) {
  const c0 = hexToLinear(team.colors[0]).multiplyScalar(0.58).addScalar(0.006);
  let c1 = hexToLinear(team.colors[1] || team.colors[0]).multiplyScalar(0.46).addScalar(0.005);
  // if the two are too close in value the border stripe disappears; push them apart
  const l0 = c0.r * 0.21 + c0.g * 0.72 + c0.b * 0.07;
  const l1 = c1.r * 0.21 + c1.g * 0.72 + c1.b * 0.07;
  if (Math.abs(l0 - l1) < 0.035) c1 = l0 > 0.16 ? c1.multiplyScalar(0.35) : c1.multiplyScalar(2.4);
  return [c0, c1];
}

/* --------------------------------------------------------------- the piece */

function resolveRung(ctx) {
  // An explicit rung on the shot or in ?variant= always wins — that is how
  // iso_turf_rung* proves the ladder even on the capture path.
  const shot = ctx && ctx.shot;
  if (shot && Number.isFinite(shot.rung)) return clamp(shot.rung | 0, 0, 15);
  const v = String((ctx && ctx.variant) || '');
  const m = v.match(/(?:^|[^0-9])r(?:ung)?(\d{1,2})\b/i);
  if (m) return clamp(parseInt(m[1], 10), 0, 15);
  if (ctx && ctx.quality === 'capture') return CAPTURE_RUNG;
  if (typeof window !== 'undefined' && Number.isFinite(window.__BLITZ_RUNG__)) {
    return clamp(window.__BLITZ_RUNG__ | 0, 0, 15);
  }
  return 9;
}

const impl = {
  piece: PIECE,

  _group: null,
  _mesh: null,
  _mat: null,
  _shells: null,
  _damage: null,
  _tex: null,
  _u: null,
  _cfg: null,
  _ctx: null,
  _teamId: null,
  _pending: [],

  /* ------------------------------------------------------------------ build */

  build(ctx) {
    this._ctx = ctx;
    const texlab = ctx.texlab;
    const shot = ctx.shot || {};
    const rung = resolveRung(ctx);
    const cfg = rungConfig(rung);
    this._cfg = cfg;

    const teamId = (shot.hud && shot.hud.teamA) || 'DAL';
    const team = teamOf(teamId);
    this._teamId = teamId;

    // ---- textures (cached per class + team so a rung step never re-bakes grass) --
    const seed = (ctx.seed | 0) || 7;
    const tex = {};
    const grass = texlab.cached(`turf:grass:${cfg.detail}:${seed}`, () => bakeGrass(texlab, cfg.detail, seed * 31 + 5));
    tex.albedo = grass.albedo;
    tex.normal = grass.normal;
    tex.height = grass.height;
    tex.macro = texlab.cached(`turf:macro:${cfg.macro}:${seed}`, () => bakeMacro(texlab, cfg.macro, seed * 17 + 11));
    tex.soil = texlab.cached(`turf:soil:${cfg.soil}:${seed}`, () => bakeSoil(texlab, cfg.soil, seed * 13 + 3));
    tex.num = texlab.cached(`turf:num:${cfg.atlas[0]}x${cfg.atlas[1]}`, () => bakeNumerals(texlab, ctx.faces || REG.faces, cfg.atlas[0], cfg.atlas[1], 4242));
    tex.word = texlab.cached(`turf:word:${team.abbr}:${cfg.word[0]}`, () => bakeWordmark(texlab, ctx.faces || REG.faces, team, cfg.word[0], cfg.word[1], 909));
    tex.crest = texlab.cached(`turf:crest:${team.abbr}:${cfg.crest}`, () => bakeCrest(texlab, ctx.faces || REG.faces, team, cfg.crest, 707));
    this._tex = tex;

    // ---- damage buffer --------------------------------------------------------
    const tgt = (shot.camera && shot.camera.target) || [0, 0, 0];
    const cx = clamp(Math.round(tgt[0] / 4) * 4, -END_X + 16, END_X - 16);
    const cz = clamp(Math.round(tgt[2] / 4) * 4, -HALF_W + 10, HALF_W - 10);
    if (this._damage) { this._damage.dispose(); this._damage = null; }
    if (cfg.damage) {
      this._damage = createDamage(cfg.damage[0], cfg.damage[1], [cx, cz, 32, 16], seed);
    }

    // ---- uniforms -------------------------------------------------------------
    const bankArr = [];
    for (let i = 0; i < Math.min(cfg.banks, MAX_BANKS); i++) {
      bankArr.push(new THREE.Vector3(BANKS[i][0], BANKS[i][1], BANKS[i][2]));
    }
    const weather = shot.weather || {};
    const wet = clamp(0.42 + 0.38 * (weather.rain !== undefined ? weather.rain : 0.25), 0.34, 0.82);
    const ez = endzoneColors(team);

    const u = {
      uTDetail: { value: tex.albedo },
      uTDetailN: { value: tex.normal },
      uTMacro: { value: tex.macro },
      uTSoil: { value: tex.soil },
      uTNum: { value: tex.num },
      uTWord: { value: tex.word },
      uTCrest: { value: tex.crest },
      uTDamage: { value: this._damage ? this._damage.texture : tex.macro },
      uDamageWin: { value: this._damage ? this._damage.window : new THREE.Vector4(0, 0, 32, 16) },
      uBanks: { value: bankArr },
      uBankColor: { value: new THREE.Color(1.0, 0.94, 0.80) },
      uSkyColor: { value: new THREE.Color(0.026, 0.030, 0.044) },
      uEZ0: { value: ez[0] },
      uEZ1: { value: ez[1] },
      uPaintTint: { value: new THREE.Color(0.72, 0.715, 0.645) },
      uWet: { value: wet },
      uPaintWear: { value: 0.30 },
      uSheen: { value: 0.52 },
      uMow: { value: 1.0 },
      uGrassGain: { value: 2.95 },
      uSoilGain: { value: 1.02 },
      uEZOn: { value: 1.0 },
    };
    this._u = u;

    // ---- mesh -----------------------------------------------------------------
    const g = new THREE.Group();
    g.name = 'turf';
    tagPiece(g, PIECE);

    const geo = new THREE.PlaneGeometry(PLANE_X, PLANE_Z, 24, 14);
    geo.rotateX(-Math.PI / 2);
    const mat = makeTurfMaterial(cfg, tex, u);
    this._mat = mat;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.name = 'turf.field';
    mesh.renderOrder = -10;   // base layer: always first, never overdrawn by itself
    g.add(mesh);
    this._mesh = mesh;

    // ---- shell grass ----------------------------------------------------------
    if (this._shells) { this._shells.dispose(); this._shells = null; }
    if (cfg.shells) {
      const sh = createShells(cfg, tex, u);
      if (sh) {
        sh.setCenter(tgt[0], tgt[2]);
        g.add(sh.mesh);
        this._shells = sh;
      }
    }

    this._group = g;

    // replay any damage that was queued before build (world.js applies it after)
    for (const p of this._pending) this._apply(p);
    this._pending.length = 0;

    return g;
  },

  /* ----------------------------------------------------------------- damage */

  _apply(p) {
    const d = this._damage;
    if (!d) return;
    if (p.k === 0) d.divot(p.a, p.b, p.c, p.d, p.e);
    else if (p.k === 1) d.cleat(p.a, p.b, p.c, p.d);
    else d.skid(p.a, p.b, p.c, p.d, p.e, p.f);
  },

  addDivot(x, z, dirX, dirZ, strength) {
    if (!this._damage) return;
    this._damage.divot(x, z, dirX || 1, dirZ || 0, strength === undefined ? 1 : strength);
  },

  addCleatMark(x, z, rotY, depth) {
    if (!this._damage) return;
    this._damage.cleat(x, z, rotY || 0, depth === undefined ? 0.7 : depth);
  },

  addSkid(x0, z0, x1, z1, w, strength) {
    if (!this._damage) return;
    this._damage.skid(x0, z0, x1, z1, w === undefined ? 0.5 : w, strength);
  },

  reset() {
    if (this._damage) this._damage.reset();
    this._pending.length = 0;
  },

  /* ----------------------------------------------------------------- update */

  update(t, ctx) {
    if (this._damage) this._damage.flush(ctx && ctx.renderer);
    void t;
  },

  /* ------------------------------------------------------------- the ladder */

  /**
   * applyRung(n) — the real ladder. Uniform-only steps are applied live and cost
   * nothing; a change of turf CLASS (the #define) rebuilds the material and is the
   * caller's job to schedule at a play boundary, per foundation quality.js.
   * Returns true if the change was expensive (class changed).
   */
  applyRung(n) {
    const next = rungConfig(n);
    const prev = this._cfg;
    if (!prev || !this._u) { this._cfg = next; return true; }
    if (next.cls === prev.cls && next.banks === prev.banks) {
      this._cfg = next;
      return false;
    }
    if (next.cls === prev.cls) {
      // bank count is a #define too, so this is still a rebuild — but a cheap one:
      // no texture bake, no geometry, just a program.
      this._cfg = next;
      if (this._ctx) this._rebuildMaterial(next);
      return false;
    }
    this._cfg = next;
    if (this._ctx) this._rebuildMaterial(next);
    return true;
  },

  _rebuildMaterial(cfg) {
    if (!this._mesh) return;
    const bankArr = [];
    for (let i = 0; i < Math.min(cfg.banks, MAX_BANKS); i++) {
      bankArr.push(new THREE.Vector3(BANKS[i][0], BANKS[i][1], BANKS[i][2]));
    }
    this._u.uBanks.value = bankArr;
    const old = this._mat;
    this._mat = makeTurfMaterial(cfg, this._tex, this._u);
    this._mesh.material = this._mat;
    if (old) old.dispose();
  },

  get rung() { return this._cfg ? this._cfg.rung : 9; },

  /* -------------------------------------------------- exports for other pieces */

  /** Flat field. Divots are shallow relief in the shader, never real displacement. */
  heightAt() { return 0; },

  /**
   * The colour the FX piece should throw when it kicks this ground up. Grass on the
   * playing surface, painted turf in the end zones, torn substrate under damage.
   */
  mudColor(x, z) {
    const ax = Math.abs(x);
    if (ax > GOAL_X && ax <= END_X && Math.abs(z) <= HALF_W && this._u) {
      const c = this._u.uEZ0.value;
      return [c.r * 0.75, c.g * 0.75, c.b * 0.75];
    }
    return [0.085, 0.062, 0.038];
  },

  grassColor() { return [0.055, 0.085, 0.028]; },

  /** Stadium-lighting may hand us the real bank rig so the sheen agrees with the sky. */
  setBanks(list) {
    if (!Array.isArray(list) || !list.length || !this._u) return;
    const n = Math.min(this._cfg ? this._cfg.banks : 6, list.length, MAX_BANKS);
    const arr = [];
    for (let i = 0; i < n; i++) arr.push(new THREE.Vector3(list[i][0], list[i][1], list[i][2]));
    while (arr.length < (this._cfg ? this._cfg.banks : 6)) arr.push(arr[arr.length - 1].clone());
    this._u.uBanks.value = arr;
  },

  setSheen(v) { if (this._u) this._u.uSheen.value = v; },
  setWet(v) { if (this._u) this._u.uWet.value = clamp(v, 0, 1); },

  /** Counted cost, for budget.mjs cross-checks and for the critic. */
  stats() {
    const t = this._tex || {};
    let bytes = 0;
    const add = (tex, mip) => {
      if (!tex || !tex.image) return;
      const w = tex.image.width || 0, h = tex.image.height || 0;
      bytes += w * h * 4 * (mip === false ? 1 : 4 / 3);
    };
    add(t.albedo); add(t.normal); add(t.height); add(t.macro); add(t.soil);
    add(t.num); add(t.word); add(t.crest);
    if (this._damage) bytes += this._damage.bytes;
    return {
      rung: this._cfg ? this._cfg.rung : -1,
      cls: this._cfg ? this._cfg.cls : -1,
      drawCalls: 1 + (this._shells ? 1 : 0),
      programs: 1 + (this._shells ? 1 : 0),
      textureMB: +(bytes / 1048576).toFixed(2),
      fullBakes: this._damage ? this._damage.fullBakes : 0,
    };
  },
};

export default impl;
