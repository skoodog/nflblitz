// PIECE stadium-lighting — every texture this piece owns, baked once at boot.
//
// Four bakes, ~1.8 MB resident at the high tier against a 10 MB budget:
//   sprite atlas   512x256   the flare core, the anamorphic streak, the iris star,
//                            two billow puffs, a rain streak, a bolt segment and a
//                            soft disc. ONE texture so every additive element in the
//                            piece is one draw call and one shader program.
//   cloud field    512x256   three-channel storm structure, tiling in azimuth.
//   beam dust      128x128   tiling two-channel noise the shafts modulate with.
//   IBL equirect   256x128   FLOAT, and that is the point: the luminaire ring is
//                            written at ~55x white so PMREM produces a real HDR
//                            environment and helmets get the hot specular pips a
//                            night stadium actually puts on them. An LDR bake gives a
//                            flat grey specular and is one of the clearest tells.
//
// Nothing here is a plain radial gradient. Every soft element is broken up with fBm,
// because a clean gradient at panel scale is the other clearest tell.

import * as THREE from 'three';
import { fbm2, worley2, canvas, toTexture, fillPixels, dataTexture, cached } from '../../foundation/texlab.js';
import { hash01 } from '../../foundation/rng.js';
import { PAL } from './config.js';

/* --------------------------------------------------------------- the atlas */

export const TILE = {
  //          col row
  flare: [0, 0],
  streak: [1, 0],
  star: [2, 0],
  puffA: [3, 0],
  puffB: [0, 1],
  rain: [1, 1],
  bolt: [2, 1],
  disc: [3, 1],
};
const COLS = 4, ROWS = 2;

/** uv rect of a tile: [u0, v0, du, dv]. Texture is baked with flipY=false. */
export function tileUV(name) {
  const t = TILE[name] || TILE.disc;
  const du = 1 / COLS, dv = 1 / ROWS;
  // inset half a texel so bilinear never bleeds a neighbouring tile in
  const pad = 0.5 / (COLS * 128);
  return [t[0] * du + pad, t[1] * dv + pad, du - pad * 2, dv - pad * 2];
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function smooth(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0 || 1));
  return t * t * (3 - 2 * t);
}

/** Draw one 128x128 tile through a per-pixel callback returning [r,g,b,a] linear. */
function bakeTile(img, W, col, row, fn) {
  const S = 128;
  const ox = col * S, oy = row * S;
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const u = (i + 0.5) / S, v = (j + 0.5) / S;
      const c = fn(u, v, (u - 0.5) * 2, (v - 0.5) * 2);
      const k = ((oy + j) * W + (ox + i)) * 4;
      img[k] = clamp01(c[0]) * 255;
      img[k + 1] = clamp01(c[1]) * 255;
      img[k + 2] = clamp01(c[2]) * 255;
      img[k + 3] = clamp01(c[3]) * 255;
    }
  }
}

export function spriteAtlas() {
  return cached('sl:atlas', () => {
    const W = 512, H = 256;
    const cv = canvas(W, H);
    const id = cv.ctx.createImageData(W, H);
    const img = id.data;

    const CORE = PAL.lightCore, HALO = PAL.lightHalo, STK = PAL.streak;

    /* ---- flare: blown core, sodium halo, faint 14-spoke iris diffraction ---- */
    bakeTile(img, W, TILE.flare[0], TILE.flare[1], (u, v, x, y) => {
      const r = Math.hypot(x, y);
      const th = Math.atan2(y, x);
      const core = Math.exp(-(r / 0.055) * (r / 0.055)) * 1.0;
      const inner = Math.exp(-Math.pow(r / 0.185, 1.7)) * 0.62;
      const halo = 0.34 / Math.pow(1 + (r / 0.30) * (r / 0.30), 1.55);
      const spoke = 0.13 * Math.pow(Math.abs(Math.cos(th * 7)), 6) * Math.exp(-(r / 0.62) * (r / 0.62));
      const grain = 0.90 + 0.20 * fbm2(u * 26, v * 26, { octaves: 3, seed: 11 });
      let a = (core + inner + halo * grain + spoke) * smooth(1.02, 0.72, r);
      a = clamp01(a);
      const k = smooth(0.02, 0.30, r);
      return [
        CORE[0] + (HALO[0] - CORE[0]) * k,
        CORE[1] + (HALO[1] - CORE[1]) * k,
        CORE[2] + (HALO[2] - CORE[2]) * k,
        a,
      ];
    });

    /* ---- anamorphic streak: the horizontal cool flare bar ---- */
    bakeTile(img, W, TILE.streak[0], TILE.streak[1], (u, v, x, y) => {
      const tight = Math.exp(-(y / 0.030) * (y / 0.030));
      const soft = Math.exp(-(y / 0.115) * (y / 0.115)) * 0.34;
      const along = Math.exp(-Math.pow(Math.abs(x) / 0.80, 1.5));
      const wob = 0.82 + 0.36 * fbm2(u * 17, 3.7, { octaves: 3, seed: 47 });
      const a = clamp01((tight + soft) * along * wob);
      const k = smooth(0.0, 0.7, Math.abs(x));
      return [
        1.0 + (STK[0] - 1.0) * k,
        0.985 + (STK[1] - 0.985) * k,
        0.95 + (STK[2] - 0.95) * k,
        a,
      ];
    });

    /* ---- iris star + hex ghost ---- */
    bakeTile(img, W, TILE.star[0], TILE.star[1], (u, v, x, y) => {
      const r = Math.hypot(x, y);
      const th = Math.atan2(y, x);
      const spokes = Math.pow(Math.abs(Math.cos(th * 3 + 0.4)), 34) * Math.exp(-r * 2.1) * 0.95;
      const spokes2 = Math.pow(Math.abs(Math.cos(th * 3 - 1.15)), 60) * Math.exp(-r * 3.0) * 0.45;
      const ghost = Math.exp(-Math.pow(Math.abs(r - 0.55) / 0.075, 2)) * 0.10
        * (0.6 + 0.4 * Math.cos(th * 6));
      const a = clamp01((spokes + spokes2 + ghost) * smooth(1.02, 0.80, r));
      return [1.0, 0.92, 0.80, a];
    });

    /* ---- two billow puffs: haze cards. fBm-torn, never a clean disc ---- */
    const puff = (seed) => (u, v, x, y) => {
      const r = Math.hypot(x, y * 1.35);
      const warp = fbm2(u * 2.4 + seed, v * 2.4, { octaves: 3, seed: seed * 7 + 3 }) * 0.34;
      const body = smooth(1.0, 0.05, r + warp);
      const billow = 0.42 + 0.72 * (0.5 + 0.5 * fbm2(u * 5.2 + seed * 3, v * 5.2, { octaves: 4, seed: seed * 13 + 5 }));
      const fine = 0.72 + 0.42 * (0.5 + 0.5 * fbm2(u * 15.0, v * 15.0, { octaves: 3, seed: seed * 29 + 9 }));
      const a = clamp01(body * billow * fine * 0.95);
      // warm at the core (nearer the source), cool at the fringe
      const k = smooth(0.05, 0.85, r);
      return [
        PAL.hazeWarm[0] + (PAL.hazeCool[0] - PAL.hazeWarm[0]) * k,
        PAL.hazeWarm[1] + (PAL.hazeCool[1] - PAL.hazeWarm[1]) * k,
        PAL.hazeWarm[2] + (PAL.hazeCool[2] - PAL.hazeWarm[2]) * k,
        a,
      ];
    };
    bakeTile(img, W, TILE.puffA[0], TILE.puffA[1], puff(1));
    bakeTile(img, W, TILE.puffB[0], TILE.puffB[1], puff(2));

    /* ---- rain streak ---- */
    bakeTile(img, W, TILE.rain[0], TILE.rain[1], (u, v, x, y) => {
      const core = Math.exp(-(x / 0.055) * (x / 0.055));
      const soft = Math.exp(-(x / 0.20) * (x / 0.20)) * 0.22;
      const taper = smooth(-1.0, -0.55, y) * smooth(1.0, 0.35, y);
      const a = clamp01((core + soft) * taper * (0.75 + 0.5 * hash01((u * 128) | 0, 7, 3)));
      return [PAL.rain[0], PAL.rain[1], PAL.rain[2], a];
    });

    /* ---- bolt segment: white-hot core in a violet corona ---- */
    bakeTile(img, W, TILE.bolt[0], TILE.bolt[1], (u, v, x, y) => {
      const core = Math.exp(-(x / 0.045) * (x / 0.045));
      const mid = Math.exp(-(x / 0.14) * (x / 0.14)) * 0.55;
      const corona = Math.exp(-(x / 0.44) * (x / 0.44)) * 0.20;
      const jag = 0.86 + 0.28 * fbm2(3.1, v * 22, { octaves: 3, seed: 71 });
      const a = clamp01((core + mid + corona) * jag);
      const k = smooth(0.03, 0.34, Math.abs(x));
      return [
        PAL.boltCore[0] + (PAL.boltHalo[0] - PAL.boltCore[0]) * k,
        PAL.boltCore[1] + (PAL.boltHalo[1] - PAL.boltCore[1]) * k,
        PAL.boltCore[2] + (PAL.boltHalo[2] - PAL.boltCore[2]) * k,
        a,
      ];
    });

    /* ---- soft disc: general spill, and the lightning veil ---- */
    bakeTile(img, W, TILE.disc[0], TILE.disc[1], (u, v, x, y) => {
      const r = Math.hypot(x, y);
      const body = Math.exp(-Math.pow(r / 0.62, 2.0));
      const mott = 0.70 + 0.60 * (0.5 + 0.5 * fbm2(u * 3.4, v * 3.4, { octaves: 4, seed: 97 }));
      const a = clamp01(body * mott * smooth(1.02, 0.62, r));
      return [1.0, 0.95, 0.90, a];
    });

    cv.ctx.putImageData(id, 0, 0);
    const tex = toTexture(cv, {
      srgb: false,                  // additive light data is LINEAR, not sRGB
      wrap: THREE.ClampToEdgeWrapping,
      mipmaps: false,
      aniso: 1,
      flipY: false,
    });
    tex.name = 'sl.atlas';
    return tex;
  });
}

/* ---------------------------------------------------------- the cloud field */

/**
 * Storm structure, tiling in azimuth (x) and clamped in elevation (y).
 *   R  base mass          low frequency, big cumulonimbus shapes
 *   G  detail             mid frequency, the torn edges
 *   B  updraft/top mask   where the cloud faces up (catches the cool sky)
 *   A  base-lit mask      where the cloud faces down (catches the sodium bounce)
 */
export function cloudField() {
  return cached('sl:cloud', () => {
    const W = 512, H = 256;
    const cv = canvas(W, H);
    fillPixels(cv, (x, y, u, v) => {
      const ax = u * 8.0;            // 8 tiles around the azimuth
      const ay = v * 3.4;
      // domain warp — straight fBm reads as a texture, warped fBm reads as weather
      const wx = fbm2(ax * 0.7, ay * 0.7, { octaves: 3, seed: 5 }) * 0.85;
      const wy = fbm2(ax * 0.7 + 4.3, ay * 0.7 + 1.7, { octaves: 3, seed: 6 }) * 0.85;
      const base = 0.5 + 0.5 * fbm2(ax + wx, ay + wy, { octaves: 5, seed: 21 });
      const det = 0.5 + 0.5 * fbm2(ax * 3.1 + wx * 2, ay * 3.1 + wy * 2, { octaves: 4, seed: 33 });
      const cell = worley2(ax * 1.6, ay * 1.6, 44);
      const puff = clamp01((cell.f2 - cell.f1) * 1.15);
      const mass = clamp01(base * 0.78 + puff * 0.34);
      // vertical gradient of the mass -> which way a cloud face is turned
      const above = 0.5 + 0.5 * fbm2(ax + wx, ay + wy - 0.16, { octaves: 5, seed: 21 });
      const grad = clamp01(0.5 + (mass - above * 0.78 - puff * 0.34) * 3.2);
      return [mass, det, grad, clamp01(1 - grad)];
    });
    const tex = toTexture(cv, { srgb: false, mipmaps: true, aniso: 4, flipY: false });
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.name = 'sl.cloud';
    return tex;
  });
}

/* -------------------------------------------------------------- beam dust */

/** Tiling dust the shafts modulate with: R slow, G fast. */
export function beamDust() {
  return cached('sl:dust', () => {
    const W = 128, H = 128;
    const cv = canvas(W, H);
    fillPixels(cv, (x, y, u, v) => {
      const a = 0.5 + 0.5 * fbm2(u * 4, v * 4, { octaves: 4, seed: 101 });
      const b = 0.5 + 0.5 * fbm2(u * 11 + 3, v * 11 - 2, { octaves: 3, seed: 137 });
      const c = 0.5 + 0.5 * fbm2(u * 2.1, v * 2.1 + 8, { octaves: 3, seed: 163 });
      return [a, b, c, 1];
    });
    const tex = toTexture(cv, { srgb: false, mipmaps: true, aniso: 2, flipY: false });
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.name = 'sl.dust';
    return tex;
  });
}

/* ------------------------------------------------------------- the IBL bake */

/**
 * A FLOAT equirectangular radiance map of this exact stadium: the luminaire ring at
 * ~55x white, the crowd/structure band glowing warm beneath it, the field bouncing
 * dim green, and a purple-black storm sky above. PMREM turns it into the specular
 * environment, which is why a helmet gets a ring of hot pips rather than a flat sheen.
 */
export function envEquirect(towers, seed) {
  const W = 256, H = 128;
  // Precompute each bank's direction as seen from a player's head at midfield.
  const dirs = towers.map((t) => {
    const dx = t.x, dy = t.y - 1.6, dz = t.z;
    const h = Math.hypot(dx, dz) || 1;
    return {
      az: Math.atan2(dz, dx),
      el: Math.atan2(dy, h),
      p: t.power,
    };
  });
  return dataTexture((x, y, u, v) => {
    const az = (u - 0.5) * Math.PI * 2;    // matches three's equirect sampling
    const el = (v - 0.5) * Math.PI;
    const cel = Math.cos(el);

    let r = 0, g = 0, b = 0;

    // LEVELS MATTER MORE HERE THAN ANYWHERE. scene.environment feeds BOTH the specular
    // AND the diffuse irradiance of every standard material in the game. The first
    // pass wrote the luminaire ring at 55x over a 0.0019 sr lobe, thirty times — about
    // 1.5 of integrated irradiance, comparable to the key light itself — and the
    // result was a flat, evenly-lit frame. The ring is still HDR (that is the whole
    // point: an LDR bake gives a dull flat specular), it is just no longer an ambient
    // light source in disguise.

    // --- sky above the roof: purple-black with cloud mottle -----------------
    const up = clamp01((el - 0.26) / 0.55);
    const cl = 0.5 + 0.5 * fbm2(az * 1.9 + 3, el * 3.2, { octaves: 4, seed: seed + 3 });
    r += up * (0.0034 + 0.0042 * cl);
    g += up * (0.0030 + 0.0034 * cl);
    b += up * (0.0072 + 0.0064 * cl);

    // --- the bowl: warm crowd + structure, brightest just under the rig -----
    const band = Math.exp(-Math.pow((el - 0.085) / 0.135, 2));
    const speck = 0.72 + 0.56 * (0.5 + 0.5 * fbm2(az * 26, el * 26, { octaves: 2, seed: seed + 17 }));
    r += band * 0.0270 * speck;
    g += band * 0.0186 * speck;
    b += band * 0.0118 * speck;

    // --- the field below: dim, green, warmest toward the centre ------------
    const dn = clamp01((-el - 0.03) / 0.45);
    r += dn * 0.0062;
    g += dn * 0.0082;
    b += dn * 0.0052;

    // --- THE LUMINAIRES. HDR. This is what makes the specular read. --------
    for (let i = 0; i < dirs.length; i++) {
      const d = dirs[i];
      let da = az - d.az;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      const de = el - d.el;
      const s = (da * cel) / 0.0195, t = de / 0.0130;
      const core = Math.exp(-(s * s + t * t)) * 26.0 * d.p;
      const sg = (da * cel) / 0.090, tg = de / 0.042;
      const glow = Math.exp(-(sg * sg + tg * tg)) * 0.90 * d.p;
      r += (core + glow);
      g += (core * 0.965 + glow * 0.885);
      b += (core * 0.885 + glow * 0.680);
    }
    return [r, g, b, 1];
    // NEAREST on purpose: linear filtering of a FLOAT texture needs
    // OES_texture_float_linear, which is not guaranteed under SwiftShader. PMREM
    // convolves this into the roughness chain anyway, so the filter never shows.
  }, W, H, { float: true, wrap: THREE.RepeatWrapping, nearest: true });
}

export default { spriteAtlas, cloudField, beamDust, envEquirect, tileUV, TILE };
