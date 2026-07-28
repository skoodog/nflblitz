#!/usr/bin/env node
// STRUCTURAL BUDGET — the ONLY gate on the GPU axis.
//
//   node scripts/budget.mjs --scene=live_play --tier=all
//   node scripts/budget.mjs --scene=perf_synthetic --tier=floor
//   node scripts/budget.mjs --scene=live_play --tier=mid --canary   (prove the gate bites)
//
// This box CANNOT measure GPU cost — measured here, a shadowed MeshStandardMaterial
// scene costs roughly 100 ms per megapixel under SwiftShader, and the frame interval
// barely moves when the framebuffer shrinks because the cost is per-triangle and
// per-draw-call. So the GPU axis is not measured, it is GOVERNED: hard per-tier caps
// that are COUNTED, and attributed to a piece by name through `userData.piece`.
//
// Exits 1 naming the piece, the metric, the count and the cap on any violation.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  REPO, TIER_DPR, LAUNCH_ARGS, parseArgs, loadPlaywright,
  ensureBuild, newMobilePage, fmt, pass, playUrl,
} from './harness.mjs';

const { startServerAuto } = await import(pathToFileURL(path.join(REPO, 'scripts/serve.mjs')).href);

const args = parseArgs(process.argv.slice(2));
const SCENE = (args.scene && args.scene !== true) ? String(args.scene) : 'live_play';
const TIER_ARG = (args.tier && args.tier !== true) ? String(args.tier) : 'all';
const ONLY_PIECE = (args.piece && args.piece !== true) ? String(args.piece) : null;
const CANARY = !!args.canary;
const JSON_OUT = !!args.json;
const PORT = Number(args.port || 5183);
const TIERS_TO_RUN = TIER_ARG === 'all' ? ['floor', 'low', 'mid', 'high'] : [TIER_ARG];

const L = (s) => { if (!JSON_OUT) console.log(s); };

ensureBuild(JSON_OUT ? null : ((s) => L(`[budget] ${s}`)));
const srv = await startServerAuto(path.join(REPO, 'dist'), PORT);
const chromium = await loadPlaywright();
const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });

let exitCode = 0;
const violations = [];
const all = {};

try {
  for (const tier of TIERS_TO_RUN) {
    const { page, context, errors } = await newMobilePage(browser, {
      width: 390, height: 844, dpr: TIER_DPR[tier],
    });
    const url = playUrl(srv.url, {
      scene: SCENE, tier, raster: 'auto', seed: 7, probe: false,
      canary: CANARY, autostart: false,   // no loop: we only need the built scene
    });
    await page.goto(url, { waitUntil: 'load', timeout: 300000 });
    await page.waitForFunction('window.__BLITZ_READY__===true', null, { timeout: 300000 });

    const R = await page.evaluate(() => {
      const P = window.__BLITZ_PERF__;
      const rep = P.countScene();
      return {
        rep, rung: P.rung, tier: P.tier,
        programs: P.programCount,
        buffer: P.bufferSize, css: P.cssSize,
      };
    });

    // Overdraw is COUNTED, not guessed: a real additive pass at 1/4 scale, read back
    // and averaged over covered pixels. Depth test stays ON so fragments that would be
    // rejected are not billed as overdraw nobody paid for.
    let overdraw = null;
    try {
      overdraw = await page.evaluate(() => {
        const P = window.__BLITZ_PERF__;
        return P.measureOverdraw ? P.measureOverdraw() : null;
      });
    } catch { overdraw = null; }
    if (overdraw && overdraw.error) overdraw = null;

    const caps = await page.evaluate((t) => {
      const q = window.__BLITZ_QUALITY__;
      return q ? q.TIERS[t].caps : null;
    }, tier);

    await context.close();

    const C = caps;
    const rep = R.rep;
    const rows = [];
    const chk = (metric, value, cap, d) => {
      const ok = value <= cap + 1e-9;
      rows.push({ metric, value, cap, ok, d: d || 0 });
      if (!ok) {
        exitCode = 1;
        violations.push({ tier, metric, value, cap, piece: null });
      }
      return ok;
    };

    L('');
    L(`TIER ${tier.padEnd(6)} rung ${R.rung}   internal ${R.buffer.w}x${R.buffer.h} of css ${R.css.w}x${R.css.h}   scene "${SCENE}"`);
    if (!C) { L('  (could not read caps)'); continue; }

    chk('draw calls', rep.drawCalls, C.drawCalls);
    chk('triangles', rep.triangles, C.triangles);
    chk('programs', rep.programs, C.programs);
    chk('texture MB', rep.textureMB, C.textureMB, 1);
    chk('render targets', rep.renderTargets, C.renderTargets);   // upper bound: post passes
    chk('particles', rep.particles, C.particles);
    chk('shadow casters', rep.shadowCasterDraws, C.shadowCasters);
    chk('skinned actors', rep.skinned, C.skinned);
    if (overdraw && overdraw.avg) chk('avg overdraw', overdraw.avg, C.overdraw, 2);

    for (let i = 0; i < rows.length; i += 2) {
      const a = rows[i], b = rows[i + 1];
      const cell = (r) => r
        ? `${r.metric.padEnd(15)} ${fmt(r.value, 9, r.d)} / ${fmt(r.cap, 8, r.d)}  ${pass(r.ok)}`
        : '';
      L(`  ${cell(a)}   ${cell(b)}`);
    }

    L('  BY PIECE               calls      tris       tex     skin  particles');
    const sorted = rep.byPiece.slice().sort((x, y) => y.drawCalls - x.drawCalls);
    for (const p of sorted) {
      if (ONLY_PIECE && p.piece !== ONLY_PIECE) continue;
      L(`    ${p.piece.padEnd(22)}${String(p.drawCalls).padStart(5)} ${String(p.triangles).padStart(9)} ${fmt(p.textureMB, 7, 1)}MB ${String(p.skinned).padStart(5)} ${String(p.particles).padStart(9)}`);
    }
    if (rep.unattributed) {
      L(`    *** ${rep.unattributed} drawable(s) with NO userData.piece — every scene object must be tagged`);
    }
    if (errors.length) for (const e of errors.slice(0, 3)) L(`    page error: ${e}`);
    all[tier] = { rep, rows, overdraw };

    // Name the offending piece for every violated metric.
    for (const r of rows) {
      if (r.ok) continue;
      let worst = null;
      for (const p of rep.byPiece) {
        const v = r.metric === 'draw calls' ? p.drawCalls
          : r.metric === 'triangles' ? p.triangles
            : r.metric === 'texture MB' ? p.textureMB
              : r.metric === 'shadow casters' ? p.shadowCasterDraws
                : r.metric === 'particles' ? p.particles
                  : r.metric === 'skinned actors' ? p.skinned : 0;
        if (!worst || v > worst.v) worst = { piece: p.piece, v };
      }
      const line = `FAIL(${tier}) ${r.metric}: ${r.value} exceeds cap ${r.cap}`
        + (worst && worst.v > 0 ? `  — largest contributor: ${worst.piece} (${r.metric === 'texture MB' ? worst.v.toFixed(1) + 'MB' : worst.v})` : '');
      L(`  ${line}`);
      violations[violations.length - 1].piece = worst ? worst.piece : null;
    }
  }

  if (JSON_OUT) console.log(JSON.stringify({ scene: SCENE, tiers: all, violations }, null, 2));
  else {
    L('');
    if (violations.length) {
      L(`VERDICT  FAIL — ${violations.length} structural violation(s)`);
      for (const v of violations) {
        L(`  ${v.tier.padEnd(6)} ${v.metric.padEnd(15)} ${typeof v.value === 'number' ? v.value.toFixed(2) : v.value} > ${v.cap}` +
          (v.piece ? `   piece: ${v.piece}` : ''));
      }
    } else {
      L('VERDICT  PASS — every tier inside its structural caps');
    }
    L('');
    L('NOTE: these are COUNTS, not GPU timings. This box cannot measure GPU cost.');
    L('      The counts are the whole gate on the GPU axis: this box cannot MEASURE');
    L('      GPU cost, so it GOVERNS it. README section 11, ASSUMPTION B.');
  }
} catch (e) {
  console.error('[budget] FAILED:', e && (e.stack || e.message || e));
  exitCode = 1;
} finally {
  await browser.close();
  await srv.close();
}
process.exit(exitCode);
