#!/usr/bin/env node
// touch-controller CAPTURE.
//
// WHY THIS EXISTS AND WHY `scripts/shoot.mjs --layer=overlay` IS NOT ENOUGH.
//
// The capture path (`?mode=capture`) builds its overlay with `createOverlay()`, which
// draws the HUD, the callout and any menu screen — and has no controller hook at all.
// Only the RUNTIME overlay (`createRuntimeOverlay()`, `?mode=play`) calls
// `REG.controller.draw()`. Both are foundation-owned and not this piece's to change. So
// `shoot.mjs --piece=touch-controller --layer=overlay` renders this piece's two hero
// scenes without the controller in them, which is worth knowing but is not evidence.
//
// This drives the REAL RUNTIME with REAL DISPATCHED TOUCHES on a mobile context at a
// real phone's CSS size, and photographs what a thumb actually produces. That is
// strictly better evidence than a capture still would have been: the controls in these
// PNGs are lit because a finger is on them.
//
//   node shots/touch-controller/_shoot.mjs

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  REPO, TIER_THROTTLE, TIER_DPR, LAUNCH_ARGS, parseArgs, loadPlaywright,
  ensureBuild, newMobilePage, setCpuThrottle, playUrl,
} from '../../scripts/harness.mjs';

const { startServerAuto } = await import(pathToFileURL(path.join(REPO, 'scripts/serve.mjs')).href);

const args = parseArgs(process.argv.slice(2));
const TIER = (args.tier && args.tier !== true) ? String(args.tier) : 'mid';
const PORT = Number(args.port || 5197);
const OUT = path.join(REPO, 'shots/touch-controller');
const L = (s) => console.log(`[ctrl-shoot] ${s}`);

fs.mkdirSync(OUT, { recursive: true });
ensureBuild(L);
const srv = await startServerAuto(path.join(REPO, 'dist'), PORT);
const chromium = await loadPlaywright();
const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });

/** Keep a timing window perpetually open so the ACTION pad's timing arc is on camera. */
const HOLD_WINDOW = (twName, band) => `(() => {
  const C = window.__BLITZ_CTRL__; const st = C && C._draw; if (!st) return 'no state';
  clearInterval(window.__armLoop__);
  window.__armLoop__ = setInterval(() => {
    C.clearArmed(st);
    // Peak placed so that the CURRENT tick sits in the requested band of the window.
    C.arm(st, C.TW.${twName}, st.lastTick + ${band});
  }, 40);
  return 'armed';
})()`;

const SET_TARGETS = (w, h) => `(() => {
  const C = window.__BLITZ_CTRL__; const st = C && C._draw; if (!st) return 'no state';
  // Four eligible receivers and a passer, in CSS px, laid out the way they would sit on
  // screen during a dropback. play-sim would normally publish these every tick.
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

const SET_SIDE = (side) => `(() => {
  const C = window.__BLITZ_CTRL__; const st = C && C._draw; if (!st) return 'no state';
  C.setContext(st, C.SIDE.${side}); st.changeTick = st.lastTick - 1; return 'side';
})()`;

const DRAIN_FUEL = (frac) => `(() => {
  const C = window.__BLITZ_CTRL__; const st = C && C._draw; if (!st) return 'no state';
  st.fuel = Math.round(${frac} * C.TUNING.fuelMax); return st.fuel;
})()`;

/** `--only=idle,pass` re-shoots a subset. Each scene costs ~2 min on this box. */
const ONLY = (args.only && args.only !== true) ? String(args.only).split(',') : null;

async function shoot(name, vw, vh, script) {
  if (ONLY && !ONLY.some((k) => name.includes(k))) return;
  const { page, cdp, context, errors } = await newMobilePage(browser, {
    width: vw, height: vh, dpr: TIER_DPR[TIER],
  });
  const url = playUrl(srv.url, { scene: 'live_play', tier: TIER, seed: 7, probe: false });
  await page.goto(url, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction('window.__BLITZ_READY__===true', null, { timeout: 300000 });
  await setCpuThrottle(cdp, TIER_THROTTLE[TIER]);
  await page.waitForTimeout(1500);

  const T = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points }).catch(() => { });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const info = await page.evaluate(() => ({ zones: window.__BLITZ_PERF__.zones }));
  const Z = {};
  for (const r of info.zones) Z[r[0]] = { x: ((r[1] + r[3]) / 2) * vw, y: ((r[2] + r[4]) / 2) * vh };

  await script({ page, T, wait, Z, vw, vh });
  await wait(220);

  const out = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: out, animations: 'disabled', timeout: 240000, clip: { x: 0, y: 0, width: vw, height: vh } });
  L(`${name}.png  ${vw}x${vh}  ${fs.statSync(out).size} B${errors.length ? `  PAGE ERRORS: ${errors.slice(0, 2).join(' | ')}` : ''}`);
  await context.close();
}

try {
  /* ---- 1. IDLE. Nothing pressed: the ghost pocket, the three right-thumb controls,
   *          a full turbo lozenge. This is the screen a player sees at the snap. ---- */
  await shoot('iso_controller_idle', 390, 844, async () => { });

  /* ---- 2. LIVE, CARRYING. Left thumb planted mid-pad and pushed up-right (note the
   *          well is drawn where the thumb LANDED, not at the pad's home), right thumb
   *          holding TURBO with the meter half burnt, and a JUKE window open with the
   *          timing arc in its PERFECT band. ---- */
  await shoot('iso_controller_live', 390, 844, async ({ page, T, wait, Z, vw, vh }) => {
    await page.evaluate(SET_SIDE('CARRY'));
    await T('touchStart', [{ x: Z[1].x - 30, y: Z[1].y + 40, id: 1 }]);
    await T('touchMove', [{ x: Z[1].x - 30, y: Z[1].y + 40, id: 1 }, { x: Z[4].x, y: Z[4].y, id: 2 }]);
    await T('touchStart', [{ x: Z[1].x - 30, y: Z[1].y + 40, id: 1 }, { x: Z[4].x, y: Z[4].y, id: 2 }]);
    await T('touchMove', [{ x: Z[1].x + 20, y: Z[1].y - 22, id: 1 }, { x: Z[4].x, y: Z[4].y, id: 2 }]);
    await wait(140);
    await page.evaluate(DRAIN_FUEL(0.52));
    await page.evaluate(HOLD_WINDOW('JUKE', 0));
    await wait(200);
    void vw; void vh;
  });

  /* ---- 3. AIMING A PASS. PASS held, the four receiver icons up, the bearing cone drawn
   *          FROM THE PASSER (which is where the selection is actually measured), the
   *          aim ray off the pad, and the selected man's icon hot. ---- */
  await shoot('iso_controller_pass', 390, 844, async ({ page, T, wait, Z }) => {
    await page.evaluate(SET_SIDE('QB'));
    await page.evaluate(SET_TARGETS(390, 844));
    await T('touchStart', [{ x: Z[1].x, y: Z[1].y, id: 1 }]);
    await T('touchStart', [{ x: Z[1].x, y: Z[1].y, id: 1 }, { x: Z[3].x, y: Z[3].y, id: 2 }]);
    await T('touchMove', [{ x: Z[1].x - 26, y: Z[1].y + 10, id: 1 }, { x: Z[3].x + 34, y: Z[3].y - 30, id: 2 }]);
    await wait(200);
  });

  /* ---- 4. DEFENCE. The same pad, a different legend ring and a different centre: the
   *          one control that carries eleven actions, showing the four it carries now.
   *          A HIT-STICK window is open and LATE, so the arc is in its late colour. ---- */
  await shoot('iso_controller_defence', 390, 844, async ({ page, T, wait, Z }) => {
    await page.evaluate(SET_SIDE('DEF'));
    await T('touchStart', [{ x: Z[2].x, y: Z[2].y, id: 1 }]);
    await page.evaluate(HOLD_WINDOW('HIT_STICK', -4));
    await wait(220);
  });

  /* ---- 5. LANDSCAPE. The identical PHYSICAL geometry on a 844x390 surface — the whole
   *          point of anchoring the layout in CSS px to the two bottom corners. ---- */
  await shoot('iso_controller_landscape', 844, 390, async ({ page, T, wait, Z }) => {
    await page.evaluate(SET_SIDE('CARRY'));
    await T('touchStart', [{ x: Z[1].x + 24, y: Z[1].y - 10, id: 1 }]);
    await T('touchStart', [{ x: Z[1].x + 24, y: Z[1].y - 10, id: 1 }, { x: Z[4].x, y: Z[4].y, id: 2 }]);
    await T('touchMove', [{ x: Z[1].x + 60, y: Z[1].y - 34, id: 1 }, { x: Z[4].x, y: Z[4].y, id: 2 }]);
    await wait(140);
    await page.evaluate(DRAIN_FUEL(0.30));
    await page.evaluate(HOLD_WINDOW('DIVE_CATCH', -2));
    await wait(200);
  });
} catch (e) {
  console.error('[ctrl-shoot] FAILED:', e && (e.stack || e.message || e));
  process.exitCode = 1;
} finally {
  await browser.close();
  await srv.close();
}
