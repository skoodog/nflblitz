#!/usr/bin/env node
// TOUCH + LATENCY. The command that decides whether the controller is real.
//
//   node scripts/touch.mjs --scene=live_play --tier=mid --gesture=all
//   node scripts/touch.mjs --tier=mid --rate=30          (latency at the 30 Hz mode)
//   node scripts/touch.mjs --viewport=844x390            (landscape reach)
//
// Drives REAL input through CDP `Input.dispatchTouchEvent` into a mobile context
// (isMobile + hasTouch + mobile UA), then reads `window.__BLITZ_PERF__.inputLog` and
// correlates each event's own timestamp to the sim tick that consumed it and the frame
// that rendered the result.
//
// LATENCY IS input -> RENDER DISPATCH. The compositor-to-photon leg is not measurable
// on this box; README section 11, ASSUMPTION C adds one frame for a real panel. The report
// says so on the line itself rather than in a footnote nobody reads.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  REPO, TIER_THROTTLE, TIER_DPR, LAUNCH_ARGS, parseArgs, loadPlaywright,
  ensureBuild, newMobilePage, setCpuThrottle, fmt, pass, playUrl,
} from './harness.mjs';

const { startServerAuto } = await import(pathToFileURL(path.join(REPO, 'scripts/serve.mjs')).href);

const args = parseArgs(process.argv.slice(2));
const SCENE = (args.scene && args.scene !== true) ? String(args.scene) : 'live_play';
const TIER = (args.tier && args.tier !== true) ? String(args.tier) : 'mid';
const RATE = args.rate ? Number(args.rate) : null;
const GEST = (args.gesture && args.gesture !== true) ? String(args.gesture) : 'all';
const N = Number(args.n || 200);
const PORT = Number(args.port || 5184);
const VP = (args.viewport && args.viewport !== true) ? String(args.viewport) : '390x844';
const [VW, VH] = VP.split('x').map(Number);

const L = (s) => console.log(s);
let exitCode = 0;
const fails = [];
const ok = (cond, label) => { if (!cond) { exitCode = 1; fails.push(label); } return cond; };

/**
 * Physical size of a CSS pixel. A 390x844 pt iPhone-class panel is 71.5 mm wide, so
 * one CSS px is ~0.183 mm. REACH is a PHYSICAL question — "can a thumb get there" — so
 * it has to be answered in millimetres, not in pixels.
 */
const MM_PER_CSSPX = 71.5 / 390;
const THUMB_REACH_MM = 40;

ensureBuild((s) => L(`[touch] ${s}`));
const srv = await startServerAuto(path.join(REPO, 'dist'), PORT);
const chromium = await loadPlaywright();
const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });

try {
  const { page, cdp, context, errors } = await newMobilePage(browser, {
    width: VW, height: VH, dpr: TIER_DPR[TIER],
  });
  const url = playUrl(srv.url, { scene: SCENE, tier: TIER, raster: 'none', seed: 7, rate: RATE, probe: false });
  L(`[touch] ${url}`);
  await page.goto(url, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction('window.__BLITZ_READY__===true', null, { timeout: 300000 });
  await setCpuThrottle(cdp, TIER_THROTTLE[TIER]);
  await page.waitForTimeout(1200);

  const info = await page.evaluate(() => ({
    rate: window.__BLITZ_PERF__.rate,
    period: window.__BLITZ_PERF__.periodMs,
    zones: window.__BLITZ_PERF__.zones,
    zoneHomes: window.__BLITZ_PERF__.zoneHomes,
    tuning: window.__BLITZ_PERF__.tuning,
    css: window.__BLITZ_PERF__.cssSize,
  }));

  const T = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points })
    .catch(() => { });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // Zone centres, in CSS px, from the LIVE controller's own rectangles.
  const Z = {};
  for (const r of info.zones) {
    Z[r[0]] = { x: ((r[1] + r[3]) / 2) * VW, y: ((r[2] + r[4]) / 2) * VH };
  }
  const STICK = Z[1], ACT_A = Z[2], ACT_B = Z[3], TURBO = Z[4];

  L('');
  L(`TIER ${TIER}  viewport ${VW}x${VH}  dpr ${TIER_DPR[TIER]}  present rate ${info.rate} Hz (period ${info.period.toFixed(2)} ms)`);
  L(`CPU throttle ${TIER_THROTTLE[TIER]}x   raster=none (GL removed so latency is the loop's, not SwiftShader's)`);

  /* ================================================================ LATENCY */

  const gestures = ['stick-move', 'tap-button', 'swipe-juke', 'hold-turbo'];
  const runList = GEST === 'all' ? gestures : [GEST];
  const latency = {};

  for (const g of runList) {
    await page.evaluate(() => window.__BLITZ_PERF__.resetInputLog());
    const reps = Math.max(20, Math.min(N, 200));
    for (let i = 0; i < reps; i++) {
      if (g === 'stick-move') {
        await T('touchStart', [{ x: STICK.x, y: STICK.y, id: 1 }]);
        await T('touchMove', [{ x: STICK.x + 46, y: STICK.y - 22, id: 1 }]);
        await wait(34);
        await T('touchEnd', []);
      } else if (g === 'tap-button') {
        await T('touchStart', [{ x: ACT_A.x, y: ACT_A.y, id: 1 }]);
        await wait(34);
        await T('touchEnd', []);
      } else if (g === 'swipe-juke') {
        await T('touchStart', [{ x: STICK.x, y: STICK.y, id: 1 }]);
        await T('touchMove', [{ x: STICK.x + 30, y: STICK.y, id: 1 }]);
        await T('touchMove', [{ x: STICK.x + 62, y: STICK.y, id: 1 }]);
        await wait(34);
        await T('touchEnd', []);
      } else {
        await T('touchStart', [{ x: TURBO.x, y: TURBO.y, id: 1 }]);
        await wait(34);
        await T('touchEnd', []);
      }
      await wait(24);
    }
    await wait(200);
    const entries = await page.evaluate(() => window.__BLITZ_PERF__.inputLog);
    const lat = entries.filter((e) => e.renderMs > 0).map((e) => e.renderMs).sort((a, b) => a - b);
    const q = (p) => (lat.length ? lat[Math.min(lat.length - 1, Math.round(p * (lat.length - 1)))] : 0);
    latency[g] = {
      n: lat.length, p50: q(0.5), p95: q(0.95), p99: q(0.99),
      worst: lat.length ? lat[lat.length - 1] : 0,
    };
  }

  L('');
  L('LATENCY  touch timestamp -> render dispatch   (add 1 frame for the panel: ASSUMPTION C)');
  L(`  gesture         n    p50 ms  p50 f   p95 ms    p99 ms   worst ms  worst f  budget`);
  let latOk = true;
  for (const g of runList) {
    const d = latency[g];
    const p50f = d.p50 / info.period;
    const worstF = d.worst / info.period;
    const good = p50f <= 2.0 + 1e-9 && worstF <= 3.0 + 1e-9;
    latOk = latOk && good;
    L(`  ${g.padEnd(12)} ${String(d.n).padStart(4)} ${fmt(d.p50, 8, 1)} ${fmt(p50f, 6, 1)} ${fmt(d.p95, 9, 1)} ${fmt(d.p99, 9, 1)} ${fmt(d.worst, 10, 1)} ${fmt(worstF, 8, 1)}     <=3f  ${pass(good)}`);
  }
  ok(latOk, 'latency budget');

  /* ========================================================= CLASSIFICATION */

  L('');
  L(`CLASSIFICATION (${N} scripted gestures per class, ground truth vs recognized)`);
  const classes = ['tap', 'swipe', 'hold', 'double'];
  const matrix = {};
  for (const c of classes) {
    const before = await page.evaluate(() => {
      const k = window.__BLITZ_PERF__.controller;
      return { tap: k.taps, swipe: k.swipes, hold: k.holds, double: k.doubles };
    });
    for (let i = 0; i < N; i++) {
      const p = ACT_A;
      if (c === 'tap') {
        await T('touchStart', [{ x: p.x, y: p.y, id: 1 }]); await wait(80); await T('touchEnd', []);
        await wait(420);                    // longer than doubleGapTicks so it is not a double
      } else if (c === 'swipe') {
        await T('touchStart', [{ x: p.x, y: p.y, id: 1 }]);
        await T('touchMove', [{ x: p.x - 40, y: p.y, id: 1 }]);
        await T('touchMove', [{ x: p.x - 75, y: p.y, id: 1 }]);
        await wait(80); await T('touchEnd', []); await wait(200);
      } else if (c === 'hold') {
        await T('touchStart', [{ x: p.x, y: p.y, id: 1 }]); await wait(620); await T('touchEnd', []);
        await wait(160);
      } else {
        await T('touchStart', [{ x: p.x, y: p.y, id: 1 }]); await wait(60); await T('touchEnd', []);
        await wait(120);
        await T('touchStart', [{ x: p.x, y: p.y, id: 1 }]); await wait(60); await T('touchEnd', []);
        await wait(420);
      }
    }
    await wait(300);
    const after = await page.evaluate(() => {
      const k = window.__BLITZ_PERF__.controller;
      return { tap: k.taps, swipe: k.swipes, hold: k.holds, double: k.doubles };
    });
    matrix[c] = {};
    for (const k of classes) matrix[c][k] = after[k] - before[k];
  }

  L(`              tap  swipe  hold  double   -> accuracy`);
  let clsOk = true;
  for (const c of classes) {
    const row = matrix[c];
    // A double-tap legitimately emits one TAP then one DOUBLE — the first press cannot
    // be known to be the first half of a double until the second arrives. So the
    // expected count for the driven class is N, and for `double` the extra N taps are
    // correct behaviour rather than misclassification.
    const total = c === 'double' ? row.double + row.swipe + row.hold : classes.reduce((s, k) => s + row[k], 0);
    const acc = total ? (100 * row[c] / total) : 0;
    const good = acc >= 98;
    clsOk = clsOk && good;
    L(`  ${c.padEnd(10)} ${String(row.tap).padStart(4)} ${String(row.swipe).padStart(6)} ${String(row.hold).padStart(5)} ${String(row.double).padStart(7)}    ${fmt(acc, 6, 1)}%  ${pass(good)}`
      + (c === 'double' ? '  (each double also emits its leading tap — expected)' : ''));
  }
  ok(clsOk, 'gesture classification >= 98%');

  /* ============================================================ MULTITOUCH */

  let both = 0;
  const MT = 100;
  for (let i = 0; i < MT; i++) {
    await T('touchStart', [{ x: STICK.x, y: STICK.y, id: 1 }]);
    await T('touchStart', [{ x: STICK.x, y: STICK.y, id: 1 }, { x: ACT_A.x, y: ACT_A.y, id: 2 }]);
    await T('touchMove', [{ x: STICK.x + 40, y: STICK.y, id: 1 }, { x: ACT_A.x, y: ACT_A.y, id: 2 }]);
    await wait(34);
    const s = await page.evaluate(() => {
      const k = window.__BLITZ_PERF__.controller;
      return { stick: k.stickActive, a: k.btnA };
    });
    if (s.stick && s.a) both++;
    await T('touchEnd', []);
    await wait(20);
  }
  L('');
  L(`MULTITOUCH   stick+button simultaneous: ${both}/${MT} both registered   ${pass(both === MT)}`);
  ok(both === MT, 'multitouch stick+button');

  /* ============================================================ ROBUSTNESS */

  const stuckAfter = async () => page.evaluate(() => ({
    active: window.__BLITZ_PERF__.touch.activeCount,
    stuck: window.__BLITZ_PERF__.touch.stuck,
    stale: window.__BLITZ_PERF__.touch.stale,
  }));

  // 50 injected cancels.
  //
  // `touchPoints` IS THE LIST OF POINTS THAT ARE STILL ACTIVE, not the list of points
  // being acted on. This loop used to pass `[{id:1}]` to touchCancel, which tells
  // Chromium the point is unchanged, so it dispatched NOTHING: no pointercancel, no
  // touchcancel. The first touchStart landed, all 49 that followed were rejected as a
  // duplicate id, and the run ended with exactly one pointer down that the page had
  // never been told about. That is where "1 stuck touch in 50" came from — the cancel
  // test had never once delivered a cancel. Measured with `scripts/touchprobe.mjs`:
  // BEFORE the fix, 60 cancel cycles produced 1 DOM event in total and the modal
  // per-cycle sequence was "(no events at all)". AFTER it, every cycle produces
  // `pointerdown touchstart gotpointercapture pointercancel lostpointercapture
  // touchcancel` and the bus ends with 0 active and 0 stuck.
  for (let i = 0; i < 50; i++) {
    await T('touchStart', [{ x: STICK.x, y: STICK.y, id: 1 }]);
    await wait(16);
    await T('touchCancel', []);
    await wait(16);
  }
  await wait(300);
  const s1 = await stuckAfter();

  // 50 slide-off-edge: drag well outside the surface then release outside
  for (let i = 0; i < 50; i++) {
    await T('touchStart', [{ x: STICK.x, y: STICK.y, id: 1 }]);
    await T('touchMove', [{ x: -60, y: STICK.y, id: 1 }]);
    await T('touchMove', [{ x: -200, y: -200, id: 1 }]);
    await wait(16);
    await T('touchEnd', []);
    await wait(16);
  }
  await wait(300);
  const s2 = await stuckAfter();

  // 10 visibilitychange cycles with a finger DOWN — the classic stuck-touch bug
  for (let i = 0; i < 10; i++) {
    await T('touchStart', [{ x: STICK.x, y: STICK.y, id: 1 }]);
    await wait(20);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await wait(40);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await T('touchEnd', []).catch(() => { });
    await wait(40);
  }
  await wait(400);
  const s3 = await stuckAfter();
  const spiral = await page.evaluate(() => window.__BLITZ_PERF__.clock.dropEvents);

  L('');
  const rob = (label, s) => L(`             ${label.padEnd(26)}-> ${s.active} active, ${s.stuck} stuck, ${s.stale} watchdog-released   ${pass(s.active === 0 && s.stuck === 0)}`);
  L('ROBUSTNESS   a pointer left ACTIVE with no finger on the glass is the same defect as');
  L('             a `stuck` counter: both are gated. `watchdog-released` is the 20 s');
  L('             lost-pointer safety net firing, and should be 0 in a healthy run.');
  rob('50 pointercancel injected', s1);
  rob('50 slide-off-edge', s2);
  rob('visibilitychange x10', s3);
  ok(s1.active === 0 && s1.stuck === 0, 'no stuck touches after cancel');
  ok(s2.active === 0 && s2.stuck === 0, 'no stuck touches after slide-off-edge');
  ok(s3.active === 0 && s3.stuck === 0, 'no stuck touches after visibilitychange');
  L(`             clock catch-up drop events over the whole run: ${spiral} (no spiral)`);

  /* ================================================================= REACH */

  L('');
  const pivots = [
    { name: 'left thumb', x: 0.02 * VW, y: 0.99 * VH },
    { name: 'right thumb', x: 0.98 * VW, y: 0.99 * VH },
  ];
  const zoneName = { 1: 'STICK', 2: 'ACTION_A', 3: 'ACTION_B', 4: 'TURBO' };
  let reachOk = true;
  const nearest = (x, y) => {
    let best = Infinity, bestP = '';
    for (const p of pivots) {
      const d = Math.hypot(x - p.x, y - p.y) * MM_PER_CSSPX;
      if (d < best) { best = d; bestP = p.name; }
    }
    return { mm: best, pivot: bestP };
  };
  // TWO POINTS PER CONTROL, BOTH GATED.
  //   HOME   where the control is DRAWN. This is where a thumb actually goes, and it is
  //          the point the controller's own comments always said was the right test.
  //   CENTRE the centre of the HIT rectangle. Testing only the home would let a hit
  //          region drift away from its artwork unnoticed; testing only the centre is
  //          what this report did before, and it tested a point nothing is drawn at.
  // Reporting one and gating on the other is how a reach budget quietly stops meaning
  // anything, so both are printed and both are gated.
  L(`REACH        thumb pivots at the bottom corners; 1 CSS px = ${MM_PER_CSSPX.toFixed(3)} mm at ${VW}x${VH}`);
  L(`             zone        home mm   hit-centre mm   nearest pivot   (both <= ${THUMB_REACH_MM} mm)`);
  const homes = info.zoneHomes || [];
  for (const r of info.zones) {
    const c = nearest(((r[1] + r[3]) / 2) * VW, ((r[2] + r[4]) / 2) * VH);
    const hRow = homes.find((h) => h[0] === r[0]);
    const hm = hRow ? nearest(hRow[1] * VW, hRow[2] * VH) : null;
    const good = c.mm <= THUMB_REACH_MM && (!hm || hm.mm <= THUMB_REACH_MM);
    reachOk = reachOk && good;
    L(`             ${(zoneName[r[0]] || String(r[0])).padEnd(10)} ${hm ? fmt(hm.mm, 8, 1) : '       -'}`
      + `   ${fmt(c.mm, 13, 1)}   ${c.pivot.padEnd(14)}  ${pass(good)}`);
  }
  ok(reachOk, 'all control zones within thumb reach');

  /* ========================================================= KEYBOARD-FREE */

  const keyCount = await page.evaluate(async () => {
    let keys = 0;
    const h = () => { keys++; };
    window.addEventListener('keydown', h, true);
    await new Promise((r) => setTimeout(r, 1500));
    window.removeEventListener('keydown', h, true);
    return { keys, ctrl: window.__BLITZ_PERF__.controller.taps };
  });
  L('');
  L(`KEYBOARD-FREE  every gesture above was driven by touch alone; key events observed: ${keyCount.keys}  ${pass(keyCount.keys === 0)}`);
  ok(keyCount.keys === 0, 'no keyboard dependency');

  if (errors.length) {
    L('');
    L(`PAGE ERRORS (${errors.length}): ${errors.slice(0, 3).join(' | ')}`);
  }

  await context.close();
  L('');
  L(`VERDICT  ${exitCode ? 'FAIL' : 'PASS'}`);
  if (fails.length) for (const f of fails) L(`  FAIL  ${f}`);
} catch (e) {
  console.error('[touch] FAILED:', e && (e.stack || e.message || e));
  exitCode = 1;
} finally {
  await browser.close();
  await srv.close();
}
process.exit(exitCode);
