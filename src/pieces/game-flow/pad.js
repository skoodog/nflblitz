// PIECE game-flow — THE CONTROL SCHEME, and its Xbox bindings.
//
// The scheme is inherited, not invented. Arcade-era football of this kind ran on a stick
// and THREE buttons — TURBO, JUMP, PASS/TACKLE — and the N64 pad added the four C
// buttons, which is what receiver selection lived on. Everything below is that scheme
// carried onto a standard Xbox pad, with the heritage binding recorded next to each row
// so the lineage is auditable rather than asserted.
//
// WHY THE CONTROL SCHEME LIVES IN game-flow AND NOT IN AN INPUT PIECE.
// It is phase-dependent. The same physical button is a pass on offence, a dive tackle on
// defence, and an onside-kick declaration on a kickoff — and only game-flow knows which
// phase the game is in. touch-controller owns the touch bindings for the same actions;
// both devices resolve to the ONE action vocabulary in touch-controller/tuning.js (ACT),
// so nothing downstream ever asks which device produced an action.
//
// THE ONE GENUINELY NEW MAPPING DECISION, and it falls out of the format: seven-on-seven
// puts exactly THREE eligible receivers on the field. The N64 scheme selected receivers
// with C-left / C-up / C-right — three buttons for three targets. An Xbox pad has exactly
// three face buttons left over once A is the action button. So X / Y / B become REC1 /
// REC2 / REC3 directly, in field order, and receiver select needs no radial menu, no
// modifier and no look-down. That is a one-to-one inheritance, not an analogy.

import { ACT } from '../touch-controller/tuning.js';

/** Game phases the control scheme switches on. game-flow owns the transitions. */
export const PHASE = Object.freeze({
  PLAYCALL: 0,
  PRESNAP: 1,
  OFFENSE_POCKET: 2,   // ball in the passer's hands
  OFFENSE_CARRY: 3,    // ball carrier running
  DEFENSE: 4,
  KICKOFF: 5,
  PAT: 6,              // point after, and field goals
});
export const PHASE_NAME = [
  'playcall', 'pre-snap', 'offense-pocket', 'offense-carry', 'defense', 'kickoff', 'pat',
];

/** Xbox inputs, as a flat enum so the frame path indexes with arithmetic. */
export const BTN = Object.freeze({
  A: 0, B: 1, X: 2, Y: 3,
  LB: 4, RB: 5, LT: 6, RT: 7,
  DPAD_U: 8, DPAD_D: 9, DPAD_L: 10, DPAD_R: 11,
  LS_CLICK: 12, RS_CLICK: 13, START: 14, BACK: 15,
});
export const BTN_NAME = [
  'A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT',
  'D-Up', 'D-Down', 'D-Left', 'D-Right', 'LS', 'RS', 'Start', 'Back',
];
export const BTN_COUNT = 16;

// The heritage column is documentation with teeth: gametest asserts that every action
// reachable on touch is also reachable on the pad, so a scheme cannot drift on one device.
//
//   phase                button      action              inherited from
const BINDINGS = [
  // ---- pocket: the passer has it -------------------------------------------------
  [PHASE.OFFENSE_POCKET, BTN.X,      ACT.PASS,           'C-left  — receiver 1'],
  [PHASE.OFFENSE_POCKET, BTN.Y,      ACT.PASS,           'C-up    — receiver 2'],
  [PHASE.OFFENSE_POCKET, BTN.B,      ACT.PASS,           'C-right — receiver 3'],
  [PHASE.OFFENSE_POCKET, BTN.A,      ACT.TUCK,           'PASS button, no target held'],
  [PHASE.OFFENSE_POCKET, BTN.LB,     ACT.PUMP,           'double-tap a C button'],
  [PHASE.OFFENSE_POCKET, BTN.RB,     ACT.THROW_AWAY,     'JUMP while sacked'],
  [PHASE.OFFENSE_POCKET, BTN.RT,     ACT.TURBO_ON,       'TURBO'],
  [PHASE.OFFENSE_POCKET, BTN.LT,     ACT.SLIDE,          'no heritage — added for the pad'],

  // ---- carrying ------------------------------------------------------------------
  [PHASE.OFFENSE_CARRY,  BTN.A,      ACT.STIFF_ARM,      'PASS/TACKLE button as carrier'],
  [PHASE.OFFENSE_CARRY,  BTN.B,      ACT.SPIN,           'JUMP + direction'],
  [PHASE.OFFENSE_CARRY,  BTN.X,      ACT.JUKE_L,         'C-left'],
  [PHASE.OFFENSE_CARRY,  BTN.Y,      ACT.HURDLE,         'JUMP'],
  [PHASE.OFFENSE_CARRY,  BTN.RB,     ACT.JUKE_R,         'C-right'],
  [PHASE.OFFENSE_CARRY,  BTN.LB,     ACT.PROTECT,        'no heritage — added for the pad'],
  [PHASE.OFFENSE_CARRY,  BTN.LT,     ACT.DIVE,           'JUMP forward'],
  [PHASE.OFFENSE_CARRY,  BTN.RT,     ACT.TURBO_ON,       'TURBO'],

  // ---- defence -------------------------------------------------------------------
  [PHASE.DEFENSE,        BTN.A,      ACT.TACKLE,         'PASS/TACKLE button on defence'],
  [PHASE.DEFENSE,        BTN.B,      ACT.HIT_STICK,      'TURBO + TACKLE together'],
  [PHASE.DEFENSE,        BTN.Y,      ACT.JUMP,           'JUMP'],
  [PHASE.DEFENSE,        BTN.X,      ACT.SWITCH_NEAREST, 'C-button cycle'],
  [PHASE.DEFENSE,        BTN.RB,     ACT.SWITCH_NEXT,    'C-right cycle'],
  [PHASE.DEFENSE,        BTN.LB,     ACT.SWITCH_PREV,    'C-left cycle'],
  [PHASE.DEFENSE,        BTN.LT,     ACT.WRAP,           'no heritage — added for the pad'],
  [PHASE.DEFENSE,        BTN.RT,     ACT.TURBO_ON,       'TURBO'],

  // ---- pre-snap ------------------------------------------------------------------
  [PHASE.PRESNAP,        BTN.A,      ACT.SNAP,           'PASS button snaps'],
  [PHASE.PRESNAP,        BTN.RT,     ACT.TURBO_ON,       'TURBO'],
];

/** phase * BTN_COUNT + button -> ACT. Built once, read with arithmetic. */
const TABLE = new Int8Array(PHASE_NAME.length * BTN_COUNT);
/** Which receiver a pocket button targets, 0 = not a receiver button. */
const TARGET = new Int8Array(PHASE_NAME.length * BTN_COUNT);
for (const [ph, b, act] of BINDINGS) TABLE[ph * BTN_COUNT + b] = act;
TARGET[PHASE.OFFENSE_POCKET * BTN_COUNT + BTN.X] = 1;
TARGET[PHASE.OFFENSE_POCKET * BTN_COUNT + BTN.Y] = 2;
TARGET[PHASE.OFFENSE_POCKET * BTN_COUNT + BTN.B] = 3;

/**
 * Resolve one button press in one phase.
 * Returns { act, target } — target is 1..3 for a receiver, 0 otherwise. Never allocates
 * a new object shape, so the frame path can hold one and overwrite it.
 */
export function padAction(phase, button, out) {
  const o = out || { act: ACT.NONE, target: 0 };
  if (phase < 0 || phase >= PHASE_NAME.length || button < 0 || button >= BTN_COUNT) {
    o.act = ACT.NONE; o.target = 0;
    return o;
  }
  const i = phase * BTN_COUNT + button;
  o.act = TABLE[i];
  o.target = TARGET[i];
  return o;
}

/** Every (button, action, heritage) row for a phase — drives the on-screen control card. */
export function bindingsFor(phase) {
  return BINDINGS.filter((r) => r[0] === phase)
    .map(([, b, act, from]) => ({ button: BTN_NAME[b], act, from }));
}

/* ------------------------------------------------------------- the kickoff */
/**
 * THE ONSIDE KICK, which is the one place the pad carries a control the touch scheme
 * cannot express as cleanly, and the one kick whose outcome is NOT predetermined.
 *
 * Declaration is a HOLD, not a tap, and it is deliberately a trigger rather than a face
 * button: an onside kick is a committed decision that the receiving team can see coming
 * in a real game, so the input wants a dwell rather than a reflex. Hold LT through the
 * kick meter and the kick is onside; anything else is a normal kickoff.
 *
 * The meter itself is a two-stop timing bar, which is the arcade convention: first press
 * starts it, second press stops it. On a normal kickoff the stop sets distance and hang
 * time. On an onside kick it sets the BOUNCE — how far the ball travels before it is
 * live — and the recovery contest is resolved from how close that lands to the legal
 * ten yards, plus the two clubs' ratings.
 */
export const ONSIDE_HOLD_BUTTON = BTN.LT;
export const KICK_METER_BUTTON = BTN.A;

/** Ticks at 60/s for one sweep of the kick meter. Two sweeps available, then it auto-fires. */
export const KICK_METER_TICKS = 96;

/**
 * Where the meter sits at `tick` after it started: 0..1..0 triangle, so the perfect stop
 * is at the top and both approaches to it are symmetric. Pure function of ticks.
 */
export function kickMeter(tick) {
  if (tick <= 0) return 0;
  const t = (tick % KICK_METER_TICKS) / KICK_METER_TICKS;
  return t <= 0.5 ? t * 2 : (1 - t) * 2;
}
