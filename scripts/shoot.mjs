#!/usr/bin/env node
// FOUNDATION — the capture command. Frozen to PIECE agents; owned by perf-core.
//
// ONE command produces a PNG. Self-healing: npm ci if node_modules is missing,
// vite build if dist/ is stale, static server on 127.0.0.1:5178, Playwright drive,
// teardown.
//
// WHY `waitUntil: 'commit'` AND NOT `'load'` (round 3).
//   `bootCapture()` renders the whole accumulation still SYNCHRONOUSLY inside the module
//   script: warmup passes, then `accum` jittered passes, then the resolve and the overlay.
//   A module script that never yields holds the main thread, and the `load` event cannot
//   fire until it returns. So `page.goto(..., {waitUntil:'load'})` was waiting for the
//   capture it had not started measuring yet, on a 120 s navigation budget, while the
//   real readiness gate — `__BLITZ_READY__`, on a 240 s budget — sat unused behind it.
//   Any scene whose capture takes longer than the NAVIGATION timeout failed with
//   "page.goto: Timeout exceeded" and no other information.
//   Measured: `--piece=typeface-lettering` at the default accum=32 renders six 1920x1080
//   scenes and blew the 120 s navigation budget on the first one, so a fidelity critic
//   could not capture that piece at all.
//   `'commit'` resolves as soon as the navigation is committed, which is what this file's
//   own header has always said the contract was: readiness is engine-driven, never
//   timer-driven. Nothing about the rendered pixels changes.
//
// AND A SECOND BUG UNDERNEATH IT, which the first one was hiding.
//   `page.waitForFunction(pred, {timeout: TIMEOUT})` is a THREE-argument call in
//   Playwright: `(pageFunction, arg, options)`. Passing the options object second makes
//   it the ARGUMENT to the page function, not the options, so the readiness gate silently
//   ran on Playwright's 30 s default instead of the 240 s this file configures — and the
//   same mistake was in perf.mjs, budget.mjs, touch.mjs, compare.mjs, costcurve.mjs and
//   allocprobe.mjs, all of which "worked" only because play mode boots in under 30 s.
//   Fixed everywhere to `waitForFunction(pred, null, {timeout})`.
//
// AND A THIRD: `page.screenshot({timeout: 120000})` was a hardcoded constant that
//   disagreed with --timeout. Now it follows TIMEOUT too.
//
// With all three fixed, `node scripts/shoot.mjs --piece=typeface-lettering` with NO FLAGS
// captures 6/6. Per scene on this box: 70-152 s to __BLITZ_READY__ (the accumulation
// render itself is 68-139 s of that) and a further 106-161 s for the screenshot, because
// SwiftShader's readback of a 1920x1080 layer pair is not fast. ~4 minutes per scene.
//
//   node scripts/shoot.mjs --scene=truck --out=shots/foundation.png
//   node scripts/shoot.mjs --all
//   node scripts/shoot.mjs --piece=pose-animation
//   node scripts/shoot.mjs --list
//   node scripts/shoot.mjs --progress-snapshot
//
// Readiness is engine-driven, never timer-driven:
//   await page.waitForFunction('window.__BLITZ_READY__===true', {timeout:240000})

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServerAuto } from './serve.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const PORT = 5178;

/* ------------------------------------------------------------------- args */

function parseArgs(argv) {
  const out = { _: [] };
  for (const a of argv) {
    if (a.startsWith('--')) {
      const i = a.indexOf('=');
      if (i < 0) out[a.slice(2)] = true;
      else out[a.slice(2, i)] = a.slice(i + 1);
    } else out._.push(a);
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));

const SCENE = args.scene || null;
const SEED = args.seed !== undefined ? String(args.seed) : '7';
const T = args.t !== undefined ? String(args.t) : '0';
const VARIANT = args.variant !== undefined && args.variant !== true ? String(args.variant) : '';
const Wpx = Number(args.w || 1920);
const Hpx = Number(args.h || 1080);
const LAYER = args.layer && args.layer !== true ? String(args.layer) : 'all';
const ACCUM = args.accum !== undefined ? String(args.accum) : '32';
const WARMUP = args.warmup !== undefined ? String(args.warmup) : '8';
const QUALITY = args.quality && args.quality !== true ? String(args.quality) : 'capture';
const TIMEOUT = Number(args.timeout || 240000);

/* --------------------------------------------------------------- playwright */

async function loadPlaywright() {
  const candidates = [
    'playwright',
    '/opt/node22/lib/node_modules/playwright/index.mjs',
    '/usr/lib/node_modules/playwright/index.mjs',
    '/usr/local/lib/node_modules/playwright/index.mjs',
  ];
  for (const c of candidates) {
    try {
      const spec = c.startsWith('/') ? pathToFileURL(c).href : c;
      const m = await import(spec);
      if (m && (m.chromium || (m.default && m.default.chromium))) return m.chromium || m.default.chromium;
    } catch { /* try next */ }
  }
  throw new Error('playwright not found (tried bare import and /opt/node22/lib/node_modules)');
}

/* ------------------------------------------------------------- self-healing */

function log(...a) { console.log('[shoot]', ...a); }

function ensureDeps() {
  if (fs.existsSync(path.join(REPO, 'node_modules', 'three'))) return;
  log('node_modules missing — running npm ci');
  const lock = fs.existsSync(path.join(REPO, 'package-lock.json'));
  const r = spawnSync('npm', [lock ? 'ci' : 'install', '--no-audit', '--no-fund'], {
    cwd: REPO, stdio: 'inherit',
  });
  if (r.status !== 0) throw new Error('npm install failed');
}

function newestMtime(dir, exts, skip = new Set(['node_modules', 'dist', '.git', 'shots', 'bar', 'progress'])) {
  let newest = 0;
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (skip.has(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (!exts || exts.has(path.extname(e.name))) {
        const m = fs.statSync(p).mtimeMs;
        if (m > newest) newest = m;
      }
    }
  };
  walk(dir);
  return newest;
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Cross-process build mutex. 16 builder agents may call shoot.mjs at once; without
 * this they would run concurrent `vite build`s into the same dist/ and tear it up.
 * Stale locks (>240 s) are broken so a killed agent can't wedge everyone.
 */
function withBuildLock(fn) {
  const lockPath = path.join(REPO, '.build.lock');
  const deadline = Date.now() + 300000;
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      try { return fn(); } finally { try { fs.unlinkSync(lockPath); } catch { /* already gone */ } }
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let age = 0;
      try { age = Date.now() - fs.statSync(lockPath).mtimeMs; } catch { continue; }
      if (age > 240000) { try { fs.unlinkSync(lockPath); } catch { /* raced */ } continue; }
      if (Date.now() > deadline) { try { fs.unlinkSync(lockPath); } catch { /* raced */ } continue; }
      log('another agent is building — waiting for the build lock');
      sleepSync(1500);
    }
  }
}

function ensureBuild() {
  const distIndex = path.join(REPO, 'dist', 'index.html');
  const srcNewest = Math.max(
    newestMtime(path.join(REPO, 'src'), new Set(['.js', '.json', '.glsl'])),
    fs.existsSync(path.join(REPO, 'index.html')) ? fs.statSync(path.join(REPO, 'index.html')).mtimeMs : 0,
    fs.existsSync(path.join(REPO, 'vite.config.js')) ? fs.statSync(path.join(REPO, 'vite.config.js')).mtimeMs : 0,
    fs.existsSync(path.join(REPO, 'package.json')) ? fs.statSync(path.join(REPO, 'package.json')).mtimeMs : 0,
  );
  const distTime = fs.existsSync(distIndex) ? fs.statSync(distIndex).mtimeMs : 0;
  if (distTime > srcNewest) return;
  withBuildLock(() => {
    // re-check: another agent may have built it while we waited for the lock
    const now = fs.existsSync(distIndex) ? fs.statSync(distIndex).mtimeMs : 0;
    if (now > srcNewest) return;
    log('dist stale — running vite build');
    const r = spawnSync(process.execPath, [path.join(REPO, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], {
      cwd: REPO, stdio: 'inherit', env: Object.assign({}, process.env, { NODE_ENV: 'production' }),
    });
    if (r.status !== 0) throw new Error('vite build failed');
  });
}

/* ------------------------------------------------------------------ capture */

function sceneUrl(base, o) {
  const q = new URLSearchParams({
    scene: o.scene,
    seed: String(o.seed !== undefined ? o.seed : SEED),
    t: String(o.t !== undefined ? o.t : T),
    quality: o.quality || QUALITY,
    accum: String(o.accum !== undefined ? o.accum : ACCUM),
    warmup: String(o.warmup !== undefined ? o.warmup : WARMUP),
    w: String(o.w || Wpx),
    h: String(o.h || Hpx),
    layer: o.layer || LAYER,
  });
  if (o.variant || VARIANT) q.set('variant', o.variant || VARIANT);
  if (args.hud !== undefined) q.set('hud', String(args.hud));
  if (args.ui !== undefined) q.set('ui', String(args.ui));
  if (args.debug !== undefined) q.set('debug', '1');
  return `${base}/?${q.toString()}`;
}

const LAUNCH_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--force-device-scale-factor=1',
  '--hide-scrollbars',
  '--disable-lcd-text',
  '--font-render-hinting=none',
  // NOTE: --deterministic-mode is deliberately NOT passed. It makes Chromium's
  // compositor single-threaded-deterministic and made page.screenshot() hang for
  // minutes under SwiftShader. Determinism comes from the engine (seeded RNG +
  // pure-function-of-t animation), not from the browser.
];

async function withBrowser(fn) {
  const chromium = await loadPlaywright();
  const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

async function newPage(browser, w, h) {
  const context = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    colorScheme: 'dark',
    timezoneId: 'UTC',
    locale: 'en-US',
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('[page:error]', e.message));
  page.on('console', (m) => {
    const t = m.type();
    if (t === 'error' || t === 'warning') console.error(`[page:${t}]`, m.text());
  });
  return { page, context };
}

async function readyStats(page) {
  await page.waitForFunction('window.__BLITZ_READY__===true', null, { timeout: TIMEOUT });
  return page.evaluate(() => ({
    stats: window.__BLITZ_STATS__ || null,
    error: window.__BLITZ_ERROR__ || null,
    errors: window.__BLITZ_ERRORS__ || [],
  }));
}

async function listScenes(browser, base) {
  const { page, context } = await newPage(browser, 400, 300);
  await page.goto(`${base}/?list=1&scene=truck`, { waitUntil: 'commit', timeout: TIMEOUT });
  await page.waitForFunction('window.__BLITZ_READY__===true', null, { timeout: TIMEOUT });
  const data = await page.evaluate(() => ({
    scenes: window.__BLITZ_SCENES__ || [],
    pieces: window.__BLITZ_PIECES__ || [],
    provenance: window.__BLITZ_PROVENANCE__ || {},
    error: window.__BLITZ_ERROR__ || null,
  }));
  await context.close();
  return data;
}

async function shootOne(browser, base, o) {
  const url = sceneUrl(base, o);
  const { page, context } = await newPage(browser, o.w || Wpx, o.h || Hpx);
  let info = null;
  try {
    const tNav = Date.now();
    await page.goto(url, { waitUntil: 'commit', timeout: TIMEOUT });
    info = await readyStats(page);
    const tReady = Date.now();
    const outPath = path.resolve(REPO, o.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    // clip-based page screenshot: no scroll-into-view, no stability wait, exact pixels
    // The screenshot budget follows --timeout instead of being pinned at 120 s. Under
    // SwiftShader the compositor's readback of a 1920x1080 layer pair is itself slow, and
    // for the heaviest scenes it exceeded the old constant. A capture command whose two
    // internal deadlines disagree with its own --timeout flag fails for reasons that have
    // nothing to do with the scene.
    await page.screenshot({
      path: outPath,
      animations: 'disabled',
      timeout: TIMEOUT,
      clip: { x: 0, y: 0, width: o.w || Wpx, height: o.h || Hpx },
    });
    const size = fs.statSync(outPath).size;
    const st = info.stats || {};
    // Ready time is printed per scene so a slow capture is visible as a slow capture
    // rather than as a mysterious navigation timeout later.
    log(`${o.scene} -> ${o.out}  (${size} B, ${st.ms || '?'}ms render, ${((tReady - tNav) / 1000).toFixed(1)}s to ready, `
      + `${((Date.now() - tReady) / 1000).toFixed(1)}s to png, ${st.tris || '?'} tris, ${st.drawCalls || '?'} calls${info.error ? ', PAGE ERROR' : ''})`);
    if (info.error) console.error('[shoot] page error:', info.error);
    if (info.errors && info.errors.length) {
      for (const e of info.errors.slice(0, 8)) console.error('[shoot] runtime:', e);
    }
    return { out: o.out, url, size, stats: st, error: info.error || null };
  } finally {
    await context.close();
  }
}

/* -------------------------------------------------------- progress snapshot */

function progressSnapshot() {
  const r = spawnSync(process.execPath, [path.join(REPO, 'tools', 'progress.mjs'), '--inline', '--out=progress/index.built.html'], {
    cwd: REPO, stdio: 'inherit',
  });
  if (r.status !== 0) throw new Error('progress snapshot failed');
  log('wrote progress/index.built.html');
}

/* -------------------------------------------------------------------- main */

async function main() {
  if (args['progress-snapshot']) { progressSnapshot(); return; }

  ensureDeps();
  ensureBuild();

  const srv = await startServerAuto(path.join(REPO, 'dist'), PORT);
  log(`serving dist at ${srv.url}`);

  try {
    await withBrowser(async (browser) => {
      const index = await listScenes(browser, srv.url);
      if (index.error) console.error('[shoot] boot error while listing:', index.error);

      if (args.list) {
        const rows = index.scenes.map((s) =>
          `  ${s.id.padEnd(28)} ${String(s.kind).padEnd(5)} ${(s.piece || '-').padEnd(20)} panel:${s.panel || '-'}`);
        console.log(`\n${index.scenes.length} registered scenes:\n${rows.join('\n')}\n`);
        console.log('pieces:');
        for (const p of index.pieces) {
          console.log(`  ${p.id.padEnd(22)} scenes: ${p.scenes.join(', ') || '(none yet)'}`);
        }
        console.log('\nslot provenance:');
        for (const [k, v] of Object.entries(index.provenance)) console.log(`  ${k.padEnd(20)} ${v}`);
        return;
      }

      let jobs = [];
      if (args.all) {
        jobs = index.scenes.map((s) => ({ scene: s.id, out: `shots/all/${s.id}.png` }));
      } else if (args.piece) {
        const pid = String(args.piece);
        const p = index.pieces.find((x) => x.id === pid);
        if (!p) throw new Error(`unknown piece "${pid}". Known: ${index.pieces.map((x) => x.id).join(', ')}`);
        const list = p.scenes.length ? p.scenes : p.heroes;
        if (!list.length) throw new Error(`piece "${pid}" declares no scenes`);
        jobs = list.map((s) => ({ scene: s, out: `shots/${pid}/${s}.png` }));
      } else if (SCENE) {
        jobs = [{ scene: SCENE, out: args.out && args.out !== true ? String(args.out) : `shots/all/${SCENE}.png` }];
      } else {
        console.error('nothing to do. Use --scene=<id> | --all | --piece=<id> | --list');
        process.exitCode = 2;
        return;
      }

      const results = [];
      for (const j of jobs) results.push(await shootOne(browser, srv.url, j));
      const failed = results.filter((r) => r.error || !r.size);
      log(`${results.length - failed.length}/${results.length} captures OK`);
      if (failed.length) process.exitCode = 1;
    });
  } finally {
    await srv.close();
  }
}

main().catch((e) => {
  console.error('[shoot] FAILED:', e && (e.stack || e.message || e));
  process.exit(1);
});
