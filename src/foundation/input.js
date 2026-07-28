// FOUNDATION — FROZEN after t=0. Do not edit.
// Keyboard / gamepad state for the interactive (`?quality=live`) path.
// Capture runs never read this — a still frame is a pure function of (scene, seed, t),
// so input is inert in capture mode by construction.

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

  return Object.assign(state, {
    update() {
      let ax = (state.right ? 1 : 0) - (state.left ? 1 : 0);
      let ay = (state.up ? 1 : 0) - (state.down ? 1 : 0);
      const pads = (navigator.getGamepads && navigator.getGamepads()) || [];
      for (const p of pads) {
        if (!p) continue;
        if (Math.abs(p.axes[0]) > 0.15) ax = p.axes[0];
        if (Math.abs(p.axes[1]) > 0.15) ay = -p.axes[1];
        if (p.buttons[0] && p.buttons[0].pressed) state.a = true;
        if (p.buttons[1] && p.buttons[1].pressed) state.b = true;
        if (p.buttons[6] && p.buttons[6].pressed) state.turbo = true;
      }
      state.axisX = ax;
      state.axisY = ay;
    },
    /** One-shot edge read; returns true once per press. */
    consume(k) {
      if (state.pressed[k]) { state.pressed[k] = false; return true; }
      return false;
    },
    dispose() {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    },
  });
}

export default { createInput };
