// FOUNDATION — PERFCORE. The fixed-timestep simulation clock and the 60 Hz present pacer.
//
// This file imports NOTHING. No three.js, no DOM, no wall clock of its own. That is
// deliberate: `node scripts/simtest.mjs` imports it directly and steps ticks with no
// browser and no renderer, in ~2 s, and every timing window in the game is asserted
// against it.
//
// WHY THIS EXISTS
// ---------------
// The previous loop did `liveT += SIM_STEP * 2` once per rAF callback. That is
// frame-rate-dependent simulation: under load the world ran in slow motion and every
// timing window moved. For a game whose premise is "timing is critical" that is a
// foundational defect. Simulation time here is a function of a TICK COUNTER, never of
// how many times rAF happened to fire.
//
// THE TWO CLOCKS
//   SIM CLOCK   — TICK = 1/60 s exactly. Integer tick counter. The single source of
//                 truth for every timing window. Advanced only by whole steps.
//   PRESENT PACER — decides which vsyncs get a rendered frame, so the game presents at
//                 most 60 times a second on a 90/120/144 Hz panel.
// They are independent. On a 144 Hz panel the pacer presents ~48 times a second while
// the sim still advances exactly 60 ticks per second. Gameplay is identical.

/* ------------------------------------------------------------------ constants */

export const TICK_HZ = 60;
export const TICK = 1 / 60;                 // 0.016666666666666666 s
export const TICK_MS = 1000 / 60;           // 16.666666666666668 ms

/** Hard catch-up clamp. Beyond this, time is DROPPED — never spiralled. */
export const MAX_CATCHUP_STEPS = 3;

/** A single rAF delta larger than this is treated as a stall (tab restore, GC, etc). */
export const MAX_FRAME_DT_MS = 250;

/** Present period and the minimum interval the pacer will ever allow between frames. */
export const PRESENT_PERIOD_MS = 1000 / 60;
export const PRESENT_MIN_MS = PRESENT_PERIOD_MS - 1.0;   // 15.667 — jitter tolerance on a true 60 Hz panel

/* --------------------------------------------------------------------- clock */

/**
 * createClock({ tick, maxCatchup }) -> Clock
 *
 * USAGE IN THE FRAME LOOP (this is the only correct shape):
 *
 *   const n = clock.accumulate(dtSeconds);      // clamped, drops on overflow
 *   for (let i = 0; i < n; i++) {
 *     sim.step(clock.tick, TICK);               // <- sim sees the tick it is computing
 *     clock.commit();                           // tick++
 *   }
 *   render(clock.alpha);                        // alpha in [0,1) for interpolation
 *
 * `sim.step` must be a pure function of (state, tick). It must never read a wall clock.
 */
export function createClock(opts) {
  const step = (opts && opts.tick) || TICK;
  const maxCatchup = (opts && opts.maxCatchup) || MAX_CATCHUP_STEPS;

  let tick = 0;
  let acc = 0;              // seconds of unconsumed real time
  let pending = 0;          // steps handed out by accumulate() but not yet committed
  let droppedSteps = 0;     // steps that were thrown away by the catch-up clamp
  let dropEvents = 0;       // how many distinct times we hit the clamp
  let stalls = 0;           // dt readings clamped by MAX_FRAME_DT_MS

  const clock = {
    get tick() { return tick; },
    /** Simulated seconds. EXACTLY tick/60 — never a drifting float sum. */
    get simTime() { return tick * step; },
    /** Interpolation factor in [0,1) between the last committed tick and the next. */
    get alpha() { const a = acc / step; return a < 0 ? 0 : a > 1 ? 1 : a; },
    get accumulator() { return acc; },
    get droppedSteps() { return droppedSteps; },
    get dropEvents() { return dropEvents; },
    get stalls() { return stalls; },
    get step() { return step; },

    /**
     * Feed real elapsed time. Returns the number of fixed steps to run THIS frame.
     * Never returns more than maxCatchup. Excess time is DROPPED, which is what stops
     * the spiral of death: a 500 ms stall costs 3 steps and a discarded 450 ms, not a
     * 30-step burst that makes the next frame stall too.
     */
    accumulate(dtSeconds) {
      let dt = dtSeconds;
      if (!(dt > 0)) dt = 0;
      const maxDt = MAX_FRAME_DT_MS / 1000;
      if (dt > maxDt) { dt = maxDt; stalls++; }
      acc += dt;
      let n = (acc / step) | 0;
      if (n > maxCatchup) {
        const drop = n - maxCatchup;
        droppedSteps += drop;
        dropEvents++;
        acc -= drop * step;     // throw the excess away; do NOT carry it forward
        n = maxCatchup;
      }
      pending = n;
      return n;
    },

    /** Commit one step that the caller has just simulated. */
    commit() {
      if (pending <= 0) return tick;
      pending--;
      acc -= step;
      if (acc < 0) acc = 0;
      tick++;
      return tick;
    },

    /**
     * Headless: advance exactly n ticks with no wall clock at all. This is how
     * simtest.mjs runs the timing suites and how the capture path resolves `?t=`.
     */
    stepN(n, fn) {
      for (let i = 0; i < n; i++) {
        if (fn) fn(tick);
        tick++;
      }
      return tick;
    },

    /** Deterministic seek used by the CAPTURE path. Returns the tick landed on. */
    seekTo(seconds, fn) {
      const target = Math.round(seconds / step);
      if (target < tick) clock.reset();
      while (tick < target) { if (fn) fn(tick); tick++; }
      acc = 0;
      pending = 0;
      return tick;
    },

    reset() {
      tick = 0; acc = 0; pending = 0;
      droppedSteps = 0; dropEvents = 0; stalls = 0;
    },

    /** Which tick a wall-clock timestamp belongs to, for input->tick assignment. */
    tickForOffset(offsetSeconds) {
      const t = tick + Math.floor((acc + offsetSeconds) / step);
      return t < tick ? tick : t;
    },
  };
  return clock;
}

/* --------------------------------------------------------------------- pacer */

/**
 * createPacer() — the 60 Hz PRESENT CAP.
 *
 * Call `onVsync(nowMs)` from every rAF callback. It returns true when this vsync
 * should be rendered. Free-running at 144 Hz is a FAIL, not a bonus: it burns battery,
 * heats the phone into a thermal downclock, and makes pacing uneven.
 *
 * Two modes, chosen automatically after a short warmup:
 *   DIVISOR (median vsync >= 15.0 ms)  the panel is <= ~66 Hz and caps us itself:
 *                                      present every vsync.
 *   GATE    (median vsync <  15.0 ms)  a fast panel: present only when at least
 *                                      PRESENT_MIN_MS has elapsed since the last
 *                                      present. 120 Hz -> every 2nd (60 fps exactly).
 *                                      144 Hz -> every 3rd (48 fps, EVENLY paced).
 *
 * The 144 Hz case is deliberate and honest: 144 is not a multiple of 60, so the only
 * choices are uneven 60 or even 48. Even 48 keeps p01 >= 16 ms, which the contract
 * requires, and even pacing beats a higher-but-lumpy number.
 */
export function createPacer(opts) {
  const period = (opts && opts.period) || PRESENT_PERIOD_MS;
  const minInterval = (opts && opts.minInterval) || PRESENT_MIN_MS;
  const warmup = (opts && opts.warmup) || 16;
  const RING = 16;

  const deltas = new Float64Array(RING);
  const sorted = new Float64Array(RING);
  let ringN = 0, ringI = 0;
  let lastVsync = -1;
  let lastPresent = -1;
  let vsyncCount = 0;
  let presentCount = 0;
  let mode = 'warmup';
  let medianVsync = period;

  function median() {
    const n = ringN < RING ? ringN : RING;
    if (n === 0) return period;
    for (let i = 0; i < n; i++) sorted[i] = deltas[i];
    // insertion sort, n<=16, allocation-free
    for (let i = 1; i < n; i++) {
      const v = sorted[i];
      let j = i - 1;
      while (j >= 0 && sorted[j] > v) { sorted[j + 1] = sorted[j]; j--; }
      sorted[j + 1] = v;
    }
    return sorted[n >> 1];
  }

  const pacer = {
    get mode() { return mode; },
    get medianVsync() { return medianVsync; },
    get vsyncCount() { return vsyncCount; },
    get presentCount() { return presentCount; },
    /** Estimated panel refresh in Hz (informational). */
    get refreshHz() { return medianVsync > 0 ? 1000 / medianVsync : 60; },

    onVsync(nowMs) {
      vsyncCount++;
      if (lastVsync >= 0) {
        const d = nowMs - lastVsync;
        if (d > 0 && d < 100) { deltas[ringI] = d; ringI = (ringI + 1) % RING; ringN++; }
      }
      lastVsync = nowMs;

      if (vsyncCount <= warmup) {
        // During warmup present every vsync so the first frames are not stuttery.
        lastPresent = nowMs;
        presentCount++;
        return true;
      }
      if (mode === 'warmup') {
        medianVsync = median();
        mode = medianVsync >= 15.0 ? 'divisor' : 'gate';
      } else if ((vsyncCount & 63) === 0) {
        // Re-check occasionally: a window can move to a different display.
        medianVsync = median();
        const want = medianVsync >= 15.0 ? 'divisor' : 'gate';
        if (want !== mode) { mode = want; lastPresent = nowMs - period; }
      }

      if (mode === 'divisor') { lastPresent = nowMs; presentCount++; return true; }

      if (lastPresent < 0 || nowMs - lastPresent >= minInterval) {
        lastPresent = nowMs;
        presentCount++;
        return true;
      }
      return false;
    },

    reset() {
      ringN = 0; ringI = 0; lastVsync = -1; lastPresent = -1;
      vsyncCount = 0; presentCount = 0; mode = 'warmup'; medianVsync = period;
    },
  };
  return pacer;
}

export default { TICK, TICK_MS, TICK_HZ, MAX_CATCHUP_STEPS, createClock, createPacer };
