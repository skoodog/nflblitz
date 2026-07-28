#!/usr/bin/env node
// FOUNDATION — FROZEN after t=0. Do not edit.
//
// Side-by-side against the bar, without ImageMagick or PIL (neither exists here).
// Screenshots compare.html, which scales BOTH images to an identical 720 px height.
//
//   node scripts/compare.mjs --panel=truck --shot=shots/pose-animation/truck.png \
//                            --out=shots/pose-animation/cmp-truck.png
//   ... --wipe=0.5            single split composite with a seam
//   ... --crop=hud|callout|turbo|face|left|right
//   ... --h=720 --label=OURS
//
// Panel names are the bar/panel-<name>.png suffixes:
//   title qb_dropback midair_hit team_select truck defense_playcall
//   leveler touchdown uniform catch

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServerAuto } from './serve.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const PORT = 5179;

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

const PANEL = args.panel && args.panel !== true ? String(args.panel) : 'truck';
const SHOT = args.shot && args.shot !== true ? String(args.shot) : '';
const OUT = args.out && args.out !== true ? String(args.out) : `shots/cmp-${PANEL}.png`;
const H = String(args.h || 720);

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
    } catch { /* next */ }
  }
  throw new Error('playwright not found');
}

async function main() {
  const barFile = path.join(REPO, 'bar', `panel-${PANEL}.png`);
  if (!fs.existsSync(barFile)) {
    const have = fs.readdirSync(path.join(REPO, 'bar'))
      .filter((f) => f.startsWith('panel-'))
      .map((f) => f.replace(/^panel-|\.png$/g, ''));
    throw new Error(`unknown --panel="${PANEL}". Available: ${have.join(', ')}`);
  }
  if (SHOT && !fs.existsSync(path.resolve(REPO, SHOT))) {
    console.warn(`[compare] warning: shot not found (${SHOT}) — rendering a labelled placeholder`);
  }

  const srv = await startServerAuto(REPO, PORT);
  const chromium = await loadPlaywright();
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--force-device-scale-factor=1', '--hide-scrollbars', '--font-render-hinting=none'],
  });
  try {
    const q = new URLSearchParams({ panel: PANEL, h: H });
    if (SHOT) q.set('shot', SHOT.replace(/^\.?\//, ''));
    if (args.wipe !== undefined) q.set('wipe', String(args.wipe === true ? 0.5 : args.wipe));
    if (args.crop && args.crop !== true) q.set('crop', String(args.crop));
    if (args.label && args.label !== true) q.set('label', String(args.label));
    if (args.gutter !== undefined) q.set('gutter', String(args.gutter));

    const url = `${srv.url}/compare.html?${q.toString()}`;
    const ctx = await browser.newContext({
      viewport: { width: 2400, height: Number(H) + 40 },
      deviceScaleFactor: 1, colorScheme: 'dark',
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('[compare:page]', e.message));
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction('window.__CMP_READY__===true', null, { timeout: 60000 });

    const outPath = path.resolve(REPO, OUT);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const el = await page.$('#wrap');
    await el.screenshot({ path: outPath });
    console.log(`[compare] ${PANEL} vs ${SHOT || '(none)'} -> ${OUT} (${fs.statSync(outPath).size} B)`);
    console.log(`[compare] url: ${url}`);
    await ctx.close();
  } finally {
    await browser.close();
    await srv.close();
  }
}

main().catch((e) => {
  console.error('[compare] FAILED:', e && (e.stack || e.message || e));
  process.exit(1);
});
