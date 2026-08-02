// PIECE: impact-fx
// OWNER: this directory ONLY. Never edit anything outside src/pieces/impact-fx/.
// SLOT:  world.fx
// JUDGED ON: impact sparks, turf spray, debris, smoke, the flaming ball
// HERO PANELS: leveler, midair_hit
//
// WHAT IS HERE
//   config.js   every tunable, with the measurement that produced it
//   atlas.js    one 512x512 procedural sprite atlas, 16 cells
//   quads.js    the pooled quad batch — one program, closed-form vertex integration
//   bursts.js   the four FX families, as pure functions of (pos, dir, power, t0, seed)
//   ball.js     the football and its fire
//   fx.js       the slot implementation, including the live-event recovery
//
// COST, by construction (the numbers scripts/budget.mjs attributes to `impact-fx`):
//   draw calls  4   fx.debris, fx.glow, ball.shell, ball.fire — 3 when the ball is hidden
//   programs    2   the quad program (glow and debris share it) + the fire program
//   triangles   1,040 for a live `hit` (490 quads' worth), 4,048 if every pool were full
//               at once, plus 1,056 for the ball shell
//   textures    2   atlas 512x512 RGBA + the ball's 512x256 albedo/normal pair
//   per frame   3 uniform writes and one Euler assignment. No allocation, and no work
//               proportional to the number of live particles — see quads.js.
//
// CAPTURE
//   node scripts/shoot.mjs --piece=impact-fx --accum=8 --timeout=800000
//   node scripts/shoot.mjs --scene=iso_impact --accum=8 --timeout=800000 \
//        --out=shots/impact-fx/iso_impact.png
//
// DETERMINISM: no wall clock and no unseeded randomness anywhere in this directory.
// Every effect is a closed-form function of (event, t - t0, seed); see the header of
// quads.js for why that is a design property and not a lint workaround.
//   node scripts/lint-determinism.mjs --path=src/pieces/impact-fx

import { registerWorld, registerIsoShot } from '../../foundation/registry.js';
import fx from './fx.js';

export const PIECE = 'impact-fx';

registerWorld('fx', fx);

/* ------------------------------------------------------------------ iso set */
//
// NO ACTORS IN ANY OF THESE, on purpose. `pose-animation` was still a placeholder while
// this piece was built, so any actor I posed into my own hero frame would have been
// scored partly on somebody else's fallback. The hero panels (`leveler`, `midair_hit`)
// already put this piece's work next to bodies; these four shots are here so a blind
// critic can see the FX itself with nothing in front of it.

const NIGHT = { rain: 0.22, lightning: 0.45, haze: 0.6 };
const OFF = { visible: false };
const NO_CALLOUT = { visible: false };

/**
 * THE HERO. One power-2.2 `hit` at chest height, 90 ms old — the moment
 * bar/panel-leveler.png depicts. Everything the piece owns except the ball is in frame:
 * the starburst and its anamorphic bars, the ground light pool, the ground shockwave,
 * the spark shower with its velocity-stretched streaks, the turf erupting underneath,
 * severed grass, and the warm dust hanging in the flash.
 */
registerIsoShot('iso_impact', {
  piece: PIECE,
  panel: 'leveler',
  camera: { pos: [3.4, 1.78, 5.9], target: [0.0, 1.00, 0.0], fov: 38, roll: 2.2 },
  lens: { fStop: 2.2, focusDist: 6.9, bokehScale: 1.1, shutter: 1 / 55 },
  exposure: 1.05,
  weather: NIGHT,
  actors: [],
  ball: { visible: false },
  fx: [{ kind: 'hit', pos: [0, 1.25, 0], dir: [-1, 0.34, 0.12], power: 2.2, age: 0.09 }],
  turfDamage: [
    { type: 'divot', x: 0.2, z: 0.1, rot: 0.3, strength: 1.15 },
    { type: 'divot', x: -0.9, z: 0.6, rot: 2.1, strength: 0.95 },
    { type: 'skid', x: 1.6, z: 0.5, x1: -0.2, z1: 0.2, w: 0.62, strength: 1.0 },
    { type: 'cleat', x: 1.2, z: 0.9, rot: 0.3, strength: 0.9 },
    { type: 'cleat', x: 0.4, z: 1.1, rot: 0.25, strength: 0.85 },
  ],
  hud: OFF,
  callout: NO_CALLOUT,
  note: 'THE HERO IMPACT, 90 ms after contact, power 2.2. Starburst + anamorphic bars, '
    + 'ground light pool, ground shockwave, ~97 velocity-stretched sparks, turf erupting '
    + 'from under the collision, severed grass, warm dust. No actors: this is the FX alone.',
});

/**
 * THE TIMELINE, in one frame. The same power-1.9 hit at 40 ms, 170 ms and 460 ms, three
 * metres apart. A single still cannot show that an effect is animated, so this shot
 * shows three points on its curve at once: the flash is still white at 40 ms, the sparks
 * have travelled and started to fall by 170 ms, and by 460 ms there is nothing left but
 * settling dirt and dust. Every one of the three is the same function evaluated at a
 * different age — that is the whole determinism claim, made visible.
 */
registerIsoShot('iso_impact_timeline', {
  piece: PIECE,
  panel: 'leveler',
  camera: { pos: [0.6, 2.35, 8.6], target: [0.0, 1.05, 0.0], fov: 42, roll: 0 },
  lens: { fStop: 4.0, focusDist: 8.8, bokehScale: 0.7, shutter: 1 / 90 },
  exposure: 1.0,
  weather: { rain: 0.15, lightning: 0.15, haze: 0.5 },
  actors: [],
  ball: { visible: false },
  fx: [
    { kind: 'hit', pos: [-3.3, 1.2, 0], dir: [-1, 0.3, 0], power: 1.9, age: 0.04 },
    { kind: 'hit', pos: [0.0, 1.2, 0], dir: [-1, 0.3, 0], power: 1.9, age: 0.17 },
    { kind: 'hit', pos: [3.3, 1.2, 0], dir: [-1, 0.3, 0], power: 1.9, age: 0.46 },
  ],
  turfDamage: [
    { type: 'divot', x: -3.2, z: 0.1, rot: 0.3, strength: 1.0 },
    { type: 'divot', x: 0.1, z: 0.1, rot: 1.3, strength: 1.0 },
    { type: 'divot', x: 3.4, z: 0.1, rot: 2.3, strength: 1.0 },
  ],
  hud: OFF,
  callout: NO_CALLOUT,
  note: 'One impact at three ages — 40 ms, 170 ms, 460 ms, left to right. Same seed, same '
    + 'power, same closed-form evaluation at a different t. Proves the effect has a life, '
    + 'not just a look.',
});

/**
 * THE FLAMING BALL, close. bar/panel-qb_dropback.png. Pointed leather with pebble grain,
 * laces and both stripes, lit by its own fire; the fire itself a streaming ribbon that
 * goes white-hot at the leather, saturates through orange, and dissolves into smoke.
 */
registerIsoShot('iso_impact_ball', {
  piece: PIECE,
  panel: 'qb_dropback',
  // Framed for the FLAME, not the ball: the ribbon is 1.2 m long and the ball is 0.34 m,
  // so a camera close enough to fill the frame with leather cuts the fire in half. At
  // 2.34 m on a 40 degree lens the ball is a fifth of the frame width and the whole
  // ribbon fits — the same proportion the ball has in bar/panel-qb_dropback.png.
  camera: { pos: [1.55, 1.62, 1.75], target: [-0.45, 1.68, 0.10], fov: 40, roll: -1.0 },
  lens: { fStop: 2.0, focusDist: 2.34, bokehScale: 1.2, shutter: 1 / 120 },
  exposure: 1.0,
  weather: { rain: 0.2, lightning: 0.3, haze: 0.62 },
  actors: [],
  ball: { pos: [0, 1.45, 0], rotQ: [0, 0, 0, 1], flame: 0.95, visible: true, spin: 2.5 },
  fx: [],
  hud: OFF,
  callout: NO_CALLOUT,
  note: 'The flaming ball at 0.5 m. Lathed prolate shell with pointed tips (not a scaled '
    + 'sphere), procedural pebble grain + normal map, laces and both stripes, self-lit by '
    + 'the fire. The fire is a flowing ribbon: 78 tongues, 21 licks on the leather, '
    + '30 embers, 3 heat blooms — 132 quads, one draw, animated entirely in the vertex stage.',
});

/**
 * TURF. A `truck` (a runner going through a tackler, debris thrown FORWARD in a wake)
 * and a `cleat` plant two metres behind it, from a low raking camera so the debris is
 * against the sky rather than against the grass. bar/panel-truck.png.
 */
registerIsoShot('iso_impact_turf', {
  piece: PIECE,
  panel: 'truck',
  camera: { pos: [4.6, 0.92, 3.6], target: [-0.6, 0.95, -0.3], fov: 38, roll: 1.6 },
  lens: { fStop: 2.4, focusDist: 5.4, bokehScale: 1.0, shutter: 1 / 70 },
  exposure: 1.05,
  weather: { rain: 0.18, lightning: 0.25, haze: 0.55 },
  actors: [],
  ball: { visible: false },
  fx: [
    { kind: 'truck', pos: [0, 1.05, 0], dir: [-1, 0.22, -0.15], power: 1.8, age: 0.12 },
    { kind: 'cleat', pos: [2.3, 0.06, 0.5], dir: [-1, 0.5, 0], power: 1.2, age: 0.20 },
  ],
  turfDamage: [
    { type: 'skid', x: 2.6, z: 0.6, x1: 0.2, z1: 0.1, w: 0.6, strength: 1.0 },
    { type: 'divot', x: 0.3, z: 0.0, rot: 0.5, strength: 1.1 },
    { type: 'divot', x: 2.4, z: 0.6, rot: 1.9, strength: 0.9 },
  ],
  hud: OFF,
  callout: NO_CALLOUT,
  note: 'truck + cleat against the sky from a low raking camera. The truck throws its '
    + 'debris forward in a wake instead of radiating; the cleat has no fire at all, only '
    + 'turf leaving the ground.',
});

export default fx;
