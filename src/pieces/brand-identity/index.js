// PIECE: brand-identity  (plan id: "team-identity")
// SLOT:  brand   -> registerBrand(impl)
// OWNS:  src/pieces/brand-identity/**  and  shots/brand-identity/**
//
// Delivers the league's whole visual identity: all 32 clubs with their
// club colour systems and ratings-derived club values, the procedural
// crest generator (every club drawn as its own illustrated mascot), wordmark
// lockups, the NFL shield, the BLITZ logotype, and layered city skylines.
// Everything downstream (menu-title, uniform-kit, hud-overlay) consumes this
// through REG.brand.
//
// NOTE ON ISO SCENES. The frozen foundation gives the `brand` slot no rendering
// surface of its own — brand is a library the UI screens call, and every UI slot
// belongs to another piece. So this piece's five specimen sheets ride the one
// surface it legitimately owns: its own brand hooks. They are painted only when
// the scene id is one of the five `iso_*` ids registered below (scenes this piece
// owns outright), and never in `title`, `team_select` or `uniform`, where the
// hooks behave exactly as the contract specifies.

import { registerBrand, registerIsoShot } from '../../foundation/registry.js';
import { parseParams } from '../../foundation/params.js';
import { TEAMS, byId } from './teams.js';
import { crest } from './crests.js';
import { skyline as drawSkyline } from './skylines.js';
import { leagueMark as drawLeagueMark, blitzLogo as drawBlitzLogo, wordmark as drawWordmark } from './marks.js';
import { SHEETS } from './sheets.js';

export const PIECE = 'brand-identity';

/* ------------------------------------------------------- iso sheet takeover */

let ISO = null;
let ISO_VARIANT = '';
try {
  const p = parseParams();
  if (SHEETS[p.scene]) { ISO = p.scene; ISO_VARIANT = p.variant || ''; }
} catch (e) { ISO = null; }

let painted = false;

function paintSheet(c, isEntry) {
  if (!ISO) return false;
  if (!isEntry && painted) { c.globalAlpha = 0; return true; }
  c.globalAlpha = 1;
  c.save();
  try { SHEETS[ISO](c, 0, ISO_VARIANT); } catch (e) {
    console.error('[brand-identity] sheet failed', e);
    (window.__BLITZ_ERRORS__ = window.__BLITZ_ERRORS__ || []).push(`[brand-identity] sheet: ${e && e.message}`);
  }
  c.restore();
  painted = true;
  // Suppress the host screen's remaining draw calls inside this piece-owned scene.
  c.globalAlpha = 0;
  return true;
}

/* ---------------------------------------------------------------- contract */

function skyline(c, cityId, box, opts) {
  if (paintSheet(c, true)) return box;
  return drawSkyline(c, cityId, box, opts || {});
}
function leagueMark(c, box, opts) {
  if (paintSheet(c, false)) return box;
  return drawLeagueMark(c, box, opts || {});
}
function blitzLogo(c, box, opts) {
  if (paintSheet(c, false)) return box;
  return drawBlitzLogo(c, box, opts || {});
}

registerBrand({
  piece: PIECE,
  teams: TEAMS,
  byId,
  crest,
  wordmark: drawWordmark,
  skyline,
  leagueMark,
  blitzLogo,
});

/* --------------------------------------------------------------- iso shots */

const BASE = {
  piece: PIECE,
  camera: { pos: [0, 1.6, 7.5], target: [0, 1.2, 0], fov: 34, roll: 0 },
  lens: { fStop: 2.8, focusDist: 7.5, bokehScale: 1, shutter: 0 },
  actors: [],
  ball: { visible: false },
  hud: { visible: false },
  callout: { visible: false },
  weather: { rain: 0, lightning: 0, haze: 0.3 },
};

registerIsoShot('iso_crests', Object.assign({}, BASE, {
  panel: 'team_select',
  ui: { screen: 'title', state: {} },
  note: 'four hero clubs large on dark cards — snarling Bears bear, crested Cardinals head, screaming Eagles raptor, horned Vikings warrior',
}));

registerIsoShot('iso_crest_detail', Object.assign({}, BASE, {
  panel: 'team_select',
  ui: { screen: 'title', state: {} },
  note: 'one crest at hero scale plus bevel / inner-glow / scratch crops and the official colour strip',
}));

registerIsoShot('iso_league', Object.assign({}, BASE, {
  panel: 'team_select',
  ui: { screen: 'title', state: {} },
  note: 'all 32 clubs, each drawn as its own mascot in its own club colours, by conference and division',
}));

registerIsoShot('iso_palettes', Object.assign({}, BASE, {
  panel: 'team_select',
  ui: { screen: 'title', state: {} },
  note: 'every club colour system, official hex values read straight from src/data/teams.json',
}));

registerIsoShot('iso_skyline', Object.assign({}, BASE, {
  panel: 'title',
  ui: { screen: 'title', state: {} },
  note: 'layered city skylines with atmospheric falloff and lit windows',
}));

registerIsoShot('iso_leaguemark', Object.assign({}, BASE, {
  panel: 'title',
  ui: { screen: 'title', state: {} },
  note: 'fictional league badge + BLITZ RELOADED logotype, with a scale ladder down to 26 px',
}));
