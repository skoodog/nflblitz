// PIECE uniform-kit — procedural texture bakery.
//
// TWO CLASSES OF TEXTURE, and the split is what keeps this piece inside its budget:
//
//   SHARED DETAIL MAPS  colourless, baked ONCE for the whole game and reused by all 32
//                       clubs and all 5 variants. Knit weave, spandex twill, leather
//                       grain, helmet orange-peel + flake, skin pores, grime. Colour is
//                       applied in the shader from uniforms, so a club costs 0 bytes here.
//   PER-KIT DECAL ATLAS one small RGBA sheet per (club, variant, number) carrying the
//                       tackle-twill numbers, the nameplate, the sleeve crest, the helmet
//                       decal, the collar shield and the hip mark. Baked lazily, cached.
//
// That is why "8 teams x 5 variants" is not 40 texture sets: it is 5 shared maps plus one
// ~1 MB sheet per kit actually on the field.
//
// Everything is a pure function of its inputs — no Math.random, no wall clock.

import * as THREE from 'three';
import texlab from '../../foundation/texlab.js';
import { makeRng } from '../../foundation/rng.js';
import { REG } from '../../foundation/registry.js';
import { hexToRgb, rgba, mixHex, shade, luma } from './palette.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sat = (v) => clamp(v, 0, 1);
const TAU = Math.PI * 2;

/* =============================================================== SHARED MAPS */

/**
 * Knit jersey weave. Real game jerseys are a warp-knit with a visible rib running
 * vertically and a fine horizontal course; the shoulders and side panels are a coarser
 * perforated mesh. Encoded:
 *   r = albedo modulation (light on the rib crown, dark in the valley)
 *   g = height, for the derivative bump
 *   b = roughness modulation (thread crowns catch light, valleys are matte)
 *   a = mesh-hole mask (used only on the panel regions)
 */
function bakeCloth(N) {
  const cv = texlab.canvas(N, N);
  const rng = makeRng(0x51ee);
  const jitter = new Float32Array(64);
  for (let i = 0; i < 64; i++) jitter[i] = rng() - 0.5;
  const RIB = 74;                 // ribs across the tile
  const COURSE = 128;             // knit courses down the tile
  texlab.fillPixels(cv, (x, y, u, v) => {
    // warp rib: a rounded ridge with a seeded per-rib width wobble
    const ri = Math.floor(u * RIB);
    const rf = u * RIB - ri;
    const wob = jitter[(ri * 7) & 63] * 0.16;
    const rib = Math.cos((rf - 0.5 + wob) * Math.PI) ** 2;     // 0..1 crown
    // knit course: the loop rows, offset every other rib (interlock)
    const off = (ri & 1) * 0.5;
    const cf = (v * COURSE + off) % 1;
    const course = 0.5 + 0.5 * Math.cos((cf - 0.5) * TAU);
    // interlock loop: the crown is highest where rib and course crowns meet
    const loop = rib * 0.72 + course * 0.28;
    // micro fuzz + thread irregularity
    const fuzz = texlab.fbm2(x * 0.62, y * 0.62, { octaves: 3, seed: 11 });
    const slub = texlab.fbm2(x * 0.035, y * 0.09, { octaves: 2, seed: 23 });
    const h = sat(loop * 0.80 + fuzz * 0.16 + slub * 0.10);
    const alb = sat(0.62 + (h - 0.5) * 0.52 + fuzz * 0.10);
    const rgh = sat(0.55 - (h - 0.5) * 0.42 + slub * 0.14);
    // perforated mesh: a hex-ish dot grid, only meaningful where the shader asks
    const mx = (u * 46) % 1 - 0.5;
    const my = (v * 46 + ((Math.floor(u * 46) & 1) * 0.5)) % 1 - 0.5;
    const hole = 1 - sat((Math.hypot(mx, my) - 0.20) * 9);
    return [alb, h, rgh, sat(hole)];
  });
  return cv;
}

/** Spandex / stretch twill for pants and socks: a fine diagonal with a satin sheen. */
function bakeSpandex(N) {
  const cv = texlab.canvas(N, N);
  texlab.fillPixels(cv, (x, y, u, v) => {
    const d = (u * 150 + v * 150) % 1;
    const twill = 0.5 + 0.5 * Math.cos((d - 0.5) * TAU);
    const fine = texlab.fbm2(x * 0.9, y * 0.9, { octaves: 2, seed: 5 });
    const h = sat(twill * 0.55 + fine * 0.45);
    return [sat(0.66 + (h - 0.5) * 0.30), h, sat(0.40 - (h - 0.5) * 0.30 + fine * 0.12), 0];
  });
  return cv;
}

/** Helmet shell: orange-peel clearcoat ripple + metallic flake speckle + micro scuffs. */
function bakeShell(N) {
  const cv = texlab.canvas(N, N);
  const rng = makeRng(0x9a11);
  const fl = new Float32Array(N * N);
  for (let i = 0; i < N * N * 0.09; i++) {
    const p = Math.floor(rng() * N * N);
    fl[p] = 0.55 + rng() * 0.45;
  }
  texlab.fillPixels(cv, (x, y, u, v) => {
    const peel = texlab.fbm2(x * 0.11, y * 0.11, { octaves: 3, seed: 41 });
    const micro = texlab.fbm2(x * 1.7, y * 1.7, { octaves: 2, seed: 67 });
    const flake = fl[y * N + x];
    const scuff = Math.max(0, texlab.ridged2(x * 0.045, y * 0.19, { octaves: 2, seed: 3 }) - 0.72) * 3.4;
    const h = sat(0.5 + (peel - 0.5) * 0.55 + micro * 0.10);
    return [sat(0.55 + flake * 0.45), h, sat(0.10 + micro * 0.16 + scuff * 0.5), sat(scuff)];
  });
  return cv;
}

/** Pebbled leather + silicone grip for gloves and cleat uppers. */
function bakeLeather(N) {
  const cv = texlab.canvas(N, N);
  texlab.fillPixels(cv, (x, y, u, v) => {
    const w = texlab.worley2(x * 0.10, y * 0.10, 19);
    const w2 = texlab.worley2(x * 0.30, y * 0.30, 71);
    const pebble = sat(1 - w * 2.4);
    const grain = texlab.fbm2(x * 0.8, y * 0.8, { octaves: 3, seed: 13 });
    const h = sat(pebble * 0.6 + (1 - w2) * 0.22 + grain * 0.22);
    return [sat(0.55 + (h - 0.5) * 0.6), h, sat(0.62 - h * 0.42 + grain * 0.1), sat(pebble)];
  });
  return cv;
}

/** Skin: pores, a little vein noise, and a sweat-bead mask in alpha. */
function bakeSkin(N) {
  const cv = texlab.canvas(N, N);
  texlab.fillPixels(cv, (x, y, u, v) => {
    const pore = texlab.worley2(x * 0.55, y * 0.55, 29);
    const fine = texlab.fbm2(x * 1.3, y * 1.3, { octaves: 3, seed: 91 });
    const vein = texlab.fbm2(x * 0.06, y * 0.06, { octaves: 2, seed: 37 });
    const bead = sat(1 - texlab.worley2(x * 0.22, y * 0.22, 5) * 3.2);
    const h = sat(0.5 + (pore - 0.5) * 0.30 + fine * 0.22);
    return [sat(0.60 + (vein - 0.5) * 0.10 + fine * 0.14), h, sat(0.62 - fine * 0.22), bead];
  });
  return cv;
}

/**
 * Grime. r = mud splatter, g = grass smear, b = sweat wetness, a = general soil.
 * Sampled triplanar and driven by the `dirt` / `wet` parameters so a late-game player
 * gets progressively wrecked without a second texture set.
 */
function bakeGrime(N) {
  const cv = texlab.canvas(N, N);
  const rng = makeRng(0x0dee);
  const blobs = [];
  for (let i = 0; i < 220; i++) {
    blobs.push([rng(), rng(), 0.006 + rng() * rng() * 0.055, rng()]);
  }
  texlab.fillPixels(cv, (x, y, u, v) => {
    let mud = 0;
    for (let i = 0; i < blobs.length; i++) {
      const b = blobs[i];
      let dx = u - b[0], dy = v - b[1];
      if (dx > 0.5) dx -= 1; if (dx < -0.5) dx += 1;
      if (dy > 0.5) dy -= 1; if (dy < -0.5) dy += 1;
      const d = Math.hypot(dx, dy) / b[2];
      if (d < 1.6) mud = Math.max(mud, (1 - sat(d)) * (0.45 + b[3] * 0.55));
    }
    const grass = Math.max(0, texlab.ridged2(x * 0.03, y * 0.10, { octaves: 3, seed: 77 }) - 0.55) * 2.2;
    const soil = texlab.fbm2(x * 0.018, y * 0.018, { octaves: 4, seed: 55 });
    const sweat = sat(texlab.fbm2(x * 0.05, y * 0.11, { octaves: 3, seed: 101 }) * 1.6 - 0.35);
    return [sat(mud), sat(grass), sweat, sat(soil)];
  });
  return cv;
}

const SHARED = new Map();
function sharedTex(name, res, bake, srgb) {
  const key = `${name}:${res}`;
  let t = SHARED.get(key);
  if (t) return t;
  t = texlab.toTexture(bake(res), { srgb: !!srgb, wrap: THREE.RepeatWrapping, aniso: 8 });
  t.name = `uk.${key}`;
  SHARED.set(key, t);
  return t;
}

export function detailMaps(res) {
  return {
    cloth: sharedTex('cloth', res, bakeCloth, false),
    spandex: sharedTex('spandex', res, bakeSpandex, false),
    shell: sharedTex('shell', res, bakeShell, false),
    leather: sharedTex('leather', res, bakeLeather, false),
    skin: sharedTex('skin', res, bakeSkin, false),
    grime: sharedTex('grime', Math.max(256, res >> 1), bakeGrime, false),
  };
}

/** Bytes resident for the shared set — reported to budget.mjs by index.js. */
export function sharedBytes(res) {
  const g = Math.max(256, res >> 1);
  return (res * res * 5 + g * g) * 4 * 1.34;    // 5 maps + grime, RGBA, +mips
}

/* ========================================================== PER-KIT DECALS */

/**
 * Atlas layout — a 4x4 cell grid, cells are 0.25 x 0.25 in UV, v measured from the TOP
 * of the canvas (the texture is uploaded with flipY = false so canvas space and UV space
 * agree, which is what makes the shader's decal maths readable).
 */
export const CELL = {
  frontNum: [0.00, 0.00, 0.50, 0.50],
  backNum: [0.50, 0.00, 0.50, 0.50],
  sleeve: [0.00, 0.50, 0.25, 0.25],
  helmet: [0.25, 0.50, 0.25, 0.25],
  hip: [0.50, 0.50, 0.25, 0.25],
  collar: [0.75, 0.50, 0.25, 0.25],
  chestMark: [0.00, 0.75, 0.25, 0.25],
  pantLogo: [0.25, 0.75, 0.25, 0.25],
};

function faces() { return REG.faces; }

/**
 * Tackle twill. A real number is a stack of two die-cut cloth layers stitched onto the
 * jersey: an outline layer, then a fill layer inset from it, with a zig-zag stitch line
 * a couple of millimetres inside each edge and a hard shadow where the twill lifts off
 * the knit. That stack — not a coloured glyph — is what makes it read as sewn cloth.
 */
function drawTwill(c, text, cx, cy, size, kit, opts = {}) {
  const F = faces();
  const face = opts.face || 'blitz-num';
  const tr = opts.tracking !== undefined ? opts.tracking : 0.02;
  const m = F.measure(text, face, size, { tracking: tr });
  const x = cx, y = cy + m.cap * 0.5;
  // Real tackle twill is a stack of DIE-CUT LAYERS, and each layer only shows a few
  // millimetres of itself past the one on top: on a 20 cm number the outline reads about
  // 8 mm, i.e. ~4% of the glyph height. Stroke widths are centred on the path, so a
  // strokeWidth of 0.09*size shows 0.045*size of outline. Any fatter and a two-digit
  // number fuses into one blob — which is exactly what happened at 0.17.
  const outW = size * (opts.outline !== undefined ? opts.outline : 0.045);

  // lift shadow (the twill is a few mm proud of the knit)
  c.save();
  c.globalAlpha = 0.6;
  F.draw(c, text, x + size * 0.016, y + size * 0.026, {
    face, size, align: 'center', tracking: tr,
    fill: kit.numShadow, stroke: kit.numShadow, strokeWidth: outW * 2.6,
  });
  c.restore();

  // outline layer
  F.draw(c, text, x, y, {
    face, size, align: 'center', tracking: tr,
    fill: kit.numOut, stroke: kit.numOut, strokeWidth: outW * 2.0,
  });
  // a second, thinner keyline in the trim colour — the three-layer twill every
  // modern NFL jersey uses
  if (opts.triple !== false) {
    F.draw(c, text, x, y, {
      face, size, align: 'center', tracking: tr,
      fill: kit.trim, stroke: kit.trim, strokeWidth: outW * 0.85,
    });
  }
  // fill layer, vertically graded so the cloth has a light direction
  F.draw(c, text, x, y, {
    face, size, align: 'center', tracking: tr,
    gradient: [
      [0, shade(kit.numFill, 0.18)],
      [0.42, kit.numFill],
      [1, shade(kit.numFill, -0.22)],
    ],
  });

  // zig-zag stitch just inside the fill edge
  c.save();
  c.globalAlpha = 0.42;
  c.setLineDash([size * 0.028, size * 0.026]);
  c.lineWidth = Math.max(1, size * 0.012);
  F.draw(c, text, x, y, {
    face, size, align: 'center', tracking: tr,
    fill: 'rgba(0,0,0,0)', stroke: shade(kit.numFill, -0.42), strokeWidth: size * 0.012,
  });
  c.setLineDash([]);
  c.restore();
  return m;
}

function cellCtx(cv, cell, N) {
  const c = cv.ctx;
  c.save();
  c.beginPath();
  c.rect(cell[0] * N, cell[1] * N, cell[2] * N, cell[3] * N);
  c.clip();
  c.translate(cell[0] * N, cell[1] * N);
  return { c, w: cell[2] * N, h: cell[3] * N };
}

/** Soft roughened edge so a decal never terminates on a mathematically clean line. */
function distress(c, w, h, seed, amount) {
  if (amount <= 0) return;
  const rng = makeRng(seed);
  c.save();
  c.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 260 * amount; i++) {
    const x = rng() * w, y = rng() * h, r = 0.6 + rng() * 2.6;
    c.globalAlpha = 0.05 + rng() * 0.16;
    c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
  }
  c.restore();
}

/**
 * bakeDecals(kit, team, number, name, res) -> { cv, tex }
 * One RGBA sheet per kit. Alpha is coverage; the shader composites it over the
 * blocked base colour, so the sheet carries no lighting.
 */
export function bakeDecals(kit, team, number, name, res) {
  const N = res;
  const cv = texlab.canvas(N, N);
  const C = cv.ctx;
  C.clearRect(0, 0, N, N);
  const F = faces();
  const num = String(number === undefined || number === null ? '00' : number);
  const nm = String(name || team.name || '').toUpperCase().slice(0, 12);

  /* ---- front number ------------------------------------------------------ */
  {
    const { c, w, h } = cellCtx(cv, CELL.frontNum, N);
    // Leave room inside the cell for the outline stack: at 0.045 outline the widest
    // layer pushes ~6% of the glyph height past the letterform on every side, and
    // kitCell() clamps at the cell edge, so a number sized to the full cell would have
    // its outline sliced off flat.
    const size = h * (num.length > 1 ? 0.78 : 0.84);
    drawTwill(c, num, w * 0.5, h * 0.50, size, kit, { tracking: num.length > 1 ? 0.075 : 0 });
    distress(c, w, h, 771, kit.matte ? 0.9 : 0.35);
    c.restore();
  }
  /* ---- back: nameplate above, number below ------------------------------- */
  {
    const { c, w, h } = cellCtx(cv, CELL.backNum, N);
    if (kit.nameplate && nm) {
      const s = h * 0.135;
      const m = F.measure(nm, 'blitz-block', s, { tracking: 0.03 });
      // curved nameplate: letters set on a shallow arc, as they are on a real jersey
      const R = w * 1.85;
      const total = m.w / R;
      let a = -total * 0.5;
      c.save();
      c.translate(w * 0.5, h * 0.155 + R);
      for (let i = 0; i < nm.length; i++) {
        const ch = nm[i];
        const cw = F.measure(ch, 'blitz-block', s, { tracking: 0.03 }).w;
        const da = cw / R;
        c.save();
        c.rotate(a + da * 0.5);
        c.translate(0, -R);
        F.draw(c, ch, 0, 0, {
          face: 'blitz-block', size: s, align: 'center',
          fill: kit.numOut, stroke: kit.numShadow, strokeWidth: s * 0.10,
        });
        c.restore();
        a += da;
      }
      c.restore();
    }
    const size = h * 0.56;
    drawTwill(c, num, w * 0.5, h * 0.63, size, kit, { tracking: num.length > 1 ? 0.075 : 0 });
    distress(c, w, h, 991, kit.matte ? 0.9 : 0.35);
    c.restore();
  }
  /* ---- sleeve crest ------------------------------------------------------ */
  {
    const { c, w, h } = cellCtx(cv, CELL.sleeve, N);
    drawCrestDecal(c, w, h, team, kit, 0.86);
    c.restore();
  }
  /* ---- helmet decal ------------------------------------------------------ */
  {
    const { c, w, h } = cellCtx(cv, CELL.helmet, N);
    drawCrestDecal(c, w, h, team, kit, 1.0);
    c.restore();
  }
  /* ---- hip / pant mark --------------------------------------------------- */
  {
    const { c, w, h } = cellCtx(cv, CELL.hip, N);
    const s = h * 0.30;
    F.draw(c, team.abbr, w * 0.5, h * 0.58, {
      face: 'blitz-block', size: s, align: 'center', tracking: 0.05,
      fill: kit.trim, stroke: kit.numShadow, strokeWidth: s * 0.09,
    });
    c.restore();
  }
  /* ---- collar league mark ------------------------------------------------ */
  {
    const { c, w, h } = cellCtx(cv, CELL.collar, N);
    try {
      const brand = REG.brand;
      if (brand && brand.leagueMark) {
        c.save();
        c.globalAlpha = 0.95;
        brand.leagueMark(c, { x: w * 0.18, y: h * 0.22, w: w * 0.64, h: h * 0.56 }, { flat: true });
        c.restore();
      }
    } catch (e) { /* the mark is decoration; never fail a bake for it */ }
    c.restore();
  }
  /* ---- chest mark (small club wordmark above the number) ----------------- */
  {
    const { c, w, h } = cellCtx(cv, CELL.chestMark, N);
    const s = h * 0.24;
    F.draw(c, team.abbr, w * 0.5, h * 0.6, {
      face: 'blitz-block', size: s, align: 'center', tracking: 0.08,
      fill: kit.trim, stroke: kit.numShadow, strokeWidth: s * 0.08,
    });
    c.restore();
  }
  /* ---- pant thigh logo --------------------------------------------------- */
  {
    const { c, w, h } = cellCtx(cv, CELL.pantLogo, N);
    drawCrestDecal(c, w, h, team, kit, 0.7);
    c.restore();
  }

  const tex = texlab.toTexture(cv, {
    srgb: true, wrap: THREE.ClampToEdgeWrapping, aniso: 8, flipY: false,
  });
  tex.name = `uk.decal.${kit.id}`;
  return tex;
}

/**
 * The club's own illustrated mascot, taken from brand-identity's crest generator and
 * re-treated for cloth/vinyl: no card, no shard burst, a dark keyline and a slight
 * gradient so it reads as an applied decal rather than a pasted PNG.
 */
function drawCrestDecal(c, w, h, team, kit, scale) {
  let img = null;
  try {
    const brand = REG.brand;
    if (brand && brand.crest) img = brand.crest(team.id, Math.round(Math.min(w, h)), { backdrop: false, flat: true });
  } catch (e) { img = null; }
  const s = Math.min(w, h) * scale;
  if (img) {
    c.save();
    // dark keyline: the crest drawn slightly larger in a near-black, then the crest on top
    c.globalAlpha = 0.85;
    c.filter = 'none';
    c.drawImage(img, w * 0.5 - s * 0.52, h * 0.5 - s * 0.52, s * 1.04, s * 1.04);
    c.globalCompositeOperation = 'source-atop';
    c.fillStyle = kit.numShadow;
    c.fillRect(0, 0, w, h);
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.drawImage(img, w * 0.5 - s * 0.5, h * 0.5 - s * 0.5, s, s);
    c.restore();
  } else {
    const F = faces();
    F.draw(c, team.abbr, w * 0.5, h * 0.6, {
      face: 'blitz-block', size: h * 0.34, align: 'center',
      fill: kit.trim, stroke: kit.numShadow, strokeWidth: h * 0.03,
    });
  }
}

export default { detailMaps, bakeDecals, sharedBytes, CELL };
