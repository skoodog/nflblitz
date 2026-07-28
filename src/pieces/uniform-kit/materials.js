// PIECE uniform-kit — the material set builder.
//
// COST MODEL, stated up front because it is the thing this piece is measured on:
//   programs      2 custom (KIT_FAMILY 0 cloth, 1 hard) for ALL 32 clubs x 5 variants
//                 x 12 slots. A variant switch writes vec3 uniforms; it compiles nothing.
//   textures      6 SHARED detail maps for the whole game + ONE decal sheet per kit that
//                 is actually on the field. 40 team/variant combinations do not cost 40
//                 texture sets, they cost 40 * 12 vec3 uniforms.
//   draw calls    ZERO of its own. Materials ride character-anatomy's geometry groups.
//   bakes         all at load, inside the piece's 600 ms slice; zero after.

import * as THREE from 'three';
import { MAT_SLOTS } from '../../foundation/contracts.js';
import { REG } from '../../foundation/registry.js';
import { kitOnBeforeCompile } from './shader.js';
import { detailMaps, bakeDecals, sharedBytes } from './tex.js';
import { kitFor, hexToRgb, shade, mixHex } from './palette.js';

export const PIECE = 'uniform-kit';

/* ------------------------------------------------------------ rung ladder */

/**
 * Texture resolution is a TIER decision taken once at load (a bake after load is
 * forbidden). Within a tier, `applyRung` walks the MAP-COUNT ladder by driving uniforms
 * to zero — bump off, detail-modulation off, grime off, clearcoat off — which is
 * allocation-free, compiles nothing, and is idempotent. That is the same ladder the
 * brief asks for, expressed in the only currency a running frame can afford.
 */
export function ladder(rung, mode) {
  if (mode === 'capture') {
    return { detail: 1024, decal: 2048, bump: 1.30, detailAmt: 1.0, grime: 1.0, clear: 1.0, aniso: 16 };
  }
  if (rung >= 12) return { detail: 1024, decal: 1024, bump: 1.20, detailAmt: 1.0, grime: 1.0, clear: 1.0, aniso: 8 };
  if (rung >= 7) return { detail: 512, decal: 512, bump: 1.00, detailAmt: 0.9, grime: 0.85, clear: 0.6, aniso: 4 };
  if (rung >= 3) return { detail: 384, decal: 384, bump: 0.55, detailAmt: 0.7, grime: 0.55, clear: 0.0, aniso: 2 };
  return { detail: 256, decal: 256, bump: 0.0, detailAmt: 0.45, grime: 0.0, clear: 0.0, aniso: 1 };
}

/* ------------------------------------------------------------------ slots */

// slot -> [family, part index, which shared detail map]
const SLOT_SPEC = {
  jersey: [0, 0, 'cloth'],
  pants: [0, 1, 'spandex'],
  sock: [0, 2, 'spandex'],
  undershirt: [0, 3, 'cloth'],
  towel: [0, 3, 'cloth'],
  glove: [0, 4, 'leather'],
  cleat: [0, 5, 'leather'],
  skin: [0, 6, 'skin'],
  helmetShell: [1, 0, 'shell'],
  facemask: [1, 1, 'shell'],
  visor: [1, 2, 'shell'],
  pad: [1, 3, 'cloth'],
};

// slot -> tiling density (repeats per metre of rest-space) and base roughness/metal
const SLOT_TUNE = {
  jersey: { tile: 13.0, rough: 0.74, metal: 0.02 },
  pants: { tile: 15.0, rough: 0.80, metal: 0.01 },
  sock: { tile: 20.0, rough: 0.72, metal: 0.0 },
  undershirt: { tile: 24.0, rough: 0.86, metal: 0.0 },
  towel: { tile: 26.0, rough: 0.97, metal: 0.0 },
  glove: { tile: 42.0, rough: 0.40, metal: 0.05 },
  cleat: { tile: 36.0, rough: 0.22, metal: 0.08 },
  skin: { tile: 34.0, rough: 0.74, metal: 0.0 },
  helmetShell: { tile: 16.0, rough: 0.085, metal: 0.55 },
  facemask: { tile: 30.0, rough: 0.42, metal: 0.30 },
  visor: { tile: 20.0, rough: 0.05, metal: 0.62 },
  pad: { tile: 18.0, rough: 0.80, metal: 0.0 },
};

const V3 = (hex) => { const c = hexToRgb(hex); return new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace); };
const toVec3 = (hex) => { const c = V3(hex); return new THREE.Vector3(c.r, c.g, c.b); };

/**
 * The five-colour block assignment per slot. Everything the shader needs to dress a slot
 * lives in five vec3s, which is why a variant is cheap.
 */
function blocksFor(slot, kit) {
  switch (slot) {
    case 'jersey': return [kit.jersey, kit.yoke, kit.panel, kit.trim, kit.piping];
    case 'pants': return [kit.pants, shade(kit.jersey, -0.15), kit.pantPanel, kit.pantStripe, kit.trim];
    case 'sock': return [kit.sock, kit.sock, kit.sock, kit.sockStripe, kit.sockTop];
    case 'undershirt': return [kit.undershirt, kit.undershirt, kit.undershirt, kit.trim, kit.trim];
    case 'towel': return [shade(kit.jersey, -0.25), shade(kit.jersey, -0.45), kit.jersey, kit.trim, kit.trim];
    case 'glove': return [kit.glove, shade(kit.glove, -0.30), kit.glove, kit.gloveGrip, kit.trim];
    case 'cleat': return [kit.cleat, shade(kit.cleat, -0.35), kit.cleat, kit.cleatTrim, kit.trim];
    case 'skin': return [kit.skinTone, kit.skinTone, kit.skinTone, kit.skinTone, kit.skinTone];
    case 'helmetShell': return [kit.helmet, kit.helmetStripe, kit.helmet, kit.helmetTrim, kit.trim];
    case 'facemask': return [kit.facemask, kit.facemask, kit.facemask, kit.trim, kit.trim];
    case 'visor': return [kit.visor, kit.visor, kit.visor, kit.visor, kit.visor];
    case 'pad': return [shade(kit.jersey, -0.18), kit.jersey, kit.jersey, kit.trim, kit.trim];
    default: return [kit.jersey, kit.jersey, kit.jersey, kit.trim, kit.trim];
  }
}

/* ---------------------------------------------------------------- caching */

const KITS = new Map();          // key -> matSet
const DECALS = new Map();        // key -> texture
let LADDER = null;
let MAPS = null;
let RUNG = 15;
const ALL = [];                  // every material built, for applyRung

/** Per-actor skin tone, seeded off the club id + jersey number so a lineup is not clones. */
const SKIN_RAMP = ['#8b6349', '#7a5540', '#9c7455', '#6b4733', '#a8805f', '#8d6a50', '#b98d68'];

export function reset() {
  KITS.clear();
}

export function stats() {
  const res = LADDER ? LADDER.detail : 512;
  const dec = LADDER ? LADDER.decal : 512;
  return {
    programs: 2,
    kits: KITS.size,
    sharedTextureBytes: Math.round(sharedBytes(res)),
    decalTextureBytes: Math.round(DECALS.size * dec * dec * 4 * 1.34),
    drawCalls: 0,
    triangles: 0,
  };
}

/* --------------------------------------------------------------- building */

function makeMaterial(slot, kit, decalTex, opts, mode) {
  const [family, part, mapName] = SLOT_SPEC[slot];
  const tune = SLOT_TUNE[slot];
  const blocks = blocksFor(slot, kit);
  const L = LADDER;

  const uniforms = {
    uKitDetail: { value: MAPS[mapName] },
    uKitDecal: { value: decalTex },
    uKitGrime: { value: MAPS.grime },
    uKitA: { value: toVec3(blocks[0]) },
    uKitB: { value: toVec3(blocks[1]) },
    uKitC: { value: toVec3(blocks[2]) },
    uKitD: { value: toVec3(blocks[3]) },
    uKitE: { value: toVec3(blocks[4]) },
    uKitF: { value: toVec3(kit.pants) },
    uKitG: { value: toVec3(kit.helmet) },
    uKitP: { value: new THREE.Vector4(part, opts.dirt * L.grime, opts.wet * (0.35 + L.grime * 0.65), kit.matte) },
    uKitQ: { value: new THREE.Vector4(tune.tile, L.bump * (slot === 'visor' ? 0 : 1), 1, 0.99) },
    uKitR: { value: new THREE.Vector4(kit.sleeveBands, tune.rough, tune.metal, L.detailAmt) },
  };

  const common = {
    color: 0xffffff,
    roughness: tune.rough,
    metalness: tune.metal,
    envMapIntensity: family === 1 ? 1.55 : 0.42,
    dithering: true,
  };

  let m;
  if (family === 1) {
    m = new THREE.MeshPhysicalMaterial(Object.assign({}, common, {
      clearcoat: slot === 'helmetShell' ? 1.0 : slot === 'visor' ? 0.9 : slot === 'facemask' ? 0.18 : 0.05,
      clearcoatRoughness: slot === 'helmetShell' ? 0.045 : slot === 'facemask' ? 0.40 : 0.06,
      reflectivity: 0.6,
      transparent: slot === 'visor',
      opacity: slot === 'visor' ? 0.72 : 1,
      side: THREE.FrontSide,
    }));
  } else {
    m = new THREE.MeshStandardMaterial(Object.assign({}, common, {
      side: slot === 'towel' ? THREE.DoubleSide : THREE.FrontSide,
    }));
  }
  m.name = `uk.${kit.id}.${slot}`;
  m.defines = { KIT_FAMILY: family, USE_KIT_BUMP: '' };
  m.userData.piece = PIECE;
  m.userData.kitUniforms = uniforms;
  m.userData.kitSlot = slot;
  m.onBeforeCompile = kitOnBeforeCompile;
  ALL.push(m);
  return m;
}

function decalFor(kit, team, number, name) {
  const key = `${kit.id}|${number}|${name}|${LADDER.decal}`;
  let t = DECALS.get(key);
  if (t) return t;
  t = bakeDecals(kit, team, number, name, LADDER.decal);
  t.anisotropy = LADDER.aniso;
  DECALS.set(key, t);
  return t;
}

/**
 * materials(ctx, teamId, variant, { number, name, dirt, wet }) -> matSet
 * The one entry point the world assembler calls. Every MAT_SLOTS key is present.
 */
export function materials(ctx, teamId, variant, o = {}) {
  const mode = ctx && ctx.mode === 'capture' ? 'capture' : 'play';
  if (!LADDER) LADDER = ladder(ctx && ctx.rung !== undefined ? ctx.rung : 15, mode);
  if (!MAPS) {
    MAPS = detailMaps(LADDER.detail);
    for (const k in MAPS) MAPS[k].anisotropy = LADDER.aniso;
  }

  const brand = REG.brand;
  const team = brand && brand.byId ? brand.byId(teamId) : null;
  if (!team) return null;

  const number = o.number !== undefined && o.number !== null ? String(o.number) : '0';
  const name = o.name || team.name;
  const dirt = Math.max(0, Math.min(1, o.dirt === undefined ? 0 : o.dirt));
  const wet = Math.max(0, Math.min(1, o.wet === undefined ? 0 : o.wet));
  // Bucket the wear parameters so two muddy players share one material set instead of
  // minting a new one per 0.01 of dirt.
  const db = Math.round(dirt * 4) / 4;
  const wb = Math.round(wet * 4) / 4;
  const key = `${team.id}|${variant}|${number}|${name}|${db}|${wb}`;
  const hit = KITS.get(key);
  if (hit) return hit;

  const kit = kitFor(team, variant);
  let h = 0;
  const s = `${team.id}${number}`;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  kit.skinTone = SKIN_RAMP[h % SKIN_RAMP.length];

  const decal = decalFor(kit, team, number, name);
  const set = {};
  for (const slot of MAT_SLOTS) set[slot] = makeMaterial(slot, kit, decal, { dirt: db, wet: wb }, mode);
  set.__kit = kit;
  set.__team = team;
  KITS.set(key, set);
  return set;
}

/** The club's signal colour — the UI screen and the stage rim lights read this. */
export function accentOf(teamId, variant) {
  const brand = REG.brand;
  const team = brand && brand.byId ? brand.byId(teamId) : null;
  if (!team) return '#ffffff';
  return kitFor(team, variant || 'home').accent;
}

/**
 * applyRung — allocation-free, compiles nothing, creates no render target, idempotent.
 * It writes four scalars into uniforms that already exist.
 */
export function applyRung(rung) {
  if (rung === RUNG) return;
  RUNG = rung;
  const L = ladder(rung, 'play');
  for (let i = 0; i < ALL.length; i++) {
    const m = ALL[i];
    const u = m.userData.kitUniforms;
    if (!u) continue;
    u.uKitQ.value.y = m.userData.kitSlot === 'visor' ? 0 : L.bump;
    u.uKitR.value.w = L.detailAmt;
    // `clearcoat` is NOT touched: dropping it to 0 would clear USE_CLEARCOAT and force a
    // recompile mid-play, which the contract forbids. The clearcoat LAYER is scaled by
    // roughening it instead — a uniform write, no program change.
    if (m.isMeshPhysicalMaterial && m.userData.kitSlot === 'helmetShell') {
      m.clearcoatRoughness = 0.045 + (1 - L.clear) * 0.42;
    }
  }
}

export default { materials, applyRung, accentOf, stats, ladder, PIECE };
