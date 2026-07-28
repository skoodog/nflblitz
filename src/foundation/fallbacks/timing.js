// FOUNDATION FALLBACK — replaced by piece `play-sim` via registerTiming().
//
// THE TICK-EXACT TIMING MODEL. Every action window in the game is defined in TICKS,
// never in seconds and never in frames. TICK = 1/60 s exactly, so a window is the same
// duration on a 60 Hz phone, a 144 Hz tablet, and a device that is dropping frames.
//
// This file imports NOTHING and touches no DOM, no renderer and no wall clock. That is
// what lets `node scripts/simtest.mjs` assert, reproducibly and in ~2 s:
//     "input at t=1.000s lands the window, t=1.084s lands, t=1.184s misses"
//
// WINDOW SEMANTICS
//   arm(action, tick)        a cue fires (defender enters range, ball is catchable...)
//   open  = armTick + spec.open
//   close = armTick + spec.close          <- INCLUSIVE
//   duration = close - open ticks         <- so juke reads "12 ticks, 200.0 ms"
//   PERFECT sub-window [perfect0, perfect1] inclusive, scores higher
//   after close, the window LAPSES; a further attempt is LATE, not a free retry
//   cooldown ticks after any attempt, during which attempts return COOLDOWN

export const TICK = 1 / 60;

export const RESULT = Object.freeze({
  MISS: 'MISS', LAND: 'LAND', PERFECT: 'PERFECT',
  EARLY: 'EARLY', LATE: 'LATE', COOLDOWN: 'COOLDOWN', UNARMED: 'UNARMED',
});

/**
 * offsets are in TICKS from the arm tick.
 * `juke` is the reference window quoted in the contract: opens +8, closes +20 from an
 * arm at tick 50 -> opens 58, closes 70, 12 ticks, 200.0 ms.
 */
export const WINDOWS = Object.freeze({
  juke: { open: 8, close: 20, perfect0: 12, perfect1: 15, cooldown: 24, note: 'sidestep a closing defender' },
  spin: { open: 6, close: 20, perfect0: 10, perfect1: 14, cooldown: 30, note: '360 out of a wrap' },
  stiffArm: { open: 4, close: 16, perfect0: 7, perfect1: 10, cooldown: 20, note: 'extend into the tackler' },
  dive: { open: 2, close: 26, perfect0: 8, perfect1: 16, cooldown: 36, note: 'lay out for the marker' },
  hitStick: { open: 5, close: 14, perfect0: 8, perfect1: 10, cooldown: 40, note: 'defender launch' },
  catch: { open: 3, close: 21, perfect0: 9, perfect1: 13, cooldown: 12, note: 'hands on the ball' },
  passLead: { open: 0, close: 30, perfect0: 6, perfect1: 18, cooldown: 8, note: 'lead the receiver' },
  turbo: { open: 0, close: 6, perfect0: 0, perfect1: 2, cooldown: 6, note: 'burst off the snap' },
});

export const ACTIONS = Object.freeze(Object.keys(WINDOWS));

const impl = {
  piece: 'foundation-fallback',
  TICK, RESULT, WINDOWS, ACTIONS,

  /** Pure state. No closures over time, no wall clock. */
  create() {
    const armed = Object.create(null);
    const cooldown = Object.create(null);
    const lapsed = Object.create(null);
    for (const a of ACTIONS) { armed[a] = -1; cooldown[a] = 0; lapsed[a] = false; }
    return { armed, cooldown, lapsed, tick: 0, lastResult: null, lastAction: null, lastOffset: 0, score: 0 };
  },

  /** Which tick a wall-clock-free time in seconds maps to. floor, never round. */
  tickAt(seconds) { return Math.floor(seconds * 60 + 1e-9); },

  /** The absolute tick window for an action armed at `armTick`. */
  windowFor(action, armTick) {
    const w = WINDOWS[action];
    if (!w) return null;
    const at = armTick === undefined ? 0 : armTick;
    return {
      action, armTick: at,
      open: at + w.open, close: at + w.close,
      perfect0: at + w.perfect0, perfect1: at + w.perfect1,
      ticks: w.close - w.open, ms: (w.close - w.open) * (1000 / 60),
    };
  },

  arm(state, action, tick) {
    if (!WINDOWS[action]) return false;
    state.armed[action] = tick;
    state.lapsed[action] = false;
    return true;
  },

  disarm(state, action) { state.armed[action] = -1; state.lapsed[action] = false; },

  /**
   * attempt(state, action, tick) -> RESULT. Pure: same (state, action, tick) always
   * gives the same answer. This is the function every timing assertion tests.
   */
  attempt(state, action, tick) {
    const w = WINDOWS[action];
    if (!w) return RESULT.UNARMED;
    if (state.cooldown[action] > 0) { state.lastResult = RESULT.COOLDOWN; state.lastAction = action; return RESULT.COOLDOWN; }
    const armTick = state.armed[action];
    if (armTick < 0) { state.lastResult = RESULT.UNARMED; state.lastAction = action; return RESULT.UNARMED; }

    const open = armTick + w.open;
    const close = armTick + w.close;
    let r;
    if (tick < open) r = RESULT.EARLY;
    else if (tick > close) r = RESULT.LATE;
    else if (tick >= armTick + w.perfect0 && tick <= armTick + w.perfect1) r = RESULT.PERFECT;
    else r = RESULT.LAND;

    state.lastResult = r;
    state.lastAction = action;
    state.lastOffset = tick - open;
    state.cooldown[action] = w.cooldown;
    if (r === RESULT.PERFECT) state.score += 2;
    else if (r === RESULT.LAND) state.score += 1;
    if (r !== RESULT.EARLY) { state.armed[action] = -1; state.lapsed[action] = true; }
    return r;
  },

  /** Advance one tick. Expires lapsed windows and burns cooldowns. */
  step(state, tick) {
    state.tick = tick;
    for (let i = 0; i < ACTIONS.length; i++) {
      const a = ACTIONS[i];
      if (state.cooldown[a] > 0) state.cooldown[a]--;
      const armTick = state.armed[a];
      if (armTick >= 0 && tick > armTick + WINDOWS[a].close) {
        state.armed[a] = -1;
        state.lapsed[a] = true;
      }
    }
  },

  /** 0..1 progress through the open window, for a HUD ring. Pure function of tick. */
  progress(state, action, tick) {
    const armTick = state.armed[action];
    if (armTick < 0) return -1;
    const w = WINDOWS[action];
    const open = armTick + w.open, close = armTick + w.close;
    if (tick < open) return 0;
    if (tick > close) return 1;
    return (tick - open) / Math.max(1, close - open);
  },

  /** Deterministic state hash, for the 10,000-replay determinism suite. */
  hash(state) {
    let h = 2166136261 >>> 0;
    const mix = (v) => { h ^= (v | 0) >>> 0; h = Math.imul(h, 16777619) >>> 0; };
    mix(state.tick); mix(state.score);
    for (let i = 0; i < ACTIONS.length; i++) {
      const a = ACTIONS[i];
      mix(state.armed[a]); mix(state.cooldown[a]); mix(state.lapsed[a] ? 1 : 0);
    }
    return h >>> 0;
  },

  applyRung() { /* timing NEVER scales. Every tier plays exactly the same game. */ },
};

export default impl;
