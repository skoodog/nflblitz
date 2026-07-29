// PIECE touch-controller — THE CONTROL SCHEME.
//
// Registers into REG.controller. The foundation's `touch.js` owns the raw, timestamped,
// capture-safe pointer bus and knows nothing about football; THIS piece owns zones,
// gestures, dead zones, curves, timing windows and feel, and it reads `touch.pointers`
// and `touch.events` and nothing else.
//
// ============================ THE SCHEME, IN FULL ============================
//
// LEFT THUMB — one control, never looked at.
//   THE POCKET. A 124 x 236 CSS px capture pad flush against the lower-left corner — the
//   drawn well's exact diameter, so every pixel the player can see is live and none of
//   the pad is a promise the artwork does not make. The stick's anchor is wherever the
//   thumb LANDS inside it, and the anchor DRAGS along behind a thumb that travels past a
//   full radius, so travel never runs out and a reversal costs one radius from where the
//   thumb IS. Analogue magnitude with a 16% dead zone, plus an 8-way quantisation for a
//   sim that wants a facing.
//   A short, fast HORIZONTAL FLICK of the stick — down, throw, lift, inside 14 ticks —
//   is a juke. That is the oldest idiom in arcade football and it costs no screen area.
//
// RIGHT THUMB — three controls: a two-high COLUMN against the right edge, plus one
// inboard. Nearest-first by how often they are pressed under pressure, and no two of them
// closer than 16 CSS px at any viewport (see the width-budget note in layout.js).
//   TURBO (13.5 mm)  the blue lozenge from the concept art. Hold to burn; the meter IS
//                    the button, so the thing you read is under the thumb reading it.
//                    Also the POWER MODIFIER: turbo + stiff-arm is a truck, turbo + dive
//                    is a layout, turbo + tackle is a launch. One map, not two.
//   ACTION (29.2 mm) the gesture pad, directly above TURBO. Seven meanings off one thumb
//                    position:
//                       tap  double  hold  swipe-up  swipe-down  swipe-left  swipe-right
//                    and the meanings change with the side of the ball:
//                       CARRY  stiff-arm  spin   protect  hurdle  dive       juke  juke
//                       QB     tuck       pump   slide    away    slide      juke  juke
//                       DEF    tackle     swap   wrap     jump    hit-stick  swap  swap
//                    with the four swipe meanings BAKED INTO THE ARTWORK as a legend
//                    ring, so it is a control you read once rather than a control you
//                    have to be told about.
//   PASS  (35.5 mm)  inboard of the column, press to raise the receiver icons, release to
//                    throw. See the receiver-selection note in resolve.js for the three
//                    commit paths and why all three exist.
//
// WHY GESTURES ON A PAD AND NOT MORE BUTTONS. A 40 mm thumb-reach disc on a 390 pt phone
// fits about three 9 mm targets with survivable gaps; the third one in this layout is
// already at 35.5 mm of a 40 mm budget. Offence needs seven actions and defence four.
// Directions off a pad the thumb is already touching cost no area, no reach, and — the
// part that matters on a phone — no LOOKING. Four more buttons would each have to be
// found by eye, every time, during a play.
//
// WHAT MAKES IT FAIR. Every action is JUDGED on the tick the finger touched the glass —
// the tick foundation derived from the event's own timestamp — and never on the frame
// that drained it. Three of the four named windows (juke, dive-catch, hit-stick) are
// swipes, which COMMIT mid-drag the instant the direction is unambiguous, so they do not
// wait for the lift either. See the header of resolve.js.
//
// =============================================================================

import { registerController } from '../../foundation/registry.js';
import {
  ZONE, ZONE_NAME, GESTURE, GESTURE_NAME, DIR, DIR_NAME, SIDE, SIDE_NAME,
  ACT, ACT_NAME, TUNING, TW, TW_NAME, WINDOW, ACT_WINDOW,
  GRADE, GRADE_NAME, OUTCOME, PAD_MAP, PAD_INPUTS, windowFor, grade, ticksToMs,
} from './tuning.js';
import {
  ZONE_RECTS, ZONE_HOMES, ZONE_ART, REACH_PX, MM_PER_CSSPX, FIT, FIT_REF_PX,
  layoutZones, zoneAt, reachReport, minZoneGap, zonePairGaps,
} from './layout.js';
import { createState, MAX_TARGETS } from './state.js';
import {
  resolve, setSurface, setContext, setTargets, hash,
  arm, clearArmed, armedRemaining, armedSpan, armedInfo,
} from './resolve.js';
import { createSprites } from './sprites.js';
import { draw as drawController } from './draw.js';

/** One sprite bank for the process. Baked on first draw, re-baked only on a dpr change. */
const SP = createSprites();

const impl = {
  piece: 'touch-controller',

  /* ---- vocabulary the harness, the sim and the critic read ---------------- */
  ZONE, ZONE_NAME, GESTURE, GESTURE_NAME, DIR, DIR_NAME, SIDE, SIDE_NAME,
  ACT, ACT_NAME, TUNING, TW, TW_NAME, WINDOW, ACT_WINDOW,
  GRADE, GRADE_NAME, OUTCOME, PAD_MAP, PAD_INPUTS,
  ZONE_RECTS, ZONE_HOMES, ZONE_ART, REACH_PX, MM_PER_CSSPX, MAX_TARGETS,
  FIT, FIT_REF_PX,

  /* ---- lifecycle ---------------------------------------------------------- */
  create: createState,
  setSurface,
  layoutZones,
  zoneAt,

  /* ---- the per-tick resolver (called from inside the fixed-step loop) ------ */
  resolve,
  hash,

  /* ---- the sim's side of the contract ------------------------------------- */
  /** Which side of the ball the player is on: SIDE.CARRY | SIDE.QB | SIDE.DEF. */
  setContext,
  /** Publish the eligible receivers after writing st.tgtX/tgtY/tgtId/tgtOpen/tgtPrimary. */
  setTargets,
  /** Open a timed opportunity peaking at `peakTick`. Idempotent per (window, peak). */
  arm,
  clearArmed,
  armedRemaining,
  armedSpan,
  armedInfo,

  /* ---- pure window model, importable under plain node --------------------- */
  windowFor,
  grade,
  ticksToMs,

  /* ---- the frame path ----------------------------------------------------- */
  /**
   * `main.js` stamps the live controller state onto the REGISTERED object as `_draw`
   * immediately before the overlay draws, so the state comes off `this`. It is read
   * defensively because `registerController` merges this object into a NEW object and a
   * closure over `impl` is therefore not the receiver the runtime writes to.
   */
  draw(c2d, t, ui) {
    const st = (this && this._draw) || impl._draw || null;
    drawController(c2d, t, ui, st, SP);
  },

  /**
   * THE CONTROLLER NEVER SCALES WITH QUALITY, and that is a decision rather than an
   * oversight. Feel is not a dependent variable: a player on a floor-tier device is
   * playing the same game with the same windows, and dropping the timing arc or the
   * grade flash there would remove the only thing that teaches those windows from the
   * device whose owner most needs it. The layer costs a handful of blits; there is
   * nothing here worth reclaiming.
   */
  applyRung() { },

  /* ---- reporting (harness + self-test; never on the frame path) ----------- */
  reachTable: reachReport,
  minZoneGap,
  zonePairGaps,

  /**
   * windowTable() -> every timing window in ticks AND milliseconds, with its early /
   * perfect / late outcomes. Built on demand, never during play.
   */
  windowTable() {
    const out = [];
    const b = new Int8Array(4);
    for (let tw = 1; tw < TW_NAME.length; tw++) {
      windowFor(tw, b);
      out.push({
        window: TW_NAME[tw],
        openTicks: b[0], perfectLoTicks: b[1], perfectHiTicks: b[2], closeTicks: b[3],
        openMs: ticksToMs(b[0]), perfectLoMs: ticksToMs(b[1]),
        perfectHiMs: ticksToMs(b[2]), closeMs: ticksToMs(b[3]),
        spanTicks: b[3] - b[0], perfectTicks: b[2] - b[1] + 1,
        outcome: OUTCOME[TW_NAME[tw]] || null,
      });
    }
    return out;
  },
};

/**
 * `registerController` MERGES this object into a new one, so the thing the runtime
 * actually calls — and the thing `main.js` stamps `_draw` onto — is the return value,
 * not `impl`. Publishing that merged object is what lets a harness read the LIVE
 * controller state and drive `arm()` / `setTargets()` / `setContext()` from outside,
 * which is how the capture scripts in shots/touch-controller/ pose the controller
 * without a `play-sim` to do it for them. Diagnostics only: nothing on the frame path
 * reads it, and it costs one property assignment at module load.
 */
/**
 * `?ctrl=fallback` SKIPS THE REGISTRATION, so the foundation's reference controller keeps
 * the slot in the SAME BUILD. That exists for exactly one reason: the latency harness
 * reports a single number per event, and the only honest way to say "that tail is not
 * ours" is to measure the identical tail with this piece switched out, in the same
 * browser, on the same box, minutes apart. A baseline you cannot re-run is an anecdote.
 * It reads `location.search` directly rather than `params.js` because it has to decide at
 * module-import time, before anything else has parsed anything.
 */
function disabledByUrl() {
  try {
    return typeof location !== 'undefined'
      && new URLSearchParams(location.search).get('ctrl') === 'fallback';
  } catch (e) { return false; }
}

if (!disabledByUrl()) {
  const registered = registerController(impl);
  if (typeof window !== 'undefined') window.__BLITZ_CTRL__ = registered;
}

export default impl;
