#!/usr/bin/env node
// CPU + PACING. The command that decides whether the loop holds its wall.
//
//   node scripts/perf.mjs --scene=live_play --tier=mid --dur=60 --raster=min
//   node scripts/perf.mjs --scene=perf_synthetic --tier=floor --dur=60 --raster=min
//   node scripts/perf.mjs --tier=mid --thermal-ramp
//   node scripts/perf.mjs --tier=mid --rate=30        (pin the present rate)
//   node scripts/perf.mjs --tier=mid --json
//
// WHAT THIS PROVES, AND WHAT IT DOES NOT.
//   PROVEN — CPU cost per subsystem, heap/GC behaviour, allocation-free-ness, frame
//            PACING and its tail. Real V8, real GC, real event loop, real CDP CPU
//            throttling. These numbers transfer to a phone's CPU.
//   NOT PROVEN — anything about a phone's GPU. `--raster=min` renders 256x144 precisely
//            so software raster is not the variable. `--raster=auto` prints a loud
//            banner saying the GPU axis is not proven and that no number in that table
//            is a phone number.
//
// `--raster=min` is the default for a reason: at `auto` this box renders the game at
// roughly 100 ms per megapixel under SwiftShader, which would swamp every CPU number in
// the table with fill-rate cost that does not exist on real hardware.

import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import {
  REPO, TIER_THROTTLE, TIER_DPR, LAUNCH_ARGS, parseArgs, loadPlaywright,
  ensureBuild, newMobilePage, setCpuThrottle, measureThrottle, fmt, pass, playUrl,
} from './harness.mjs';

const { startServerAuto } = await import(pathToFileURL(path.join(REPO, 'scripts/serve.mjs')).href);

const args = parseArgs(process.argv.slice(2));
const SCENE = (args.scene && args.scene !== true) ? String(args.scene) : 'live_play';
const TIER = (args.tier && args.tier !== true) ? String(args.tier) : 'mid';
const DUR = Number(args.dur || 60);
const RASTER = args.raster === 'auto' ? 'auto' : args.raster === 'none' ? 'none' : 'min';
const RATE = args.rate ? Number(args.rate) : null;
const RUNG = args.rung !== undefined ? Number(args.rung) : null;
const THERMAL = !!args['thermal-ramp'];
const JSON_OUT = !!args.json;
const NO_INPUT = !!args['no-input'];
const PORT = Number(args.port || 5182);

if (!TIER_THROTTLE[TIER]) {
  console.error(`unknown tier "${TIER}". Use floor|low|mid|high.`);
  process.exit(2);
}

const L = (s) => { if (!JSON_OUT) console.log(s); };

/* ------------------------------------------------------- scripted input replay */

/**
 * A deterministic 60 s input replay so the run is identical every time. Without it the
 * measurement is of an idle game, which is not the thing being shipped.
 * Kept deliberately light (a few hundred events) so CDP dispatch overhead does not
 * itself become the thing being measured.
 */
async function driveInput(cdp, w, h, durMs, stopFlag) {
  const t0 = Date.now();
  const stickX = w * 0.18, stickY = h * 0.78;
  const btnX = w * 0.84, btnY = h * 0.82;
  let phase = 0;
  const send = async (type, points) => {
    try {
      await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
    } catch { /* page may be closing */ }
  };
  while (Date.now() - t0 < durMs && !stopFlag.stop) {
    const a = phase * 0.37;
    const sx = stickX + Math.cos(a) * 42;
    const sy = stickY + Math.sin(a) * 42;
    await send('touchStart', [{ x: stickX, y: stickY, id: 1 }]);
    await send('touchMove', [{ x: sx, y: sy, id: 1 }]);
    // stick AND button simultaneously — the multitouch path, every cycle
    await send('touchStart', [{ x: sx, y: sy, id: 1 }, { x: btnX, y: btnY, id: 2 }]);
    await new Promise((r) => setTimeout(r, 60));
    await send('touchEnd', [{ x: sx, y: sy, id: 1 }]);
    await send('touchEnd', []);
    phase++;
    await new Promise((r) => setTimeout(r, 240));
  }
}

/* ------------------------------------------------------------------------ run */

ensureBuild(JSON_OUT ? null : ((s) => L(`[perf] ${s}`)));
const srv = await startServerAuto(path.join(REPO, 'dist'), PORT);
const chromium = await loadPlaywright();
const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });

let exitCode = 0;
try {
  const dpr = TIER_DPR[TIER];
  const { page, cdp, context, errors } = await newMobilePage(browser, { width: 390, height: 844, dpr });

  const url = playUrl(srv.url, {
    scene: SCENE, tier: TIER, raster: RASTER, seed: 7, rate: RATE, rung: RUNG,
    probe: false,      // pinned tier: the probe would be measuring this box, not a phone
  });
  L(`[perf] ${url}`);

  // Verify the throttle is real BEFORE the run, on this exact page.
  await page.goto(`${srv.url}/?list=1`, { waitUntil: 'load', timeout: 240000 });
  const thr = await measureThrottle(page, cdp, TIER_THROTTLE[TIER]);
  await setCpuThrottle(cdp, 1);

  await page.goto(url, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction('window.__BLITZ_READY__===true', { timeout: 300000 });
  const boot = await page.evaluate(() => window.__BLITZ_STATS__);
  if (boot && boot.error) throw new Error(`page boot error: ${boot.error}`);

  // Throttle AFTER load so shader compile / texture bake is not throttled into a
  // multi-minute boot. The contract is about the steady-state loop.
  await setCpuThrottle(cdp, TIER_THROTTLE[TIER]);

  // WARMUP, explicitly. The contract excludes warmup from every verdict and requires
  // zero dropped frames only in 3 s windows AFTER the first 2 s. So: settle, zero the
  // buffers, run a real 2 s warmup WITH input flowing (so first-touch and first-gesture
  // costs are paid inside it), and only then mark the start of the measured window.
  // Warmup frames are still recorded and are reported separately — excluded is not the
  // same as hidden.
  const WARMUP_S = 2;
  await page.waitForTimeout(1500);
  await page.evaluate(() => { window.__BLITZ_PERF__.reset(); window.__BLITZ_PERF__.resetInputLog(); });

  const loadStart = os.loadavg()[0];
  const stopFlag = { stop: false };
  const inputTask = NO_INPUT ? Promise.resolve()
    : driveInput(cdp, 390, 844, (DUR + WARMUP_S) * 1000, stopFlag);

  await page.waitForTimeout(WARMUP_S * 1000);
  const warm = await page.evaluate(() => {
    const P = window.__BLITZ_PERF__;
    const iv = P.stats('interval');
    P.markWarmupEnd();
    return { frames: P.frames, p50: iv.p50, worst: iv.worst };
  });

  let rampNote = '';
  if (THERMAL) {
    // Ramp the CPU throttle mid-run and assert the scaler reacts and pacing recovers.
    await page.waitForTimeout((DUR / 3) * 1000);
    const t = await page.evaluate(() => performance.now());
    await setCpuThrottle(cdp, Math.max(4, TIER_THROTTLE[TIER] * 2));
    rampNote = `throttle ramped ${TIER_THROTTLE[TIER]}x -> ${Math.max(4, TIER_THROTTLE[TIER] * 2)}x at t=${(DUR / 3).toFixed(1)}s (page t=${t.toFixed(0)}ms)`;
    await page.waitForTimeout((DUR * 2 / 3) * 1000);
  } else {
    await page.waitForTimeout(DUR * 1000);
  }
  stopFlag.stop = true;
  await inputTask.catch(() => { });
  const loadEnd = os.loadavg()[0];
  const cores = os.cpus().length;

  const R = await page.evaluate(() => {
    const P = window.__BLITZ_PERF__;
    const spans = {};
    for (let i = 0; i < P.SPANS.length; i++) spans[P.SPANS[i]] = P.stats(i);
    const hist = P.rateHistogram();
    const perRate = {};
    for (const r of [60, 30]) {
      if ((r === 60 ? hist.r60 : hist.r30) > 0) {
        perRate[r] = {
          interval: P.stats('interval', r),
          total: P.stats('total', r),
          drops20: P.dropCount(r === 60 ? 20 : 40, r),
        };
      }
    }
    return {
      frames: P.frames, rate: P.rate, rung: P.rung, tier: P.tier,
      period: P.periodMs, wall: P.wallMs,
      budget: P.budget(), targets: P.targets(),
      spans, total: P.stats('total'), interval: P.stats('interval'),
      hist, perRate,
      drops: P.dropCount(P.targets().dropMs),
      cleanRun: P.longestCleanRun(P.targets().dropMs),
      clean3s: P.cleanWindows(2, 3, P.targets().dropMs),
      longtask20: P.longTasks(20), longtask50: P.longTasks(50),
      longtaskList: P.longTaskList().slice(0, 8),
      heap: P.heap(),
      worst: P.worstFrame(),
      rungChanges: P.rungChanges(),
      scaler: P.scaler, clock: P.clock, pacer: P.pacer,
      programs: P.programCount, programsAtWarm: P.programsAtWarm,
      buffer: P.bufferSize, css: P.cssSize,
      renderInfo: P.renderInfo,
      inputCount: P.inputLog.length,
    };
  });

  await context.close();

  /* --------------------------------------------------------------- report */

  if (JSON_OUT) {
    console.log(JSON.stringify({ tier: TIER, scene: SCENE, raster: RASTER, throttle: thr, result: R }, null, 2));
  } else {
    const T = R.targets;
    const period = R.period;
    L('');
    if (RASTER === 'auto' || RASTER === 'min') {
      L('!'.repeat(74));
      L('!! SWIFTSHADER NUMBERS - NOT A PHONE - GPU AXIS NOT PROVEN');
      L('!! Every INTERVAL below includes software rasterisation of the real scene.');
      L('!! Measured here: interval is 66-150 ms at ANY internal resolution, because');
      L('!! SwiftShader cost is dominated by per-triangle and per-draw-call work, which');
      L('!! does not shrink with the framebuffer. --raster=min removes FILL cost only.');
      L('!! The CPU table below IS honest and DOES transfer. The PACING table does not.');
      L('!! Use --raster=none to measure the loop pacing with GL submission removed.');
      L('!'.repeat(74));
    }
    if (RASTER === 'none') {
      L('-'.repeat(74));
      L('-- LOOP-ONLY MODE: no GL submission. Input, sim, anim, fx, camera, overlay and');
      L('-- the scaler all run; the scene graph is built and updated. This isolates the');
      L('-- LOOP\'s pacing, cap and tail from software raster. It proves the loop.');
      L('-- It proves NOTHING about rendering cost. See README AXIS 2 / AXIS 3.');
      L('-'.repeat(74));
    }
    L(`TIER ${TIER.padEnd(6)} cpu-throttle ${TIER_THROTTLE[TIER]}.0x (measured ${thr.measured.toFixed(2)}x)   rung ${R.rung}   raster=${RASTER}(${R.buffer.w}x${R.buffer.h})   css ${R.css.w}x${R.css.h} dpr ${TIER_DPR[TIER]}`);
    L(`RATE     active ${R.rate} Hz   period ${period.toFixed(2)} ms   wall ${R.wall.toFixed(2)} ms   frames@60 ${R.hist.r60}  frames@30 ${R.hist.r30}`);
    L(`FRAMES   n=${R.frames}  dur=${DUR.toFixed(2)}s  input events=${R.inputCount}`);
    L(`WARMUP   ${warm.frames} frames excluded (p50 ${fmt(warm.p50, 0, 2)} ms, worst ${fmt(warm.worst, 0, 2)} ms) — reported, not hidden`);
    // HOST CONTENTION. This container is shared: other agents run their own SwiftShader
    // Chromium jobs on the same 4 cores. When loadavg exceeds the core count, the page's
    // main thread gets descheduled by the OS for hundreds of milliseconds at a time, and
    // that lands in the INTERVAL tail with NO cpu attributed to any span.
    // The CPU table is robust to this (it measures only our own work). The pacing TAIL
    // is not. A tail failure under high load is a statement about the host, not the loop,
    // and this line is here so nobody has to guess which they are reading.
    const contended = loadEnd > cores * 1.25;
    L(`HOST     ${cores} cores   loadavg ${loadStart.toFixed(2)} -> ${loadEnd.toFixed(2)}` +
      (contended ? '   *** CONTENDED: interval tail is NOT attributable to this loop ***' : '   (uncontended)'));

    // --- pacing, PER RATE. Mixing a 16.7 ms population with a 33.3 ms one gives
    //     percentiles that describe neither.
    let pacingOk = true;
    for (const rk of ['60', '30']) {
      const pr = R.perRate[rk];
      if (!pr) continue;
      const p = rk === '60' ? 1000 / 60 : 1000 / 30;
      const tt = { p95: p * 1.05, p99: p * 1.2, worst: p * 2, p01: p * 0.96, drop: p * 1.2 };
      const iv = pr.interval;
      const okP50 = Math.abs(iv.p50 - p) <= 0.5;
      const okP95 = iv.p95 <= tt.p95;
      const okP99 = iv.p99 <= tt.p99;
      const okWorst = iv.worst <= tt.worst;
      const okCap = iv.p01 >= tt.p01;
      const okDrop = pr.drops20.pct <= 0.5;
      const all = okP50 && okP95 && okP99 && okWorst && okCap && okDrop;
      pacingOk = pacingOk && all;
      L('');
      L(`PACING @${rk}Hz  n=${iv.n}   target period ${p.toFixed(2)} ms`);
      L(`  p50   ${fmt(iv.p50, 7)} ms  (${p.toFixed(2)} +/- 0.50)             ${pass(okP50)}`);
      L(`  p95   ${fmt(iv.p95, 7)} ms  (<= ${fmt(tt.p95, 0)})                    ${pass(okP95)}`);
      L(`  p99   ${fmt(iv.p99, 7)} ms  (<= ${fmt(tt.p99, 0)})                    ${pass(okP99)}`);
      L(`  worst ${fmt(iv.worst, 7)} ms  (<= ${fmt(tt.worst, 0)})                    ${pass(okWorst)}`);
      L(`  CAP   p01 ${fmt(iv.p01, 5)} ms  (>= ${fmt(tt.p01, 0)} — never faster than ${rk} Hz)  ${pass(okCap)}`);
      L(`  DROPS >${tt.drop.toFixed(1)}ms: ${pr.drops20.drops} of ${pr.drops20.total} (${pr.drops20.pct.toFixed(2)}%, <= 0.50%)   ${pass(okDrop)}`);
    }
    L('');
    L(`CLEAN    longest clean run ${R.cleanRun} frames   3 s windows with a drop: ${R.clean3s.bad} of ${R.clean3s.windows}   ${pass(R.clean3s.bad === 0)}`);
    const ltOk = R.longtask20 === 0;
    L(`LONGTASK >20ms: ${R.longtask20}   >50ms: ${R.longtask50}                          ${pass(ltOk)}`);
    if (R.longtaskList.length) {
      for (const lt of R.longtaskList) L(`           longtask ${lt.ms.toFixed(1)} ms at ${lt.at.toFixed(0)} ms`);
    }

    // --- CPU sub-budgets, scaled to the ACTIVE rate ------------------------
    L('');
    L(`CPU (ms  p50 / p95 / worst   vs budget at ${R.rate} Hz)`);
    // performance.now() is coarsened to 100 us in this Chromium build, so every span
    // reading is a multiple of 0.1 ms. A budget of 0.10 or 0.20 ms is one or two clock
    // quanta wide: comparing it without allowing for the quantum turns a measurement of
    // "exactly on budget" into a FAIL for a subsystem doing almost nothing. EPS is one
    // quantum. Every budget in the table that is larger than ~1 ms is unaffected.
    const EPS = 0.1;
    // Compare in integer hundredths so accumulated float noise in a sum of quantised
    // samples cannot turn "exactly on budget" into a FAIL.
    const within = (v, b) => Math.round(v * 100) <= Math.round((b + EPS) * 100);
    let cpuOk = true;
    for (const s of Object.keys(R.spans)) {
      const st = R.spans[s];
      const b = R.budget[s];
      const good = within(st.p95, b);
      cpuOk = cpuOk && good;
      L(`  ${s.padEnd(9)} ${fmt(st.p50, 6)} /${fmt(st.p95, 6)} /${fmt(st.worst, 6)}   ${fmt(b, 5)}  ${pass(good)}`);
    }
    const totOk = within(R.total.p95, R.budget.TOTAL);
    cpuOk = cpuOk && totOk;
    L(`  ${'TOTAL'.padEnd(9)} ${fmt(R.total.p50, 6)} /${fmt(R.total.p95, 6)} /${fmt(R.total.worst, 6)}   ${fmt(R.budget.TOTAL, 5)}  ${pass(totOk)}`);

    // --- memory ------------------------------------------------------------
    const h = R.heap;
    // The growth estimate needs enough heap samples to mean anything. Heap is sampled
    // every 30 frames, so a short run yields a handful of points and the per-1000-frame
    // extrapolation is dominated by noise. Below 8 samples it is reported but NOT
    // gated — a number that cannot be trusted must not be allowed to pass or fail.
    const heapEnough = h.n >= 8;
    const sawOk = h.sawtoothMB <= 8.0;
    // ONE-SIDED. The contract caps GROWTH; a heap that shrinks over the run is a heap
    // that is not leaking, and failing a run for it would be nonsense.
    const growOk = !heapEnough || h.growthPer1000 <= 0.5;
    L('');
    L(`HEAP     start ${fmt(h.startMB, 0, 1)} end ${fmt(h.endMB, 0, 1)} peak ${fmt(h.peakMB, 0, 1)} MB   sawtooth ${fmt(h.sawtoothMB, 0, 2)}MB (<=8)  ${pass(sawOk)}`);
    L(`         growth/1000f ${fmt(h.growthPer1000, 0, 3)} MB (<=0.5)   samples ${h.n}       ${heapEnough ? pass(growOk) : 'n/a (too few samples)'}`);

    // --- programs (ASSUMPTION D gate) --------------------------------------
    // The program gate asks "did anything COMPILE during play?", so only a growth is a
    // failure. In --raster=none nothing is ever rendered, and three.js releases
    // programs it has not seen used, so the count can legitimately fall; gating on
    // equality there would fail the run for a decrease, which is not the hazard.
    const progDelta = R.programs - R.programsAtWarm.after;
    const progOk = RASTER === 'none' ? progDelta <= 0 : progDelta === 0;
    L(`PROGRAMS at prewarm ${R.programsAtWarm.after} -> at end ${R.programs}   delta ${progDelta}        ${pass(progOk)}`
      + (RASTER === 'none' ? '   (loop-only: only growth is a failure)' : ''));

    // --- scaler ------------------------------------------------------------
    const rungCh = R.rungChanges.filter((c) => c.kind === 0);
    const rateCh = R.rungChanges.filter((c) => c.kind === 1);
    L(`SCALER   rung changes ${rungCh.length}   RATE changes ${rateCh.length}   final rung ${R.rung} rate ${R.rate}   60-latched ${R.scaler.rate60Latched}`);
    for (const c of R.rungChanges.slice(0, 8)) {
      L(`           ${c.kind === 1 ? 'RATE' : 'rung'} ${c.from}->${c.to} at frame ${c.frame}`);
    }
    L(`CLOCK    ticks ${R.clock.tick}  dropped steps ${R.clock.droppedSteps}  drop events ${R.clock.dropEvents}  stalls ${R.clock.stalls}  maxCatchup ${R.clock.maxCatchup}`);
    L(`PACER    divisor ${R.pacer.divisor}  measured refresh ${R.pacer.refreshHz.toFixed(1)} Hz  vsyncs ${R.pacer.vsyncCount}  presents ${R.pacer.presentCount}`);
    L(`SCENE    draw calls ${R.renderInfo.drawCalls}  tris ${R.renderInfo.tris}  programs ${R.programs}`);
    if (rampNote) L(`THERMAL  ${rampNote}`);

    const w = R.worst;
    L(`WORST FRAME #${w.index} int=${fmt(w.interval, 0, 2)}  ` +
      Object.keys(w.spans).filter((k) => w.spans[k] > 0.05).map((k) => `${k}=${w.spans[k].toFixed(2)}`).join(' '));

    if (errors.length) {
      L('');
      L(`PAGE ERRORS (${errors.length}):`);
      for (const e of errors.slice(0, 5)) L(`  ${e}`);
    }

    const verdictOk = pacingOk && cpuOk && ltOk && sawOk && growOk && progOk && R.clean3s.bad === 0;
    L('');
    L(`VERDICT  ${verdictOk ? 'PASS' : 'FAIL'}`);
    if (RASTER === 'auto') L('         (GPU axis NOT proven — SwiftShader. See README ASSUMPTION A-D.)');
    if (!verdictOk) exitCode = 1;
  }
} catch (e) {
  console.error('[perf] FAILED:', e && (e.stack || e.message || e));
  exitCode = 1;
} finally {
  await browser.close();
  await srv.close();
}
process.exit(exitCode);
