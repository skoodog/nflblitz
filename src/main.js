// FOUNDATION — PERFCORE owns this file.
//
// Boot. Imports every piece (side-effect registrations), then takes ONE of two paths:
//
//   ?mode=capture   build the scene, render one deterministic 1920x1080 accumulation
//                   still, raise __BLITZ_READY__. No frame budget. UNCHANGED.
//   ?mode=play      build the scene, detect the device, pre-warm every shader program,
//                   then run THE GAME LOOP against the performance contract.
//
// The runtime path publishes `window.__BLITZ_PERF__` — the single read API every
// harness command and every critic uses. Nothing about runtime behaviour may be
// asserted from any other source.

import { parseParams } from './foundation/params.js';
import { createEngine, createRuntime } from './foundation/engine.js';
import { listScenes, scenesForPiece } from './foundation/scenes.js';
import { REG, PIECE_IDS, PIECE_HEROES, SCENE_PANELS } from './foundation/registry.js';
import { createClock, createPacer, TICK, rateSpec, pacingTargets } from './foundation/clock.js';
import { createTelemetry, SPANS, budgetTable } from './foundation/telemetry.js';
import { createLoop } from './foundation/loop.js';
import { createTouch } from './foundation/touch.js';
import { ACT, DIR } from './pieces/touch-controller/tuning.js';
import {
  staticSignals, cpuProbe, gpuProbe, classify, createScaler,
  TIERS, RUNGS, tierOfRung, CHANGE_KIND, expensiveClass,
} from './foundation/quality.js';
import { countScene, measureOverdraw } from './foundation/budget.js';
import { createInput } from './foundation/input.js';

// ---- every piece registers as an import side effect, in fixed alphabetical order.
import './pieces/index.js';

const params = parseParams();

function publishSceneIndex() {
  window.__BLITZ_SCENES__ = listScenes();
  window.__BLITZ_PIECES__ = PIECE_IDS.map((id) => ({
    id,
    heroes: PIECE_HEROES[id] || [],
    scenes: scenesForPiece(id),
  }));
  window.__BLITZ_PANELS__ = Object.assign({}, SCENE_PANELS);
  window.__BLITZ_PROVENANCE__ = Object.assign({}, REG.provenance);
}

function markReady(stats) {
  window.__BLITZ_STATS__ = stats;
  window.__BLITZ_READY__ = true;
  document.documentElement.dataset.blitzReady = '1';
}

function fail(e) {
  console.error('[blitz] fatal:', e);
  window.__BLITZ_ERROR__ = String((e && e.stack) || e);
  const el = document.getElementById('fatal');
  if (el) {
    el.style.display = 'block';
    el.textContent = `BLITZ FATAL\n\n${(e && e.stack) || e}`;
  }
  // Still raise readiness so the harness screenshots the error instead of timing out.
  markReady({ error: String((e && e.message) || e), sceneId: params.scene, seed: params.seed, t: params.t });
}

/* ============================================================ CAPTURE PATH */

function bootCapture(glCanvas, uiCanvas) {
  const engine = createEngine({ glCanvas, uiCanvas, params });
  window.__BLITZ_ENGINE__ = engine;
  engine.buildScene(params.scene);
  publishSceneIndex();
  const stats = engine.captureFrame(params.t);
  markReady(stats);
}

/* ============================================================ RUNTIME PATH */

function bootPlay(glCanvas, uiCanvas) {
  const rt = createRuntime({ glCanvas, uiCanvas, params });
  window.__BLITZ_ENGINE__ = rt;

  /* ---- 1. device detection: static signals, then the boot micro-probe ------ */
  const sig = staticSignals();
  let cpu = null, gpu = null;
  if (params.probe) {
    cpu = cpuProbe(200);
    gpu = gpuProbe(200);
  }
  let detected = params.probe
    ? classify(sig, cpu, gpu)
    : { tier: sig.tier, rung: TIERS[sig.tier].rungHi, rate: TIERS[sig.tier].bootRate, notes: 'probe skipped' };

  // Explicit overrides from the URL. The harness pins these so a run is repeatable.
  const forcedTier = params.tier;
  if (forcedTier) {
    detected = {
      tier: forcedTier,
      rung: Math.round((TIERS[forcedTier].rungLo + TIERS[forcedTier].rungHi) / 2),
      rate: TIERS[forcedTier].bootRate,
      notes: (detected.notes || '') + ` | tier FORCED to ${forcedTier} by URL`,
    };
  }
  const startRung = params.rung !== null ? params.rung : detected.rung;
  const startRate = params.rate !== null ? params.rate : detected.rate;
  const tier = params.rung !== null ? tierOfRung(startRung) : detected.tier;

  /* ---- 2. build the scene ------------------------------------------------- */
  // THE RUNG AND THE TIER ARE PASSED IN. `createRuntime` defaults its rung to 8, and
  // building the world at rung 8 and correcting it at step 6 is invisible everywhere
  // except in `perf_synthetic`, whose headroom calculation happens once, inside
  // buildScene, against a scene that had not yet been put on the right rung. See the
  // note on `buildScene` in engine.js.
  rt.buildScene(params.scene, startRung, tier);
  publishSceneIndex();
  const shot = rt.ctx.shot;

  /* ---- 3. the spine: clock, touch bus, controller, flow, timing ----------- */
  const clock = createClock({ maxCatchup: rateSpec(startRate).maxCatchup });
  const tel = createTelemetry({ capacity: 8192 });
  const pacer = createPacer({ rate: startRate });
  const touch = createTouch(uiCanvas.parentNode || document.body, {});
  const ctrlState = REG.controller.create();
  const flowState = REG.flow.create();
  const timingState = REG.timing.create();
  // THE RENDERED SIM IS THE FLOW'S SIM. It used to be a SECOND, unrelated simulation
  // created here and ticked alongside the one game-flow was actually playing: two games
  // running side by side, one on screen and one keeping score. Nothing the player could
  // ever do would affect the one being drawn. `simView` is now a thin wrapper whose state
  // is whatever down the flow machine currently has live.
  let simState = null;
  try { simState = REG.sim.create(params.seed, { teamA: 'NYC', teamB: 'CHI' }); } catch (e) { simState = null; }
  // DEBUG ONLY. The game must be fully playable with thumbs and nothing else; this
  // exists so a developer at a desk can drive it, and for nothing else.
  const debugKeys = createInput(true);

  REG.controller.setSurface(ctrlState, rt.cssSize.w, rt.cssSize.h);

  const scratchIdx = new Int32Array(64);

  /* ---- 4. the scaler ------------------------------------------------------ */
  let pendingExpensive = -1;
  let loop = null;
  // A FORCED TIER CONSTRAINS THE RUNG LADDER to that tier's range. Without this a run
  // launched as `--tier=mid` could climb to rung 14, which is a HIGH-tier rung with
  // high-tier structural caps, and the report would say "TIER mid" over a scene that
  // budget.mjs would judge against mid's caps while the renderer was configured for
  // high's. The tier is the bucket the caps come from; the rungs inside it are the
  // ladder. They have to agree or the two commands are measuring different games.
  const rungRange = forcedTier
    ? [TIERS[forcedTier].rungLo, TIERS[forcedTier].rungHi]
    : [0, 15];
  const scaler = createScaler({
    rung: startRung,
    rate: startRate,
    minRung: rungRange[0],
    maxRung: rungRange[1],
    locked: params.rung !== null,
    rateLocked: params.rate !== null,
    onRung(next, from, reason) {
      tel.logRung(performance.now(), from, next, reason, CHANGE_KIND.RUNG);
      // CHEAP vs EXPENSIVE. A change that only moves render scale / particles / shadow
      // resolution is applied live. A change that alters post pass count, shadow
      // on/off or actor LOD class is QUEUED for the next play boundary, where the
      // hitch it would cause is invisible.
      if (expensiveClass(next) === expensiveClass(from)) {
        rt.applyRung(next);
      } else {
        pendingExpensive = next;
        REG.flow.queueRung(flowState, next, reason);
      }
    },
    onRate(next, from, reason) {
      tel.logRung(performance.now(), from, next, reason, CHANGE_KIND.RATE);
      if (loop) loop.setRate(next);
    },
  });

  /* ---- 5. the frame hooks ------------------------------------------------- */
  let lastFlowState = -1;

  function onInput(nowMs) {
    touch.drain(nowMs, clock, tel);
    debugKeys.update();
  }

  function onStep(tick) {
    // Controller resolves per TICK, seeing only the events bound to this tick.
    REG.controller.resolve(ctrlState, tick, touch, tel, scratchIdx);
    REG.timing.step(timingState, tick);
    const prev = flowState.state;
    REG.flow.step(flowState, tick);
    if (flowState.state !== prev && flowState.state === REG.flow.STATE.PLAY) {
      // THE PLAY BOUNDARY: commit any expensive rung change here and nowhere else.
      if (pendingExpensive >= 0 && flowState.committedRung === pendingExpensive) {
        rt.applyRung(pendingExpensive);
        pendingExpensive = -1;
      }
      // ...and commit any queued ACTOR LOD rebuild. `applyRung` never rebuilds on the
      // frame path; it queues, and this is the only place the queue is drained. 14
      // actors' worth of geometry is built here, which is why it happens at a boundary
      // and not inside the scaler's 0.10 ms span.
      rt.commitActorLod();
    }
    // THE KEYBOARD REACHES THE GAME TOO. `debugKeys` was created and update()d every tick
    // and its state was read by NOTHING -- the same defect the touch controller had, in the
    // same file, two lines apart. The game is meant to be played with thumbs and the pad is
    // a convenience for a developer at a desk, but a convenience that does nothing is a
    // lie in a keymap. `consume()` is edge-triggered, so a held key fires once.
    if (REG.flow.input) {
      const F = REG.flow;
      const inPlaycall = flowState.state === F.STATE.PLAYCALL;
      const carrying = flowState.play && flowState.play.carrier !== 'QB';
      if (inPlaycall) {
        if (debugKeys.consume('left')) F.input(flowState, ACT.SWITCH_PREV, DIR.NONE, tick);
        if (debugKeys.consume('right')) F.input(flowState, ACT.SWITCH_NEXT, DIR.NONE, tick);
        if (debugKeys.consume('up')) F.input(flowState, ACT.TURBO_ON, DIR.NONE, tick);
        if (debugKeys.consume('down') || debugKeys.consume('a')) F.input(flowState, ACT.SNAP, DIR.NONE, tick);
      } else if (carrying) {
        if (debugKeys.consume('left')) F.input(flowState, ACT.JUKE_L, DIR.NONE, tick);
        if (debugKeys.consume('right')) F.input(flowState, ACT.JUKE_R, DIR.NONE, tick);
        if (debugKeys.consume('down')) F.input(flowState, ACT.DIVE, DIR.NONE, tick);
      } else {
        // The passer. J / K / L are receivers 1, 2 and 3 -- the C-button idiom pad.js
        // records, laid out left-to-right under the fingers.
        if (debugKeys.consume('a')) F.input(flowState, ACT.PASS, DIR.LEFT, tick);
        if (debugKeys.consume('b')) F.input(flowState, ACT.PASS, DIR.UP, tick);
        if (debugKeys.consume('x')) F.input(flowState, ACT.PASS, DIR.RIGHT, tick);
        if (debugKeys.consume('y')) F.input(flowState, ACT.TUCK, DIR.NONE, tick);
      }
      if (debugKeys.consume('turbo')) F.input(flowState, ACT.TURBO_ON, DIR.NONE, tick);
    }

    // THE PLAYER'S INPUT REACHES THE GAME. The controller resolves gestures into
    // `ctrlState.action` on the tick they happened; until this line existed nothing
    // anywhere read that field, so a fully-built touch controller resolved every swipe
    // and tap into a void while the game played itself.
    if (ctrlState.action && REG.flow.input) {
      try {
        REG.flow.input(flowState, ctrlState.action, ctrlState.actionDir, tick);
      } catch (e) { /* an input must never take the frame down */ }
    }

    // The flow machine advances its own live down inside step(); only fall back to the
    // standalone sim when the flow has no down running (title, team select, playcall).
    if (flowState.play && flowState.state === REG.flow.STATE.PLAY) {
      simState = flowState.play;
    } else if (simState && REG.sim.step) {
      try { REG.sim.step(simState, TICK); } catch (e) { simState = null; }
    }
  }

  function onAnim(alpha, simTime) { rt.update(simTime); }
  function onRender() { rt.render(); }

  /**
   * THE OVERLAY REDRAW GATE. Touching the 2D canvas re-uploads the whole layer to the
   * compositor, so the overlay is redrawn when something CHANGED, not once per frame.
   * See the long note in overlay.js for the measurement that forced this.
   *
   * The epoch is a cheap integer that moves whenever anything the HUD or the controller
   * displays has moved. `OVERLAY_KEEPALIVE_TICKS` is the staleness floor so that
   * anything genuinely animated still updates ~10 times a second; a piece that needs
   * more calls `ui.markDirty()` and pays for it in its own budget line.
   */
  const OVERLAY_KEEPALIVE_TICKS = 6;      // >= 10 Hz
  /**
   * THE REDRAW CEILING, off the quality ladder. Sim ticks between two HUD redraws:
   * floor rungs 0-2 -> 3 ticks (20 Hz), low 3-6 -> 2 (30 Hz), mid and high -> 1 (60 Hz).
   * Read per frame because the scaler moves the rung during play. See the long note on
   * `shouldDraw` in overlay.js for the measurement that forced it.
   */
  function overlayMinTicks() {
    const r = rt.rung;
    return r <= 2 ? 3 : r <= 6 ? 2 : 1;
  }
  function onOverlay(alpha, simTime) {
    if (lastFlowState !== flowState.state) {
      lastFlowState = flowState.state;
      rt.overlay.markFullDirty();
    }
    // Integer epoch: controller motion, button state, flow state, and the gesture feed.
    const epoch = (ctrlState.changeTick * 31)
      ^ (ctrlState.gestureTick * 7)
      ^ (flowState.state << 3)
      ^ (ctrlState.btnA ? 1 : 0) ^ (ctrlState.btnB ? 2 : 0) ^ (ctrlState.turbo ? 4 : 0);
    if (!rt.overlay.shouldDraw(epoch, clock.tick, OVERLAY_KEEPALIVE_TICKS, overlayMinTicks())) return;
    REG.controller._draw = ctrlState;
    rt.overlay.draw(simTime, shot, rt.ctx);
    rt.overlay.noteDrawn(epoch, clock.tick);
  }

  loop = createLoop({
    clock, pacer, telemetry: tel, scaler,
    rate: startRate,
    onInput, onStep, onAnim, onRender, onOverlay,
    warmupFrames: 120,
    onRate() { REG.controller.setSurface(ctrlState, rt.cssSize.w, rt.cssSize.h); },
  });

  /* ---- 6. PROGRAM PRE-WARM (ASSUMPTION D mitigation) ---------------------- */
  const warm = rt.prewarmPrograms();
  rt.applyRung(startRung, true);

  /**
   * OVERLAY PRE-WARM — the same idea as the program pre-warm, for the Canvas2D layer.
   *
   * Canvas2D has its own lazy costs: the first time a font size is used the renderer
   * resolves and caches the face, the first time a glyph outline is drawn the vector type
   * engine compiles and caches it, a team crest is rastered into an offscreen canvas on
   * first request. All of that is paid on whichever frame happens to draw the thing first,
   * and that frame is inside the game. Measured at the floor tier's 6x CPU emulation, one
   * such frame billed 50.8 ms to the `overlay` span and showed up as a 54 ms longtask and
   * a 50.1 ms interval in an otherwise flat 25 s run — a single visible hitch, from lazy
   * work, on a layer whose steady-state p95 is 1.9 ms.
   *
   * So every layer is drawn once here, on the loading screen, with the controller in both
   * its pressed and unpressed states, before the loop starts. Nothing is rendered to the
   * screen that the first real frame will not immediately overwrite: the surface is marked
   * fully dirty afterwards.
   */
  const warmOverlay = (() => {
    const t0 = performance.now();
    const saveHud = rt.ctx.forceHud, saveUI = rt.ctx.forceUI;
    const saveCallout = shot && shot.callout ? shot.callout.visible : null;
    let draws = 0;
    REG.controller._draw = ctrlState;
    try {
      if (shot && shot.callout) shot.callout.visible = true;
      for (const on of [false, true]) {
        ctrlState.btnA = on; ctrlState.btnB = on; ctrlState.turbo = on;
        ctrlState.stickActive = on; ctrlState.stickX = on ? 0.7 : 0; ctrlState.stickY = on ? -0.5 : 0;
        for (const layers of [[true, true], [true, false], [false, true]]) {
          rt.ctx.forceHud = layers[0];
          rt.ctx.forceUI = layers[1];
          rt.overlay.markFullDirty();
          rt.overlay.draw(0, shot, rt.ctx);
          draws++;
        }
      }
    } catch (e) {
      (window.__BLITZ_ERRORS__ = window.__BLITZ_ERRORS__ || []).push(`[overlay prewarm] ${e && e.message}`);
    }
    ctrlState.btnA = false; ctrlState.btnB = false; ctrlState.turbo = false;
    ctrlState.stickActive = false; ctrlState.stickX = 0; ctrlState.stickY = 0;
    rt.ctx.forceHud = saveHud;
    rt.ctx.forceUI = saveUI;
    if (shot && shot.callout && saveCallout !== null) shot.callout.visible = saveCallout;
    rt.overlay.markFullDirty();
    return { draws, ms: performance.now() - t0 };
  })();

  /* ---- 7. viewport --------------------------------------------------------*/
  function onResize() {
    rt.setViewport(window.innerWidth, window.innerHeight);
    REG.controller.setSurface(ctrlState, rt.cssSize.w, rt.cssSize.h);
    touch.measure();
    rt.overlay.markFullDirty();
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  /* ---- 8. the read API every critic uses ---------------------------------- */
  window.__BLITZ_PERF__ = {
    get frames() { return tel.frames; },
    get tick() { return clock.tick; },
    get rate() { return loop.rate; },
    get rung() { return rt.rung; },
    get tier() { return tierOfRung(rt.rung); },
    get periodMs() { return rateSpec(loop.rate).periodMs; },
    get wallMs() { return rateSpec(loop.rate).wallMs; },
    detected, sig, cpuProbe: cpu, gpuProbe: gpu,
    programsAtWarm: warm,
    overlayWarm: warmOverlay,
    SPANS,
    budget: () => budgetTable(loop.rate),
    targets: () => pacingTargets(loop.rate),
    stats: (ch, rate) => (rate === undefined ? tel.stats(ch) : tel.statsAtRate(ch, rate)),
    rateHistogram: () => tel.rateHistogram(),
    dropCount: (ms, rate) => tel.dropCount(ms, rate),
    longestCleanRun: (ms) => tel.longestCleanRun(ms),
    cleanWindows: (a, w, d) => tel.cleanWindows(a, w, d),
    worstFrame: () => tel.worstFrame(),
    /** The n worst frames, each fully decomposed. See TAIL ACCOUNTING in telemetry.js. */
    tailFrames: (n, sortBy) => tel.tailFrames(n, sortBy),
    accountingResidual: () => tel.accountingResidual(),
    enableTailProbe: (on) => tel.enableTailProbe(on),
    get tailProbe() { return tel.tailProbe; },
    get tailProbeLate() { return tel.tailProbeLate; },
    series: (ch, n) => tel.series(ch, n),
    longTasks: (ms, after) => tel.longTasks(ms, after),
    longTaskList: () => tel.longTaskList(),
    heap: () => tel.heapStats(),
    sampleHeap: () => tel.sampleHeap(),
    resetHeap: () => tel.resetHeap(),
    get inputLog() { return tel.inputEntries(); },
    resetInputLog: () => tel.resetInputLog(),
    rungChanges: () => tel.rungChanges(),
    markWarmupEnd: () => tel.markWarmupEnd(),
    reset: () => tel.reset(),
    // --- scene structure, for budget.mjs ---------------------------------
    countScene: (opts) => countScene(rt.scene, Object.assign({
      shadowsEnabled: rt.renderer.shadowMap.enabled,
      particleCount: RUNGS[rt.rung].particles,
      // Render targets in use. The runtime draws straight to the default framebuffer,
      // so the only render targets are the ones the post chain allocates — at most one
      // per pass. Reported as the rung's post pass count, which is an UPPER BOUND: a
      // post chain that ping-pongs two targets across five passes counts as five here
      // and is therefore never flattered by this number.
      extraRenderTargets: RUNGS[rt.rung].postPasses,
    }, opts || {})),
    /**
     * Average overdraw, COUNTED — a real additive pass at 1/4 scale, read back and
     * averaged over covered pixels. Costs a readback, so it is only ever called by
     * budget.mjs and never from the frame loop.
     */
    measureOverdraw: () => {
      try {
        return measureOverdraw(rt.ctx.THREE, rt.renderer, rt.scene, rt.camera, { scale: 0.25 });
      } catch (e) { return { error: String(e && e.message) }; }
    },
    get renderInfo() { return rt.info; },
    get programCount() { return rt.renderer.info.programs ? rt.renderer.info.programs.length : 0; },
    get bufferSize() { return rt.bufferSize; },
    get cssSize() { return rt.cssSize; },
    // --- controller state, for touch.mjs ----------------------------------
    get controller() {
      return {
        stickX: ctrlState.stickX, stickY: ctrlState.stickY,
        stickActive: ctrlState.stickActive,
        btnA: ctrlState.btnA, btnB: ctrlState.btnB, turbo: ctrlState.turbo,
        gesture: ctrlState.gesture, gestureZone: ctrlState.gestureZone,
        gestureDir: ctrlState.gestureDir, gestureTick: ctrlState.gestureTick,
        taps: ctrlState.taps, swipes: ctrlState.swipes,
        holds: ctrlState.holds, doubles: ctrlState.doubles,
        changeTick: ctrlState.changeTick,
      };
    },
    /** Zone rectangles, read from the LIVE controller so REACH cannot test a stale copy. */
    get zones() { return REG.controller.ZONE_RECTS || null; },
    /** Where each control is DRAWN. Reach is checked against these AND the rect centres. */
    get zoneHomes() { return REG.controller.ZONE_HOMES || null; },
    get tuning() { return REG.controller.TUNING || null; },
    get touch() {
      return {
        activeCount: touch.activeCount, stuck: touch.stuck, stale: touch.stale,
        totalEvents: touch.totalEvents, droppedEvents: touch.droppedEvents,
        rect: touch.rect, safe: touch.safe,
      };
    },
    get flow() { return { state: flowState.state, playCount: flowState.playCount, commits: flowState.commits }; },
    get clock() {
      return {
        tick: clock.tick, simTime: clock.simTime, alpha: clock.alpha,
        droppedSteps: clock.droppedSteps, dropEvents: clock.dropEvents,
        stalls: clock.stalls, maxCatchup: clock.maxCatchup,
      };
    },
    get pacer() {
      return {
        rate: pacer.rate, divisor: pacer.divisor, refreshHz: pacer.refreshHz,
        vsyncCount: pacer.vsyncCount, presentCount: pacer.presentCount,
      };
    },
    get scaler() {
      return {
        rung: scaler.rung, rate: scaler.rate, tier: scaler.tier,
        lastP95Interval: scaler.lastP95Interval, lastP95Cpu: scaler.lastP95Cpu,
        downStreak: scaler.downStreak, upStreak: scaler.upStreak,
        rate60Latched: scaler.rate60Latched, rate60Failures: scaler.rate60Failures,
        locked: scaler.locked, rateLocked: scaler.rateLocked,
      };
    },
    // --- test instruments -------------------------------------------------
    injectStall: (ms, at) => loop.injectStall(ms, at),
    setRate: (r) => { scaler.setRate(r); loop.setRate(r); },
    setRung: (r) => { scaler.setRung(r); rt.applyRung(r); },
    lockScaler: (v) => { scaler.locked = !!v; scaler.rateLocked = !!v; },
    prewarm: () => rt.prewarmPrograms(),
    enterPlay: () => REG.flow.enterPlay(flowState, clock.tick),
    pause: (v) => loop.pause(v),
    stop: () => loop.stop(),
    start: () => loop.start(),
  };

  // The tier/rung tables, so budget.mjs reads the caps from the same source the
  // runtime configured itself from rather than keeping its own copy that can drift.
  window.__BLITZ_QUALITY__ = { TIERS, RUNGS };

  /* ---- 9. go -------------------------------------------------------------- */
  markReady({
    mode: 'play',
    sceneId: shot ? shot.id : params.scene,
    seed: params.seed,
    tier, rung: startRung, rate: startRate,
    raster: params.raster,
    buffer: rt.bufferSize,
    css: rt.cssSize,
    programs: warm.after,
    renderer: sig.renderer,
    detected: detected.notes,
    drawCalls: rt.info.drawCalls,
    tris: rt.info.tris,
    provenance: Object.assign({}, REG.provenance),
    errors: (window.__BLITZ_ERRORS__ || []).slice(),
  });

  if (params.autostart) loop.start();
}

/* ==================================================================== boot */

async function boot() {
  publishSceneIndex();

  // `?list=1` — enumerate scenes without touching WebGL. Used by shoot.mjs --list.
  if (params.list) {
    markReady({ mode: 'list', scenes: window.__BLITZ_SCENES__.length });
    return;
  }

  const stage = document.getElementById('stage');
  const glCanvas = document.getElementById('gl');
  const uiCanvas = document.getElementById('ui');

  if (params.mode === 'play') {
    // The runtime surface IS the viewport. No fixed 1920x1080 stage, no transform.
    document.documentElement.dataset.blitzMode = 'play';
    stage.style.width = '100%';
    stage.style.height = '100%';
    glCanvas.style.width = '100%';
    glCanvas.style.height = '100%';
    uiCanvas.style.width = '100%';
    uiCanvas.style.height = '100%';
    bootPlay(glCanvas, uiCanvas);
    return;
  }

  document.documentElement.dataset.blitzMode = 'capture';
  stage.style.width = `${params.w}px`;
  stage.style.height = `${params.h}px`;
  glCanvas.style.width = `${params.w}px`;
  glCanvas.style.height = `${params.h}px`;
  uiCanvas.style.width = `${params.w}px`;
  uiCanvas.style.height = `${params.h}px`;

  if (params.layer === 'gl') uiCanvas.style.display = 'none';
  if (params.layer === 'overlay') {
    glCanvas.style.display = 'none';
    stage.style.background = '#3a3a3e';   // neutral grey so overlay-only reads clearly
  }

  bootCapture(glCanvas, uiCanvas);
}

boot().catch(fail);
