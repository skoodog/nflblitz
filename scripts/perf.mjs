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
import { spawn } from 'node:child_process';
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
// `--tailprobe` turns on the MessageChannel post-frame probe, which splits the gap
// between two presents into "the browser was busy after our callback" and "the main
// thread was genuinely idle or descheduled". It costs one port message per presented
// frame, so it is OFF by default and the report always says which way it ran.
const TAILPROBE = !!args.tailprobe;
// `--hostload=N` spawns N busy CPU hogs alongside the measured window. It exists to
// TEST an attribution rather than assert one: the tail accounting claims that the
// residual `idle` on a clean run is the OS descheduling this renderer, and the way to
// check that claim is to deschedule it harder on purpose and watch which bucket grows.
// If `idle` grows while `cb` stays flat, the attribution is right. It is announced in
// the report and it is never on by default.
const HOSTLOAD = args.hostload !== undefined ? Number(args.hostload) : 0;
const PORT = Number(args.port || 5182);

// `--tier=auto` runs the REAL boot detector (static signals + micro-probes) instead of
// pinning a tier. It exists because a pinned tier also CLAMPS THE RUNG LADDER to that
// tier's range — `--tier=mid` means the scaler may never go below rung 7 — and a report
// that does not say so invites the reader to mistake "the scaler stopped at rung 7" for
// "the scaler gave up" when the truth is "the scaler hit the floor of the range the
// command gave it". Throttle and DPR for an auto run are taken from the tier the
// detector actually picks.
// `--throttle=N` overrides the tier's CPU emulation rate. It exists so the two
// emulations this box stacks can be separated in the report instead of being argued
// about: `--tier=floor` runs a 6x CPU slowdown ON TOP of a software rasteriser, which
// together describe a device that does not exist. `--throttle=1` leaves SwiftShader as
// the only thing in the way and answers "what does the LOOP do when only the GPU is
// slow". Both are honest; neither is a phone. The value used is always printed.
const THROTTLE = args.throttle !== undefined ? Number(args.throttle) : null;
// `--rung-scale=X` overwrites the ACTIVE rung's internal render scale in the live RUNGS
// table before the measured window, so the rung ladder's floor can be chosen from real
// harness runs instead of from an extrapolation. It is a diagnostic, it is announced in
// the output, and it changes nothing about the shipped table — it is how the shipped
// table gets decided. Pair it with `--rung=N` so it is unambiguous which row moved.
const RUNG_SCALE = args['rung-scale'] !== undefined ? Number(args['rung-scale']) : null;
const AUTO = TIER === 'auto';
if (!AUTO && !TIER_THROTTLE[TIER]) {
  console.error(`unknown tier "${TIER}". Use floor|low|mid|high|auto.`);
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
  // For a PINNED tier the harness overrides DPR from its tier table, so the run is
  // repeatable. For `--tier=auto` the emulated device keeps its own DPR of 2.0 and the
  // active rung's `dprCap` clamps it — which is exactly what happens on a real phone.
  const dpr = AUTO ? 2.0 : TIER_DPR[TIER];
  const { page, cdp, context, errors } = await newMobilePage(browser, { width: 390, height: 844, dpr });

  const url = playUrl(srv.url, {
    scene: SCENE, tier: AUTO ? null : TIER, raster: RASTER, seed: 7, rate: RATE, rung: RUNG,
    // A pinned tier skips the probe: it would be measuring this box, not a phone.
    // `--tier=auto` is the opposite request — run the detector and report what it says.
    probe: AUTO,
  });
  L(`[perf] ${url}`);

  await page.goto(url, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction('window.__BLITZ_READY__===true', null, { timeout: 300000 });
  const boot = await page.evaluate(() => window.__BLITZ_STATS__);
  if (boot && boot.error) throw new Error(`page boot error: ${boot.error}`);
  const detected = await page.evaluate(() => window.__BLITZ_PERF__.detected);
  const effTier = AUTO ? (detected && detected.tier) || 'mid' : TIER;

  // Verify the throttle is real BEFORE the measured run, on this exact page, with the
  // loop PAUSED so the rAF frame does not contend with the calibration workload.
  await page.evaluate(() => window.__BLITZ_PERF__.pause(true));
  const throttleRate = THROTTLE !== null ? THROTTLE : TIER_THROTTLE[effTier];
  const thr = await measureThrottle(page, cdp, throttleRate);
  await setCpuThrottle(cdp, 1);
  await page.evaluate(() => window.__BLITZ_PERF__.pause(false));

  if (TAILPROBE) {
    const on = await page.evaluate(() => window.__BLITZ_PERF__.enableTailProbe(true));
    if (!on) L('[perf] --tailprobe requested but MessageChannel is unavailable; postTask stays 0');
  }

  // Diagnostic render-scale override, applied BEFORE warmup so the measured window sees
  // only the overridden buffer. `Object.freeze(RUNGS)` freezes the array, not the rows.
  if (RUNG_SCALE !== null) {
    await page.evaluate(([s]) => {
      const P = window.__BLITZ_PERF__;
      window.__BLITZ_QUALITY__.RUNGS[P.rung].renderScale = s;
      P.prewarm();          // ends with a forced applyRung, which re-sizes the buffer
    }, [RUNG_SCALE]);
  }

  // Throttle AFTER load so shader compile / texture bake is not throttled into a
  // multi-minute boot. The contract is about the steady-state loop.
  await setCpuThrottle(cdp, throttleRate);

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
  // Deliberate host contention, if asked for. Spawned AFTER warmup would bias the
  // warmup/measured split, so it starts here and is killed with the window.
  const hogs = [];
  for (let i = 0; i < HOSTLOAD; i++) {
    hogs.push(spawn(process.execPath, ['-e', 'let s=0;const t=Date.now();while(Date.now()-t<' + ((DUR + WARMUP_S + 5) * 1000) + '){for(let i=0;i<1e6;i++)s+=i%7;}'], { stdio: 'ignore' }));
  }
  const stopFlag = { stop: false };
  const inputTask = NO_INPUT ? Promise.resolve()
    : driveInput(cdp, 390, 844, (DUR + WARMUP_S) * 1000, stopFlag);

  await page.waitForTimeout(WARMUP_S * 1000);

  // FORCE A COLLECTION AT WARMUP END, then drop every heap sample taken before it.
  //
  // Boot allocates tens of MB that are garbage by the time the loop is steady:
  // procedural actor geometry, texture bakes, and the 16-rung program prewarm. Whichever
  // frame V8 chooses to collect that on lands inside the measured window and shows up as
  // a heap "sawtooth" that has nothing to do with the frame loop. Measured at
  // floor/rung 0 it read 29.15 MB against an 8 MB cap while V8's own sampling allocation
  // profiler put the loop at 259 BYTES per presented frame.
  //
  // Warmup is excluded from every other verdict in this report. This is what excluding
  // it from the heap verdict has to mean. It is announced in the output, not silent.
  let gcOk = false;
  try {
    await cdp.send('HeapProfiler.enable');
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('HeapProfiler.disable');
    gcOk = true;
  } catch { /* no HeapProfiler domain: report the heap uncollected and say so */ }

  const warm = await page.evaluate(([didGc]) => {
    const P = window.__BLITZ_PERF__;
    const iv = P.stats('interval');
    P.markWarmupEnd();
    if (didGc) P.resetHeap();
    return { frames: P.frames, p50: iv.p50, worst: iv.worst };
  }, [gcOk]);

  let rampNote = '';
  if (THERMAL) {
    // Ramp the CPU throttle mid-run and assert the scaler reacts and pacing recovers.
    await page.waitForTimeout((DUR / 3) * 1000);
    const t = await page.evaluate(() => performance.now());
    await setCpuThrottle(cdp, Math.max(4, throttleRate * 2));
    rampNote = `throttle ramped ${throttleRate}x -> ${Math.max(4, throttleRate * 2)}x at t=${(DUR / 3).toFixed(1)}s (page t=${t.toFixed(0)}ms)`;
    await page.waitForTimeout((DUR * 2 / 3) * 1000);
  } else {
    await page.waitForTimeout(DUR * 1000);
  }
  stopFlag.stop = true;
  for (const h of hogs) { try { h.kill('SIGKILL'); } catch { /* already gone */ } }
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
      // WHOLE-FRAME ACCOUNTING. Every ms between two presents lands in one of these.
      tail: {
        wall: P.stats('wall'), cb: P.stats('cb'), gap: P.stats('gap'),
        skip: P.stats('skip'), postTask: P.stats('postTask'), idle: P.stats('idle'),
        pre: P.stats('pre'), post: P.stats('post'), skew: P.stats('skew'),
        vsyncs: P.stats('vsyncs'),
      },
      tailFrames: P.tailFrames(6), tailFramesWall: P.tailFrames(6, 'wall'),
      tailProbe: P.tailProbe, tailProbeLate: P.tailProbeLate,
      resid: P.accountingResidual(),
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
      overlayWarm: P.overlayWarm,
      quality: window.__BLITZ_QUALITY__ ? window.__BLITZ_QUALITY__.TIERS : null,
      actorLod: window.__BLITZ_ENGINE__.actorLod,
      buffer: P.bufferSize, css: P.cssSize,
      renderInfo: P.renderInfo,
      // perf_synthetic's proof, made checkable: what the filler added, what the whole
      // scene structurally costs, and what the tier's cap is.
      synthetic: window.__BLITZ_ENGINE__.synthetic,
      structural: (() => { try { return P.countScene(); } catch (e) { return null; } })(),
      caps: (window.__BLITZ_QUALITY__ && window.__BLITZ_QUALITY__.TIERS[P.tier])
        ? window.__BLITZ_QUALITY__.TIERS[P.tier].caps : null,
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
    const QT = R.quality || {
      floor: { rungLo: 0, rungHi: 2 }, low: { rungLo: 3, rungHi: 6 },
      mid: { rungLo: 7, rungHi: 11 }, high: { rungLo: 12, rungHi: 15 },
    };
    L('');
    if (RASTER === 'auto' || RASTER === 'min') {
      L('!'.repeat(74));
      L('!! SWIFTSHADER NUMBERS - NOT A PHONE - GPU AXIS NOT PROVEN');
      L('!! Every INTERVAL below includes software rasterisation of the real scene.');
      L('!! Measured (progress/cost-curve.md): near the floor, frame cost on this box is');
      L('!!    frame_ms ~ 20.8 + 838 * megapixels');
      L('!! so resolution DOES matter — but ~20.8 ms of it is per-triangle and per-draw-');
      L('!! call work that no render scale can remove. (An earlier version of this banner');
      L('!! claimed interval was flat in resolution. That claim was wrong and is retired.)');
      L('!! The CPU table below IS honest and DOES transfer. The PACING table does not.');
      L('!! Use --raster=none to measure the loop pacing with GL submission removed.');
      L('!'.repeat(74));
    }
    if (RASTER === 'none') {
      L('-'.repeat(74));
      L('-- LOOP-ONLY MODE: no GL submission. Input, sim, anim, fx, camera, overlay and');
      L('-- the scaler all run; the scene graph is built and updated. This isolates the');
      L('-- LOOP\'s pacing, cap and tail from software raster. It proves the loop.');
      L('-- It proves NOTHING about rendering cost. README section 11: AXIS 2 vs AXIS 3.');
      L('-'.repeat(74));
    }
    L(`TIER ${effTier.padEnd(6)} cpu-throttle ${throttleRate.toFixed(1)}x${THROTTLE !== null ? ' (OVERRIDDEN, tier default ' + TIER_THROTTLE[effTier] + 'x)' : ''} (measured ${thr.measured.toFixed(2)}x)   rung ${R.rung}   raster=${RASTER}(${R.buffer.w}x${R.buffer.h})   css ${R.css.w}x${R.css.h} dpr ${dpr}`);
    // THE RUNG LADDER'S RANGE, STATED. A forced tier clamps the scaler to that tier's
    // rungs, so "the scaler settled at rung 7" under `--tier=mid` means it reached the
    // BOTTOM OF ITS ALLOWED RANGE, not that it stopped trying. Round 1 of this report
    // did not say so and the number was read the other way.
    if (AUTO) {
      L(`DETECT   tier=${detected.tier} rung=${detected.rung} rate=${detected.rate} Hz   ladder range 0..15 (unclamped)`);
      L(`         ${detected.notes}`);
    } else {
      const lo = R.scaler.minRung !== undefined ? R.scaler.minRung : '?';
      L(`DETECT   tier FORCED to "${TIER}" by the command line — boot probe SKIPPED.`);
      L(`         *** the rung ladder is CLAMPED to ${TIER} rungs ${QT[TIER].rungLo}..${QT[TIER].rungHi} ***`
        + `  a scaler that stops at rung ${QT[TIER].rungLo} here has hit that clamp, not its limit.`
        + (lo === '?' ? '' : ''));
      L(`         Run with --tier=auto to exercise the real detector and the full 0..15 ladder.`);
    }
    if (RUNG_SCALE !== null) {
      L(`OVERRIDE *** rung ${R.rung} renderScale overwritten to ${RUNG_SCALE} by --rung-scale ***`
        + `  this is a ladder-tuning run, not a run of the shipped table.`);
    }
    L(`RATE     active ${R.rate} Hz   period ${period.toFixed(2)} ms   wall ${R.wall.toFixed(2)} ms   frames@60 ${R.hist.r60}  frames@30 ${R.hist.r30}`);
    // A TIER'S BOOT RATE IS PART OF THE TIER. `--rate=60 --tier=floor` pins a 6x-slowed
    // CPU to a present rate that tier never boots into, and then judges every sub-budget
    // against the 60 Hz column. That is a legitimate diagnostic — it is how you find out
    // what the loop does when it is asked for more than the device was assigned — but a
    // budget it fails there is not a budget the shipped configuration violates, and the
    // report has to say which one the reader is looking at.
    if (!AUTO && QT[TIER] && QT[TIER].bootRate && RATE && RATE !== QT[TIER].bootRate) {
      L(`         *** DIAGNOSTIC PAIRING: tier "${TIER}" BOOTS AT ${QT[TIER].bootRate} Hz and is pinned here to ${RATE} Hz.`);
      L(`         Sub-budgets below are the ${RATE} Hz column. This tier does not ship at ${RATE} Hz.`);
    }
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
      (contended ? '   *** CONTENDED: interval tail is NOT attributable to this loop ***' : '   (uncontended)') +
      (HOSTLOAD ? `   *** ${HOSTLOAD} CPU hogs SPAWNED ON PURPOSE (--hostload) — this run is an attribution experiment ***` : ''));

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
    // THE ONE SPAN THIS BOX CANNOT MEASURE AS A CPU NUMBER.
    //
    // `renderJS` is the JS half of render dispatch and its budget is a CPU budget. Under
    // `--raster=min|auto` the span wraps `renderer.render()`, and on this box that call
    // does SwiftShader's synchronous share of the work inside it: the same scene measures
    // p95 0.10 ms at `--raster=none` and p95 10.40 ms at `--raster=auto`, a 100x spread
    // that is entirely the software rasteriser and entirely absent on a device with a GPU.
    // Gating a CPU budget against that number would fail the run for a property of this
    // container, and passing it would be worse. So it is gated where it means what the
    // budget says (`--raster=none`) and printed with the reason where it does not. This is
    // ASSUMPTION B applied at span granularity; the whole-callback gate below is not
    // exempted and carries the load at every raster mode.
    const glTainted = (s) => s === 'renderJS' && RASTER !== 'none';
    for (const s of Object.keys(R.spans)) {
      const st = R.spans[s];
      const b = R.budget[s];
      if (glTainted(s)) {
        L(`  ${s.padEnd(9)} ${fmt(st.p50, 6)} /${fmt(st.p95, 6)} /${fmt(st.worst, 6)}   ${fmt(b, 5)}  n/a   <- includes SwiftShader; not a CPU number (README ASSUMPTION B)`);
        continue;
      }
      const good = within(st.p95, b);
      cpuOk = cpuOk && good;
      L(`  ${s.padEnd(9)} ${fmt(st.p50, 6)} /${fmt(st.p95, 6)} /${fmt(st.worst, 6)}   ${fmt(b, 5)}  ${pass(good)}`);
    }
    const totOk = within(R.total.p95, R.budget.TOTAL);
    cpuOk = cpuOk && totOk;
    L(`  ${'TOTAL'.padEnd(9)} ${fmt(R.total.p50, 6)} /${fmt(R.total.p95, 6)} /${fmt(R.total.worst, 6)}   ${fmt(R.budget.TOTAL, 5)}  ${pass(totOk)}`);
    // THE WHOLE CALLBACK, GATED AT EVERY RASTER MODE. `cb` is a strict superset of TOTAL:
    // it adds the pacer, the frame bookkeeping and the loop's own end-of-frame hooks, i.e.
    // every millisecond the main thread spends inside our rAF callback. Nothing is exempt
    // from this one, and it holds even where a span budget cannot be evaluated.
    const cbOk = within(R.tail.cb.p95, R.wall);
    cpuOk = cpuOk && cbOk;
    L(`  ${'CALLBACK'.padEnd(9)} ${fmt(R.tail.cb.p50, 6)} /${fmt(R.tail.cb.p95, 6)} /${fmt(R.tail.cb.worst, 6)}   ${fmt(R.wall, 5)}  ${pass(cbOk)}`
      + `   <- rAF entry to return, vs the ${R.rate} Hz wall. Gated at EVERY raster mode.`);

    // --- memory ------------------------------------------------------------
    const h = R.heap;
    // The growth estimate needs enough heap samples to mean anything. Heap is sampled
    // every 30 frames, so a short run yields a handful of points and the per-1000-frame
    // extrapolation is dominated by noise. Below 8 samples it is reported but NOT
    // gated — a number that cannot be trusted must not be allowed to pass or fail.
    // ...and enough FRAMES for the per-1000-frame extrapolation to be an extrapolation
    // rather than an amplification. A 360-frame run yields 12 samples and multiplies
    // whatever noise they contain by 2.8 to reach "per 1000 frames"; measured on the
    // `perf_synthetic` run at the floor tier that produced a 1.317 MB/1000f "leak"
    // against a heap whose total excursion over the whole run was 0.91 MB. Both
    // conditions must hold before the growth number is allowed to fail a run.
    const heapEnough = h.n >= 8 && R.frames >= 900;
    const sawOk = h.sawtoothMB <= 8.0;
    // ONE-SIDED. The contract caps GROWTH; a heap that shrinks over the run is a heap
    // that is not leaking, and failing a run for it would be nonsense.
    const growOk = !heapEnough || h.growthPer1000 <= 0.5;
    L('');
    L(`HEAP     start ${fmt(h.startMB, 0, 1)} end ${fmt(h.endMB, 0, 1)} peak ${fmt(h.peakMB, 0, 1)} MB` +
      `   GC amplitude ${fmt(h.sawtoothMB, 0, 2)}MB (<=8)  ${pass(sawOk)}`);
    // The RANGE is reported next to the amplitude and never gated. They are different
    // quantities: amplitude is garbage-per-GC-cycle (what the contract caps), range is
    // the whole excursion of the run. Conflating them is what made a flat heap read as a
    // 29 MB sawtooth before this run forced a collection at warmup end.
    L(`         total range (peak-trough) ${fmt(h.rangeMB, 0, 2)} MB   not gated, reported` +
      `   ${gcOk ? 'GC forced at warmup end' : '*** GC NOT forced: boot garbage is IN this window ***'}`);
    L(`         growth/1000f ${fmt(h.growthPer1000, 0, 3)} MB (<=0.5)   samples ${h.n}       ${heapEnough ? pass(growOk) : `n/a (needs >=8 samples AND >=900 frames; got ${h.n}/${R.frames})`}`);

    // --- programs (ASSUMPTION D gate) --------------------------------------
    // The program gate asks "did anything COMPILE during play?", so only a growth is a
    // failure. In --raster=none nothing is ever rendered, and three.js releases
    // programs it has not seen used, so the count can legitimately fall; gating on
    // equality there would fail the run for a decrease, which is not the hazard.
    const progDelta = R.programs - R.programsAtWarm.after;
    const progOk = RASTER === 'none' ? progDelta <= 0 : progDelta === 0;
    L(`PROGRAMS at prewarm ${R.programsAtWarm.after} -> at end ${R.programs}   delta ${progDelta}        ${pass(progOk)}`
      + (RASTER === 'none' ? '   (loop-only: only growth is a failure)' : ''));
    // The Canvas2D layer has lazy costs too (font resolve, glyph outline compile, crest
    // raster). This is what they cost, paid on the loading screen instead of on a frame.
    if (R.overlayWarm) {
      L(`OVERLAY  pre-warm ${R.overlayWarm.draws} full redraws in ${fmt(R.overlayWarm.ms, 0, 1)} ms at boot`
        + `   (lazy Canvas2D work paid off the frame path)`);
    }

    // --- scaler ------------------------------------------------------------
    const rungCh = R.rungChanges.filter((c) => c.kind === 0);
    const rateCh = R.rungChanges.filter((c) => c.kind === 1);
    // BOOT rung is printed next to FINAL rung. `reset()` clears the rung-change log at
    // the start of the measured window, so a descent that happened during the settle
    // (which the new escape-velocity windows make FAST — a bad first window now closes
    // in ~1 s instead of ~3.5 s) would otherwise show as "0 rung changes, final rung 0"
    // with no hint that it started higher.
    L(`SCALER   boot rung ${boot.rung} -> final rung ${R.rung}   rung changes in window ${rungCh.length}`
      + `   RATE changes ${rateCh.length}   rate ${R.rate}   60-latched ${R.scaler.rate60Latched}`);
    for (const c of R.rungChanges.slice(0, 8)) {
      L(`           ${c.kind === 1 ? 'RATE' : 'rung'} ${c.from}->${c.to} at frame ${c.frame}`);
    }
    L(`CLOCK    ticks ${R.clock.tick}  dropped steps ${R.clock.droppedSteps}  drop events ${R.clock.dropEvents}  stalls ${R.clock.stalls}  maxCatchup ${R.clock.maxCatchup}`);
    L(`PACER    divisor ${R.pacer.divisor}  measured refresh ${R.pacer.refreshHz.toFixed(1)} Hz  vsyncs ${R.pacer.vsyncCount}  presents ${R.pacer.presentCount}`);
    L(`SCENE    draw calls ${R.renderInfo.drawCalls}  tris ${R.renderInfo.tris}  programs ${R.programs}`
      + `   actor LOD mix ${R.actorLod.key} over ${R.actorLod.actors} actors (${R.actorLod.rebuilds} rebuilds)`);
    // THE PROOF SCENE, STATED. `perf_synthetic` exists to answer "does the loop hold its
    // wall at the WORST SCENE A PIECE IS LEGALLY ALLOWED TO BUILD". A reader cannot take
    // that on trust, so the fill and the caps are printed and the shortfall is named.
    if (R.structural && R.caps) {
      const st = R.structural, cp = R.caps;
      const fillNote = R.synthetic
        ? `synthetic added ${R.synthetic.drawCalls} calls / ${R.synthetic.triangles} tris`
        : 'no synthetic fill (this is the LIVE scene, not the proof scene)';
      L(`STRUCTURE ${fillNote}`);
      L(`          draw calls ${st.drawCalls} of ${cp.drawCalls} cap (${(100 * st.drawCalls / cp.drawCalls).toFixed(0)}%)`
        + `   tris ${st.triangles} of ${cp.triangles} (${(100 * st.triangles / cp.triangles).toFixed(0)}%)`
        + `   ${SCENE === 'perf_synthetic'
          ? (st.drawCalls >= cp.drawCalls * 0.9 && st.triangles >= cp.triangles * 0.9
            ? 'AT CAP — the pacing above is measured against the worst legal scene'
            : '*** BELOW CAP: the proof scene did not populate; pacing is NOT at the cap ***')
          : '(live scene — not the cap proof)'}`);
    }
    if (rampNote) L(`THERMAL  ${rampNote}`);

    const w = R.worst;
    L(`WORST FRAME #${w.index} int=${fmt(w.interval, 0, 2)}  ` +
      Object.keys(w.spans).filter((k) => w.spans[k] > 0.05).map((k) => `${k}=${w.spans[k].toFixed(2)}`).join(' '));

    /* --- THE TAIL, ACCOUNTED FOR ------------------------------------------
     * Round 2 could measure a 50 ms frame and name none of it. Every ms between two
     * PRESENTS now lands in exactly one bucket:
     *   wall = cb(previous callback) + gap ;  cb = pre + spans + post ;
     *   gap  = skip(pacer's declined callbacks) + postTask(browser post-frame work)
     *          + idle(waiting for vsync, or the OS descheduled us).
     * `resid` is what the accounting cannot place. It is printed, never hidden.
     */
    L('');
    L(`TAIL ACCOUNTING (ms, whole-frame; p50/p95/worst)   tailprobe=${R.tailProbe ? 'ON' : 'off'}`
      + (R.tailProbe ? `  late probe samples ${R.tailProbeLate} of ${R.frames} (${(100 * R.tailProbeLate / Math.max(1, R.frames)).toFixed(1)}% — those frames' postTask falls into idle)` : ''));
    // The decomposition is an identity, so its residual has to be published or it is
    // just a diagram. Clock coarsening in this Chromium build is 100 us per reading.
    L(`  ACCOUNTING CLOSES: |wall - prevCb - gap| mean ${fmt(R.resid.meanWallMs, 0, 3)} ms,`
      + ` worst ${fmt(R.resid.worstWallMs, 0, 2)} ms;  |cb - pre - spans - post| worst ${fmt(R.resid.worstCbMs, 0, 2)} ms`
      + `  over ${R.resid.n} frames`);
    const tRow = (name, st, note) => L(`  ${name.padEnd(9)} ${fmt(st.p50, 7)} /${fmt(st.p95, 7)} /${fmt(st.worst, 8)}   ${note || ''}`);
    tRow('wall', R.tail.wall, 'rAF entry -> rAF entry (the accounting base)');
    tRow('cb', R.tail.cb, 'our whole rAF callback');
    tRow('  pre', R.tail.pre, 'callback entry -> first span (pacer + bookkeeping)');
    tRow('  spans', R.total, 'the nine named subsystem spans');
    tRow('  post', R.tail.post, 'last span -> callback return (frameEnd + hooks)');
    tRow('gap', R.tail.gap, 'outside our callback entirely');
    tRow('  skip', R.tail.skip, 'rAF callbacks the PACER declined to present');
    tRow('  postTask', R.tail.postTask, R.tailProbe ? 'browser post-frame work (style/paint/commit/GC)' : '(not measured: run with --tailprobe)');
    tRow('  idle', R.tail.idle, 'waiting for vsync, or OS descheduled the renderer');
    L(`  ${'skew'.padEnd(9)} ${fmt(R.tail.skew.p50, 7)} /${fmt(R.tail.skew.p95, 7)} /${fmt(R.tail.skew.worst, 8)}   rAF entry wall - rAF timestamp`);
    L(`  ${'vsyncs'.padEnd(9)} ${fmt(R.tail.vsyncs.p50, 7)} /${fmt(R.tail.vsyncs.p95, 7)} /${fmt(R.tail.vsyncs.worst, 8)}   rAF callbacks consumed per present`);

    const tailTable = (title, rows) => {
      if (!rows.length) return;
      L('');
      L(title);
      L('   #frame   int   wall   skew  prevCb    pre  spans   post    gap   skip  ptask   idle  vs   lt  resid  dominant span');
      for (const f of rows) {
        const dom = Object.keys(f.spans).sort((a, b) => f.spans[b] - f.spans[a])[0];
        const domV = f.spans[dom] || 0;
        L(`  ${String(f.index).padStart(6)} ${fmt(f.interval, 6, 1)} ${fmt(f.wall, 6, 1)} ${fmt(f.skew, 6, 1)} ${fmt(f.prevCb, 7, 1)}`
          + ` ${fmt(f.pre, 6, 1)} ${fmt(f.spanTotal, 6, 1)} ${fmt(f.post, 6, 1)} ${fmt(f.gap, 6, 1)}`
          + ` ${fmt(f.skip, 6, 1)} ${fmt(f.postTask, 6, 1)} ${fmt(f.idle, 6, 1)} ${String(f.vsyncs).padStart(3)}`
          + ` ${fmt(f.longtaskInGap, 4, 0)} ${fmt(f.unattributed, 6, 1)}  ${domV > 0.15 ? `${dom}=${domV.toFixed(1)}` : '-'}`);
      }
    };
    tailTable('WORST 6 BY INTERVAL, DECOMPOSED  (vs = vsyncs consumed, lt = longtask ms in the gap)', R.tailFrames);
    tailTable('WORST 6 BY WALL (rAF entry -> rAF entry) — the channel Chromium cannot snap', R.tailFramesWall);
    if (R.tailFrames.length) {
      L('  NOTE: `int` is vsync-timestamp to vsync-timestamp (what the player sees);');
      L('        `wall` is rAF-entry to rAF-entry and is the quantity the buckets sum to.');
      L('        Chromium SNAPS the rAF timestamp to the BeginFrame grid, so a callback');
      L('        delivered late still reports an on-grid interval. `skew` is that lateness.');
      L('        prevCb is the PREVIOUS callback: a frame is late because of the work');
      L('        that ran before it, not the work that ran in it.');
    }

    if (errors.length) {
      L('');
      L(`PAGE ERRORS (${errors.length}):`);
      for (const e of errors.slice(0, 5)) L(`  ${e}`);
    }

    const verdictOk = pacingOk && cpuOk && ltOk && sawOk && growOk && progOk && R.clean3s.bad === 0;
    L('');
    L(`VERDICT  ${verdictOk ? 'PASS' : 'FAIL'}`);
    if (RASTER === 'auto') L('         (GPU axis NOT proven — SwiftShader. README section 11, ASSUMPTION B.)');
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
