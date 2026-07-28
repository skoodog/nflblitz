// FOUNDATION — FROZEN after t=0. Do not edit.
// Seeded, deterministic randomness. Nothing in src/pieces/ may use Math.random,
// Date.now or performance.now — scripts/lint-determinism.mjs fails the build on those.

/** 32-bit integer hash of any number of ints (order matters). */
export function hash(...ints) {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < ints.length; i++) {
    let x = ints[i] | 0;
    x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
    x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
    x = x ^ (x >>> 16);
    h = Math.imul(h ^ x, 0x01000193) >>> 0;
  }
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491) >>> 0;
  h ^= h >>> 13;
  return h >>> 0;
}

/** Stable string -> uint32 seed. */
export function seedFromString(s) {
  s = String(s);
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return hash(h, s.length);
}

/**
 * mulberry32. `makeRng(seed)` -> function returning [0,1).
 * The returned fn also carries helpers: .int(n), .range(a,b), .sign(), .fork(tag)
 */
export function makeRng(seed) {
  let a = (typeof seed === 'string' ? seedFromString(seed) : seed | 0) >>> 0;
  if (a === 0) a = 0x9e3779b9;
  const fn = function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  fn.int = (n) => Math.floor(fn() * n);
  fn.range = (lo, hi) => lo + fn() * (hi - lo);
  fn.sign = () => (fn() < 0.5 ? -1 : 1);
  /** Deterministic child stream, independent of how many times the parent was drawn. */
  fn.fork = (tag) => makeRng(hash(seed | 0, seedFromString(String(tag))));
  fn.seed = seed;
  return fn;
}

export function pick(rng, arr) {
  if (!arr || arr.length === 0) return undefined;
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

/** Box–Muller, mean 0 sigma 1. */
export function gauss(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/** Deterministic float in [0,1) straight from ints — no stream state. */
export function hash01(...ints) {
  return hash(...ints) / 4294967296;
}

/** Low-discrepancy sequence used by the accumulation jitter. */
export function halton(index, base) {
  let f = 1, r = 0, i = index;
  while (i > 0) {
    f /= base;
    r += f * (i % base);
    i = Math.floor(i / base);
  }
  return r;
}

export default { makeRng, hash, hash01, pick, gauss, seedFromString, halton };
