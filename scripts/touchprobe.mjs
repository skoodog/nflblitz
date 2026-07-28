#!/usr/bin/env node
// TOUCH BUS PROBE — a focused reproduction rig for stuck-pointer defects.
//
//   node scripts/touchprobe.mjs --n=80
//
// `touch.mjs` reports THAT a pointer was left active after a cancel storm. It cannot say
// WHY, because by the time it reads the counter the evidence is gone. This records every
// raw DOM pointer/touch event the page receives, in order, with its type and pointerId,
// alongside the bus's own view, so the failing iteration can be read directly instead of
// reasoned about.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  REPO, TIER_DPR, LAUNCH_ARGS, parseArgs, loadPlaywright,
  ensureBuild, newMobilePage, setCpuThrottle, playUrl,
} from './harness.mjs';

const { startServerAuto } = await import(pathToFileURL(path.join(REPO, 'scripts/serve.mjs')).href);

const args = parseArgs(process.argv.slice(2));
const N = Number(args.n || 60);
const PORT = Number(args.port || 5188);
const VW = 390, VH = 844;

ensureBuild((s) => console.log(`[touchprobe] ${s}`));
const srv = await startServerAuto(path.join(REPO, 'dist'), PORT);
const chromium = await loadPlaywright();
const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
let exitCode = 0;

try {
  const { page, cdp, context } = await newMobilePage(browser, { width: VW, height: VH, dpr: TIER_DPR.mid });
  const url = playUrl(srv.url, { scene: 'live_play', tier: 'mid', raster: 'none', seed: 7, probe: false });
  await page.goto(url, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction('window.__BLITZ_READY__===true', null, { timeout: 300000 });
  await setCpuThrottle(cdp, 2);
  await page.waitForTimeout(800);

  // Tap the same DOM listeners the bus uses, in CAPTURE phase so we see the event
  // before the bus does and cannot perturb its handling.
  await page.evaluate(() => {
    window.__RAW__ = [];
    const el = document.getElementById('stage') || document.body;
    const rec = (tag) => (e) => {
      if (window.__RAW__.length < 4000) {
        window.__RAW__.push({
          tag, id: e.pointerId === undefined ? -1 : e.pointerId, t: Math.round(e.timeStamp * 10) / 10,
        });
      }
    };
    for (const n of ['pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture', 'gotpointercapture']) {
      el.addEventListener(n, rec(n), true);
    }
    for (const n of ['touchstart', 'touchend', 'touchcancel']) el.addEventListener(n, rec(n), true);
    document.addEventListener('visibilitychange', rec('visibilitychange'), true);
  });

  const T = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points }).catch(() => { });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const busState = () => page.evaluate(() => ({
    active: window.__BLITZ_PERF__.touch.activeCount,
    stuck: window.__BLITZ_PERF__.touch.stuck,
    total: window.__BLITZ_PERF__.touch.totalEvents,
  }));

  const x = VW * 0.22, y = VH * 0.82;
  const marks = [];
  for (let i = 0; i < N; i++) {
    await page.evaluate((k) => { window.__RAW__.push({ tag: `--iter${k}--`, id: -1, t: 0 }); }, i);
    await T('touchStart', [{ x, y, id: 1 }]);
    await wait(16);
    // touchCancel with a NON-EMPTY point list is a no-op: `touchPoints` is the list of
    // points that are STILL ACTIVE, so passing the point says "nothing changed" and
    // Chromium dispatches nothing at all. It has to be empty to cancel the point.
    await T('touchCancel', []);
    await wait(16);
    const s = await busState();
    marks.push({ i, active: s.active });
  }
  await wait(400);
  const final = await busState();
  const raw = await page.evaluate(() => window.__RAW__);

  console.log(`\nAFTER ${N} cancel cycles: active=${final.active} stuck=${final.stuck} totalEvents=${final.total}`);

  // Which iterations left the bus holding a pointer at the sample point?
  const bad = marks.filter((m) => m.active !== 0);
  console.log(`iterations sampled with active != 0: ${bad.length ? bad.map((b) => `${b.i}(${b.active})`).join(' ') : 'none'}`);

  // Per-iteration DOM event sequence, and every iteration whose sequence is not the
  // healthy one. This is the whole point of the probe.
  const iters = [];
  let cur = null;
  for (const r of raw) {
    if (r.tag.startsWith('--iter')) { cur = { n: Number(r.tag.slice(6, -2)), seq: [] }; iters.push(cur); continue; }
    // Ids are normalised away: a synthesized touch gets a fresh pointerId every time,
    // and what is under test is the SHAPE of the sequence, not its numbering.
    if (cur) cur.seq.push(r.tag);
  }
  const sig = (it) => it.seq.join(' ');
  const counts = new Map();
  for (const it of iters) counts.set(sig(it), (counts.get(sig(it)) || 0) + 1);
  console.log('\nDOM EVENT SEQUENCES PER ITERATION (count x sequence):');
  for (const [k, v] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(4)} x  ${k || '(no events at all)'}`);
  }
  const modal = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const odd = iters.filter((it) => sig(it) !== modal);
  if (odd.length) {
    console.log(`\nITERATIONS THAT DEVIATE FROM THE MODAL SEQUENCE (${odd.length}):`);
    for (const it of odd.slice(0, 12)) console.log(`  iter ${it.n}: ${sig(it) || '(no events at all)'}`);
  }
  if (final.active !== 0 || final.stuck !== 0) exitCode = 1;

  /* ------------------------------------------------------- LATENT-BUG CASES
   * The cancel storm above never exercised these. They are the three ways the old
   * retirement logic could drop a live finger, each driven directly so the fix is
   * measured rather than asserted.
   */
  const caseResult = [];
  const check = (name, cond, detail) => {
    caseResult.push({ name, ok: !!cond, detail });
    if (!cond) exitCode = 1;
  };

  // CASE 1 — DOWN, UP, DOWN for the same id inside ONE frame (a fast re-tap).
  // Retirement used to run after the whole drain and keyed off the UP record, so the
  // second DOWN was armed and then immediately retired: a finger on the glass with no
  // pointer behind it.
  await page.evaluate(() => window.__BLITZ_PERF__.resetInputLog());
  await T('touchStart', [{ x, y, id: 1 }]);
  await T('touchEnd', []);
  await T('touchStart', [{ x, y, id: 2 }]);
  await wait(120);
  const c1 = await busState();
  check('re-DOWN inside one drain keeps the pointer', c1.active === 1 && c1.stuck === 0,
    `active=${c1.active} stuck=${c1.stuck} (want active=1)`);
  await T('touchEnd', []);
  await wait(120);

  // CASE 2 — a burst far larger than the 256-entry per-frame event window, ending in a
  // release. Retirement used to iterate that window, so a release that fell off the end
  // left its pointer active forever.
  await T('touchStart', [{ x, y, id: 3 }]);
  const burst = [];
  for (let i = 0; i < 400; i++) burst.push(T('touchMove', [{ x: x + (i % 17), y: y + (i % 13), id: 3 }]));
  await Promise.all(burst);
  await T('touchEnd', []);
  await wait(300);
  const c2 = await busState();
  check('release survives a 400-event burst', c2.active === 0 && c2.stuck === 0,
    `active=${c2.active} stuck=${c2.stuck} (want active=0)`);

  // CASE 3 — a pointer that receives a DOWN and then NOTHING, ever. This is the real
  // hazard the harness bug was accidentally simulating: an OS that never sends the up.
  // The bus must not report it as stuck, and the 20 s watchdog owns it from there.
  await T('touchStart', [{ x, y, id: 4 }]);
  await wait(400);
  const c3 = await busState();
  check('orphaned DOWN is held, not double-counted', c3.active === 1 && c3.stuck === 0,
    `active=${c3.active} stuck=${c3.stuck} (want active=1, stuck=0)`);
  await T('touchEnd', []);
  await wait(200);
  const c3b = await busState();
  check('orphaned DOWN releases cleanly when the up finally arrives', c3b.active === 0,
    `active=${c3b.active} (want 0)`);

  console.log('\nLATENT-BUG CASES');
  for (const r of caseResult) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(48)} ${r.detail}`);

  await context.close();
} catch (e) {
  console.error('[touchprobe] FAILED:', e && (e.stack || e.message || e));
  exitCode = 1;
} finally {
  await browser.close();
  await srv.close();
}
process.exit(exitCode);
