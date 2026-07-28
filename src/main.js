// FOUNDATION — FROZEN after t=0. Do not edit.
// Boot. Imports every piece (side-effect registrations), resolves the scene from the
// URL, captures one deterministic still (or starts the live loop), then raises the
// readiness flag the screenshot harness waits on.

import { parseParams } from './foundation/params.js';
import { createEngine } from './foundation/engine.js';
import { listScenes, scenesForPiece } from './foundation/scenes.js';
import { REG, PIECE_IDS, PIECE_HEROES, SCENE_PANELS } from './foundation/registry.js';

// ---- every piece registers as an import side effect, in fixed alphabetical order.
import './pieces/index.js';

const params = parseParams();

function publishSceneIndex() {
  window.__BLITZ_SCENES__ = listScenes();
  window.__BLITZ_PIECES__ = PIECE_IDS.map((id) => ({
    id,
    heroes: PIECE_HEROES[id] || [],
    scenes: scenesForPiece(id),
  }));
  window.__BLITZ_PANELS__ = Object.assign({}, SCENE_PANELS);
  window.__BLITZ_PROVENANCE__ = Object.assign({}, REG.provenance);
}

function markReady(stats) {
  window.__BLITZ_STATS__ = stats;
  window.__BLITZ_READY__ = true;
  document.documentElement.dataset.blitzReady = '1';
}

function fail(e) {
  console.error('[blitz] fatal:', e);
  window.__BLITZ_ERROR__ = String((e && e.stack) || e);
  const el = document.getElementById('fatal');
  if (el) {
    el.style.display = 'block';
    el.textContent = `BLITZ FATAL\n\n${(e && e.stack) || e}`;
  }
  // Still raise readiness so the harness screenshots the error instead of timing out.
  markReady({ error: String((e && e.message) || e), sceneId: params.scene, seed: params.seed, t: params.t });
}

async function boot() {
  publishSceneIndex();

  // `?list=1` — enumerate scenes without touching WebGL. Used by shoot.mjs --list.
  if (params.list) {
    markReady({ mode: 'list', scenes: window.__BLITZ_SCENES__.length });
    return;
  }

  const stage = document.getElementById('stage');
  stage.style.width = `${params.w}px`;
  stage.style.height = `${params.h}px`;

  const glCanvas = document.getElementById('gl');
  const uiCanvas = document.getElementById('ui');
  glCanvas.style.width = `${params.w}px`;
  glCanvas.style.height = `${params.h}px`;
  uiCanvas.style.width = `${params.w}px`;
  uiCanvas.style.height = `${params.h}px`;

  if (params.layer === 'gl') uiCanvas.style.display = 'none';
  if (params.layer === 'overlay') {
    glCanvas.style.display = 'none';
    stage.style.background = '#3a3a3e';   // neutral grey so overlay-only reads clearly
  }

  const engine = createEngine({ glCanvas, uiCanvas, params });
  window.__BLITZ_ENGINE__ = engine;

  engine.buildScene(params.scene);
  publishSceneIndex();   // a piece may have registered iso shots lazily

  if (params.quality === 'live') {
    const stats = engine.captureFrame(params.t);
    markReady(stats);
    engine.startLive();
  } else {
    const stats = engine.captureFrame(params.t);
    markReady(stats);
  }
}

boot().catch(fail);
