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
// LATENCY MODEL — AND WHY THIS SURVIVES 30 Hz
//   Events land in a preallocated ring from the DOM callback, timestamped with the
//   event's OWN DOMHighResTimeStamp, at whatever rate the OS delivers them — which is
//   NOT the present rate. `drain(nowMs, clock)` runs at the top of the frame, AFTER
//   clock.accumulate() has decided how many sim steps this frame owes, and assigns each
//   event to the sim tick its own timestamp falls in via `clock.tickForStamp()`.
//
//   That decoupling is the whole answer to the amendment's timing risk. At 30 Hz a
//   frame runs sim ticks T and T+1. An event stamped in the first half of the 33.3 ms
//   window lands on T; one stamped in the second half lands on T+1. So a juke window is
//   still judged at 60 Hz granularity even though only 30 frames are drawn, and the
//   sim state a player is judged against is identical to what it would have been at
//   60 Hz. Presenting at 30 costs the player DISPLAY latency; it does not cost them
//   TIMING resolution. Those are different things and only one of them was traded.

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
      /**
       * A release (UP or CANCEL) for this pointer was processed in the CURRENT drain.
       * The slot stays readable for the rest of the frame so the controller can resolve
       * a tap, and is retired at the end of drain. See the retirement note below.
       */
      released: false,
      /** Free for the controller to stamp: which zone claimed this pointer. */
      claim: 0, claimData: 0,
      /** The telemetry log entry for the DOWN of this pointer (latency correlation). */
      logEntry: null,
    };
  }

  /**
   * THE POINTER TABLE IS THE ONLY SOURCE OF TRUTH FOR pointerId -> slot.
   *
   * This used to be a `Map` kept alongside the table, and the two could disagree. That
   * is the stuck-touch bug `touch.mjs` caught at 1 in 50 pointercancels, and it had
   * three separate ways to happen:
   *
   *   1. `pointercancel` is followed immediately by `lostpointercapture`, and BOTH were
   *      bound to the same handler, so every cancel enqueued TWO cancel records for the
   *      same id. If a DOWN for that id arrived between the two drains, the second
   *      cancel retired a pointer that had already been re-acquired.
   *   2. Retirement iterated `frameEvents`, a fixed 256-entry window. An UP or CANCEL
   *      that fell past entry 256 in a burst was applied to the pointer but never
   *      retired it: the slot stayed `active` forever with no finger on the glass.
   *   3. DOWN, UP, DOWN for the same id inside ONE drain retired the pointer AFTER the
   *      second DOWN had re-armed it, so a live finger was silently dropped.
   *
   * A ten-entry linear scan is faster than a Map lookup at this size, allocates nothing,
   * and cannot desynchronise from the table because it IS the table.
   */
  function slotOf(id) {
    for (let i = 0; i < MAX_POINTERS; i++) if (pointers[i].active && pointers[i].id === id) return i;
    return -1;
  }
  function freeSlot() {
    for (let i = 0; i < MAX_POINTERS; i++) if (!pointers[i].active) return i;
    return -1;
  }

  /**
   * WATCHDOG. A pointer that has produced no event at all for this long has been lost by
   * the OS or the WebView — the classic Android "the pointerup never arrived" bug. It is
   * released rather than left holding a control down forever. The window is deliberately
   * far longer than any real hold: a player holding TURBO stationary generates no move
   * events, and cancelling that would be a worse bug than the one being fixed.
   */
  const STALE_MS = 20000;

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
    /**
     * Pointers still marked active even though a release for them was processed. The
     * retirement invariant makes this structurally zero; it is still counted, because a
     * gate whose value is only ever asserted is not a gate.
     */
    stuck: 0,
    /** Pointers released by the STALE_MS watchdog over the life of the bus. */
    stale: 0,
    /** Rect of the surface in CSS px; refreshed on resize/orientation. */
    rect: { x: 0, y: 0, w: 1, h: 1 },
    safe: { top: 0, right: 0, bottom: 0, left: 0 },
    enabled: false,
  };

  if (!element || typeof window === 'undefined') {
    return Object.assign(state, {
      drain() { frameEventN = 0; return 0; },
      dispose() { }, releaseAll() { }, measure() { },
      eventsOnTick() { return 0; },
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
    if (slotOf(e.pointerId) < 0 && !hasQueuedDown(e.pointerId)) return;   // not ours
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

  /**
   * `lostpointercapture` USED TO BE BOUND STRAIGHT TO onCancel, AND THAT WAS A BUG.
   *
   * The spec fires lostpointercapture after pointerup AND after pointercancel, because
   * capture is implicitly released by both. Binding it to the cancel handler therefore
   * enqueued a SECOND release record for every single touch that ever ended — a spurious
   * EV_CANCEL trailing every normal EV_UP. Usually harmless (the pointer is already
   * retired, so the record is discarded), but if the trailing cancel was drained in a
   * later frame than the up, and a new DOWN for the same pointerId arrived in between,
   * the cancel retired the pointer that had just been re-acquired and the finger went
   * dead. That is the 1-in-50 stuck touch, and this is where it came from.
   *
   * lostpointercapture is still handled — losing capture without a pointerup IS a real
   * loss and the controller has to know — but only when no release is already in flight.
   */
  function onLostCapture(e) {
    const last = lastQueuedType(e.pointerId);
    if (last === EV_UP || last === EV_CANCEL) return;      // release already queued
    if (last < 0 && slotOf(e.pointerId) < 0) return;       // pointer is not ours at all
    push(EV_CANCEL, e.pointerId, e.clientX, e.clientY, stampOf(e));
  }

  // A queued-but-not-yet-drained DOWN must be recognised, or the first MOVE of a fast
  // flick is discarded and the swipe direction is wrong.
  function hasQueuedDown(id) {
    for (let i = qTail; i !== qHead; i = (i + 1) % QCAP) {
      if (qId[i] === id && qType[i] === EV_DOWN) return true;
    }
    return false;
  }

  /** The type of the most recent QUEUED (not yet drained) event for `id`, or -1. */
  function lastQueuedType(id) {
    let t = -1;
    for (let i = qTail; i !== qHead; i = (i + 1) % QCAP) if (qId[i] === id) t = qType[i];
    return t;
  }

  /** Release every pointer. The ONLY correct response to losing the surface. */
  function releaseAll(reason) {
    const t = nowFn();
    for (let i = 0; i < MAX_POINTERS; i++) {
      const p = pointers[i];
      if (!p.active) continue;
      // A release already in the queue is a release. `touchcancel` arrives immediately
      // after `pointercancel` on the same gesture, so without this every cancelled touch
      // enqueued two identical cancel records and the second one was live ammunition for
      // whatever pointer happened to own that id by the time it drained.
      const last = lastQueuedType(p.id);
      if (last === EV_UP || last === EV_CANCEL) continue;
      push(EV_CANCEL, p.id, p.x + state.rect.x, p.y + state.rect.y, t);
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
  element.addEventListener('lostpointercapture', onLostCapture, passiveFalse);
  element.addEventListener('touchcancel', onTouchCancel, passiveFalse);
  element.addEventListener('contextmenu', onCtxMenu, passiveFalse);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('blur', onBlur);
  window.addEventListener('orientationchange', onOrient);
  window.addEventListener('resize', onResize);

  /* ----------------------------------------------------------------- drain */

  /**
   * drain(nowMs, clock, telemetry) — call at the TOP of the frame, AFTER
   * clock.accumulate() and BEFORE the sim steps run. Returns the number of events
   * applied. Allocation-free.
   *
   * The ordering matters and is not negotiable: `clock.tickForStamp` can only place an
   * event on one of THIS frame's pending steps once accumulate() has decided how many
   * there are. Draining before accumulate would quantise every input to the present
   * rate, which is precisely the 30 Hz timing risk this design exists to avoid.
   */
  function drain(nowMs, clock, telemetry) {
    frameEventN = 0;
    let applied = 0;
    const lastTick = clock ? clock.lastPendingTick : 0;
    while (qTail !== qHead) {
      const i = qTail;
      const type = qType[i], id = qId[i], x = qX[i], y = qY[i], ms = qT[i];

      // Assign the event to the sim tick ITS OWN timestamp falls in.
      const tick = clock ? clock.tickForStamp(ms) : 0;

      // DEFERRAL, not clamping. An event that lands on a tick this frame is not going
      // to simulate stays in the queue and is drained next frame, on its real tick.
      // The queue is time-ordered, so the first deferral ends the drain. Clamping it
      // down instead would apply the input earlier than the player made it and would
      // make the same input resolve differently at 60 Hz and at 30 Hz.
      if (clock && tick > lastTick) break;

      qTail = (qTail + 1) % QCAP;

      let slot = slotOf(id);
      let entry = null;
      if (type === EV_DOWN) {
        if (slot < 0) {
          slot = freeSlot();
          if (slot < 0) continue;                 // >10 fingers: ignore, never grow
        }
        const p = pointers[slot];
        p.active = true; p.id = id;
        p.x = p.px = p.startX = x;
        p.y = p.py = p.startY = y;
        p.dx = 0; p.dy = 0; p.totalDx = 0; p.totalDy = 0;
        p.startMs = ms; p.lastMs = ms; p.downTick = tick;
        p.moved = false; p.maxDist = 0; p.claim = 0; p.claimData = 0;
        // A DOWN RE-ARMS the slot. If this drain already saw an UP for the same id, the
        // finger came back before the frame ended and the pending retirement must be
        // cancelled, or a live finger is dropped at the end of drain.
        p.released = false;
        entry = telemetry ? telemetry.logInput(id, EV_DOWN, x, y, ms, nowMs, tick) : null;
        p.logEntry = entry;
      } else if (slot >= 0) {
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
          entry = telemetry ? telemetry.logInput(id, EV_MOVE, x, y, ms, nowMs, tick) : null;
        } else {
          // UP or CANCEL: the slot stays readable for THIS frame so the controller can
          // resolve a tap, then is freed at the end of drain.
          p.x = x; p.y = y; p.lastMs = ms;
          p.released = true;
          entry = telemetry ? telemetry.logInput(id, type, x, y, ms, nowMs, tick) : null;
        }
      } else {
        continue;                                  // UP/CANCEL for a pointer we never saw
      }

      if (frameEventN < frameEvents.length) {
        const fe = frameEvents[frameEventN++];
        fe.type = type; fe.id = id; fe.slot = slot;
        fe.x = x; fe.y = y; fe.ms = ms; fe.tick = tick;
        // EVERY event carries its own log entry, not just DOWN. Latency is measured on
        // whichever event actually moved the player: a stick MOVE is as much an input
        // as a button press, and reporting only DOWN latency would flatter the number.
        fe.entry = entry;
      }
      applied++;
    }

    // RETIREMENT WALKS THE POINTER TABLE, NOT THE EVENT WINDOW.
    //
    // The old version iterated `frameEvents`, which is a fixed 256-entry buffer that a
    // burst can overflow — and an UP that fell off the end left its pointer `active`
    // with no finger on the glass, forever. Ten slots is the whole population, the scan
    // is O(10) and allocation-free, and it cannot miss a release no matter how many
    // events arrived. A DOWN later in the same drain clears `released`, so a finger that
    // came back inside one frame survives.
    let n = 0, stuck = 0;
    for (let i = 0; i < MAX_POINTERS; i++) {
      const p = pointers[i];
      if (!p.active) continue;
      if (p.released) {
        p.active = false; p.id = -1; p.claim = 0; p.claimData = 0;
        p.logEntry = null; p.released = false;
        continue;
      }
      // WATCHDOG: a pointer that has produced no event at all for STALE_MS has been lost
      // by the OS. Release it rather than leave a control held down forever.
      if (nowMs > 0 && p.lastMs > 0 && (nowMs - p.lastMs) > STALE_MS) {
        p.active = false; p.id = -1; p.claim = 0; p.claimData = 0;
        p.logEntry = null; p.released = false;
        state.stale++;
        continue;
      }
      n++;
    }
    // Structurally zero: nothing above can leave `released` set on an active slot. It is
    // still recomputed and reported, because an invariant nobody measures is a comment.
    for (let i = 0; i < MAX_POINTERS; i++) if (pointers[i].active && pointers[i].released) stuck++;
    state.activeCount = n;
    state.stuck = stuck;
    return applied;
  }

  /**
   * Indices of this frame's events assigned to sim tick `tick`, written into the
   * caller's preallocated Int32Array. Returns the count. Allocation-free.
   *
   * THIS IS THE API A SIM STEP MUST USE. Inside `onStep(tick, dt)` a controller reads
   * only the events belonging to THAT tick:
   *
   *   const n = touch.eventsOnTick(tick, scratchIdx);
   *   for (let i = 0; i < n; i++) { const ev = touch.events[scratchIdx[i]]; ... }
   *
   * Consuming `touch.events` wholesale inside a step is a bug at 30 Hz: it would apply
   * the same input twice (once per step) and it would apply an event to a tick that
   * had not happened yet when the finger landed.
   */
  function eventsOnTick(tick, outIdx) {
    let n = 0;
    for (let i = 0; i < frameEventN; i++) {
      if (frameEvents[i].tick === tick) { if (n >= outIdx.length) break; outIdx[n++] = i; }
    }
    return n;
  }

  function dispose() {
    element.removeEventListener('pointerdown', onDown);
    element.removeEventListener('pointermove', onMove);
    element.removeEventListener('pointerup', onUp);
    element.removeEventListener('pointercancel', onCancel);
    element.removeEventListener('lostpointercapture', onLostCapture);
    element.removeEventListener('touchcancel', onTouchCancel);
    element.removeEventListener('contextmenu', onCtxMenu);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('orientationchange', onOrient);
    window.removeEventListener('resize', onResize);
    byId.clear();
    for (let i = 0; i < MAX_POINTERS; i++) pointers[i].active = false;
  }

  return Object.assign(state, { drain, dispose, releaseAll, measure, eventsOnTick });
}

export default { createTouch, EV_DOWN, EV_MOVE, EV_UP, EV_CANCEL, MAX_POINTERS, TOUCH_SLOP_PX };
