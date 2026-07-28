// Shared harness plumbing for perf.mjs / touch.mjs / budget.mjs.
//
// One place that knows how to: find Playwright, build dist, serve it, launch Chromium
// with the SwiftShader flags, make a MOBILE context (viewport + DPR + isMobile +
// hasTouch + mobile UA), and apply CDP CPU throttling for a tier.
//
// CPU THROTTLING IS THE ONE HONEST DEVICE EMULATION THIS BOX HAS.
// `Emulation.setCPUThrottlingRate` was verified working here: rate=4 produced a
// measured 4.62x slowdown on a fixed workload. It is real V8 running real JS more
// slowly, so every ms it produces is a number that transfers to a phone's CPU. It says
// NOTHING about a phone's GPU, and no command in this harness pretends otherwise.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '..');

export const TIER_THROTTLE = { floor: 6, low: 4, mid: 2, high: 1 };
export const TIER_DPR = { floor: 1.0, low: 1.5, mid: 2.0, high: 2.0 };

export const LAUNCH_ARGS = [
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
  // performance.memory, so the heap/GC axis is measurable at all.
  '--enable-precise-memory-info',
  // Keep a backgrounded/occluded headless page running the loop at full rate.
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
];

export function parseArgs(argv) {
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

export async function loadPlaywright() {
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
  throw new Error('playwright not found');
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withBuildLock(fn) {
  const lockPath = path.join(REPO, '.build.lock');
  const deadline = Date.now() + 300000;
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      try { return fn(); } finally { try { fs.unlinkSync(lockPath); } catch { /* gone */ } }
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let age = 0;
      try { age = Date.now() - fs.statSync(lockPath).mtimeMs; } catch { continue; }
      if (age > 240000 || Date.now() > deadline) { try { fs.unlinkSync(lockPath); } catch { /* raced */ } continue; }
      sleepSync(1500);
    }
  }
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

export function ensureBuild(log) {
  if (!fs.existsSync(path.join(REPO, 'node_modules', 'three'))) {
    const lock = fs.existsSync(path.join(REPO, 'package-lock.json'));
    const r = spawnSync('npm', [lock ? 'ci' : 'install', '--no-audit', '--no-fund'], { cwd: REPO, stdio: 'inherit' });
    if (r.status !== 0) throw new Error('npm install failed');
  }
  const distIndex = path.join(REPO, 'dist', 'index.html');
  const srcNewest = Math.max(
    newestMtime(path.join(REPO, 'src'), new Set(['.js', '.json', '.glsl'])),
    fs.existsSync(path.join(REPO, 'index.html')) ? fs.statSync(path.join(REPO, 'index.html')).mtimeMs : 0,
    fs.existsSync(path.join(REPO, 'vite.config.js')) ? fs.statSync(path.join(REPO, 'vite.config.js')).mtimeMs : 0,
  );
  const distTime = fs.existsSync(distIndex) ? fs.statSync(distIndex).mtimeMs : 0;
  if (distTime > srcNewest) return;
  withBuildLock(() => {
    const now = fs.existsSync(distIndex) ? fs.statSync(distIndex).mtimeMs : 0;
    if (now > srcNewest) return;
    if (log) log('dist stale — running vite build');
    const r = spawnSync(process.execPath, [path.join(REPO, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], {
      cwd: REPO, stdio: log ? 'inherit' : 'ignore', env: Object.assign({}, process.env, { NODE_ENV: 'production' }),
    });
    if (r.status !== 0) throw new Error('vite build failed');
  });
}

/**
 * A MOBILE context: the viewport, DPR, touch capability and UA a phone reports.
 * `hasTouch` is what makes `Input.dispatchTouchEvent` deliver PointerEvents with
 * pointerType 'touch' instead of being ignored, so this is not cosmetic.
 */
export async function newMobilePage(browser, opts) {
  const o = opts || {};
  const context = await browser.newContext({
    viewport: { width: o.width || 390, height: o.height || 844 },
    deviceScaleFactor: o.dpr || 2,
    isMobile: true,
    hasTouch: true,
    userAgent: o.ua || 'Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 '
      + '(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    reducedMotion: 'no-preference',
    colorScheme: 'dark',
    timezoneId: 'UTC',
    locale: 'en-US',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => { errors.push(e.message); });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const cdp = await context.newCDPSession(page);
  return { page, context, cdp, errors };
}

/** Apply CDP CPU throttling. rate=1 is off. Returns the rate actually applied. */
export async function setCpuThrottle(cdp, rate) {
  const r = Math.max(1, Number(rate) || 1);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: r });
  return r;
}

/**
 * Verify the throttle is REAL rather than trusting the flag. Runs a fixed integer
 * workload in-page and returns the measured slowdown against an unthrottled baseline.
 * A harness that reports "6x throttle" without ever checking is a harness that lies.
 */
export async function measureThrottle(page, cdp, rate) {
  const work = () => {
    const t0 = performance.now();
    let s = 0;
    for (let i = 0; i < 4000000; i++) s += (i ^ (s >>> 3)) & 1023;
    return { ms: performance.now() - t0, s };
  };
  await setCpuThrottle(cdp, 1);
  const base = await page.evaluate(work);
  await setCpuThrottle(cdp, rate);
  const slow = await page.evaluate(work);
  return { baseMs: base.ms, throttledMs: slow.ms, measured: slow.ms / Math.max(0.001, base.ms) };
}

export function fmt(n, w, d) {
  const s = (n === null || n === undefined || !Number.isFinite(n)) ? '-' : n.toFixed(d === undefined ? 2 : d);
  return w ? s.padStart(w) : s;
}

export function pass(b) { return b ? 'PASS' : 'FAIL'; }

/** Build the runtime URL. Every harness command drives the game by URL alone. */
export function playUrl(base, o) {
  const q = new URLSearchParams();
  q.set('mode', 'play');
  q.set('scene', o.scene || 'live_play');
  q.set('seed', String(o.seed === undefined ? 7 : o.seed));
  if (o.tier) q.set('tier', o.tier);
  if (o.rung !== undefined && o.rung !== null) q.set('rung', String(o.rung));
  if (o.rate) q.set('rate', String(o.rate));
  if (o.raster) q.set('raster', o.raster);
  if (o.probe !== undefined) q.set('probe', o.probe ? '1' : '0');
  if (o.canary) q.set('canary', '1');
  if (o.autostart !== undefined) q.set('autostart', o.autostart ? '1' : '0');
  return `${base}/?${q.toString()}`;
}

export default {
  REPO, HERE, TIER_THROTTLE, TIER_DPR, LAUNCH_ARGS,
  parseArgs, loadPlaywright, ensureBuild, newMobilePage,
  setCpuThrottle, measureThrottle, fmt, pass, playUrl,
};
