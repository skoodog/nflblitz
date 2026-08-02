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

/** Radians of spiral per yard of flight. A thrown ball turns about its long axis. */
const BALL_SPIRAL = 2.6;

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


/**
 * Quaternion that points the ball's LONG AXIS along `dir` and spirals it about that axis.
 *
 * THE BALL WAS A FLAT DISC and it was this file's fault. impact-fx lathes a real prolate
 * football with pointed ends, laces and stripes, and its long axis is Z because that is
 * the axis world.js spins it about. This adapter sent `rotQ: [0,0,0,1]` on every frame --
 * identity -- so the long axis stayed pinned to world +Z, which runs ACROSS the field. A
 * pass thrown downfield was therefore viewed exactly END-ON, and a prolate spheroid seen
 * end-on is a circle. Every captured frame in this project shows the ball as an orange
 * disc for that reason, mine included, and I blamed the ball geometry for it twice.
 *
 * Done with plain arithmetic rather than three.js on purpose: this module has to stay
 * importable by plain node so the mutation battery can load it.
 *
 *   aim  = shortest rotation taking +Z onto dir      -> [cross(z,d), 1 + dot(z,d)], normalised
 *   roll = rotation about dir by `roll` radians      -> [d*sin(r/2), cos(r/2)]
 *   out  = roll * aim
 */
function ballQuat(dx, dy, dz, roll) {
  const L = Math.hypot(dx, dy, dz);
  if (L < 1e-9) return [0, 0, 0, 1];
  const bx = dx / L, by = dy / L, bz = dz / L;
  // cross((0,0,1), b) and 1 + dot((0,0,1), b)
  let qx = -by, qy = bx, qz = 0, qw = 1 + bz;
  if (qw < 1e-6) { qx = 1; qy = 0; qz = 0; qw = 0; }   // exactly antiparallel: spin about X
  const n = Math.hypot(qx, qy, qz, qw);
  qx /= n; qy /= n; qz /= n; qw /= n;
  const h = roll * 0.5, sr = Math.sin(h), cr = Math.cos(h);
  const rx = bx * sr, ry = by * sr, rz = bz * sr, rw = cr;
  // Hamilton product: roll * aim
  return [
    rw * qx + rx * qw + ry * qz - rz * qy,
    rw * qy - rx * qz + ry * qw + rz * qx,
    rw * qz + rx * qy - ry * qx + rz * qw,
    rw * qw - rx * qx - ry * qy - rz * qz,
  ];
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

  /**
   * Re-simulate from zero. Byte-reproducible for a given (seed, t).
   *
   * THE RESET HAS TO BE TOTAL. This used to Object.assign a fresh state over the old one,
   * which only overwrites the keys the fresh state HAS -- and a played-out down carries
   * keys createPlay never sets: `scrambling`, `scrambleAt`, `escapeSide`, `flushedAt`.
   * They survived the reset, so seeking backwards resumed a down that already believed its
   * passer had broken contain, and replayed differently from the first pass. Caught by
   * scripts/simmutate.mjs the moment adapt.js came under coverage, on the UNMUTATED file --
   * before a single mutation ran. Anyone scrubbing a replay would have seen the play change
   * under them.
   */
  seekTo(state, t) {
    if (t < state.t) {
      const fresh = impl.create(state.seed, { teamA: state.teamA, teamB: state.teamB });
      for (const k of Object.keys(state)) if (!(k in fresh)) delete state[k];
      Object.assign(state, fresh);
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
      const amp = 0.9 + b.len * 0.06;
      // The nose follows the tangent of the flight path, arc included: the horizontal part
      // is the straight line from release to arrival, the vertical part is the derivative
      // of that arc, so the ball noses UP out of the hand and DOWN into the receiver.
      const slope = b.len <= 0 ? 0 : Math.cos(u * Math.PI) * Math.PI * amp / b.len;
      ball = {
        pos: [-y, 1.4 + Math.sin(u * Math.PI) * amp, x],
        held: null,
        quat: ballQuat(-(b.ty - b.y), slope * (b.len || 1), b.tx - b.x, b.travelled * BALL_SPIRAL),
      };
    } else if (carrier) {
      // Tucked: the long axis follows the man's own heading rather than the world axis.
      const hx = -(carrier.y - carrier.py), hz = carrier.x - carrier.px;
      ball = {
        pos: [-carrier.y - 0.3, 1.42, carrier.x + 0.35],
        held: `o_${carrier.slot.toLowerCase()}`,
        quat: ballQuat(hx, 0, hz || 1e-6, 0),
      };
    } else {
      ball = { pos: [0, 1.42, 0], held: null, quat: [0, 0, 0, 1] };
    }

    const h = state.hudSeed || {};
    return {
      actors,
      ball: {
        pos: ball.pos, rotQ: ball.quat,
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
