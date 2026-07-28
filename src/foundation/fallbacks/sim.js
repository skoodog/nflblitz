// FOUNDATION FALLBACK — replaced by piece `play-sim` via registerSim().
// Deliberately plain: 7-on-7 actors move in straight lines at constant speed, the
// ball follows a parabola, and nothing collides. Enough to prove the `live_play`
// scene path end to end (seekTo -> snapshot -> buildFromShot) on round 1.
//
// HARD REQUIREMENT for any replacement: step(state, dt) must be a pure function of
// (state, dt). No Math.random, no Date.now, no performance.now. seekTo(state, t)
// re-simulates from t=0 in fixed 1/120 s steps so `?t=2.6` is byte-reproducible.

import { makeRng } from '../rng.js';

const DT = 1 / 120;

const OFF = [
  { id: 'o_qb', archetype: 'qb', number: '7', name: 'STRYKER', pose: 'dropback', start: [2.0, 0, 0.0], vel: [1.6, 0, 0.4] },
  { id: 'o_rb', archetype: 'skill', number: '32', name: 'RAZE', pose: 'sprint', start: [1.0, 0, 3.0], vel: [-6.0, 0, 0.6] },
  { id: 'o_wr1', archetype: 'skill', number: '81', name: 'HOLT', pose: 'sprint', start: [0.0, 0, -14.0], vel: [-7.4, 0, -0.8] },
  { id: 'o_wr2', archetype: 'skill', number: '87', name: 'BRAND', pose: 'sprint', start: [0.0, 0, 12.0], vel: [-7.0, 0, 1.2] },
  { id: 'o_te', archetype: 'lb', number: '88', name: 'HOYT', pose: 'sprint', start: [0.0, 0, 4.0], vel: [-5.6, 0, -1.4] },
  { id: 'o_ol1', archetype: 'lineman', number: '74', name: 'BROOK', pose: 'block', start: [-0.6, 0, -1.4], vel: [-0.6, 0, 0] },
  { id: 'o_ol2', archetype: 'lineman', number: '77', name: 'DRAKE', pose: 'block', start: [-0.6, 0, 1.4], vel: [-0.5, 0, 0] },
];

const DEF = [
  { id: 'd_lb1', archetype: 'lb', number: '52', name: 'KANE', pose: 'sprint', start: [-6.0, 0, -1.0], vel: [5.2, 0, 0.4] },
  { id: 'd_lb2', archetype: 'lb', number: '56', name: 'CROW', pose: 'sprint', start: [-6.5, 0, 2.4], vel: [5.0, 0, -0.6] },
  { id: 'd_dl1', archetype: 'lineman', number: '95', name: 'GRAVES', pose: 'block', start: [-2.2, 0, -1.5], vel: [1.2, 0, 0] },
  { id: 'd_dl2', archetype: 'lineman', number: '91', name: 'SOLL', pose: 'block', start: [-2.2, 0, 1.5], vel: [1.0, 0, 0] },
  { id: 'd_cb1', archetype: 'skill', number: '23', name: 'RUSK', pose: 'sprint', start: [-9.0, 0, -14.5], vel: [6.6, 0, -0.6] },
  { id: 'd_cb2', archetype: 'skill', number: '29', name: 'MERGE', pose: 'sprint', start: [-9.0, 0, 12.5], vel: [6.4, 0, 1.0] },
  { id: 'd_s1', archetype: 'skill', number: '27', name: 'FEN', pose: 'sprint', start: [-16.0, 0, 0.5], vel: [4.0, 0, -0.2] },
];

const impl = {
  piece: 'foundation-fallback',

  create(seed = 7, opts = {}) {
    const rng = makeRng(seed);
    const mk = (d, team, variant, side) => ({
      id: d.id, team, variant, number: d.number, name: d.name,
      archetype: d.archetype, pose: d.pose, side,
      pos: d.start.slice(), vel: d.vel.slice(),
      rotY: Math.atan2(d.vel[0], d.vel[2]),
      phase: rng(), airborne: false,
    });
    return {
      seed,
      t: 0,
      teamA: opts.teamA || 'NYC',
      teamB: opts.teamB || 'CHI',
      actors: [
        ...OFF.map((d) => mk(d, opts.teamA || 'NYC', 'home', 'off')),
        ...DEF.map((d) => mk(d, opts.teamB || 'CHI', 'away', 'def')),
      ],
      ball: { pos: [1.6, 1.4, 0.2], vel: [-14, 5.5, -2.2], thrownAt: 0.9, held: 'o_qb' },
      events: [],
      scoreA: 22, scoreB: 14,
    };
  },

  step(state, dt) {
    const g = -9.81;
    for (const a of state.actors) {
      a.pos[0] += a.vel[0] * dt;
      a.pos[2] += a.vel[2] * dt;
      a.phase = (a.phase + dt * 2.2) % 1;
      a.rotY = Math.atan2(a.vel[0], a.vel[2]);
    }
    const b = state.ball;
    if (state.t >= b.thrownAt) {
      b.held = null;
      b.vel[1] += g * dt;
      b.pos[0] += b.vel[0] * dt;
      b.pos[1] += b.vel[1] * dt;
      b.pos[2] += b.vel[2] * dt;
      if (b.pos[1] < 0.15) { b.pos[1] = 0.15; b.vel[1] = 0; b.vel[0] *= 0.4; b.vel[2] *= 0.4; }
    } else {
      const qb = state.actors.find((a) => a.id === 'o_qb');
      if (qb) b.pos = [qb.pos[0] - 0.35, 1.42, qb.pos[2] + 0.3];
    }
    state.t += dt;
  },

  /** Re-simulate from 0 in fixed steps. Byte-reproducible for a given (seed, t). */
  seekTo(state, t) {
    if (t < state.t) {
      const fresh = impl.create(state.seed, { teamA: state.teamA, teamB: state.teamB });
      Object.assign(state, fresh);
    }
    let guard = 0;
    while (state.t < t - 1e-9 && guard++ < 200000) {
      impl.step(state, Math.min(DT, t - state.t));
    }
  },

  /** -> { actors:[ShotActor], ball, hud, events } */
  snapshot(state) {
    return {
      actors: state.actors.map((a) => ({
        id: a.id, team: a.team, variant: a.variant, number: a.number, name: a.name,
        archetype: a.archetype, pose: a.pose, phase: a.phase,
        pos: a.pos.slice(), rotY: a.rotY, airborne: a.airborne,
        hero: a.id === 'o_qb',
      })),
      ball: { pos: state.ball.pos.slice(), rotQ: [0, 0, 0, 1], flame: state.ball.held ? 0.9 : 0.35, visible: true, spin: 4 },
      hud: {
        visible: true,
        clock: ':' + String(Math.max(0, 15 - Math.floor(state.t))).padStart(2, '0'),
        quarter: 2, down: 2, dist: '2ND', yards: '250',
        teamA: state.teamA, teamB: state.teamB,
        scoreA: state.scoreA, scoreB: state.scoreB,
        turbo: 0.5 + 0.4 * Math.sin(state.t * 1.3),
        momentumA: 0.55, momentumB: 0.4,
      },
      events: state.events.slice(),
    };
  },
};

export default impl;
