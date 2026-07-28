// FOUNDATION — FROZEN after t=0. Do not edit.
// URL parameter parsing. Every capture is fully described by the URL.

const DEFAULTS = {
  scene: 'truck',
  seed: 7,
  t: 0,
  w: 1920,
  h: 1080,
  quality: 'live',
  accum: 32,
  warmup: 8,
  hud: null,      // null = follow the ShotSpec
  ui: null,       // null = follow the ShotSpec
  layer: 'all',   // all | gl | overlay
  variant: '',
  debug: 0,
  list: 0,
};

function num(v, d) {
  if (v === null || v === undefined || v === '') return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function bool01(v, d) {
  if (v === null || v === undefined || v === '') return d;
  if (v === '1' || v === 'true' || v === 'yes') return 1;
  if (v === '0' || v === 'false' || v === 'no') return 0;
  return d;
}

export function parseParams(search) {
  const q = new URLSearchParams(
    search !== undefined ? search : (typeof location !== 'undefined' ? location.search : '')
  );
  const quality = q.get('quality') === 'capture' ? 'capture' : DEFAULTS.quality;
  const layerRaw = q.get('layer');
  const layer = layerRaw === 'gl' || layerRaw === 'overlay' ? layerRaw : 'all';

  const p = {
    scene: q.get('scene') || DEFAULTS.scene,
    seed: Math.trunc(num(q.get('seed'), DEFAULTS.seed)),
    t: num(q.get('t'), DEFAULTS.t),
    w: Math.max(16, Math.round(num(q.get('w'), DEFAULTS.w))),
    h: Math.max(16, Math.round(num(q.get('h'), DEFAULTS.h))),
    quality,
    accum: Math.max(1, Math.round(num(q.get('accum'), DEFAULTS.accum))),
    warmup: Math.max(0, Math.round(num(q.get('warmup'), DEFAULTS.warmup))),
    hud: bool01(q.get('hud'), DEFAULTS.hud),
    ui: bool01(q.get('ui'), DEFAULTS.ui),
    layer,
    variant: q.get('variant') || DEFAULTS.variant,
    debug: bool01(q.get('debug'), DEFAULTS.debug) === 1,
    list: bool01(q.get('list'), DEFAULTS.list) === 1,
  };

  // In live mode we never accumulate — the game must stay interactive.
  if (p.quality === 'live') {
    p.accum = 1;
    p.warmup = Math.min(p.warmup, 2);
  }
  return p;
}

/** Quality tiers. Read by engine + cinema; pieces may branch on ctx.quality. */
export function qualityProfile(quality) {
  if (quality === 'capture') {
    return {
      ssaa: 1.5,          // supersample factor on the accumulation targets
      shadowSize: 4096,
      post: 'full',
      particleBudget: 64000,
      anisotropy: 8,
      textureScale: 1.0,
      motionBlur: true,
      dof: true,
    };
  }
  return {
    ssaa: 1.0,
    shadowSize: 2048,
    post: 'reduced',
    particleBudget: 8000,
    anisotropy: 4,
    textureScale: 0.5,
    motionBlur: false,
    dof: false,
  };
}

export const PARAM_DEFAULTS = DEFAULTS;
export default { parseParams, qualityProfile, PARAM_DEFAULTS };
