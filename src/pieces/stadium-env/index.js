// PIECE: stadium-env  (plan id "stadium-bowl")
// SLOT:  world.stadium   -> registerWorld('stadium', impl)
// OWNS:  src/pieces/stadium-env/**  and  shots/stadium-env/**
// HERO PANELS: qb_dropback, catch   (also appears in truck)
//
// WHAT THIS PIECE CLAIMS
//   A 360-degree night bowl — padded field wall, lower deck, concourse, a deep dark
//   suite fascia with vomitory mouths, an upper deck, a rim wall, a roof fascia
//   carrying two rows of light banks, and a cantilevered soffit — plus two LED ribbon
//   rings, four video walls showing a live-looking feed with the home club's own
//   illustrated mascot, goalposts, pylons, benches, five camera scaffolds, the chain
//   crew and ~150 sideline bodies.
//
// WHAT IT COSTS — MEASURED, not claimed. `iso_stadium_crowd` contains this piece and
// nothing else, and the engine reports it at 8 draw calls / 33,088 triangles /
// 9 programs for the WHOLE SCENE, of which 5 draws and 5 programs are this piece
// (bowl, emissive atlas, glow, sky, props) and the remainder is turf + the resolve
// pass. Recut budget is 12/24/48/80 draws and 20k/45k/90k/220k triangles across
// floor/low/mid/high, so at full quality this bowl already sits inside the LOW tier's
// draw allowance and the MID tier's triangle allowance.
//
// Texture: one 512 crowd tile (1024 in capture only), one 2048x1024 emissive atlas,
// one 512x256 sky, one 128 halo — about 16 MB resident live.
//
// KNOWN GAP, carried to round 2: the recut asks rungs 0-2 to collapse to ONE baked
// backdrop draw with ONE program. `applyRung` already degrades honestly — crowd
// detail fades to the section mean, flashes stop, the ribbons stop scrolling, every
// halo goes, the sideline population goes — and floor lands at 4 draws, comfortably
// inside the floor cap of 12. What it does NOT yet meet is the floor PROGRAM cap of
// 1: bowl, emissive, sky and props are four programs there. The fix is the baked
// cylindrical backdrop the recut describes, rendered once at load from this same
// geometry and these same textures so the silhouette and the warmth do not pop
// between rungs.
//
// CAPTURE
//   node scripts/shoot.mjs --piece=stadium-env
//   node scripts/shoot.mjs --scene=iso_stadium_wide  --out=shots/stadium-env/iso_stadium_wide.png
//   node scripts/compare.mjs --panel=qb_dropback --shot=shots/stadium-env/qb_dropback.png \
//                            --out=shots/stadium-env/cmp-r1.png
//
// EXPORTED FOR OTHER PIECES
//   REG.world.stadium.stadiumHeat(x, z) -> 0..1 crowd proximity/loudness at a field
//   position. Safe to ignore.

import { registerWorld, registerIsoShot } from '../../foundation/registry.js';
import stadium from './stadium.js';

export const PIECE = 'stadium-env';

registerWorld('stadium', stadium);

/* --------------------------------------------------------------- iso shots */

const NIGHT = { rain: 0.2, lightning: 0.25, haze: 0.6 };
const OFF = { visible: false };

/**
 * THE ENCLOSURE. Proves the thing is a stadium and not a backdrop: the ring closes
 * behind the camera, the decks stack, the roof cantilevers, and four actors on the
 * field carry the scale relationship the brief asks to be judged on.
 */
registerIsoShot('iso_stadium_wide', {
  piece: PIECE,
  panel: 'qb_dropback',
  camera: { pos: [-26.0, 20.0, 46.0], target: [6.0, 7.0, -14.0], fov: 44, roll: -1.0 },
  lens: { fStop: 5.6, focusDist: 62.0, bokehScale: 0.5, shutter: 1 / 160 },
  exposure: 1.0,
  weather: NIGHT,
  actors: [
    { id: 'a', team: 'CHI', variant: 'home', number: '32', archetype: 'skill', pose: 'sprint', phase: 0.4, pos: [4, 0, 2], rotY: 0.4 },
    { id: 'b', team: 'DAL', variant: 'away', number: '21', archetype: 'skill', pose: 'sprint', phase: 0.7, pos: [-2, 0, -3], rotY: 2.2 },
    { id: 'c', team: 'CHI', variant: 'home', number: '74', archetype: 'lineman', pose: 'block', phase: 0.5, pos: [9, 0, -6], rotY: -0.8 },
    { id: 'd', team: 'DAL', variant: 'away', number: '52', archetype: 'lb', pose: 'stance_defense', phase: 0.2, pos: [14, 0, 4], rotY: 3.0 },
  ],
  hud: Object.assign({ teamA: 'CHI', teamB: 'DAL', scoreA: 24, scoreB: 17 }, OFF),
  callout: { visible: false },
  note: 'The enclosure: lower deck / concourse / dark suite fascia / upper deck / light-bank ring / cantilevered roof, closing 360 degrees, with players for scale.',
});

/**
 * THE CROWD, on a long lens across the bowl. This is where "believable dense mass
 * with warm speckle and scattered flash points, not repeated blobs or flat noise"
 * is decided: radial aisles, the cross-aisle walkway, section-by-section brightness
 * variation, club-coloured fans biased to the front rows, camera flashes.
 */
registerIsoShot('iso_stadium_crowd', {
  piece: PIECE,
  panel: 'qb_dropback',
  camera: { pos: [2.0, 2.10, 20.0], target: [-14.0, 10.0, -44.0], fov: 21, roll: 0.5 },
  lens: { fStop: 2.8, focusDist: 66.0, bokehScale: 0.8, shutter: 1 / 200 },
  exposure: 1.02,
  weather: { rain: 0.2, lightning: 0.2, haze: 0.55 },
  actors: [],
  hud: Object.assign({ teamA: 'CHI', teamB: 'DAL' }, OFF),
  callout: { visible: false },
  note: 'Crowd audit at 21mm-equivalent across the bowl: aisles, cross-aisle, section variation, club colour bias, camera flashes, LED fascia ring.',
});

/**
 * THE BOARDS. End-zone video wall (live-look feed + the club's illustrated mascot),
 * both LED ribbon rings, and the roof light banks with their haloes, all in frame.
 */
registerIsoShot('iso_stadium_boards', {
  piece: PIECE,
  panel: 'truck',
  camera: { pos: [12.0, 2.60, 14.0], target: [56.0, 13.0, -4.0], fov: 34, roll: -1.5 },
  lens: { fStop: 2.4, focusDist: 48.0, bokehScale: 1.0, shutter: 1 / 160 },
  exposure: 1.0,
  weather: { rain: 0.15, lightning: 0.2, haze: 0.5 },
  actors: [],
  hud: Object.assign({ teamA: 'CHI', teamB: 'DAL', scoreA: 24, scoreB: 17 }, OFF),
  callout: { visible: false },
  note: 'Boards audit: end-zone video wall, both LED ribbon rings, roof light banks and their haloes, goalpost and pylons for scale.',
});
