// FOUNDATION — FROZEN after t=0. Do not edit.
// Procedural texture laboratory. Every asset in this project is baked here at boot;
// there are no binary art assets and no network at runtime.
//
// All noise is *stateless and deterministic* — it hashes its integer lattice, it does
// not draw from an RNG stream. Same inputs, same bytes, forever.

import * as THREE from 'three';
import { hash } from './rng.js';

/* ------------------------------------------------------------------ hashing */

function h2(ix, iy, s) { return hash(ix, iy, s) / 4294967296; }
function h3(ix, iy, iz, s) { return hash(ix, iy, iz, s) / 4294967296; }
function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
function lerp(a, b, t) { return a + (b - a) * t; }

function grad2(ix, iy, s, dx, dy) {
  const a = h2(ix, iy, s) * Math.PI * 2;
  return Math.cos(a) * dx + Math.sin(a) * dy;
}

function grad3(ix, iy, iz, s, dx, dy, dz) {
  const u = h3(ix, iy, iz, s);
  const v = h3(ix, iy, iz, s ^ 0x5bd1e995);
  const theta = u * Math.PI * 2;
  const z = v * 2 - 1;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return Math.cos(theta) * r * dx + Math.sin(theta) * r * dy + z * dz;
}

/* -------------------------------------------------------------------- noise */

/** Perlin-style gradient noise, range roughly [-1,1]. */
export function noise2(x, y, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fade(fx), v = fade(fy);
  const n00 = grad2(ix, iy, seed, fx, fy);
  const n10 = grad2(ix + 1, iy, seed, fx - 1, fy);
  const n01 = grad2(ix, iy + 1, seed, fx, fy - 1);
  const n11 = grad2(ix + 1, iy + 1, seed, fx - 1, fy - 1);
  return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v) * 1.4142;
}

export function noise3(x, y, z, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fade(fx), v = fade(fy), w = fade(fz);
  const g = (dx, dy, dz) => grad3(ix + dx, iy + dy, iz + dz, seed, fx - dx, fy - dy, fz - dz);
  const x00 = lerp(g(0, 0, 0), g(1, 0, 0), u);
  const x10 = lerp(g(0, 1, 0), g(1, 1, 0), u);
  const x01 = lerp(g(0, 0, 1), g(1, 0, 1), u);
  const x11 = lerp(g(0, 1, 1), g(1, 1, 1), u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w) * 1.1547;
}

/** Fractal Brownian motion. opts: {octaves, lacunarity, gain, seed} */
export function fbm2(x, y, opts = {}) {
  const oct = opts.octaves || 5;
  const lac = opts.lacunarity || 2.0;
  const gain = opts.gain !== undefined ? opts.gain : 0.5;
  const seed = opts.seed || 0;
  let a = 0.5, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += a * noise2(x * f, y * f, seed + i * 1013);
    norm += a;
    a *= gain; f *= lac;
  }
  return sum / (norm || 1);
}

export function fbm3(x, y, z, opts = {}) {
  const oct = opts.octaves || 4;
  const lac = opts.lacunarity || 2.0;
  const gain = opts.gain !== undefined ? opts.gain : 0.5;
  const seed = opts.seed || 0;
  let a = 0.5, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += a * noise3(x * f, y * f, z * f, seed + i * 1013);
    norm += a;
    a *= gain; f *= lac;
  }
  return sum / (norm || 1);
}

/** Ridged multifractal — good for torn turf, cloth folds, cracked paint. */
export function ridged2(x, y, opts = {}) {
  const oct = opts.octaves || 5;
  const lac = opts.lacunarity || 2.1;
  const gain = opts.gain !== undefined ? opts.gain : 0.5;
  const seed = opts.seed || 0;
  let a = 0.5, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    const n = 1 - Math.abs(noise2(x * f, y * f, seed + i * 7717));
    sum += a * n * n;
    norm += a;
    a *= gain; f *= lac;
  }
  return sum / (norm || 1);
}

/**
 * Worley / cellular. Returns {f1, f2, id, cx, cy}.
 * `f2 - f1` gives clean cell borders (crowd tiles, scuffed paint, pad quilting).
 */
export function worley2(x, y, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let f1 = 1e9, f2 = 1e9, id = 0, cx = 0, cy = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const gx = ix + dx, gy = iy + dy;
      const px = gx + h2(gx, gy, seed);
      const py = gy + h2(gx, gy, seed ^ 0x9e3779b9);
      const d = Math.hypot(px - x, py - y);
      if (d < f1) {
        f2 = f1; f1 = d; id = hash(gx, gy, seed); cx = px; cy = py;
      } else if (d < f2) { f2 = d; }
    }
  }
  return { f1, f2, id, cx, cy };
}

/** Divergence-free curl noise — smoke, sparks, flame advection. Returns [x,y,z]. */
export function curl3(x, y, z, opts = {}) {
  const e = opts.eps || 0.06;
  const o = Object.assign({ octaves: 3 }, opts);
  const s = opts.seed || 0;
  const p1 = (a, b, c) => fbm3(a, b, c, Object.assign({}, o, { seed: s }));
  const p2 = (a, b, c) => fbm3(a, b, c, Object.assign({}, o, { seed: s + 5501 }));
  const p3 = (a, b, c) => fbm3(a, b, c, Object.assign({}, o, { seed: s + 9907 }));
  const dp3dy = (p3(x, y + e, z) - p3(x, y - e, z)) / (2 * e);
  const dp2dz = (p2(x, y, z + e) - p2(x, y, z - e)) / (2 * e);
  const dp1dz = (p1(x, y, z + e) - p1(x, y, z - e)) / (2 * e);
  const dp3dx = (p3(x + e, y, z) - p3(x - e, y, z)) / (2 * e);
  const dp2dx = (p2(x + e, y, z) - p2(x - e, y, z)) / (2 * e);
  const dp1dy = (p1(x, y + e, z) - p1(x, y - e, z)) / (2 * e);
  return [dp3dy - dp2dz, dp1dz - dp3dx, dp2dx - dp1dy];
}

/* ------------------------------------------------------------------ canvases */

/** Offscreen (or DOM) canvas + 2d context, sized w x h. */
export function canvas(w, h) {
  let cv;
  if (typeof OffscreenCanvas !== 'undefined') {
    cv = new OffscreenCanvas(w, h);
  } else {
    cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
  }
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  return { cv, ctx, w, h };
}

/** canvas -> THREE.Texture. opts {srgb=true, wrap=RepeatWrapping, aniso=8, flipY} */
export function toTexture(cv, opts = {}) {
  const tex = new THREE.CanvasTexture(cv.cv || cv);
  tex.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  const wrap = opts.wrap !== undefined ? opts.wrap : THREE.RepeatWrapping;
  tex.wrapS = tex.wrapT = wrap;
  tex.anisotropy = opts.aniso !== undefined ? opts.aniso : 8;
  tex.generateMipmaps = opts.mipmaps !== false;
  tex.minFilter = tex.generateMipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  if (opts.flipY !== undefined) tex.flipY = opts.flipY;
  if (opts.repeat) tex.repeat.set(opts.repeat[0], opts.repeat[1]);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Height (luminance of a canvas) -> tangent-space normal map Texture.
 * `strength` ~1 is subtle, ~4 is aggressive.
 */
export function heightToNormal(cv, strength = 2.0) {
  const src = cv.cv || cv;
  const w = src.width, h = src.height;
  const sctx = (cv.ctx) || src.getContext('2d');
  const img = sctx.getImageData(0, 0, w, h).data;
  const out = canvas(w, h);
  const dst = out.ctx.createImageData(w, h);
  const L = (x, y) => {
    const xi = ((x % w) + w) % w, yi = ((y % h) + h) % h;
    const i = (yi * w + xi) * 4;
    return (img[i] * 0.299 + img[i + 1] * 0.587 + img[i + 2] * 0.114) / 255;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (L(x + 1, y) - L(x - 1, y)) * strength;
      const dy = (L(x, y + 1) - L(x, y - 1)) * strength;
      let nx = -dx, ny = -dy, nz = 1;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      const i = (y * w + x) * 4;
      dst.data[i] = (nx * 0.5 + 0.5) * 255;
      dst.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      dst.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      dst.data[i + 3] = 255;
    }
  }
  out.ctx.putImageData(dst, 0, 0);
  const tex = toTexture(out, { srgb: false });
  tex.__canvas = out;
  return tex;
}

/* ------------------------------------------------------------------- colour */

function hexToRgb(c) {
  if (Array.isArray(c)) return c.slice(0, 3);
  let s = String(c).replace('#', '');
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  const n = parseInt(s, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * ramp([[0,'#000'],[0.5,'#f33'],[1,'#fff']]) -> (t) => [r,g,b] in 0..1
 * Also exposes .css(t) -> 'rgb(...)' for Canvas2D use.
 */
export function ramp(stops) {
  const S = stops.map((s) => [s[0], hexToRgb(s[1])]).sort((a, b) => a[0] - b[0]);
  const f = (t) => {
    if (!Number.isFinite(t)) t = 0;
    if (t <= S[0][0]) return S[0][1].slice();
    if (t >= S[S.length - 1][0]) return S[S.length - 1][1].slice();
    for (let i = 0; i < S.length - 1; i++) {
      if (t >= S[i][0] && t <= S[i + 1][0]) {
        const k = (t - S[i][0]) / ((S[i + 1][0] - S[i][0]) || 1);
        const a = S[i][1], b = S[i + 1][1];
        return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
      }
    }
    return S[S.length - 1][1].slice();
  };
  f.css = (t) => {
    const c = f(t);
    return `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
  };
  f.gradient = (ctx, x0, y0, x1, y1, n = 16) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    for (let i = 0; i <= n; i++) g.addColorStop(i / n, f.css(i / n));
    return g;
  };
  return f;
}

/* ------------------------------------------------------------- data texture */

/**
 * dataTexture((x, y, u, v) => [r,g,b,a], w, h, {float, wrap, srgb})
 * Channel values are 0..1 regardless of storage type.
 */
export function dataTexture(fn, w, h, opts = {}) {
  const float = !!opts.float;
  const n = w * h * 4;
  const arr = float ? new Float32Array(n) : new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = fn(x, y, (x + 0.5) / w, (y + 0.5) / h) || [0, 0, 0, 1];
      const i = (y * w + x) * 4;
      for (let k = 0; k < 4; k++) {
        const v = c[k] !== undefined ? c[k] : (k === 3 ? 1 : 0);
        arr[i + k] = float ? v : Math.max(0, Math.min(255, Math.round(v * 255)));
      }
    }
  }
  const tex = new THREE.DataTexture(arr, w, h, THREE.RGBAFormat, float ? THREE.FloatType : THREE.UnsignedByteType);
  tex.colorSpace = opts.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  const wrap = opts.wrap !== undefined ? opts.wrap : THREE.RepeatWrapping;
  tex.wrapS = tex.wrapT = wrap;
  tex.minFilter = opts.nearest ? THREE.NearestFilter : THREE.LinearFilter;
  tex.magFilter = opts.nearest ? THREE.NearestFilter : THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Void-and-cluster-ish blue noise tile (deterministic). Returns a DataTexture. */
export function blueNoise(size = 64) {
  return cached(`bluenoise:${size}`, () => {
    // Cheap but well-distributed: jittered rank of a hashed value against a
    // low-frequency mask. Good enough for dithering + jittered sampling.
    const v = new Float32Array(size * size);
    for (let i = 0; i < size * size; i++) {
      const x = i % size, y = (i / size) | 0;
      const lo = fbm2(x / 9.0, y / 9.0, { octaves: 2, seed: 31 }) * 0.5 + 0.5;
      v[i] = (hash(x, y, 4242) / 4294967296) * 0.75 + lo * 0.25;
    }
    const order = Array.from({ length: size * size }, (_, i) => i).sort((a, b) => v[a] - v[b]);
    const rank = new Float32Array(size * size);
    order.forEach((idx, r) => { rank[idx] = r / (size * size - 1); });
    return dataTexture((x, y) => {
      const r = rank[y * size + x];
      return [r, rank[((y + 17) % size) * size + ((x + 29) % size)], r, 1];
    }, size, size, { nearest: true });
  });
}

/* ------------------------------------------------------------------- decals */

/**
 * Composite a decal (canvas, image or draw-callback) onto a target canvas with
 * rotation, scale, tint and blend mode. Used for numbers, logos, dirt, scuffs.
 *   decal(target, src, {x, y, w, h, rot, alpha, blend, tint})
 */
export function decal(target, src, opts = {}) {
  const ctx = target.ctx || target.getContext('2d');
  const s = src && src.cv ? src.cv : src;
  ctx.save();
  ctx.globalAlpha = opts.alpha !== undefined ? opts.alpha : 1;
  if (opts.blend) ctx.globalCompositeOperation = opts.blend;
  const x = opts.x || 0, y = opts.y || 0;
  const w = opts.w !== undefined ? opts.w : (s && s.width) || 0;
  const h = opts.h !== undefined ? opts.h : (s && s.height) || 0;
  ctx.translate(x, y);
  if (opts.rot) ctx.rotate(opts.rot);
  if (typeof src === 'function') {
    src(ctx, w, h);
  } else {
    ctx.drawImage(s, -w / 2, -h / 2, w, h);
  }
  ctx.restore();
  if (opts.tint) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = opts.tintAmount !== undefined ? opts.tintAmount : 0.5;
    ctx.fillStyle = opts.tint;
    ctx.fillRect(0, 0, target.w || ctx.canvas.width, target.h || ctx.canvas.height);
    ctx.restore();
  }
  return target;
}

/** Fill a canvas from a per-pixel callback returning [r,g,b] or [r,g,b,a] in 0..1. */
export function fillPixels(cvo, fn) {
  const { ctx, w, h } = cvo;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = fn(x, y, (x + 0.5) / w, (y + 0.5) / h);
      const i = (y * w + x) * 4;
      img.data[i] = Math.max(0, Math.min(255, c[0] * 255));
      img.data[i + 1] = Math.max(0, Math.min(255, c[1] * 255));
      img.data[i + 2] = Math.max(0, Math.min(255, c[2] * 255));
      img.data[i + 3] = c[3] === undefined ? 255 : Math.max(0, Math.min(255, c[3] * 255));
    }
  }
  ctx.putImageData(img, 0, 0);
  return cvo;
}

/* -------------------------------------------------------------------- cache */

const CACHE = new Map();

/** cached('turf:albedo:1024', () => makeIt()) — bakes exactly once per page load. */
export function cached(key, fn) {
  if (CACHE.has(key)) return CACHE.get(key);
  const v = fn();
  CACHE.set(key, v);
  return v;
}

export function clearCache() { CACHE.clear(); }

export const texlab = {
  noise2, noise3, fbm2, fbm3, worley2, curl3, ridged2,
  canvas, toTexture, heightToNormal, ramp, dataTexture, blueNoise,
  decal, fillPixels, cached, clearCache, hexToRgb, THREE,
};

export default texlab;
