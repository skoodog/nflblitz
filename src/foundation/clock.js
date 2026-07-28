// FOUNDATION — PERFCORE. The fixed-timestep simulation clock and the present pacer.
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
// THE TWO CLOCKS — AND THE RATE AXIS
//   SIM CLOCK   — TICK = 1/60 s EXACTLY, ALWAYS, ON EVERY DEVICE AND AT EVERY PRESENT
//                 RATE. Integer tick counter. The single source of truth for every
//                 timing window. This is what makes gameplay bit-identical at 60 and
//                 at 30: the sim does not know or care what the present rate is.
//   PRESENT PACER — decides which vsyncs get a rendered frame. It has a TARGET RATE of
//                 60 or 30 Hz. 60 is the CAP and is never exceeded; 30 is a first-class
//                 shipping mode, not a failure state.
//
// At 30 Hz present on a 60 Hz panel the pacer presents every 2nd vsync and the sim runs
// exactly 2 ticks per presented frame. Same game, same windows, half the frames.

/* ------------------------------------------------------------------ constants */

export const TICK_HZ = 60;
export const TICK = 1 / 60;                 // 0.016666666666666666 s
export const TICK_MS = 1000 / 60;           // 16.666666666666668 ms

/** A single rAF delta larger than this is treated as a stall (tab restore, GC, etc). */
export const MAX_FRAME_DT_MS = 250;

/**
 * Boundary epsilon, in seconds. One nanosecond — six orders of magnitude below
 * anything that matters to a player, and it exists for a specific, measured reason.
 *
 * 1000/30 ms expressed in seconds is 0.03333333333333333, and TICK is
 * 0.016666666666666666. Their quotient in IEEE-754 double is 1.9999999999999998, not 2.
 * Truncating that gives ONE step where two are owed, so at a steady 30 Hz the
 * accumulator alternates 1,3,1,3... instead of 2,2,2,2 and every input bound by
 * timestamp lands a tick early or late at random. The same truncation puts an event
 * stamped exactly on a tick boundary on the wrong side of it.
 *
 * This was caught by `simtest.mjs --suite=rate`, which compares the sim's results at
 * 60/45/30 Hz and failed with `juke@12` at 60 Hz against `juke@11` at 30 Hz.
 */
const EPS = 1e-9;

/** The two legal present rates. 60 is the CAP; 30 is a first-class shipping mode. */
export const RATES = Object.freeze([60, 30]);

/**
 * Per-rate frame wall and CPU budget scaling.
 *
 *   60 Hz — period 16.667 ms, main-thread wall 13.00 ms, 3.67 ms inviolable slack.
 *   30 Hz — period 33.333 ms, main-thread wall 30.00 ms, 3.33 ms inviolable slack.
 *
 * NOTE ON THE 30 Hz WALL, stated plainly because the numbers do not agree with each
 * other in the amendment that ordered them. The amendment says the 30 Hz wall is
 * "30.0 ms (of the 33.33 ms period), keeping the same proportional slack". Those are
 * two different instructions: 13.00/16.667 is 78% of the period, while 30.00/33.333 is
 * 90%. Proportional slack would have given a 26.0 ms wall. We implement the EXPLICIT
 * NUMBER (30.0 ms), because it is the one the amendment actually states and because
 * the slack it reserves — 3.33 ms — is very close to the 3.67 ms reserved at 60, and
 * compositor/GC/OS cost is an absolute cost per frame, not a proportional one. So the
 * honest description is "the same ABSOLUTE slack", and that is what is implemented.
 */
export const RATE_SPEC = Object.freeze({
  60: Object.freeze({
    rate: 60, periodMs: 1000 / 60, wallMs: 13.00, slackMs: 1000 / 60 - 13.00,
    budgetScale: 1.0, stepsPerPresent: 1, maxCatchup: 3,
  }),
  30: Object.freeze({
    rate: 30, periodMs: 1000 / 30, wallMs: 30.00, slackMs: 1000 / 30 - 30.00,
    budgetScale: 30.00 / 13.00, stepsPerPresent: 2, maxCatchup: 4,
  }),
});

export function rateSpec(rate) { return RATE_SPEC[rate] || RATE_SPEC[60]; }

/**
 * Pacing targets, re-expressed against the ACTIVE period. Identical in shape at both
 * rates — the amendment relaxed the RATE, not the EVENNESS.
 *
 *   p50    period +/- 0.5 ms
 *   p95    <= period * 1.05
 *   p99    <= period * 1.20
 *   worst  <= period * 2      (at most ONE dropped present, ever)
 *   p01    >= period * 0.96   (the CAP: never present faster than the active rate)
 *   drops  a frame whose interval exceeds period * 1.2; <= 0.5% of frames
 *   longtask > 20 ms after warmup: ZERO, at BOTH rates (this one is absolute — a 20 ms
 *            main-thread block is a hitch whatever the present period is)
 *
 * At 60 these evaluate to exactly the numbers the original contract listed:
 *   p50 16.7+/-0.5, p95 17.5, p99 20.0, worst 33.3, p01 16.0, drop 20.0.
 */
export function pacingTargets(rate) {
  const p = rateSpec(rate).periodMs;
  return {
    rate, periodMs: p,
    p50: p, p50Tol: 0.5,
    p95: p * 1.05,
    p99: p * 1.20,
    worst: p * 2.0,
    p01Min: p * 0.96,
    dropMs: p * 1.20,
    dropPct: 0.5,
    longtaskMs: 20.0,
  };
}

/* --------------------------------------------------------------------- clock */

/**
 * createClock({ tick, maxCatchup }) -> Clock
 *
 * USAGE IN THE FRAME LOOP (this is the only correct shape):
 *
 *   const n = clock.accumulate(dtSeconds, nowMs);  // clamped, drops on overflow
 *   input.drain(nowMs, clock, tel);                // events land on ticks in [tick, tick+n)
 *   for (let i = 0; i < n; i++) {
 *     sim.step(clock.tick, TICK);                  // <- sim sees the tick it is computing
 *     clock.commit();                              // tick++
 *   }
 *   render(clock.alpha);                           // alpha in [0,1) for interpolation
 *
 * `sim.step` must be a pure function of (state, tick). It must never read a wall clock.
 */
export function createClock(opts) {
  const step = (opts && opts.tick) || TICK;
  const stepMs = step * 1000;
  let maxCatchup = (opts && opts.maxCatchup) || RATE_SPEC[60].maxCatchup;

  let tick = 0;
  let acc = 0;              // seconds of unconsumed real time
  let pending = 0;          // steps handed out by accumulate() but not yet committed
  let droppedSteps = 0;     // steps that were thrown away by the catch-up clamp
  let dropEvents = 0;       // how many distinct times we hit the clamp
  let stalls = 0;           // dt readings clamped by MAX_FRAME_DT_MS
  // Wall-clock timestamp of the boundary of the CURRENT tick. This is the anchor that
  // lets an input event be assigned to the sim tick its own timestamp falls in.
  let tickWallMs = -1;

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
    get pending() { return pending; },
    get maxCatchup() { return maxCatchup; },
    get tickWallMs() { return tickWallMs; },

    /**
     * The catch-up clamp scales with the present rate: a 30 Hz frame legitimately owes
     * 2 steps, so clamping at 3 would start DROPPING time during correct operation.
     * The clamp is always "what this rate owes, plus 2".
     */
    setMaxCatchup(n) { maxCatchup = n > 1 ? n | 0 : 1; },
    setRateSteps(rate) { maxCatchup = rateSpec(rate).maxCatchup; },

    /**
     * Feed real elapsed time. Returns the number of fixed steps to run THIS frame.
     * Never returns more than maxCatchup. Excess time is DROPPED, which is what stops
     * the spiral of death: a 500 ms stall costs at most maxCatchup steps and a
     * discarded remainder, not a 30-step burst that makes the next frame stall too.
     *
     * `nowMs` is optional and only feeds the input->tick anchor.
     */
    accumulate(dtSeconds, nowMs) {
      let dt = dtSeconds;
      if (!(dt > 0)) dt = 0;
      const maxDt = MAX_FRAME_DT_MS / 1000;
      if (dt > maxDt) { dt = maxDt; stalls++; }
      acc += dt;
      let n = ((acc + EPS) / step) | 0;
      if (n > maxCatchup) {
        const drop = n - maxCatchup;
        droppedSteps += drop;
        dropEvents++;
        acc -= drop * step;     // throw the excess away; do NOT carry it forward
        n = maxCatchup;
      }
      pending = n;
      // The boundary of the current tick sits `acc` seconds in the past from `nowMs`.
      if (nowMs !== undefined) tickWallMs = nowMs - acc * 1000;
      return n;
    },

    /** Commit one step that the caller has just simulated. */
    commit() {
      if (pending <= 0) return tick;
      pending--;
      acc -= step;
      if (acc < 0) acc = 0;
      tick++;
      if (tickWallMs >= 0) tickWallMs += stepMs;
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
      droppedSteps = 0; dropEvents = 0; stalls = 0; tickWallMs = -1;
    },

    /**
     * THE INPUT DECOUPLING PRIMITIVE — this is what makes 30 Hz honest for a
     * timing-critical game.
     *
     * Which sim tick does a raw event timestamped `evMs` belong to? NOT "the tick of
     * the frame that happened to drain it" — that would quantise input to the PRESENT
     * rate and double the effective input granularity at 30 Hz. Instead the event is
     * placed on the tick whose wall-clock span contains its own timestamp, and clamped
     * into the steps this frame is actually about to run.
     *
     * At 30 Hz a frame runs ticks T and T+1. An event stamped in the first 16.7 ms of
     * that 33.3 ms window lands on T; one stamped in the second half lands on T+1. So a
     * juke window is still judged at 60 Hz granularity while only 30 frames are drawn.
     */
    tickForStamp(evMs) {
      if (tickWallMs < 0 || !(evMs > 0)) return tick;
      const t = tick + Math.floor((evMs - tickWallMs) / stepMs + EPS * 1000);
      // Lower clamp only. An event older than this frame's span is applied to the
      // oldest tick we are about to simulate — we cannot rewrite history.
      return t < tick ? tick : t;
    },

    /**
     * The last sim tick this frame is going to simulate, or `tick - 1` when the frame
     * owes no steps at all.
     *
     * An event whose `tickForStamp` lands ABOVE this belongs to a tick that has not
     * happened yet, and the ONLY correct response is to leave it in the queue for the
     * next frame. It must not be clamped down into the current frame: that would apply
     * an input EARLIER than the player actually made it, which is precisely the kind of
     * silent timing lie this whole design exists to prevent. It showed up as a real
     * divergence — `simtest.mjs --suite=rate` reported the same 200 ms input landing on
     * tick 12 at 60 Hz and tick 11 at 30 Hz — and deferral is what makes the two agree.
     */
    get lastPendingTick() { return pending > 0 ? tick + pending - 1 : tick - 1; },

    /** Legacy alias used by the touch bus: offset in SECONDS relative to now. */
    tickForOffset(offsetSeconds) {
      if (tickWallMs < 0) return tick;
      return clock.tickForStamp(tickWallMs + acc * 1000 + offsetSeconds * 1000);
    },
  };
  return clock;
}

/* --------------------------------------------------------------------- pacer */

/**
 * createPacer({ rate }) — the PRESENT CAP and the PRESENT PIN.
 *
 * Call `onVsync(nowMs)` from every rAF callback. It returns true when this vsync should
 * be rendered.
 *
 * TWO GATES, both must pass. Belt and braces, because either one alone has a failure
 * mode that shows up as visible judder:
 *
 *   1. DIVISOR — present on every Nth vsync, where N is derived from the measured panel
 *      refresh and the target rate. This is what produces EVEN pacing: on a 60 Hz panel
 *      targeting 30, N=2 gives exactly 33.3 ms every time. A pure time gate would give
 *      an uneven 33.3/16.7/50 pattern as it drifted across the vsync boundary.
 *   2. TIME GATE — additionally require `period - tolerance` of wall time since the last
 *      present. This catches an irregular or lying vsync source and hard-enforces the
 *      CAP: we can never present faster than the target rate even if rAF misbehaves.
 *
 * N = ceil(panelHz / rate - epsilon), never less than 1. The ceil (not round) is what
 * enforces the cap on a 144 Hz panel: 144/60 = 2.4, and rounding to 2 would present at
 * 72 Hz, which is a CAP VIOLATION. Ceil gives 3 -> an even 48 Hz. That is deliberate
 * and it is the honest trade: 144 is not a multiple of 60, so the only choices are an
 * uneven 60 or an even 48, and even pacing beats a higher lumpy number every time.
 */
export function createPacer(opts) {
  const o = opts || {};
  const warmup = o.warmup !== undefined ? o.warmup : 16;
  const RING = 16;
  const TOL_MS = 1.0;

  let rate = o.rate === 30 ? 30 : 60;
  let period = rateSpec(rate).periodMs;

  const deltas = new Float64Array(RING);
  const sorted = new Float64Array(RING);
  let ringN = 0, ringI = 0;
  let lastVsync = -1;
  let lastPresent = -1;
  let vsyncCount = 0;
  let presentCount = 0;
  let sinceLastPresent = 0;
  let divisor = 1;
  let medianVsync = 1000 / 60;
  let locked = false;

  function median() {
    const n = ringN < RING ? ringN : RING;
    if (n === 0) return 1000 / 60;
    for (let i = 0; i < n; i++) sorted[i] = deltas[i];
    for (let i = 1; i < n; i++) {                 // insertion sort, n<=16, no allocation
      const v = sorted[i];
      let j = i - 1;
      while (j >= 0 && sorted[j] > v) { sorted[j + 1] = sorted[j]; j--; }
      sorted[j + 1] = v;
    }
    return sorted[n >> 1];
  }

  function recomputeDivisor() {
    medianVsync = median();
    const panelHz = medianVsync > 0 ? 1000 / medianVsync : 60;
    let n = Math.ceil(panelHz / rate - 0.02);
    if (!(n >= 1)) n = 1;
    if (n > 8) n = 8;
    divisor = n;
  }

  const pacer = {
    get rate() { return rate; },
    get periodMs() { return period; },
    get divisor() { return divisor; },
    get medianVsync() { return medianVsync; },
    get refreshHz() { return medianVsync > 0 ? 1000 / medianVsync : 60; },
    get vsyncCount() { return vsyncCount; },
    get presentCount() { return presentCount; },
    get locked() { return locked; },
    set locked(v) { locked = !!v; },

    /** Change the target present rate. Re-derives the divisor immediately. */
    setRate(r) {
      const next = r === 30 ? 30 : 60;
      if (next === rate) return false;
      rate = next;
      period = rateSpec(rate).periodMs;
      recomputeDivisor();
      // Do not force an immediate present: let the new cadence start cleanly from the
      // last present, so the rate change itself costs at most one uneven interval.
      sinceLastPresent = 0;
      return true;
    },

    onVsync(nowMs) {
      vsyncCount++;
      if (lastVsync >= 0) {
        const d = nowMs - lastVsync;
        if (d > 0 && d < 100) { deltas[ringI] = d; ringI = (ringI + 1) % RING; ringN++; }
      }
      lastVsync = nowMs;
      sinceLastPresent++;

      if (vsyncCount <= warmup) {
        lastPresent = nowMs; presentCount++; sinceLastPresent = 0;
        return true;
      }
      if (vsyncCount === warmup + 1 || (vsyncCount & 63) === 0) recomputeDivisor();

      if (sinceLastPresent < divisor) return false;
      if (lastPresent >= 0 && (nowMs - lastPresent) < period - TOL_MS) return false;

      lastPresent = nowMs;
      presentCount++;
      sinceLastPresent = 0;
      return true;
    },

    reset() {
      ringN = 0; ringI = 0; lastVsync = -1; lastPresent = -1;
      vsyncCount = 0; presentCount = 0; sinceLastPresent = 0;
      divisor = 1; medianVsync = 1000 / 60;
    },
  };
  recomputeDivisor();
  return pacer;
}

export default {
  TICK, TICK_MS, TICK_HZ, MAX_FRAME_DT_MS, RATES, RATE_SPEC,
  rateSpec, pacingTargets, createClock, createPacer,
};
