// FOUNDATION — FROZEN after t=0. Do not edit.
// Scene resolution. REG.isoShots is checked FIRST, then REG.cinema.shots.
// That ordering is what keeps per-piece capture scenes file-disjoint: a piece
// registers `iso:<piece-id>` (or any id it likes) and owns it outright.

import { REG, PIECE_HEROES, SCENE_PANELS } from './registry.js';
import { makeShot } from './contracts.js';

/** Every scene id currently reachable, iso shots first. */
export function listScenes() {
  const out = [];
  for (const id of Object.keys(REG.isoShots)) {
    const s = REG.isoShots[id];
    out.push({ id, kind: 'iso', piece: s.piece || null, panel: s.panel || null, note: s.note || '' });
  }
  const cs = REG.cinema.shots || {};
  for (const id of Object.keys(cs)) {
    if (REG.isoShots[id]) continue;
    out.push({ id, kind: 'hero', piece: null, panel: SCENE_PANELS[id] || null, note: cs[id].note || '' });
  }
  return out;
}

/** Scene ids that `--piece=<id>` should capture. */
export function scenesForPiece(pieceId) {
  const iso = Object.keys(REG.isoShots).filter((k) => REG.isoShots[k].piece === pieceId);
  const heroes = (PIECE_HEROES[pieceId] || []).filter((id) => resolveRaw(id));
  return [...iso, ...heroes];
}

function resolveRaw(sceneId) {
  if (REG.isoShots[sceneId]) return REG.isoShots[sceneId];
  const cs = REG.cinema.shots || {};
  if (cs[sceneId]) return cs[sceneId];
  return null;
}

/**
 * resolveScene(sceneId, params) -> fully-populated ShotSpec.
 * `live_play` (or any spec with live:true) is driven by REG.sim:
 *   sim.create(seed) -> sim.seekTo(state, t) -> sim.snapshot(state) -> merged into the spec.
 */
export function resolveScene(sceneId, params) {
  const raw = resolveRaw(sceneId);
  if (!raw) {
    return makeShot({
      id: sceneId,
      note: `UNKNOWN SCENE "${sceneId}" — run: node scripts/shoot.mjs --list`,
      hud: { visible: false },
      actors: [],
    });
  }

  let spec = raw;

  if (raw.live) {
    let snap = null;
    try {
      const state = REG.sim.create(params.seed, { teamA: 'NYC', teamB: 'CHI' });
      REG.sim.seekTo(state, params.t);
      snap = REG.sim.snapshot(state);
    } catch (e) {
      console.error('[scenes] sim failed:', e);
      (window.__BLITZ_ERRORS__ = window.__BLITZ_ERRORS__ || []).push(`[scenes] sim: ${e && e.message}`);
    }
    if (snap) {
      spec = Object.assign({}, raw, {
        actors: snap.actors,
        ball: snap.ball,
        hud: Object.assign({}, raw.hud, snap.hud),
        fx: (snap.events || []).map((ev) => ({ kind: ev.kind, pos: ev.pos, dir: [0, 1, 0], power: ev.power, age: params.t - ev.t })),
      });
    }
  }

  const shot = makeShot(spec);
  shot.id = sceneId;
  shot.panel = raw.panel || SCENE_PANELS[sceneId] || null;
  shot.piece = raw.piece || null;

  // URL overrides.
  if (params.hud !== null && params.hud !== undefined) shot.hud.visible = !!params.hud;
  if (params.ui === 0) shot.ui.screen = null;
  if (params.variant) shot.variant = params.variant;
  return shot;
}

export default { listScenes, scenesForPiece, resolveScene };
