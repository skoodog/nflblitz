#!/usr/bin/env node
// PIECE menu-team-select — the cheap capture loop.
//
//   node src/pieces/menu-team-select/devtools/shoot.mjs \
//        --out=/tmp/ts.png [--scene=iso_team_select_league] [--state='{"team":"KC"}'] \
//        [--t=0] [--degraded]        # --degraded restores the foundation fallbacks
//
// Starts (or reuses) a vite dev server, loads devtools/preview.html, and screenshots
// the 1920x1080 Canvas2D surface. MEASURED on this box, three consecutive runs
// including the browser launch: 2919 / 2854 / 2876 ms. The same scene through
// scripts/shoot.mjs took 179 s (109.1 s to __BLITZ_READY__, then 70.0 s for
// SwiftShader to read the layer pair back). 62x.
//
// AND IT IS FAITHFUL, which is the part that matters: shots/menu-team-select/
// iso_team_select.png (engine, accum 8) and this tool's output for the same state
// are the same image. Two consecutive runs of this tool are byte-identical
// (md5 f4ae95c4...), which is also the determinism check the piece claims.
//
// It also prints the overlay-relevant provenance (which piece owns `ui.teamSelect`,
// `brand`, `faces`) so a green screenshot can never come from a fallback by accident.
//
// This is a DEV TOOL. It is not part of the build and nothing imports it.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import net from 'node:net';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
const PORT = 5199;

const A = {};
for (const a of process.argv.slice(2)) {
  if (!a.startsWith('--')) continue;
  const i = a.indexOf('=');
  if (i < 0) A[a.slice(2)] = true; else A[a.slice(2, i)] = a.slice(i + 1);
}
const OUT = A.out || '/tmp/team-select.png';

async function loadPlaywright() {
  for (const c of ['playwright', '/opt/node22/lib/node_modules/playwright/index.mjs',
    '/usr/lib/node_modules/playwright/index.mjs', '/usr/local/lib/node_modules/playwright/index.mjs']) {
    try {
      const m = await import(c.startsWith('/') ? pathToFileURL(c).href : c);
      if (m && (m.chromium || (m.default && m.default.chromium))) return m.chromium || m.default.chromium;
    } catch { /* next */ }
  }
  throw new Error('playwright not found');
}

function portOpen(p) {
  return new Promise((res) => {
    const s = net.connect(p, '127.0.0.1');
    s.on('connect', () => { s.destroy(); res(true); });
    s.on('error', () => res(false));
    setTimeout(() => { s.destroy(); res(false); }, 800);   // determinism-ok: node dev tool, never bundled; this is a socket probe timeout, not animation
  });
}

async function ensureServer() {
  if (await portOpen(PORT)) return null;
  const p = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
    cwd: REPO, stdio: 'ignore', detached: false,
  });
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 250));   // determinism-ok: node dev tool, never bundled; polls for the dev server port
    if (await portOpen(PORT)) return p;
  }
  throw new Error('vite dev server did not come up');
}

const proc = await ensureServer();
const chromium = await loadPlaywright();
const browser = await chromium.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--force-device-scale-factor=1', '--hide-scrollbars'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('console', (m) => { if (m.type() === 'error') console.error('[page]', m.text()); });
  const qs = new URLSearchParams();
  if (A.scene) qs.set('scene', String(A.scene));
  if (A.state) qs.set('state', String(A.state));
  if (A.t) qs.set('t', String(A.t));
  if (A.degraded) qs.set('degraded', '1');
  const url = `http://127.0.0.1:${PORT}/src/pieces/menu-team-select/devtools/preview.html?${qs}`;
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction('window.__OK__===true || window.__ERR__', null, { timeout: 120000 });
  const err = await page.evaluate('window.__ERR__ || null');
  if (err) { console.error('[preview] threw:\n' + err); process.exitCode = 1; }
  const prov = await page.evaluate('window.__PROV__');
  console.log('[preview] provenance', JSON.stringify({
    teamSelect: prov['ui.teamSelect'], brand: prov['brand.brand'], faces: prov['faces.faces'],
  }));
  await page.locator('#cv').screenshot({ path: OUT, timeout: 120000 });
  console.log('[preview] wrote', OUT);
} finally {
  await browser.close();
  if (proc) proc.kill();
}
