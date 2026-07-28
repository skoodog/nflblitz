// FOUNDATION — PERFCORE. The measurement instrument.
//
// Everything a critic reads about runtime behaviour comes from here, through
// `window.__BLITZ_PERF__`. No agent may assert a runtime number that this file did not
// produce.
//
// ZERO ALLOCATION IS A HARD REQUIREMENT. Every buffer below is preallocated at
// construction. Nothing inside `begin/end/frameStart/frameEnd` allocates: no closures,
// no array literals, no object literals, no string concatenation. Percentiles are
// computed only when someone READS a snapshot, never per frame — a sort per frame
// would itself be the hitch we are hunting.
//
// THE RATE AXIS. Every budget below is quoted at 60 Hz and SCALES with the active
// present rate: at 30 Hz the frame period doubles, the main-thread wall goes 13.00 ->
// 30.00 ms, and every sub-budget scales by the same factor (30.00/13.00 = 2.3077).
// `budgetFor(span, rate)` is the single place that arithmetic happens.

import { rateSpec, pacingTargets } from './clock.js';

/* ---------------------------------------------------------------- the budget */

/** Subsystem span names. Index order is the ring buffer's channel order. */
export const SPANS = ['input', 'sim', 'anim', 'fx', 'camera', 'renderJS', 'overlay', 'audio', 'scaler'];

export const S_INPUT = 0, S_SIM = 1, S_ANIM = 2, S_FX = 3, S_CAMERA = 4,
  S_RENDERJS = 5, S_OVERLAY = 6, S_AUDIO = 7, S_SCALER = 8;

/**
 * p95 ms budget per subsystem AT 60 Hz, measured at the tier's own emulated CPU rate.
 *
 * TWO OF THESE SIT BELOW THE INSTRUMENT'S RESOLUTION, and that is recorded rather than
 * fixed by widening them. `performance.now()` is coarsened to 100 us in this Chromium
 * build, so `input` (0.20) is two clock quanta and `scaler` (0.10) is one. Measured with
 * the input replay switched off entirely — ZERO events for a 30 s run at the floor tier —
 * the `input` span still read p95 0.10 ms and worst 1.40 ms. A span that does nothing
 * records a 1.4 ms frame, because the OS can preempt a span whose body is microseconds
 * long. Read those two rows as "at or below what can be resolved here"; the rows that
 * carry real signal on this box are TOTAL and CALLBACK. See README section 11.9.
 */
export const BUDGET_MS_60 = Object.freeze({
  input: 0.20, sim: 2.60, anim: 3.20, fx: 1.20, camera: 0.60,
  renderJS: 2.40, overlay: 1.80, audio: 0.30, scaler: 0.10,
});
/** Back-compat alias. Always the 60 Hz column. */
export const BUDGET_MS = BUDGET_MS_60;

/** Total main-thread wall at 60 Hz: 16.667 - 3.67 inviolable compositor/GC/OS slack. */
export const TOTAL_BUDGET_MS_60 = 13.00;
export const TOTAL_BUDGET_MS = TOTAL_BUDGET_MS_60;
/** The only budget a piece may borrow from, and only if it records the borrow. */
export const RESERVE_MS_60 = 0.60;

/** The ms budget for one span at a given present rate. */
export function budgetFor(span, rate) {
  return (BUDGET_MS_60[span] || 0) * rateSpec(rate).budgetScale;
}
/** The whole budget table at a given rate, as a fresh object (readers only). */
export function budgetTable(rate) {
  const k = rateSpec(rate).budgetScale;
  const out = {};
  for (let i = 0; i < SPANS.length; i++) out[SPANS[i]] = BUDGET_MS_60[SPANS[i]] * k;
  out.TOTAL = TOTAL_BUDGET_MS_60 * k;
  out.reserve = RESERVE_MS_60 * k;
  return out;
}

/** Pacing targets for a rate. Re-exported from clock.js so readers need one import. */
export { pacingTargets };

/* ------------------------------------------------- THE WHOLE-FRAME ACCOUNTING
 *
 * Round 2 measured nine named spans and nothing else, so a 50 ms frame with 1 ms of
 * span time was a mystery: "the time is going somewhere the telemetry does not
 * instrument". These channels close that hole. Between two PRESENTED frames, every
 * millisecond of wall clock now lands in exactly one bucket:
 *
 *   wallInterval[i] = cb[i-1] + gap[i]
 *   cb              = pre + (sum of the nine spans) + post      (our rAF callback)
 *   gap             = skip + postTask + idle                    (everything else)
 *
 *   pre       rAF callback entry -> the first span's begin()      (pacer, bookkeeping)
 *   post      the last span's end() -> the end of the callback    (frameEnd, hooks)
 *   skip      time burned inside rAF callbacks the PACER declined to present. At 30 Hz
 *             on a 60 Hz panel half of all callbacks are skipped; they are cheap, but
 *             "cheap" is a claim that has to be measured, not assumed.
 *   postTask  callback return -> the browser is willing to run a fresh macrotask again.
 *             This is style/layout/paint/layer-upload/commit and any GC that V8 chose to
 *             run right after our frame. It is the single biggest thing round 2 could
 *             not see. Measured with a MessageChannel port (`enableTailProbe`), which is
 *             the earliest macrotask the HTML spec lets you schedule.
 *   idle      gap - skip - postTask. The main thread was not running ANY of our code and
 *             was not busy in the browser's post-frame work either: it was waiting for
 *             the next vsync, or the OS had descheduled the renderer process. On a
 *             4-core box shared with other agents that second case is real and it is
 *             NOT attributable to this loop. `vsyncs` disambiguates: if the browser
 *             delivered rAF on schedule the whole time, `vsyncs` counts them.
 *
 *   vsyncs    how many rAF callbacks were consumed to produce this presented frame.
 *             1 = the pacer presented the very next vsync. n > divisor = either the
 *             pacer's time gate rejected a vsync or the browser never fired one, and
 *             `skew` says which.
 *   skew      rAF entry wall time minus the rAF TIMESTAMP argument. The timestamp is the
 *             vsync the browser attributes the callback to; the wall time is when our JS
 *             actually started. A large skew means the callback was queued behind
 *             something else on the main thread.
 */
const CH_INTERVAL = SPANS.length;
const CH_TOTAL = SPANS.length + 1;
const CH_RATE = SPANS.length + 2;
const CH_WALL = SPANS.length + 3;
const CH_CB = SPANS.length + 4;
const CH_GAP = SPANS.length + 5;
const CH_SKIP = SPANS.length + 6;
const CH_POSTTASK = SPANS.length + 7;
const CH_IDLE = SPANS.length + 8;
const CH_PRE = SPANS.length + 9;
const CH_POST = SPANS.length + 10;
const CH_SKEW = SPANS.length + 11;
const CH_VSYNC = SPANS.length + 12;
const NCH = SPANS.length + 13;

/** Non-span channels a reader may ask for by name. */
export const TAIL_CHANNELS = Object.freeze({
  interval: CH_INTERVAL, total: CH_TOTAL, rate: CH_RATE, wall: CH_WALL,
  cb: CH_CB, gap: CH_GAP, skip: CH_SKIP, postTask: CH_POSTTASK, idle: CH_IDLE,
  pre: CH_PRE, post: CH_POST, skew: CH_SKEW, vsyncs: CH_VSYNC,
});

/* ----------------------------------------------------------------- telemetry */

export function createTelemetry(opts) {
  const capacity = (opts && opts.capacity) || 8192;
  const inputLogCap = (opts && opts.inputLogCap) || 4096;
  const now = (typeof performance !== 'undefined' && performance.now)
    ? () => performance.now()
    : () => Date.now();

  // --- frame ring -----------------------------------------------------------
  const ring = new Float32Array(capacity * NCH);
  const frameTick = new Int32Array(capacity);
  const frameStamp = new Float64Array(capacity);
  let head = 0;          // next write slot
  let count = 0;         // total frames ever recorded
  let warmupEnd = 0;     // frames before this index are excluded from verdicts
  let activeRate = 60;

  // --- span scratch (preallocated; no per-frame objects) ---------------------
  const spanStart = new Float64Array(SPANS.length);
  const spanAcc = new Float64Array(SPANS.length);
  let lastFrameStamp = -1;
  let inFrame = false;

  // --- whole-frame accounting scratch ---------------------------------------
  const frameEntry = new Float64Array(capacity);     // wall time at rAF entry
  let entryNow = -1;              // wall time this callback started
  let firstSpanAt = -1;           // wall time the first span of this frame began
  let lastSpanAt = -1;            // wall time the last span of this frame ended
  let lastPresentCbEnd = -1;      // wall time the last PRESENTED callback returned
  let skipAcc = 0;                // ms burned in skipped callbacks since last present
  let postTaskAcc = 0;            // ms of post-callback browser work since last present
  let vsyncAcc = 0;               // rAF callbacks consumed since the last present
  let presenting = false;         // is the callback currently running a presented frame?

  // MessageChannel tail probe. OFF by default: it posts one message per frame, and a
  // measurement instrument that changes the thing it measures is worse than no
  // instrument. `perf.mjs --tailprobe` turns it on and prints both runs.
  let probeOn = false;
  let probeChan = null;
  let probeSlot = -1;
  let probePostedAt = -1;
  let probeLate = 0;      // port messages that arrived after their gap had closed

  // --- percentile scratch ---------------------------------------------------
  const scratch = new Float64Array(capacity);

  // --- long tasks -----------------------------------------------------------
  const ltDur = new Float64Array(512);
  const ltAt = new Float64Array(512);
  let ltN = 0;
  let ltObserver = null;

  // --- heap -----------------------------------------------------------------
  const heapS = new Float64Array(4096);
  const heapF = new Int32Array(4096);
  let heapN = 0;

  // --- input log (pooled objects; the pool is allocated once) ---------------
  const inputLog = new Array(inputLogCap);
  for (let i = 0; i < inputLogCap; i++) {
    inputLog[i] = {
      seq: 0, pointerId: 0, type: 0, x: 0, y: 0, eventMs: 0, drainMs: 0,
      tick: -1, frame: -1, respondTick: -1, respondFrame: -1, respondMs: 0,
      renderMs: 0, rate: 60, action: 0, zone: 0, gesture: 0,
    };
  }
  let ilHead = 0, ilCount = 0, ilSeq = 0;

  // Entries whose response was marked THIS frame and still need a render-dispatch
  // stamp at frameEnd. Preallocated; never grows.
  const pendingResp = new Array(64);
  let pendingRespN = 0;

  // --- scaler decision log --------------------------------------------------
  const rungLog = new Array(256);
  for (let i = 0; i < 256; i++) rungLog[i] = { t: 0, frame: 0, from: 0, to: 0, reason: 0, kind: 0 };
  let rlN = 0;

  const T = {
    SPANS, BUDGET_MS_60, TOTAL_BUDGET_MS_60, budgetFor, budgetTable, pacingTargets,
    get frames() { return count; },
    get warmupEndFrame() { return warmupEnd; },
    get rate() { return activeRate; },
    setRate(r) { activeRate = r === 30 ? 30 : 60; },

    /* ---------------------------------------------------------- frame timing */

    /**
     * THE VERY FIRST LINE OF THE rAF CALLBACK, before the pacer is consulted.
     * Every callback calls this, presented or not — a skipped callback is still main
     * thread time between two presents and must be billed somewhere.
     */
    rafEnter(stampMs) {
      entryNow = now();
      vsyncAcc++;
      firstSpanAt = -1;
      lastSpanAt = -1;
      presenting = false;
      return entryNow;
    },

    /**
     * THE VERY LAST LINE OF THE rAF CALLBACK, on BOTH paths. Closes the callback's own
     * duration and starts the clock on the gap that follows it.
     */
    rafExit() {
      const t = now();
      if (presenting) {
        const slot = (head + capacity - 1 + capacity) % capacity;
        // `post` and `cb` are only final here: frameEnd runs before the loop's own
        // onFrameEnd hook, and that hook is main-thread time inside our callback too.
        if (lastSpanAt >= 0) ring[slot * NCH + CH_POST] = t - lastSpanAt;
        ring[slot * NCH + CH_CB] = t - entryNow;
        lastPresentCbEnd = t;
        skipAcc = 0;
        postTaskAcc = 0;
        if (probeOn && probeChan) {
          probeSlot = 1;
          probePostedAt = t;
          probeChan.port2.postMessage(0);
        }
        presenting = false;
      } else if (entryNow >= 0) {
        skipAcc += t - entryNow;
      }
      return t;
    },

    frameStart(stampMs) {
      lastFrameStamp = frameStamp[(head + capacity - 1) % capacity];
      frameStamp[head] = stampMs;
      frameEntry[head] = entryNow;
      inFrame = true;
      presenting = true;
      pendingRespN = 0;
      for (let i = 0; i < SPANS.length; i++) spanAcc[i] = 0;
      const base = head * NCH;
      ring[base + CH_SKEW] = entryNow >= 0 ? entryNow - stampMs : 0;
      ring[base + CH_VSYNC] = vsyncAcc;
      ring[base + CH_SKIP] = skipAcc;
      ring[base + CH_POSTTASK] = postTaskAcc;
      const gap = (lastPresentCbEnd >= 0 && entryNow >= 0) ? entryNow - lastPresentCbEnd : 0;
      ring[base + CH_GAP] = gap;
      // idle is the RESIDUAL and is allowed to be reported as-is, including tiny
      // negatives from clock coarsening. It is never clamped: a bucket that cannot go
      // negative is a bucket that can hide a bookkeeping error.
      ring[base + CH_IDLE] = gap - skipAcc - postTaskAcc;
      vsyncAcc = 0;
      probeSlot = -1;          // this gap is now closed; a late port message is noise
      return head;
    },

    /** begin(S_SIM) / end(S_SIM). Nesting is not allowed; spans are siblings. */
    begin(ch) {
      const t = now();
      spanStart[ch] = t;
      if (firstSpanAt < 0) {
        firstSpanAt = t;
        if (entryNow >= 0) ring[head * NCH + CH_PRE] = t - entryNow;
      }
    },
    end(ch) { const t = now(); spanAcc[ch] += t - spanStart[ch]; lastSpanAt = t; },
    /** Add an externally measured cost to a channel (e.g. from a worker). */
    add(ch, ms) { spanAcc[ch] += ms; },
    /** Total CPU accumulated so far in the frame being built. Allocation-free. */
    frameCpuSoFar() { let s = 0; for (let i = 0; i < SPANS.length; i++) s += spanAcc[i]; return s; },

    frameEnd(tick, nowMs) {
      if (!inFrame) return 0;
      inFrame = false;
      const base = head * NCH;
      let total = 0;
      for (let i = 0; i < SPANS.length; i++) { ring[base + i] = spanAcc[i]; total += spanAcc[i]; }
      ring[base + CH_TOTAL] = total;
      const interval = (count === 0 || lastFrameStamp <= 0) ? 0 : frameStamp[head] - lastFrameStamp;
      ring[base + CH_INTERVAL] = interval;
      ring[base + CH_RATE] = activeRate;
      // Wall interval — rAF ENTRY to rAF ENTRY, not vsync stamp to vsync stamp. The two
      // differ by the skew, and only the wall one is the sum of the accounting buckets.
      const prevEntry = frameEntry[(head + capacity - 1) % capacity];
      ring[base + CH_WALL] = (count === 0 || prevEntry <= 0 || entryNow < 0) ? 0 : entryNow - prevEntry;
      frameTick[head] = tick | 0;

      // Backstop for anything `stampRenderDispatch` did not already close — e.g. a
      // response marked after the render span (an overlay-only reaction). The primary
      // stamp happens at render dispatch; see stampRenderDispatch below.
      const t = nowMs === undefined ? now() : nowMs;
      for (let i = 0; i < pendingRespN; i++) {
        const e = pendingResp[i];
        if (e && e.renderMs === 0) { e.renderMs = t - e.eventMs; e.respondFrame = count; e.rate = activeRate; }
        pendingResp[i] = null;
      }
      pendingRespN = 0;

      head = (head + 1) % capacity;
      count++;
      return total;
    },

    /**
     * CLOSE THE LATENCY MEASUREMENT AT RENDER DISPATCH — which is what the metric is
     * called, and what it now measures.
     *
     * It used to be stamped at `frameEnd`, i.e. AFTER the overlay, audio and scaler
     * spans had run. Those come after the frame's draw call has been issued and cannot
     * affect when the player sees the response, so billing them to input latency
     * overstated it by the whole tail of the frame — up to 3.3 ms at the floor tier's
     * 6x CPU emulation. Called by the loop immediately after the renderJS span ends.
     */
    stampRenderDispatch() {
      if (!inFrame || pendingRespN === 0) return;
      const t = now();
      for (let i = 0; i < pendingRespN; i++) {
        const e = pendingResp[i];
        if (e && e.renderMs === 0) { e.renderMs = t - e.eventMs; e.respondFrame = count; e.rate = activeRate; }
      }
    },

    get currentFrameIndex() { return count; },
    markWarmupEnd() { warmupEnd = count; },

    /* ------------------------------------------------------------ percentiles */
    /**
     * channel: index into SPANS, or 'interval' / 'total'.
     * Copies the live window into scratch, sorts once, returns p50/p95/p99/worst/p01.
     * Only ever called by a READER (the harness or the debug overlay).
     */
    stats(channel, out) {
      const ch = typeof channel === 'string' ? TAIL_CHANNELS[channel] : channel;
      const first = Math.max(warmupEnd, count - capacity);
      let n = 0;
      for (let f = first; f < count; f++) {
        const slot = f % capacity;
        const v = ring[slot * NCH + ch];
        if (ch === CH_INTERVAL && v <= 0) continue;      // first frame has no interval
        scratch[n++] = v;
      }
      const o = out || { n: 0, p01: 0, p50: 0, p95: 0, p99: 0, worst: 0, mean: 0 };
      o.n = n;
      if (n === 0) { o.p01 = o.p50 = o.p95 = o.p99 = o.worst = o.mean = 0; return o; }
      const view = scratch.subarray(0, n);
      let sum = 0;
      for (let i = 0; i < n; i++) sum += view[i];
      o.mean = sum / n;
      view.sort();
      const q = (p) => view[Math.min(n - 1, Math.max(0, Math.round(p * (n - 1))))];
      o.p01 = q(0.01); o.p50 = q(0.50); o.p95 = q(0.95); o.p99 = q(0.99);
      o.worst = view[n - 1];
      return o;
    },

    /**
     * Same as stats(), but only over frames presented at `rate`. This is how the
     * harness reports the 60 Hz and 30 Hz distributions SEPARATELY, which it must:
     * mixing a 16.7 ms population with a 33.3 ms one produces a bimodal mess whose
     * percentiles describe neither mode.
     */
    statsAtRate(channel, rate, out) {
      const ch = typeof channel === 'string' ? TAIL_CHANNELS[channel] : channel;
      const first = Math.max(warmupEnd, count - capacity);
      let n = 0;
      for (let f = first; f < count; f++) {
        const slot = f % capacity;
        if (ring[slot * NCH + CH_RATE] !== rate) continue;
        const v = ring[slot * NCH + ch];
        if (ch === CH_INTERVAL && v <= 0) continue;
        scratch[n++] = v;
      }
      const o = out || { n: 0, p01: 0, p50: 0, p95: 0, p99: 0, worst: 0, mean: 0 };
      o.n = n;
      if (n === 0) { o.p01 = o.p50 = o.p95 = o.p99 = o.worst = o.mean = 0; return o; }
      const view = scratch.subarray(0, n);
      let sum = 0;
      for (let i = 0; i < n; i++) sum += view[i];
      o.mean = sum / n;
      view.sort();
      const q = (p) => view[Math.min(n - 1, Math.max(0, Math.round(p * (n - 1))))];
      o.p01 = q(0.01); o.p50 = q(0.50); o.p95 = q(0.95); o.p99 = q(0.99);
      o.worst = view[n - 1];
      return o;
    },

    /** Which rates actually occurred in the window, and how many frames at each. */
    rateHistogram() {
      const first = Math.max(warmupEnd, count - capacity);
      let n60 = 0, n30 = 0, other = 0;
      for (let f = first; f < count; f++) {
        const r = ring[(f % capacity) * NCH + CH_RATE];
        if (r === 60) n60++; else if (r === 30) n30++; else other++;
      }
      return { r60: n60, r30: n30, other };
    },

    /** Frames whose INTERVAL exceeded ms, after warmup. Optionally only at `rate`. */
    dropCount(ms, rate) {
      const first = Math.max(warmupEnd, count - capacity);
      let n = 0, tot = 0;
      for (let f = first; f < count; f++) {
        const slot = f % capacity;
        if (rate !== undefined && ring[slot * NCH + CH_RATE] !== rate) continue;
        const v = ring[slot * NCH + CH_INTERVAL];
        if (v <= 0) continue;
        tot++;
        if (v > ms) n++;
      }
      return { drops: n, total: tot, pct: tot ? (100 * n / tot) : 0 };
    },

    /** Longest run of consecutive frames with no interval > ms. */
    longestCleanRun(ms) {
      const first = Math.max(warmupEnd, count - capacity);
      let best = 0, cur = 0;
      for (let f = first; f < count; f++) {
        const v = ring[(f % capacity) * NCH + CH_INTERVAL];
        if (v <= 0) continue;
        if (v > ms) { cur = 0; } else { cur++; if (cur > best) best = cur; }
      }
      return best;
    },

    /**
     * True if every `windowSec` window after `afterSec` has zero drops.
     *
     * WINDOWS ARE CUT IN WALL TIME, NOT IN FRAMES. This used to convert seconds to a
     * frame count using `activeRate` — the rate in force when the SNAPSHOT was READ. In
     * a run where the scaler changed rate, or in `--thermal-ramp` where changing rate is
     * the whole point, that number describes the end of the run and mis-sizes every
     * window before it: at 30 Hz it cut 3 s windows 90 frames wide over stretches that
     * were running 60 Hz, i.e. 1.5 s windows counted as 3 s ones. The frame timestamps
     * are already recorded, so the window boundaries are now read off them directly and
     * the answer is right at any rate and across any rate change.
     */
    cleanWindows(afterSec, windowSec, dropMs) {
      const first = Math.max(warmupEnd, count - capacity);
      if (count - first < 2) return { windows: 0, bad: 0 };
      const t0 = frameStamp[first % capacity] + afterSec * 1000;
      let bad = 0, windows = 0, cur = 0, inWin = 0;
      let windowEnd = -1;
      for (let f = first; f < count; f++) {
        const slot = f % capacity;
        const ts = frameStamp[slot];
        if (ts < t0) continue;
        if (windowEnd < 0) windowEnd = ts + windowSec * 1000;
        while (ts > windowEnd) {
          // A window with NO FRAMES IN IT is not a clean window, it is a window in which
          // the game did not present at all — the worst outcome there is. It is counted
          // as bad rather than skipped, because skipping it would let a total stall
          // improve the score.
          windows++; if (cur > 0 || inWin === 0) bad++;
          cur = 0; inWin = 0;
          windowEnd += windowSec * 1000;
        }
        inWin++;
        const v = ring[slot * NCH + CH_INTERVAL];
        if (v > 0 && v > dropMs) cur++;
      }
      // A trailing partial window is NOT counted: a 0.4 s tail that happens to be clean
      // is not evidence of a clean 3 s window, and counting it would flatter the run.
      return { windows, bad };
    },

    /**
     * THE TAIL, ACCOUNTED FOR. The `n` worst frames by interval, each decomposed into
     * every bucket the frame accounting knows about, plus whether a `longtask` entry
     * overlapped the gap that preceded it. This is the table that answers "what was the
     * hitch", as opposed to "how big was the hitch".
     *
     * `unattributed` is the residual after every named bucket is subtracted. If it is
     * near zero the frame is fully explained; if it is not, say so in the report rather
     * than rounding it away.
     */
    tailFrames(n, sortBy) {
      // `sortBy` is 'interval' (default) or 'wall'. BOTH matter and they are not the
      // same list. Chromium snaps the rAF TIMESTAMP to the BeginFrame grid, so a
      // callback that was delivered 15 ms late still carries an on-grid timestamp and
      // the interval channel reads a clean 16.7 ms. The WALL channel does not lie about
      // that, so the report ranks the tail both ways and says when they disagree.
      const key = sortBy === 'wall' ? CH_WALL : CH_INTERVAL;
      const first = Math.max(warmupEnd, count - capacity);
      const idx = [];
      for (let f = first; f < count; f++) {
        if (ring[(f % capacity) * NCH + CH_INTERVAL] > 0) idx.push(f);
      }
      idx.sort((a, b) => ring[(b % capacity) * NCH + key] - ring[(a % capacity) * NCH + key]);
      const lim = Math.min(idx.length, n || 8);
      const out = [];
      for (let i = 0; i < lim; i++) {
        const f = idx[i];
        const base = (f % capacity) * NCH;
        const spans = {};
        let spanSum = 0;
        for (let s = 0; s < SPANS.length; s++) { spans[SPANS[s]] = ring[base + s]; spanSum += ring[base + s]; }
        const entry = frameEntry[f % capacity];
        const gap = ring[base + CH_GAP];
        // Any longtask that overlapped the window between the previous presented
        // callback's end and this callback's entry.
        let ltMs = 0;
        const gapStart = entry - gap;
        for (let k = 0; k < ltN; k++) {
          const a = ltAt[k], b = ltAt[k] + ltDur[k];
          if (b > gapStart && a < entry) ltMs += Math.min(b, entry) - Math.max(a, gapStart);
        }
        const prevCb = ring[(((f - 1 + capacity) % capacity)) * NCH + CH_CB];
        const wall = ring[base + CH_WALL];
        out.push({
          index: f, tick: frameTick[f % capacity],
          interval: ring[base + CH_INTERVAL], wall,
          rate: ring[base + CH_RATE], vsyncs: ring[base + CH_VSYNC],
          skew: ring[base + CH_SKEW],
          prevCb, pre: ring[base + CH_PRE], post: ring[base + CH_POST],
          spanTotal: spanSum, gap,
          skip: ring[base + CH_SKIP], postTask: ring[base + CH_POSTTASK],
          idle: ring[base + CH_IDLE], longtaskInGap: ltMs,
          unattributed: wall > 0 ? wall - prevCb - gap : 0,
          spans,
        });
      }
      return out;
    },

    /**
     * HOW MUCH OF THE FRAME THE ACCOUNTING CANNOT PLACE, over the whole window.
     *
     * `wall = cb(previous) + gap` and `cb = pre + spans + post` are identities by
     * construction, so the residual should be zero up to the clock's 100 us coarsening.
     * Reporting it is the difference between an accounting scheme and a claim: if this
     * number is not small, the decomposition above it is wrong and the report says so
     * instead of quietly summing to whatever it summed to.
     */
    accountingResidual() {
      const first = Math.max(warmupEnd, count - capacity);
      let worstWall = 0, worstCb = 0, n = 0, sum = 0;
      for (let f = first + 1; f < count; f++) {
        const base = (f % capacity) * NCH;
        const wall = ring[base + CH_WALL];
        if (!(wall > 0)) continue;
        const prevCb = ring[(((f - 1 + capacity) % capacity)) * NCH + CH_CB];
        const rw = Math.abs(wall - prevCb - ring[base + CH_GAP]);
        if (rw > worstWall) worstWall = rw;
        let spanSum = 0;
        for (let s = 0; s < SPANS.length; s++) spanSum += ring[base + s];
        const rc = Math.abs(ring[base + CH_CB] - ring[base + CH_PRE] - spanSum - ring[base + CH_POST]);
        if (rc > worstCb) worstCb = rc;
        sum += rw; n++;
      }
      return { n, meanWallMs: n ? sum / n : 0, worstWallMs: worstWall, worstCbMs: worstCb };
    },

    /** The single worst frame after warmup, with its full span breakdown. */
    worstFrame(out) {
      const first = Math.max(warmupEnd, count - capacity);
      let bi = -1, bv = -1;
      for (let f = first; f < count; f++) {
        const v = ring[(f % capacity) * NCH + CH_INTERVAL];
        if (v > bv) { bv = v; bi = f; }
      }
      const o = out || { index: -1, interval: 0, total: 0, rate: 60, spans: {} };
      o.index = bi; o.interval = bv;
      if (bi < 0) return o;
      const base = (bi % capacity) * NCH;
      o.total = ring[base + CH_TOTAL];
      o.rate = ring[base + CH_RATE];
      o.spans = o.spans || {};
      for (let i = 0; i < SPANS.length; i++) o.spans[SPANS[i]] = ring[base + i];
      return o;
    },

    /** Raw per-frame series for a channel — the harness prints these on failure. */
    series(channel, limit) {
      const ch = typeof channel === 'string' ? TAIL_CHANNELS[channel] : channel;
      const first = Math.max(warmupEnd, count - capacity, count - (limit || capacity));
      const out = [];
      for (let f = first; f < count; f++) out.push(ring[(f % capacity) * NCH + ch]);
      return out;
    },

    /* -------------------------------------------------------------- longtask */
    startLongTaskObserver() {
      if (ltObserver || typeof PerformanceObserver === 'undefined') return false;
      try {
        ltObserver = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          for (let i = 0; i < entries.length; i++) {
            if (ltN < ltDur.length) { ltDur[ltN] = entries[i].duration; ltAt[ltN] = entries[i].startTime; ltN++; }
          }
        });
        ltObserver.observe({ entryTypes: ['longtask'] });
        return true;
      } catch (e) { ltObserver = null; return false; }
    },
    longTasks(minMs, afterMs) {
      let n = 0;
      for (let i = 0; i < ltN; i++) if (ltDur[i] > minMs && ltAt[i] >= (afterMs || 0)) n++;
      return n;
    },
    longTaskList() {
      const out = [];
      for (let i = 0; i < ltN; i++) out.push({ ms: ltDur[i], at: ltAt[i] });
      return out;
    },
    resetLongTasks() { ltN = 0; },

    /* ------------------------------------------------------------------ heap */
    sampleHeap() {
      const m = (typeof performance !== 'undefined') && performance.memory;
      if (!m) return;
      if (heapN < heapS.length) { heapS[heapN] = m.usedJSHeapSize / 1048576; heapF[heapN] = count; heapN++; }
    },
    /**
     * SAWTOOTH AMPLITUDE vs TOTAL RANGE — two different numbers, and this used to
     * conflate them.
     *
     * The contract caps "JS heap sawtooth amplitude": how much garbage piles up between
     * one collection and the next. That is the largest DROP between consecutive samples
     * — a drop is a GC, and the rise that preceded it is the garbage it collected.
     *
     * This function used to return `Math.max(saw, peak - trough)`. `peak - trough` is
     * the total excursion of the whole run, which is a different quantity and always the
     * larger one whenever the run also settles. On this container that single `max()`
     * turned a genuinely flat heap into a 29.15 MB "sawtooth": measured over 20 s at
     * floor/rung 0, the true GC amplitude was 0.65 MB while the run ALSO collected ~15 MB
     * of one-time boot garbage (procedural geometry, texture bakes, the 16-rung program
     * prewarm) inside the measured window. Independently confirmed by V8's sampling
     * allocation profiler over the same window: 259 BYTES per presented frame, i.e. the
     * frame loop is allocation-free as the contract requires.
     * (`node scripts/allocprobe.mjs --tier=floor --rung=0`.)
     *
     * So: BOTH are returned, `sawtoothMB` means what the contract says it means, and
     * `rangeMB` is printed beside it so the excursion is never hidden. Harnesses should
     * also force a collection at warmup end — see `perf.mjs` — so boot garbage is not
     * billed to the steady state it was never part of.
     */
    heapStats() {
      if (heapN < 2) {
        return {
          n: heapN, startMB: 0, endMB: 0, peakMB: 0, troughMB: 0,
          sawtoothMB: 0, rangeMB: 0, growthPer1000: 0, series: [],
        };
      }
      let peak = 0, trough = Infinity, saw = 0, prev = heapS[0];
      for (let i = 0; i < heapN; i++) {
        const v = heapS[i];
        if (v > peak) peak = v;
        if (v < trough) trough = v;
        if (v < prev) { const amp = prev - v; if (amp > saw) saw = amp; }   // a drop = a GC
        prev = v;
      }
      // Regression-free growth estimate: min-of-first-quarter vs min-of-last-quarter,
      // so the sawtooth does not masquerade as growth.
      const q = Math.max(1, heapN >> 2);
      let minA = Infinity, minB = Infinity;
      for (let i = 0; i < q; i++) if (heapS[i] < minA) minA = heapS[i];
      for (let i = heapN - q; i < heapN; i++) if (heapS[i] < minB) minB = heapS[i];
      const df = Math.max(1, heapF[heapN - 1] - heapF[0]);
      const series = [];
      for (let i = 0; i < heapN; i++) series.push({ f: heapF[i], mb: heapS[i] });
      return {
        n: heapN, startMB: heapS[0], endMB: heapS[heapN - 1], peakMB: peak, troughMB: trough,
        sawtoothMB: saw,            // GC amplitude — what the contract caps at 8 MB
        rangeMB: peak - trough,     // total excursion — reported, never gated
        growthPer1000: (minB - minA) * 1000 / df, series,
      };
    },

    /* ------------------------------------------------------------ input log */
    /** Record a raw input event at drain time. Writes into a pooled slot. */
    logInput(pointerId, type, x, y, eventMs, drainMs, tick) {
      const e = inputLog[ilHead];
      e.seq = ilSeq++; e.pointerId = pointerId; e.type = type; e.x = x; e.y = y;
      e.eventMs = eventMs; e.drainMs = drainMs; e.tick = tick;
      e.frame = count; e.respondTick = -1; e.respondFrame = -1; e.respondMs = 0;
      e.renderMs = 0; e.rate = activeRate; e.action = 0; e.zone = 0; e.gesture = 0;
      ilHead = (ilHead + 1) % inputLogCap;
      if (ilCount < inputLogCap) ilCount++;
      return e;
    },
    /**
     * Mark the tick at which an input's effect entered the sim state. Called by the
     * controller/sim the moment player state changes because of that event. The
     * render-dispatch stamp is filled in at frameEnd, so `renderMs` is a true
     * input -> render-dispatch latency and never a guess.
     */
    markResponse(entry, tick) {
      if (!entry || entry.respondTick >= 0) return;
      entry.respondTick = tick === undefined ? -1 : tick;
      entry.respondMs = now() - entry.eventMs;
      if (pendingRespN < pendingResp.length) pendingResp[pendingRespN++] = entry;
    },
    inputEntries() {
      const out = [];
      const start = (ilHead - ilCount + inputLogCap) % inputLogCap;
      for (let i = 0; i < ilCount; i++) {
        const e = inputLog[(start + i) % inputLogCap];
        out.push({
          seq: e.seq, pointerId: e.pointerId, type: e.type, x: e.x, y: e.y,
          eventMs: e.eventMs, drainMs: e.drainMs, tick: e.tick, frame: e.frame,
          respondTick: e.respondTick, respondFrame: e.respondFrame,
          respondMs: e.respondMs, renderMs: e.renderMs, rate: e.rate,
          action: e.action, zone: e.zone, gesture: e.gesture,
        });
      }
      return out;
    },
    resetInputLog() { ilHead = 0; ilCount = 0; ilSeq = 0; pendingRespN = 0; },

    /* ---------------------------------------------------------- scaler log */
    /** kind: 0 = rung change, 1 = RATE change. Rate changes are the visible ones. */
    logRung(t, from, to, reason, kind) {
      if (rlN < rungLog.length) {
        const r = rungLog[rlN++];
        r.t = t; r.frame = count; r.from = from; r.to = to;
        r.reason = reason; r.kind = kind || 0;
      }
    },
    rungChanges() {
      const out = [];
      for (let i = 0; i < rlN; i++) {
        const r = rungLog[i];
        out.push({ t: r.t, frame: r.frame, from: r.from, to: r.to, reason: r.reason, kind: r.kind });
      }
      return out;
    },

    /**
     * Drop every heap sample taken so far, keeping all other channels.
     * Called by a harness at warmup end, immediately AFTER it has forced a collection,
     * so the steady-state heap series starts from a collected baseline and one-time boot
     * garbage is not billed to the run. Warmup is excluded from every other verdict;
     * this is what excluding it from the heap verdict has to mean.
     */
    resetHeap() { heapN = 0; },

    /**
     * Turn on the MessageChannel post-frame probe. OFF by default and deliberately so:
     * it posts one message per presented frame, which is itself a task the browser has
     * to schedule. `perf.mjs --tailprobe` enables it and the report prints the run with
     * and without, so the instrument's own cost is visible instead of assumed.
     */
    enableTailProbe(on) {
      if (!on) { probeOn = false; return false; }
      if (!probeChan) {
        if (typeof MessageChannel === 'undefined') return false;
        probeChan = new MessageChannel();
        probeChan.port1.onmessage = () => {
          // The sample only means anything if it lands inside the gap it was posted in.
          // If rAF beat the port message to the main thread the measurement belongs to a
          // window that has already been closed and reported: count it, discard it.
          if (probeSlot < 0) { probeLate++; return; }
          postTaskAcc += now() - probePostedAt;
          probeSlot = -1;
        };
        probeChan.port1.start();
      }
      probeOn = true;
      return true;
    },
    get tailProbe() { return probeOn; },
    get tailProbeLate() { return probeLate; },

    reset() {
      head = 0; count = 0; warmupEnd = 0; ltN = 0; heapN = 0; rlN = 0;
      lastFrameStamp = -1; inFrame = false;
      entryNow = -1; firstSpanAt = -1; lastSpanAt = -1;
      lastPresentCbEnd = -1;
      skipAcc = 0; postTaskAcc = 0; vsyncAcc = 0; presenting = false;
      probeSlot = -1; probeLate = 0;
      T.resetInputLog();
    },
  };

  return T;
}

export default {
  createTelemetry, SPANS, BUDGET_MS_60, TOTAL_BUDGET_MS_60,
  budgetFor, budgetTable, pacingTargets,
};
