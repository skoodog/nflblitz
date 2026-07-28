// PIECE: turf-field
// SLOT:  world.turf
// JUDGED ON: wet torn turf that scatters and holds cleat marks
// HERO PANELS: truck, touchdown
//
// CAPTURE
//   node scripts/shoot.mjs --piece=turf-field
//   node scripts/compare.mjs --panel=truck --shot=shots/turf-field/iso_turf.png \
//                            --out=shots/turf-field/cmp-r1.png
//
// BUDGET (recut): draw calls 3/4/6/10, tris 4k/12k/40k/90k, texture 8/12/20/28 MB,
// programs 1/2/3/3 at floor/low/mid/high; overdraw contribution <= 1.0 layers.
// Delivered: 1 draw + 1 program below rung 12, 2 + 2 at 12-15 (the instanced shell
// grass); 1008 tris for the field plane, ~11.7k more for the shell disc at high;
// ~2 MB resident at floor, ~19 MB at high. Damage is a dirty-rectangle sub-upload —
// exactly one full texture upload ever happens, and it happens at load.

import { registerWorld, registerIsoShot } from '../../foundation/registry.js';
import turf from './turf.js';

export const PIECE = 'turf-field';

registerWorld('turf', turf);

/* ------------------------------------------------------------------ iso set */

const NIGHT = { rain: 0.3, lightning: 0.2, haze: 0.55 };
const OFF = { visible: false };
const NO_CALLOUT = { visible: false };

/**
 * The hero turf frame: a low raking camera on the near sideline looking into the
 * DAL end zone. Everything this piece owns is in one frame — near-camera blade
 * detail, mow banding, the whole paint system receding in perspective, the wet bank
 * sheen, a torn area with cleat prints, and painted end-zone colour.
 */
registerIsoShot('iso_turf', {
  piece: PIECE,
  panel: 'truck',
  camera: { pos: [27.0, 2.5, 18.0], target: [34.5, 0.0, 10.0], fov: 35, roll: 1.5 },
  lens: { fStop: 3.2, focusDist: 22.0, bokehScale: 0.9, shutter: 1 / 200 },
  exposure: 1.0,
  weather: NIGHT,
  actors: [],
  hud: Object.assign({ teamA: 'DAL', teamB: 'LA' }, OFF),
  callout: NO_CALLOUT,
  turfDamage: [
    { type: 'skid', x: 29.6, z: 12.2, x1: 33.4, z1: 10.4, w: 0.62, strength: 1.0 },
    { type: 'divot', x: 34.2, z: 9.6, rot: 0.35, strength: 1.1 },
    { type: 'divot', x: 31.2, z: 7.4, rot: 2.4, strength: 0.9 },
    { type: 'cleat', x: 32.4, z: 11.0, rot: 0.35, strength: 0.9 },
    { type: 'cleat', x: 33.4, z: 10.6, rot: 0.4, strength: 0.85 },
    { type: 'cleat', x: 34.5, z: 10.1, rot: 0.28, strength: 0.9 },
    { type: 'cleat', x: 35.6, z: 9.8, rot: 0.22, strength: 0.95 },
    { type: 'divot', x: 37.4, z: 8.9, rot: 1.1, strength: 1.0 },
    { type: 'skid', x: 38.0, z: 5.4, x1: 41.6, z1: 4.2, w: 0.7, strength: 0.9 },
    { type: 'divot', x: 30.0, z: 3.2, rot: 0.6, strength: 0.85 },
  ],
  note: 'Turf hero: raking sideline camera into the end zone. Mow banding, analytic paint, wet bank sheen, torn ground.',
});

/** The paint system on its own, from a broadcast three-quarter. */
registerIsoShot('iso_turf_paint', {
  piece: PIECE,
  panel: 'qb_dropback',
  camera: { pos: [-6.0, 15.5, 30.0], target: [7.0, 0.0, 1.0], fov: 36, roll: 0 },
  lens: { fStop: 5.6, focusDist: 34.0, bokehScale: 0.5, shutter: 1 / 250 },
  exposure: 1.0,
  weather: { rain: 0.2, lightning: 0.1, haze: 0.5 },
  actors: [],
  hud: Object.assign({ teamA: 'DAL', teamB: 'LA' }, OFF),
  callout: NO_CALLOUT,
  turfDamage: [
    { type: 'skid', x: 2.0, z: 2.0, x1: 6.4, z1: 1.2, w: 0.7, strength: 0.9 },
    { type: 'divot', x: 8.0, z: 0.2, rot: 0.4, strength: 1.0 },
  ],
  note: 'Paint audit: 5-yard lines, 8-inch goal line, hashes at 70ft9in, 1-yard sideline ticks, 6ft numerals with directional arrows, midfield mark.',
});

/** The end zone: painted club colour, border stripe, wordmark, goal line. */
registerIsoShot('iso_endzone', {
  piece: PIECE,
  panel: 'touchdown',
  camera: { pos: [39.5, 2.05, 14.5], target: [47.5, 0.0, 6.0], fov: 35, roll: -2.0 },
  lens: { fStop: 3.5, focusDist: 20.0, bokehScale: 1.0, shutter: 1 / 200 },
  exposure: 1.0,
  weather: NIGHT,
  actors: [],
  hud: Object.assign({ teamA: 'LA', teamB: 'BAL' }, OFF),
  callout: NO_CALLOUT,
  turfDamage: [
    { type: 'skid', x: 43.6, z: 8.6, x1: 48.4, z1: 7.0, w: 0.8, strength: 1.0 },
    { type: 'divot', x: 46.4, z: 6.2, rot: 0.2, strength: 1.1 },
    { type: 'cleat', x: 42.4, z: 9.4, rot: 0.2, strength: 0.9 },
    { type: 'cleat', x: 41.2, z: 9.9, rot: 0.26, strength: 0.85 },
    { type: 'cleat', x: 44.6, z: 8.0, rot: 0.18, strength: 0.9 },
  ],
  note: 'End zone in the real club colour set from src/data/teams.json, with the border stripe, the painted wordmark and the 8-inch goal line.',
});

/** Damage, close and low, where the critic can actually see torn soil. */
registerIsoShot('iso_turf_damage', {
  piece: PIECE,
  panel: 'truck',
  camera: { pos: [18.6, 1.45, 6.4], target: [15.6, 0.0, 1.9], fov: 38, roll: 2.5 },
  lens: { fStop: 2.4, focusDist: 5.2, bokehScale: 1.1, shutter: 1 / 200 },
  exposure: 1.05,
  weather: { rain: 0.45, lightning: 0.2, haze: 0.5 },
  actors: [],
  hud: Object.assign({ teamA: 'DAL', teamB: 'LA' }, OFF),
  callout: NO_CALLOUT,
  turfDamage: [
    { type: 'skid', x: 12.4, z: 3.4, x1: 15.9, z1: 2.4, w: 0.60, strength: 1.0 },
    { type: 'divot', x: 16.6, z: 1.9, rot: 0.35, strength: 1.15 },
    { type: 'divot', x: 14.2, z: 0.7, rot: 2.6, strength: 0.95 },
    { type: 'divot', x: 17.8, z: 0.2, rot: 1.2, strength: 0.9 },
    { type: 'divot', x: 12.8, z: 1.0, rot: 3.4, strength: 0.8 },
    { type: 'cleat', x: 15.3, z: 3.6, rot: 0.30, strength: 1.0 },
    { type: 'cleat', x: 14.5, z: 3.9, rot: 0.36, strength: 0.95 },
    { type: 'cleat', x: 13.7, z: 4.2, rot: 0.24, strength: 0.9 },
    { type: 'cleat', x: 16.9, z: 3.2, rot: 0.28, strength: 0.9 },
    { type: 'cleat', x: 17.7, z: 2.9, rot: 0.22, strength: 0.85 },
  ],
  note: 'Divots with exposed wet substrate and severed blade litter, a dragged skid, and a legible line of cleat prints with stud impressions.',
});

/* ------------------------------------------------------------- the ladder */
// Same frame at four rungs. Rung 0 is the contract: a floor-tier phone must still
// get a real wet NFL field with correct paint and grade — one draw, one program, no
// damage buffer, no normal map, two reflected banks.

const RUNG_CAM = { pos: [29.0, 2.3, 17.0], target: [37.0, 0.0, 8.0], fov: 34, roll: 1.2 };
const RUNG_DAMAGE = [
  { type: 'skid', x: 31.0, z: 12.0, x1: 34.8, z1: 10.4, w: 0.62, strength: 1.0 },
  { type: 'divot', x: 35.6, z: 9.6, rot: 0.35, strength: 1.1 },
  { type: 'cleat', x: 33.2, z: 11.0, rot: 0.3, strength: 0.9 },
  { type: 'cleat', x: 34.2, z: 10.6, rot: 0.32, strength: 0.85 },
  { type: 'cleat', x: 35.2, z: 10.1, rot: 0.25, strength: 0.9 },
];

for (const r of [0, 4, 9, 15]) {
  registerIsoShot(`iso_turf_rung${r}`, {
    piece: PIECE,
    panel: 'truck',
    rung: r,
    camera: RUNG_CAM,
    lens: { fStop: 3.2, focusDist: 24.0, bokehScale: 0.9, shutter: 1 / 200 },
    exposure: 1.0,
    weather: NIGHT,
    actors: [],
    hud: Object.assign({ teamA: 'DAL', teamB: 'LA' }, OFF),
    callout: NO_CALLOUT,
    turfDamage: RUNG_DAMAGE,
    note: `Quality rung ${r} (turf class ${r <= 2 ? 0 : r <= 6 ? 1 : r <= 11 ? 2 : 3}). Same frame at every rung — the grade, the paint and the composition never scale.`,
  });
}

export default turf;
