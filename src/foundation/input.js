// FOUNDATION — PERFCORE owns this file.
// Keyboard / gamepad state for the interactive (`?quality=live`) path.
// Capture runs never read this — a still frame is a pure function of (scene, seed, t),
// so input is inert in capture mode by construction.
//
// THIS IS DEBUG-ONLY CODE AND IT WAS ON THE FRAME PATH. `update()` is called from the
// loop's `input` span every presented frame, and it used to call
// `navigator.getGamepads()` unconditionally. That call is not free: Chromium copies the
// gamepad buffer and returns a fresh GamepadList on every invocation, and iterating it
// with for..of allocates an iterator. Measured on this box at the floor tier's 6x CPU
// emulation, the `input` span read p95 0.90 ms against a 0.20 ms budget with the poll
// in, and it is the only thing in that span besides `touch.drain`. The game is played
// with two thumbs; a gamepad is a convenience for a developer at a desk. So the poll is
// now armed by `gamepadconnected` and disarmed by `gamepaddisconnected`, which is the
// event pair the API exists to provide. With no pad attached — every phone, and every
// harness run — `update()` touches nine booleans and returns.

const KEYMAP = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
  ShiftLeft: 'turbo', ShiftRight: 'turbo', Space: 'turbo',
  KeyJ: 'a', Enter: 'a',
  KeyK: 'b', Escape: 'b',
  KeyL: 'x', KeyI: 'y',
};

export function createInput(enabled) {
  const state = {
    up: false, down: false, left: false, right: false,
    turbo: false, a: false, b: false, x: false, y: false,
    axisX: 0, axisY: 0,
    pressed: Object.create(null),
    enabled: !!enabled,
  };

  if (!enabled || typeof window === 'undefined') {
    return Object.assign(state, { update() { }, dispose() { }, consume: () => false });
  }

  const down = (e) => {
    const k = KEYMAP[e.code];
    if (!k) return;
    if (!state[k]) state.pressed[k] = true;
    state[k] = true;
    e.preventDefault();
  };
  const up = (e) => {
    const k = KEYMAP[e.code];
    if (!k) return;
    state[k] = false;
    e.preventDefault();
  };
  window.addEventListener('keydown', down, { passive: false });
  window.addEventListener('keyup', up, { passive: false });

  // Gamepad polling is armed by the connection event and by nothing else. `pads` is 0
  // on every phone and in every harness run, so the poll below never executes there.
  let pads = 0;
  const onPadConnect = () => { pads++; };
  const onPadDisconnect = () => { if (pads > 0) pads--; };
  window.addEventListener('gamepadconnected', onPadConnect);
  window.addEventListener('gamepaddisconnected', onPadDisconnect);

  return Object.assign(state, {
    update() {
      let ax = (state.right ? 1 : 0) - (state.left ? 1 : 0);
      let ay = (state.up ? 1 : 0) - (state.down ? 1 : 0);
      if (pads > 0 && navigator.getGamepads) {
        const list = navigator.getGamepads();
        // Indexed, not for..of: the iterator protocol allocates and this runs inside the
        // loop's `input` span.
        for (let i = 0; i < list.length; i++) {
          const p = list[i];
          if (!p) continue;
          if (Math.abs(p.axes[0]) > 0.15) ax = p.axes[0];
          if (Math.abs(p.axes[1]) > 0.15) ay = -p.axes[1];
          if (p.buttons[0] && p.buttons[0].pressed) state.a = true;
          if (p.buttons[1] && p.buttons[1].pressed) state.b = true;
          if (p.buttons[6] && p.buttons[6].pressed) state.turbo = true;
        }
      }
      state.axisX = ax;
      state.axisY = ay;
    },
    get gamepadsAttached() { return pads; },
    /** One-shot edge read; returns true once per press. */
    consume(k) {
      if (state.pressed[k]) { state.pressed[k] = false; return true; }
      return false;
    },
    dispose() {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('gamepadconnected', onPadConnect);
      window.removeEventListener('gamepaddisconnected', onPadDisconnect);
    },
  });
}

export default { createInput };
