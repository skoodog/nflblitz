// PIECE play-sim — THE ADAPTER between the tick simulation and the renderer's slot.
//
// sim.js is deliberately ignorant of the engine: it thinks in yards, ticks and slots, has
// no notion of a scene graph, and is testable in plain node in milliseconds because of it.
// The registry wants something else entirely -- create(seed, opts) / step(state, dt) /
// seekTo(state, t) / snapshot(state), in world units, with actors carrying archetypes and
// poses. This file is the only place the two vocabularies meet, and keeping the conversion
// here is what stops render concerns leaking back into a simulation that has to stay pure.
//
// AXES. The world runs downfield along -x and across the field along +z; the simulation
// runs downfield along +y and across along +x. So:
//
//     world.x = -sim.y      (downfield: the offence attacks -x)
//     world.z =  sim.x      (across:    unchanged, just renamed)
//
// TIME. The simulation is a fixed 60 Hz tick; the renderer hands us seconds. dt is
// accumulated and whole ticks are consumed, so a variable frame rate can never produce a
// fractional tick and the sim state stays bit-identical to the plain-node runs -- the same
// property the engine already proved across 60/45/30 present rates.

import PLAYBOOK from '../../data/playbook.json';
import PLAYERS from '../../data/players.json';
import { hash } from '../../foundation/rng.js';
import { createPlay, advance, RESULT, RESULT_NAME, TICK_HZ } from './sim.js';

/** Slot -> the renderer's actor archetype. */
const ARCHETYPE = {
  QB: 'qb', REC1: 'skill', REC2: 'skill', REC3: 'skill',
  OL1: 'lineman', OL2: 'lineman', OL3: 'lineman',
  RUSH1: 'lineman', RUSH2: 'lineman', ROVER: 'lb',
  DB1: 'skill', DB2: 'skill', DB3: 'skill', DB4: 'skill',
};

const CLUBS = Object.keys(PLAYERS.byTeam);

function poseFor(state, m) {
  if (m.side === 'OFF') {
    if (m.slot === state.carrier) {
      return state.scrambling || state.offense.kind === 'run' ? 'sprint' : 'dropback';
    }
    if (m.slot.startsWith('OL')) return 'block';
    return 'sprint';
  }
  if (state.defense.assign[m.slot] === 'rush' && m.blocked) return 'block';
  return 'sprint';
}

/** One simulation man -> one renderer actor. */
function toActor(state, m, team, variant) {
  return {
    id: (m.side === 'OFF' ? 'o_' : 'd_') + m.slot.toLowerCase(),
    team, variant, number: String(m.num || ''), name: m.name,
    archetype: ARCHETYPE[m.slot] || 'skill',
    pose: poseFor(state, m),
    side: m.side === 'OFF' ? 'off' : 'def',
    // Heading from the man's own last-tick displacement, so he faces where he is going
    // rather than where his assignment points.
    pos: [-m.y, 0, m.x],
    rotY: Math.atan2(-(m.x - m.px), (m.y - m.py)) || 0,
    airborne: false,
    phase: 0,
  };
}

const impl = {
  piece: 'play-sim',

  /**
   * A live down. `opts.teamA`/`teamB` pick the clubs; `opts.offense`/`defense` pick calls
   * by id, and without them the seed picks -- so a scene with only a seed still gets a
   * real play from the shared sheet rather than a hard-coded one.
   */
  create(seed = 7, opts = {}) {
    const teamA = opts.teamA && PLAYERS.byTeam[opts.teamA] ? opts.teamA : CLUBS[hash(seed, 1) % CLUBS.length];
    let teamB = opts.teamB && PLAYERS.byTeam[opts.teamB] ? opts.teamB : CLUBS[hash(seed, 2) % CLUBS.length];
    if (teamB === teamA) teamB = CLUBS[(CLUBS.indexOf(teamA) + 7) % CLUBS.length];

    const pick = (list, id, salt) => {
      const found = id && list.find((x) => x.id === id);
      return found || list[hash(seed, salt) % list.length];
    };
    const offense = pick(PLAYBOOK.offense, opts.offense, 3);
    const defense = pick(PLAYBOOK.defense, opts.defense, 4);

    const state = createPlay(seed, offense, defense,
      PLAYERS.byTeam[teamA], PLAYERS.byTeam[teamB], PLAYBOOK.formation);
    state.teamA = teamA;
    state.teamB = teamB;
    state.seed = seed;
    state.t = 0;
    state.acc = 0;          // leftover seconds not yet worth a whole tick
    state.hudSeed = opts.hud || null;
    return state;
  },

  /**
   * Advance by `dt` seconds. WHOLE TICKS ONLY -- the remainder is carried, so the same
   * elapsed time produces the same tick count at any frame rate, and the sim cannot be
   * made to disagree with itself by a slow frame.
   */
  step(state, dt) {
    state.t += dt;
    state.acc += dt;
    const per = 1 / TICK_HZ;
    let guard = 0;
    while (state.acc >= per && guard++ < 600) {
      state.acc -= per;
      if (state.result !== RESULT.LIVE) break;
      // advance() is the passer's decision plus one step, the exact body runPlay() loops
      // over -- so the renderer drives the identical simulation the tests exercise rather
      // than a second copy of the AI that could drift away from it.
      advance(state);
    }
  },

  /** Re-simulate from zero. Byte-reproducible for a given (seed, t). */
  seekTo(state, t) {
    if (t < state.t) {
      Object.assign(state, impl.create(state.seed, { teamA: state.teamA, teamB: state.teamB }));
    }
    const per = 1 / TICK_HZ;
    let guard = 0;
    while (state.t < t - 1e-9 && guard++ < 200000) impl.step(state, Math.min(per, t - state.t));
  },

  snapshot(state) {
    const carrier = state.off.find((m) => m.slot === state.carrier);
    const actors = state.off.map((m) => toActor(state, m, state.teamA, 'home'))
      .concat(state.def.map((m) => toActor(state, m, state.teamB, 'away')));
    for (const a of actors) a.hero = a.id === `o_${(state.carrier || 'qb').toLowerCase()}`;

    // The ball is where the man holding it is, unless it is in the air, in which case it
    // is on its own line between release and arrival with a real arc over it.
    let ball;
    if (state.ball) {
      const b = state.ball;
      const u = b.len <= 0 ? 1 : Math.min(1, b.travelled / b.len);
      const x = b.x + (b.tx - b.x) * u, y = b.y + (b.ty - b.y) * u;
      ball = { pos: [-y, 1.4 + Math.sin(u * Math.PI) * (0.9 + b.len * 0.06), x], held: null };
    } else if (carrier) {
      ball = { pos: [-carrier.y - 0.3, 1.42, carrier.x + 0.35], held: `o_${carrier.slot.toLowerCase()}` };
    } else {
      ball = { pos: [0, 1.42, 0], held: null };
    }

    const h = state.hudSeed || {};
    return {
      actors,
      ball: {
        pos: ball.pos, rotQ: [0, 0, 0, 1],
        flame: ball.held ? 0.9 : 0.35, visible: true, spin: ball.held ? 0 : 4,
      },
      hud: {
        visible: true,
        clock: h.clock || `:${String(Math.max(0, 15 - Math.floor(state.t))).padStart(2, '0')}`,
        quarter: h.quarter || 2,
        down: h.down || 1,
        dist: h.dist || '1ST',
        yards: h.yards === undefined ? String(Math.max(0, Math.round(state.yards))) : h.yards,
        teamA: state.teamA, teamB: state.teamB,
        scoreA: h.scoreA === undefined ? 0 : h.scoreA,
        scoreB: h.scoreB === undefined ? 0 : h.scoreB,
        turbo: 1, momentumA: 0.5, momentumB: 0.5,
      },
      // The simulation's own event log, verbatim: throws, catches, sacks, scrambles,
      // broken tackles. impact-fx and score-callout read this rather than re-deriving
      // what happened from positions.
      events: state.events.map((e) => ({ ...e, t: e.tick / TICK_HZ })),
      result: RESULT_NAME[state.result],
      play: { offense: state.offense.id, defense: state.defense.id },
    };
  },
};

export default impl;
export { impl, toActor };
