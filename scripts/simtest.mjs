#!/usr/bin/env node
// TICK-EXACT TIMING — Node only. No browser, no renderer, no WebGL. Runs in ~2 s.
//
//   node scripts/simtest.mjs [--suite=windows|determinism|clock|rate|controller|all]
//
// This is the suite that makes "timing is critical" a testable claim instead of a
// promise. It imports src/foundation/clock.js and the timing model DIRECTLY and steps
// ticks, so a critic can assert reproducibly:
//     "input at t=1.000s lands the window, t=1.084s lands, t=1.184s misses"
//
// Exits 0 on pass, 1 on any failure, and prints the first diverging tick on a
// determinism failure.

import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

const { createClock, createPacer, TICK, TICK_MS, rateSpec, pacingTargets } =
  await import(path.join(REPO, 'src/foundation/clock.js'));
const timing = (await import(path.join(REPO, 'src/foundation/fallbacks/timing.js'))).default;
const controller = (await import(path.join(REPO, 'src/foundation/fallbacks/controller.js'))).default;
const flow = (await import(path.join(REPO, 'src/foundation/fallbacks/flow.js'))).default;
const { createScaler, RUNGS } = await import(path.join(REPO, 'src/foundation/quality.js'));

const args = {};
for (const a of process.argv.slice(2)) {
  if (!a.startsWith('--')) continue;
  const i = a.indexOf('=');
  if (i < 0) args[a.slice(2)] = true; else args[a.slice(2, i)] = a.slice(i + 1);
}
const SUITE = (args.suite && args.suite !== true) ? String(args.suite) : 'all';

let pass = 0, fail = 0;
const failures = [];

function ok(cond, label, detail) {
  if (cond) { pass++; return true; }
  fail++;
  failures.push(`${label}${detail ? '  ' + detail : ''}`);
  return false;
}
function line(s) { console.log(s); }
function res(b) { return b ? 'PASS' : 'FAIL'; }

/* ======================================================== SUITE: windows */

function suiteWindows() {
  line('');
  line('=== WINDOWS (tick-exact action timing) ===');
  const ARM = 50;

  for (const action of timing.ACTIONS) {
    const w = timing.windowFor(action, ARM);
    line(`WINDOW ${action.padEnd(10)} opens tick ${w.open}  closes tick ${w.close}  (${w.ticks} ticks, ${w.ms.toFixed(1)} ms)`);

    // Boundary table: one tick before open, at open, at close, one tick after close.
    const cases = [
      [w.open - 1, 'EARLY'],
      [w.open, null],
      [w.close, null],
      [w.close + 1, 'LATE'],
    ];
    for (const [tick, expect] of cases) {
      const st = timing.create();
      timing.arm(st, action, ARM);
      const r = timing.attempt(st, action, tick);
      const want = expect || (tick >= w.perfect0 && tick <= w.perfect1 ? 'PERFECT' : 'LAND');
      const good = r === want;
      ok(good, `${action} boundary tick ${tick}`, `got ${r} want ${want}`);
      line(`    tick ${String(tick).padStart(3)}  -> ${String(r).padEnd(8)} expected ${String(want).padEnd(8)} ${res(good)}`);
    }

    // The PERFECT sub-window must be exactly [perfect0, perfect1].
    let perfOk = true;
    for (let t = w.open; t <= w.close; t++) {
      const st = timing.create();
      timing.arm(st, action, ARM);
      const r = timing.attempt(st, action, t);
      const inPerfect = t >= w.perfect0 && t <= w.perfect1;
      if (inPerfect !== (r === 'PERFECT')) { perfOk = false; break; }
    }
    ok(perfOk, `${action} perfect sub-window`);
    line(`    perfect sub-window ticks ${w.perfect0}-${w.perfect1}${' '.repeat(20)}${res(perfOk)}`);
  }

  // ---- THE USER'S EXAMPLE, EXACT ------------------------------------------
  line('');
  line('--- the contract\'s worked example: juke armed at tick 50 ---');
  const w = timing.windowFor('juke', 50);
  const trials = [
    [1.000, 'LAND'],
    [1.084, 'LAND'],
    [1.184, 'MISS'],
  ];
  for (const [sec, want] of trials) {
    const tick = timing.tickAt(sec);
    const st = timing.create();
    timing.arm(st, 'juke', 50);
    const raw = timing.attempt(st, 'juke', tick);
    // MISS is the contract's word for "did not land": EARLY or LATE.
    const got = (raw === 'LAND' || raw === 'PERFECT') ? 'LAND' : 'MISS';
    const good = got === want;
    ok(good, `juke t=${sec}s`, `got ${raw} want ${want}`);
    line(`    t=${sec.toFixed(3)}s (tick ${tick}) -> ${got.padEnd(5)} (${raw.padEnd(7)}) expected ${want.padEnd(5)} ${res(good)}`);
  }
  const b = [
    [57, 'MISS'], [58, 'LAND'], [70, 'LAND'], [71, 'MISS'],
  ];
  let bOk = true;
  for (const [tick, want] of b) {
    const st = timing.create();
    timing.arm(st, 'juke', 50);
    const raw = timing.attempt(st, 'juke', tick);
    const got = (raw === 'LAND' || raw === 'PERFECT') ? 'LAND' : 'MISS';
    if (got !== want) bOk = false;
  }
  ok(bOk, 'juke boundary 57/58/70/71');
  line(`    boundary tick 57 MISS / 58 LAND / 70 LAND / 71 MISS${' '.repeat(9)}${res(bOk)}`);

  // ---- cooldown -----------------------------------------------------------
  const st = timing.create();
  timing.arm(st, 'juke', 50);
  timing.attempt(st, 'juke', 62);
  const cd = timing.attempt(st, 'juke', 63);
  const cdOk = cd === 'COOLDOWN';
  ok(cdOk, 'juke cooldown after an attempt');
  line(`    second attempt during cooldown -> ${cd}${' '.repeat(24)}${res(cdOk)}`);
}

/* ================================================== SUITE: rate invariance */

/**
 * THE CENTRAL CLAIM OF THE AMENDMENT: gameplay is bit-identical at 60 and at 30.
 * Same input sequence in WALL-CLOCK time, three different present rates, and the sim
 * must land on the same ticks with the same results and the same state hash.
 */
function suiteRate() {
  line('');
  line('=== RATE INVARIANCE (the sim does not know what the present rate is) ===');

  // An input schedule in WALL-CLOCK milliseconds. This is what a player actually does:
  // they press at a moment in time, not on a frame index.
  const schedule = [
    { ms: 200.0, action: 'juke' },
    { ms: 1000.0, action: 'spin' },
    { ms: 1750.0, action: 'catch' },
    { ms: 2333.3, action: 'dive' },
    { ms: 3100.0, action: 'stiffArm' },
  ];

  function run(presentHz, jitterMs) {
    const clock = createClock({ maxCatchup: rateSpec(presentHz >= 60 ? 60 : 30).maxCatchup });
    const st = timing.create();
    const results = [];
    const period = 1000 / presentHz;
    let wall = 0;
    let si = 0;
    const armed = Object.create(null);
    const pending = [];

    // Run to an identical number of SIM TICKS at every rate, not an identical number of
    // frames. Comparing equal frame counts would compare 240 ticks against 244 and the
    // difference would be the test's, not the sim's.
    const TARGET_TICKS = 240;
    for (let f = 0; f < 4000 && clock.tick < TARGET_TICKS; f++) {
      // A little jitter so this is not an artificially perfect clock.
      const dt = period + (jitterMs ? ((f * 37) % 7) * jitterMs * 0.1 : 0);
      wall += dt;
      const n = clock.accumulate(dt / 1000, wall);

      // Bind each pending input to the tick its own WALL timestamp falls in — exactly
      // what touch.js does at runtime via clock.tickForStamp(), INCLUDING the deferral
      // rule: an event landing on a tick this frame will not simulate stays queued.
      const lastTick = clock.lastPendingTick;
      while (si < schedule.length && schedule[si].ms <= wall) {
        const t = clock.tickForStamp(schedule[si].ms);
        if (t > lastTick) break;                 // defer to the next frame
        pending.push({ ev: schedule[si], tick: t });
        si++;
      }

      for (let i = 0; i < n; i++) {
        const tick = clock.tick;
        if (tick >= TARGET_TICKS) break;
        // arm every action 8 ticks before its input, deterministically
        for (const a of timing.ACTIONS) {
          if (!armed[a]) {
            const sched = schedule.find((s) => s.action === a);
            if (sched) {
              const wantArm = Math.floor((sched.ms / 1000) * 60) - 10;
              if (tick === wantArm) { timing.arm(st, a, tick); armed[a] = true; }
            }
          }
        }
        for (let k = pending.length - 1; k >= 0; k--) {
          if (pending[k].tick === tick) {
            const p = pending[k];
            const r = timing.attempt(st, p.ev.action, tick);
            results.push(`${p.ev.action}@${tick}=${r}`);
            pending.splice(k, 1);
          }
        }
        timing.step(st, tick);
        clock.commit();
      }
    }
    return { results, hash: timing.hash(st), ticks: clock.tick };
  }

  const a = run(60, 0);
  const b = run(30, 0);
  const c = run(45, 0);
  const d = run(30, 1.5);

  line(`    60 Hz present: ${a.ticks} ticks, hash ${a.hash}, ${a.results.length} attempts`);
  line(`    45 Hz present: ${c.ticks} ticks, hash ${c.hash}, ${c.results.length} attempts`);
  line(`    30 Hz present: ${b.ticks} ticks, hash ${b.hash}, ${b.results.length} attempts`);
  line(`    30 Hz jittered:${d.ticks} ticks, hash ${d.hash}, ${d.results.length} attempts`);

  const same = (x, y) => x.results.join('|') === y.results.join('|') && x.hash === y.hash;
  const r1 = same(a, b), r2 = same(a, c), r3 = same(a, d);
  ok(r1, 'sim identical at 60 and 30', `${a.results.join(',')} vs ${b.results.join(',')}`);
  ok(r2, 'sim identical at 60 and 45');
  ok(r3, 'sim identical at 60 and jittered 30');
  line(`    results 60: ${a.results.join('  ')}`);
  line(`    results 30: ${b.results.join('  ')}`);
  line(`    60 == 30 ${res(r1)}   60 == 45 ${res(r2)}   60 == 30+jitter ${res(r3)}`);
}

/* ========================================================== SUITE: clock */

function suiteClock() {
  line('');
  line('=== CLOCK ===');

  // ---- 120 Hz vsync, 60 Hz target: present every 2nd tick, sim 60 ticks/second ----
  {
    const pacer = createPacer({ rate: 60, warmup: 0 });
    const clock = createClock({ maxCatchup: 3 });
    let presents = 0, wall = 0;
    const vs = 1000 / 120;
    for (let i = 0; i < 240; i++) {
      wall = i * vs;
      if (!pacer.onVsync(wall)) continue;
      presents++;
      const n = clock.accumulate((presents === 1 ? vs * 2 : vs * 2) / 1000, wall);
      for (let k = 0; k < n; k++) clock.commit();
    }
    const simSec = clock.simTime;
    const good = presents === 120 && Math.abs(clock.tick - 120) <= 1;
    ok(good, '120Hz vsync -> 60 presents/s, 60 ticks/s', `presents=${presents} ticks=${clock.tick}`);
    line(`    synthetic 120Hz vsync sequence (240 vsyncs = 2.0 s)`);
    line(`      presents ${presents} (expect 120)   sim ticks ${clock.tick} (expect 120)   simTime ${simSec.toFixed(3)}s   ${res(good)}`);
  }

  // ---- 60 Hz vsync, 30 Hz target: present every 2nd vsync, sim STILL 60 ticks/s ----
  {
    const pacer = createPacer({ rate: 30, warmup: 0 });
    const clock = createClock({ maxCatchup: 4 });
    let presents = 0;
    const vs = 1000 / 60;
    let last = -1;
    const intervals = [];
    for (let i = 0; i < 240; i++) {
      const wall = i * vs;
      if (!pacer.onVsync(wall)) continue;
      if (last >= 0) intervals.push(wall - last);
      last = wall;
      presents++;
      const n = clock.accumulate((1000 / 30) / 1000, wall);
      for (let k = 0; k < n; k++) clock.commit();
    }
    const even = intervals.every((v) => Math.abs(v - 33.333) < 0.01);
    const good = presents === 120 && clock.tick === 240 && even;
    ok(good, '30 Hz target on 60 Hz panel', `presents=${presents} ticks=${clock.tick} even=${even}`);
    line(`    synthetic 60Hz vsync, TARGET 30 (240 vsyncs = 4.0 s)`);
    line(`      presents ${presents} (expect 120 = 30/s)   sim ticks ${clock.tick} (expect 240 = 60/s)`);
    line(`      every present interval exactly 33.333 ms: ${even}${' '.repeat(19)}${res(good)}`);
  }

  // ---- 144 Hz: the CAP. Must NOT free-run. ---------------------------------
  {
    const pacer = createPacer({ rate: 60, warmup: 0 });
    let presents = 0;
    for (let i = 0; i < 288; i++) pacer.onVsync(i * (1000 / 144)) && presents++;
    const hz = presents / 2;
    const good = hz <= 60.5;
    ok(good, '144Hz vsync never exceeds the 60 Hz cap', `measured ${hz} Hz`);
    line(`    synthetic 144Hz vsync, TARGET 60 -> ${hz} presents/s (divisor ${pacer.divisor}), cap 60  ${res(good)}`);
    line('      144 is not a multiple of 60: the honest options are uneven 60 or even 48.');
    line('      Even 48 is chosen. Even pacing beats a higher lumpy number.');
  }

  // ---- NO SPIRAL OF DEATH -------------------------------------------------
  {
    const clock = createClock({ maxCatchup: 3 });
    let wall = 0;
    for (let i = 0; i < 10; i++) { wall += 16.667; const n = clock.accumulate(0.016667, wall); for (let k = 0; k < n; k++) clock.commit(); }
    const tickBefore = clock.tick;
    // a 500 ms stall
    wall += 500;
    const n = clock.accumulate(0.500, wall);
    for (let k = 0; k < n; k++) clock.commit();
    const stepsTaken = clock.tick - tickBefore;
    const dropped = clock.droppedSteps;
    // and the NEXT frame must be normal again
    wall += 16.667;
    const n2 = clock.accumulate(0.016667, wall);
    const good = stepsTaken <= 3 && dropped > 0 && n2 <= 1;
    ok(good, '500 ms stall: clamped, time dropped, no spiral',
      `steps=${stepsTaken} dropped=${dropped} nextFrameSteps=${n2}`);
    line(`    injected 500 ms stall`);
    line(`      catch-up steps taken ${stepsTaken} (clamp 3)   time DROPPED ${dropped} steps   next frame ${n2} step(s)`);
    line(`      no 30-step burst, no compounding${' '.repeat(24)}${res(good)}`);
  }

  // ---- the 30 Hz catch-up clamp must not drop time during NORMAL operation --
  {
    const clock = createClock({ maxCatchup: rateSpec(30).maxCatchup });
    let wall = 0;
    for (let i = 0; i < 300; i++) { wall += 1000 / 30; const n = clock.accumulate((1000 / 30) / 1000, wall); for (let k = 0; k < n; k++) clock.commit(); }
    const good = clock.droppedSteps === 0 && clock.tick === 600;
    ok(good, '30 Hz steady state drops no time', `ticks=${clock.tick} dropped=${clock.droppedSteps}`);
    line(`    300 frames at a steady 30 Hz -> ${clock.tick} ticks (expect 600), dropped ${clock.droppedSteps}  ${res(good)}`);
    line('      (this is why the clamp scales with rate: a fixed clamp of 3 would be fine,');
    line('       but a clamp of 1 would silently drop time every single frame at 30 Hz)');
  }

  // ---- tickForStamp: sub-frame input resolution at 30 Hz -------------------
  {
    const clock = createClock({ maxCatchup: 4 });
    let wall = 0;
    for (let i = 0; i < 5; i++) { wall += 1000 / 30; const n = clock.accumulate((1000 / 30) / 1000, wall); for (let k = 0; k < n; k++) clock.commit(); }
    const t0 = clock.tick;
    wall += 1000 / 30;
    const n = clock.accumulate((1000 / 30) / 1000, wall);
    // This frame owns ticks t0 and t0+1, spanning [wall-33.3, wall].
    const early = clock.tickForStamp(wall - 30);   // early in the window
    const late = clock.tickForStamp(wall - 3);     // late in the window
    const good = n === 2 && early === t0 && late === t0 + 1;
    ok(good, '30 Hz input splits across the frame\'s two ticks',
      `n=${n} early=${early}(want ${t0}) late=${late}(want ${t0 + 1})`);
    line(`    at 30 Hz a frame owns 2 sim ticks; input is bound by its OWN timestamp:`);
    line(`      event 30 ms before present -> tick ${early} (first)   3 ms before -> tick ${late} (second)  ${res(good)}`);
    line('      THIS is why 30 Hz does not cost timing resolution, only display latency.');
  }
}

/* =================================================== SUITE: determinism */

function suiteDeterminism() {
  line('');
  line('=== DETERMINISM ===');

  function replay(seed) {
    const st = timing.create();
    const fl = flow.create();
    let h = 0;
    // A deterministic pseudo-input stream driven only by the seed and the tick.
    let s = seed >>> 0;
    const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    for (let tick = 0; tick < 600; tick++) {
      if (tick % 37 === 0) timing.arm(st, timing.ACTIONS[tick % timing.ACTIONS.length], tick);
      if (rnd() < 0.05) timing.attempt(st, timing.ACTIONS[(tick * 7) % timing.ACTIONS.length], tick);
      timing.step(st, tick);
      flow.step(fl, tick);
    }
    h = (timing.hash(st) ^ flow.hash(fl)) >>> 0;
    return h;
  }

  const N = 10000;
  const first = replay(7);
  let same = 0, diverged = -1;
  for (let i = 0; i < N; i++) {
    const h = replay(7);
    if (h === first) same++; else if (diverged < 0) diverged = i;
  }
  const good = same === N;
  ok(good, `${N} seeded replays identical`, `same=${same} firstDiverged=${diverged}`);
  line(`    ${N.toLocaleString()} seeded replays -> ${same.toLocaleString()} identical state hashes (0x${first.toString(16)})  ${res(good)}`);

  // Different seeds must actually differ, or the hash is not measuring anything.
  const other = replay(8);
  const distinct = other !== first;
  ok(distinct, 'different seeds produce different hashes');
  line(`    seed 7 = 0x${first.toString(16)}   seed 8 = 0x${other.toString(16)}   distinct ${res(distinct)}`);
}

/* =================================================== SUITE: controller */

function suiteController() {
  line('');
  line('=== CONTROLLER (gesture classification, tick-exact) ===');

  // A fake touch bus: exactly the shape touch.js exposes, driven by ticks.
  function makeBus() {
    const events = [];
    const pointers = [];
    for (let i = 0; i < 10; i++) pointers.push({ active: false, maxDist: 0 });
    return {
      events, pointers,
      eventsOnTick(tick, out) {
        let n = 0;
        for (let i = 0; i < events.length; i++) if (events[i].tick === tick && n < out.length) out[n++] = i;
        return n;
      },
      push(type, slot, x, y, tick) {
        events.push({ type, id: slot, slot, x, y, ms: tick * TICK_MS, tick, entry: null });
        if (type === 0) { pointers[slot].active = true; pointers[slot].maxDist = 0; }
        if (type === 2 || type === 3) pointers[slot].active = false;
        if (type === 1) pointers[slot].maxDist = Math.max(pointers[slot].maxDist, Math.abs(x - 80) + Math.abs(y - 700));
      },
    };
  }

  const cases = [
    { name: 'tap', build: (b) => { b.push(0, 0, 80, 700, 10); b.push(2, 0, 80, 700, 16); }, want: 1 },
    { name: 'swipe', build: (b) => { b.push(0, 0, 80, 700, 10); b.push(1, 0, 130, 700, 13); b.push(2, 0, 160, 700, 16); }, want: 2 },
    { name: 'hold', build: (b) => { b.push(0, 0, 80, 700, 10); b.push(2, 0, 80, 700, 55); }, want: 3 },
    { name: 'double', build: (b) => { b.push(0, 0, 80, 700, 10); b.push(2, 0, 80, 700, 14); b.push(0, 0, 80, 700, 20); b.push(2, 0, 80, 700, 24); }, want: 4 },
  ];

  const scratch = new Int32Array(64);
  for (const c of cases) {
    const bus = makeBus();
    c.build(bus);
    const st = controller.create();
    controller.setSurface(st, 390, 844);
    let seen = 0;
    for (let tick = 0; tick <= 70; tick++) {
      const g = controller.resolve(st, tick, bus, null, scratch);
      if (g === c.want) seen = g;
    }
    const good = seen === c.want;
    ok(good, `gesture ${c.name}`, `got ${controller.GESTURE_NAME[seen]} want ${controller.GESTURE_NAME[c.want]}`);
    line(`    ${c.name.padEnd(8)} -> ${controller.GESTURE_NAME[seen].padEnd(8)} expected ${controller.GESTURE_NAME[c.want].padEnd(8)} ${res(good)}`);
  }

  // Multi-touch: stick and button at the same tick, both must register.
  {
    const bus = makeBus();
    bus.push(0, 0, 60, 700, 10);      // stick zone (left)
    bus.push(0, 1, 350, 760, 10);     // action A zone (bottom right)
    const st = controller.create();
    controller.setSurface(st, 390, 844);
    controller.resolve(st, 10, bus, null, scratch);
    const good = st.stickActive && st.btnA;
    ok(good, 'multitouch stick+button on the same tick', `stick=${st.stickActive} btnA=${st.btnA}`);
    line(`    stick + button DOWN on the same tick -> stick ${st.stickActive}, A ${st.btnA}  ${res(good)}`);
  }

  // A CANCEL must not produce a gesture. A lost touch is not a tap.
  {
    const bus = makeBus();
    bus.push(0, 0, 80, 700, 10);
    bus.push(3, 0, 80, 700, 16);      // CANCEL
    const st = controller.create();
    controller.setSurface(st, 390, 844);
    let any = 0;
    for (let tick = 0; tick <= 40; tick++) { const g = controller.resolve(st, tick, bus, null, scratch); if (g) any = g; }
    const good = any === 0 && st.taps === 0;
    ok(good, 'pointercancel produces no gesture', `gesture=${any} taps=${st.taps}`);
    line(`    DOWN then CANCEL -> gesture ${controller.GESTURE_NAME[any]}, taps ${st.taps}  ${res(good)}`);
  }
}

/* ====================================================== SUITE: scaler */

function suiteScaler() {
  line('');
  line('=== SCALER (rate axis behaviour) ===');

  // Sustained bad pacing at the bottom rung must drop the RATE, but only after the
  // rung ladder is exhausted.
  {
    const changes = [];
    const sc = createScaler({
      rung: 2, rate: 60, minRung: 0, maxRung: 15,
      onRung: (to, from) => changes.push(`rung ${from}->${to}`),
      onRate: (to, from) => changes.push(`rate ${from}->${to}`),
    });
    let now = 0;
    for (let w = 0; w < 40; w++) {
      for (let f = 0; f < 30; f++) { now += 25; sc.sample(now, 25, 14); }
    }
    const droppedRungsFirst = changes[0] && changes[0].startsWith('rung');
    const endedAt30 = sc.rate === 30;
    ok(droppedRungsFirst, 'rungs drop before rate', changes.join(', '));
    ok(endedAt30, 'sustained failure at rung floor drops rate to 30', changes.join(', '));
    line(`    sustained 25 ms frames at 60 Hz target:`);
    line(`      ${changes.join('  |  ')}`);
    line(`      rungs first ${res(droppedRungsFirst)}   ended at 30 Hz ${res(endedAt30)}`);
  }

  // At 30 Hz with real headroom, RATE is bought before LOOKS.
  {
    const changes = [];
    const sc = createScaler({
      rung: 4, rate: 30, minRung: 0, maxRung: 15,
      onRung: (to, from) => changes.push(`rung ${from}->${to}`),
      onRate: (to, from) => changes.push(`rate ${from}->${to}`),
    });
    let now = 0;
    for (let w = 0; w < 30; w++) {
      for (let f = 0; f < 30; f++) { now += 33.3; sc.sample(now, 33.3, 6.0); }
    }
    const first = changes[0] || '';
    const rateFirst = first.startsWith('rate');
    ok(rateFirst, 'at 30 Hz, headroom buys RATE before RUNG', changes.join(', '));
    line(`    30 Hz, clean pacing, CPU 6.0 ms (fits the 13 ms 60 Hz wall):`);
    line(`      ${changes.slice(0, 4).join('  |  ')}`);
    line(`      rate bought before looks ${res(rateFirst)}`);
  }

  // Hysteresis: it must not oscillate on a borderline signal.
  {
    let flips = 0;
    const sc = createScaler({
      rung: 8, rate: 60, onRung: () => { flips++; }, onRate: () => { flips++; },
    });
    let now = 0;
    for (let w = 0; w < 60; w++) {
      const bad = (w % 2) === 0;
      for (let f = 0; f < 30; f++) { now += bad ? 17.6 : 16.6; sc.sample(now, bad ? 17.6 : 16.6, 9.5); }
    }
    const good = flips <= 4;
    ok(good, 'alternating windows do not oscillate the scaler', `flips=${flips}`);
    line(`    60 alternating good/bad windows -> ${flips} changes (8:2 hysteresis + 3 s limit)  ${res(good)}`);
  }
}

/* ======================================================================= */

const t0 = Date.now();
if (SUITE === 'all' || SUITE === 'windows') suiteWindows();
if (SUITE === 'all' || SUITE === 'rate') suiteRate();
if (SUITE === 'all' || SUITE === 'clock') suiteClock();
if (SUITE === 'all' || SUITE === 'determinism') suiteDeterminism();
if (SUITE === 'all' || SUITE === 'controller') suiteController();
if (SUITE === 'all' || SUITE === 'scaler') suiteScaler();

line('');
line('='.repeat(72));
if (fail) {
  line(`VERDICT  FAIL   ${pass} passed, ${fail} FAILED   (${Date.now() - t0} ms)`);
  for (const f of failures) line(`  FAIL  ${f}`);
  process.exit(1);
}
line(`VERDICT  PASS   ${pass} assertions, 0 failures   (${Date.now() - t0} ms)`);
process.exit(0);
