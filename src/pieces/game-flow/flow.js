// PIECE game-flow — THE STATE MACHINE THAT ACTUALLY PLAYS A GAME.
//
// The foundation fallback this replaces is a DEMO TIMER: its states advance on fixed ages
// (title for 180 ticks, playcall for 120, play for 420) and nothing in it knows a down from
// a touchdown. Everything needed to play football was already in this directory -- rules.js
// has downs and scoring, kick.js has the automatic placekick and the onside contest,
// pad.js has the control scheme -- and none of it was wired to anything. This is the wiring.
//
// WHY THE FLOW SLOT EXISTS AT ALL, and it is a performance reason rather than a design one:
// THE PLAY BOUNDARY IS THE ONLY PLACE A HITCH IS INVISIBLE. The adaptive scaler splits rung
// changes into cheap ones that cross-fade live and EXPENSIVE ones (post pass count, shadow
// on/off, actor LOD) that would stall visibly. Expensive ones are queued and committed in
// enterPlay(), behind the transition. That contract is preserved exactly.
//
// TICK-DRIVEN THROUGHOUT. No wall clock, no setTimeout. A transition scheduled for tick N
// happens on tick N at 60 Hz and at 30 Hz alike, which is what lets a whole game be replayed
// from a seed and asserted in plain node.

import PLAYBOOK from '../../data/playbook.json';
import PLAYERS from '../../data/players.json';
import { makeRng, hash } from '../../foundation/rng.js';
import * as sim from '../play-sim/sim.js';
import { callOffense, callDefense, shouldKick } from './coach.js';
import { OVERLAY_TICKS, KICK_OVERLAY, resolvePlacekick, resolveOnside, SCORE } from './kick.js';
import {
  newGame, applyPlay, applyPat, tickClock, OUTCOME, OUTCOME_NAME, yardsToGoal,
} from './rules.js';
import { PHASE } from './pad.js';

export const STATE = Object.freeze({
  BOOT: 0, TITLE: 1, TEAM_SELECT: 2, PLAYCALL: 3, PLAY: 4, RESULT: 5,
});
export const STATE_NAME = ['boot', 'title', 'team_select', 'playcall', 'play', 'result'];
const SCREEN_FOR = [null, 'title', 'teamSelect', 'playcall', null, null];

/** How long each non-play state holds, in ticks at 60 Hz. */
export const HOLD = Object.freeze({
  BOOT: 30, TITLE: 180, TEAM_SELECT: 150, PLAYCALL: 150, RESULT: 96,
});
/** A play is abandoned after this many ticks. The sim's own cap is 600. */
export const PLAY_CAP = 620;

const CLUBS = Object.keys(PLAYERS.byTeam);

const impl = {
  piece: 'game-flow',
  STATE, STATE_NAME, PHASE,

  create(opts = {}) {
    const seed = opts.seed === undefined ? 7 : opts.seed;
    const home = opts.home && PLAYERS.byTeam[opts.home] ? opts.home : CLUBS[hash(seed, 1) % CLUBS.length];
    let away = opts.away && PLAYERS.byTeam[opts.away] ? opts.away : CLUBS[hash(seed, 2) % CLUBS.length];
    if (away === home) away = CLUBS[(CLUBS.indexOf(home) + 11) % CLUBS.length];
    return {
      state: STATE.BOOT,
      prevState: STATE.BOOT,
      enteredTick: 0,
      tick: 0,
      playCount: 0,
      seed,
      rng: makeRng(seed),
      // The rule set's own state. flow owns it; nothing else may mutate it.
      game: newGame(home, away),
      // The current call and the live simulation of it.
      offense: null,
      defense: null,
      play: null,
      lastOutcome: OUTCOME.NONE,
      lastGain: 0,
      // What the score callout is showing, and for how long.
      overlay: null,
      overlayUntil: 0,
      // The scaler's queued expensive commit.
      pendingRung: -1,
      pendingReason: 0,
      committedRung: -1,
      commits: 0,
      boundary: false,
    };
  },

  age(st) { return st.tick - st.enteredTick; },

  go(st, next, tick) {
    if (next === st.state) return false;
    st.prevState = st.state;
    st.state = next;
    st.enteredTick = tick;
    st.boundary = true;
    if (next === STATE.PLAY) st.playCount++;
    return true;
  },

  queueRung(st, rung, reason) {
    st.pendingRung = rung;
    st.pendingReason = reason || 0;
  },

  /**
   * THE BOUNDARY. The queued expensive rung change is committed here and nowhere else,
   * and the down's play calls are chosen here so that the sim is built exactly once.
   */
  enterPlay(st, tick) {
    impl.go(st, STATE.PLAY, tick);
    const g = st.game;
    const salt = hash(st.seed, st.playCount, g.down, g.ballOn) >>> 0;
    st.offense = callOffense(PLAYBOOK, g, salt);
    st.defense = callDefense(PLAYBOOK, g, salt);
    st.play = sim.createPlay(salt, st.offense, st.defense,
      PLAYERS.byTeam[g.possession === 1 ? g.home : g.away],
      PLAYERS.byTeam[g.possession === 1 ? g.away : g.home],
      PLAYBOOK.formation);
    if (st.pendingRung >= 0) {
      st.committedRung = st.pendingRung;
      st.pendingRung = -1;
      st.commits++;
      return st.committedRung;
    }
    return -1;
  },

  /**
   * One tick. Pure: same seed, same tick sequence, same game.
   *
   * The PLAY state advances the real simulation rather than counting down a timer, and the
   * down's result is fed straight into the rule set -- which is the whole point, and the
   * thing the fallback could not do.
   */
  step(st, tick) {
    st.tick = tick;
    st.boundary = false;
    const age = tick - st.enteredTick;

    switch (st.state) {
      case STATE.BOOT:
        if (age >= HOLD.BOOT) impl.go(st, STATE.TITLE, tick);
        break;
      case STATE.TITLE:
        if (age >= HOLD.TITLE) impl.go(st, STATE.TEAM_SELECT, tick);
        break;
      case STATE.TEAM_SELECT:
        if (age >= HOLD.TEAM_SELECT) impl.go(st, STATE.PLAYCALL, tick);
        break;
      case STATE.PLAYCALL:
        if (age >= HOLD.PLAYCALL) impl.enterPlay(st, tick);
        break;
      case STATE.PLAY: {
        if (st.play && st.play.result === sim.RESULT.LIVE && age < PLAY_CAP) {
          sim.advance(st.play);
          break;
        }
        impl.finishPlay(st, tick);
        break;
      }
      case STATE.RESULT:
        if (age >= (st.overlay ? OVERLAY_TICKS : HOLD.RESULT)) {
          st.overlay = null;
          if (!st.game.over) impl.go(st, STATE.PLAYCALL, tick);
        }
        break;
      default: break;
    }
    return st.state;
  },

  /**
   * Settle the down: hand the simulation's result to the rule set, award any points, and
   * decide what the callout says. Split out of step() so a test can drive a whole game
   * without a renderer and land on the identical state.
   */
  finishPlay(st, tick) {
    const p = st.play;
    const g = st.game;
    let gain = 0, turnover = false;
    if (p) {
      if (p.result === sim.RESULT.LIVE) { p.result = sim.RESULT.TACKLED; }
      gain = p.yards || 0;
      turnover = p.result === sim.RESULT.INTERCEPTION || p.result === sim.RESULT.FUMBLE;
      if (p.result === sim.RESULT.INCOMPLETE) gain = 0;
    }
    st.lastGain = gain;

    // Fourth down and in range: take the automatic three rather than hand the ball over.
    if (!turnover && g.down >= 4 && shouldKick(g) && gain < g.toGo) {
      const k = resolvePlacekick('fg');
      g.score[g.possession] += k.points;
      st.overlay = k.overlay;
      st.lastOutcome = OUTCOME.FIELD_GOAL;
      kickoffAfterScore(g);
      tickClock(g, playTicks(p));
      impl.go(st, STATE.RESULT, tick);
      st.overlayUntil = tick + OVERLAY_TICKS;
      return st.lastOutcome;
    }

    const outcome = applyPlay(g, gain, turnover);
    st.lastOutcome = outcome;

    if (outcome === OUTCOME.TOUCHDOWN) {
      applyPat(g);                       // the point after is automatic, by rule
      st.overlay = KICK_OVERLAY.PAT;
      kickoffAfterScore(g);
    } else if (outcome === OUTCOME.SAFETY) {
      st.overlay = null;
    }

    tickClock(g, playTicks(p));
    impl.go(st, STATE.RESULT, tick);
    st.overlayUntil = tick + (st.overlay ? OVERLAY_TICKS : HOLD.RESULT);
    return outcome;
  },

  /**
   * The pad phase for right now, which is finer-grained than the flow state: the control
   * scheme changes between holding the ball and carrying it, and pad.js binds per phase.
   */
  phaseFor(st) {
    if (st.state === STATE.PLAYCALL) return PHASE.PLAYCALL;
    if (st.state === STATE.RESULT) return st.overlay ? PHASE.PAT : PHASE.PLAYCALL;
    if (st.state !== STATE.PLAY || !st.play) return PHASE.PLAYCALL;
    const p = st.play;
    if (p.tick <= 0) return PHASE.PRESNAP;
    if (p.carrier !== 'QB' || p.scrambling || p.offense.kind === 'run') return PHASE.OFFENSE_CARRY;
    return PHASE.OFFENSE_POCKET;
  },

  /** The onside kick is the one kick that is played rather than given. */
  onside(st, stopTick, roll) {
    const g = st.game;
    const k = PLAYERS.byTeam[g.possession === 1 ? g.home : g.away][0];
    const r = PLAYERS.byTeam[g.possession === 1 ? g.away : g.home][0];
    return resolveOnside(stopTick, (k && k.spd) || 60, (r && r.spd) || 60,
      roll === undefined ? st.rng() : roll);
  },

  screenFor(st) { return SCREEN_FOR[st.state] || null; },
  hudVisible(st) { return st.state === STATE.PLAY || st.state === STATE.RESULT; },

  hash(st) {
    let h = 2166136261 >>> 0;
    const mix = (v) => { h ^= (v | 0) >>> 0; h = Math.imul(h, 16777619) >>> 0; };
    mix(st.state); mix(st.enteredTick); mix(st.playCount); mix(st.commits);
    mix(st.game.score[0]); mix(st.game.score[1]); mix(st.game.down); mix(st.game.ballOn);
    return h >>> 0;
  },

  applyRung() { /* flow never scales. */ },
};

/** Ticks of game clock a down consumed. A play that never ran still burns the huddle. */
function playTicks(p) {
  return 90 + (p ? Math.min(300, p.tick) : 0);
}

/** After any score the ball goes back to the other side at their own 25. */
function kickoffAfterScore(g) {
  g.possession = g.possession === 0 ? 1 : 0;
  g.ballOn = 25;
  g.down = 1;
  g.toGo = Math.min(30, yardsToGoal(g));
}

export default impl;
export { impl };
