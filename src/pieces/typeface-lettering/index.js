// PIECE: typeface-lettering
// OWNER: this directory ONLY.
// SLOT:  faces  (registerFaces)
// JUDGED ON: the four vector faces: blitz-brush / blitz-block / blitz-num / blitz-techno
// HERO PANELS: title, midair_hit
// ISO SCENES: iso_type, iso_type_brush, iso_type_hud, iso_type_specimen
//
// CAPTURE
//   node scripts/shoot.mjs --piece=typeface-lettering
//   node scripts/compare.mjs --panel=midair_hit --shot=shots/typography/iso_type.png \
//                            --out=shots/typography/cmp-r1.png
//
// Every glyph in all four faces is authored here as vector outline data compiled from
// brush/pen stroke skeletons — no font file, no CDN, nothing from the system stack.

import { registerFaces, registerUI, registerIsoShot, REG } from '../../foundation/registry.js';
import { createFaces } from './render.js';
import { SPECIMENS } from './specimen.js';

export const PIECE = 'typeface-lettering';

/* ------------------------------------------------------------------ faces */

const faces = createFaces();
registerFaces(Object.assign({}, faces, { piece: PIECE }));

/* ------------------------------------------------------------ iso capture */
//
// The foundation gives the overlay exactly six draw hooks (hud, callout and the four
// menu screens) and all six belong to other pieces, so a faces piece has no sanctioned
// way to render its own specimen sheet. Rather than steal a slot, this wraps `callout`
// and delegates EVERY call straight through to whatever was registered before us
// (score-callout imports first, alphabetically) except on the four iso scenes this
// piece owns. Failure-safe: any error in the check falls through to the delegate.

const prevCallout = REG.ui.callout;

registerUI('callout', {
  piece: PIECE,
  draw(c2d, t, state, ui) {
    let mine = null;
    try {
      const id = ui && ui.shot && ui.shot.piece === PIECE ? ui.shot.id : null;
      mine = id && SPECIMENS[id] ? SPECIMENS[id] : null;
    } catch (e) { mine = null; }
    if (mine) { mine(c2d, t, state, ui); return; }
    if (prevCallout && typeof prevCallout.draw === 'function') prevCallout.draw(c2d, t, state, ui);
  },
});

const ISO_BASE = {
  piece: PIECE,
  camera: { pos: [0, 1.7, 9], target: [0, 1.5, 0], fov: 34 },
  actors: [],
  ball: { visible: false },
  hud: { visible: false },
  callout: { visible: true, line1: '', line2: '', pts: 0 },
  ui: { screen: null, state: {} },
};

registerIsoShot('iso_type', Object.assign({}, ISO_BASE, {
  panel: 'midair_hit',
  note: 'Specimen sheet: MID-AIR / MURDER! / 250 PTS / CHOOSE YOUR CITY / TOUCHDOWN! / NYC 22 / TURBO / A-Z 0-9, each in its shipping treatment for direct crop-compare.',
}));

registerIsoShot('iso_type_brush', Object.assign({}, ISO_BASE, {
  panel: 'midair_hit',
  note: 'blitz-brush at display size: chisel terminals, varying stroke weight, torn edges, irregular baseline.',
}));

registerIsoShot('iso_type_hud', Object.assign({}, ISO_BASE, {
  panel: 'qb_dropback',
  note: 'blitz-block / blitz-num / blitz-techno at HUD sizes, over dark and over bright.',
}));

registerIsoShot('iso_type_specimen', Object.assign({}, ISO_BASE, {
  panel: 'team_select',
  note: 'Full four-face specimen: waterfall, one-string-four-faces, complete character sets.',
}));
