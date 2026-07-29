// PIECE: hud-overlay
// OWNER: this directory ONLY. Never edit anything outside src/pieces/hud-overlay/.
// SLOT:  ui.hud                       REGISTER VIA: registerUI('hud', impl)
// JUDGED ON: compact top-left HUD + blue TURBO meter bottom-left
// HERO PANELS: qb_dropback, truck
//
// WHAT THIS IS. The two persistent overlay elements, in Canvas2D at logical
// 1920x1080. Geometry is measured off the bar rather than guessed. panel-
// qb_dropback.png is 553x338 for a 1080-tall frame and the concept sheet's panel
// border sits at panel x=30, so logical x = (panelX - 31) * 3.1953 and logical
// y = panelY * 3.1953. Under that mapping the top-left cluster is SIX recessed
// near-black tiles on opaque black gutters spanning 45..681 x 44.7..146.9 — there
// is no carrier plate — and panel-truck.png puts the TURBO slab at 288 x 82,
// bottom-left, with an oblique word filling a 178 x 37 ink rect.
//
// The type is set by INK RECTANGLE, not by point size (see ink.js): the bar's
// `NYC` is 74 x 46 and its `22` is 99 x 61, both packed edge to edge in their
// cells, and no amount of guessing at `size` gets there.
//
// COST. Every element is baked to an offscreen canvas and invalidated only when
// the state that produced it actually changes. The steady-state frame path is:
//
//   1 drawImage   the whole scoreboard cluster
//   1 drawImage   the TURBO chrome
//   0-2 drawImage the fill strip and its leading-edge sprite
//   0-1 drawImage the OVERHEAT rim, alpha-modulated
//   0-2 drawImage the PERFECT / MISSED timing surfaces, alpha-modulated
//
// — all with numeric arguments. No text rasterisation, no path construction, no
// gradient construction, no string building and no allocation on that path. The
// four transient surfaces are baked ONCE (bakeFx is scale-keyed and a no-op after
// the first call) so a 180 ms fade costs a scalar and a blit, not a re-render.
// That is what keeps it inside the 1.80 ms / 4.15 ms overlay budget on a device
// that redraws the HUD layer on every change.
//
// CAPTURE
//   node scripts/shoot.mjs --piece=hud-overlay --layer=overlay
//   node scripts/shoot.mjs --piece=hud-overlay
//   node scripts/compare.mjs --panel=qb_dropback --shot=shots/hud-overlay/qb_dropback.png \
//                            --out=shots/hud-overlay/cmp-r2.png
//
// SCENES: iso_hud, iso_hud_over_grey, iso_hud_states, iso_turbo,
//         iso_hud_thumbmask, iso_hud_safearea  — the full .recut.json list.

import { registerUI, registerIsoShot } from '../../foundation/registry.js';
import * as HUD from './hud.js';
import * as TURBO from './turbo.js';
import { drawStates, drawTurbo, drawThumbMask, drawSafeArea } from './sheet.js';
import { turboTop } from './layout.js';

export const PIECE = 'hud-overlay';

/* --------------------------------------------------------- state tracking */

// Persistent scratch. Nothing in the compare-or-bake path allocates.
const S = {
  clock: '', dist: '', yards: '', quarter: '', timeouts: 3, timeoutsB: 2,
  teamA: '', teamB: '', scoreA: -1, scoreB: -1,
  momA: -1, momB: -1, possess: -1,
};

const ORD = ['1ST', '2ND', '3RD', '4TH', 'OT'];
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
  const qi = (st.quarter === undefined || st.quarter === null) ? 2 : (st.quarter | 0);
  const quarter = ORD[Math.max(1, Math.min(5, qi)) - 1];
  const tos = st.timeouts === undefined ? 3 : (st.timeouts | 0);
  const tosB = st.timeoutsB === undefined ? 2 : (st.timeoutsB | 0);

  const dirty = !baked
    || ui.faces !== lastFaces || ui.brand !== lastBrand
    || clock !== S.clock || dist !== S.dist || yards !== S.yards
    || quarter !== S.quarter || tos !== S.timeouts || tosB !== S.timeoutsB
    || teamA !== S.teamA || teamB !== S.teamB
    || scoreA !== S.scoreA || scoreB !== S.scoreB
    || q(mA) !== q(S.momA) || q(mB) !== q(S.momB) || poss !== S.possess;

  if (dirty) {
    S.clock = clock; S.dist = dist; S.yards = yards;
    S.quarter = quarter; S.timeouts = tos; S.timeoutsB = tosB;
    S.teamA = teamA; S.teamB = teamB;
    S.scoreA = scoreA; S.scoreB = scoreB;
    S.momA = mA; S.momB = mB; S.possess = poss;
    lastFaces = ui.faces; lastBrand = ui.brand;
    HUD.bake(ui, S, 1);
    HUD.bakeFx(1);
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
    if (iso === 'iso_hud_thumbmask') { drawThumbMask(c2d, t, state, ui); baked = false; return; }
    if (iso === 'iso_hud_safearea') { drawSafeArea(c2d, t, state, ui); baked = false; return; }

    ensure(ui, state);

    // SAFE AREA, 16:9 THROUGH 21:9. The runtime overlay CONTAIN-fits 1920x1080
    // onto the device, so on anything that is not 16:9 `ui.visible` is LARGER
    // than the nominal box and its origin is NEGATIVE — the screen's left edge
    // lives at a logical x below zero. Anchoring to 0,0 would leave the cluster
    // floating in from the edge on an ultrawide and, worse, would put the TURBO
    // plate below the real bottom on a tall device. So both elements anchor to
    // the visible rect itself, and the cluster additionally never crosses the
    // safe inset (which is what keeps it out of a notch).
    let vx = 0, vy = 0, vw = ui.W, vh = ui.H;
    if (ui.runtime && ui.visible) {
      vx = ui.visible.x; vy = ui.visible.y;
      vw = ui.visible.w; vh = ui.visible.h;
    }

    const cv = HUD.canvas();
    if (cv && cv.width > 4) {
      c2d.drawImage(cv, HUD.ORIGIN.x + vx, HUD.ORIGIN.y + vy, HUD.BOX.w, HUD.BOX.h);
    }
    HUD.drawFx(c2d, HUD.ORIGIN.x + vx, HUD.ORIGIN.y + vy,
      state.flash === undefined ? 0 : state.flash,
      state.miss === undefined ? 0 : state.miss, 1);

    // The capture path matches the bar's own bottom-left placement exactly; a
    // touch runtime lifts the meter clear of the left thumb's resting arc.
    const ty = turboTop(vx, vy, vw, vh, TURBO.PLATE.x, TURBO.PLATE.h, TURBO.BOX.mg, !!ui.runtime);
    TURBO.draw(c2d, TURBO.ORIGIN.x + vx, ty,
      state.turbo === undefined ? 0.62 : state.turbo, t, 1,
      state.overheat === undefined ? 0 : state.overheat);
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
    visible: true, clock: ':05', quarter: 3, down: 1, dist: '1ST', yards: '167',
    teamA: 'NYC', teamB: 'CHI', scoreA: 22, scoreB: 14, possess: 1,
    turbo: 0.68, momentumA: 0.62, momentumB: 0.86,
  },
  note: 'Both persistent elements over the real night bowl at the exact logical coordinates measured off panel-qb_dropback: six recessed tiles spanning 45..681 x 44.7..146.9, and the TURBO slab 288x82 bottom-left.',
}));

registerIsoShot('iso_hud_over_grey', Object.assign({}, BASE, {
  panel: 'qb_dropback',
  exposure: 2.6,
  weather: { rain: 0, lightning: 0, haze: 0.9 },
  hud: {
    visible: true, clock: ':09', quarter: 3, down: 1, dist: '1ST', yards: '167',
    teamA: 'NYC', teamB: 'CHI', scoreA: 22, scoreB: 14,
    turbo: 0.72, momentumA: 0.62, momentumB: 0.86,
  },
  note: 'The same cluster over a deliberately blown-out frame. Because there is no lit carrier plate any more, the only thing holding legibility is the black gutters and the numeral keylines — this is where that decision gets tested.',
}));

registerIsoShot('iso_hud_states', Object.assign({}, BASE, {
  panel: 'qb_dropback',
  hud: {
    visible: true, clock: ':15', quarter: 2, down: 2, dist: '2ND', yards: '250',
    teamA: 'NYC', teamB: 'CHI', scoreA: 22, scoreB: 14,
    turbo: 0.72, momentumA: 0.62, momentumB: 0.4,
  },
  note: 'The cluster in four game states plus the PERFECT and MISSED timing surfaces, a pass over a blown-out frame, a 2x re-rendered detail crop, and the measured bar geometry printed so the claim can be audited.',
}));

registerIsoShot('iso_turbo', Object.assign({}, BASE, {
  panel: 'truck',
  hud: { visible: true, turbo: 0.62 },
  note: 'The TURBO meter at seven fills — empty, charged and OVERHEAT — with 2x crops of the rim, the single divider, the white-hot smear and the oblique word.',
}));

registerIsoShot('iso_hud_thumbmask', Object.assign({}, BASE, {
  panel: 'qb_dropback',
  hud: {
    visible: true, clock: ':15', quarter: 2, dist: '2ND', yards: '250',
    teamA: 'NYC', teamB: 'CHI', scoreA: 22, scoreB: 14,
    turbo: 0.72, momentumA: 0.62, momentumB: 0.4,
  },
  note: 'Thumb-occlusion proof at 844x390 and 1024x768. The arcs and the meter lift come from layout.js, the same module the shipped draw() calls, so the sheet cannot claim a clearance the game does not have.',
}));

registerIsoShot('iso_hud_safearea', Object.assign({}, BASE, {
  panel: 'qb_dropback',
  hud: {
    visible: true, clock: ':15', quarter: 2, dist: '2ND', yards: '250',
    teamA: 'NYC', teamB: 'CHI', scoreA: 22, scoreB: 14,
    turbo: 0.72, momentumA: 0.62, momentumB: 0.4,
  },
  note: '16:9 through 21:9 with a notch. The cluster keeps its 48 px inset from the VISIBLE left edge rather than from a nominal 1920, and steps inside a notch instead of under it.',
}));
