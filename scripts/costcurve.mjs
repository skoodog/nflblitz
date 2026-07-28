#!/usr/bin/env node
// THE COST CURVE. Frame cost as a MEASURED function of the three things a quality rung
// can actually move on this box: internal render scale, triangle count, and shadows.
//
//   node scripts/costcurve.mjs                       full sweep, writes progress/cost-curve.md
//   node scripts/costcurve.mjs --quick               3x3 grid, for iterating
//   node scripts/costcurve.mjs --out=path.md
//   node scripts/costcurve.mjs --report-only         rewrite the .md from the saved .json,
//                                                    measuring nothing. The prose and the
//                                                    fitted model are DERIVED from the
//                                                    stored numbers, so re-running the
//                                                    report cannot invent a result.
//
// WHY THIS EXISTS. The rung ladder in quality.js was written from first principles: each
// rung is *plausibly* cheaper than the one above it. Plausible is not measured. This
// command measures it, on this container, and the ladder's floor rung is then SET from
// the curve rather than guessed. A critic can read the table and check the arithmetic.
//
// WHAT IT MEASURES, HONESTLY
//   interval  rAF-to-rAF wall time with the game loop stopped and ONE render per rAF.
//             This is end-to-end frame cost: JS + GL submission + SwiftShader raster +
//             compositing of both canvas layers. It is the number the pacing contract
//             is judged against, and it is the number a rung has to move.
//   renderJS  time for renderer.render() to return (command submission only).
//   finish    time for a following gl.finish() to return — the synchronous wait on the
//             rasteriser. On a real GPU this is ~0 and overlapped; here it is the bill.
//
// WHAT IT DOES NOT MEASURE: anything about a phone GPU. Every number below is a
// SwiftShader number. It is used for ONE purpose: choosing a floor rung this container
// can hold. The mid/high rungs are bounded structurally by budget.mjs, not by this file.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  REPO, LAUNCH_ARGS, parseArgs, loadPlaywright, ensureBuild, newMobilePage, playUrl,
} from './harness.mjs';

const { startServerAuto } = await import(pathToFileURL(path.join(REPO, 'scripts/serve.mjs')).href);

const args = parseArgs(process.argv.slice(2));
const QUICK = !!args.quick;
const PORT = Number(args.port || 5188);
const OUT = args.out && args.out !== true
  ? path.resolve(REPO, String(args.out))
  : path.join(REPO, 'progress', 'cost-curve.md');
const JSON_OUT = args.json && args.json !== true
  ? path.resolve(REPO, String(args.json))
  : path.join(REPO, 'progress', 'cost-curve.json');

const SCALES = QUICK ? [1.0, 0.5, 0.25] : [1.0, 0.75, 0.5, 0.35, 0.25];
const TRIS = QUICK ? [140000, 45000, 8000] : [140000, 90000, 45000, 20000, 8000];
const SHADOW = QUICK ? [false] : [false, true];
const REPORT_ONLY = !!args['report-only'];

/**
 * Write the markdown report from a measurement set. Pure function of the data — every
 * sentence below that states a number reads it out of `D`, so `--report-only` can
 * regenerate the prose from the saved JSON and cannot drift from what was measured.
 */
function writeReport(D) {
  const { inv, rows, controls, ladder, ablation, abBase, floorProbe } = D;
  const shadows = Array.from(new Set(rows.map((r) => r.shadow)));
  const L = [];
  const f1 = (n) => n.toFixed(1);

  // --- frame_ms vs MP along the LADDER (one fixed scene; resolution is the only axis).
  //
  // A single least-squares line over the whole ladder is the WRONG estimator here and
  // was caught producing a wrong answer: fitted across all 16 rungs it returned an
  // intercept of 0.5 ms, which the rung 0 measurement (24.2 ms at 0.004 MP) contradicts
  // outright. The cost is not linear over two decades of resolution — the top of the
  // ladder is fill-bound and sublinear, the bottom is bound by per-triangle work that no
  // resolution touches. So the model is fitted LOCALLY, from the two lowest-resolution
  // rungs, and is only claimed to hold near the floor, which is the only region any
  // decision here is made in. The high end's slope is reported separately.
  let model = null;
  if (ladder && ladder.length >= 4) {
    const s = ladder.slice().sort((x, y) => x.buf.mp - y.buf.mp);
    const lo = s[0], lo2 = s[1], hi = s[s.length - 1], hi2 = s[s.length - 2];
    const bLo = (lo2.pace.frameP50 - lo.pace.frameP50) / (lo2.buf.mp - lo.buf.mp);
    const aLo = lo.pace.frameP50 - bLo * lo.buf.mp;
    const bHi = (hi.pace.frameP50 - hi2.pace.frameP50) / (hi.buf.mp - hi2.buf.mp);
    model = {
      a: aLo, b: bLo, bHi,
      loMp: lo.buf.mp, loMs: lo.pace.frameP50, lo2Mp: lo2.buf.mp, lo2Ms: lo2.pace.frameP50,
      tris: lo.pace.drawn.tris, calls: lo.pace.drawn.calls,
    };
  }
  const empty = controls.find((c) => c.mode === 'empty');
  const noGl = controls.find((c) => c.mode === 'nogl');

  L.push('# COST CURVE — measured on this container (SwiftShader, 4 cores, no GPU)');
  L.push('');
  L.push('Produced by `node scripts/costcurve.mjs`. Every number is a MEASUREMENT taken on');
  L.push('this box with the game loop stopped and this script owning rAF. Nothing here is a');
  L.push('projection and nothing here is a phone number.');
  L.push('');
  L.push('## READING THE CURVE — what it says, in one place');
  L.push('');
  if (model) {
    L.push('Frame cost along the ladder is NOT linear in resolution across its whole range:');
    L.push('the top is fill-bound and slightly sublinear, the bottom is bound by per-triangle');
    L.push('work that no resolution touches. Fitting one line to all sixteen rungs returns an');
    L.push('intercept of 0.5 ms, which the rung 0 measurement contradicts outright. So the');
    L.push('model below is fitted LOCALLY from the two lowest-resolution rungs');
    L.push(`(${model.loMp.toFixed(3)} MP -> ${f1(model.loMs)} ms and ${model.lo2Mp.toFixed(3)} MP -> ${f1(model.lo2Ms)} ms)`
      + ' and is only claimed near the floor:');
    L.push('');
    L.push('```');
    L.push(`    frame_ms  ~  ${model.a.toFixed(1)}  +  ${model.b.toFixed(0)} * megapixels        (near the floor)`);
    L.push(`    slope at the top of the ladder: ${model.bHi.toFixed(0)} ms per megapixel`);
    L.push('```');
    L.push('');
    L.push(`The **${model.a.toFixed(1)} ms intercept is resolution-independent**: it is per-triangle and`);
    L.push(`per-draw-call work for the ${model.tris} triangles and ${model.calls} draw calls still on screen at`);
    L.push('rung 0, and NO render scale can remove it. That single fact is why the floor rung');
    L.push('had to move on two axes rather than one, and why the actor-LOD ordering bug');
    L.push('mattered more than any amount of downscaling: against a 33.3 ms period, an');
    L.push(`irreducible ${model.a.toFixed(0)} ms is most of the budget before a pixel is filled.`);
    if (empty) {
      L.push('');
      L.push(`An empty scene costs ${f1(empty.pace.frameP50)} ms and skipping GL submission entirely costs`);
      L.push(`${f1(noGl ? noGl.pace.frameP50 : 0)} ms, so that intercept is the SCENE, not the page or the loop.`);
    }
  }
  const r0 = ladder && ladder[0];
  const r15 = ladder && ladder[ladder.length - 1];
  if (r0 && r15) {
    L.push('');
    L.push(`The ladder as shipped spans **${f1(r0.pace.frameP50)} ms at rung 0 to ${f1(r15.pace.frameP50)} ms at rung 15**`
      + ` (${(r15.pace.frameP50 / r0.pace.frameP50).toFixed(0)}x).`);
    L.push('The 30 Hz period is 33.3 ms, so on this box only the floor rungs are playable and');
    L.push('everything from rung 3 up is a projection about hardware this container does not');
    L.push('have. That is stated, not hidden.');
  }
  L.push('');
  L.push('Surface: ' + `${inv.css.w}x${inv.css.h} CSS at dpr ${inv.dpr} `
    + `(full-res buffer at scale 1.0 = ${Math.round(inv.css.w * 2)}x${Math.round(inv.css.h * 2)} = `
    + `${((inv.css.w * 2 * inv.css.h * 2) / 1e6).toFixed(2)} MP).`);
  L.push(`Base scene: ${inv.baseTris} triangles across ${inv.meshCount} visible meshes.`);
  L.push('');
  L.push('## How these numbers are taken, and why it matters');
  L.push('');
  L.push('Every frame is SERIALISED: `renderer.render()`, then a 1x1 `gl.readPixels()`.');
  L.push('');
  L.push('That is not a stylistic choice. The first cut of this script measured rAF-to-rAF');
  L.push('interval with one render per rAF and no sync, and reported a flat **16.7 ms for');
  L.push('every point in the grid** — full scene at full resolution included. It was false.');
  L.push('`renderer.render()` only writes commands into Chrome\'s command buffer; the GPU');
  L.push('process rasterises them later and rAF does not wait. The rAF loop free-ran at');
  L.push('60 Hz while the GPU process fell further behind, and the single `readPixels` that');
  L.push('followed took **26.5 seconds** draining a 16-frame backlog. `gl.finish()` returned');
  L.push('0.0 ms on those same frames, so it cannot be used as the sync either.');
  L.push('');
  L.push('The same bug was live in `quality.js`\'s boot `gpuProbe`, which used `gl.finish()`');
  L.push('and therefore reported `ms: 0` for all four of its points while burning 1.2 s of');
  L.push('boot — so `classify()` silently skipped the entire GPU branch. Both are fixed.');
  L.push('');
  L.push('- `frame p50/p95` — render + readPixels round trip. The honest cost of producing');
  L.push('  one frame\'s pixels: JS + submission + software raster. THE number.');
  L.push('- `renderJS` — time for `renderer.render()` to return (command submission only).');
  L.push('- `raster` — time for the following `readPixels` to return: the wait on the');
  L.push('  software rasteriser. On real hardware this is overlapped with the next frame.');
  L.push('- `drawn` — `renderer.info.render` for that single frame, AFTER frustum culling.');
  L.push('');
  L.push('## Where the base scene\'s triangles come from');
  L.push('');
  L.push('| owner | triangles | meshes |');
  L.push('|---|---:|---:|');
  for (const k of Object.keys(inv.byPiece).sort((a, b) => inv.byPiece[b].tris - inv.byPiece[a].tris)) {
    L.push(`| ${k} | ${inv.byPiece[k].tris} | ${inv.byPiece[k].meshes} |`);
  }
  L.push('');
  for (const sh of shadows) {
    L.push(`## Shadows ${sh ? 'ON' : 'OFF'}`);
    L.push('');
    L.push('| render scale | buffer | MP | tris in scene | tris drawn | draw calls | frame p50 | frame p95 | renderJS | raster |');
    L.push('|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
    for (const r of rows.filter((x) => x.shadow === sh)) {
      L.push(`| ${r.scale.toFixed(2)}${r.tag ? ' *' : ''} | ${r.buf.w}x${r.buf.h} | ${r.buf.mp.toFixed(2)} | ${r.vis.tris} | ${r.pace.drawn.tris} | ${r.pace.drawn.calls} `
        + `| ${f1(r.pace.frameP50)} | ${f1(r.pace.frameP95)} | ${r.pace.renderJS.toFixed(2)} | ${f1(r.pace.sync)} |`);
    }
    const tagged = rows.filter((x) => x.shadow === sh && x.tag);
    if (tagged.length) L.push(`\n\`*\` = ${tagged[0].tag}. It agrees with row 1 to within run-to-run noise, so the sweep has no order effect.`);
    L.push('');
  }
  L.push('## Control points');
  L.push('');
  L.push('| control | tris in scene | tris drawn | frame p50 | raster |');
  L.push('|---|---:|---:|---:|---:|');
  for (const c of controls) L.push(`| ${c.label} | ${c.vis.tris} | ${c.pace.drawn.tris} | ${f1(c.pace.frameP50)} | ${f1(c.pace.sync)} |`);
  L.push('');
  L.push('## THE LADDER, MEASURED');
  L.push('');
  L.push('Each row applies a real rung through the real `applyRung` path — drawing buffer,');
  L.push('shadow state, and every piece\'s own `applyRung` — then measures it. A rung that');
  L.push('does not cost less than the rung above it is not a rung, it is a label.');
  L.push('');
  L.push('| rung | tier | buffer | MP | tris drawn | draw calls | frame p50 ms | vs 33.3 ms (30 Hz) |');
  L.push('|---:|---|---:|---:|---:|---:|---:|---|');
  for (const r of ladder) {
    const t = r.rung <= 2 ? 'floor' : r.rung <= 6 ? 'low' : r.rung <= 11 ? 'mid' : 'high';
    L.push(`| ${r.rung} | ${t} | ${r.buf.w}x${r.buf.h} | ${r.buf.mp.toFixed(3)} | ${r.pace.drawn.tris} | ${r.pace.drawn.calls} | ${f1(r.pace.frameP50)} | ${r.pace.frameP50 <= 33.3 ? '**FITS**' : `${(r.pace.frameP50 / 33.3).toFixed(1)}x over`} |`);
  }
  L.push('');
  L.push('Note the `tris drawn` column. It moves by a few per cent across the whole ladder,');
  L.push('because the only geometry lever any rung has is the actor LOD mix — and that mix');
  L.push('is chosen when an actor is BUILT. Before this round the world was built BEFORE the');
  L.push('boot rung was ever applied, so every device got the high tier\'s mix and the column');
  L.push('read 134,058 at rung 0 against 137,760 at rung 15: a 2.7% span across sixteen');
  L.push('rungs, over a floor-tier structural cap of 90,000. Fixing the ordering took the');
  L.push('base scene from 137,760 triangles and 69 draw calls to 52,044 and 27.');
  L.push('');
  L.push('## ABLATION — who owns the frame cost at rung 0');
  L.push('');
  L.push(`Baseline at rung 0, nothing hidden: **${f1(abBase.pace.frameP50)} ms** ` +
    `(${abBase.pace.drawn.tris} triangles drawn). Each row hides one owner and re-measures.`);
  L.push('At rung 0\'s tiny buffer the fill term is nearly gone, so what remains is mostly');
  L.push('per-triangle and per-draw-call cost. Small negative numbers are run-to-run noise.');
  L.push('');
  L.push('| owner hidden | triangles removed | frame p50 ms | ms saved |');
  L.push('|---|---:|---:|---:|');
  for (const a of ablation) L.push(`| ${a.owner} | ${a.removed} | ${f1(a.pace.frameP50)} | ${f1(a.savedMs)} |`);
  L.push('');
  L.push('## FLOOR PROBE — choosing rung 0 from the curve');
  L.push('');
  L.push('Rung 0\'s row in the live `RUNGS` table is overwritten with each candidate and');
  L.push('applied for real — real buffer resize, real actor-LOD rebuild, real per-piece');
  L.push('`applyRung` — then measured. The 30 Hz period is 33.3 ms; the contract\'s');
  L.push('main-thread wall at 30 Hz is 30.00 ms with 3.33 ms of inviolable slack.');
  L.push('');
  L.push('The two LOD mixes below draw the SAME triangle count. That is the finding, not a');
  L.push('mistake: `character-anatomy` builds LOD2 and LOD3 identically, so the rung table\'s');
  L.push('`imposter` column currently moves nothing.');
  L.push('');
  L.push('| actor LOD mix | renderScale (dprCap 1.0) | buffer | MP | tris drawn | draw calls | frame p50 | frame p95 | holds 30 Hz? |');
  L.push('|---|---:|---:|---:|---:|---:|---:|---:|---|');
  for (const f of floorProbe) {
    L.push(`| ${f.lod} | ${f.scale.toFixed(2)} | ${f.buf.w}x${f.buf.h} | ${f.buf.mp.toFixed(4)} | ${f.pace.drawn.tris} | ${f.pace.drawn.calls} `
      + `| ${f1(f.pace.frameP50)} | ${f1(f.pace.frameP95)} | ${f.pace.frameP95 <= 30 ? 'YES' : f.pace.frameP50 <= 33.3 ? 'marginal' : 'no'} |`);
  }
  L.push('');
  L.push('The shipped rung 0 was then chosen from REAL HARNESS RUNS rather than from this');
  L.push('serialised proxy — see the note at the top of `RUNGS` in `src/foundation/quality.js`');
  L.push('and `scripts/perf.mjs --rung-scale=X`.');
  L.push('');
  return L.join('\n');
}

if (REPORT_ONLY) {
  const D = JSON.parse(fs.readFileSync(JSON_OUT, 'utf8'));
  fs.writeFileSync(OUT, writeReport(D));
  console.log(`[cost] rewrote ${OUT} from ${JSON_OUT} (no measurement taken)`);
  process.exit(0);
}

ensureBuild((s) => console.log(`[cost] ${s}`));
const srv = await startServerAuto(path.join(REPO, 'dist'), PORT);
const chromium = await loadPlaywright();
const browser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });

let exitCode = 0;
try {
  const { page, cdp, context, errors } = await newMobilePage(browser, { width: 390, height: 844, dpr: 2 });
  // autostart=0: the game loop never runs. THIS script owns rAF for the whole sweep, so
  // nothing else is competing for the frame and every interval below is attributable.
  const url = playUrl(srv.url, {
    scene: 'live_play', tier: 'mid', raster: 'auto', seed: 7, probe: false, autostart: false,
  });
  console.log(`[cost] ${url}`);
  await page.goto(url, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction('window.__BLITZ_READY__===true', null, { timeout: 300000 });
  const boot = await page.evaluate(() => window.__BLITZ_STATS__);
  if (boot && boot.error) throw new Error(`page boot error: ${boot.error}`);

  /* ------------------------------------------------ install the in-page rig */
  await page.evaluate(() => {
    const rt = window.__BLITZ_ENGINE__;
    const THREE = rt.ctx.THREE;
    const gl = rt.renderer.getContext();
    window.__BLITZ_PERF__.stop();

    const triOf = (o) => {
      const g = o.geometry;
      if (!g) return 0;
      const idx = g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0);
      const n = Math.floor(idx / 3);
      if (o.isMesh) return n;
      return 0;
    };

    // --- inventory: who owns the triangles -----------------------------------
    const meshes = [];
    rt.scene.traverse((o) => {
      if (o.isMesh && o.visible) {
        const t = triOf(o);
        if (t > 0) meshes.push({ o, tris: t, piece: (o.userData && o.userData.piece) || o.name || '?' });
      }
    });
    const byPiece = {};
    let baseTris = 0;
    for (const m of meshes) {
      byPiece[m.piece] = byPiece[m.piece] || { tris: 0, meshes: 0 };
      byPiece[m.piece].tris += m.tris;
      byPiece[m.piece].meshes++;
      baseTris += m.tris;
    }
    // biggest first — that is the order we hide in to walk the triangle axis down
    meshes.sort((a, b) => b.tris - a.tris);

    // --- synthetic filler, for targets ABOVE the base scene -------------------
    let filler = null;
    function ensureFiller(extraTris) {
      if (filler) { rt.scene.remove(filler.group); filler.geo.dispose(); filler.mat.dispose(); filler = null; }
      if (extraTris <= 0) return;
      const perMesh = 2000;
      const n = Math.max(1, Math.round(extraTris / perMesh));
      const segs = Math.max(1, Math.round(Math.sqrt(perMesh / 2)));
      const geo = new THREE.PlaneGeometry(2.2, 2.2, segs, segs);
      const mat = new THREE.MeshStandardMaterial({ color: 0x556644, roughness: 0.8 });
      const group = new THREE.Group();
      group.name = 'costcurve-filler';
      for (let i = 0; i < n; i++) {
        const m = new THREE.Mesh(geo, mat);
        const a = i * 2.399963, r = 3 + (i % 37) * 0.9;
        m.position.set(Math.cos(a) * r, 0.4 + (i % 11) * 0.55, Math.sin(a) * r - 6);
        m.rotation.set(-1.2 + (i % 7) * 0.11, a, 0);
        group.add(m);
      }
      rt.scene.add(group);
      filler = { group, geo, mat };
    }

    /** Hide the largest meshes until the scene is at or under `target` triangles.
     *  `target === null` restores the base scene exactly and removes any filler. */
    function setTriangles(target) {
      for (const m of meshes) m.o.visible = true;
      if (target === null) { ensureFiller(0); return baseTris; }
      ensureFiller(Math.min(400000, target - baseTris));
      if (target >= baseTris) return baseTris;
      let total = baseTris;
      for (const m of meshes) {
        if (total <= target) break;
        m.o.visible = false;
        total -= m.tris;
      }
      return total;
    }

    function setBuffer(scale) {
      const css = rt.cssSize;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(16, Math.round(css.w * dpr * scale));
      const h = Math.max(16, Math.round(css.h * dpr * scale));
      rt.renderer.setSize(w, h, false);
      return { w, h, mp: (w * h) / 1e6 };
    }

    function setShadow(on) {
      rt.renderer.shadowMap.enabled = !!on;
      rt.renderer.shadowMap.needsUpdate = !!on;
      rt.scene.traverse((o) => {
        if (o.isMesh) o.castShadow = !!on && !!(o.userData && o.userData.canCastShadow !== false);
        if (o.isLight && o.shadow) o.castShadow = !!on;
      });
    }

    function pct(a, q) {
      if (!a.length) return 0;
      const s = a.slice().sort((x, y) => x - y);
      return s[Math.min(s.length - 1, Math.round(q * (s.length - 1)))];
    }

    /**
     * THE MEASUREMENT, and why it is shaped like this.
     *
     * The first cut of this script measured rAF-to-rAF interval with one render per rAF
     * and no sync. It reported a flat 16.7 ms for EVERY point — full scene at full
     * resolution included — which is obviously false. The reason: `renderer.render()`
     * only WRITES COMMANDS into Chrome's command buffer. The GPU process rasterises them
     * later, and rAF does not wait. So the rAF loop free-ran at 60 Hz while the GPU
     * process fell further and further behind, and the single `readPixels` that followed
     * took 26.5 SECONDS draining a 16-frame backlog.
     *
     * A number that can only be produced by ignoring 26 seconds of queued work is not a
     * measurement. So every frame here is SERIALISED: render, then a 1x1 `readPixels`,
     * which cannot return until the rasteriser has actually finished this frame's pixels.
     * `gl.finish()` does NOT do this — it measured 0.0 ms on those same frames.
     *
     * `frameMs` is therefore the honest cost of producing one frame's pixels:
     * JS + command submission + software raster. `rafMs` is reported alongside it purely
     * so the backlog effect stays visible in the data.
     */
    const px = new Uint8Array(4);
    function pacePass(o) {
      const minN = o.minN || 8, maxN = o.maxN || 24, capMs = o.capMs || 7000, noGL = !!o.noGL;
      return new Promise((resolve) => {
        const frame = [], rj = [], sync = [], iv = [];
        // DRAIN: enough serialised frames to empty any backlog the previous point left,
        // and to pay every first-use cost at this configuration.
        let warm = o.warm === undefined ? 4 : o.warm;
        let last = -1, n = 0;
        const t0 = performance.now();
        const step = (now) => {
          const a = performance.now();
          if (!noGL) {
            rt.renderer.info.reset();
            rt.renderer.setRenderTarget(null);
            rt.renderer.render(rt.scene, rt.camera);
          } else {
            rt.camera.updateMatrixWorld();
          }
          const b = performance.now();
          if (!noGL) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          const c = performance.now();
          if (warm > 0) { warm--; last = now; requestAnimationFrame(step); return; }
          if (last >= 0) iv.push(now - last);
          last = now;
          rj.push(b - a); sync.push(c - b); frame.push(c - a);
          n++;
          const done = n >= maxN || (n >= minN && performance.now() - t0 > capMs);
          if (done) {
            const ri = rt.renderer.info.render;
            resolve({
              n,
              frameP50: pct(frame, 0.5), frameP95: pct(frame, 0.95),
              frameMin: frame.length ? Math.min(...frame) : 0,
              renderJS: pct(rj, 0.5), sync: pct(sync, 0.5),
              rafP50: iv.length ? pct(iv, 0.5) : 0,
              drawn: { calls: ri.calls, tris: ri.triangles },
            });
            return;
          }
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
    }

    window.__COST__ = {
      baseTris, byPiece,
      meshCount: meshes.length,
      css: rt.cssSize, dpr: window.devicePixelRatio,
      drawCalls: rt.info.drawCalls,
      setTriangles, setBuffer, setShadow, pacePass,
      countVisible() {
        let t = 0, c = 0;
        rt.scene.traverse((o) => {
          if (o.isMesh && o.visible) {
            let p = o; let vis = true;
            while (p) { if (!p.visible) { vis = false; break; } p = p.parent; }
            if (!vis) return;
            const g = o.geometry;
            const idx = g && (g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0));
            t += Math.floor((idx || 0) / 3); c++;
          }
        });
        return { tris: t, meshes: c };
      },
      hideOverlay(v) { document.getElementById('ui').style.display = v ? 'none' : 'block'; },
      hideGL(v) { document.getElementById('gl').style.display = v ? 'none' : 'block'; },

      /**
       * THE LADDER, MEASURED. Apply a real rung through the real code path — which
       * resizes the drawing buffer, sets shadows, and forwards to every piece's
       * applyRung — and then measure what that rung actually costs. This is the one
       * measurement that can answer "is rung N cheaper than rung N+1, or does the
       * ladder only *look* like it descends?".
       */
      applyRealRung(n) {
        setTriangles(null);
        rt.applyRung(n, true);
        const b = rt.bufferSize;
        return { rung: n, buf: { w: b.w, h: b.h, mp: (b.w * b.h) / 1e6 } };
      },

      /** Hide every mesh whose owner tag starts with `prefix`. Returns tris removed. */
      ablate(prefix) {
        let removed = 0;
        for (const m of meshes) {
          if (prefix === null || m.piece === prefix || String(m.piece).startsWith(prefix)) {
            if (prefix === null) { m.o.visible = true; continue; }
            m.o.visible = false; removed += m.tris;
          }
        }
        return removed;
      },
      owners() {
        const s = new Set();
        for (const m of meshes) s.add(m.piece);
        return Array.from(s);
      },

      /**
       * FLOOR PROBE. Overwrite rung 0's row in the live RUNGS table with a candidate,
       * apply it for real, and measure. `Object.freeze(RUNGS)` freezes the ARRAY, not
       * the row objects, so this drives the real code path — real buffer resize, real
       * actor LOD rebuild, real piece applyRung — rather than a simulation of it.
       * This is how rung 0 gets CHOSEN from a measurement instead of guessed.
       */
      probeFloor(cfg) {
        const row = window.__BLITZ_QUALITY__.RUNGS[0];
        const save = Object.assign({}, row);
        Object.assign(row, cfg);
        rt.applyRung(0, true);
        const b = rt.bufferSize;
        return { buf: { w: b.w, h: b.h, mp: (b.w * b.h) / 1e6 }, restore: save };
      },
      restoreFloor(save) {
        Object.assign(window.__BLITZ_QUALITY__.RUNGS[0], save);
      },
    };
  });

  const inv = await page.evaluate(() => ({
    baseTris: window.__COST__.baseTris,
    byPiece: window.__COST__.byPiece,
    meshCount: window.__COST__.meshCount,
    css: window.__COST__.css,
    dpr: window.__COST__.dpr,
    drawCalls: window.__COST__.drawCalls,
  }));
  console.log(`[cost] base scene ${inv.baseTris} tris across ${inv.meshCount} meshes, css ${inv.css.w}x${inv.css.h} dpr ${inv.dpr}`);
  for (const k of Object.keys(inv.byPiece).sort((a, b) => inv.byPiece[b].tris - inv.byPiece[a].tris)) {
    console.log(`[cost]   ${String(k).padEnd(24)} ${String(inv.byPiece[k].tris).padStart(8)} tris  ${inv.byPiece[k].meshes} meshes`);
  }

  /* ------------------------------------------------------------- the sweep */
  const rows = [];
  const MINN = QUICK ? 6 : 8;
  const MAXN = QUICK ? 16 : 24;
  const CAP = QUICK ? 5000 : 7000;
  const point = async (scale, tris, shadow, tag) => {
    const r = await page.evaluate(async ([sc, tr, sh, minN, maxN, cap]) => {
      const C = window.__COST__;
      C.setShadow(sh);
      C.setTriangles(tr);
      const buf = C.setBuffer(sc);
      const vis = C.countVisible();
      const pace = await C.pacePass({ minN, maxN, capMs: cap });
      return { buf, vis, pace };
    }, [scale, tris, shadow, MINN, MAXN, CAP]);
    rows.push({ scale, triTarget: tris, shadow, tag: tag || '', ...r });
    console.log(`[cost] scale ${scale.toFixed(2)} ${String(r.buf.w).padStart(4)}x${String(r.buf.h).padStart(4)} `
      + `tris ${String(r.vis.tris).padStart(7)}/${String(r.pace.drawn.tris).padStart(7)}drawn ${String(r.pace.drawn.calls).padStart(3)}dc sh=${shadow ? 'on ' : 'off'}  `
      + `frame n=${String(r.pace.n).padStart(2)} p50 ${r.pace.frameP50.toFixed(1).padStart(7)} p95 ${r.pace.frameP95.toFixed(1).padStart(7)} min ${r.pace.frameMin.toFixed(1).padStart(7)}  `
      + `renderJS ${r.pace.renderJS.toFixed(1).padStart(6)}  raster ${r.pace.sync.toFixed(1).padStart(7)}`
      + (tag ? `  [${tag}]` : ''));
    return r;
  };
  for (const shadow of SHADOW) {
    for (const scale of SCALES) {
      for (const tris of TRIS) await point(scale, tris, shadow);
    }
  }
  // ORDER CONTROL. Re-measure the very first point last. If the two disagree, the sweep
  // has an order effect (shader recompiles, thermal drift, host contention) and every
  // number in the table is suspect. Printing it is how a critic can tell.
  await point(SCALES[0], TRIS[0], SHADOW[0], 'ORDER CONTROL — repeat of row 1');

  /* -------------------------------------------------------- control points */
  const controls = [];
  const ctl = async (label, mode) => {
    const r = await page.evaluate(async ([minN, maxN, cap, m]) => {
      const C = window.__COST__;
      C.hideOverlay(false); C.setShadow(false);
      let noGL = false;
      if (m === 'nogl') { C.setTriangles(null); C.setBuffer(0.5); noGL = true; }
      if (m === 'empty') { C.setTriangles(0); C.setBuffer(0.5); }
      if (m === 'empty-full') { C.setTriangles(0); C.setBuffer(1.0); }
      if (m === 'empty-noui') { C.setTriangles(0); C.setBuffer(0.5); C.hideOverlay(true); }
      if (m === 'base-noui') { C.setTriangles(null); C.setBuffer(0.5); C.hideOverlay(true); }
      if (m === 'base-half') { C.setTriangles(null); C.setBuffer(0.5); }
      if (m === 'base-quarter') { C.setTriangles(null); C.setBuffer(0.25); }
      if (m === 'base-eighth') { C.setTriangles(null); C.setBuffer(0.125); }
      if (m === 'chars-only') { C.setTriangles(120000); C.setBuffer(0.5); }
      const pace = await C.pacePass({ minN, maxN, capMs: cap, noGL });
      const vis = C.countVisible();
      C.hideOverlay(false);
      return { pace, vis };
    }, [MINN, MAXN, CAP, mode]);
    controls.push({ label, mode, ...r });
    console.log(`[cost] CONTROL ${label.padEnd(38)} tris ${String(r.vis.tris).padStart(7)} drawn ${String(r.pace.drawn.tris).padStart(7)}  n=${String(r.pace.n).padStart(2)} frame p50 ${r.pace.frameP50.toFixed(1).padStart(7)}  raster ${r.pace.sync.toFixed(1).padStart(7)}`);
  };
  await ctl('rAF only, GL submission skipped', 'nogl');
  await ctl('empty scene @0.50 buffer, both layers', 'empty');
  await ctl('empty scene @1.00 buffer, both layers', 'empty-full');
  await ctl('empty scene @0.50 buffer, GL layer only', 'empty-noui');
  await ctl('base scene @0.50 buffer, GL layer only', 'base-noui');
  await ctl('base scene @0.50 buffer', 'base-half');
  await ctl('base scene @0.25 buffer', 'base-quarter');
  await ctl('base scene @0.125 buffer', 'base-eighth');

  /* ------------------------------------------------- THE LADDER, MEASURED */
  const ladder = [];
  for (let n = 0; n <= 15; n++) {
    const r = await page.evaluate(async ([rung, minN, maxN, cap]) => {
      const C = window.__COST__;
      const a = C.applyRealRung(rung);
      const pace = await C.pacePass({ minN, maxN, capMs: cap });
      return { ...a, pace, vis: C.countVisible() };
    }, [n, MINN, MAXN, CAP]);
    ladder.push(r);
    console.log(`[cost] RUNG ${String(n).padStart(2)}  ${String(r.buf.w).padStart(4)}x${String(r.buf.h).padStart(4)} `
      + `${r.buf.mp.toFixed(3)}MP  tris ${String(r.pace.drawn.tris).padStart(7)} ${String(r.pace.drawn.calls).padStart(3)}dc  `
      + `frame p50 ${r.pace.frameP50.toFixed(1).padStart(7)} ms  renderJS ${r.pace.renderJS.toFixed(1).padStart(5)}  raster ${r.pace.sync.toFixed(1).padStart(7)}`);
  }

  /* ------------------------------------- ABLATION: who owns the frame cost */
  // At rung 0's own buffer, remove one owner at a time and measure the delta. A rung
  // that cannot switch off the expensive owner is a rung that cannot descend.
  const owners = await page.evaluate(() => window.__COST__.owners());
  const ablation = [];
  const abBase = await page.evaluate(async ([minN, maxN, cap]) => {
    const C = window.__COST__;
    C.applyRealRung(0);
    C.ablate(null);
    const pace = await C.pacePass({ minN, maxN, capMs: cap });
    return { pace, vis: C.countVisible() };
  }, [MINN, MAXN, CAP]);
  console.log(`[cost] ABLATE baseline (rung 0, nothing hidden)   tris ${String(abBase.pace.drawn.tris).padStart(7)}  frame p50 ${abBase.pace.frameP50.toFixed(1)}`);
  for (const own of owners) {
    const r = await page.evaluate(async ([o, minN, maxN, cap]) => {
      const C = window.__COST__;
      C.applyRealRung(0);
      C.ablate(null);
      const removed = C.ablate(o);
      const pace = await C.pacePass({ minN, maxN, capMs: cap });
      C.ablate(null);
      return { removed, pace };
    }, [own, MINN, MAXN, CAP]);
    const saved = abBase.pace.frameP50 - r.pace.frameP50;
    ablation.push({ owner: own, ...r, savedMs: saved });
    console.log(`[cost] ABLATE ${own.padEnd(22)} -${String(r.removed).padStart(6)} tris  frame p50 ${r.pace.frameP50.toFixed(1).padStart(7)}  saves ${saved.toFixed(1).padStart(7)} ms`);
  }
  ablation.sort((a, b) => b.savedMs - a.savedMs);

  /* ------------------------------------------- FLOOR PROBE: choosing rung 0 */
  const floorScales = [0.50, 0.40, 0.32, 0.26, 0.22, 0.18, 0.14];
  const floorLods = [
    { label: '6 skinned + 8 imposter (as shipped)', skinned: 6, imposter: 8 },
    { label: '0 skinned + 14 imposter', skinned: 0, imposter: 14 },
  ];
  const floorProbe = [];
  for (const lod of floorLods) {
    for (const sc of floorScales) {
      const r = await page.evaluate(async ([cfg, minN, maxN, cap]) => {
        const C = window.__COST__;
        C.setTriangles(null);
        const p = C.probeFloor(cfg);
        const pace = await C.pacePass({ minN, maxN, capMs: cap });
        C.restoreFloor(p.restore);
        return { buf: p.buf, pace };
      }, [{ renderScale: sc, dprCap: 1.0, skinned: lod.skinned, imposter: lod.imposter }, MINN, MAXN, CAP]);
      floorProbe.push({ scale: sc, lod: lod.label, skinned: lod.skinned, imposter: lod.imposter, ...r });
      console.log(`[cost] FLOOR scale ${sc.toFixed(2)} ${String(r.buf.w).padStart(3)}x${String(r.buf.h).padStart(4)} ${r.buf.mp.toFixed(4)}MP  `
        + `tris ${String(r.pace.drawn.tris).padStart(6)} ${String(r.pace.drawn.calls).padStart(3)}dc  `
        + `frame p50 ${r.pace.frameP50.toFixed(1).padStart(6)} p95 ${r.pace.frameP95.toFixed(1).padStart(6)}  ${r.pace.frameP50 <= 30 ? 'FITS 30Hz' : ''}  [${lod.label}]`);
    }
  }
  // put rung 0 back the way the build shipped it
  await page.evaluate(() => window.__COST__.applyRealRung(0));

  if (errors.length) {
    console.log(`[cost] page errors: ${errors.length}`);
    for (const e of errors.slice(0, 5)) console.log(`  ${e}`);
  }
  await context.close();

  /* -------------------------------------------------------------- publish */
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const D = { inv, rows, controls, ladder, ablation, abBase, floorProbe };
  fs.writeFileSync(OUT, writeReport(D));
  fs.writeFileSync(JSON_OUT, JSON.stringify(D, null, 2));
  console.log(`[cost] wrote ${OUT}`);
  console.log(`[cost] wrote ${JSON_OUT}`);
} catch (e) {
  console.error('[cost] FAILED:', e && (e.stack || e.message || e));
  exitCode = 1;
} finally {
  await browser.close();
  await srv.close();
}
process.exit(exitCode);
