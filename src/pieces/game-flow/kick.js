// PIECE game-flow — KICKS AND SCORING.
//
// THE RULE, and it is a design decision rather than a simplification: every placekick is
// good. Extra points and field goals do not miss. Arcade football of this kind removed
// the kicking minigame on purpose — it is dead time between the plays people came for —
// and the game says so out loud with an overlay after the score rather than letting the
// player wonder whether a kick was ever in doubt.
//
// What is NOT predetermined is the ONSIDE KICK, which is a live-ball contest, not a
// placekick. It has a real input, a real skill component and a real failure state. That
// asymmetry is the whole point: the boring kick is free, the interesting kick is played.

import { kickMeter, KICK_METER_TICKS } from './pad.js';

export const SCORE = Object.freeze({
  TOUCHDOWN: 6,
  PAT: 1,
  FIELD_GOAL: 3,
  SAFETY: 2,
});

/** What the overlay says. game-flow renders it; score-callout owns the lettering. */
export const KICK_OVERLAY = Object.freeze({
  PAT: 'KICK IS GOOD',
  FIELD_GOAL: 'KICK IS GOOD',
  ONSIDE_RECOVERED: 'ONSIDE — RECOVERED!',
  ONSIDE_FAILED: 'ONSIDE — NO GOOD',
});

/** How long the overlay holds, in ticks at 60/s. */
export const OVERLAY_TICKS = 96;

/**
 * Resolve a placekick. Always good, by rule.
 *
 * Takes the attempt kind and returns points plus the overlay to show. It takes no
 * ratings, no distance and no RNG ON PURPOSE -- adding any of them would be the first
 * step back towards a kicking minigame, and a later reader should see immediately that
 * the determinism is intended rather than unfinished.
 */
export function resolvePlacekick(kind) {
  if (kind === 'fg') {
    return { good: true, points: SCORE.FIELD_GOAL, overlay: KICK_OVERLAY.FIELD_GOAL };
  }
  return { good: true, points: SCORE.PAT, overlay: KICK_OVERLAY.PAT };
}

/* --------------------------------------------------------------- onside ---- */

/** A legal onside kick must travel ten yards before the kicking team may touch it. */
export const ONSIDE_LEGAL_YARDS = 10;

/** The meter's travel maps onto this bounce range, in yards. */
export const ONSIDE_MIN_YARDS = 4;
export const ONSIDE_MAX_YARDS = 22;

/**
 * Where the ball comes down, from where the player stopped the meter.
 * Pure function of the stop tick, so a test can assert an exact yard line.
 */
export function onsideBounceYards(stopTick) {
  const m = kickMeter(stopTick);
  return ONSIDE_MIN_YARDS + m * (ONSIDE_MAX_YARDS - ONSIDE_MIN_YARDS);
}

/**
 * Resolve an onside kick.
 *
 * Three ways this goes, and the middle one is the interesting one:
 *   - short of ten yards  -> illegal touch, receiving team takes it at the spot
 *   - at or just past ten -> a real contest, decided by how close to ten the ball landed
 *     and by the two clubs' recovery ratings
 *   - far past ten        -> the receiving team has time to set under it and it is theirs
 *
 * `kickRating` and `recvRating` are 0..99 (the sim passes the on-field units' own
 * ratings). `roll` is 0..1 from the seeded generator -- passed IN rather than drawn here,
 * so this stays a pure function and a test can pin every branch.
 */
export function resolveOnside(stopTick, kickRating, recvRating, roll) {
  const yards = onsideBounceYards(stopTick);

  if (yards < ONSIDE_LEGAL_YARDS) {
    return {
      recovered: false, legal: false, yards,
      overlay: KICK_OVERLAY.ONSIDE_FAILED,
      reason: 'short of ten yards — illegal touch',
    };
  }

  // Closeness to the legal minimum is the skill: the ideal onside kick is one that has
  // only just travelled far enough, because that is where the kicking team's players are.
  const over = yards - ONSIDE_LEGAL_YARDS;
  const placement = Math.max(0, 1 - over / 8);          // 1.0 at exactly ten, 0 by eighteen
  const skill = (kickRating - recvRating) / 200;         // +-0.495
  const chance = Math.max(0.02, Math.min(0.92, 0.14 + placement * 0.62 + skill));

  const recovered = roll < chance;
  return {
    recovered, legal: true, yards, chance,
    overlay: recovered ? KICK_OVERLAY.ONSIDE_RECOVERED : KICK_OVERLAY.ONSIDE_FAILED,
    reason: recovered ? 'kicking team recovered' : 'receiving team recovered',
  };
}

/** Where the ball is spotted after an onside attempt, in yards from the kicking spot. */
export function onsideSpot(result) {
  return result.legal ? result.yards : Math.max(0, result.yards);
}

export default {
  SCORE, KICK_OVERLAY, OVERLAY_TICKS,
  resolvePlacekick, resolveOnside, onsideBounceYards, onsideSpot,
  ONSIDE_LEGAL_YARDS, ONSIDE_MIN_YARDS, ONSIDE_MAX_YARDS, KICK_METER_TICKS,
};
