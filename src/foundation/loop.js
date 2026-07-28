// FOUNDATION — PERFCORE. The frame loop.
//
// THE FRAME WALL, PER RATE:
//   60 Hz  period 16.667 ms  main-thread wall 13.00 ms  slack 3.67 ms
//   30 Hz  period 33.333 ms  main-thread wall 30.00 ms  slack 3.33 ms
//   PINNED — total main-thread work <= the wall. The slack is inviolable: it belongs to
//            browser compositing, style/layout, GC and OS scheduling. Budgeting the
//            whole period is how you ship a stutter.
//   CAPPED — never more than 60 presents per second, at either rate. On a 90/120/144 Hz
//            panel we present every 2nd/3rd vsync. Free-running at 144 Hz is a FAIL.
//
// FRAME ORDER (fixed; every subsystem is measured into its own named span):
//   0  pacer decides whether this vsync is presented at all
//   1  SIM-A     clock.accumulate(dt) -> how many fixed steps this frame owes
//   2  INPUT     drain the timestamped touch queue; each event is bound to the sim TICK
//                its own timestamp falls in, inside this frame's pending step range
//   3  SIM-B     run those fixed steps; each step sees only its own tick's input
//   4  ANIM      pose / skinning, at clock.alpha
//   5  FX        particle update
//   6  CAMERA    camera + culling + LOD select
//   7  RENDERJS  the JS half of render dispatch
//   8  OVERLAY   Canvas2D HUD
//   9  AUDIO     mixer poll
//  10  SCALER    one O(1) sample; a rung change at most every 3 s, a rate change 10 s
//
// WHY INPUT SITS BETWEEN TWO SIM SPANS. `clock.tickForStamp()` can only place an event
// on one of this frame's pending steps once `accumulate()` has decided how many there
// are. Draining before that would quantise every input to the PRESENT rate, which at
// 30 Hz would halve the effective timing resolution of a game whose premise is that
// timing is critical. Both halves are billed to the `sim` span, so the budget line is
// unchanged and the ordering costs nothing.
//
// ZERO ALLOCATION. Nothing in `frame()` allocates: no closures, no array literals, no
// object literals, no string concatenation. Hooks are bound once at construction.

import { createClock, createPacer, TICK, MAX_FRAME_DT_MS, rateSpec } from './clock.js';
import {
  S_INPUT, S_SIM, S_ANIM, S_FX, S_CAMERA, S_RENDERJS, S_OVERLAY, S_AUDIO, S_SCALER,
} from './telemetry.js';

export function createLoop(opts) {
  const o = opts || {};
  const clock = o.clock || createClock();
  const startRate = o.rate === 30 ? 30 : 60;
  const pacer = o.pacer || createPacer({ rate: startRate });
  const tel = o.telemetry;
  const scaler = o.scaler || null;

  // Hooks bound once. A missing hook costs one null check, not a closure.
  const hInput = o.onInput || null;       // (nowMs, clock) — drain the raw bus
  const hStep = o.onStep || null;         // (tick, dt) — the FIXED-STEP sim. Pure.
  const hAnim = o.onAnim || null;         // (alpha, simTime)
  const hFx = o.onFx || null;
  const hCamera = o.onCamera || null;
  const hRender = o.onRender || null;
  const hOverlay = o.onOverlay || null;
  const hAudio = o.onAudio || null;
  const hFrameEnd = o.onFrameEnd || null;
  const hRate = o.onRate || null;         // (newRate, oldRate) — presenter changed rate

  const warmupFrames = o.warmupFrames !== undefined ? o.warmupFrames : 120;
  const heapEvery = o.heapEvery || 30;

  let rafId = 0;
  let running = false;
  let lastPresentMs = -1;
  let presented = 0;
  let stallMs = 0;              // one-shot injected stall, for the no-spiral proof
  let stallAt = -1;
  let paused = false;
  let rate = startRate;

  clock.setRateSteps(rate);
  if (tel) tel.setRate(rate);

  const state = {
    clock, pacer, telemetry: tel, scaler,
    get running() { return running; },
    get presentedFrames() { return presented; },
    get tick() { return clock.tick; },
    get rate() { return rate; },
    get periodMs() { return rateSpec(rate).periodMs; },
    get wallMs() { return rateSpec(rate).wallMs; },
    lastDtMs: 0,
    lastSteps: 0,
    totalSteps: 0,
  };

  /**
   * Change present rate. Called by the scaler (and by the harness). Retunes the pacer,
   * the catch-up clamp and the telemetry's per-frame rate tag together — they must
   * never disagree, or the budget a frame is judged against stops matching the period
   * it was actually given.
   */
  function setRate(r) {
    const next = r === 30 ? 30 : 60;
    if (next === rate) return false;
    const from = rate;
    rate = next;
    pacer.setRate(next);
    clock.setRateSteps(next);
    if (tel) tel.setRate(next);
    if (hRate) hRate(next, from);
    return true;
  }

  function frame(nowMs) {
    rafId = requestAnimationFrame(frame);
    if (!pacer.onVsync(nowMs)) return;       // a skipped vsync costs literally nothing
    if (paused) { lastPresentMs = nowMs; return; }

    if (tel) tel.frameStart(nowMs);

    const period = rateSpec(rate).periodMs;
    const dtMs = lastPresentMs < 0 ? period : (nowMs - lastPresentMs);
    lastPresentMs = nowMs;
    state.lastDtMs = dtMs;

    // --- injected stall (test instrument only; never armed in a shipping run) ------
    if (stallMs > 0 && presented === stallAt) {
      const until = performance.now() + stallMs;
      while (performance.now() < until) { /* deliberately block the main thread */ }
      stallMs = 0;
    }

    // 1 SIM-A: decide how many fixed steps this frame owes ------------------------
    if (tel) tel.begin(S_SIM);
    const n = clock.accumulate(dtMs / 1000, nowMs);
    state.lastSteps = n;
    if (tel) tel.end(S_SIM);

    // 2 INPUT: drain, binding each event to the tick its timestamp falls in -------
    if (tel) tel.begin(S_INPUT);
    if (hInput) hInput(nowMs, clock);
    if (tel) tel.end(S_INPUT);

    // 3 SIM-B: run the steps. Each step sees only its own tick's input ------------
    if (tel) tel.begin(S_SIM);
    for (let i = 0; i < n; i++) {
      if (hStep) hStep(clock.tick, TICK);
      clock.commit();
      state.totalSteps++;
    }
    if (tel) tel.end(S_SIM);

    const alpha = clock.alpha;
    const simTime = clock.simTime;

    // 4 ANIM ---------------------------------------------------------------------
    if (tel) tel.begin(S_ANIM);
    if (hAnim) hAnim(alpha, simTime);
    if (tel) tel.end(S_ANIM);

    // 5 FX -----------------------------------------------------------------------
    if (tel) tel.begin(S_FX);
    if (hFx) hFx(alpha, simTime);
    if (tel) tel.end(S_FX);

    // 6 CAMERA + CULL + LOD ------------------------------------------------------
    if (tel) tel.begin(S_CAMERA);
    if (hCamera) hCamera(alpha, simTime);
    if (tel) tel.end(S_CAMERA);

    // 7 RENDER -------------------------------------------------------------------
    if (tel) tel.begin(S_RENDERJS);
    if (hRender) hRender(alpha, simTime);
    if (tel) tel.end(S_RENDERJS);

    // 8 OVERLAY ------------------------------------------------------------------
    if (tel) tel.begin(S_OVERLAY);
    if (hOverlay) hOverlay(alpha, simTime);
    if (tel) tel.end(S_OVERLAY);

    // 9 AUDIO --------------------------------------------------------------------
    if (tel) tel.begin(S_AUDIO);
    if (hAudio) hAudio(alpha, simTime);
    if (tel) tel.end(S_AUDIO);

    // 10 SCALER ------------------------------------------------------------------
    if (tel) tel.begin(S_SCALER);
    if (scaler && presented > 8) {
      // CPU sample excludes the scaler's own span (it is measured, just not yet ended).
      scaler.sample(nowMs, dtMs, tel ? tel.frameCpuSoFar() : 0);
    }
    if (tel) tel.end(S_SCALER);

    presented++;
    if (tel) {
      tel.frameEnd(clock.tick, performance.now());
      if (presented === warmupFrames) tel.markWarmupEnd();
      if ((presented % heapEvery) === 0) tel.sampleHeap();
    }
    if (hFrameEnd) hFrameEnd(presented, nowMs);
  }

  return Object.assign(state, {
    setRate,
    start() {
      if (running) return;
      running = true;
      lastPresentMs = -1;
      if (tel) tel.startLongTaskObserver();
      rafId = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
    },
    pause(v) { paused = !!v; },
    /** Test instrument: block the main thread for `ms` on frame `atFrame`. */
    injectStall(ms, atFrame) { stallMs = ms; stallAt = atFrame === undefined ? presented + 1 : atFrame; },
    /** Reset pacing state without touching the sim clock (used after a mode switch). */
    resyncPacing() { lastPresentMs = -1; pacer.reset(); },
    MAX_FRAME_DT_MS,
  });
}

export default { createLoop };
