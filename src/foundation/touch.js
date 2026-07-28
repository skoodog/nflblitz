// FOUNDATION — PERFCORE. The raw touch bus.
//
// OWNERSHIP LINE (do not cross it):
//   FOUNDATION (this file) owns the RAW, TIMESTAMPED event bus and the frame-boundary
//     snapshot. It knows about pointers, coordinates, timestamps, capture, and loss.
//     It knows NOTHING about thumbsticks, buttons, jukes or feel.
//   THE `touch-controller` PIECE owns zones, gesture recognition, dead zones, curves,
//     haptics and feel. It reads `touch.pointers` and `touch.events` and nothing else.
//
// WHY POINTER EVENTS AND NOT TOUCH EVENTS
//   setPointerCapture keeps a pointer bound to the element after the finger slides off
//   it, which is exactly what a virtual thumbstick needs, and getCoalescedEvents()
//   returns the sub-frame samples the OS captured between vsyncs, which is what makes
//   a swipe's direction accurate instead of a two-sample guess.
//
// LATENCY MODEL
//   Events land in a preallocated ring from the DOM callback. `drain(nowMs)` is called
//   at the TOP of the frame, BEFORE the sim step, and each event is assigned to the sim
//   tick its OWN timestamp falls in. So a touch that landed 4 ms before this frame's
//   step affects THAT step, not the next one. That is the difference between 2-frame
//   and 3-frame response and it is free.

export const EV_DOWN = 0, EV_MOVE = 1, EV_UP = 2, EV_CANCEL = 3;
export const MAX_POINTERS = 10;
const QCAP = 1024;

/** Default touch-slop in CSS px. The controller may use its own; this is the floor. */
export const TOUCH_SLOP_PX = 8;

export function createTouch(element, opts) {
  const o = opts || {};
  const nowFn = (typeof performance !== 'undefined' && performance.now)
    ? () => performance.now() : () => Date.now();

  // ---- lock-free-ish ring. DOM callbacks write; the frame drains. Preallocated. ----
  const qType = new Int8Array(QCAP);
  const qId = new Int32Array(QCAP);
  const qX = new Float32Array(QCAP);
  const qY = new Float32Array(QCAP);
  const qT = new Float64Array(QCAP);
  let qHead = 0, qTail = 0, qDropped = 0;

  // ---- pointer table. Fixed slots, pooled objects, zero allocation. ----
  const pointers = new Array(MAX_POINTERS);
  for (let i = 0; i < MAX_POINTERS; i++) {
    pointers[i] = {
      slot: i, active: false, id: -1,
      x: 0, y: 0, px: 0, py: 0, startX: 0, startY: 0,
      dx: 0, dy: 0, totalDx: 0, totalDy: 0,
      startMs: 0, lastMs: 0, downTick: -1,
      moved: false, maxDist: 0,
      /** Free for the controller to stamp: which zone claimed this pointer. */
      claim: 0, claimData: 0,
      /** The telemetry log entry for the DOWN of this pointer (latency correlation). */
      logEntry: null,
    };
  }
  const byId = new Map();          // pointerId -> slot. Map ops do not allocate per call.

  // ---- per-frame event view: pooled records the controller iterates ----
  const frameEvents = new Array(256);
  for (let i = 0; i < 256; i++) {
    frameEvents[i] = { type: 0, id: 0, slot: -1, x: 0, y: 0, ms: 0, tick: 0, entry: null };
  }
  let frameEventN = 0;

  const state = {
    EV_DOWN, EV_MOVE, EV_UP, EV_CANCEL, TOUCH_SLOP_PX,
    pointers,
    get events() { return frameEvents; },
    get eventCount() { return frameEventN; },
    activeCount: 0,
    droppedEvents: 0,
    totalEvents: 0,
    stuck: 0,
    /** Rect of the surface in CSS px; refreshed on resize/orientation. */
    rect: { x: 0, y: 0, w: 1, h: 1 },
    safe: { top: 0, right: 0, bottom: 0, left: 0 },
    enabled: false,
  };

  if (!element || typeof window === 'undefined') {
    return Object.assign(state, {
      drain() { frameEventN = 0; return 0; },
      dispose() { }, releaseAll() { }, measure() { },
    });
  }
  state.enabled = true;

  /* ------------------------------------------------------------ safe area */

  function measureSafeArea() {
    try {
      const probe = document.createElement('div');
      probe.style.cssText =
        'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
        'padding-top:env(safe-area-inset-top,0px);padding-right:env(safe-area-inset-right,0px);' +
        'padding-bottom:env(safe-area-inset-bottom,0px);padding-left:env(safe-area-inset-left,0px);';
      document.body.appendChild(probe);
      const cs = getComputedStyle(probe);
      state.safe.top = parseFloat(cs.paddingTop) || 0;
      state.safe.right = parseFloat(cs.paddingRight) || 0;
      state.safe.bottom = parseFloat(cs.paddingBottom) || 0;
      state.safe.left = parseFloat(cs.paddingLeft) || 0;
      document.body.removeChild(probe);
    } catch (e) { /* non-notched device or no DOM: zeros are correct */ }
  }

  function measure() {
    const r = element.getBoundingClientRect();
    state.rect.x = r.left; state.rect.y = r.top;
    state.rect.w = r.width || 1; state.rect.h = r.height || 1;
    measureSafeArea();
  }
  measure();

  /* --------------------------------------------------------------- enqueue */

  function push(type, id, clientX, clientY, tsMs) {
    const next = (qHead + 1) % QCAP;
    if (next === qTail) { qDropped++; state.droppedEvents = qDropped; return; }
    qType[qHead] = type;
    qId[qHead] = id;
    qX[qHead] = clientX - state.rect.x;
    qY[qHead] = clientY - state.rect.y;
    qT[qHead] = tsMs;
    qHead = next;
    state.totalEvents++;
  }

  /**
   * Pointer event timeStamp is a DOMHighResTimeStamp on the same origin as
   * performance.now() in Chromium. We validate it anyway: a synthetic event injected
   * by a test harness or a legacy engine can carry an epoch-based stamp, and silently
   * trusting it would produce fictional latency numbers.
   */
  function stampOf(e) {
    const t = e.timeStamp;
    const n = nowFn();
    if (typeof t === 'number' && t > 0 && t <= n + 4 && t > n - 5000) return t;
    return n;
  }

  /* ------------------------------------------------------------- listeners */

  function onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try { element.setPointerCapture(e.pointerId); } catch (err) { /* already captured */ }
    push(EV_DOWN, e.pointerId, e.clientX, e.clientY, stampOf(e));
    if (e.cancelable) e.preventDefault();
  }

  function onMove(e) {
    if (!byId.has(e.pointerId) && !hasQueuedDown(e.pointerId)) return;   // not ours
    // Sub-frame accuracy: the OS captured samples between vsyncs; use all of them.
    const co = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
    if (co && co.length > 1) {
      for (let i = 0; i < co.length; i++) {
        const c = co[i];
        push(EV_MOVE, e.pointerId, c.clientX, c.clientY, stampOf(c));
      }
    } else {
      push(EV_MOVE, e.pointerId, e.clientX, e.clientY, stampOf(e));
    }
    if (e.cancelable) e.preventDefault();
  }

  function onUp(e) {
    push(EV_UP, e.pointerId, e.clientX, e.clientY, stampOf(e));
    try { element.releasePointerCapture(e.pointerId); } catch (err) { /* gone */ }
    if (e.cancelable) e.preventDefault();
  }

  function onCancel(e) {
    push(EV_CANCEL, e.pointerId, e.clientX, e.clientY, stampOf(e));
    try { element.releasePointerCapture(e.pointerId); } catch (err) { /* gone */ }
  }

  // A queued-but-not-yet-drained DOWN must be recognised, or the first MOVE of a fast
  // flick is discarded and the swipe direction is wrong.
  function hasQueuedDown(id) {
    for (let i = qTail; i !== qHead; i = (i + 1) % QCAP) {
      if (qId[i] === id && qType[i] === EV_DOWN) return true;
    }
    return false;
  }

  /** Release every pointer. The ONLY correct response to losing the surface. */
  function releaseAll(reason) {
    const t = nowFn();
    for (let i = 0; i < MAX_POINTERS; i++) {
      const p = pointers[i];
      if (p.active) push(EV_CANCEL, p.id, p.x + state.rect.x, p.y + state.rect.y, t);
    }
    void reason;
  }

  const onVisibility = () => { if (document.visibilityState !== 'visible') releaseAll('visibility'); };
  const onBlur = () => releaseAll('blur');
  const onOrient = () => { measure(); releaseAll('orientation'); };
  const onResize = () => measure();
  const onCtxMenu = (e) => e.preventDefault();
  // touchcancel is not always mirrored to pointercancel on every Android WebView build.
  const onTouchCancel = () => releaseAll('touchcancel');

  const passiveFalse = { passive: false };
  element.addEventListener('pointerdown', onDown, passiveFalse);
  element.addEventListener('pointermove', onMove, passiveFalse);
  element.addEventListener('pointerup', onUp, passiveFalse);
  element.addEventListener('pointercancel', onCancel, passiveFalse);
  element.addEventListener('lostpointercapture', onCancel, passiveFalse);
  element.addEventListener('touchcancel', onTouchCancel, passiveFalse);
  element.addEventListener('contextmenu', onCtxMenu, passiveFalse);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('blur', onBlur);
  window.addEventListener('orientationchange', onOrient);
  window.addEventListener('resize', onResize);

  /* ----------------------------------------------------------------- drain */

  function slotFor(id) {
    const s = byId.get(id);
    if (s !== undefined) return s;
    for (let i = 0; i < MAX_POINTERS; i++) if (!pointers[i].active) return i;
    return -1;
  }

  /**
   * drain(nowMs, clock, telemetry) — call at the TOP of the frame, before the sim step.
   * Returns the number of events applied. Allocation-free.
   */
  function drain(nowMs, clock, telemetry) {
    frameEventN = 0;
    let applied = 0;
    while (qTail !== qHead) {
      const i = qTail;
      qTail = (qTail + 1) % QCAP;
      const type = qType[i], id = qId[i], x = qX[i], y = qY[i], ms = qT[i];

      // Assign the event to the sim tick ITS OWN timestamp falls in.
      const ageSec = (nowMs - ms) / 1000;
      const tick = clock ? clock.tickForOffset(-ageSec) : 0;

      let slot = byId.get(id);
      if (type === EV_DOWN) {
        if (slot === undefined) {
          slot = slotFor(id);
          if (slot < 0) continue;                 // >10 fingers: ignore, never grow
          byId.set(id, slot);
        }
        const p = pointers[slot];
        p.active = true; p.id = id;
        p.x = p.px = p.startX = x;
        p.y = p.py = p.startY = y;
        p.dx = 0; p.dy = 0; p.totalDx = 0; p.totalDy = 0;
        p.startMs = ms; p.lastMs = ms; p.downTick = tick;
        p.moved = false; p.maxDist = 0; p.claim = 0; p.claimData = 0;
        p.logEntry = telemetry ? telemetry.logInput(id, EV_DOWN, x, y, ms, nowMs, tick) : null;
      } else if (slot !== undefined) {
        const p = pointers[slot];
        if (type === EV_MOVE) {
          p.px = p.x; p.py = p.y;
          p.x = x; p.y = y;
          p.dx += x - p.px; p.dy += y - p.py;
          p.totalDx = x - p.startX; p.totalDy = y - p.startY;
          const d = Math.sqrt(p.totalDx * p.totalDx + p.totalDy * p.totalDy);
          if (d > p.maxDist) p.maxDist = d;
          if (d > TOUCH_SLOP_PX) p.moved = true;
          p.lastMs = ms;
          if (telemetry) telemetry.logInput(id, EV_MOVE, x, y, ms, nowMs, tick);
        } else {
          // UP or CANCEL: the slot stays readable for THIS frame so the controller can
          // resolve a tap, then is freed at the end of drain.
          p.x = x; p.y = y; p.lastMs = ms;
          if (telemetry) telemetry.logInput(id, type, x, y, ms, nowMs, tick);
        }
      } else {
        continue;                                  // UP/CANCEL for a pointer we never saw
      }

      if (frameEventN < frameEvents.length) {
        const fe = frameEvents[frameEventN++];
        fe.type = type; fe.id = id; fe.slot = slot;
        fe.x = x; fe.y = y; fe.ms = ms; fe.tick = tick;
        fe.entry = (type === EV_DOWN && slot !== undefined) ? pointers[slot].logEntry : null;
      }
      applied++;
    }

    // Retire pointers whose UP/CANCEL was seen this frame.
    for (let i = 0; i < frameEventN; i++) {
      const fe = frameEvents[i];
      if (fe.type !== EV_UP && fe.type !== EV_CANCEL) continue;
      const s = byId.get(fe.id);
      if (s === undefined) continue;
      const p = pointers[s];
      p.active = false; p.id = -1; p.claim = 0; p.logEntry = null;
      byId.delete(fe.id);
    }

    let n = 0;
    for (let i = 0; i < MAX_POINTERS; i++) if (pointers[i].active) n++;
    state.activeCount = n;
    state.stuck = byId.size !== n ? byId.size - n : 0;
    return applied;
  }

  function dispose() {
    element.removeEventListener('pointerdown', onDown);
    element.removeEventListener('pointermove', onMove);
    element.removeEventListener('pointerup', onUp);
    element.removeEventListener('pointercancel', onCancel);
    element.removeEventListener('lostpointercapture', onCancel);
    element.removeEventListener('touchcancel', onTouchCancel);
    element.removeEventListener('contextmenu', onCtxMenu);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('orientationchange', onOrient);
    window.removeEventListener('resize', onResize);
    byId.clear();
    for (let i = 0; i < MAX_POINTERS; i++) pointers[i].active = false;
  }

  return Object.assign(state, { drain, dispose, releaseAll, measure });
}

export default { createTouch, EV_DOWN, EV_MOVE, EV_UP, EV_CANCEL, MAX_POINTERS, TOUCH_SLOP_PX };
