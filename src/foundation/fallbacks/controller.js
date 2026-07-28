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

/* ------------------------------------------------------- THE REACH-FIRST LAYOUT
 *
 * REACH IS A PHYSICAL QUESTION AND A FRACTIONAL LAYOUT CANNOT ANSWER IT.
 *
 * The old layout was a table of constants in 0..1 of each axis independently. That
 * silently makes every control's distance from the thumb pivot a function of the
 * ASPECT RATIO, because the same fraction is a different number of millimetres on the
 * long axis than on the short one. Measured by `touch.mjs`:
 *
 *     390x844 portrait   TURBO centre  44.4 mm from the right thumb pivot   (cap 40)
 *     844x390 landscape  TURBO centre  55.3 mm from the right thumb pivot   (cap 40)
 *
 * One layout, one budget, two failures, and the landscape one is 38% over. The fix is
 * not to nudge the fractions — no set of fractions satisfies both orientations. The
 * layout is now anchored in CSS PIXELS to the two bottom-corner thumb pivots and
 * converted to fractions for whatever surface is actually in front of the player, so
 * the same physical geometry is produced at every aspect ratio.
 *
 * THE BUDGET, IN PIXELS. A 390-pt-wide phone panel is 71.5 mm across, so one CSS px is
 * 0.18333 mm and the 40 mm thumb-reach cap is 218.2 CSS px. Every control centre below
 * sits inside 190 px (34.8 mm) of its pivot, which leaves ~5 mm of margin for a panel
 * whose CSS pixel is slightly larger than an iPhone's.
 *
 * Offsets are (dx, dy) from the pivot, dx positive INWARD from the near edge and dy
 * positive UPWARD from the bottom. Half-sizes are the hit rectangle, not the artwork.
 */

/** 40 mm at 0.18333 mm per CSS px. The number the layout below is built to satisfy. */
export const REACH_PX = 218;

/** Drawn button radius in CSS px. 48 px across = 8.8 mm: the platform minimum target. */
export const BUTTON_R_PX = 24;

const LAYOUT = [
  // zone,            side,     dx,   dy,   halfW, halfH        centre distance
  [ZONE.STICK, 'L', 82, 128, 88, 128],   // 152 px = 27.9 mm
  [ZONE.TURBO, 'R', 150, 116, 52, 46],   // 190 px = 34.8 mm
  [ZONE.ACTION_B, 'R', 44, 164, 54, 58],   // 170 px = 31.1 mm
  [ZONE.ACTION_A, 'R', 88, 46, 78, 40],   // 99 px = 18.2 mm
];

/**
 * HOME POINTS — where each control is DRAWN, and therefore where a thumb actually goes.
 * Derived from the same table as the hit rectangles, so drawing and reach cannot drift
 * apart. `touch.mjs` checks BOTH the home point and the rectangle centre against the
 * 40 mm cap; they are the same point here by construction.
 */
export const ZONE_HOMES = [
  [ZONE.STICK, 0, 0],
  [ZONE.TURBO, 0, 0],
  [ZONE.ACTION_B, 0, 0],
  [ZONE.ACTION_A, 0, 0],
];

/**
 * Zone rectangles as fractions of the VISIBLE surface, RECOMPUTED for the live surface
 * by `setSurface`. Exported (and mutated in place) so `touch.mjs` reads the real zones
 * instead of a second copy that drifts. Declared with zeros and filled by the
 * `layoutZones(390, 844)` call below, so anything that reads the table before the first
 * `setSurface` still gets the portrait solution.
 */
export const ZONE_RECTS = [
  [ZONE.STICK, 0, 0, 0, 0],
  [ZONE.TURBO, 0, 0, 0, 0],
  [ZONE.ACTION_B, 0, 0, 0, 0],
  [ZONE.ACTION_A, 0, 0, 0, 0],
];

/**
 * WHERE THE ARTWORK GOES: [zone, centreXfrac, centreYfrac, radiusFracOfSurfaceWidth].
 *
 * `draw()` used to carry its OWN hardcoded fractions — the turbo pad was drawn at
 * (0.685, 0.60) while its hit rectangle was somewhere else entirely — so the player
 * could see a control and press a different one. There is now exactly one table, this
 * one, derived from the same LAYOUT as the hit rectangles.
 */
export const ZONE_ART = [
  [ZONE.STICK, 0, 0, 0],
  [ZONE.TURBO, 0, 0, 0],
  [ZONE.ACTION_B, 0, 0, 0],
  [ZONE.ACTION_A, 0, 0, 0],
];

/**
 * Rebuild ZONE_RECTS, ZONE_HOMES and ZONE_ART for a w x h CSS surface. Allocation-free:
 * all three tables are mutated in place and the rows are read by index rather than
 * destructured (array destructuring allocates an iterator). `setSurface` is called on
 * every orientation change, which can happen mid-play.
 *
 * The three tables above are declared with zeros and filled by the call immediately
 * below this function, so there is exactly one place any of these numbers is computed.
 */
export function layoutZones(w, h) {
  const W = Math.max(16, w), H = Math.max(16, h);
  const pivotLX = 0.02 * W, pivotRX = 0.98 * W, pivotY = 0.99 * H;
  for (let i = 0; i < LAYOUT.length; i++) {
    const row = LAYOUT[i];
    const zone = row[0], side = row[1], dx = row[2], dy = row[3], halfW = row[4], halfH = row[5];
    const cx = side === 'L' ? pivotLX + dx : pivotRX - dx;
    const cy = pivotY - dy;
    // Clamp the RECTANGLE to the surface. The centre can shift by at most the amount
    // that was hanging off the edge, which is small, and the reach check is run against
    // the clamped centre so the number in the report is the one the player gets.
    const x0 = Math.max(0, cx - halfW), x1 = Math.min(W, cx + halfW);
    const y0 = Math.max(0, cy - halfH), y1 = Math.min(H, cy + halfH);
    const r = ZONE_RECTS[i];
    r[0] = zone; r[1] = x0 / W; r[2] = y0 / H; r[3] = x1 / W; r[4] = y1 / H;
    const hm = ZONE_HOMES[i];
    hm[0] = zone; hm[1] = cx / W; hm[2] = cy / H;
    const art = ZONE_ART[i];
    // THE ARTWORK IS SMALLER THAN THE HIT RECTANGLE, AND THAT IS DELIBERATE.
    //
    // A button that looks bigger than it is, is a button that misses; a button that
    // looks smaller than it is, is a button that forgives. The hit rectangles above are
    // generous on purpose. The DRAWN radius is a fixed 24 CSS px — a 48 px, 8.8 mm
    // target, which is the platform minimum — and it is fixed in PIXELS for the same
    // reason the layout is: a control's size is a physical question.
    //
    // It is also a performance number. Sizing the artwork to the hit rectangle instead
    // made the three buttons 1.4x their previous total fill area, and Canvas2D fill is
    // what the `overlay` span costs on this box: the span went from p95 1.80 ms to
    // p95 2.40 ms at the floor tier's 6x CPU emulation for no visual gain. 24 px puts
    // the total drawn area back where it was.
    const rCss = zone === ZONE.STICK ? TUNING.stickRadiusPx : BUTTON_R_PX;
    art[0] = zone; art[1] = cx / W; art[2] = cy / H; art[3] = rCss / W;
  }
  return ZONE_RECTS;
}
layoutZones(390, 844);

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
  ZONE, GESTURE, GESTURE_NAME, DIR, TUNING, ZONE_RECTS, ZONE_HOMES, ZONE_ART, REACH_PX,

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

  // The layout is PHYSICAL, so it is rebuilt whenever the surface changes shape. This
  // is the only place ZONE_RECTS is written, and main.js calls it at boot, on resize,
  // on orientationchange and on a present-rate change.
  setSurface(st, w, h) { st.w = w; st.h = h; layoutZones(w, h); },

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

    // EVERY position below comes from ZONE_ART, which layoutZones() derives from the
    // same LAYOUT table as the hit rectangles. Drawn position and hit position are the
    // same number by construction; they used to be two hardcoded tables that disagreed.
    const art = (zone) => {
      for (let i = 0; i < ZONE_ART.length; i++) if (ZONE_ART[i][0] === zone) return ZONE_ART[i];
      return null;
    };

    // stick well
    const sa = art(ZONE.STICK);
    L(sa[1], sa[2]);
    const wellX = TMP.x, wellY = TMP.y;
    const wellR = v.w * sa[3];
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
    const btn = (zone, on, label) => {
      const a = art(zone);
      if (!a) return;
      L(a[1], a[2]);
      const r = v.w * a[3];
      c2d.fillStyle = on ? 'rgba(255,214,64,0.85)' : 'rgba(220,228,240,0.16)';
      c2d.beginPath(); c2d.arc(TMP.x, TMP.y, r, 0, 6.28318); c2d.fill();
      c2d.strokeStyle = 'rgba(220,228,240,0.30)';
      c2d.beginPath(); c2d.arc(TMP.x, TMP.y, r, 0, 6.28318); c2d.stroke();
      c2d.fillStyle = on ? '#101014' : 'rgba(230,230,236,0.72)';
      c2d.font = '700 34px "Liberation Sans",Arial,sans-serif';
      c2d.textAlign = 'center'; c2d.textBaseline = 'middle';
      c2d.fillText(label, TMP.x, TMP.y);
    };
    btn(ZONE.ACTION_A, st.btnA, 'A');
    btn(ZONE.ACTION_B, st.btnB, 'B');
    btn(ZONE.TURBO, st.turbo, 'T');

    c2d.restore();
  },

  /** The controller NEVER scales with quality. Feel is not a dependent variable. */
  applyRung() { },
};

const TMP = { x: 0, y: 0 };
const SCRATCH_IDX = new Int32Array(64);

export default impl;
