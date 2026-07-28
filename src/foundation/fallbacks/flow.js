// FOUNDATION FALLBACK — replaced by piece `game-flow` via registerFlow().
//
// GAME FLOW: the state machine that owns what screen you are on and what happens
// between plays. It exists in the foundation for one reason that is a performance
// reason, not a design one: THE PLAY BOUNDARY IS THE ONLY PLACE A HITCH IS INVISIBLE.
//
// The adaptive scaler classifies rung changes into cheap ones (particle count, render
// scale, shadow resolution) that cross-fade live, and EXPENSIVE ones (post pass count,
// shadow on/off, actor LOD class) that would cost a visible stall. Expensive changes are
// QUEUED and committed here, at `enterPlay()` — behind a wipe, where the player cannot
// see them. Without a flow owner there is nowhere to put that rule, and every expensive
// rung change becomes a stutter in the middle of a play.
//
// STATES
//   BOOT -> TITLE -> TEAM_SELECT -> PLAYCALL -> PLAY -> RESULT -> PLAYCALL ...
//
// Everything here is TICK-DRIVEN. No wall clock, no setTimeout. A transition scheduled
// for tick N happens on tick N at 60 Hz and at 30 Hz alike.

export const STATE = Object.freeze({
  BOOT: 0, TITLE: 1, TEAM_SELECT: 2, PLAYCALL: 3, PLAY: 4, RESULT: 5,
});
export const STATE_NAME = ['boot', 'title', 'team_select', 'playcall', 'play', 'result'];

/** Which UI screen each state shows. null = in-game HUD only. */
const SCREEN_FOR = [null, 'title', 'teamSelect', 'playcall', null, null];

const impl = {
  piece: 'foundation-fallback',
  STATE, STATE_NAME,

  create() {
    return {
      state: STATE.BOOT,
      prevState: STATE.BOOT,
      enteredTick: 0,
      tick: 0,
      playCount: 0,
      // A commit the scaler has queued for the next play boundary.
      pendingRung: -1,
      pendingReason: 0,
      committedRung: -1,
      commits: 0,
      // Set true for exactly one tick when a boundary is crossed.
      boundary: false,
    };
  },

  /** Ticks spent in the current state. The only "time" flow ever reads. */
  age(st) { return st.tick - st.enteredTick; },

  go(st, next, tick) {
    if (next === st.state) return false;
    st.prevState = st.state;
    st.state = next;
    st.enteredTick = tick;
    st.boundary = true;
    if (next === STATE.PLAY) st.playCount++;
    return true;
  },

  /**
   * The scaler calls this when it wants an EXPENSIVE rung change. It is not applied
   * now — it is parked until the next play boundary.
   */
  queueRung(st, rung, reason) {
    st.pendingRung = rung;
    st.pendingReason = reason || 0;
  },

  /**
   * enterPlay(st, tick) — the boundary. Any queued expensive rung change is committed
   * HERE, where a hitch is hidden by the transition, and nowhere else.
   * Returns the rung that was committed, or -1.
   */
  enterPlay(st, tick) {
    impl.go(st, STATE.PLAY, tick);
    if (st.pendingRung >= 0) {
      st.committedRung = st.pendingRung;
      st.pendingRung = -1;
      st.commits++;
      return st.committedRung;
    }
    return -1;
  },

  /** Pure tick step. Drives the fallback's automatic demo progression. */
  step(st, tick) {
    st.tick = tick;
    st.boundary = false;
    const age = tick - st.enteredTick;
    switch (st.state) {
      case STATE.BOOT: if (age >= 30) impl.go(st, STATE.TITLE, tick); break;
      case STATE.TITLE: if (age >= 180) impl.go(st, STATE.PLAYCALL, tick); break;
      case STATE.TEAM_SELECT: if (age >= 180) impl.go(st, STATE.PLAYCALL, tick); break;
      case STATE.PLAYCALL: if (age >= 120) impl.enterPlay(st, tick); break;
      case STATE.PLAY: if (age >= 420) impl.go(st, STATE.RESULT, tick); break;
      case STATE.RESULT: if (age >= 120) impl.go(st, STATE.PLAYCALL, tick); break;
      default: break;
    }
    return st.state;
  },

  screenFor(st) { return SCREEN_FOR[st.state] || null; },
  hudVisible(st) { return st.state === STATE.PLAY || st.state === STATE.RESULT; },

  hash(st) {
    let h = 2166136261 >>> 0;
    const mix = (v) => { h ^= (v | 0) >>> 0; h = Math.imul(h, 16777619) >>> 0; };
    mix(st.state); mix(st.enteredTick); mix(st.playCount); mix(st.commits);
    return h >>> 0;
  },

  applyRung() { /* flow never scales. */ },
};

export default impl;
