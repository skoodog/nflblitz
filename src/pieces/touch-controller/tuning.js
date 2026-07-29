// PIECE touch-controller — THE VOCABULARY AND THE NUMBERS.
//
// Everything a critic needs to argue with lives in this file: the zone ids, the action
// ids, the gesture thresholds, and — the reason this piece exists — the TIMING WINDOW
// TABLE with its early / perfect / late boundaries.
//
// TWO UNITS, AND ONLY TWO.
//   DISTANCES are in CSS PIXELS, because a thumb moves a physical distance and a
//     fraction-of-the-screen threshold is a different physical distance in portrait than
//     in landscape. That mistake is what put a control 55.3 mm outside its own 40 mm
//     budget in a previous round.
//   TIMES are in SIM TICKS (1/60 s exactly, on every device, at every present rate).
//     Never in frames. A frame is 16.7 ms at 60 Hz and 33.3 ms at 30 Hz, so any window
//     expressed in frames is a different window in the two shipping modes — which for a
//     game whose premise is "the timing is critical" is not a rounding error, it is the
//     whole game changing underneath the player.
//
// Nothing here reads a clock. Every function in this file is a pure function of its
// arguments, so `node` can assert the whole window table headlessly, with no browser.

/* ------------------------------------------------------------------- zones */

/**
 * ZONE ids. 1..4 are FROZEN BY THE HARNESS: `scripts/touch.mjs` builds its latency,
 * multitouch and reach tests from `window.__BLITZ_PERF__.zones` and names them
 * STICK / ACTION_A / ACTION_B / TURBO by integer. So the ids are the contract and the
 * names are ours: ACTION_A is the ACTION pad and ACTION_B is the PASS pad.
 *
 * RECEIVER is deliberately NOT in the zone table. See the long note in layout.js: a
 * receiver icon is anchored to a player on the field, not to a thumb, so gating it
 * against a thumb-reach budget would be gating the wrong thing. The passing model is
 * built so that a receiver icon is never the ONLY way to complete a throw.
 */
export const ZONE = Object.freeze({
  NONE: 0,
  STICK: 1,
  ACTION: 2,      // harness name: ACTION_A
  PASS: 3,        // harness name: ACTION_B
  TURBO: 4,
  RECEIVER: 5,    // transient, world-anchored, not a reach-budgeted control
});
export const ZONE_NAME = ['none', 'stick', 'action', 'pass', 'turbo', 'receiver'];

/* ---------------------------------------------------------------- gestures */

export const GESTURE = Object.freeze({ NONE: 0, TAP: 1, SWIPE: 2, HOLD: 3, DOUBLE: 4 });
export const GESTURE_NAME = ['none', 'tap', 'swipe', 'hold', 'double'];
export const DIR = Object.freeze({ NONE: 0, UP: 1, DOWN: 2, LEFT: 3, RIGHT: 4 });
export const DIR_NAME = ['none', 'up', 'down', 'left', 'right'];

/* -------------------------------------------------------------------- side */

/**
 * WHICH SIDE OF THE BALL THE PLAYER IS ON. The ACTION pad is a MODE, not a button: the
 * same thumb gesture means a different thing with the ball, at quarterback, and on
 * defence. That is not a shortcut — it is the only way six offensive actions and four
 * defensive ones fit inside one thumb's reach without a control the player has to look
 * at to find.
 *
 * `game-flow` / `play-sim` set this with setContext(). The controller never guesses it.
 */
export const SIDE = Object.freeze({ CARRY: 0, QB: 1, DEF: 2 });
export const SIDE_NAME = ['carry', 'qb', 'def'];

/* ----------------------------------------------------------------- actions */

export const ACT = Object.freeze({
  NONE: 0,
  // ---- offence, ball carrier
  JUKE_L: 1, JUKE_R: 2, SPIN: 3, STIFF_ARM: 4, HURDLE: 5, DIVE: 6, PROTECT: 7,
  // ---- offence, quarterback
  PASS: 8, PUMP: 9, THROW_AWAY: 10, TUCK: 11, SLIDE: 12, SNAP: 13,
  // ---- defence
  TACKLE: 14, HIT_STICK: 15, JUMP: 16, SWITCH_NEXT: 17, SWITCH_PREV: 18,
  SWITCH_NEAREST: 19, WRAP: 20,
  // ---- shared
  TURBO_ON: 21, TURBO_OFF: 22,
});
export const ACT_NAME = [
  'none',
  'juke-left', 'juke-right', 'spin', 'stiff-arm', 'hurdle', 'dive', 'protect',
  'pass', 'pump-fake', 'throw-away', 'tuck', 'slide', 'snap',
  'tackle', 'hit-stick', 'jump', 'switch-next', 'switch-prev', 'switch-nearest', 'wrap',
  'turbo-on', 'turbo-off',
];

/**
 * THE ACTION PAD MAP. Rows are SIDE, columns are the seven distinguishable inputs one
 * thumb can make on one pad without moving off it:
 *
 *   0 tap   1 double   2 hold   3 swipe-up   4 swipe-down   5 swipe-left   6 swipe-right
 *
 * Read it as a table, because that is what it is. A flat Int8Array so the frame path
 * indexes it with arithmetic and never walks an object.
 *
 * WHY SWIPE DIRECTION AND NOT MORE BUTTONS. A 40 mm thumb-reach disc on a 390 pt phone
 * has room for about three 9 mm targets with survivable gaps between them (see the reach
 * table in layout.js — the third one is already at 34.9 mm). Offence needs seven actions
 * and defence four. Directions off one pad cost no screen area, no reach, and — this is
 * the part that matters on a phone — no LOOKING: the thumb is already on the pad, so
 * the gesture is proprioceptive. Four extra buttons would each need to be found.
 */
export const PAD_TAP = 0, PAD_DOUBLE = 1, PAD_HOLD = 2;
export const PAD_UP = 3, PAD_DOWN = 4, PAD_LEFT = 5, PAD_RIGHT = 6;
export const PAD_INPUTS = 7;

export const PAD_MAP = new Int8Array([
  // CARRY:  tap        double    hold        up          down      left        right
  ACT.STIFF_ARM, ACT.SPIN, ACT.PROTECT, ACT.HURDLE, ACT.DIVE, ACT.JUKE_L, ACT.JUKE_R,
  // QB:     tap        double    hold        up              down       left        right
  ACT.TUCK, ACT.PUMP, ACT.SLIDE, ACT.THROW_AWAY, ACT.SLIDE, ACT.JUKE_L, ACT.JUKE_R,
  // DEF:    tap        double                 hold      up        down           left             right
  ACT.TACKLE, ACT.SWITCH_NEAREST, ACT.WRAP, ACT.JUMP, ACT.HIT_STICK, ACT.SWITCH_PREV, ACT.SWITCH_NEXT,
]);

/**
 * TURBO AS A MODIFIER. Holding TURBO while an ACTION resolves does not change WHICH
 * action fires — a player must never have to remember two maps — it raises its POWER,
 * and three of them have a named upgrade the sim is expected to honour:
 *
 *   STIFF_ARM + turbo -> TRUCK       lower the shoulder instead of extending the arm
 *   DIVE      + turbo -> LAYOUT      a full-extension dive-catch instead of a lunge
 *   TACKLE    + turbo -> LAUNCH      leave the feet; bigger hit, bigger miss
 *
 * The controller publishes `actionPower` alongside `action`; it does not model the
 * outcome, because outcomes are `play-sim`'s job and this piece is not going to grow a
 * shadow copy of the rules.
 */

/* --------------------------------------------------------------- thresholds */

export const TUNING = Object.freeze({
  /** Below this a pointer has not "moved". Foundation's floor is 8; 10 survives a thumb roll. */
  slopPx: 10,
  /** At or above this a release is a SWIPE rather than a TAP. */
  swipeMinPx: 28,
  /**
   * TAP / HOLD / DOUBLE, AND WHY THESE THREE NUMBERS ARE SMALLER THAN THE OBVIOUS ONES.
   *
   * The obvious values are the platform long-press conventions: 500 ms to hold, 350 ms
   * between the halves of a double. Those were the first values here and `touch.mjs`
   * caught them: at 844x390 with a 2x CPU throttle the run logged 289 clock catch-up
   * DROP EVENTS, and every dropped step is sim time the game never ran. A 620 ms press
   * then advances fewer than 30 ticks, the hold never fires, and the release comes back
   * a TAP — measured at 95.0% hold accuracy against a 98% gate, and 98.3% on tap because
   * a 500 ms gap likewise measured short and read as a DOUBLE.
   *
   * The lesson is not "make the loop faster" (that is a different piece's problem and it
   * will still happen on a real thermally-throttled phone). It is that a classification
   * threshold sitting at 80% of the stimulus it has to separate has no margin, and under
   * tick loss the measured interval only ever shrinks. So every threshold is placed with
   * roughly a 2:1 margin to the nearest thing it must NOT match:
   *
   *   holdTicks 20 (333 ms)       a real tap is 60-150 ms; a real hold is 500 ms+
   *   doubleGapTicks 18 (300 ms)  a real double's gap is ~180 ms; separate taps are 500 ms+
   *
   * Both are placed at the GEOMETRIC MEAN of the two intervals they separate, which is
   * the point of maximum tolerance to a multiplicative error — and tick loss is exactly a
   * multiplicative error, since it scales every measured interval by the same factor.
   * 300 ms sits 1.67x above a double's gap and 1.67x below two separate taps; 333 ms sits
   * about 2.2x above a tap and 1.9x below a hold. They are also better numbers on their
   * own merits: 333 ms is where an action game's hold should fire, not where an operating
   * system's context menu should.
   */
  /** Longer than this and a press is not a tap. Same boundary as holdTicks, named for
   * the other side of it, so there is exactly one number and not two that can disagree. */
  tapMaxTicks: 20,
  /** Stationary for this long -> HOLD, fired WHILE STILL DOWN (333 ms). */
  holdTicks: 20,
  /** Maximum gap between two taps for the second to be a DOUBLE (300 ms). */
  doubleGapTicks: 18,

  /** Full stick deflection at this distance from the anchor. */
  stickRadiusPx: 62,
  /** Dead zone as a fraction of the radius. */
  stickDeadPct: 0.16,
  /**
   * ANCHOR DRAG. Past this multiple of the radius the anchor is pulled along behind the
   * thumb, so a long drag never runs out of travel and never silently pins to a
   * direction the thumb has already left. Without it a floating stick becomes a fixed
   * stick the moment the thumb travels far enough, which is the failure this whole
   * design is here to avoid.
   */
  stickDragAt: 1.0,
  /** A stick release inside this many ticks with >= swipeMinPx travel is a FLICK. */
  flickMaxTicks: 14,

  /** Minimum drag on the PASS pad before a release counts as a bearing flick. */
  aimFlickPx: 26,
  /** Half-angle of the bearing gate, in radians. 40 degrees. */
  aimConeRad: 0.6981317,
  /** Dragging this far straight DOWN from the pass anchor is an explicit tuck/cancel. */
  aimTuckPx: 44,
  /** Receiver icon hit radius, CSS px. 60 px across = 11.0 mm — above the 9 mm minimum. */
  receiverRPx: 30,
  /** Pass power boundaries, in ticks held. < bullet = bullet, > lob = lob. */
  passBulletTicks: 10,
  passLobTicks: 24,

  /**
   * TURBO fuel is an INTEGER 0..1024, not a float, and it moves by integer amounts per
   * tick. A float accumulator would make the meter's value depend on the exact order of
   * additions, and `hash()` would stop being a determinism instrument.
   *   burn 11/tick -> 93 ticks -> 1.55 s from full
   *   regen 4/tick -> 256 ticks -> 4.27 s to full
   * Emptying it fully locks TURBO out for 45 ticks (750 ms) — the overheat.
   */
  fuelMax: 1024,
  fuelBurn: 11,
  fuelRegen: 4,
  overheatTicks: 45,

  /** Ticks the grade flash stays lit on the ACTION pad after a graded action. */
  flashTicks: 20,
});

/* =========================================================== TIMING WINDOWS */

/**
 * THE POINT OF THIS PIECE.
 *
 * An OPPORTUNITY is armed by the sim with a PEAK TICK — the tick at which the action is
 * perfectly timed (the defender arrives, the ball reaches the catch point). The player's
 * press is graded on `pressTick - peakTick`, where `pressTick` is the tick the FOUNDATION
 * assigned from the EVENT'S OWN TIMESTAMP, never the tick of the frame that happened to
 * drain it.
 *
 * That distinction is the whole reason a 30 Hz mode is honest here. At 30 Hz a frame
 * runs sim ticks T and T+1; an event stamped in the first half of the 33.3 ms window
 * lands on T and one stamped in the second half lands on T+1. So a 100 ms perfect band
 * is still six ticks wide at 30 Hz, exactly as it is at 60. What 30 Hz costs the player
 * is DISPLAY latency; it does not cost them TIMING RESOLUTION, and only one of those two
 * was ever traded away.
 *
 * WHY THE PERFECT BANDS ARE NOT CENTRED ON THE PEAK.
 *
 * A player reacting to something they SAW is inherently late by the display latency —
 * measured on this box at p50 1.6 frames input->render-dispatch, plus one more frame for
 * a real panel (README ASSUMPTION C). At 30 Hz that is ~85 ms of "the world is already
 * ahead of what you are looking at". So:
 *
 *   REACTIVE actions (DIVE_CATCH, HIT_STICK) have their perfect band biased EARLY,
 *     -67..+33 ms and -50..+33 ms, so a player who feels on time IS on time.
 *   ANTICIPATORY actions (JUKE, SPIN) are symmetric, -50..+50 ms, because the player is
 *     acting on their own plan and not on a pixel that just changed.
 *   STIFF_ARM is biased LATE, -33..+67 ms, because the arm goes out INTO contact: the
 *     natural error there is going early, and rewarding early would teach mashing.
 *
 * That is three different biases for three different reasons, and it is the single most
 * arguable set of numbers in this piece. It is stated here rather than buried so it can
 * be argued with.
 *
 * Columns, all in TICKS relative to the peak:
 *   open  perfectLo  perfectHi  close
 * A press before `open` or after `close` still FIRES — you can always juke — it is just
 * ungraded and gets no bonus. A game that eats inputs to protect a window feels broken.
 */
export const TW = Object.freeze({
  NONE: 0, JUKE: 1, STIFF_ARM: 2, DIVE_CATCH: 3, HIT_STICK: 4, HURDLE: 5, SPIN: 6,
});
export const TW_NAME = ['none', 'juke', 'stiff-arm', 'dive-catch', 'hit-stick', 'hurdle', 'spin'];
export const TW_COUNT = 7;

/** 4 columns per row, indexed TW * 4. */
export const WINDOW = new Int8Array([
  0, 0, 0, 0,          // NONE
  -9, -3, 3, 9,        // JUKE        -150 .. [-50 .. +50] .. +150 ms
  -7, -2, 4, 10,       // STIFF_ARM   -117 .. [-33 .. +67] .. +167 ms
  -12, -4, 2, 8,       // DIVE_CATCH  -200 .. [-67 .. +33] .. +133 ms
  -8, -3, 2, 8,        // HIT_STICK   -133 .. [-50 .. +33] .. +133 ms
  -10, -4, 3, 8,       // HURDLE      -167 .. [-67 .. +50] .. +133 ms
  -8, -3, 3, 9,        // SPIN        -133 .. [-50 .. +50] .. +150 ms
]);

/** Which timed window, if any, an ACT is judged against. Indexed by ACT id. */
export const ACT_WINDOW = new Int8Array(ACT_NAME.length);
ACT_WINDOW[ACT.JUKE_L] = TW.JUKE;
ACT_WINDOW[ACT.JUKE_R] = TW.JUKE;
ACT_WINDOW[ACT.STIFF_ARM] = TW.STIFF_ARM;
ACT_WINDOW[ACT.DIVE] = TW.DIVE_CATCH;
ACT_WINDOW[ACT.HIT_STICK] = TW.HIT_STICK;
ACT_WINDOW[ACT.HURDLE] = TW.HURDLE;
ACT_WINDOW[ACT.SPIN] = TW.SPIN;

export const GRADE = Object.freeze({ UNARMED: 0, EARLY: 1, PERFECT: 2, LATE: 3, MISSED: 4 });
export const GRADE_NAME = ['unarmed', 'early', 'perfect', 'late', 'missed'];

/**
 * OUTCOMES. The controller does not simulate them — `play-sim` does — but a window with
 * no stated consequence is not a window, it is a colour. This table is the contract the
 * sim is expected to honour, and it is exported so a critic can read it in one place.
 *
 * Fields per (window, grade): a short id the sim switches on, and the intent in words.
 */
export const OUTCOME = Object.freeze({
  juke: {
    early: 'mirrored — the defender reads it and stays square; no speed penalty, you simply did not beat him',
    perfect: 'ankles — defender loses his feet for 27 ticks, carrier gets a 12-tick burst',
    late: 'stumble — 18 ticks of reduced control and reduced turn rate; the tackle usually lands',
  },
  'stiff-arm': {
    early: 'whiff — the arm is extended into air and the carrier is unprotected for 8 ticks',
    perfect: 'pancake — defender is put down, carrier keeps full speed, style bonus',
    late: 'grabbed — the defender is inside the arm; wrapped up, tackle unless a blocker arrives',
  },
  'dive-catch': {
    early: 'short — hands close before the ball arrives; incomplete',
    perfect: 'full extension — secure catch, both hands, possession on landing',
    late: 'tipped — ball goes through the hands and stays live; interception risk',
  },
  'hit-stick': {
    early: 'whiff — you leave your feet early and are out of the play for 20 ticks',
    perfect: 'de-cleater — ball carrier is put on his back, fumble check',
    late: 'glancing — degrades to a wrap tackle: he goes down, but no big hit and no fumble',
  },
  hurdle: {
    early: 'clears the tackler but lands flat-footed; heavy speed loss on the far side',
    perfect: 'clean hurdle, momentum kept, short burst out of the landing',
    late: 'trailing leg is caught; tripped, carrier goes down',
  },
  spin: {
    early: 'spins into traffic — you turn your back before the lane opens',
    perfect: 'shed — 180 out of the contact with the ball tucked away from the defender',
    late: 'spun into the hit; highest fumble risk of any late grade in the game',
  },
});

/* -------------------------------------------------------------- pure grading */

/** windowFor(tw) -> the four boundaries, written into `out` (length >= 4). No allocation. */
export function windowFor(tw, out) {
  const b = (tw | 0) * 4;
  out[0] = WINDOW[b]; out[1] = WINDOW[b + 1]; out[2] = WINDOW[b + 2]; out[3] = WINDOW[b + 3];
  return out;
}

/**
 * grade(tw, pressTick, peakTick) -> GRADE. THE function. Pure, integer-only, no clock,
 * no allocation, identical at 60 Hz and 30 Hz because both arguments are sim ticks.
 */
export function grade(tw, pressTick, peakTick) {
  const t = (tw | 0) * 4;
  if (t === 0) return GRADE.UNARMED;
  const d = (pressTick | 0) - (peakTick | 0);
  if (d < WINDOW[t] || d > WINDOW[t + 3]) return GRADE.MISSED;
  if (d < WINDOW[t + 1]) return GRADE.EARLY;
  if (d > WINDOW[t + 2]) return GRADE.LATE;
  return GRADE.PERFECT;
}

/** Milliseconds for a tick offset — reporting only, never used to judge anything. */
export function ticksToMs(t) { return t * (1000 / 60); }

export default {
  ZONE, ZONE_NAME, GESTURE, GESTURE_NAME, DIR, DIR_NAME, SIDE, SIDE_NAME,
  ACT, ACT_NAME, PAD_MAP, PAD_INPUTS, TUNING, TW, TW_NAME, WINDOW, ACT_WINDOW,
  GRADE, GRADE_NAME, OUTCOME, windowFor, grade, ticksToMs,
};
