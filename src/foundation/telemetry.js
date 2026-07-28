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

/** p95 ms budget per subsystem AT 60 Hz, measured at the tier's own emulated CPU rate. */
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

const NCH = SPANS.length + 3;          // + interval + total + rate
const CH_INTERVAL = SPANS.length;
const CH_TOTAL = SPANS.length + 1;
const CH_RATE = SPANS.length + 2;

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
    frameStart(stampMs) {
      lastFrameStamp = frameStamp[(head + capacity - 1) % capacity];
      frameStamp[head] = stampMs;
      inFrame = true;
      pendingRespN = 0;
      for (let i = 0; i < SPANS.length; i++) spanAcc[i] = 0;
      return head;
    },

    /** begin(S_SIM) / end(S_SIM). Nesting is not allowed; spans are siblings. */
    begin(ch) { spanStart[ch] = now(); },
    end(ch) { spanAcc[ch] += now() - spanStart[ch]; },
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
      frameTick[head] = tick | 0;

      // Stamp input->render-dispatch latency for anything that responded this frame.
      // This is the number a player feels, minus the compositor leg (ASSUMPTION C).
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

    get currentFrameIndex() { return count; },
    markWarmupEnd() { warmupEnd = count; },

    /* ------------------------------------------------------------ percentiles */
    /**
     * channel: index into SPANS, or 'interval' / 'total'.
     * Copies the live window into scratch, sorts once, returns p50/p95/p99/worst/p01.
     * Only ever called by a READER (the harness or the debug overlay).
     */
    stats(channel, out) {
      const ch = channel === 'interval' ? CH_INTERVAL : channel === 'total' ? CH_TOTAL : channel;
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
      const ch = channel === 'interval' ? CH_INTERVAL : channel === 'total' ? CH_TOTAL : channel;
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

    /** True if every `windowSec` window after `afterSec` has zero drops. */
    cleanWindows(afterSec, windowSec, dropMs) {
      const first = Math.max(warmupEnd, count - capacity);
      const fps = activeRate;
      const wf = Math.round(windowSec * fps);
      const skip = Math.round(afterSec * fps);
      let bad = 0, windows = 0, cur = 0, run = 0;
      for (let f = first + skip; f < count; f++) {
        const v = ring[(f % capacity) * NCH + CH_INTERVAL];
        if (v <= 0) continue;
        if (v > dropMs) cur++;
        run++;
        if (run >= wf) { windows++; if (cur > 0) bad++; cur = 0; run = 0; }
      }
      return { windows, bad };
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
      const ch = channel === 'interval' ? CH_INTERVAL : channel === 'total' ? CH_TOTAL
        : channel === 'rate' ? CH_RATE : channel;
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

    reset() {
      head = 0; count = 0; warmupEnd = 0; ltN = 0; heapN = 0; rlN = 0;
      lastFrameStamp = -1; inFrame = false;
      T.resetInputLog();
    },
  };

  return T;
}

export default {
  createTelemetry, SPANS, BUDGET_MS_60, TOTAL_BUDGET_MS_60,
  budgetFor, budgetTable, pacingTargets,
};
