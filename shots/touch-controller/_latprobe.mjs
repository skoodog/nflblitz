#!/usr/bin/env node
// touch-controller LATENCY PROBE — decomposes `renderMs` into its three legs.
//
// `scripts/touch.mjs` reports ONE number per event: renderMs = renderDispatch - eventMs.
// When that number has a long tail, the tail can come from three completely different
// places and the harness cannot tell them apart:
//
//   A  STAMP     the event arrived carrying a timestamp already far in the past. That is
//                a property of the synthetic CDP event, not of the game. foundation's
//                `stampOf()` accepts anything up to 5000 ms old, deliberately.
//                  signature: drainMs - eventMs is large, respondFrame == frame.
//   B  QUEUE     the event was drained many frames after it arrived — the deferral path
//                in touch.js holding it for a tick that had not happened yet.
//                  signature: drainMs - eventMs is large AND frame is well past.
//   C  RESPONSE  the controller drained it but did not act on it until a later tick.
//                  signature: drainMs - eventMs small, respondFrame > frame.
//
// Only C is the controller's fault. This prints all three, per event, for the tail.
//
//   node shots/touch-controller/_latprobe.mjs [--rate=30] [--tier=mid] [--n=200]

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  REPO, TIER_THROTTLE, TIER_DPR, LAUNCH_ARGS, parseArgs, loadPlaywright,
  ensureBuild, newMobilePage, setCpuThrottle, fmt, playUrl,
} from '../../scripts/harness.mjs';

const { startServerAuto } = await import(pathToFileURL(path.join(REPO, 'scripts/serve.mjs')).href);

const args = parseArgs(process.argv.slice(2));
const TIER = (args.tier && args.tier !== true) ? String(args.tier) : 'mid';
const RATE = args.rate ? Number(args.rate) : null;
const N = Number(args.n || 200);
const PORT = Number(args.port || 5193);
const VP = (args.viewport && args.viewport !== true) ? String(args.viewport) : '390x844';
const [VW, VH] = VP.split('x').map(Number);

const L = (s) => console.log(s);

ensureBuild((s) => L(`[latprobe] ${s}`));
const srv = await startServerAuto(path.join(REPO, 'dist'), PORT);
const chromium = await loadPlaywright();
const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });

try {
  const { page, cdp, context, errors } = await newMobilePage(browser, {
    width: VW, height: VH, dpr: TIER_DPR[TIER],
  });
  let url = playUrl(srv.url, { scene: 'live_play', tier: TIER, raster: 'none', seed: 7, rate: RATE, probe: false });
  // `--ctrl=fallback` measures the SAME build with this piece switched out, so the tail
  // can be attributed rather than argued about.
  if (args.ctrl === 'fallback') url += '&ctrl=fallback';
  L(`[latprobe] ${url}`);
  await page.goto(url, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction('window.__BLITZ_READY__===true', null, { timeout: 300000 });
  await setCpuThrottle(cdp, TIER_THROTTLE[TIER]);
  await page.waitForTimeout(1200);

  const info = await page.evaluate(() => ({
    rate: window.__BLITZ_PERF__.rate,
    period: window.__BLITZ_PERF__.periodMs,
    zones: window.__BLITZ_PERF__.zones,
  }));
  const Z = {};
  for (const r of info.zones) Z[r[0]] = { x: ((r[1] + r[3]) / 2) * VW, y: ((r[2] + r[4]) / 2) * VH };
  const STICK = Z[1];

  const T = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points }).catch(() => { });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  L('');
  L(`TIER ${TIER}  ${VW}x${VH}  present ${info.rate} Hz (period ${info.period.toFixed(2)} ms)  reps ${N}`);

  await page.evaluate(() => window.__BLITZ_PERF__.resetInputLog());
  for (let i = 0; i < N; i++) {
    await T('touchStart', [{ x: STICK.x, y: STICK.y, id: 1 }]);
    await T('touchMove', [{ x: STICK.x + 46, y: STICK.y - 22, id: 1 }]);
    await wait(34);
    await T('touchEnd', []);
    await wait(24);
  }
  await wait(300);
  const raw = await page.evaluate(() => window.__BLITZ_PERF__.inputLog);
  const es = raw.filter((e) => e.renderMs > 0);

  const stamp = es.map((e) => e.drainMs - e.eventMs).sort((a, b) => a - b);
  const resp = es.map((e) => (e.respondFrame - e.frame)).sort((a, b) => a - b);
  const rend = es.map((e) => e.renderMs).sort((a, b) => a - b);
  const q = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.round(p * (a.length - 1)))] : 0);

  L('');
  L(`  n = ${es.length}`);
  L('  leg                          p50      p95      p99    worst');
  L(`  A stamp->drain (ms)     ${fmt(q(stamp, 0.5), 9, 1)}${fmt(q(stamp, 0.95), 9, 1)}${fmt(q(stamp, 0.99), 9, 1)}${fmt(stamp[stamp.length - 1], 9, 1)}`);
  L(`  C drain->respond (frames)${fmt(q(resp, 0.5), 8, 1)}${fmt(q(resp, 0.95), 9, 1)}${fmt(q(resp, 0.99), 9, 1)}${fmt(resp[resp.length - 1], 9, 1)}`);
  L(`  TOTAL renderMs          ${fmt(q(rend, 0.5), 9, 1)}${fmt(q(rend, 0.95), 9, 1)}${fmt(q(rend, 0.99), 9, 1)}${fmt(rend[rend.length - 1], 9, 1)}`);

  const tail = es.slice().sort((a, b) => b.renderMs - a.renderMs).slice(0, 10);
  L('');
  L('  WORST 10 EVENTS');
  L('    seq  type  renderMs   stamp->drain   frame  respFrame  dFrames  tick  respTick  dTicks');
  for (const e of tail) {
    L(`    ${String(e.seq).padStart(4)} ${String(e.type).padStart(5)} ${fmt(e.renderMs, 10, 1)} ${fmt(e.drainMs - e.eventMs, 14, 1)}`
      + ` ${String(e.frame).padStart(7)} ${String(e.respondFrame).padStart(10)} ${String(e.respondFrame - e.frame).padStart(8)}`
      + ` ${String(e.tick).padStart(5)} ${String(e.respondTick).padStart(9)} ${String(e.respondTick - e.tick).padStart(7)}`);
  }

  const overStamp = es.filter((e) => (e.drainMs - e.eventMs) > 50).length;
  const overResp = es.filter((e) => (e.respondFrame - e.frame) > 2).length;
  L('');
  L(`  events whose STAMP was already >50 ms stale when drained: ${overStamp} / ${es.length}`);
  L(`  events the controller took >2 FRAMES to respond to:       ${overResp} / ${es.length}`);
  L('');
  L('  A tail in the first column is the synthetic event carrying an old timestamp and is');
  L('  nothing the controller can influence. A tail in the second is the controller.');

  if (errors.length) L(`\n  PAGE ERRORS (${errors.length}): ${errors.slice(0, 3).join(' | ')}`);
  await context.close();
} catch (e) {
  console.error('[latprobe] FAILED:', e && (e.stack || e.message || e));
  process.exitCode = 1;
} finally {
  await browser.close();
  await srv.close();
}
