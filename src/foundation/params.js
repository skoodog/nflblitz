// FOUNDATION — PERFCORE owns this file.
// URL parameter parsing. Every capture is fully described by the URL, and so is every
// runtime measurement — `perf.mjs`, `touch.mjs` and `budget.mjs` all drive the game by
// URL alone so a critic can paste the same URL into a browser and see what the harness
// saw.
//
// THE MODE PARAMETER IS THE PATH SELECTOR:
//   ?mode=capture   1920x1080 accumulation still. No frame budget. The fidelity bar.
//   ?mode=play      the runtime loop. The performance contract. THE GAME.
// `?quality=capture` is kept as the legacy spelling of `?mode=capture` so every
// existing shoot.mjs invocation and every already-captured URL still works.

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
  // --- runtime path -------------------------------------------------------
  mode: null,     // capture | play  (null -> derived from quality)
  tier: null,     // floor | low | mid | high — forces the tier, skipping the probe
  rung: null,     // 0..15 — forces the rung and LOCKS the scaler's rung axis
  rate: null,     // 60 | 30 — forces the present rate and LOCKS the rate axis
  raster: 'auto', // auto | min  (min = 256x144, shadows/post off)
  probe: 1,       // run the boot micro-probe (0 to skip, for deterministic harness runs)
  autostart: 1,   // start the loop immediately
  dpr: null,      // override devicePixelRatio for the overlay
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

  // --- the path selector ---------------------------------------------------
  const modeRaw = q.get('mode');
  p.mode = modeRaw === 'capture' ? 'capture'
    : modeRaw === 'play' ? 'play'
      : (p.quality === 'capture' ? 'capture' : 'play');

  // THE PLAY PATH MUST NOT DEFAULT TO A POSED HERO SHOT. `DEFAULTS.scene` is 'truck',
  // which is a STATIC capture scene: a frozen collision with a TRUCK! callout over it.
  // Booting the game with no ?scene= therefore rendered that single frozen frame and
  // animated nothing, on a path advertised as "play". It is what a player actually saw.
  // `live_play` is the scene foundation/scenes.js drives from REG.sim.
  if (p.mode === 'play' && !q.get('scene')) p.scene = 'live_play';

  const tierRaw = q.get('tier');
  p.tier = ['floor', 'low', 'mid', 'high'].includes(tierRaw) ? tierRaw : null;

  const rungRaw = q.get('rung');
  p.rung = rungRaw === null || rungRaw === '' ? null
    : Math.max(0, Math.min(15, Math.round(num(rungRaw, 8))));

  const rateRaw = q.get('rate');
  p.rate = rateRaw === '30' ? 30 : rateRaw === '60' ? 60 : null;

  // auto = the rung's real render scale.  min = 256x144.  none = skip GL submission.
  //
  // `none` exists because of a measurement, not a preference. The contract assumed a
  // 256x144 internal render would take software raster out of the equation. It does not.
  //
  // ROUND 2 CORRECTION. This comment used to say the frame interval was "66-150 ms at
  // ANY internal resolution" because SwiftShader's cost was "resolution-independent".
  // That is false, and `progress/cost-curve.md` measures it properly: near the floor,
  //     frame_ms ~ 20.8 + 838 * megapixels
  // Resolution matters a great deal — the ladder spans 24 ms to 1240 ms on resolution
  // alone. What is TRUE is that ~20.8 ms of the floor frame is per-triangle and
  // per-draw-call work that no render scale touches, and 20.8 ms is already most of a
  // 33.3 ms period. So `min` still cannot isolate the loop's pacing here, and `none` —
  // which runs input, sim, anim, fx, camera, overlay and the scaler but issues no GL
  // draw — is what actually does. Same conclusion, correct reason.
  const rr = q.get('raster');
  p.raster = rr === 'min' ? 'min' : rr === 'none' ? 'none' : 'auto';
  // `?canary=1` plants a deliberately over-budget 400-draw-call group so that
  // `budget.mjs` can be SHOWN exiting 1 and naming it. See PROOF 6.
  p.canary = bool01(q.get('canary'), 0) === 1;
  p.probe = bool01(q.get('probe'), DEFAULTS.probe) === 1;
  p.autostart = bool01(q.get('autostart'), DEFAULTS.autostart) === 1;
  const dprRaw = q.get('dpr');
  p.dpr = dprRaw === null || dprRaw === '' ? null : num(dprRaw, null);

  // In play mode the surface is the viewport, not a fixed capture size, unless the
  // caller explicitly asked for a size.
  if (p.mode === 'play' && typeof window !== 'undefined') {
    if (q.get('w') === null) p.w = window.innerWidth || DEFAULTS.w;
    if (q.get('h') === null) p.h = window.innerHeight || DEFAULTS.h;
  }

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
