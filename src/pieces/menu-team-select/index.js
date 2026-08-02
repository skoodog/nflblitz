// PIECE: menu-team-select
// OWNER: this directory ONLY. Never edit anything outside src/pieces/menu-team-select/.
// SLOT:  ui.teamSelect                REGISTER VIA: registerUI('teamSelect', impl)
// JUDGED ON: CHOOSE YOUR CITY, 4 team cards, crests, gold stat bars
// HERO PANELS: team_select
// ISO SCENES: iso_team_select, iso_team_select_league, iso_team_select_states,
//             iso_team_select_touch
//
// WHAT THIS IS. The club-choice screen, in Canvas2D at logical 1920x1080. Four hero
// cards showing one real NFL division, a header lifted from the concept panel, and a
// rail underneath that names all eight divisions and all 32 clubs. Every colour is a
// club's own official hex out of src/data/teams.json; every bar is brand-identity's
// ratings-derived club stat; every star player is the highest-ovr man on that club's
// real 14-man roster in src/data/players.json.
//
// WHERE THE NUMBERS CAME FROM: layout.js's header carries the full measurement of
// bar/panel-team_select.png (card borders at x 25.0/137.5/250.0/362.0, card aspect
// 0.451, three gold bar rows at 0.752/0.840/0.923 of the card, 11 segments per bar)
// and the list of deliberate deviations from it.
//
// THINGS I GOT WRONG AND HOW I FOUND OUT — the short list; each is written up at the
// point it bit:
//   * I first coloured every nickname with brand-identity's `colors.accent`. Reading
//     teams.json back, that field is #FFFFFF for 15 of the 32 clubs, so half the
//     league would have had a white name and no identity. palette.js explains the
//     replacement.
//   * I first planned a "SQUAD 94" overall badge per card. Measured over players.json
//     the club mean ovr spans 93..96 across all 32 clubs — it cannot separate anyone.
//     Deleted; league.js records the measurement so nobody re-adds it.
//   * The first draft's dark keylines were invisible: 17 of 32 official primaries sit
//     below luma 0.20 and the card ground is 0.02. chrome.beacon() is the fix, and
//     its FIRST version had a clipping bug that turned Kansas City hot pink — both
//     the fix and the bug are written up in that function's header.
//   * The first draft breathed the selected card's bloom and drifted the chevrons on
//     `t`, and marked the whole overlay dirty every frame to do it. That is the exact
//     per-frame full-layer re-upload foundation/overlay.js's header measures and
//     warns about. The screen is now one static bake and one drawImage; screen.js
//     carries the reasoning.
//
// CAPTURE
//   node scripts/shoot.mjs --piece=menu-team-select --timeout=800000
//   node scripts/shoot.mjs --scene=iso_team_select --accum=8 --timeout=800000 \
//                          --out=shots/menu-team-select/iso_team_select.png
//   node scripts/compare.mjs --panel=team_select \
//        --shot=shots/menu-team-select/iso_team_select.png \
//        --out=shots/menu-team-select/cmp.png
//
// A MUCH cheaper loop exists and was used for every iteration here — this screen is
// pure Canvas2D, so devtools/preview.html renders it with no three.js and no WebGL at
// all. Measured on this box, three consecutive runs including the browser launch:
// 2919 / 2854 / 2876 ms, against 179 s for the same pixels through scripts/shoot.mjs
// (109.1 s to __BLITZ_READY__ plus 70.0 s for SwiftShader to read the layer pair
// back). A 62x loop. The two paths were then compared frame to frame and agree — see
// that file's header.
//
// DETERMINISM: no clock is read, and nothing on this screen animates at all — see
// the note at the top of screen.js for the measurement that killed the two things
// that used to. The backdrop's streaks come from makeRng('menu-team-select/bg'), so
// the same field is drawn on every capture. Two runs are byte-identical.

import { registerUI, registerIsoShot } from '../../foundation/registry.js';
import { drawScreen, invalidateBackdrop, invalidateSheet } from './screen.js';
import { invalidate as invalidateCards } from './card.js';
import { resetTypeCache } from './chrome.js';
import { invalidatePalette } from './palette.js';
import { isSheet, drawSheet } from './sheets.js';
import { hitTargets, hitAt, reachReport } from './layout.js';
import { resolve } from './league.js';

export const PIECE = 'menu-team-select';

let lastFaces = null;
let lastBrand = null;

const impl = {
  piece: PIECE,

  /** Rectangles a finger may land on, for whoever wires the input. */
  hitTargets,
  hitAt,
  reachReport,
  /** The screen's model for a given ShotSpec state — what is shown and what is picked. */
  model: resolve,

  draw(c2d, t, state, ui) {
    // The faces / brand objects are swapped once at boot when their pieces register.
    // Everything in here is baked against them, so a change must drop every cache.
    if (ui.faces !== lastFaces || ui.brand !== lastBrand) {
      lastFaces = ui.faces; lastBrand = ui.brand;
      resetTypeCache(); invalidatePalette(); invalidateCards(); invalidateBackdrop(); invalidateSheet();
    }

    const sheet = sheetOf(ui);
    if (sheet) { drawSheet(sheet, c2d, t, state, ui); return; }

    // One drawImage of a pre-baked sheet. drawScreen() marks the overlay dirty
    // itself, and only when the sheet it just handed back was actually rebuilt.
    drawScreen(c2d, t, state, ui);
  },

  /**
   * Quality ladder. Everything expensive is in the two bakes, so a rung change is a
   * scalar plus a cache drop: no allocation on the call itself, no shader, no render
   * target, and idempotent.
   */
  applyRung() {
    // Nothing here scales with the rung: the card bake is already keyed by the
    // raster the overlay blits at, which is the only thing that changes cost.
  },
};

function sheetOf(ui) {
  try {
    if (ui && ui.shot && ui.shot.piece === PIECE && isSheet(ui.shot.id)) return ui.shot.id;
  } catch (e) { /* never let a diagnostic wedge the screen */ }
  return null;
}

registerUI('teamSelect', impl);

/* -------------------------------------------------------------- iso shots */
//
// The screen is opaque and covers the frame, so these scenes carry no actors and no
// lit world: what is being judged is entirely the overlay. `hud:{visible:false}`
// keeps hud-overlay's cluster from landing on top of the title.

const BASE = {
  piece: PIECE,
  camera: { pos: [0, 1.7, 9], target: [0, 1.5, 0], fov: 34 },
  lens: { fStop: 2.8, focusDist: 9, bokehScale: 1, shutter: 0 },
  actors: [],
  ball: { visible: false },
  hud: { visible: false },
  callout: { visible: false },
  weather: { rain: 0, lightning: 0, haze: 0.3 },
};

registerIsoShot('iso_team_select', Object.assign({}, BASE, {
  panel: 'team_select',
  ui: { screen: 'teamSelect', state: { team: 'CHI' } },
  note: 'The shipping screen: NFC NORTH on the cards with Chicago selected, all eight divisions and all 32 clubs on the rail. The direct A/B against bar/panel-team_select.png.',
}));

registerIsoShot('iso_team_select_league', Object.assign({}, BASE, {
  panel: 'team_select',
  ui: { screen: 'teamSelect', state: { team: 'CHI' } },
  note: 'All 32 clubs at once — crest, official colour strip and the three club stats as numbers next to the bars, so the claim that the bars come from the ratings can be audited club by club.',
}));

registerIsoShot('iso_team_select_states', Object.assign({}, BASE, {
  panel: 'team_select',
  ui: { screen: 'teamSelect', state: { team: 'CHI' } },
  note: 'The same club selected and unselected at full size and again at the 0.361 phone fit, the segmented meter at eleven fills, the six clubs whose official primary is darkest with the colour beacon() rescues them to, and the measured panel geometry.',
}));

registerIsoShot('iso_team_select_touch', Object.assign({}, BASE, {
  panel: 'team_select',
  ui: { screen: 'teamSelect', state: { team: 'KC' } },
  note: 'Hit rectangles and thumb reach at 844x390 and 1024x768, with every target measured in millimetres through the overlay fit — the proof that nothing on this screen is under the 9 mm floor.',
}));
