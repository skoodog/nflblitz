// PIECE game-flow — THE PLAY CALLER.
//
// Somebody has to choose. The playbook is eighteen offensive calls and nine defensive ones
// (shared by all 32 clubs, the Blitz tradition), and until this file existed nothing in the
// game picked between them: the simulation was only ever driven by a test sweeping all 162
// pairs uniformly, or by a seed. A uniform sweep is not how football is called, and saying
// so is not a detail -- it is the single biggest distortion in this project's balance
// numbers.
//
// MEASURED, and this is why the file exists. Four of the nine defensive calls send more
// rushers than there are blockers. Sampling all nine equally therefore blitzes on 44% of
// downs, and the league-wide sack rate came out at 16.7% against real football's ~7%. That
// number was never a property of the simulation; it was a property of the sampler. No real
// opponent blitzes twice as often as it plays base defence.
//
// Everything here is a PURE FUNCTION of (situation, seed). No clock, no Math.random, so
// the same game replays identically -- the invariant the whole engine rests on.

import { makeRng } from '../../foundation/rng.js';
import { YARDS_TO_GO, DOWNS, FIELD_YARDS, yardsToGoal } from './rules.js';

/**
 * How often the defence sends an overload (more rushers than the three blockers).
 *
 * Not a taste value: it is what turns the balance numbers from a statement about the test
 * harness into a statement about the game. Real defences pressure on roughly a quarter to a
 * third of downs, and lean on it hardest when the offence is desperate.
 */
export const BLITZ_BASE = 0.24;
export const BLITZ_LONG = 0.40;     // 3rd/4th and long: they know a pass is coming
export const BLITZ_GOAL = 0.34;     // inside the ten, the field is short and so is the read

/** Situation, derived once so both coordinators read the same thing. */
export function situation(g) {
  const toGoal = yardsToGoal(g);
  return {
    down: g.down,
    toGo: g.toGo,
    toGoal,
    // "Desperate" is the state that should change a call, not the down on its own.
    lastDown: g.down >= DOWNS,
    // LONG YARDAGE IS RELATIVE TO THE DOWN, not to an absolute number of yards. A first
    // down in this game is THIRTY yards, so `toGo > 18` is true on nearly every first
    // down and the defence read the whole game as obvious-passing-situation: measured over
    // 5174 coach-called downs it blitzed on 36.7% against a 24% base. The situation that
    // actually tells a defence a pass is coming is a LATE down still needing real yards.
    longYardage: g.down >= 3 && g.toGo > 12,
    shortYardage: g.toGo <= 6,
    redZone: toGoal <= 20,
    goalLine: toGoal <= 8,
    ownDeep: g.ballOn <= 12,
    trailing: g.score[g.possession] < g.score[g.possession === 0 ? 1 : 0],
    margin: g.score[g.possession] - g.score[g.possession === 0 ? 1 : 0],
    quarter: g.quarter,
  };
}

/**
 * Score every offensive call for this situation, then pick from the top few.
 *
 * WEIGHTED, NOT ARGMAX. A coordinator that always calls the single best-scoring play is
 * both unrealistic and trivially exploitable -- the human opponent learns it in three
 * series. The top candidates share the roll in proportion to their score, so the call is
 * predictable in TENDENCY and unpredictable in instance, which is what a play caller is.
 */
export function callOffense(playbook, g, seed) {
  const s = situation(g);
  const rng = makeRng(seed);
  const scored = playbook.offense.map((p) => {
    const depth = maxDepth(p);
    let w = 1;

    // Depth against the sticks. A play whose routes do not reach the marker cannot convert,
    // and one that overshoots it by thirty yards is a lottery ticket.
    if (p.kind === 'pass') {
      const need = Math.min(s.toGo, s.toGoal);
      w *= 1 / (1 + Math.abs(depth - need) / 14);
    }

    // Runs are for short yardage, the goal line, and killing clock with a lead.
    if (p.kind === 'run') {
      w *= s.shortYardage ? 2.6 : 0.55;
      if (s.goalLine) w *= 1.9;
      if (s.longYardage) w *= 0.25;
      if (s.margin > 8 && s.quarter >= 4) w *= 1.7;   // sitting on it
    }

    // A screen is an answer to pressure and to long yardage from your own end.
    if (p.kind === 'screen') w *= s.ownDeep ? 2.2 : (s.longYardage ? 1.4 : 0.9);

    // Nothing that needs more field than there is. A 44-yard concept on the 8 is dead.
    if (depth > s.toGoal + 6) w *= 0.12;

    // Down the stretch, trailing, the deep shots come out.
    if (s.trailing && s.quarter >= 4 && depth > 20) w *= 1.8;
    // Fourth down is a conversion, not a hero ball.
    if (s.lastDown) w *= p.kind === 'run' && !s.shortYardage ? 0.4 : 1;

    return { p, w: Math.max(0.02, w) };
  });
  return weightedPick(scored, rng);
}

/** Score every defensive call. The blitz rate is a BUDGET, not an accident. */
export function callDefense(playbook, g, seed) {
  const s = situation(g);
  const rng = makeRng(seed ^ 0x5f3d);
  const blitzRate = s.goalLine ? BLITZ_GOAL
    : (s.lastDown || s.longYardage) ? BLITZ_LONG
      : BLITZ_BASE;

  // Decide FIRST whether this is a pressure call, then pick within that family. Scoring the
  // families against each other could not hold a rate at all -- it would drift with whatever
  // else the weights happened to say.
  const blitzing = rng() < blitzRate;
  const pool = playbook.defense.filter((d) => (d.rush > 3) === blitzing);
  const use = pool.length ? pool : playbook.defense;

  const scored = use.map((d) => {
    let w = 1;
    // Against short yardage, crowd the line; against long, keep a lid on it.
    if (s.shortYardage) w *= d.rush >= 3 ? 1.7 : 0.6;
    if (s.longYardage) w *= deepCount(d) >= 2 ? 1.6 : 0.7;
    if (s.goalLine) w *= d.rush >= 3 ? 1.5 : 0.8;
    return { p: d, w: Math.max(0.02, w) };
  });
  return weightedPick(scored, rng);
}

/** Fourth down: go, or take the automatic three. Kicks never miss (see kick.js). */
export function shouldKick(g) {
  const s = situation(g);
  if (!s.lastDown) return false;
  // Inside field-goal range and not desperate: take the points.
  const inRange = s.toGoal <= 42;
  const desperate = s.trailing && s.margin <= -9 && g.quarter >= 4;
  if (!inRange) return false;
  if (desperate && s.toGo <= 8) return false;
  return true;
}

/* ------------------------------------------------------------------ helpers ---- */

function maxDepth(p) {
  let d = 0;
  for (const k of Object.keys(p.routes || {})) {
    for (const pt of p.routes[k]) if (pt[1] > d) d = pt[1];
  }
  return d;
}

function deepCount(d) {
  return Object.values(d.assign).filter((a) => a === 'zone_deep').length;
}

/** Roll once over the weights. Deterministic for a given rng. */
function weightedPick(scored, rng) {
  let tot = 0;
  for (const s of scored) tot += s.w;
  let r = rng() * tot;
  for (const s of scored) {
    r -= s.w;
    if (r <= 0) return s.p;
  }
  return scored[scored.length - 1].p;
}

export default { callOffense, callDefense, shouldKick, situation, BLITZ_BASE, BLITZ_LONG, BLITZ_GOAL };
