#!/usr/bin/env node
// FOUNDATION — the MOTION capture command. Frozen to PIECE agents; owned by perf-core.
//
// shoot.mjs answers "does one frame look like the concept art". It cannot answer
// "does this feel like NFL Blitz", because feel lives in motion: camera energy,
// hit reactions, recovery timing, how fast a play resolves, whether a tackle
// reads as violent. This captures the LIVE runtime as it actually plays and
// assembles the result into something a critic can judge.
//
// Deliberately NOT the deterministic still path. Stills seek to a time and
// accumulate 32 jittered passes (70-150 s per frame here). A sequence needs many
// frames of the real loop, so this runs quality=live at the pinned rate and
// samples the presented output. What a critic sees is what a player would see.
//
//   node scripts/shootseq.mjs --scene=live_play --dur=6 --fps=12
//   node scripts/shootseq.mjs --piece=pose-animation --dur=4 --fps=15 --w=960 --h=540
//   node scripts/shootseq.mjs --scene=live_play --dur=6 --fps=12 --strip=6
//
// Outputs, under shots/seq/<name>/:
//   frame-####.png   the raw samples
//   strip.png        a contact strip, N across, for reading timing at a glance
//   motion.webm      real-time playback, recorded by Playwright itself
//   meta.json        what was captured and at what real cadence
//
// NOTE ON TOOLING: Playwright ships a MINIMAL ffmpeg built only for its own WebM
// recorder -- it has no image2 demuxer and no pattern_type, so it cannot tile PNGs
// or mux an mp4 from a frame sequence. The strip is therefore composed with PIL,
// and the clip comes from Playwright's native recordVideo.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServerAuto } from './serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const o = {};
  for (const a of argv.slice(2)) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    if (m) o[m[1]] = m[2] === undefined ? true : m[2];
  }
  return o;
}
const args = parseArgs(process.argv);
const SCENE = args.scene && args.scene !== true ? String(args.scene) : 'live_play';
const PIECE = args.piece && args.piece !== true ? String(args.piece) : null;
const SEED = args.seed !== undefined ? String(args.seed) : '7';
const DUR = Number(args.dur || 6);
const FPS = Number(args.fps || 12);
const Wpx = Number(args.w || 960);
const Hpx = Number(args.h || 540);
const STRIP = Number(args.strip || 8);
const NAME = String(args.name || PIECE || SCENE);
const TIMEOUT = Number(args.timeout || 240000);
const OUT = path.join(ROOT, 'shots', 'seq', NAME);

function log(...a) { console.log('[seq]', ...a); }

// Same resolution order shoot.mjs uses: playwright is installed globally here,
// not as a project dependency, so a bare import alone does not find it.
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
      const chromium = m && (m.chromium || (m.default && m.default.chromium));
      if (chromium) return chromium;
    } catch { /* try next */ }
  }
  throw new Error('playwright not found (tried bare import and /opt/node22/lib/node_modules)');
}

function ensureBuild() {
  const dist = path.join(ROOT, 'dist', 'index.html');
  if (!fs.existsSync(dist)) {
    log('dist/ missing — building');
    const r = spawnSync('npx', ['vite', 'build'], { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) throw new Error('vite build failed');
  }
}

function sceneUrl(base) {
  const q = new URLSearchParams();
  q.set('scene', SCENE);
  q.set('seed', SEED);
  q.set('quality', 'live');
  q.set('mode', 'play');
  if (PIECE) q.set('piece', PIECE);
  if (args.tier) q.set('tier', String(args.tier));
  if (args.rung !== undefined) q.set('rung', String(args.rung));
  if (args.rate !== undefined) q.set('rate', String(args.rate));
  if (args.hud !== undefined) q.set('hud', String(args.hud));
  return `${base}/?${q.toString()}`;
}

/** Contact strip: N frames across, so a critic reads TIMING, not just look. */
function buildStrip(frames, outFile, across) {
  if (!frames.length) return false;
  const pick = [];
  const step = Math.max(1, Math.floor(frames.length / across));
  for (let i = 0; i < frames.length && pick.length < across; i += step) pick.push(frames[i]);
  const py = `
import json, sys
from PIL import Image, ImageDraw
paths = json.loads(sys.argv[1]); out = sys.argv[2]
ims = [Image.open(p).convert("RGB") for p in paths]
w, h, pad = ims[0].width, ims[0].height, 4
sheet = Image.new("RGB", (len(ims) * w + (len(ims) + 1) * pad, h + 2 * pad), (18, 22, 29))
d = ImageDraw.Draw(sheet)
for i, im in enumerate(ims):
    x = pad + i * (w + pad)
    sheet.paste(im, (x, pad))
    d.text((x + 6, pad + 5), str(i), fill=(245, 185, 46))
sheet.save(out)
`;
  const r = spawnSync('python3', ['-c', py, JSON.stringify(pick), outFile], { stdio: 'pipe' });
  if (r.status !== 0) log('strip failed:', String(r.stderr || '').slice(0, 200));
  return r.status === 0;
}

(async () => {
  ensureBuild();
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const chromium = await loadPlaywright();
  const server = await startServerAuto(path.join(ROOT, 'dist'));
  const browser = await chromium.launch({
    args: [
      '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--force-device-scale-factor=1',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });

  const frames = [];
  const stamps = [];
  try {
    // recordVideo is Playwright's own capture path -- the one its bundled ffmpeg
    // actually supports -- so the clip is real-time playback, not reassembled stills.
    const context = await browser.newContext({
      viewport: { width: Wpx, height: Hpx }, deviceScaleFactor: 1, hasTouch: true,
      recordVideo: { dir: OUT, size: { width: Wpx, height: Hpx } },
    });
    const page = await context.newPage();
    page.on('pageerror', (e) => log('PAGEERROR', String(e).slice(0, 200)));

    const url = sceneUrl(server.url);
    log(`scene=${SCENE}${PIECE ? ` piece=${PIECE}` : ''} ${Wpx}x${Hpx} dur=${DUR}s fps=${FPS}`);
    await page.goto(url, { waitUntil: 'commit', timeout: TIMEOUT });
    await page.waitForFunction('window.__BLITZ_READY__===true || window.__BLITZ_ERROR__', undefined, { timeout: TIMEOUT });

    const err = await page.evaluate(() => window.__BLITZ_ERROR__ || null);
    if (err) throw new Error(`engine error: ${String(err).slice(0, 400)}`);

    const total = Math.max(1, Math.round(DUR * FPS));
    const period = 1000 / FPS;
    const t0 = Date.now();
    for (let i = 0; i < total; i++) {
      const due = t0 + i * period;
      const wait = due - Date.now();
      if (wait > 0) await page.waitForTimeout(wait);
      const f = path.join(OUT, `frame-${String(i).padStart(4, '0')}.png`);
      await page.screenshot({ path: f, timeout: TIMEOUT });
      frames.push(f);
      stamps.push(Date.now() - t0);
      if (i % 10 === 0) log(`  ${i + 1}/${total}`);
    }

    // The REAL cadence achieved, not the one requested. On a software rasterizer
    // these differ a lot, and a critic judging motion must know which it is seeing.
    const span = (stamps[stamps.length - 1] - stamps[0]) / 1000 || 1;
    const realFps = (frames.length - 1) / span;
    const perf = await page.evaluate(() => {
      const p = window.__BLITZ_PERF__;
      if (!p) return null;
      try { return typeof p.snapshot === 'function' ? p.snapshot() : JSON.parse(JSON.stringify(p)); }
      catch { return null; }
    });

    const meta = {
      scene: SCENE, piece: PIECE, seed: SEED, w: Wpx, h: Hpx,
      requestedFps: FPS, requestedDur: DUR,
      frames: frames.length, sampleSpanSec: Number(span.toFixed(3)),
      realSampleFps: Number(realFps.toFixed(2)),
      note: 'Samples of the LIVE runtime under software raster. Sample cadence is NOT the game\'s frame rate; see perf for that.',
      perf,
    };
    fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 1));

    const strip = path.join(OUT, 'strip.png');
    if (buildStrip(frames, strip, STRIP)) log(`strip -> ${path.relative(ROOT, strip)}`);

    const vid = page.video();
    await context.close();          // the webm is only finalised on context close
    if (vid) {
      try {
        const src = await vid.path();
        const dst = path.join(OUT, 'motion.webm');
        if (src && fs.existsSync(src)) { fs.renameSync(src, dst); log(`video -> ${path.relative(ROOT, dst)}`); }
      } catch (e) { log('video unavailable:', e && e.message); }
    }

    log(`captured ${frames.length} frames over ${span.toFixed(2)}s (sample cadence ${realFps.toFixed(1)}/s)`);
  } finally {
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
})().catch((e) => {
  console.error('[seq] FAILED:', e && e.message ? e.message : e);
  process.exit(1);
});
