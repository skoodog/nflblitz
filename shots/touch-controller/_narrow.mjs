#!/usr/bin/env node
// touch-controller NARROW-SURFACE CAPTURE.
//
// The layout is fixed CSS px at or above 360 CSS px of narrow dimension, and below that
// `layoutZones()` applies one uniform scale (see layout.js). That scale moves the HIT
// RECTANGLES, and `draw.js` has to move the ARTWORK by exactly the same factor or the two
// come apart — a control drawn bigger than the region that responds to it, which is the
// same defect as drawing it in a different place.
//
// Geometry is asserted headlessly in `_selftest.mjs`. This is the other half: a picture,
// at the two sizes either side of the scale boundary, so "the artwork tracks the hit
// rectangle" is something a critic can LOOK at rather than take on arithmetic.
//
//   node shots/touch-controller/_narrow.mjs

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  REPO, TIER_DPR, LAUNCH_ARGS, parseArgs, loadPlaywright,
  ensureBuild, newMobilePage, playUrl,
} from '../../scripts/harness.mjs';

const { startServerAuto } = await import(pathToFileURL(path.join(REPO, 'scripts/serve.mjs')).href);

const args = parseArgs(process.argv.slice(2));
const TIER = (args.tier && args.tier !== true) ? String(args.tier) : 'mid';
const PORT = Number(args.port || 5197);
const OUT = path.join(REPO, 'shots/touch-controller');
const L = (s) => console.log(s);

ensureBuild((s) => L(`[narrow] ${s}`));
const srv = await startServerAuto(path.join(REPO, 'dist'), PORT);
const chromium = await loadPlaywright();
const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });

/** Raise the receiver icons and hold PASS, which is the busiest the controller ever looks. */
const TARGETS = (w, h) => `(() => {
  const C = window.__BLITZ_CTRL__; const st = C && C._draw; if (!st) return 'no state';
  const W = ${w}, H = ${h};
  const P = [[0.20, 0.32, 90, 210], [0.47, 0.22, 91, 130], [0.78, 0.34, 92, 245], [0.90, 0.56, 93, 70]];
  for (let i = 0; i < P.length; i++) {
    st.tgtX[i] = P[i][0] * W; st.tgtY[i] = P[i][1] * H;
    st.tgtId[i] = P[i][2]; st.tgtOpen[i] = P[i][3];
  }
  st.tgtPrimary = 1;
  C.setTargets(st, 4, 0.50 * W, 0.62 * H);
  return 'targets';
})()`;

/**
 * Paint the HIT RECTANGLES straight onto the page, from the LIVE controller's own
 * `ZONE_RECTS`, as thin outlines. That is the whole point of the capture: the outline is
 * the region that responds and the sprite under it is the region the player can see, so
 * any divergence between them is visible instead of arithmetic.
 */
const OVERLAY_RECTS = `(() => {
  const C = window.__BLITZ_CTRL__; if (!C) return 'no ctrl';
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99999';
  const COL = { 1: '#29c8ff', 2: '#ffc61e', 3: '#ff8a3d', 4: '#7ad14f' };
  for (const r of C.ZONE_RECTS) {
    const b = document.createElement('div');
    b.style.cssText = 'position:absolute;border:1.5px dashed ' + COL[r[0]]
      + ';left:' + (r[1] * 100) + '%;top:' + (r[2] * 100) + '%;width:' + ((r[3] - r[1]) * 100)
      + '%;height:' + ((r[4] - r[2]) * 100) + '%';
    d.appendChild(b);
  }
  document.body.appendChild(d);
  return C.ZONE_RECTS.length + ' rects, scale ' + C.FIT.scale.toFixed(4);
})()`;

async function shoot(name, vw, vh) {
  const { page, cdp, context, errors } = await newMobilePage(browser, {
    width: vw, height: vh, dpr: TIER_DPR[TIER],
  });
  const url = playUrl(srv.url, { scene: 'live_play', tier: TIER, seed: 7, probe: false });
  await page.goto(url, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction('window.__BLITZ_READY__===true', null, { timeout: 300000 });
  await page.waitForTimeout(1500);

  const T = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points }).catch(() => { });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const info = await page.evaluate(() => ({
    zones: window.__BLITZ_PERF__.zones,
    scale: window.__BLITZ_CTRL__.FIT.scale,
  }));
  const Z = {};
  for (const r of info.zones) Z[r[0]] = { x: ((r[1] + r[3]) / 2) * vw, y: ((r[2] + r[4]) / 2) * vh };

  await page.evaluate(TARGETS(vw, vh));
  // left thumb in the pocket, right thumb holding PASS with the icons up
  await T('touchStart', [{ x: Z[1].x, y: Z[1].y, id: 1 }]);
  await T('touchStart', [{ x: Z[1].x, y: Z[1].y, id: 1 }, { x: Z[3].x, y: Z[3].y, id: 2 }]);
  await T('touchMove', [{ x: Z[1].x - 22, y: Z[1].y + 14, id: 1 }, { x: Z[3].x + 30, y: Z[3].y - 26, id: 2 }]);
  await wait(260);
  const rects = await page.evaluate(OVERLAY_RECTS);
  await wait(160);

  const out = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: out, animations: 'disabled', timeout: 240000, clip: { x: 0, y: 0, width: vw, height: vh } });
  L(`${name}.png  ${vw}x${vh}  layout scale ${info.scale.toFixed(4)}  ${rects}  ${fs.statSync(out).size} B`
    + `${errors.length ? `  PAGE ERRORS: ${errors.slice(0, 2).join(' | ')}` : ''}`);
  await context.close();
}

try {
  await shoot('narrow_390x844', 390, 844);   // scale 1.0000 — the reference
  await shoot('narrow_360x640', 360, 640);   // scale 1.0000 — the modal Android, exact
  await shoot('narrow_320x568', 320, 568);   // scale 0.8889 — the only scaled surface
} finally {
  await browser.close();
  await srv.close();
}
