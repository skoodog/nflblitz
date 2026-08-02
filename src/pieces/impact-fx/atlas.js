// PIECE impact-fx — the sprite atlas. ONE 512x512 RGBA texture, 4x4 cells of 128 px,
// baked once at load from noise. There are no binary assets in this project.
//
// WHY ONE ATLAS AND NOT SIXTEEN TEXTURES. Every quad this piece draws carries a cell
// index and the vertex shader turns it into a UV rect, so sparks, clods, smoke, rings
// and the flash all come out of one bind. The whole piece is 2 textures (this + the
// ball's leather) and 2 programs.
//
// WHY EACH CELL IS INSET BY 12 px. Mipmaps are on — particles are small on screen and
// without them the sparks crawl badly under the 32-sample accumulation. But a mip
// reduction averages ACROSS cell boundaries, and at 4 px of inset every spark grew a
// faint square halo the size of its atlas cell once it got small enough to hit mip 3.
// 12 px of transparent margin at 128 px cells survives to mip 4 (8x8 per cell), which is
// smaller than any sprite ever gets on screen at 1920x1080.
//
// EVERYTHING HERE IS A PURE FUNCTION OF ITS PIXEL COORDINATE AND A CONSTANT SEED.
// No RNG stream is drawn from, so a cell looks the same whatever order cells are baked
// in — which matters because `cached()` may bake them in a different order between the
// capture path and the play path.

import * as THREE from 'three';
import { fbm2, noise2, cached } from '../../foundation/texlab.js';
import { hash01 } from '../../foundation/rng.js';
import { ATLAS_SIZE, ATLAS_GRID, ATLAS_INSET, CELL } from './config.js';

const C = ATLAS_SIZE / ATLAS_GRID;          // 128
const HALF = C * 0.5;
const USABLE = (HALF - ATLAS_INSET) / HALF; // the -1..1 radius the art may occupy

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function sstep(a, b, x) {
  if (a === b) return x < a ? 0 : 1;
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/* ------------------------------------------------------------- cell recipes */
/* Each returns [r, g, b, a] in 0..1 for a point (nx, ny) in -1..1, +y UP.          */
/* The RGB is the sprite's own shading; the per-quad tint multiplies it afterwards. */

function cellGlow(nx, ny, r) {
  // Two lobes: a tight core that survives being scaled up to 3 m, and a wide skirt.
  const a = (Math.exp(-8.5 * r * r) * 0.85 + Math.exp(-2.1 * r * r) * 0.42) * sstep(1.0, 0.72, r);
  return [1, 0.97, 0.93, clamp01(a)];
}

function cellSpark(nx, ny) {
  // A streak that is NOT symmetric: the head (nx = -1) is hot and blunt, the tail
  // (nx = +1) thins to nothing. mode STREAK aligns -x with the direction of travel, so
  // this reads as a particle with its own trail rather than as a floating dash.
  const t = (nx + 1) * 0.5;                 // 0 at head, 1 at tail
  const thick = 0.085 * (1.0 - t * 0.82) + 0.012;
  const core = Math.exp(-(ny * ny) / (2 * thick * thick));
  const body = Math.pow(1 - t, 1.25);
  const head = Math.exp(-((nx + 0.86) * (nx + 0.86) + ny * ny) * 60.0);
  const a = clamp01(core * body * 0.95 + head * 0.9);
  const heat = clamp01(head * 1.2 + (1 - t) * 0.85);
  return [1, 0.55 + heat * 0.45, 0.16 + heat * 0.62, a];
}

function puff(nx, ny, r, seed, warp, edge) {
  // Radial mask pushed around by fbm so the silhouette billows instead of being a disc.
  const n = fbm2(nx * 1.9 + 3.1, ny * 1.9 - 1.7, { octaves: 4, seed });
  const rr = r * (1 + warp * n);
  return sstep(1.0 * USABLE, edge * USABLE, rr);
}

function cellSmoke(nx, ny, r) {
  const a = puff(nx, ny, r, 771, 0.42, 0.12) * 0.85;
  // Interior structure so a big puff is not a flat blob: low-frequency lumps.
  const lump = fbm2(nx * 3.4 - 5.0, ny * 3.4 + 2.0, { octaves: 3, seed: 913 }) * 0.5 + 0.5;
  const v = 0.62 + lump * 0.55;
  return [v, v * 0.97, v * 0.94, clamp01(a * (0.55 + lump * 0.7))];
}

function cellDust(nx, ny, r) {
  // Softer and lumpier than SMOKE but NOT invisible — the first version faded from the
  // centre outward over the whole cell and the atlas dump showed a barely-there smudge.
  const a = puff(nx, ny, r, 2411, 0.34, -0.02) * 0.62;
  const lump = fbm2(nx * 2.2 + 8.0, ny * 2.2 - 3.0, { octaves: 3, seed: 55 }) * 0.5 + 0.5;
  return [1, 0.95, 0.9, clamp01(a * (0.5 + lump * 0.7))];
}

function cellStar(nx, ny, r) {
  const th = Math.atan2(ny, nx);
  // 4 long spikes on the diagonals + 8 short ones between them. The long/short mix is
  // what makes it read as a photographed flare rather than an asterisk.
  const s4 = Math.pow(Math.abs(Math.cos(2 * th - 0.785)), 46);
  const s8 = Math.pow(Math.abs(Math.cos(4 * th)), 90) * 0.55;
  const spike = (s4 + s8) * Math.exp(-2.6 * r) * sstep(1.0 * USABLE, 0.55 * USABLE, r);
  const core = Math.exp(-26 * r * r) + Math.exp(-4.2 * r * r) * 0.30;
  const a = clamp01(spike * 1.35 + core);
  const heat = clamp01(core * 1.4 + 0.25);
  return [1, 0.80 + heat * 0.20, 0.45 + heat * 0.5, a];
}

function cellRing(nx, ny, r) {
  // A shockwave, not a hoop: hard bright leading edge on the outside, a soft wash
  // trailing inside it. Radius sits at 0.82 so scaling the quad scales the ring.
  const R0 = 0.82 * USABLE;
  const d = r - R0;
  const edge = Math.exp(-(d * d) / (2 * 0.042 * 0.042));
  const inner = d < 0 ? Math.exp(d * 5.5) * 0.30 : 0;
  const a = clamp01((edge + inner) * sstep(1.0, 0.93, r / USABLE));
  return [1, 0.86, 0.70, a];
}

function cellEmber(nx, ny, r) {
  const a = clamp01(Math.exp(-46 * r * r) + Math.exp(-6.0 * r * r) * 0.34);
  return [1, 0.72, 0.36, a];
}

function cellFlame(nx, ny) {
  // A tongue pointing +y. Width follows a lifted sine so the base is round and the tip
  // tapers to a wisp; the edge is chewed by noise so no two tongues share a silhouette
  // once they are rotated and scaled differently.
  const t = clamp01((ny + 1) * 0.5);
  const w = (0.60 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.62)), 0.75) * (1 - t * 0.52) + 0.02) * USABLE;
  const chew = noise2(nx * 5.0, ny * 3.0 + 11.0, 401) * 0.10 * t;
  const a = sstep(w + chew, w * 0.28, Math.abs(nx)) * sstep(1.0, 0.88, t) * sstep(0.0, 0.06, t);
  // Hot and pale at the root, saturating to orange up the tongue.
  const heat = Math.pow(1 - t, 1.6);
  return [1, 0.42 + heat * 0.58, 0.08 + heat * 0.72, clamp01(a * (0.55 + heat * 0.6))];
}

function cellBar(nx, ny) {
  const a = Math.exp(-(ny * ny) / (2 * 0.030 * 0.030)) * Math.pow(clamp01(1 - Math.abs(nx) / USABLE), 0.85);
  return [0.86, 0.93, 1, clamp01(a * 0.9)];
}

/**
 * A torn lump of turf. `lobes`/`rough` change the silhouette, `seed` everything else.
 * TOP-LIT IN THE SPRITE, and that is the whole trick: the debris material is unlit
 * (see quads.js), so a clod only reads as a solid three-dimensional object if the light
 * is painted in. In bar/panel-leveler.png the clods are near-black with a warm lip along
 * the top edge, which is exactly a key light above and slightly behind.
 */
function clod(nx, ny, r, seed, lobes, rough, grassTop) {
  const th = Math.atan2(ny, nx);
  // FACETED, NOT FLUFFY. The first version perturbed a circle with fbm and the atlas
  // dump (shots/impact-fx/atlas.png) showed three snowballs — a soft cloudy silhouette
  // reads as vapour at any size. Torn ground breaks along flat faces, so the base shape
  // is a `lobes`-sided polygon (R = poly / cos of the angle within one facet, the standard
  // regular-polygon SDF trick) and the noise only roughens its edges.
  const seg = (Math.PI * 2) / lobes;
  let a2 = (th + seed) % seg;
  if (a2 < 0) a2 += seg;
  a2 -= seg * 0.5;
  const wob = fbm2(Math.cos(th) * 2.2 + seed * 0.7, Math.sin(th) * 2.2 - seed * 0.3, { octaves: 3, seed });
  let R = (0.56 / Math.cos(a2)) * (1 + rough * wob);
  if (R > 1) R = 1;
  R *= USABLE;
  const a = sstep(R, R - 0.035, r);
  if (a <= 0) return [0, 0, 0, 0];
  // Key from above. The range is kept BELOW 1 on purpose: the previous curve peaked at
  // 2.3, so everything above the lump's midline clipped to flat white and the whole
  // top-lit gradient — the only shading these unlit quads ever get — was thrown away.
  const up = clamp01(ny / Math.max(R, 0.001) * 0.5 + 0.5);
  const lit = 0.075 + Math.pow(up, 2.0) * 0.94;
  const rim = sstep(R - 0.13, R - 0.02, r) * Math.pow(clamp01(ny), 1.5) * 0.55;
  const grain = 0.76 + fbm2(nx * 7.0 + seed, ny * 7.0 - seed, { octaves: 3, seed: seed + 7 }) * 0.46;
  const v = (lit + rim) * grain;
  const g = grassTop > 0 ? clamp01(up - 0.62) * grassTop : 0;
  return [v, v * (1 + g * 1.1), v * (1 - g * 0.55), a];
}

function cellTuft(nx, ny, r) {
  // Severed blades fanning from the bottom. Distance to a handful of quadratic spines.
  let a = 0, v = 0;
  for (let i = 0; i < 7; i++) {
    const lean = (hash01(i, 31) - 0.5) * 1.55;
    const len = 0.55 + hash01(i, 57) * 0.44;
    const x0 = (hash01(i, 71) - 0.5) * 0.55;
    const t = clamp01((ny + 1) * 0.5 / len);
    if (t >= 1) continue;
    const sx = x0 + lean * t * t;
    const w = 0.030 * (1 - t) + 0.004;
    const d = Math.abs(nx - sx);
    const s = sstep(w, w * 0.2, d) * sstep(1.0, 0.86, t);
    if (s > a) { a = s; v = 0.30 + (1 - t) * 0.95 + hash01(i, 13) * 0.35; }
  }
  void r;
  return [v * 0.72, v, v * 0.42, clamp01(a)];
}

function cellSod(nx, ny, r) {
  // A flat flake seen edge-on-ish: wide, thin, green crust over dark soil.
  const th = Math.atan2(ny * 2.6, nx);
  const edge = 0.72 + 0.20 * fbm2(Math.cos(th) * 3.0, Math.sin(th) * 3.0, { octaves: 3, seed: 1201 });
  const rr = Math.sqrt(nx * nx + (ny * 2.6) * (ny * 2.6));
  const a = sstep(edge * USABLE, edge * USABLE - 0.05, rr);
  const up = clamp01(ny * 3.0 + 0.5);
  const grain = 0.82 + fbm2(nx * 9.0, ny * 22.0, { octaves: 2, seed: 88 }) * 0.5;
  const v = (0.16 + up * 1.25) * grain;
  void r;
  return [v * 0.80, v * (1 + up * 0.55), v * 0.52, clamp01(a)];
}

function cellSplat(nx, ny, r) {
  const th = Math.atan2(ny, nx);
  const edge = 0.52 + 0.24 * fbm2(Math.cos(th) * 2.4 + 5, Math.sin(th) * 2.4 - 5, { octaves: 3, seed: 331 });
  let a = sstep(edge * USABLE, edge * USABLE - 0.05, r);
  // three satellite droplets, deterministic
  for (let i = 0; i < 3; i++) {
    const ang = hash01(i, 907) * Math.PI * 2;
    const rad = (0.62 + hash01(i, 211) * 0.28) * USABLE;
    const dx = nx - Math.cos(ang) * rad, dy = ny - Math.sin(ang) * rad;
    a = Math.max(a, sstep(0.10, 0.05, Math.sqrt(dx * dx + dy * dy)));
  }
  const up = clamp01(ny * 0.5 + 0.5);
  const v = (0.13 + Math.pow(up, 2.0) * 1.35) * (0.85 + fbm2(nx * 8, ny * 8, { octaves: 2, seed: 44 }) * 0.4);
  return [v, v * 0.90, v * 0.78, clamp01(a)];
}

function cellWisp(nx, ny) {
  // A thin comma of smoke bent along a parabola — used to break up the round puffs.
  const yy = ny;
  const cx = 0.42 * yy * yy - 0.22;
  const w = 0.30 * (1 - Math.abs(yy)) + 0.02;
  const a = sstep(w, w * 0.15, Math.abs(nx - cx)) * sstep(1.0, 0.80, Math.abs(yy));
  const n = fbm2(nx * 4.0 - 2.0, ny * 4.0 + 6.0, { octaves: 3, seed: 617 }) * 0.5 + 0.5;
  return [1, 0.96, 0.92, clamp01(a * (0.30 + n * 0.75) * 0.7)];
}

/**
 * The recipe table, exported so the cells can be rasterised OUTSIDE a browser.
 * Nothing above this line touches the DOM or a GL context, which means a plain-node
 * script can dump all sixteen cells to a PNG in a second instead of spending four
 * minutes on a headless capture to find out that one sprite is wrong. That is not a
 * hypothetical: the atlas row-order bug in quads.js took two full captures to spot.
 */
export const RECIPE = [];
RECIPE[CELL.GLOW] = cellGlow;
RECIPE[CELL.SPARK] = cellSpark;
RECIPE[CELL.SMOKE] = cellSmoke;
RECIPE[CELL.STAR] = cellStar;
RECIPE[CELL.RING] = cellRing;
RECIPE[CELL.EMBER] = cellEmber;
RECIPE[CELL.FLAME] = cellFlame;
RECIPE[CELL.BAR] = cellBar;
RECIPE[CELL.CLOD_A] = (nx, ny, r) => clod(nx, ny, r, 17, 5, 0.26, 0.30);
RECIPE[CELL.CLOD_B] = (nx, ny, r) => clod(nx, ny, r, 53, 6, 0.30, 0.0);
RECIPE[CELL.CLOD_C] = (nx, ny, r) => clod(nx, ny, r, 91, 4, 0.22, 0.0);
RECIPE[CELL.TUFT] = cellTuft;
RECIPE[CELL.SOD] = cellSod;
RECIPE[CELL.SPLAT] = cellSplat;
RECIPE[CELL.WISP] = cellWisp;
RECIPE[CELL.DUST] = cellDust;

/* ---------------------------------------------------------------- the bake */

/**
 * The atlas as a THREE.Texture. Cached by texlab so the play path and the capture path
 * share one bake, and so a scene rebuild (which re-runs fx.build) does not re-bake it —
 * that was 210 ms of the first rebuild before the cache key was added.
 */
export function fxAtlas() {
  return cached('impactfx:atlas:512', () => {
    let cv;
    if (typeof OffscreenCanvas !== 'undefined') cv = new OffscreenCanvas(ATLAS_SIZE, ATLAS_SIZE);
    else { cv = document.createElement('canvas'); cv.width = ATLAS_SIZE; cv.height = ATLAS_SIZE; }
    const g2 = cv.getContext('2d', { willReadFrequently: true });
    g2.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);

    const img = g2.createImageData(C, C);
    for (let cell = 0; cell < ATLAS_GRID * ATLAS_GRID; cell++) {
      const fn = RECIPE[cell];
      const cx = (cell % ATLAS_GRID) * C;
      const cy = Math.floor(cell / ATLAS_GRID) * C;
      for (let y = 0; y < C; y++) {
        // Canvas y grows DOWN; every recipe above is written with +y UP.
        const ny = -((y + 0.5) / HALF - 1);
        for (let x = 0; x < C; x++) {
          const nx = (x + 0.5) / HALF - 1;
          const r = Math.sqrt(nx * nx + ny * ny);
          const c = fn ? fn(nx, ny, r) : [0, 0, 0, 0];
          const i = (y * C + x) * 4;
          // Alpha is forced to zero outside the inset so a mip can never sample art
          // from the neighbouring cell.
          const keep = r <= USABLE ? 1 : 0;
          img.data[i] = clamp01(c[0]) * 255;
          img.data[i + 1] = clamp01(c[1]) * 255;
          img.data[i + 2] = clamp01(c[2]) * 255;
          img.data[i + 3] = clamp01(c[3]) * keep * 255;
        }
      }
      g2.putImageData(img, cx, cy);
    }

    const tex = new THREE.CanvasTexture(cv);
    // NoColorSpace: these are masks and shading ramps multiplied by LINEAR radiance
    // tints, not sRGB artwork. Tagging it sRGB double-applied the transfer curve and
    // crushed every mid-tone in the clods to black.
    tex.colorSpace = THREE.NoColorSpace;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return tex;
  });
}

export default fxAtlas;
