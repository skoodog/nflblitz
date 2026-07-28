// FOUNDATION FALLBACK — replaced by piece `cinematography` via registerCinema().
//
// Owns two things:
//   1. `shots` — the library of the ten bar-panel scenes plus `live_play`. A cinema
//      piece may override any single entry; registerCinema() merges per-key so the
//      others survive.
//   2. `applyShot` / `buildPost` — camera placement and the post chain.
//
// Deliberately plain: the camera is placed exactly where the ShotSpec says, with no
// lens breathing, no shake, no roll easing, no depth of field, no bloom, no grade,
// no vignette. buildPost() returns null, meaning "render straight to the target".

import * as THREE from 'three';
import { FIELD } from '../contracts.js';

const A = (o) => o;   // actor literal helper, kept for readability

/* ------------------------------------------------------------ shot library */

const shots = {
  /* ---- MENUS ---- */
  title: {
    id: 'title',
    camera: { pos: [0, 3, 26], target: [0, 3, 0], fov: 40, roll: 0 },
    exposure: 0.9,
    weather: { rain: 0.35, lightning: 0.8, haze: 0.7 },
    actors: [],
    hud: { visible: false },
    ui: { screen: 'title', state: { city: 'NYC' } },
    note: 'bar/panel-title.png — chrome BLITZ, red RELOADED, city skyline, lightning.',
  },
  team_select: {
    id: 'team_select',
    camera: { pos: [0, 3, 26], target: [0, 3, 0], fov: 40 },
    exposure: 0.85,
    actors: [],
    hud: { visible: false },
    ui: { screen: 'teamSelect', state: { teams: ['NYC', 'CHI', 'DAL', 'LA'], selected: 0 } },
    note: 'bar/panel-team_select.png — CHOOSE YOUR CITY, 4 cards, crests, gold stat bars.',
  },
  uniform: {
    id: 'uniform',
    camera: { pos: [0.0, 1.15, 4.6], target: [0.0, 1.05, 0], fov: 30 },
    exposure: 1.0,
    actors: [
      A({ id: 'model', team: 'CHI', variant: 'home', number: '24', name: 'MAULER', archetype: 'skill', pose: 'idle', pos: [0, 0, 0], rotY: Math.PI, hero: true, dirt: 0, wet: 0.1 }),
    ],
    hud: { visible: false },
    ui: { screen: 'uniform', state: { team: 'CHI', variantIndex: 0 } },
    note: 'bar/panel-uniform.png — turntable character, crest at left, 5 variant buttons at right.',
  },
  playcall_def: {
    id: 'playcall_def',
    camera: { pos: [-2.4, 1.5, 4.2], target: [-2.0, 1.35, 0], fov: 32 },
    exposure: 0.95,
    actors: [
      A({ id: 'lb', team: 'SEA', variant: 'home', number: '56', name: 'CROW', archetype: 'lb', pose: 'stance_defense', pos: [-2.1, 0, 0.6], rotY: Math.PI * 0.9, hero: true }),
    ],
    hud: { visible: false },
    ui: {
      screen: 'playcall',
      state: {
        clock: ':09', formation: 'NICKEL',
        plays: ['SAFE COVER', 'STUFF IT', '2 MAN BLITZ', 'ZONE HOOK', 'SLAM WALL', 'LB ATTACK', 'IN YOUR FACE', 'DEATH WISH'],
        selected: 0,
      },
    },
    note: 'bar/panel-defense_playcall.png — LB portrait left, 8 route-diagram tiles, :09 clock.',
  },

  /* ---- IN-GAME HERO PANELS ---- */
  qb_dropback: {
    id: 'qb_dropback',
    camera: { pos: [1.6, 1.75, 7.4], target: [0.4, 1.5, -1.0], fov: 34, roll: -0.5 },
    lens: { fStop: 2.0, focusDist: 7.0, bokehScale: 1.1, shutter: 1 / 80 },
    exposure: 1.0,
    weather: { rain: 0.2, lightning: 0.25, haze: 0.6 },
    actors: [
      A({ id: 'qb', team: 'NYC', variant: 'home', number: '7', name: 'STRYKER', archetype: 'qb', pose: 'dropback', phase: 0.55, pos: [0.2, 0, 0], rotY: 0.2, hero: true, dirt: 0.2 }),
      A({ id: 'wr1', team: 'NYC', variant: 'home', number: '81', name: 'HOLT', archetype: 'skill', pose: 'sprint', phase: 0.3, pos: [-7.5, 0, -6.5], rotY: -2.4 }),
      A({ id: 'db1', team: 'CHI', variant: 'away', number: '23', name: 'RUSK', archetype: 'skill', pose: 'sprint', phase: 0.7, pos: [-9.0, 0, -9.0], rotY: -2.2 }),
      A({ id: 'ol1', team: 'NYC', variant: 'home', number: '74', name: 'BROOK', archetype: 'lineman', pose: 'block', phase: 0.4, pos: [3.4, 0, -3.0], rotY: -0.6 }),
      A({ id: 'dl1', team: 'CHI', variant: 'away', number: '95', name: 'GRAVES', archetype: 'lineman', pose: 'block', phase: 0.6, pos: [5.2, 0, -4.6], rotY: 2.5 }),
      A({ id: 'lb1', team: 'CHI', variant: 'away', number: '52', name: 'KANE', archetype: 'lb', pose: 'stance_defense', phase: 0.2, pos: [-2.0, 0, -12.0], rotY: 3.0 }),
    ],
    ball: { pos: [-0.35, 1.42, 0.42], flame: 0.95, visible: true, spin: 3 },
    hud: { visible: true, clock: ':09', quarter: 3, down: 1, dist: '1ST', yards: '10', teamA: 'NYC', teamB: 'CHI', scoreA: 22, scoreB: 14, turbo: 0.72, momentumA: 0.62, momentumB: 0.4 },
    callout: { visible: false },
    turfDamage: [
      { type: 'cleat', x: 0.6, z: 1.4, rot: 0.3, strength: 0.7 },
      { type: 'divot', x: 3.2, z: -2.4, rot: 1.1, strength: 0.9 },
    ],
    note: 'bar/panel-qb_dropback.png — QB back-three-quarter, flaming ball, night bowl, HUD top-left.',
  },

  truck: {
    id: 'truck',
    camera: { pos: [2.4, 1.35, 8.2], target: [0.6, 1.25, 0.6], fov: 36, roll: 1.5 },
    lens: { fStop: 1.8, focusDist: 7.4, bokehScale: 1.3, shutter: 1 / 60 },
    exposure: 1.05,
    weather: { rain: 0.15, lightning: 0.15, haze: 0.55 },
    actors: [
      A({ id: 'rb', team: 'CHI', variant: 'home', number: '32', name: 'RAZE', archetype: 'skill', pose: 'truck', phase: 0.62, pos: [0.9, 0, 1.2], rotY: 0.15, hero: true, role: 'carrier', dirt: 0.6 }),
      A({ id: 'tackler', team: 'LA', variant: 'away', number: '21', name: 'VANCE', archetype: 'skill', pose: 'blown_back', phase: 0.5, pos: [-1.5, 0.55, 0.2], rotY: 2.7, airborne: true, role: 'tackler', dirt: 0.7 }),
      A({ id: 'd2', team: 'LA', variant: 'away', number: '44', name: 'ORR', archetype: 'lb', pose: 'downed', phase: 0.3, pos: [-3.6, 0, -1.4], rotY: 1.2, dirt: 0.9 }),
      A({ id: 'd3', team: 'LA', variant: 'away', number: '58', name: 'PIKE', archetype: 'lb', pose: 'tackle_launch', phase: 0.4, pos: [-5.4, 0, -3.2], rotY: 1.6 }),
      A({ id: 'o2', team: 'CHI', variant: 'home', number: '77', name: 'DRAKE', archetype: 'lineman', pose: 'block', phase: 0.5, pos: [4.4, 0, -2.6], rotY: -1.9 }),
      A({ id: 'd4', team: 'LA', variant: 'away', number: '91', name: 'SOLL', archetype: 'lineman', pose: 'sprint', phase: 0.8, pos: [6.2, 0, -5.0], rotY: 2.2 }),
    ],
    ball: { pos: [1.85, 1.05, 1.45], flame: 0, visible: true },
    fx: [{ kind: 'truck', pos: [-0.4, 1.15, 0.7], dir: [-1, 0.35, 0.1], power: 1.6, age: 0.06 }],
    hud: { visible: true, clock: ':15', quarter: 2, down: 2, dist: '2ND', yards: '250', teamA: 'DAL', teamB: 'LA', scoreA: 28, scoreB: 21, turbo: 0.55, momentumA: 0.72, momentumB: 0.31 },
    callout: { visible: true, line1: '', line2: 'TRUCK!', pts: 150, accent: 'gold', age: 0.25 },
    turfDamage: [
      { type: 'skid', x: -2.2, z: 1.9, x1: 1.0, z1: 1.3, w: 0.5, strength: 1.0 },
      { type: 'divot', x: 0.4, z: 1.6, rot: 0.4, strength: 1.0 },
      { type: 'cleat', x: 1.4, z: 1.9, rot: 0.2, strength: 0.8 },
    ],
    note: 'bar/panel-truck.png — RB trucking a DB, debris, TRUCK! 150 PTS bottom right.',
  },

  midair_hit: {
    id: 'midair_hit',
    camera: { pos: [0.2, 2.35, 9.0], target: [-0.4, 1.95, 0.2], fov: 38, roll: -2.5 },
    lens: { fStop: 2.0, focusDist: 8.6, bokehScale: 1.25, shutter: 1 / 50 },
    exposure: 1.1,
    weather: { rain: 0.3, lightning: 0.9, haze: 0.65 },
    actors: [
      A({ id: 'hitter', team: 'MIA', variant: 'home', number: '58', name: 'VOLT', archetype: 'lb', pose: 'airborne_hit', phase: 0.55, pos: [1.4, 1.35, 0.4], rotY: 1.75, airborne: true, hero: true, dirt: 0.4 }),
      A({ id: 'victim', team: 'SEA', variant: 'away', number: '23', name: 'MERCE', archetype: 'skill', pose: 'blown_back', phase: 0.6, pos: [-1.9, 1.05, -0.2], rotY: 1.9, airborne: true, dirt: 0.5 }),
      A({ id: 'x1', team: 'SEA', variant: 'away', number: '11', name: 'ASH', archetype: 'skill', pose: 'sprint', phase: 0.3, pos: [-7.0, 0, -6.0], rotY: -2.0 }),
      A({ id: 'x2', team: 'MIA', variant: 'home', number: '90', name: 'BOLT', archetype: 'lineman', pose: 'sprint', phase: 0.6, pos: [6.4, 0, -5.4], rotY: 2.4 }),
    ],
    ball: { pos: [-3.2, 1.55, 0.6], flame: 0, visible: true, spin: 6 },
    fx: [{ kind: 'hit', pos: [-0.3, 1.45, 0.1], dir: [-1, 0.2, 0], power: 2.0, age: 0.04 }],
    hud: { visible: true, clock: ':15', quarter: 2, down: 2, dist: '2ND', yards: '250', teamA: 'SEA', teamB: 'MIA', scoreA: 14, scoreB: 6, turbo: 0.5, momentumA: 0.3, momentumB: 0.8 },
    callout: { visible: true, line1: 'MID-AIR', line2: 'MURDER!', pts: 250, accent: 'red', age: 0.2 },
    turfDamage: [{ type: 'divot', x: 1.9, z: 0.9, rot: 0.9, strength: 1.0 }],
    note: 'bar/panel-midair_hit.png — two bodies fully airborne, lightning, MID-AIR MURDER! 250 PTS.',
  },

  leveler: {
    id: 'leveler',
    camera: { pos: [-1.2, 1.55, 8.0], target: [0.2, 1.4, 0.0], fov: 37, roll: 2.0 },
    lens: { fStop: 1.9, focusDist: 7.6, bokehScale: 1.2, shutter: 1 / 55 },
    exposure: 1.05,
    weather: { rain: 0.2, lightning: 0.5, haze: 0.6 },
    actors: [
      A({ id: 'hitter', team: 'DAL', variant: 'home', number: '99', name: 'CULL', archetype: 'lb', pose: 'tackle_impact', phase: 0.6, pos: [1.2, 0, 0.4], rotY: 2.5, hero: true, dirt: 0.5 }),
      A({ id: 'victim', team: 'PHI', variant: 'away', number: '18', name: 'RANE', archetype: 'skill', pose: 'blown_back', phase: 0.7, pos: [-1.7, 1.15, 0.1], rotY: 2.2, airborne: true, dirt: 0.6 }),
      A({ id: 'x1', team: 'DAL', variant: 'home', number: '88', name: 'HOYT', archetype: 'skill', pose: 'sprint', phase: 0.4, pos: [4.4, 0, -3.6], rotY: -2.6 }),
    ],
    fx: [{ kind: 'hit', pos: [-0.1, 1.3, 0.2], dir: [-1, 0.4, 0], power: 2.2, age: 0.03 }],
    hud: { visible: true, clock: ':05', quarter: 4, down: 3, dist: '3RD', yards: '260', teamA: 'NYC', teamB: 'CHI', scoreA: 35, scoreB: 14, turbo: 0.4, momentumA: 0.85, momentumB: 0.2 },
    callout: { visible: true, line1: '', line2: 'LEVELER!', pts: 200, accent: 'gold', age: 0.18 },
    turfDamage: [{ type: 'divot', x: 1.4, z: 0.6, rot: 0.2, strength: 1.0 }, { type: 'skid', x: -2.8, z: 0.4, x1: -1.2, z1: 0.2, w: 0.6, strength: 0.9 }],
    note: 'bar/panel-leveler.png — defender folding a receiver, sparks, LEVELER! 200 PTS.',
  },

  touchdown: {
    id: 'touchdown',
    camera: { pos: [-3.0, 1.25, 7.6], target: [-1.2, 1.05, 0.4], fov: 40, roll: -3.0 },
    lens: { fStop: 2.2, focusDist: 7.2, bokehScale: 1.1, shutter: 1 / 70 },
    exposure: 1.0,
    weather: { rain: 0.1, lightning: 0.2, haze: 0.5 },
    actors: [
      A({ id: 'wr', team: 'LA', variant: 'home', number: '18', name: 'KESS', archetype: 'skill', pose: 'dive_catch', phase: 0.65, pos: [-1.3, 0.85, 0.6], rotY: -0.35, airborne: true, hero: true, dirt: 0.3 }),
      A({ id: 'db', team: 'BAL', variant: 'away', number: '27', name: 'FEN', archetype: 'skill', pose: 'sprint', phase: 0.5, pos: [-4.4, 0, -2.4], rotY: -0.4 }),
      A({ id: 'x1', team: 'BAL', variant: 'away', number: '55', name: 'ODEN', archetype: 'lb', pose: 'sprint', phase: 0.8, pos: [3.8, 0, -5.2], rotY: -1.2 }),
    ],
    ball: { pos: [-0.55, 1.55, 0.95], flame: 0, visible: true, spin: 4 },
    hud: { visible: true, clock: ':15', quarter: 4, down: 1, dist: '1ST', yards: '410', teamA: 'LA', teamB: 'BAL', scoreA: 17, scoreB: 13, turbo: 0.66, momentumA: 0.7, momentumB: 0.35 },
    callout: { visible: true, line1: '', line2: 'TOUCHDOWN!', pts: 200, accent: 'gold', age: 0.3 },
    turfDamage: [{ type: 'skid', x: -2.4, z: 1.0, x1: -1.1, z1: 0.7, w: 0.7, strength: 0.8 }],
    note: 'bar/panel-touchdown.png — diving endzone catch, goalpost + endzone paint, TOUCHDOWN! 200 PTS.',
  },

  catch: {
    id: 'catch',
    camera: { pos: [1.0, 2.0, 6.2], target: [0.1, 2.05, 0.0], fov: 34, roll: 1.0 },
    lens: { fStop: 1.8, focusDist: 6.1, bokehScale: 1.35, shutter: 1 / 90 },
    exposure: 1.05,
    weather: { rain: 0.2, lightning: 0.3, haze: 0.55 },
    actors: [
      A({ id: 'wr', team: 'LA', variant: 'home', number: '87', name: 'BRAND', archetype: 'skill', pose: 'jump_catch', phase: 0.7, pos: [0.4, 0.95, 0.2], rotY: 0.1, airborne: true, hero: true }),
      A({ id: 'db', team: 'MIA', variant: 'away', number: '29', name: 'MERGE', archetype: 'skill', pose: 'contested_catch', phase: 0.6, pos: [-0.85, 0.75, -0.35], rotY: 0.45, airborne: true, dirt: 0.4 }),
    ],
    ball: { pos: [0.55, 2.72, 0.25], flame: 0, visible: true, spin: 5 },
    hud: { visible: true, clock: ':36', quarter: 3, down: 2, dist: '2ND', yards: '210', teamA: 'SEA', teamB: 'MIA', scoreA: 21, scoreB: 21, turbo: 0.58, momentumA: 0.5, momentumB: 0.5 },
    callout: { visible: true, line1: 'WHAT A', line2: 'CATCH!', pts: 175, accent: 'gold', age: 0.22 },
    note: 'bar/panel-catch.png — contested jump ball at full extension, WHAT A CATCH! 175 PTS.',
  },

  /* ---- SIM-DRIVEN ---- */
  live_play: {
    id: 'live_play',
    live: true,
    camera: { pos: [3.0, 3.2, 13.0], target: [0, 1.4, -1.0], fov: 40 },
    lens: { fStop: 2.8, focusDist: 12.0, bokehScale: 0.8, shutter: 1 / 90 },
    exposure: 1.0,
    actors: [],
    hud: { visible: true },
    note: 'sim.seekTo(state, t) + sim.snapshot(state) drive this one. `--t=` scrubs the play.',
  },
};

/* --------------------------------------------------------------- behaviour */

const impl = {
  piece: 'foundation-fallback',
  shots,

  /** Place the camera exactly as the ShotSpec says. No shake, no breathing, no easing. */
  applyShot(camera, shot, t, ctx) {
    const c = shot.camera;
    camera.fov = c.fov;
    camera.position.set(c.pos[0], c.pos[1], c.pos[2]);
    camera.up.set(0, 1, 0);
    camera.lookAt(c.target[0], c.target[1], c.target[2]);
    if (c.roll) camera.rotateZ((c.roll * Math.PI) / 180);
    camera.near = 0.08;
    camera.far = 600;
    camera.updateProjectionMatrix();
    if (ctx && ctx.renderer) {
      ctx.renderer.toneMappingExposure = shot.exposure || 1.0;
    }
    void t;
  },

  /**
   * buildPost(ctx, shot) -> Post | null
   * Post = { render(scene, camera, target, t, dt), setSize(w,h), dispose() }
   * The fallback returns null: the engine renders the scene straight into the
   * accumulation target with no bloom, no DOF, no grade, no vignette.
   */
  buildPost() { return null; },

  /**
   * Sub-frame camera offset for accumulation. Foundation always applies sub-pixel
   * jitter itself; this hook is where a cinema piece adds real bokeh DOF by
   * offsetting the camera across the aperture disc (accumulation-buffer DOF).
   * Return null for "no aperture offset".
   */
  apertureOffset() { return null; },

  update() { },

  /** Convenience for pieces: a sane look-at for a single actor at field pos. */
  frameActor(camera, pos, dist = 6, height = 1.6) {
    camera.position.set(pos[0], height, pos[2] + dist);
    camera.lookAt(pos[0], height * 0.85, pos[2]);
    camera.updateProjectionMatrix();
  },

  FIELD,
  THREE,
};

export default impl;
