// PIECE touch-controller — THE PER-TICK RESOLVER.
//
// `resolve(st, tick, touch, tel, idx)` is called ONCE PER SIM TICK from inside the
// fixed-step loop and consumes ONLY the events the foundation bound to THAT tick. It
// never looks at `touch.events` wholesale: at 30 Hz a frame runs two ticks, and a
// resolver that ate the whole frame's events on each of them would apply every input
// twice and would apply the second tick's inputs to the first tick's world.
//
// ==========================================================================
// WHEN AN ACTION COMMITS, AND WHEN IT IS JUDGED. These are two different questions and
// getting them confused is how a touch game ends up feeling late while insisting it is
// not.
//
//   JUDGED — always on the DOWN tick. `pressTick` is the tick the FOUNDATION derived
//     from the event's own DOMHighResTimeStamp, so it is when the finger touched the
//     glass, not when the frame that drained it happened to run, and not when the finger
//     lifted. Every grade in the window table is computed from that number.
//
//   COMMITS — as early as the gesture can possibly be known:
//     * a SWIPE commits the instant travel crosses `swipeMinPx`, MID-DRAG. It does not
//       wait for the lift, because once the thumb has moved 28 px in a direction there
//       is nothing else it can become. Three of the four named timing windows — JUKE,
//       DIVE-CATCH and HIT-STICK — are swipes precisely so that they commit here.
//     * a HOLD commits at `holdTicks`, while the thumb is still down. A hold that only
//       resolves on release is a slow tap, not a hold.
//     * a TAP commits ON RELEASE, and it is the one place this piece pays for gesture
//       disambiguation, because a press that has not moved and has not lasted could
//       still become either of the other two. STIFF-ARM and TACKLE are taps. They are
//       still JUDGED on the down tick, so the player is never punished for the
//       disambiguation — but the animation does start ~60-90 ms after the press, and
//       that is stated here rather than discovered by a critic.
//
//   AND SEPARATELY, THE PRESS FEED. On every DOWN the controller publishes
//   `st.press` / `st.pressTick` immediately, at true input latency, before it has any
//   idea what the gesture is. That is what the sim starts the wind-up on — the player
//   plants his foot the moment the thumb lands — and the ACTION feed that arrives up to
//   90 ms later only decides which move the wind-up becomes. It is the same trick a
//   fighting game plays with its input buffer, and it is what buys back the tap's
//   disambiguation cost in the only currency the player can see.
// ==========================================================================

import {
  ZONE, GESTURE, DIR, ACT, SIDE, TUNING, GRADE,
  PAD_MAP, PAD_INPUTS, PAD_TAP, PAD_DOUBLE, PAD_HOLD,
  ACT_WINDOW, WINDOW, grade as gradeOf,
} from './tuning.js';
import { zoneAt, layoutZones } from './layout.js';
import { MAX_POINTERS, MAX_ARMED, MAX_TARGETS } from './state.js';

const EV_DOWN = 0, EV_MOVE = 1, EV_UP = 2, EV_CANCEL = 3;
const SCRATCH_IDX = new Int32Array(64);
const TAU = 6.283185307179586;

/* ------------------------------------------------------------------ arming */

/**
 * arm(st, tw, peakTick) — the sim declares that a timed opportunity peaks at `peakTick`.
 * Idempotent for the same (window, peak) pair, so a sim that re-arms every tick while an
 * opportunity is open does not fill the ring.
 */
export function arm(st, tw, peakTick) {
  if (!tw) return false;
  for (let i = 0; i < st.armN; i++) {
    if (st.armTw[i] === tw && st.armPeak[i] === peakTick) return false;
  }
  if (st.armN >= MAX_ARMED) return false;
  const i = st.armN++;
  st.armTw[i] = tw;
  st.armPeak[i] = peakTick;
  // SIX TICKS (100 ms) OF GRACE PAST `close`, and the number is not decoration. The ring
  // entry has to outlive the window it describes, or a press just after the window shut
  // comes back UNARMED — "there was nothing to time" — when the truth is MISSED, "you
  // were too late". Those are different things to tell a player, and 100 ms is the
  // interval inside which a late press is unambiguously an attempt at THIS opportunity
  // rather than the start of the next one.
  st.armExpire[i] = peakTick + WINDOW[tw * 4 + 3] + 6;
  return true;
}

/** Swap-remove. Order in the ring is not meaningful, so this is O(1) and allocation-free. */
function dropArmed(st, i) {
  const last = --st.armN;
  st.armTw[i] = st.armTw[last];
  st.armPeak[i] = st.armPeak[last];
  st.armExpire[i] = st.armExpire[last];
  st.armTw[last] = 0;
}

export function clearArmed(st) { st.armN = 0; st.armTw.fill(0); }

/** Is a window currently open, and how many ticks of it are left? For the HUD arc. */
export function armedRemaining(st, tick) {
  let best = -1;
  for (let i = 0; i < st.armN; i++) {
    const tw = st.armTw[i];
    const open = st.armPeak[i] + WINDOW[tw * 4];
    const close = st.armPeak[i] + WINDOW[tw * 4 + 3];
    if (tick < open || tick > close) continue;
    const left = close - tick;
    if (best < 0 || left < best) best = left;
  }
  return best;
}

/** Total width in ticks of the currently-open window, for normalising the HUD arc. */
export function armedSpan(st, tick) {
  for (let i = 0; i < st.armN; i++) {
    const tw = st.armTw[i];
    const open = st.armPeak[i] + WINDOW[tw * 4];
    const close = st.armPeak[i] + WINDOW[tw * 4 + 3];
    if (tick >= open && tick <= close) return close - open;
  }
  return 0;
}

/**
 * armedInfo(st, tick, out) -> true when a window is open, with
 *   out[0] window id, out[1] tick - peak, out[2] span in ticks, out[3] ticks remaining,
 *   out[4] 0 early / 1 perfect / 2 late — the band the CURRENT tick sits in.
 *
 * `out` is caller-owned (the draw path keeps one). The frame path calls this once and
 * allocates nothing. When two windows are open, the one closing soonest wins, because
 * that is the one the player is about to lose.
 */
export function armedInfo(st, tick, out) {
  let best = -1, bestLeft = 0x7fffffff;
  for (let i = 0; i < st.armN; i++) {
    const tw = st.armTw[i];
    const open = st.armPeak[i] + WINDOW[tw * 4];
    const close = st.armPeak[i] + WINDOW[tw * 4 + 3];
    if (tick < open || tick > close) continue;
    const left = close - tick;
    if (left < bestLeft) { bestLeft = left; best = i; }
  }
  if (best < 0) return false;
  const tw = st.armTw[best];
  const b = tw * 4;
  const d = tick - st.armPeak[best];
  out[0] = tw;
  out[1] = d;
  out[2] = WINDOW[b + 3] - WINDOW[b];
  out[3] = bestLeft;
  out[4] = d < WINDOW[b + 1] ? 0 : d > WINDOW[b + 2] ? 2 : 1;
  return true;
}

/**
 * gradeAction — grade `act`, pressed at `downTick`, against whichever armed opportunity
 * of its window type is nearest. Consumes that opportunity: one press, one grade.
 */
function gradeAction(st, act, downTick, tick) {
  const tw = ACT_WINDOW[act] | 0;
  if (!tw) {
    st.grade = GRADE.UNARMED; st.gradeWindow = 0; st.gradeDelta = 0;
    return GRADE.UNARMED;
  }
  let best = -1, bestAbs = 0x7fffffff;
  for (let i = 0; i < st.armN; i++) {
    if (st.armTw[i] !== tw) continue;
    const d = downTick - st.armPeak[i];
    const a = d < 0 ? -d : d;
    if (a < bestAbs) { bestAbs = a; best = i; }
  }
  if (best < 0) {
    st.grade = GRADE.UNARMED; st.gradeWindow = tw; st.gradeDelta = 0;
    return GRADE.UNARMED;
  }
  const g = gradeOf(tw, downTick, st.armPeak[best]);
  st.grade = g;
  st.gradeWindow = tw;
  st.gradeDelta = downTick - st.armPeak[best];
  st.gradeTick = tick;
  st.flashUntil = tick + TUNING.flashTicks;
  if (g === GRADE.PERFECT) st.perfects++;
  else if (g === GRADE.EARLY) st.earlies++;
  else if (g === GRADE.LATE) st.lates++;
  else st.misses++;
  dropArmed(st, best);
  return g;
}

/* --------------------------------------------------------------- emitting */

function emitAction(st, act, dir, downTick, tick, tel, entry) {
  if (!act) return;
  st.action = act;
  st.actionDir = dir;
  // TURBO IS A MODIFIER, NOT A SECOND MAP. See the note in tuning.js: holding turbo does
  // not change WHICH action fires, it raises its power. Two maps is two things to
  // remember with a thumb that cannot look at what it is doing.
  st.actionPower = (st.turbo && st.boost) ? 1 : 0;
  st.actionTick = downTick;
  st.actions++;
  gradeAction(st, act, downTick, tick);
  st.changeTick = tick;
  if (tel && entry) tel.markResponse(entry, tick);
}

function emitGesture(st, g, zone, dir, tick) {
  st.gesture = g;
  st.gestureZone = zone;
  st.gestureDir = dir;
  st.gestureTick = tick;
  if (g === GESTURE.TAP) st.taps++;
  else if (g === GESTURE.SWIPE) st.swipes++;
  else if (g === GESTURE.HOLD) st.holds++;
  else if (g === GESTURE.DOUBLE) st.doubles++;
}

/** Dominant-axis 4-way direction of a displacement. */
function dirOf(dx, dy) {
  const ax = dx < 0 ? -dx : dx, ay = dy < 0 ? -dy : dy;
  if (ax > ay) return dx > 0 ? DIR.RIGHT : DIR.LEFT;
  return dy > 0 ? DIR.DOWN : DIR.UP;
}

/** PAD_MAP lookup for the current side. `padIn` is one of the PAD_* column indices. */
function padAction(st, padIn) {
  const side = st.side | 0;
  const row = (side < 0 || side > SIDE.DEF ? 0 : side) * PAD_INPUTS;
  return PAD_MAP[row + padIn];
}

/* ------------------------------------------------------------------ stick */

/**
 * THE FLOATING STICK, WITH ANCHOR DRAG.
 *
 * The anchor is wherever the thumb landed. A stick fixed to a spot on the glass is the
 * single most common reason a touch game feels wrong in the hand, because thumbs land
 * where they land and the player has to look down to find the thing that is supposed to
 * let them not look down.
 *
 * ANCHOR DRAG is the second half of that idea and it is usually missed. Once the thumb
 * has travelled a full radius the anchor is pulled along behind it, so:
 *   - travel never runs out. A long drag across the pad does not saturate and then stop
 *     tracking direction changes;
 *   - reversing direction takes one radius of travel from wherever the thumb IS, not
 *     from wherever it originally landed. Without this, a thumb that has drifted 200 px
 *     up the pad has to travel 200 px back before the stick even starts to respond, and
 *     the player experiences that as the controller sticking.
 */
function updateStick(st, x, y, tick, tel, entry) {
  const R = TUNING.stickRadiusPx;
  let dx = x - st.anchorX, dy = y - st.anchorY;
  let d = Math.sqrt(dx * dx + dy * dy);
  const dragAt = R * TUNING.stickDragAt;
  if (d > dragAt) {
    // Pull the anchor up behind the thumb, keeping it exactly `dragAt` away.
    const k = (d - dragAt) / d;
    st.anchorX += dx * k;
    st.anchorY += dy * k;
    dx = x - st.anchorX; dy = y - st.anchorY;
    d = dragAt;
  }
  st.curX = x; st.curY = y;

  const dead = R * TUNING.stickDeadPct;
  let sx = 0, sy = 0;
  if (d > dead) {
    // Re-map [dead, R] onto [0, 1] so the stick reaches full deflection at the radius
    // and has no discontinuity at the dead-zone edge.
    const mag = Math.min(1, (d - dead) / (R - dead));
    sx = (dx / d) * mag;
    sy = (dy / d) * mag;
  }
  if (sx !== st.stickX || sy !== st.stickY) {
    st.stickX = sx; st.stickY = sy;
    st.stickDir8 = (sx === 0 && sy === 0)
      ? -1
      : ((Math.atan2(sy, sx) + TAU) % TAU) * (8 / TAU) + 0.5 | 0;
    if (st.stickDir8 === 8) st.stickDir8 = 0;
    st.changeTick = tick;
    if (tel && entry) tel.markResponse(entry, tick);
  }
}

/* ----------------------------------------------------------------- passing */

/**
 * RECEIVER SELECTION WITHOUT A KEYBOARD — the decision, and why.
 *
 * Three ways to commit a throw, all resolved on the SAME pointer that pressed PASS, and
 * each one exists because it covers the failure mode of another:
 *
 *   1. BEARING FLICK (the fast path). Flick the thumb in the direction the receiver is,
 *      relative to the passer, and release. The receiver whose SCREEN BEARING from the
 *      passer is closest to the flick wins, inside a +/-40 degree cone. This is what a
 *      player actually does under a collapsing pocket: they know where their guy is,
 *      they do not want to aim at a dot. It costs no travel and no looking.
 *      Its failure mode: two receivers on the same side of the field share a bearing.
 *
 *   2. ICON TAP (the precise path). Pressing PASS raises a numbered icon over every
 *      eligible receiver. Drag onto one and release — or tap one with the other thumb
 *      while PASS is held. This disambiguates the flick's degenerate case, and it is
 *      also what TEACHES the flick, because the icon shows the bearing you would have
 *      had to throw.
 *      Its failure mode: deep receivers converge into a few dozen pixels on a 390 pt
 *      phone and the icons overlap, and the travel costs time you do not have.
 *
 *   3. BARE TAP (the default). Press and release without moving: the ball goes to the
 *      play's PRIMARY READ. One thumb, one tap, no aiming at all. This is the floor the
 *      whole model rests on — the game is completable without ever using 1 or 2.
 *
 * AND A FOURTH THING THAT IS NOT A SELECTION: drag DOWN and release, or slide off, and
 * the QB TUCKS AND RUNS. A passing model with no cancel is a passing model that throws
 * interceptions on fat fingers.
 *
 * POWER IS FREE. How long PASS was held picks bullet / normal / lob. It costs no extra
 * control surface because the hold duration already exists.
 *
 * WHY NOT ICON-TAP ALONE (the obvious answer): it makes every throw a two-step aim on a
 * surface where the targets are moving, overlapping and small, and it puts the decision
 * in the part of the screen the player is already using to READ THE FIELD. Covering the
 * receivers with the interface you use to select receivers is self-defeating.
 * WHY NOT SWIPE ALONE: it cannot separate two men on the same bearing, and there is no
 * way to LEARN it — a bearing gesture with no visible target list is a guess.
 */
function bearingPick(st) {
  if (st.tgtN <= 0) return -1;
  const want = st.aimDirRad;
  let best = -1, bestD = TUNING.aimConeRad, bestOpen = -1;
  for (let i = 0; i < st.tgtN; i++) {
    const b = Math.atan2(st.tgtY[i] - st.passerY, st.tgtX[i] - st.passerX);
    let d = b - want;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    if (d < 0) d = -d;
    if (d > TUNING.aimConeRad) continue;
    // Nearest bearing wins; a tie inside a quarter of the cone goes to the OPEN man,
    // because "closest to my thumb direction" is not a football answer when two
    // receivers are on the same line and one of them is covered.
    if (best < 0 || d < bestD - TUNING.aimConeRad * 0.25
      || (Math.abs(d - bestD) <= TUNING.aimConeRad * 0.25 && st.tgtOpen[i] > bestOpen)) {
      best = i; bestD = d < bestD ? d : bestD; bestOpen = st.tgtOpen[i];
    }
  }
  return best;
}

/** Receiver icon under a CSS-px point while aiming, or -1. */
function receiverAt(st, x, y) {
  const r = TUNING.receiverRPx, r2 = r * r;
  let best = -1, bestD = r2;
  for (let i = 0; i < st.tgtN; i++) {
    const dx = x - st.tgtX[i], dy = y - st.tgtY[i];
    const d = dx * dx + dy * dy;
    if (d <= bestD) { bestD = d; best = i; }
  }
  return best;
}

function commitPass(st, tick, downTick, tel, entry, cancelled) {
  st.aiming = false;
  st.aimSlot = -1;
  st.btnB = false;
  st.changeTick = tick;

  if (cancelled) {                       // CANCEL is a lost touch, never a throw
    st.aimLatched = -1; st.aimBearingPick = -1;
    return;
  }

  // Explicit tuck: dragged straight down off the pad.
  if (st.aimDy >= TUNING.aimTuckPx && st.aimDy > Math.abs(st.aimDx)) {
    emitAction(st, ACT.TUCK, DIR.DOWN, downTick, tick, tel, entry);
    st.aimLatched = -1; st.aimBearingPick = -1;
    return;
  }

  let row = st.aimLatched;
  if (row < 0 && st.aimMag >= TUNING.aimFlickPx) row = bearingPick(st);
  if (row < 0 && st.aimMag < TUNING.aimFlickPx) row = st.tgtPrimary;

  const held = tick - downTick;
  st.passPower = held < TUNING.passBulletTicks ? 0 : held > TUNING.passLobTicks ? 2 : 1;

  if (row >= 0 && row < st.tgtN) {
    st.passTarget = st.tgtId[row];
    st.passTick = downTick;
    emitAction(st, ACT.PASS, dirOf(st.aimDx, st.aimDy), downTick, tick, tel, entry);
  } else {
    st.passTarget = -1;
    emitAction(st, ACT.THROW_AWAY, DIR.NONE, downTick, tick, tel, entry);
  }
  st.aimLatched = -1;
  st.aimBearingPick = -1;
}

/* ------------------------------------------------------------------ TURBO */

/**
 * TURBO FUEL — integer, per tick, deterministic.
 *
 * `turbo` is the CONTROL being engaged; `boost` is turbo actually doing something. They
 * are separate because a control that stops registering when it has nothing left to give
 * is a control the player thinks is broken. Empty turbo still presses, still lights, and
 * still shows you why nothing happened: the lozenge goes to the overheat rim.
 */
function stepTurbo(st, tick) {
  const T = TUNING;
  let f = st.fuel;
  const locked = tick < st.overheatUntil;
  const want = st.turbo && !locked && f > 0;
  if (want) {
    f -= T.fuelBurn;
    if (f <= 0) {
      f = 0;
      st.overheatUntil = tick + T.overheatTicks;
    }
  } else if (f < T.fuelMax) {
    f += T.fuelRegen;
    if (f > T.fuelMax) f = T.fuelMax;
  }
  st.fuel = f;
  const nextBoost = want && f > 0;
  if (nextBoost !== st.boost) { st.boost = nextBoost; st.changeTick = tick; }
  const b = f >> 4;
  if (b !== st.fuelBucket) { st.fuelBucket = b; st.changeTick = tick; }
}

/* ==================================================================== resolve */

export function resolve(st, tick, touch, tel, idxScratch) {
  // ---- clear the one-shot feeds. They live for exactly one tick. -----------
  st.gesture = GESTURE.NONE;
  st.gestureZone = ZONE.NONE;
  st.gestureDir = DIR.NONE;
  st.action = ACT.NONE;
  st.actionDir = DIR.NONE;
  st.actionPower = 0;
  st.press = ZONE.NONE;
  st.passTarget = -1;

  const idx = idxScratch || SCRATCH_IDX;
  const n = touch && touch.eventsOnTick ? touch.eventsOnTick(tick, idx) : 0;

  for (let k = 0; k < n; k++) {
    const ev = touch.events[idx[k]];
    const slot = ev.slot;
    if (slot < 0 || slot >= MAX_POINTERS) continue;
    const entry = ev.entry;

    /* ------------------------------------------------------------- DOWN */
    if (ev.type === EV_DOWN) {
      let z = zoneAt(ev.x, ev.y, st.w, st.h);

      // A receiver icon is only live WHILE AIMING, and only outside every control
      // rectangle. Controls win the overlap: you can always press the thing that is
      // permanently there, and the bearing flick still reaches any receiver an icon
      // could have.
      if (z === ZONE.NONE && st.aiming) {
        const r = receiverAt(st, ev.x, ev.y);
        if (r >= 0) {
          z = ZONE.RECEIVER;
          st.aimLatched = r;
          st.pz[slot] = z;
          st.pg[slot] = GESTURE.NONE;
          st.pDownTick[slot] = tick;
          st.pAx[slot] = ev.x; st.pAy[slot] = ev.y;
          st.press = ZONE.RECEIVER; st.pressTick = tick;
          // A second thumb on an icon commits the throw immediately — the pointer that
          // is holding PASS keeps holding it, and the pass fires now rather than on lift.
          commitPass(st, tick, st.aimDownTick, tel, entry, false);
          st.changeTick = tick;
          if (tel && entry) tel.markResponse(entry, tick);
          continue;
        }
      }

      st.pz[slot] = z;
      st.pg[slot] = GESTURE.NONE;
      st.pDownTick[slot] = tick;
      st.pAx[slot] = ev.x; st.pAy[slot] = ev.y;

      if (z !== ZONE.NONE) {
        // THE PRESS FEED. Published on DOWN, before the gesture is known, so the sim can
        // start the wind-up at true input latency. This is also the event the latency
        // harness correlates, which is deliberate: the number it reports is the delay
        // before something the player can SEE changes, not the delay before an action id
        // appears in a struct.
        st.press = z;
        st.pressTick = tick;
        st.changeTick = tick;
        if (tel && entry) tel.markResponse(entry, tick);
      }

      if (z === ZONE.STICK) {
        if (!st.stickActive) {
          st.stickActive = true;
          st.stickPointer = slot;
          st.anchorX = ev.x; st.anchorY = ev.y;
          st.curX = ev.x; st.curY = ev.y;
          st.stickX = 0; st.stickY = 0; st.stickDir8 = -1;
          st.stickDownTick = tick;
        }
      } else if (z === ZONE.ACTION) {
        st.btnA = true; st.btnAPressTick = tick;
      } else if (z === ZONE.PASS) {
        st.btnB = true; st.btnBPressTick = tick;
        st.aiming = true;
        st.aimSlot = slot;
        st.aimAnchorX = ev.x; st.aimAnchorY = ev.y;
        st.aimX = ev.x; st.aimY = ev.y;
        st.aimDx = 0; st.aimDy = 0; st.aimMag = 0; st.aimDirRad = 0;
        st.aimLatched = -1; st.aimBearingPick = -1;
        st.aimDownTick = tick;
      } else if (z === ZONE.TURBO) {
        st.turbo = true; st.turboPressTick = tick;
      }

    /* ------------------------------------------------------------- MOVE */
    } else if (ev.type === EV_MOVE) {
      const z = st.pz[slot];

      if (slot === st.stickPointer && st.stickActive) {
        updateStick(st, ev.x, ev.y, tick, tel, entry);
        continue;
      }

      if (z === ZONE.PASS && slot === st.aimSlot && st.aiming) {
        st.aimX = ev.x; st.aimY = ev.y;
        const dx = ev.x - st.aimAnchorX, dy = ev.y - st.aimAnchorY;
        st.aimDx = dx; st.aimDy = dy;
        st.aimMag = Math.sqrt(dx * dx + dy * dy);
        if (st.aimMag > 0.001) st.aimDirRad = Math.atan2(dy, dx);
        const r = receiverAt(st, ev.x, ev.y);
        st.aimLatched = r;
        st.aimBearingPick = (r < 0 && st.aimMag >= TUNING.aimFlickPx) ? bearingPick(st) : -1;
        st.changeTick = tick;
        continue;
      }

      // MID-DRAG SWIPE COMMIT. Only on the two right-thumb pads: the stick's own drag IS
      // the steering input and must never fire a move, and a swipe off TURBO would fire
      // every time the thumb rolled while holding it down.
      if ((z === ZONE.ACTION) && st.pg[slot] === GESTURE.NONE) {
        const dx = ev.x - st.pAx[slot], dy = ev.y - st.pAy[slot];
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist >= TUNING.swipeMinPx) {
          const dir = dirOf(dx, dy);
          st.pg[slot] = GESTURE.SWIPE;
          emitGesture(st, GESTURE.SWIPE, z, dir, tick);
          emitAction(st, padAction(st, dir + 2), dir, st.pDownTick[slot], tick, tel, entry);
        }
      }

    /* -------------------------------------------------------- UP / CANCEL */
    } else {
      const z = st.pz[slot];
      const cancelled = ev.type === EV_CANCEL;
      const downTick = st.pDownTick[slot];
      const held = tick - downTick;
      const dx = ev.x - st.pAx[slot], dy = ev.y - st.pAy[slot];
      const dist = Math.sqrt(dx * dx + dy * dy);

      // A CANCEL NEVER PRODUCES A GESTURE. A lost touch is not a tap, and a game that
      // fires a tackle because the OS took the pointer away is a game that feels haunted.
      if (!cancelled && st.pg[slot] === GESTURE.NONE && z !== ZONE.NONE) {
        if (z === ZONE.STICK) {
          // THE FLICK JUKE. A short, fast, horizontal flick of the STICK — down, throw,
          // lift, inside 14 ticks — is a juke in that direction. It is the oldest arcade
          // football idiom there is and it costs no screen area. It is gated on being
          // FAST because steering holds the stick down for seconds at a time, and a
          // release after a long hold is a player letting go, not a player juking.
          if (dist >= TUNING.swipeMinPx && held <= TUNING.flickMaxTicks) {
            const dir = dirOf(dx, dy);
            emitGesture(st, GESTURE.SWIPE, z, dir, tick);
            if (dir === DIR.LEFT || dir === DIR.RIGHT) {
              emitAction(st, dir === DIR.LEFT ? ACT.JUKE_L : ACT.JUKE_R, dir, downTick, tick, tel, entry);
            }
          }
        } else if (z === ZONE.ACTION) {
          // ===================================================================
          // THE ACTION PAD IS THE ONLY ZONE WITH A RELEASE VOCABULARY, and it now says so
          // in the control flow instead of by being what is left over.
          //
          // This used to be the UNTAGGED TAIL of the chain — `else if (dist >= ...)`,
          // `else if (held >= ...)`, `else` tap — so it was not the ACTION pad's
          // vocabulary, it was EVERY ZONE'S vocabulary, awarded to whichever zone nobody
          // had remembered to name above. ZONE.RECEIVER was that zone. Its icon-tap
          // commits the throw on the DOWN (see the DOWN handler above, at true input
          // latency), so its lift has nothing left to say — but the lift landed here and
          // fired a second action out of PAD_MAP. At SIDE.QB the tap column is ACT.TUCK,
          // so tapping a receiver to pick him threw the ball and then tucked and ran with
          // it, on the primary passing path, every single time. 40 px of thumb drift made
          // it a SLIDE off the swipe column instead; 20 ticks of rest made it a SLIDE off
          // the hold column.
          //
          // Gating the vocabulary on ZONE.ACTION rather than naming the other zones fixes
          // the CLASS and not the instance: a zone id added to tuning.js next round
          // inherits SILENCE here, which is wrong in the harmless direction, instead of
          // inheriting a tap-to-tuck it was never designed to have.
          // ===================================================================
          if (dist >= TUNING.swipeMinPx) {
            // Reached only when the mid-drag commit did not fire: a single MOVE-less
            // release that still landed far from the anchor (a very fast flick whose only
            // sample is the UP).
            const dir = dirOf(dx, dy);
            emitGesture(st, GESTURE.SWIPE, z, dir, tick);
            emitAction(st, padAction(st, dir + 2), dir, downTick, tick, tel, entry);
          } else if (held >= TUNING.holdTicks) {
            emitGesture(st, GESTURE.HOLD, z, DIR.NONE, tick);
            emitAction(st, padAction(st, PAD_HOLD), DIR.NONE, downTick, tick, tel, entry);
          } else {
            const zi = z & 7;
            if (tick - st.lastTapTick[zi] <= TUNING.doubleGapTicks) {
              emitGesture(st, GESTURE.DOUBLE, z, DIR.NONE, tick);
              st.lastTapTick[zi] = -999;            // a double does not seed a triple
              emitAction(st, padAction(st, PAD_DOUBLE), DIR.NONE, downTick, tick, tel, entry);
            } else {
              emitGesture(st, GESTURE.TAP, z, DIR.NONE, tick);
              st.lastTapTick[zi] = tick;
              emitAction(st, padAction(st, PAD_TAP), DIR.NONE, downTick, tick, tel, entry);
            }
          }
        } else {
          // TURBO, PASS, RECEIVER — and anything added later. Every one of them has
          // already committed whatever it was going to commit before this lift:
          //   TURBO     is a hold-button. Holding a hold-button is not a gesture, and
          //             releasing one is not a tap. The release is handled below, where
          //             `st.turbo` goes false.
          //   PASS      the release IS the throw, and commitPass() below performs it —
          //             with power derived from how long it was held. It has no tap /
          //             swipe / hold vocabulary of its own to collide with that.
          //   RECEIVER  the throw fired on the DOWN, at true input latency, while the
          //             other thumb kept holding PASS. Nothing is left to decide.
          // The redraw epoch still has to move, because the pad art changes on release.
          st.changeTick = tick;
        }
        if (tel && entry) tel.markResponse(entry, tick);
      }

      if (slot === st.stickPointer) {
        st.stickActive = false; st.stickPointer = -1;
        st.stickX = 0; st.stickY = 0; st.stickDir8 = -1;
        st.changeTick = tick;
      }
      if (z === ZONE.ACTION) { st.btnA = false; st.changeTick = tick; }
      else if (z === ZONE.PASS) {
        if (slot === st.aimSlot) commitPass(st, tick, downTick, tel, entry, cancelled);
        else { st.btnB = false; st.changeTick = tick; }
      } else if (z === ZONE.TURBO) { st.turbo = false; st.changeTick = tick; }

      st.pz[slot] = ZONE.NONE;
      st.pg[slot] = GESTURE.NONE;
      st.pDownTick[slot] = -1;
    }
  }

  /* ---- HOLD fires WHILE THE THUMB IS STILL DOWN ---------------------------
   * Only the ACTION pad has a hold vocabulary. The stick, TURBO and PASS are all
   * controls whose normal state IS "held", and emitting a HOLD for them would both
   * pollute the gesture counters and fire an action for doing nothing.
   */
  for (let s = 0; s < MAX_POINTERS; s++) {
    if (st.pDownTick[s] < 0 || st.pg[s] !== GESTURE.NONE) continue;
    if (st.pz[s] !== ZONE.ACTION) continue;
    const p = touch && touch.pointers ? touch.pointers[s] : null;
    if (!p || !p.active) continue;
    if ((tick - st.pDownTick[s]) >= TUNING.holdTicks && p.maxDist < TUNING.swipeMinPx) {
      st.pg[s] = GESTURE.HOLD;
      emitGesture(st, GESTURE.HOLD, st.pz[s], DIR.NONE, tick);
      emitAction(st, padAction(st, PAD_HOLD), DIR.NONE, st.pDownTick[s], tick, null, null);
    }
  }

  /* ---- retire expired opportunities -------------------------------------- */
  for (let i = st.armN - 1; i >= 0; i--) {
    if (tick > st.armExpire[i]) dropArmed(st, i);
  }

  stepTurbo(st, tick);
  // The draw path needs the sim tick and must not derive it from a wall clock or from
  // the presented frame. This is the same integer the whole resolve just ran on.
  st.lastTick = tick;
  return st.gesture;
}

/* -------------------------------------------------------------- sim inputs */

export function setSurface(st, w, h) {
  st.w = Math.max(16, w | 0);
  st.h = Math.max(16, h | 0);
  layoutZones(st.w, st.h);
  st.changeTick = -1;             // force the next epoch comparison to differ
}

export function setContext(st, side) {
  const s = side | 0;
  if (s === st.side) return;
  st.side = (s < 0 || s > SIDE.DEF) ? SIDE.CARRY : s;
  st.changeTick = -2 - st.side;   // the pad artwork changes; force a redraw
}

/**
 * setTargets(st, n) — the sim fills st.tgtX/tgtY (CSS px on the live surface), tgtId,
 * tgtOpen and tgtPrimary directly, then calls this to publish the count. No array is
 * passed in and nothing is copied, so this is allocation-free from both sides.
 */
export function setTargets(st, n, passerX, passerY) {
  st.tgtN = n < 0 ? 0 : n > MAX_TARGETS ? MAX_TARGETS : n | 0;
  st.passerX = passerX;
  st.passerY = passerY;
}

/** Deterministic hash of everything a replay must reproduce. */
export function hash(st) {
  let h = 2166136261 >>> 0;
  const mix = (v) => { h ^= (v | 0) >>> 0; h = Math.imul(h, 16777619) >>> 0; };
  mix(Math.round(st.stickX * 1000)); mix(Math.round(st.stickY * 1000));
  mix(st.stickDir8);
  mix(st.btnA ? 1 : 0); mix(st.btnB ? 2 : 0); mix(st.turbo ? 4 : 0); mix(st.boost ? 8 : 0);
  mix(st.fuel);
  mix(st.taps); mix(st.swipes); mix(st.holds); mix(st.doubles);
  mix(st.actions); mix(st.perfects); mix(st.earlies); mix(st.lates); mix(st.misses);
  mix(st.action); mix(st.actionDir); mix(st.actionPower);
  mix(st.grade); mix(st.gradeWindow); mix(st.gradeDelta);
  mix(st.passTarget); mix(st.passPower);
  return h >>> 0;
}

export default {
  resolve, setSurface, setContext, setTargets, hash,
  arm, clearArmed, armedRemaining, armedSpan, armedInfo,
};
