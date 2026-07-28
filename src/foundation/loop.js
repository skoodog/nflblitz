// FOUNDATION — PERFCORE. The frame loop.
//
// THE FRAME WALL: 16.667 ms, PINNED and CAPPED.
//   PINNED — total main-thread work <= 13.00 ms. The remaining 3.67 ms is inviolable
//            slack for browser compositing, style/layout, GC and OS scheduling.
//            Budgeting 16.67 of 16.67 is how you ship a stutter.
//   CAPPED — at most 60 presents per second. On a 90/120/144 Hz panel we render every
//            2nd/3rd vsync. Free-running at 144 Hz is a FAIL, not a bonus.
//
// FRAME ORDER (fixed; every subsystem is measured into its own named span):
//   0  pacer decides whether this vsync is presented at all
//   1  INPUT     drain the timestamped touch queue -> resolve the controller
//   2  SIM       clock.accumulate(dt) fixed steps, clamped at 3, excess DROPPED
//   3  ANIM      pose / skinning, at clock.alpha
//   4  FX        particle update
//   5  CAMERA    camera + culling + LOD select
//   6  RENDERJS  the JS half of render dispatch
//   7  OVERLAY   Canvas2D HUD
//   8  AUDIO     mixer poll
//   9  SCALER    one O(1) sample; a rung change at most every 3 s
//
// ZERO ALLOCATION. Nothing in `frame()` allocates: no closures, no array literals, no
// object literals, no string concatenation. Hooks are bound once at construction.

import { createClock, createPacer, TICK, MAX_FRAME_DT_MS } from './clock.js';
import { S_INPUT, S_SIM, S_ANIM, S_FX, S_CAMERA, S_RENDERJS, S_OVERLAY, S_AUDIO, S_SCALER } from './telemetry.js';

export function createLoop(opts) {
  const o = opts || {};
  const clock = o.clock || createClock();
  const pacer = o.pacer || createPacer();
  const tel = o.telemetry;
  const scaler = o.scaler || null;

  // Hooks bound once. A missing hook costs one null check, not a closure.
  const hInput = o.onInput || null;
  const hStep = o.onStep || null;         // (tick, dt) — the FIXED-STEP sim. Pure.
  const hAnim = o.onAnim || null;         // (alpha, simTime)
  const hFx = o.onFx || null;
  const hCamera = o.onCamera || null;
  const hRender = o.onRender || null;
  const hOverlay = o.onOverlay || null;
  const hAudio = o.onAudio || null;
  const hFrameEnd = o.onFrameEnd || null;

  const warmupFrames = o.warmupFrames !== undefined ? o.warmupFrames : 120;
  const heapEvery = o.heapEvery || 30;

  let rafId = 0;
  let running = false;
  let lastPresentMs = -1;
  let presented = 0;
  let stallMs = 0;              // one-shot injected stall, for the no-spiral proof
  let stallAt = -1;
  let paused = false;

  const state = {
    clock, pacer, telemetry: tel, scaler,
    get running() { return running; },
    get presentedFrames() { return presented; },
    get tick() { return clock.tick; },
    lastDtMs: 0,
    lastSteps: 0,
    totalSteps: 0,
  };

  function frame(nowMs) {
    rafId = requestAnimationFrame(frame);
    if (!pacer.onVsync(nowMs)) return;       // a skipped vsync costs literally nothing
    if (paused) { lastPresentMs = nowMs; return; }

    if (tel) tel.frameStart(nowMs);

    const dtMs = lastPresentMs < 0 ? (1000 / 60) : (nowMs - lastPresentMs);
    lastPresentMs = nowMs;
    state.lastDtMs = dtMs;

    // --- injected stall (test instrument only; never armed in a shipping run) ------
    if (stallMs > 0 && presented === stallAt) {
      const until = performance.now() + stallMs;
      while (performance.now() < until) { /* deliberately block the main thread */ }
      stallMs = 0;
    }

    // 1 INPUT --------------------------------------------------------------------
    if (tel) tel.begin(S_INPUT);
    if (hInput) hInput(nowMs, clock);
    if (tel) tel.end(S_INPUT);

    // 2 SIM (fixed timestep, clamped catch-up, excess time DROPPED) ---------------
    if (tel) tel.begin(S_SIM);
    const n = clock.accumulate(dtMs / 1000);
    state.lastSteps = n;
    for (let i = 0; i < n; i++) {
      if (hStep) hStep(clock.tick, TICK);
      clock.commit();
      state.totalSteps++;
    }
    if (tel) tel.end(S_SIM);

    const alpha = clock.alpha;
    const simTime = clock.simTime;

    // 3 ANIM ---------------------------------------------------------------------
    if (tel) tel.begin(S_ANIM);
    if (hAnim) hAnim(alpha, simTime);
    if (tel) tel.end(S_ANIM);

    // 4 FX -----------------------------------------------------------------------
    if (tel) tel.begin(S_FX);
    if (hFx) hFx(alpha, simTime);
    if (tel) tel.end(S_FX);

    // 5 CAMERA + CULL + LOD ------------------------------------------------------
    if (tel) tel.begin(S_CAMERA);
    if (hCamera) hCamera(alpha, simTime);
    if (tel) tel.end(S_CAMERA);

    // 6 RENDER -------------------------------------------------------------------
    if (tel) tel.begin(S_RENDERJS);
    if (hRender) hRender(alpha, simTime);
    if (tel) tel.end(S_RENDERJS);

    // 7 OVERLAY ------------------------------------------------------------------
    if (tel) tel.begin(S_OVERLAY);
    if (hOverlay) hOverlay(alpha, simTime);
    if (tel) tel.end(S_OVERLAY);

    // 8 AUDIO --------------------------------------------------------------------
    if (tel) tel.begin(S_AUDIO);
    if (hAudio) hAudio(alpha, simTime);
    if (tel) tel.end(S_AUDIO);

    // 9 SCALER -------------------------------------------------------------------
    if (tel) tel.begin(S_SCALER);
    if (scaler && presented > 8) {
      // CPU sample excludes the scaler's own span (it is measured, just not yet ended).
      scaler.sample(nowMs, dtMs, tel ? tel.frameCpuSoFar() : 0);
    }
    if (tel) tel.end(S_SCALER);

    presented++;
    if (tel) {
      tel.frameEnd(clock.tick);
      if (presented === warmupFrames) tel.markWarmupEnd();
      if ((presented % heapEvery) === 0) tel.sampleHeap();
    }
    if (hFrameEnd) hFrameEnd(presented, nowMs);
  }

  return Object.assign(state, {
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
    MAX_FRAME_DT_MS,
  });
}

export default { createLoop };
