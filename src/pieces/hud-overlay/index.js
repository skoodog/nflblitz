// PIECE: hud-overlay
// OWNER: this directory ONLY. Never edit anything outside src/pieces/hud-overlay/.
// SLOT:  ui.hud                       REGISTER VIA: registerUI('hud', impl)
// JUDGED ON: compact top-left HUD + blue TURBO meter bottom-left
// HERO PANELS: qb_dropback, truck
//
// WHAT THIS IS. The two persistent overlay elements, in Canvas2D at logical
// 1920x1080. Geometry is measured off the bar rather than guessed: panel-
// qb_dropback.png is 553x338 for a 1080-tall frame (3.195 logical px per panel
// px), which puts the scoreboard plate at 48,42 / 640x106 with 59-logical-px
// score numerals, and panel-truck.png puts the TURBO plate at 306x82 hugging
// the bottom-left. Those numbers are what a matched-height A/B measures.
//
// COST. Both elements are baked to offscreen canvases and invalidated only when
// the score state actually changes. The frame path is four drawImage calls with
// numeric arguments: no text rasterisation, no gradient construction, no string
// building and no allocation. That is what keeps it inside the 1.80 ms / 4.15 ms
// overlay budget on a device that redraws the HUD layer on every change.
//
// CAPTURE
//   node scripts/shoot.mjs --piece=hud-overlay --layer=overlay
//   node scripts/shoot.mjs --piece=hud-overlay
//   node scripts/compare.mjs --panel=qb_dropback --shot=shots/hud-overlay/qb_dropback.png \
//                            --out=shots/hud-overlay/cmp-r1.png

import { registerUI, registerIsoShot } from '../../foundation/registry.js';
import * as HUD from './hud.js';
import * as TURBO from './turbo.js';
import { drawStates, drawTurbo } from './sheet.js';

export const PIECE = 'hud-overlay';

/* --------------------------------------------------------- state tracking */

// Persistent scratch. Nothing in the compare-or-bake path allocates.
const S = {
  clock: '', dist: '', yards: '',
  teamA: '', teamB: '', scoreA: -1, scoreB: -1,
  momA: -1, momB: -1, possess: -1,
};
let baked = false;
let lastFaces = null, lastBrand = null;
let lastTurboQ = -1;
let turboBaked = false;

function q(v) { return Math.round((v < 0 ? 0 : v > 1 ? 1 : v) * 200); }

function ensure(ui, st) {
  const clock = st.clock === undefined || st.clock === null ? ':15' : String(st.clock);
  const dist = st.dist === undefined || st.dist === null ? '2ND' : String(st.dist);
  const yards = st.yards === undefined || st.yards === null ? '250' : String(st.yards);
  const teamA = String(st.teamA || 'NYC');
  const teamB = String(st.teamB || 'CHI');
  const scoreA = st.scoreA === undefined || st.scoreA === null ? 0 : st.scoreA | 0;
  const scoreB = st.scoreB === undefined || st.scoreB === null ? 0 : st.scoreB | 0;
  const mA = st.momentumA === undefined || st.momentumA === null ? 0.5 : st.momentumA;
  const mB = st.momentumB === undefined || st.momentumB === null ? 0.5 : st.momentumB;
  const poss = st.possess === undefined ? (mA >= mB ? 0 : 1) : (st.possess | 0);

  const dirty = !baked
    || ui.faces !== lastFaces || ui.brand !== lastBrand
    || clock !== S.clock || dist !== S.dist || yards !== S.yards
    || teamA !== S.teamA || teamB !== S.teamB
    || scoreA !== S.scoreA || scoreB !== S.scoreB
    || q(mA) !== q(S.momA) || q(mB) !== q(S.momB) || poss !== S.possess;

  if (dirty) {
    S.clock = clock; S.dist = dist; S.yards = yards;
    S.teamA = teamA; S.teamB = teamB;
    S.scoreA = scoreA; S.scoreB = scoreB;
    S.momA = mA; S.momB = mB; S.possess = poss;
    lastFaces = ui.faces; lastBrand = ui.brand;
    HUD.bake(ui, S, 1);
    baked = true;
  }
  if (!turboBaked || ui.faces !== lastTurboQ) {
    TURBO.bake(ui, 1);
    turboBaked = true;
    lastTurboQ = ui.faces;
  }
}

/* -------------------------------------------------------------- iso hooks */

function isoOf(ui) {
  try {
    if (ui && ui.shot && ui.shot.piece === PIECE) return ui.shot.id;
  } catch (e) { /* fall through */ }
  return null;
}

/* ------------------------------------------------------------------ draw */

registerUI('hud', {
  piece: PIECE,

  draw(c2d, t, state, ui) {
    if (!state || state.visible === false) return;
    const iso = isoOf(ui);
    if (iso === 'iso_hud_states') { drawStates(c2d, t, state, ui); baked = false; return; }
    if (iso === 'iso_turbo') { drawTurbo(c2d, t, state, ui); baked = false; return; }

    ensure(ui, state);

    // Letterboxed runtime surfaces report the logical rect that is really on
    // screen; anchor to that rect rather than to the nominal 1920x1080.
    let vx = 0, vy = 0, vw = ui.W, vh = ui.H;
    if (ui.runtime && ui.visible) {
      vx = ui.visible.x > 0 ? ui.visible.x : 0;
      vy = ui.visible.y > 0 ? ui.visible.y : 0;
      vw = ui.visible.w; vh = ui.visible.h;
    }

    const cv = HUD.canvas();
    if (cv && cv.width > 4) {
      c2d.drawImage(cv, HUD.ORIGIN.x + vx, HUD.ORIGIN.y + vy, HUD.BOX.w, HUD.BOX.h);
    }

    const ty = (vy + vh) - 44 - TURBO.PLATE.h - TURBO.BOX.mg;
    TURBO.draw(c2d, TURBO.ORIGIN.x + vx, ty, state.turbo === undefined ? 0.62 : state.turbo, t, 1);
  },

  /**
   * Quality ladder. Grain, brushed striation and the type emboss are the only
   * things here that cost anything, and they all live in the bake — so a rung
   * change flips a scalar and marks the bakes dirty. It allocates nothing,
   * compiles nothing and is idempotent.
   */
  applyRung(rung) {
    const k = rung <= 2 ? 0.35 : rung <= 6 ? 0.7 : 1;
    HUD.setQuality(k);
    TURBO.setQuality(k);
    baked = false;
    turboBaked = false;
  },
});

/* -------------------------------------------------------------- iso shots */

const BASE = {
  piece: PIECE,
  camera: { pos: [1.6, 1.75, 7.4], target: [0.4, 1.5, -1.0], fov: 34, roll: -0.5 },
  lens: { fStop: 2.0, focusDist: 7.0, bokehScale: 1.1, shutter: 1 / 80 },
  exposure: 1.0,
  weather: { rain: 0.15, lightning: 0.2, haze: 0.55 },
  actors: [],
  ball: { visible: false },
  callout: { visible: false },
  ui: { screen: null, state: {} },
};

registerIsoShot('iso_hud', Object.assign({}, BASE, {
  panel: 'qb_dropback',
  hud: {
    visible: true, clock: ':09', quarter: 3, down: 1, dist: '1ST', yards: '10',
    teamA: 'NYC', teamB: 'CHI', scoreA: 22, scoreB: 14,
    turbo: 0.72, momentumA: 0.62, momentumB: 0.4,
  },
  note: 'Both persistent elements over the real night bowl at the exact logical coordinates measured off panel-qb_dropback: scoreboard 48,42 640x106 and TURBO 48,954 306x82.',
}));

registerIsoShot('iso_hud_states', Object.assign({}, BASE, {
  panel: 'qb_dropback',
  hud: {
    visible: true, clock: ':15', quarter: 2, down: 2, dist: '2ND', yards: '250',
    teamA: 'NYC', teamB: 'CHI', scoreA: 22, scoreB: 14,
    turbo: 0.72, momentumA: 0.62, momentumB: 0.4,
  },
  note: 'The cluster in five game states plus a 2x re-rendered detail crop and a pass over a blown-out frame — proof the plate holds over bright as well as dark.',
}));

registerIsoShot('iso_turbo', Object.assign({}, BASE, {
  panel: 'truck',
  hud: { visible: true, turbo: 0.62 },
  note: 'The TURBO meter at seven fills, empty to charged, with a 2x crop of the anodised bevel, the segmented gloss fill and the white-hot leading edge.',
}));
