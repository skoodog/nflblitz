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
import { ACT, DIR } from '../touch-controller/tuning.js';

export const STATE = Object.freeze({
  BOOT: 0, TITLE: 1, TEAM_SELECT: 2, PLAYCALL: 3, PLAY: 4, RESULT: 5,
});
export const STATE_NAME = ['boot', 'title', 'team_select', 'playcall', 'play', 'result'];
const SCREEN_FOR = [null, 'title', 'teamSelect', 'playcall', null, null];

/** How long each non-play state holds, in ticks at 60 Hz. */
export const HOLD = Object.freeze({
  BOOT: 30, TITLE: 210, TEAM_SELECT: 240, PLAYCALL: 300, RESULT: 120,
});
/** A play is abandoned after this many ticks. The sim's own cap is 600. */
export const PLAY_CAP = 620;

const CLUBS = Object.keys(PLAYERS.byTeam);

const impl = {
  piece: 'game-flow',
  STATE, STATE_NAME, PHASE,
  // Published on the slot so the runtime can show a play clock that counts down the
  // SAME number the state machine snaps the ball on, rather than a second copy of it.
  get HOLD() { return HOLD; },
  get PLAY_CAP() { return PLAY_CAP; },

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
      // Player-facing bits: the highlighted call, the committed call, and turbo.
      callPage: 1,
      callIndex: 0,
      playerCall: null,
      turbo: false,
      lastInput: null,
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
    // The player's chosen call wins if there is one; the coordinator fills in otherwise,
    // which is what keeps an unattended build playing itself as an attract mode.
    st.offense = st.playerCall || callOffense(PLAYBOOK, g, salt);
    st.playerCall = null;
    st.defense = callDefense(PLAYBOOK, g, salt);
    const offClub = g.possession === 1 ? g.home : g.away;
    const defClub = g.possession === 1 ? g.away : g.home;
    st.play = sim.createPlay(salt, st.offense, st.defense,
      PLAYERS.byTeam[offClub], PLAYERS.byTeam[defClub], PLAYBOOK.formation);
    // The renderer reads a down through adapt.js's snapshot(), which needs the club ids
    // and a wall-clock-free `t` on the state. Without them every actor came back with an
    // undefined team and the uniform piece fell through to plain grey.
    st.play.teamA = offClub;
    st.play.teamB = defClub;
    st.play.seed = salt;
    st.play.t = 0;
    st.play.acc = 0;
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

  /**
   * THE PLAYER'S HANDS ON THE GAME. This is the wire that was missing.
   *
   * Everything needed to play existed and none of it was connected: the touch bus drained,
   * the controller resolved gestures into `st.action` on the correct tick, pad.js mapped
   * every Xbox button onto the same vocabulary -- and NOTHING ANYWHERE READ THE RESULT. A
   * grep across the whole tree for a call site turning an input into a simulation action
   * returned zero hits. The game played itself beautifully while the controller resolved
   * into a void.
   *
   * `act` is an ACT.* from touch-controller/tuning.js, which is deliberately the one
   * vocabulary both devices resolve to, so this function never learns what a gamepad is.
   * Returns true if the input was consumed, which the caller uses for feedback.
   */
  input(st, act, dir, tick) {
    if (!act || act === ACT.NONE) return false;

    // ---- choosing the play -------------------------------------------------------
    if (st.state === STATE.PLAYCALL) {
      const page = PLAYBOOK.offense.filter((p) => (p.page || 1) === (st.callPage || 1));
      if (act === ACT.SWITCH_NEXT) { st.callIndex = ((st.callIndex || 0) + 1) % page.length; return true; }
      if (act === ACT.SWITCH_PREV) { st.callIndex = ((st.callIndex || 0) + page.length - 1) % page.length; return true; }
      if (act === ACT.TURBO_ON) { st.callPage = (st.callPage || 1) === 1 ? 2 : 1; st.callIndex = 0; return true; }
      // SNAP commits the highlighted call and starts the down early. The AI coordinator
      // still picks the DEFENCE -- the player is one side of the ball, not both.
      if (act === ACT.SNAP || act === ACT.PASS) {
        st.playerCall = page[st.callIndex || 0];
        impl.enterPlay(st, tick);
        return true;
      }
      return false;
    }

    if (st.state !== STATE.PLAY || !st.play || st.play.result !== sim.RESULT.LIVE) return false;
    const p = st.play;

    // ---- the passer --------------------------------------------------------------
    if (p.carrier === 'QB' && !p.ball && p.offense.kind !== 'run' && !p.scrambling) {
      if (act === ACT.PASS) {
        // The direction picks the receiver, which is the N64 C-button idiom pad.js records:
        // left/up/right are receivers 1, 2 and 3. Without a direction it is the open man.
        const slot = dir === DIR.LEFT ? 'REC1' : dir === DIR.UP ? 'REC2' : dir === DIR.RIGHT ? 'REC3' : null;
        const target = slot || sim.pickOpenReceiver(p);
        if (target && sim.throwTo(p, target)) { st.lastInput = 'pass'; return true; }
        return false;
      }
      if (act === ACT.TUCK) { p.scrambling = true; p.scrambleAt = p.tick; st.lastInput = 'tuck'; return true; }
      if (act === ACT.THROW_AWAY) {
        p.result = sim.RESULT.INCOMPLETE;
        p.yards = 0;
        p.events.push({ tick: p.tick, kind: 'throwaway' });
        st.lastInput = 'throwaway';
        return true;
      }
    }

    // ---- the ball carrier --------------------------------------------------------
    const car = p.off.find((m) => m.slot === p.carrier);
    if (car && !p.ball) {
      if (act === ACT.TURBO_ON) { st.turbo = true; return true; }
      if (act === ACT.TURBO_OFF) { st.turbo = false; return true; }
      // A juke moves the carrier laterally NOW. The simulation is a pure tick function, so
      // an input is just a nudge to its state on the tick the controller resolved it.
      if (act === ACT.JUKE_L) { car.x -= 0.9; st.lastInput = 'juke'; return true; }
      if (act === ACT.JUKE_R) { car.x += 0.9; st.lastInput = 'juke'; return true; }
      if (act === ACT.DIVE) { car.y += 1.1; st.lastInput = 'dive'; return true; }
    }
    return false;
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
