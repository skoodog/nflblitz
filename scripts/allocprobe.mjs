#!/usr/bin/env node
// WHO IS ALLOCATING IN THE FRAME LOOP.
//
//   node scripts/allocprobe.mjs --tier=floor --rung=0 --dur=20
//
// The contract says per-frame allocation in the loop is ZERO. `perf.mjs` can only say
// whether the heap sawtooth is over budget; it cannot say WHOSE garbage it is, and a
// sawtooth you cannot attribute is a sawtooth you cannot fix. This attaches V8's
// sampling heap profiler over CDP for the measured window and prints the allocation
// sites by self size, so the answer is a stack trace rather than a hypothesis.
//
// It also reports bytes allocated per presented frame, which is the number the "zero
// allocation" claim actually lives or dies by.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  REPO, TIER_THROTTLE, TIER_DPR, LAUNCH_ARGS, parseArgs, loadPlaywright,
  ensureBuild, newMobilePage, setCpuThrottle, playUrl,
} from './harness.mjs';

const { startServerAuto } = await import(pathToFileURL(path.join(REPO, 'scripts/serve.mjs')).href);

const args = parseArgs(process.argv.slice(2));
const TIER = (args.tier && args.tier !== true) ? String(args.tier) : 'floor';
const RUNG = args.rung !== undefined ? Number(args.rung) : null;
const RATE = args.rate ? Number(args.rate) : 30;
const DUR = Number(args.dur || 20);
const RASTER = args.raster === 'auto' ? 'auto' : args.raster === 'none' ? 'none' : 'auto';
const TOP = Number(args.top || 24);
const PORT = Number(args.port || 5189);

ensureBuild((s) => console.log(`[alloc] ${s}`));
const srv = await startServerAuto(path.join(REPO, 'dist'), PORT);
const chromium = await loadPlaywright();
const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });

let exitCode = 0;
try {
  const { page, cdp, context, errors } = await newMobilePage(browser, {
    width: 390, height: 844, dpr: TIER_DPR[TIER],
  });
  const url = playUrl(srv.url, {
    scene: 'live_play', tier: TIER, raster: RASTER, seed: 7, rate: RATE, rung: RUNG, probe: false,
  });
  console.log(`[alloc] ${url}`);
  await page.goto(url, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction('window.__BLITZ_READY__===true', { timeout: 300000 });
  await setCpuThrottle(cdp, TIER_THROTTLE[TIER]);
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.__BLITZ_PERF__.reset());

  // 64 KiB sampling interval: fine enough to catch a few hundred bytes a frame over a
  // 20 s window, coarse enough that the profiler is not itself the thing being measured.
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.startSampling', { samplingInterval: 65536 });
  const before = await page.evaluate(() => ({
    f: window.__BLITZ_PERF__.frames,
    used: performance.memory ? performance.memory.usedJSHeapSize : 0,
  }));

  await page.waitForTimeout(DUR * 1000);

  const after = await page.evaluate(() => ({
    f: window.__BLITZ_PERF__.frames,
    used: performance.memory ? performance.memory.usedJSHeapSize : 0,
    heap: window.__BLITZ_PERF__.heap(),
    interval: window.__BLITZ_PERF__.stats('interval'),
  }));
  const { profile } = await cdp.send('HeapProfiler.stopSampling');
  await cdp.send('HeapProfiler.disable');

  // Flatten the sample tree: every node carries selfSize plus its call frame.
  const flat = [];
  const walk = (node) => {
    const cf = node.callFrame || {};
    if (node.selfSize > 0) {
      flat.push({
        size: node.selfSize,
        fn: cf.functionName || '(anonymous)',
        url: (cf.url || '').replace(/^https?:\/\/[^/]+/, ''),
        line: cf.lineNumber,
      });
    }
    for (const c of node.children || []) walk(c);
  };
  walk(profile.head);
  // Merge by site — one site can appear at many stack positions.
  const bySite = new Map();
  let total = 0;
  for (const s of flat) {
    const k = `${s.fn} @ ${s.url}:${s.line}`;
    bySite.set(k, (bySite.get(k) || 0) + s.size);
    total += s.size;
  }
  const sorted = Array.from(bySite.entries()).sort((a, b) => b[1] - a[1]);

  const frames = after.f - before.f;
  console.log('');
  console.log(`TIER ${TIER} rung ${RUNG === null ? 'auto' : RUNG} rate ${RATE} raster=${RASTER} throttle ${TIER_THROTTLE[TIER]}x`);
  console.log(`FRAMES  ${frames} presented over ${DUR}s   interval p50 ${after.interval.p50.toFixed(2)} ms`);
  console.log(`HEAP    sawtooth ${after.heap.sawtoothMB.toFixed(2)} MB   peak ${after.heap.peakMB.toFixed(1)} MB`);
  console.log(`ALLOC   ${(total / 1048576).toFixed(2)} MB sampled over the window`
    + `   =  ${(total / Math.max(1, frames) / 1024).toFixed(2)} KB per presented frame`);
  console.log('');
  console.log('TOP ALLOCATION SITES (self size, sampled)');
  for (const [site, size] of sorted.slice(0, TOP)) {
    const pct = (100 * size / Math.max(1, total)).toFixed(1);
    console.log(`  ${(size / 1024).toFixed(0).padStart(8)} KB  ${pct.padStart(5)}%  ${(size / Math.max(1, frames)).toFixed(0).padStart(6)} B/frame  ${site}`);
  }
  if (errors.length) {
    console.log('');
    console.log(`PAGE ERRORS (${errors.length}):`);
    for (const e of errors.slice(0, 5)) console.log(`  ${e}`);
  }
  await context.close();
} catch (e) {
  console.error('[alloc] FAILED:', e && (e.stack || e.message || e));
  exitCode = 1;
} finally {
  await browser.close();
  await srv.close();
}
process.exit(exitCode);
