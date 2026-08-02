// PIECE: menu-playcall
// OWNER: this directory ONLY. Never edit anything outside src/pieces/menu-playcall/.
// SLOT:  ui.playcall                    REGISTER VIA: registerUI('playcall', impl)
// JUDGED ON: the PICK A PLAY screen — 18 offensive plays over two pages of nine, 9
//            defensive calls, real route geometry on every card, :09 clock.
// HERO PANELS: playcall_def
//
// WHAT THIS IS. A fixed 1920x1080 Canvas2D screen drawn over whatever the world layer
// is showing (in the hero shot, a linebacker). Three sheets share one 3x3 grid:
// offence page 1, offence page 2, defence. Every play, every route waypoint and every
// coverage assignment is read out of src/data/playbook.json — the SHARED book, one
// sheet for all 32 clubs, nothing keyed by club anywhere in this directory.
//
// THE ROUTES ARE THE DATA. A card is not a decorative squiggle: `routes.REC1` is a
// waypoint chain in yards and it is projected and drawn as given, through one depth
// curve shared by all 27 cards so two cards can be compared (layout.js). A defensive
// card draws the `assign` map against the shipped `formation`, with the man-coverage
// target derived from who each defender is actually lined up over (book.js).
//
// WHAT I GOT WRONG ON THE WAY, since the house rule is to write it down. Each of these
// was found in a render or a measurement, and says which:
//   1. HAIL MARY's three arrowheads were SHEARED OFF by the diagram's clip edge — the
//      deepest route in the book mapped to exactly the top of the box. Seen in the
//      first full 1920x1080 render of offence page 1. Fixed with 10 px of headroom in
//      makeProj (diagram.js).
//   2. The defensive cards were drawn through the offensive depth curve. Computing the
//      two mappings against the 119 px box a card actually has: a rusher 1.2 yards off
//      the ball sat 12% up the box (as far off the line as a 4-yard drop) and a
//      13-yard-deep third was squashed to 28 px. The defensive sheet now maps linearly
//      over 34 yards; the same bubble is 46 px. Table in layout.js.
//   3. DEEP ZONE's outside bubble was cut in half by the card's left edge — a zone
//      centred on -16.1 with a 9-yard radius reaches -25 and the card draws 21. Seen
//      in the first defensive render; zone centres are now clamped (book.js).
//   4. UP THE GUT's gap chevron was drawn UNDER the three offensive-line slabs, which
//      is precisely where a gap-0 marker is invisible. Seen on card 8 of the first
//      offence render; the chevron is now drawn after the pocket, above the line.
//   5. The headline was set by point size. Measured on my own render with PIL, size 104
//      gave a 73 px cap against the bar's 99 and 1284 px of ink against the bar's 1123.
//      Everything on the screen is now set by INK BOX (ink.js), and the same call lands
//      the bar's rectangle with the fallback face and with a real one.
//   6. The plate grain was 57,000 individual fillRects for the backdrop alone. Measured
//      in-page: 359 ms to bake the sheet, 160 ms on a page flip. Rasterised into one
//      256 px tile and repeated: 143 ms and 51 ms. Numbers in chrome.js.
//   7. The hero composition put the linebacker DEAD BEHIND the card grid — the
//      foundation's playcall_def camera centres him, and that panel is a crop. The
//      first real capture of iso:playcall-defense showed no player at all; a 960x540
//      world-only pass (--ui=0) proved he was there and hidden. The camera in this
//      file is re-aimed past him; see CAM.
//   8. The bead walker resampled each segment from its own origin, which would stack
//      two beads on top of each other at every route break. Caught by reading the
//      function back while writing it, not by a render — recorded because the fix (one
//      global arc-length cursor, chrome.js walk()) is load-bearing for how the routes
//      read.
// And one that was never shipped but is worth the warning: transcribing the bar's card
// grid literally puts the grid's right edge at logical 1757, because the panel is a
// 78 px horizontal CROP of the 1920 frame. It is re-anchored to the 48 px safe inset.
//
// STATE (all optional; every field has a default that renders):
//   side       'offense' | 'defense'      default 'defense' (the hero panel's sheet)
//   page       1 | 2                      offence only; the book ships 2 pages
//   selected   0..8                       index into the 3x3
//   clock      string, e.g. ':09'
//   formation  chip word, e.g. 'NICKEL'
//   team       club abbr from src/data/teams.json — chip accent only, never the plays
//
//   state.plays (the foundation fallback's eight invented names) is DELIBERATELY
//   IGNORED. Those eight strings are not in the playbook and have no routes; honouring
//   them would mean inventing geometry, which is the one thing this screen must not
//   do. The names on the cards are the shipped names.
//
// CAPTURE
//   node scripts/shoot.mjs --scene=iso:playcall-defense --accum=8 --timeout=800000 \
//        --out=shots/menu-playcall/defense.png
//   node scripts/shoot.mjs --piece=menu-playcall --accum=8 --timeout=800000

import { registerUI, registerIsoShot } from '../../foundation/registry.js';
import { drawScreen, invalidate } from './screen.js';
import { setQuality } from './quality.js';
import { drawProofSheet, drawGeometrySheet } from './sheets.js';
import { PAGES } from './book.js';

export const PIECE = 'menu-playcall';

/* --------------------------------------------------------------- state ---- */

const S = {
  side: 'defense', page: 1, selected: 0,
  clock: ':09', formation: 'NICKEL', team: '',
};

function normalise(st) {
  const s = st || {};
  const side = s.side === 'offense' ? 'offense' : 'defense';
  S.side = side;
  S.page = Math.max(1, Math.min(PAGES, (s.page | 0) || 1));
  S.selected = s.selected === undefined || s.selected === null ? 0 : Math.max(-1, Math.min(8, s.selected | 0));
  S.clock = s.clock === undefined || s.clock === null ? ':09' : String(s.clock);
  // The chip word. The defensive one is the bar's ('NICKEL'); the offensive one is
  // DERIVED from the book's own slot list (three receiver slots -> '3 WIDE') rather
  // than invented, because the playbook ships exactly one formation and naming it
  // something the data does not say would be a fiction on a screen full of facts.
  S.formation = s.formation ? String(s.formation).toUpperCase() : (side === 'offense' ? '3 WIDE' : 'NICKEL');
  S.team = s.team ? String(s.team).toUpperCase() : '';
  return S;
}

/* ---------------------------------------------------------------- iso ----- */

function isoOf(ui) {
  try {
    if (ui && ui.shot && ui.shot.piece === PIECE) return ui.shot.id;
  } catch (e) { /* not an iso shot */ }
  return null;
}

/* --------------------------------------------------------------- draw ----- */

registerUI('playcall', {
  piece: PIECE,

  draw(c2d, t, state, ui) {
    const iso = isoOf(ui);
    if (iso === 'iso:playcall-geometry') { drawGeometrySheet(c2d, t, ui); invalidate(); return; }
    if (iso === 'iso:playcall-legend') { drawProofSheet(c2d, t, ui); invalidate(); return; }
    drawScreen(c2d, t, normalise(state), ui);
  },

  /**
   * Quality ladder. The only things here that cost anything are the plate grain and
   * the selection halo's shadow blur, and both live behind a scalar. Allocates
   * nothing, compiles nothing, idempotent — it sets the scalar and marks the two bakes
   * dirty so the next draw re-bakes at the new quality.
   */
  applyRung(rung) {
    setQuality(rung <= 2 ? 0 : rung <= 6 ? 0.55 : 1);
    invalidate();
  },
});

/* --------------------------------------------------------------- scenes --- */

/**
 * THE CAMERA IS AIMED PAST THE PLAYER, ON PURPOSE.
 *
 * The foundation's `playcall_def` shot puts the linebacker dead centre and looks at
 * his back — which is right for the BAR PANEL, because that panel is a crop of the
 * frame. Captured full-frame at 1920x1080 with this screen over it, he lands squarely
 * behind the card grid: the first real capture of iso:playcall-defense had him
 * completely hidden, and the world-only pass at 960x540 (--ui=0) is what proved it.
 *
 * So the camera axis is offset to his right and he is turned to face it. With fov 32
 * vertical at 16:9 the horizontal half-angle is atan(tan(16 deg) * 1.778) = 27.0 deg,
 * so across the 3.35 m from the camera plane to his the half-width is tan(27) * 3.35 =
 * 1.71 m. The axis sits 1.13 m to his right, which lands him at -0.66 of the
 * half-width, i.e. screen x ~= 325 px — clear of the grid's left edge at 504.
 * Vertically, half-height = tan(16) * 3.35 = 0.96 m about a 1.26 m target, so the frame
 * runs 0.30..2.22 m and he is cropped at the thigh, as the bar crops him.
 *
 * The intermediate pass (x=-1.06, z=3.6) was checked at 960x540 — a 60 s capture
 * instead of a 400 s one — and put his shoulder pad on logical x~510, touching the
 * chip. Backing off 0.35 m and shifting the axis 0.09 m right is what these numbers are.
 */
const CAM = { pos: [-0.97, 1.48, 3.95], target: [-0.97, 1.26, 0.6], fov: 32 };

const BASE = {
  piece: PIECE,
  exposure: 0.95,
  weather: { rain: 0, lightning: 0, haze: 0.35 },
  ball: { visible: false },
  callout: { visible: false },
  hud: { visible: false },
  actors: [],
};

// The defensive sheet in the hero composition: the same linebacker as the foundation's
// `playcall_def`, re-framed into the left rail (see CAM) so the screen and the player
// are both readable in one full frame.
registerIsoShot('iso:playcall-defense', Object.assign({}, BASE, {
  panel: 'playcall_def',
  camera: CAM,
  actors: [
    { id: 'lb', team: 'SEA', variant: 'home', number: '56', name: 'CROW', archetype: 'lb', pose: 'stance_defense', pos: [-2.1, 0, 0.6], rotY: -0.30, hero: true },
  ],
  ui: { screen: 'playcall', state: { side: 'defense', selected: 4, clock: ':09', formation: 'NICKEL', team: 'SEA' } },
  note: 'The nine shipped defensive calls, each drawn from its own `assign` map against the shipped formation: rush arrows red, man magenta and dashed, zone bubbles cyan, spy green. Composed over the same linebacker as bar/panel-defense_playcall.png, re-framed into the left rail so a full 1920x1080 frame shows both him and the sheet.',
}));

registerIsoShot('iso:playcall-offense', Object.assign({}, BASE, {
  panel: 'playcall_def',
  camera: CAM,
  actors: [
    { id: 'qb', team: 'NYC', variant: 'home', number: '7', name: 'STRYKER', archetype: 'qb', pose: 'idle', pos: [-2.1, 0, 0.6], rotY: -0.22, hero: true },
  ],
  ui: { screen: 'playcall', state: { side: 'offense', page: 1, selected: 0, clock: ':09', team: 'NYC' } },
  note: 'Offensive page 1 — nine plays, every route drawn from its waypoint chain in playbook.json through the shared depth curve. UPPER CUT, WHITEOUT, HAIL MARY, TURMOIL, SPLIT, X CROSS, DOG HOOK, UP THE GUT, SCREEN.',
}));

registerIsoShot('iso:playcall-offense-p2', Object.assign({}, BASE, {
  panel: 'playcall_def',
  camera: CAM,
  actors: [
    { id: 'qb', team: 'NYC', variant: 'home', number: '7', name: 'STRYKER', archetype: 'qb', pose: 'idle', pos: [-2.1, 0, 0.6], rotY: -0.22, hero: true },
  ],
  ui: { screen: 'playcall', state: { side: 'offense', page: 2, selected: 8, clock: ':04', team: 'NYC' } },
  note: 'Offensive page 2 and the page pips. Proves the second page of nine exists and that the pip row tracks it.',
}));

registerIsoShot('iso:playcall-geometry', Object.assign({}, BASE, {
  panel: 'playcall_def',
  camera: { pos: [0, 1.5, 6], target: [0, 1.35, 0], fov: 32 },
  ui: { screen: 'playcall', state: {} },
  note: 'THE AUDIT SHEET. The depth curve drawn as a ruler with its measured table, one offensive and one defensive card at 1.74x with every waypoint and every assignment labelled, and the bar-panel geometry this layout was derived from printed so the derivation can be checked rather than believed.',
}));

registerIsoShot('iso:playcall-legend', Object.assign({}, BASE, {
  panel: 'playcall_def',
  camera: { pos: [0, 1.5, 6], target: [0, 1.35, 0], fov: 32 },
  ui: { screen: 'playcall', state: {} },
  note: 'All 27 cards in the book at card scale — both offensive pages and the defensive sheet on one surface — plus the slot and assignment colour keys. This is the sheet that shows no two plays render alike.',
}));
