// PIECE touch-controller — the controller state object.
//
// EVERYTHING IS PREALLOCATED. `create()` runs once, at boot, and after that the frame
// path and the sim path never allocate: no arrays, no objects, no closures, no strings.
// A controller that allocates during play hands the GC a reason to run inside a 4.15 ms
// overlay budget, and a GC pause is exactly the kind of hitch a timing window cannot
// survive.
//
// FIELD NAMES THAT ARE NOT OURS TO CHANGE. `src/main.js` (foundation) reads
// `stickX stickY stickActive btnA btnB turbo gesture gestureZone gestureDir gestureTick
// changeTick taps swipes holds doubles` off this object for the overlay redraw epoch and
// for `window.__BLITZ_PERF__.controller`, and its overlay pre-warm WRITES
// `btnA btnB turbo stickActive stickX stickY`. So those names are a contract with
// foundation, not an internal choice, and they are grouped together below and labelled.

import { ZONE, GESTURE, DIR, ACT, SIDE, TUNING, GRADE } from './tuning.js';

/** Fixed capacities. Nothing here ever grows. */
export const MAX_POINTERS = 10;
export const MAX_ARMED = 8;
export const MAX_TARGETS = 6;

export function createState() {
  const st = {
    /* ---- FOUNDATION CONTRACT (main.js reads and writes these names) -------- */
    stickX: 0, stickY: 0,
    stickActive: false,
    btnA: false,          // the ACTION pad is down
    btnB: false,          // the PASS pad is down
    turbo: false,         // the TURBO control is engaged
    gesture: GESTURE.NONE,
    gestureZone: ZONE.NONE,
    gestureDir: DIR.NONE,
    gestureTick: -1,
    changeTick: -1,       // bumped whenever anything DRAWN changes -> overlay epoch
    taps: 0, swipes: 0, holds: 0, doubles: 0,

    /* ---- stick ------------------------------------------------------------ */
    stickPointer: -1,
    anchorX: 0, anchorY: 0,     // where the thumb landed (and where the well is drawn)
    curX: 0, curY: 0,           // where the thumb is now
    stickDownTick: -1,
    /** 8-way quantisation of the stick, for a sim that wants a facing rather than a vector. */
    stickDir8: -1,

    /* ---- buttons ---------------------------------------------------------- */
    btnAPressTick: -1, btnBPressTick: -1, turboPressTick: -1,

    /* ---- TURBO fuel. INTEGER 0..1024; see the note in tuning.js. ----------- */
    fuel: TUNING.fuelMax,
    fuelBucket: TUNING.fuelMax >> 4,   // quantised for the redraw epoch
    overheatUntil: -1,
    /** turbo is ENGAGED (button down); boost is turbo ACTUALLY DOING SOMETHING. */
    boost: false,

    /* ---- THE ACTION FEED. One-shot: written during resolve(tick), read by the
     * sim in the SAME tick, cleared at the top of the next. ------------------ */
    action: ACT.NONE,
    actionDir: DIR.NONE,
    /** 0 normal, 1 turbo-modified (TRUCK / LAYOUT / LAUNCH). */
    actionPower: 0,
    /** The tick the action is JUDGED on: the tick the finger LANDED, never the lift. */
    actionTick: -1,

    /* ---- THE PRESS FEED. Fires on DOWN, at true input latency, before the
     * gesture is known. The sim starts the wind-up on this; the ACTION feed above
     * decides what the wind-up becomes. See the long note in resolve.js. ----- */
    press: ZONE.NONE,
    pressTick: -1,

    /* ---- grading ---------------------------------------------------------- */
    grade: GRADE.UNARMED,
    gradeWindow: 0,        // TW id the grade was against
    gradeDelta: 0,         // pressTick - peakTick, in ticks
    gradeTick: -1,
    flashUntil: -1,        // ticks for which the pad shows the grade colour
    perfects: 0, earlies: 0, lates: 0, misses: 0, actions: 0,

    /* ---- armed opportunities (the sim arms them; the controller grades) ---- */
    armTw: new Int8Array(MAX_ARMED),
    armPeak: new Int32Array(MAX_ARMED),
    armExpire: new Int32Array(MAX_ARMED),
    armN: 0,

    /* ---- passing ---------------------------------------------------------- */
    aiming: false,
    aimSlot: -1,
    aimAnchorX: 0, aimAnchorY: 0,
    aimX: 0, aimY: 0,
    aimDx: 0, aimDy: 0,
    aimMag: 0,
    aimDirRad: 0,
    /** Index into the target table latched by dragging onto a receiver icon; -1 = none. */
    aimLatched: -1,
    /** Index the bearing flick currently points at; -1 = none. Live, for the HUD. */
    aimBearingPick: -1,
    aimDownTick: -1,
    /** Result of the last throw. passTarget is a receiver ID, not a table index. */
    passTarget: -1,
    passPower: 1,          // 0 bullet, 1 normal, 2 lob
    passTick: -1,

    /* ---- receiver targets, in CSS px on the live surface ------------------ */
    tgtN: 0,
    tgtX: new Float32Array(MAX_TARGETS),
    tgtY: new Float32Array(MAX_TARGETS),
    tgtId: new Int16Array(MAX_TARGETS),
    tgtOpen: new Uint8Array(MAX_TARGETS),    // separation 0..255, the tie-break
    /** Which table row is the play's PRIMARY READ. A bare tap on PASS throws here. */
    tgtPrimary: -1,
    passerX: 0, passerY: 0,

    /* ---- context ---------------------------------------------------------- */
    side: SIDE.CARRY,

    /* ---- per-pointer scratch --------------------------------------------- */
    pz: new Int8Array(MAX_POINTERS),          // zone claimed by this pointer slot
    pg: new Int8Array(MAX_POINTERS),          // gesture already emitted for this slot
    pDownTick: new Int32Array(MAX_POINTERS),
    pAx: new Float32Array(MAX_POINTERS),      // anchor x per slot
    pAy: new Float32Array(MAX_POINTERS),

    /** Last tap tick per zone, for DOUBLE. Indexed zone & 7. */
    lastTapTick: new Int32Array(8),

    /* ---- surface ---------------------------------------------------------- */
    w: 390, h: 844,

    /**
     * The last sim tick `resolve()` ran on. The DRAW path reads this and never derives a
     * tick from wall time or from the presented frame — at 30 Hz those are two different
     * numbers and the second one is wrong.
     */
    lastTick: 0,
  };
  st.lastTapTick.fill(-999);
  st.pDownTick.fill(-1);
  st.armTw.fill(0);
  st.tgtId.fill(-1);
  return st;
}

export default { createState, MAX_POINTERS, MAX_ARMED, MAX_TARGETS };
