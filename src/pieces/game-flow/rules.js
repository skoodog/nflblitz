// PIECE game-flow — THE RULE SET.
//
// Arcade football, not the real code book. The differences are deliberate and each one
// exists to keep the ball in play:
//
//   - FOUR downs to make THIRTY yards. A real first down is ten, which on a 7-on-7 field
//     with these speeds would move the chains almost every set. Thirty makes a first down
//     an event and makes fourth down a real decision every series.
//   - NO PENALTIES. Nothing stops the clock to argue about procedure.
//   - Placekicks are automatic (see kick.js). Onside kicks are played.
//   - The clock runs on plays, not on the wall: a quarter is a fixed number of PLAYS'
//     worth of ticks, so a game is the same length on any device and at any frame rate.
//
// Every function here is a PURE FUNCTION of state -> state. Nothing reads a clock, draws
// anything, or touches the renderer, which is why the whole rule set is testable in plain
// node without a browser (scripts/gametest.mjs). That was the point of doing this first.

import { SCORE } from './kick.js';

export const YARDS_TO_GO = 30;
export const DOWNS = 4;
export const FIELD_YARDS = 100;
export const QUARTERS = 4;
/** Ticks at 60/s of game clock per quarter. */
export const QUARTER_TICKS = 60 * 120;

export const OUTCOME = Object.freeze({
  NONE: 0, TOUCHDOWN: 1, FIELD_GOAL: 2, SAFETY: 3, TURNOVER: 4,
  TURNOVER_ON_DOWNS: 5, FIRST_DOWN: 6, TACKLED: 7, INCOMPLETE: 8, OUT_OF_BOUNDS: 9,
});
export const OUTCOME_NAME = [
  'none', 'touchdown', 'field-goal', 'safety', 'turnover',
  'turnover-on-downs', 'first-down', 'tackled', 'incomplete', 'out-of-bounds',
];

/**
 * A fresh game. `home` and `away` are club abbreviations.
 * Possession is expressed as 0 = away, 1 = home, matching the score array's indices so
 * nothing ever has to translate between a "who has it" and a "whose score" index.
 */
export function newGame(home, away) {
  return {
    home, away,
    score: [0, 0],
    quarter: 1,
    clock: QUARTER_TICKS,
    possession: 0,
    // Ball position is ALWAYS in the possessing team's frame: yards from their own goal
    // line, 0..100. Storing it absolutely and flipping on change of possession is the
    // classic source of sign bugs in this kind of code.
    ballOn: 25,
    down: 1,
    toGo: YARDS_TO_GO,
    over: false,
    lastOutcome: OUTCOME.NONE,
  };
}

/** Yards from the ball to the goal line the offence is attacking. */
export function yardsToGoal(g) {
  return FIELD_YARDS - g.ballOn;
}

/** Give the ball to the other side, flipping the field so ballOn stays own-frame. */
export function changePossession(g, spotFromOwnGoal) {
  g.possession = g.possession === 0 ? 1 : 0;
  g.ballOn = spotFromOwnGoal === undefined
    ? Math.max(1, Math.min(FIELD_YARDS - 1, FIELD_YARDS - g.ballOn))
    : Math.max(1, Math.min(FIELD_YARDS - 1, spotFromOwnGoal));
  g.down = 1;
  g.toGo = Math.min(YARDS_TO_GO, yardsToGoal(g));
  return g;
}

/**
 * Advance the game by the result of one play.
 *
 * `gain` is yards gained by the offence (negative for a loss). `turnover` marks an
 * interception or fumble recovered by the defence. Returns the outcome so the caller can
 * fire a callout without re-deriving what happened.
 */
export function applyPlay(g, gain, turnover) {
  if (g.over) return OUTCOME.NONE;

  if (turnover) {
    // Spot the turnover where the play ended, in the NEW offence's frame.
    const spot = FIELD_YARDS - Math.max(1, Math.min(FIELD_YARDS - 1, g.ballOn + gain));
    changePossession(g, spot);
    g.lastOutcome = OUTCOME.TURNOVER;
    return OUTCOME.TURNOVER;
  }

  g.ballOn += gain;

  // Safety BEFORE touchdown: a play that ends behind your own goal line is a safety even
  // if the gain was large and negative from midfield.
  if (g.ballOn <= 0) {
    g.score[g.possession === 0 ? 1 : 0] += SCORE.SAFETY;
    changePossession(g, 20);
    g.lastOutcome = OUTCOME.SAFETY;
    return OUTCOME.SAFETY;
  }

  if (g.ballOn >= FIELD_YARDS) {
    g.score[g.possession] += SCORE.TOUCHDOWN;
    g.ballOn = FIELD_YARDS;
    g.lastOutcome = OUTCOME.TOUCHDOWN;
    return OUTCOME.TOUCHDOWN;
  }

  g.toGo -= gain;
  if (g.toGo <= 0) {
    g.down = 1;
    g.toGo = Math.min(YARDS_TO_GO, yardsToGoal(g));
    g.lastOutcome = OUTCOME.FIRST_DOWN;
    return OUTCOME.FIRST_DOWN;
  }

  g.down += 1;
  if (g.down > DOWNS) {
    changePossession(g);
    g.lastOutcome = OUTCOME.TURNOVER_ON_DOWNS;
    return OUTCOME.TURNOVER_ON_DOWNS;
  }

  g.lastOutcome = OUTCOME.TACKLED;
  return OUTCOME.TACKLED;
}

/** Award the automatic point after, then set up the kickoff. */
export function applyPat(g) {
  g.score[g.possession] += SCORE.PAT;
  return g.score[g.possession];
}

/** Run the clock down by `ticks`, rolling quarters and ending the game. */
export function tickClock(g, ticks) {
  if (g.over) return g;
  g.clock -= ticks;
  while (g.clock <= 0 && !g.over) {
    if (g.quarter >= QUARTERS) {
      g.clock = 0;
      g.over = true;
    } else {
      g.quarter += 1;
      g.clock += QUARTER_TICKS;
    }
  }
  return g;
}

/** Score line for the HUD, always [away, home] to match the score array. */
export function scoreLine(g) {
  return { away: { club: g.away, pts: g.score[0] }, home: { club: g.home, pts: g.score[1] } };
}

export default {
  YARDS_TO_GO, DOWNS, FIELD_YARDS, QUARTERS, QUARTER_TICKS, OUTCOME, OUTCOME_NAME,
  newGame, yardsToGoal, changePossession, applyPlay, applyPat, tickClock, scoreLine,
};
