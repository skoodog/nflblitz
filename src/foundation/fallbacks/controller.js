// FOUNDATION FALLBACK — replaced by piece `touch-controller` via registerController().
//
// THE REFERENCE CONTROLLER. Deliberately minimal: a thumbstick that is a circle
// following the thumb, plus two action buttons and a turbo pad. It exists to prove the
// END-TO-END TOUCH CHAIN before any real controller is built, and to be the BASELINE
// the `touch-controller` piece has to BEAT rather than merely establish:
//
//   input -> render dispatch, p50 <= 2 frames and worst <= 3 frames
//   100/100 simultaneous stick + button
//   0 stuck touches across cancel / slide-off-edge / visibilitychange
//   >= 98% gesture classification accuracy on tap / swipe / hold / double
//
// OWNERSHIP. The foundation's `touch.js` owns the raw timestamped bus. THIS file owns
// zones, gesture recognition, dead zones and feel — and it is the thing a real piece
// replaces. It reads `touch.pointers` and `touch.events` and nothing else.
//
// EVERYTHING HERE IS RESOLVED PER SIM TICK, NOT PER FRAME. `resolve(tick, touch, tel)`
// is called from inside the fixed-step loop and only looks at the events bound to THAT
// tick. That is what keeps the controller bit-identical at 60 Hz and at 30 Hz: at 30 Hz
// the frame runs two ticks and the events split across them by their own timestamps, so
// the player's inputs land on exactly the ticks they would have landed on at 60.
//
// NO KEYBOARD. NO HOVER. The game is playable with two thumbs and nothing else.

export const ZONE = Object.freeze({ NONE: 0, STICK: 1, ACTION_A: 2, ACTION_B: 3, TURBO: 4 });
export const GESTURE = Object.freeze({ NONE: 0, TAP: 1, SWIPE: 2, HOLD: 3, DOUBLE: 4 });
export const GESTURE_NAME = ['none', 'tap', 'swipe', 'hold', 'double'];
export const DIR = Object.freeze({ NONE: 0, UP: 1, DOWN: 2, LEFT: 3, RIGHT: 4 });

/* -------------------------------------------------------------- thresholds */

// Distances are in CSS PIXELS — the unit a thumb actually moves in. Times are in TICKS
// — the unit the sim actually runs in. Neither is in frames, because frames are the one
// thing that changes between 60 and 30 Hz.
export const TUNING = Object.freeze({
  slopPx: 10,           // below this a pointer has not "moved"
  swipeMinPx: 28,       // above this a gesture is a swipe, not a tap
  tapMaxTicks: 18,      // 300 ms — longer than this and it is not a tap
  holdTicks: 30,        // 500 ms stationary -> HOLD, fired while still down
  doubleGapTicks: 21,   // 350 ms between taps -> DOUBLE
  stickRadiusPx: 62,    // full deflection at this distance from the anchor
  stickDeadPct: 0.16,   // dead zone as a fraction of the radius
});

/**
 * Zone rectangles as fractions of the VISIBLE surface. Bottom corners: thumb country.
 * Exported so `touch.mjs` can check REACH against the real zones instead of keeping a
 * second copy that silently drifts out of step with the controller.
 */
export const ZONE_RECTS = [
  // [zone, x0, y0, x1, y1] in 0..1 of the visible css rect
  [ZONE.STICK, 0.00, 0.52, 0.45, 1.00],
  [ZONE.TURBO, 0.52, 0.64, 0.76, 0.86],
  [ZONE.ACTION_B, 0.76, 0.64, 1.00, 0.86],
  [ZONE.ACTION_A, 0.52, 0.86, 1.00, 1.00],
];

/**
 * HOME POINTS — where each control is DRAWN, and therefore where a thumb actually goes.
 * `touch.mjs` checks REACH against these, not against the zone-rectangle centres: a
 * zone is a large hit region whose centre may be nowhere near the visible control, so
 * testing the centre tests the wrong point. Drawing and reach must read the same table
 * or the two drift apart silently.
 *
 * All four sit inside 40 mm of a bottom-corner thumb pivot on a 390x844 panel, where
 * one CSS px is 0.183 mm. That constraint is what forces everything below y ~= 0.73:
 * 40 mm is 219 CSS px, and the pivot is at the bottom edge. The first version of this
 * layout put TURBO and ACTION_B at y = 0.60 and `touch.mjs` measured them at 69.9 mm
 * and 66.8 mm — comfortably unreachable, which is exactly the kind of thing that is
 * obvious in a measurement and invisible in a screenshot.
 */
export const ZONE_HOMES = [
  [ZONE.STICK, 0.12, 0.80],
  [ZONE.TURBO, 0.66, 0.79],
  [ZONE.ACTION_B, 0.88, 0.78],
  [ZONE.ACTION_A, 0.84, 0.93],
];

function zoneAt(x, y, w, h) {
  const fx = x / Math.max(1, w), fy = y / Math.max(1, h);
  for (let i = 0; i < ZONE_RECTS.length; i++) {
    const r = ZONE_RECTS[i];
    if (fx >= r[1] && fx < r[3] && fy >= r[2] && fy < r[4]) return r[0];
  }
  return ZONE.NONE;
}

const EV_DOWN = 0, EV_MOVE = 1, EV_UP = 2, EV_CANCEL = 3;

/* ------------------------------------------------------------------- impl */

const impl = {
  piece: 'foundation-fallback',
  ZONE, GESTURE, GESTURE_NAME, DIR, TUNING, ZONE_RECTS,

  /**
   * create() -> controller state. Pooled and preallocated: the frame path never
   * allocates, so there is nothing here for the GC to collect mid-play.
   */
  create() {
    const st = {
      // --- the analogue stick -------------------------------------------
      stickX: 0, stickY: 0,          // -1..1, dead-zoned and normalised
      stickActive: false,
      stickPointer: -1,
      anchorX: 0, anchorY: 0,        // where the thumb first landed
      curX: 0, curY: 0,
      // --- buttons ------------------------------------------------------
      btnA: false, btnB: false, turbo: false,
      btnAPressTick: -1, btnBPressTick: -1, turboPressTick: -1,
      // --- last resolved gesture (one-shot; consumed by the sim) ---------
      gesture: GESTURE.NONE,
      gestureZone: ZONE.NONE,
      gestureDir: DIR.NONE,
      gestureTick: -1,
      // --- per-pointer scratch, fixed size, never grows ------------------
      pz: new Int8Array(10),          // zone claimed by pointer slot
      pg: new Int8Array(10),          // gesture already emitted for this pointer
      pDownTick: new Int32Array(10),
      pAx: new Float32Array(10),      // anchor x per slot
      pAy: new Float32Array(10),
      // --- double-tap memory, per zone ----------------------------------
      lastTapTick: new Int32Array(8),
      // --- surface ------------------------------------------------------
      w: 390, h: 844,
      // --- counters the harness reads -----------------------------------
      taps: 0, swipes: 0, holds: 0, doubles: 0,
      changeTick: -1,
    };
    st.lastTapTick.fill(-999);
    st.pDownTick.fill(-1);
    return st;
  },

  setSurface(st, w, h) { st.w = w; st.h = h; },

  /**
   * resolve(st, tick, touch, tel) — called ONCE PER SIM TICK from inside the fixed-step
   * loop. Only consumes events bound to `tick`.
   *
   * `tel.markResponse(entry, tick)` is called the instant an event changes controller
   * state. That is the timestamp `touch.mjs` correlates against the frame's render
   * dispatch to produce a latency number that is measured, not assumed.
   */
  resolve(st, tick, touch, tel, idxScratch) {
    st.gesture = GESTURE.NONE;
    st.gestureZone = ZONE.NONE;
    st.gestureDir = DIR.NONE;

    const idx = idxScratch || SCRATCH_IDX;
    const n = touch.eventsOnTick ? touch.eventsOnTick(tick, idx) : 0;

    for (let k = 0; k < n; k++) {
      const ev = touch.events[idx[k]];
      const slot = ev.slot;
      if (slot < 0 || slot >= 10) continue;

      if (ev.type === EV_DOWN) {
        const z = zoneAt(ev.x, ev.y, st.w, st.h);
        st.pz[slot] = z;
        st.pg[slot] = GESTURE.NONE;
        st.pDownTick[slot] = tick;
        st.pAx[slot] = ev.x; st.pAy[slot] = ev.y;

        if (z === ZONE.STICK && !st.stickActive) {
          // Floating stick: the anchor is wherever the thumb landed, never a fixed
          // on-screen position. A fixed stick is the single most common reason a
          // touch game feels wrong in the hand.
          st.stickActive = true;
          st.stickPointer = slot;
          st.anchorX = ev.x; st.anchorY = ev.y;
          st.curX = ev.x; st.curY = ev.y;
          st.stickX = 0; st.stickY = 0;
          st.changeTick = tick;
          if (tel && ev.entry) tel.markResponse(ev.entry, tick);
        } else if (z === ZONE.ACTION_A) {
          st.btnA = true; st.btnAPressTick = tick; st.changeTick = tick;
          if (tel && ev.entry) tel.markResponse(ev.entry, tick);
        } else if (z === ZONE.ACTION_B) {
          st.btnB = true; st.btnBPressTick = tick; st.changeTick = tick;
          if (tel && ev.entry) tel.markResponse(ev.entry, tick);
        } else if (z === ZONE.TURBO) {
          st.turbo = true; st.turboPressTick = tick; st.changeTick = tick;
          if (tel && ev.entry) tel.markResponse(ev.entry, tick);
        }
      } else if (ev.type === EV_MOVE) {
        if (slot === st.stickPointer && st.stickActive) {
          st.curX = ev.x; st.curY = ev.y;
          const dx = ev.x - st.anchorX, dy = ev.y - st.anchorY;
          const d = Math.sqrt(dx * dx + dy * dy);
          const R = TUNING.stickRadiusPx;
          const dead = R * TUNING.stickDeadPct;
          if (d <= dead) {
            if (st.stickX !== 0 || st.stickY !== 0) st.changeTick = tick;
            st.stickX = 0; st.stickY = 0;
          } else {
            // Re-map [dead, R] onto [0, 1] so the stick reaches full deflection at the
            // radius and has no discontinuity at the dead-zone edge.
            const mag = Math.min(1, (d - dead) / (R - dead));
            const nx = dx / d, ny = dy / d;
            const sx = nx * mag, sy = ny * mag;
            if (sx !== st.stickX || sy !== st.stickY) {
              st.stickX = sx; st.stickY = sy;
              st.changeTick = tick;
              if (tel && ev.entry) tel.markResponse(ev.entry, tick);
            }
          }
        }
      } else {
        // UP or CANCEL. A CANCEL never produces a gesture — a lost touch is not a tap.
        const z = st.pz[slot];
        if (ev.type === EV_UP && st.pg[slot] === GESTURE.NONE) {
          const held = tick - st.pDownTick[slot];
          const dx = ev.x - st.pAx[slot], dy = ev.y - st.pAy[slot];
          const dist = Math.sqrt(dx * dx + dy * dy);
          let g = GESTURE.NONE;
          if (dist >= TUNING.swipeMinPx) {
            g = GESTURE.SWIPE;
            st.gestureDir = Math.abs(dx) > Math.abs(dy)
              ? (dx > 0 ? DIR.RIGHT : DIR.LEFT)
              : (dy > 0 ? DIR.DOWN : DIR.UP);
            st.swipes++;
          } else if (held >= TUNING.holdTicks) {
            g = GESTURE.HOLD; st.holds++;
          } else {
            const zi = z & 7;
            if (tick - st.lastTapTick[zi] <= TUNING.doubleGapTicks) {
              g = GESTURE.DOUBLE; st.doubles++;
              st.lastTapTick[zi] = -999;              // a double does not seed a triple
            } else {
              g = GESTURE.TAP; st.taps++;
              st.lastTapTick[zi] = tick;
            }
          }
          st.gesture = g;
          st.gestureZone = z;
          st.gestureTick = tick;
          if (tel && ev.entry) tel.markResponse(ev.entry, tick);
        }

        if (slot === st.stickPointer) {
          st.stickActive = false; st.stickPointer = -1;
          st.stickX = 0; st.stickY = 0; st.changeTick = tick;
        }
        if (z === ZONE.ACTION_A) { st.btnA = false; st.changeTick = tick; }
        else if (z === ZONE.ACTION_B) { st.btnB = false; st.changeTick = tick; }
        else if (z === ZONE.TURBO) { st.turbo = false; st.changeTick = tick; }
        st.pz[slot] = ZONE.NONE;
        st.pg[slot] = GESTURE.NONE;
        st.pDownTick[slot] = -1;
      }
    }

    // HOLD fires WHILE THE THUMB IS STILL DOWN, which is how a hold actually feels. A
    // hold that only resolves on release is a slow tap, not a hold.
    for (let s = 0; s < 10; s++) {
      if (st.pDownTick[s] < 0 || st.pg[s] !== GESTURE.NONE) continue;
      const p = touch.pointers[s];
      if (!p || !p.active) continue;
      if ((tick - st.pDownTick[s]) >= TUNING.holdTicks && p.maxDist < TUNING.swipeMinPx) {
        st.pg[s] = GESTURE.HOLD;
        st.gesture = GESTURE.HOLD;
        st.gestureZone = st.pz[s];
        st.gestureTick = tick;
        st.holds++;
      }
    }
    return st.gesture;
  },

  /** Deterministic hash of controller state — used by the determinism suite. */
  hash(st) {
    let h = 2166136261 >>> 0;
    const mix = (v) => { h ^= (v | 0) >>> 0; h = Math.imul(h, 16777619) >>> 0; };
    mix(Math.round(st.stickX * 1000)); mix(Math.round(st.stickY * 1000));
    mix(st.btnA ? 1 : 0); mix(st.btnB ? 1 : 0); mix(st.turbo ? 1 : 0);
    mix(st.taps); mix(st.swipes); mix(st.holds); mix(st.doubles);
    return h >>> 0;
  },

  /**
   * draw(c2d, t, ui) — the visible controller, in LOGICAL 1920x1080 coordinates.
   * Cheap on purpose: flat fills and strokes, no shadowBlur, no gradients, no filters.
   * Those are the three Canvas2D features that blow a 1.80 ms budget fastest.
   */
  draw(c2d, t, ui) {
    const v = ui.visible || { x: 0, y: 0, w: ui.W, h: ui.H };
    const st = impl._draw;
    if (!st) return;
    const L = (fx, fy) => { TMP.x = v.x + fx * v.w; TMP.y = v.y + fy * v.h; };

    c2d.save();
    c2d.lineWidth = 3;

    // stick well
    L(0.11, 0.80);
    const wellX = TMP.x, wellY = TMP.y;
    const wellR = v.w * 0.085;
    c2d.strokeStyle = 'rgba(220,228,240,0.22)';
    c2d.beginPath(); c2d.arc(wellX, wellY, wellR, 0, 6.28318); c2d.stroke();

    // stick head — follows the thumb
    let hx = wellX, hy = wellY;
    if (st.stickActive) {
      hx = wellX + st.stickX * wellR;
      hy = wellY + st.stickY * wellR;
    }
    c2d.fillStyle = st.stickActive ? 'rgba(255,214,64,0.85)' : 'rgba(220,228,240,0.30)';
    c2d.beginPath(); c2d.arc(hx, hy, wellR * 0.42, 0, 6.28318); c2d.fill();

    // buttons
    const btn = (fx, fy, r, on, label) => {
      L(fx, fy);
      c2d.fillStyle = on ? 'rgba(255,214,64,0.85)' : 'rgba(220,228,240,0.16)';
      c2d.beginPath(); c2d.arc(TMP.x, TMP.y, v.w * r, 0, 6.28318); c2d.fill();
      c2d.strokeStyle = 'rgba(220,228,240,0.30)';
      c2d.beginPath(); c2d.arc(TMP.x, TMP.y, v.w * r, 0, 6.28318); c2d.stroke();
      c2d.fillStyle = on ? '#101014' : 'rgba(230,230,236,0.72)';
      c2d.font = '700 34px "Liberation Sans",Arial,sans-serif';
      c2d.textAlign = 'center'; c2d.textBaseline = 'middle';
      c2d.fillText(label, TMP.x, TMP.y);
    };
    btn(0.86, 0.84, 0.075, st.btnA, 'A');
    btn(0.895, 0.60, 0.052, st.btnB, 'B');
    btn(0.685, 0.60, 0.052, st.turbo, 'T');

    c2d.restore();
  },

  /** The controller NEVER scales with quality. Feel is not a dependent variable. */
  applyRung() { },
};

const TMP = { x: 0, y: 0 };
const SCRATCH_IDX = new Int32Array(64);

export default impl;
