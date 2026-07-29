#!/usr/bin/env node
// touch-controller SELF-TEST — headless, no browser, no renderer.
//
// The four harness commands judge the piece from the outside. This one judges the parts
// of it that are PURE FUNCTIONS OF TICKS, which is where the timing model lives, and it
// runs in milliseconds so it can be run on every edit:
//
//   1  the reach table, in mm, at SIX widths in BOTH orientations, against the 40 mm
//      budget — plus a direct assertion that portrait and landscape agree exactly
//   2  no two zone rectangles come within 12 px of each other, at those same twelve
//      surfaces (a control that loses a hit-test to table order is a control that stops
//      working when somebody reorders a list — or narrows a phone)
//   3  every timing window's boundaries, and grade() at every tick across each of them
//   4  the same gesture script resolved at 60 Hz and at 30 Hz produces the SAME grades
//   5  gesture classification against a fake bus of the exact shape touch.js exposes
//   6  zero allocation on the resolve path, measured with process.memoryUsage deltas
//
// ==========================================================================
// EVERY ASSERTION HERE STATES THE WHOLE OUTCOME, NOT A PART OF IT, and that rule is
// written down because breaking it cost a round.
//
// The round-1 file asserted `st.actions >= 1 && st.passTarget !== undefined` for the
// receiver-icon throw. `passTarget` is initialised to -1 and re-cleared to -1 every
// resolve(), so the second clause is true on every possible execution; `actions >= 1`
// cannot fail once anything fires. The controller was firing a PASS and then a TUCK —
// the QB threw the ball and immediately tucked and ran with it — and the line PRINTED
// "2 action(s) fired" and reported PASS. Nearby, `.some(g => g === want)` did the same
// job for gestures: right thing fired, plus anything else, still green.
//
// So: counts are `=== n`, never `>= n`; sequences are compared whole, never sampled with
// `.some()`; an OR is a smell (round 1 also had `fuel === 0 || overheatUntil > 0`, whose
// left half was false every time it was evaluated); and any predicate that cannot be made
// to fail by a deliberate mutation of the piece is not a test. Each fix below was checked
// by reverting the piece and watching this file go red.
// ==========================================================================
//
//   node shots/touch-controller/_selftest.mjs

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const P = (p) => pathToFileURL(path.join(REPO, p)).href;

const tuning = await import(P('src/pieces/touch-controller/tuning.js'));
const layout = await import(P('src/pieces/touch-controller/layout.js'));
const stateM = await import(P('src/pieces/touch-controller/state.js'));
const rez = await import(P('src/pieces/touch-controller/resolve.js'));

const { ZONE, GESTURE, GESTURE_NAME, TW, TW_NAME, GRADE, GRADE_NAME, TUNING, ACT, ACT_NAME } = tuning;
const TICK_MS = 1000 / 60;

let fails = 0, n = 0;
const L = (s) => console.log(s);
const res = (b) => (b ? 'PASS' : 'FAIL');
function ok(cond, label, detail) {
  n++;
  if (!cond) { fails++; console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
  return cond;
}
const f = (x, w, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '-').padStart(w);

/* ============================================================ 1 + 2  REACH */

const THUMB_MM = 40;
const ZN = { 1: 'STICK', 2: 'ACTION', 3: 'PASS', 4: 'TURBO' };

/**
 * SIX WIDTHS, BOTH ORIENTATIONS, AND WHY IT IS NOT TWO.
 *
 * The previous version of this file checked the zone rectangles at exactly 390x844 and
 * 844x390 — two surfaces that happen to be wide enough for the layout — and reported
 * "minimum gap 2.0 px  PASS". It was true and it was useless: the STICK-to-PASS gap is
 * `0.96 * W` minus a constant, so it SHRINKS WITH THE SCREEN, and the two sizes tested
 * were the two where it was positive. At 375 (iPhone SE 2/3, 8, 13 mini) the pads
 * overlapped by 10 px and at 360 (the modal Android width) by 24.4 px, with `zoneAt()`
 * awarding the overlap to STICK because STICK is row 0 — so 31% of the PASS pad started
 * a thumbstick drag instead of raising the receivers.
 *
 * An assertion evaluated only where it holds is worse than no assertion. So it now runs
 * at every width the piece can plausibly meet, in both orientations, and it demands a
 * REAL gap rather than a non-negative one: 2.0 px is 0.37 mm, which for two controls
 * whose consequences are "throw the ball" and "sprint" is touching.
 */
const SURFACES = [
  [320, 568, 'iPhone SE 1 / 5 / 5s'],
  [360, 640, 'the modal Android'],
  [375, 667, 'iPhone SE 2-3 / 8 / 13 mini'],
  [390, 844, 'iPhone 12-16'],
  [414, 896, 'iPhone 11 / XR'],
  [430, 932, 'iPhone 15-16 Pro Max'],
];
/** A gap smaller than this is not a gap. 12 CSS px is 2.2 mm. */
const MIN_GAP_PX = 12;

L('');
L('=== REACH (thumb pivots at the bottom corners; cap 40 mm; 1 CSS px = 0.1833 mm) ===');
L('    surface        scale   STICK  ACTION    PASS   TURBO      worst');
for (const [vw, vh, who] of SURFACES) {
  for (const [W2, H2, tag] of [[vw, vh, 'P'], [vh, vw, 'L']]) {
    const rows = layout.reachReport(W2, H2);
    let worst = 0, allGood = true;
    const cells = [];
    for (const r of rows) {
      const good = r.homeMm <= THUMB_MM && r.centreMm <= THUMB_MM;
      allGood = allGood && good;
      if (r.centreMm > worst) worst = r.centreMm;
      cells.push(f(r.centreMm, 7));
    }
    ok(allGood, `reach within ${THUMB_MM} mm @ ${W2}x${H2}`, `worst ${worst.toFixed(1)} mm`);
    L(`    ${String(`${W2}x${H2}`).padEnd(10)} ${tag}  ${f(layout.FIT.scale, 6, 3)}  ${cells.join(' ')}   ${f(worst, 6)} mm ${res(allGood)}`
      + (tag === 'P' ? `  ${who}` : ''));
  }
}
// Orientation independence is the property the CSS-px anchoring exists to buy, so it is
// asserted directly rather than inferred from two rows of a table looking alike.
for (const [vw, vh] of SURFACES) {
  const p = layout.reachReport(vw, vh).map((r) => r.centreMm.toFixed(4)).join(',');
  const l2 = layout.reachReport(vh, vw).map((r) => r.centreMm.toFixed(4)).join(',');
  ok(p === l2, `reach identical portrait vs landscape @ ${vw}x${vh}`, `${p} vs ${l2}`);
}
L(`    reach is identical in portrait and landscape at all ${SURFACES.length} sizes  ${res(true)}`);

L('');
L('=== ZONE RECTANGLES MUST NOT INTERSECT (any pair, any viewport) ===');
L('    surface        scale   worst pair          gap px     mm');
for (const [vw, vh] of SURFACES) {
  for (const [W2, H2, tag] of [[vw, vh, 'P'], [vh, vw, 'L']]) {
    const pairs = layout.zonePairGaps(W2, H2);
    const worst = pairs[0];
    const gap = layout.minZoneGap(W2, H2);
    const good = gap >= MIN_GAP_PX;
    ok(good, `zone rectangles clear of each other @ ${W2}x${H2}`,
      `${ZN[worst[0]]}/${ZN[worst[1]]} gap ${gap.toFixed(1)} px`);
    L(`    ${String(`${W2}x${H2}`).padEnd(10)} ${tag}  ${f(layout.FIT.scale, 6, 3)}  `
      + `${`${ZN[worst[0]]}-${ZN[worst[1]]}`.padEnd(18)} ${f(gap, 6)}  ${f(gap * layout.MM_PER_CSSPX, 5, 2)}  ${res(good)}`);
  }
}
L(`    every pair separated by at least ${MIN_GAP_PX} px at every size  ${res(true)}`);

/* ============================================================ 3  WINDOWS */

L('');
L('=== TIMING WINDOWS (ticks are the unit; ms shown for humans only) ===');
L('    window        open      PERFECT band       close     span   perfect');
const b = new Int8Array(4);
for (let tw = 1; tw < TW_NAME.length; tw++) {
  tuning.windowFor(tw, b);
  const monotonic = b[0] <= b[1] && b[1] <= b[2] && b[2] <= b[3];
  ok(monotonic, `window ${TW_NAME[tw]} boundaries ordered`);
  L(`    ${TW_NAME[tw].padEnd(11)} ${f(b[0] * TICK_MS, 7)}ms  ${f(b[1] * TICK_MS, 7)}..${f(b[2] * TICK_MS, 6)}ms  ${f(b[3] * TICK_MS, 7)}ms  ${String(b[3] - b[0]).padStart(4)}t  ${String(b[2] - b[1] + 1).padStart(4)}t  ${res(monotonic)}`);

  // grade() must be exactly the table, at every tick from well before to well after.
  let bad = 0;
  for (let d = b[0] - 6; d <= b[3] + 6; d++) {
    const g = tuning.grade(tw, 1000 + d, 1000);
    const want = (d < b[0] || d > b[3]) ? GRADE.MISSED
      : d < b[1] ? GRADE.EARLY
        : d > b[2] ? GRADE.LATE : GRADE.PERFECT;
    if (g !== want) bad++;
  }
  ok(bad === 0, `grade(${TW_NAME[tw]}) exact at every tick`, `${bad} mismatches`);
}
ok(tuning.grade(TW.NONE, 5, 5) === GRADE.UNARMED, 'grade(NONE) is UNARMED');

/* ================================================= 4 + 5  THE FAKE BUS */

/** A bus of exactly the shape foundation's touch.js exposes. */
function makeBus() {
  const events = [];
  const pointers = [];
  for (let i = 0; i < 10; i++) pointers.push({ active: false, maxDist: 0 });
  return {
    events, pointers,
    eventsOnTick(tick, out) {
      let k = 0;
      for (let i = 0; i < events.length; i++) if (events[i].tick === tick && k < out.length) out[k++] = i;
      return k;
    },
    push(type, slot, x, y, tick) {
      events.push({ type, id: slot, slot, x, y, ms: tick * TICK_MS, tick, entry: null });
      const p = pointers[slot];
      if (type === 0) { p.active = true; p.maxDist = 0; p.ax = x; p.ay = y; }
      if (type === 1) p.maxDist = Math.max(p.maxDist, Math.hypot(x - p.ax, y - p.ay));
      if (type === 2 || type === 3) p.active = false;
    },
  };
}

const W = 390, H = 844;
layout.layoutZones(W, H);
const centreOf = (zone) => {
  for (const r of layout.ZONE_RECTS) {
    if (r[0] === zone) return { x: ((r[1] + r[3]) / 2) * W, y: ((r[2] + r[4]) / 2) * H };
  }
  return { x: 0, y: 0 };
};
const A = centreOf(ZONE.ACTION), STK = centreOf(ZONE.STICK);
const TRB = centreOf(ZONE.TURBO), PSS = centreOf(ZONE.PASS);

function run(bus, upTo, side, armTw, armPeak) {
  const st = stateM.createState();
  rez.setSurface(st, W, H);
  if (side !== undefined) rez.setContext(st, side);
  if (armTw) rez.arm(st, armTw, armPeak);
  const scratch = new Int32Array(64);
  const seen = { gestures: [], actions: [], grades: [] };
  for (let t = 0; t <= upTo; t++) {
    rez.resolve(st, t, bus, null, scratch);
    if (st.gesture) seen.gestures.push([t, st.gesture]);
    if (st.action) { seen.actions.push([t, st.action, st.actionTick]); seen.grades.push(st.grade); }
  }
  return { st, seen };
}

L('');
L('=== GESTURE CLASSIFICATION (fake bus, tick-exact) ===');
/**
 * EACH CASE NAMES THE WHOLE SEQUENCE, not a member of it.
 *
 * These used to assert `seen.gestures.some(g => g === want)`, which is blind to the only
 * interesting failure mode a gesture recogniser has: firing the right thing AND something
 * else. That is exactly the defect that shipped this round on the passing path — one tap
 * produced a PASS and then a TUCK — and `.some()` would have waved it through here too.
 * So the expectation is the full ordered list of gestures and the full ordered list of
 * actions, and an extra anything fails.
 *
 * `double` legitimately lists two of each: the first press cannot be known to be the
 * first half of a double until the second arrives, so a double emits its leading tap.
 */
const cases = [
  {
    name: 'tap', build: (u) => { u.push(0, 0, A.x, A.y, 10); u.push(2, 0, A.x, A.y, 15); },
    gestures: [GESTURE.TAP], actions: [ACT.STIFF_ARM],
  },
  {
    name: 'swipe', build: (u) => { u.push(0, 0, A.x, A.y, 10); u.push(1, 0, A.x - 40, A.y, 12); u.push(2, 0, A.x - 70, A.y, 16); },
    gestures: [GESTURE.SWIPE], actions: [ACT.JUKE_L],
  },
  {
    name: 'hold', build: (u) => { u.push(0, 0, A.x, A.y, 10); u.push(2, 0, A.x, A.y, 55); },
    gestures: [GESTURE.HOLD], actions: [ACT.PROTECT],
  },
  {
    name: 'double', build: (u) => { u.push(0, 0, A.x, A.y, 10); u.push(2, 0, A.x, A.y, 14); u.push(0, 0, A.x, A.y, 20); u.push(2, 0, A.x, A.y, 24); },
    gestures: [GESTURE.TAP, GESTURE.DOUBLE], actions: [ACT.STIFF_ARM, ACT.SPIN],
  },
];
for (const c of cases) {
  const bus = makeBus(); c.build(bus);
  const { seen } = run(bus, 70);
  const gs = seen.gestures.map((g) => GESTURE_NAME[g[1]]).join(',');
  const as = seen.actions.map((a) => ACT_NAME[a[1]]).join(',');
  const wantG = c.gestures.map((g) => GESTURE_NAME[g]).join(',');
  const wantA = c.actions.map((a) => ACT_NAME[a]).join(',');
  const got = gs === wantG && as === wantA;
  ok(got, `gesture ${c.name} emits exactly ${wantG} / ${wantA}`, `saw ${gs || 'nothing'} / ${as || 'nothing'}`);
  L(`    ${c.name.padEnd(8)} -> ${gs.padEnd(12)} action ${(as || '-').padEnd(22)} ${res(got)}`);
}

// A CANCEL is not a tap.
{
  const bus = makeBus();
  bus.push(0, 0, A.x, A.y, 10); bus.push(3, 0, A.x, A.y, 15);
  const { st, seen } = run(bus, 60);
  const good = seen.gestures.length === 0 && st.taps === 0 && seen.actions.length === 0;
  ok(good, 'pointercancel produces no gesture and no action');
  L(`    cancel   -> no gesture, no action, taps ${st.taps}  ${res(good)}`);
}

// Stick + ACTION on the same tick.
{
  const bus = makeBus();
  bus.push(0, 0, STK.x, STK.y, 10);
  bus.push(0, 1, A.x, A.y, 10);
  const { st } = run(bus, 12);
  const good = st.stickActive && st.btnA;
  ok(good, 'multitouch stick + action pad on the same tick');
  L(`    stick + action DOWN same tick -> stick ${st.stickActive}, A ${st.btnA}  ${res(good)}`);
}

// TURBO holds do not emit gestures (holding a hold-button is not a gesture).
{
  const bus = makeBus();
  bus.push(0, 0, TRB.x, TRB.y, 10); bus.push(2, 0, TRB.x, TRB.y, 80);
  const { st, seen } = run(bus, 100);
  const good = seen.gestures.length === 0 && st.holds === 0;
  ok(good, 'a long TURBO hold emits no HOLD gesture');
  L(`    turbo hold 70 ticks -> gestures ${seen.gestures.length}, holds ${st.holds}  ${res(good)}`);
}

// TURBO burns down and overheats deterministically.
//
// THIS USED TO READ `st.fuel === 0 || st.overheatUntil > 0` — an OR, evaluated once, at
// tick 200, where the second half is true from tick 93 onward and therefore carried the
// assertion for the whole life of the file while the first half was FALSE (the meter has
// been regenerating for 107 ticks by then). It could technically fail, so it is not a
// tautology, but it never once checked the thing it is named after. The fuel model is
// integer and deterministic — 1024 capacity, 11 burn, 4 regen, 45-tick lockout — so it
// has exact answers at exact ticks and there is no excuse for an inequality.
{
  const step = (upTo) => {
    const bus = makeBus();
    bus.push(0, 0, TRB.x, TRB.y, 0);
    return run(bus, upTo).st;
  };
  // 1024 / 11 = 93.1 ticks, so tick 93 is the first tick the meter cannot pay for.
  const empty = step(93);
  const drainedOk = empty.fuel === 0 && empty.overheatUntil === 93 + TUNING.overheatTicks && empty.boost === false;
  ok(drainedOk, 'turbo empties on the exact tick and latches a 45-tick lockout',
    `fuel ${empty.fuel} overheatUntil ${empty.overheatUntil} boost ${empty.boost}`);
  // Still held, but locked out: the control keeps registering (turbo true) while doing
  // nothing (boost false) and the meter refills at 4/tick underneath it.
  const mid = step(100);
  const lockedOk = mid.turbo === true && mid.boost === false && mid.fuel === 4 * (100 - 93);
  ok(lockedOk, 'a held-but-overheated turbo still presses, does not boost, and regenerates',
    `turbo ${mid.turbo} boost ${mid.boost} fuel ${mid.fuel}`);
  // The lockout ENDS and boost comes back without the player lifting a finger.
  const after = step(138);
  const reOk = after.boost === true && after.fuel === 176 - TUNING.fuelBurn;
  ok(reOk, 'boost resumes on the tick the lockout expires', `boost ${after.boost} fuel ${after.fuel}`);
  L(`    held from tick 0 -> empty@93 (fuel 0, boost off), lockout to 138,`);
  L(`    regen to ${mid.fuel} by tick 100, boost back on at 138 with fuel ${after.fuel}  ${res(drainedOk && lockedOk && reOk)}`);
}

/* ------------------------------------------------- mid-drag swipe commit */

L('');
L('=== COMMIT LATENCY (which tick the action actually fires on) ===');
{
  const bus = makeBus();
  bus.push(0, 0, A.x, A.y, 10);
  bus.push(1, 0, A.x - 30, A.y, 12);      // crosses swipeMinPx here
  bus.push(2, 0, A.x - 60, A.y, 40);      // lift much later
  const { seen } = run(bus, 60);
  const fired = seen.actions.length ? seen.actions[0][0] : -1;
  const judged = seen.actions.length ? seen.actions[0][2] : -1;
  const good = fired === 12 && judged === 10;
  ok(good, 'swipe commits mid-drag and is judged on the DOWN tick', `fired@${fired} judged@${judged}`);
  L(`    swipe: down@10 cross@12 lift@40 -> fires@${fired} (mid-drag), judged@${judged} (down)  ${res(good)}`);
}
{
  const bus = makeBus();
  bus.push(0, 0, A.x, A.y, 10);
  bus.push(2, 0, A.x, A.y, 15);
  const { seen } = run(bus, 60);
  const fired = seen.actions.length ? seen.actions[0][0] : -1;
  const judged = seen.actions.length ? seen.actions[0][2] : -1;
  const good = fired === 15 && judged === 10;
  ok(good, 'tap commits on release but is judged on the DOWN tick', `fired@${fired} judged@${judged}`);
  L(`    tap:   down@10 lift@15          -> fires@${fired} (release),  judged@${judged} (down)  ${res(good)}`);
}

/* ---------------------------------------------- grading across a window */

L('');
L('=== GRADING (a hit-stick swipe at every tick around a peak at 100) ===');
L('    press tick   delta   grade');
{
  // The range is the ring entry's LIFETIME (open-6 .. close+6), not an arbitrary span:
  // outside it the opportunity is gone and the correct answer is UNARMED, not MISSED.
  let bad = 0, extra = 0;
  for (let d = -14; d <= 14; d++) {
    const bus = makeBus();
    const t0 = 100 + d;
    bus.push(0, 0, A.x, A.y, t0);
    bus.push(1, 0, A.x, A.y + 40, t0);     // swipe DOWN = hit stick on defence
    const { seen, st } = run(bus, 160, tuning.SIDE.DEF, TW.HIT_STICK, 100);
    const want = tuning.grade(TW.HIT_STICK, t0, 100);
    // EXACTLY ONE action. A press outside the window must still fire (a game that eats
    // inputs to protect a window feels broken) and a press inside it must not fire twice.
    if (seen.actions.length !== 1) extra++;
    if (!seen.actions.length || seen.actions[0][1] !== ACT.HIT_STICK
      || seen.actions[0][2] !== t0 || st.grade !== want) bad++;
    if (d % 3 === 0) {
      L(`    ${String(t0).padStart(10)}  ${String(d).padStart(6)}   ${GRADE_NAME[st.grade]}`);
    }
  }
  ok(bad === 0, 'hit-stick graded correctly, and judged on the DOWN tick, at every tick', `${bad} bad`);
  ok(extra === 0, 'exactly one action per press across the whole window', `${extra} presses fired != 1`);
  L(`    29 press ticks around the peak, all graded to the table, one action each  ${res(bad === 0 && extra === 0)}`);
}

/* ------------------------------------------- 60 vs 30 Hz equivalence */

L('');
L('=== 60 Hz vs 30 Hz (the same wall-clock inputs must grade identically) ===');
{
  // Drive the SAME wall-clock script through a 60 Hz presenter (1 tick per frame) and a
  // 30 Hz presenter (2 ticks per frame). Events carry their own timestamps, so the
  // foundation binds them to the same TICKS either way — this checks that the controller
  // does not reintroduce a per-frame dependency of its own.
  function script(bus) {
    bus.push(0, 0, A.x, A.y, 97);
    bus.push(1, 0, A.x, A.y + 40, 98);
    bus.push(2, 0, A.x, A.y + 40, 104);
  }
  function drive(stepsPerFrame) {
    const bus = makeBus(); script(bus);
    const st = stateM.createState();
    rez.setSurface(st, W, H);
    rez.setContext(st, tuning.SIDE.DEF);
    rez.arm(st, TW.HIT_STICK, 100);
    const scratch = new Int32Array(64);
    let g = -1, act = -1, judged = -1, n = 0;
    for (let t = 0; t <= 160; t += stepsPerFrame) {
      for (let i = 0; i < stepsPerFrame; i++) {
        rez.resolve(st, t + i, bus, null, scratch);
        if (st.action) { g = st.grade; act = st.action; judged = st.actionTick; n++; }
      }
    }
    return { g, act, judged, n, hash: rez.hash(st) };
  }
  // 1, 2 AND 4 ticks per frame — 60 Hz, 30 Hz, and a 15 Hz worst case that no shipping
  // mode uses but that a stalled tab produces on catch-up. If batching depth could move a
  // grade, four would move it further than two.
  const a = drive(1), c = drive(2), q = drive(4);
  // EQUALITY IS NOT ENOUGH. Every field here starts at -1, so a resolver that fired
  // nothing at all would produce two identical structs and this assertion would pass
  // while proving that both batchings are equally broken. So the values are named:
  // the press at tick 97 against a peak at 100 is d=-3, the first tick of HIT_STICK's
  // perfect band, and it must fire exactly once at both rates.
  const real = a.act === ACT.HIT_STICK && a.g === GRADE.PERFECT && a.judged === 97 && a.n === 1;
  const eq = (x, y) => x.g === y.g && x.act === y.act && x.judged === y.judged
    && x.n === y.n && x.hash === y.hash;
  const same = eq(a, c) && eq(a, q);
  const good = real && same;
  ok(real, '60 Hz path actually fired the graded action it claims', `${ACT_NAME[a.act]} ${GRADE_NAME[a.g]} judged@${a.judged} n=${a.n}`);
  ok(same, 'identical grade, action and state hash at 1, 2 and 4 ticks per frame');
  L(`    1 tick/frame  (60 Hz) -> ${ACT_NAME[a.act]} ${GRADE_NAME[a.g]} judged@${a.judged} hash 0x${a.hash.toString(16)}`);
  L(`    2 ticks/frame (30 Hz) -> ${ACT_NAME[c.act]} ${GRADE_NAME[c.g]} judged@${c.judged} hash 0x${c.hash.toString(16)}`);
  L(`    4 ticks/frame (catch-up) -> ${ACT_NAME[q.act]} ${GRADE_NAME[q.g]} judged@${q.judged} hash 0x${q.hash.toString(16)}   ${res(good)}`);
}

/* --------------------------------------------------------- passing model */

L('');
L('=== PASSING (three commit paths, one pointer) ===');
function passSetup(st) {
  // Four receivers around a passer at mid-screen. Bearings from the passer:
  //   0 up-left, 1 straight up, 2 up-right, 3 right
  st.tgtX[0] = 90; st.tgtY[0] = 200; st.tgtId[0] = 80; st.tgtOpen[0] = 200;
  st.tgtX[1] = 195; st.tgtY[1] = 150; st.tgtId[1] = 81; st.tgtOpen[1] = 120;
  st.tgtX[2] = 300; st.tgtY[2] = 200; st.tgtId[2] = 82; st.tgtOpen[2] = 240;
  st.tgtX[3] = 360; st.tgtY[3] = 430; st.tgtId[3] = 83; st.tgtOpen[3] = 60;
  st.tgtPrimary = 1;
  rez.setTargets(st, 4, 195, 480);
}
function passRun(build, upTo = 80) {
  const bus = makeBus(); build(bus);
  const st = stateM.createState();
  rez.setSurface(st, W, H);
  rez.setContext(st, tuning.SIDE.QB);
  passSetup(st);
  const scratch = new Int32Array(64);
  let out = null;
  for (let t = 0; t <= upTo; t++) {
    rez.resolve(st, t, bus, null, scratch);
    if (st.action) out = { act: st.action, target: st.passTarget, power: st.passPower, t };
  }
  return { st, out };
}
/**
 * ONE PRESS, ONE ACTION. Every case below asserts `st.actions === 1`, and that clause is
 * not decoration — it is the entire round-2 showstopper.
 *
 * The "second thumb on an icon" case used to read
 *
 *     const good = r.st.actions >= 1 && r.st.passTarget !== undefined;
 *
 * which CANNOT FAIL. `st.passTarget` is initialised to -1 and re-cleared to -1 at the top
 * of every resolve(), so `!== undefined` is true for every possible execution, and
 * `actions >= 1` is true the moment anything at all fires. Its own printed line read
 * "2 action(s) fired" — it printed the bug and passed anyway, for a whole round, on the
 * primary passing path, while every sibling case one screen above it was checking
 * `act === ACT.PASS && target === 8X`. An assertion that cannot fail is worse than no
 * assertion, because a missing test is visible and a green one is not.
 */
const passCases = [
  {
    name: 'tap', label: 'bare tap on PASS throws to the primary read',
    build: (u) => { u.push(0, 0, PSS.x, PSS.y, 10); u.push(2, 0, PSS.x, PSS.y, 16); },
    act: ACT.PASS, target: 81, note: '(primary)',
  },
  {
    name: 'flick up-right', label: 'bearing flick up-right selects the up-right receiver',
    build: (u) => {
      u.push(0, 0, PSS.x, PSS.y, 10);
      u.push(1, 0, PSS.x + 40, PSS.y - 40, 13);
      u.push(2, 0, PSS.x + 40, PSS.y - 40, 15);
    },
    act: ACT.PASS, target: 82,
  },
  {
    name: 'drag onto icon 1', label: 'dragging onto a receiver icon overrides the bearing',
    build: (u) => {
      u.push(0, 0, PSS.x, PSS.y, 10);
      u.push(1, 0, 90, 200, 14);            // straight onto receiver 0's icon
      u.push(2, 0, 90, 200, 16);
    },
    act: ACT.PASS, target: 80,
  },
  {
    name: 'drag down', label: 'dragging down off the PASS pad tucks instead of throwing',
    build: (u) => {
      u.push(0, 0, PSS.x, PSS.y, 10);
      u.push(1, 0, PSS.x, PSS.y + 60, 14);
      u.push(2, 0, PSS.x, PSS.y + 60, 16);
    },
    act: ACT.TUCK, target: -1,
  },
];
for (const c of passCases) {
  const r = passRun(c.build);
  const good = r.st.actions === 1 && r.out && r.out.act === c.act && r.out.target === c.target;
  ok(good, c.label, `${r.st.actions} action(s): ${ACT_NAME[r.out ? r.out.act : 0]} -> #${r.out ? r.out.target : '-'}`);
  L(`    ${c.name.padEnd(22)} -> ${String(r.st.actions)} action: ${ACT_NAME[r.out ? r.out.act : 0]}`
    + `${c.target >= 0 ? ` to #${r.out ? r.out.target : '-'}` : ''} ${c.note || ''}  ${res(good)}`);
}
{ // cancel -> no throw at all
  const r = passRun((u) => {
    u.push(0, 0, PSS.x, PSS.y, 10);
    u.push(1, 0, PSS.x + 40, PSS.y - 40, 13);
    u.push(3, 0, PSS.x + 40, PSS.y - 40, 15);
  });
  const good = !r.out && r.st.actions === 0;
  ok(good, 'a cancelled PASS pointer never throws', `${r.st.actions} action(s)`);
  L(`    ${'cancel while aiming'.padEnd(22)} -> ${r.st.actions} actions                     ${res(good)}`);
}
{ // power from hold duration
  const bullet = passRun((u) => { u.push(0, 0, PSS.x, PSS.y, 10); u.push(2, 0, PSS.x, PSS.y, 15); });
  const lob = passRun((u) => { u.push(0, 0, PSS.x, PSS.y, 10); u.push(2, 0, PSS.x, PSS.y, 45); }, 90);
  const good = !!bullet.out && !!lob.out && bullet.out.power === 0 && lob.out.power === 2
    && bullet.st.actions === 1 && lob.st.actions === 1;
  ok(good, 'pass power comes from the hold duration',
    `${bullet.out ? bullet.out.power : '-'} / ${lob.out ? lob.out.power : '-'}`);
  L(`    5-tick hold -> power ${bullet.out ? bullet.out.power : '-'} (bullet), 35-tick hold -> power ${lob.out ? lob.out.power : '-'} (lob)  ${res(good)}`);
}

/* ------------------------------- THE ROUND-2 SHOWSTOPPER, PINNED DOWN ---- */

L('');
L('=== SECOND THUMB ON A RECEIVER ICON (the round-2 defect; one press, ONE action) ===');
/**
 * The DOWN on a receiver icon commits the throw immediately, at true input latency, while
 * the first thumb keeps holding PASS. That means the icon pointer's LIFT has nothing left
 * to say — and until this round it said plenty, because ZONE.RECEIVER was set on the DOWN
 * and then matched by none of the zone arms in the UP handler, so the lift fell through
 * to the generic ACTION-pad vocabulary and fired a second action out of PAD_MAP.
 *
 * Three variants, because the three tails of that fall-through were three different
 * actions: a clean lift hit the TAP column (ACT.TUCK at SIDE.QB — the QB threw the ball
 * and then tucked and ran with it), a lift after 40 px of thumb drift hit the SWIPE
 * column (ACT.SLIDE), and a lift after 20+ ticks hit the HOLD column (ACT.SLIDE again).
 * All three are asserted, not just the one that was reported.
 */
const iconCases = [
  {
    name: 'lift clean @17', upTo: 90,
    build: (u) => {
      u.push(0, 0, PSS.x, PSS.y, 10);       // hold PASS
      u.push(0, 1, 300, 200, 14);           // second thumb on receiver 2's icon
      u.push(2, 1, 300, 200, 17);
      u.push(2, 0, PSS.x, PSS.y, 24);
    },
  },
  {
    name: 'drift 40 px, lift @17', upTo: 90,
    build: (u) => {
      u.push(0, 0, PSS.x, PSS.y, 10);
      u.push(0, 1, 300, 200, 14);
      u.push(1, 1, 300, 240, 16);           // 40 px of drift before the lift
      u.push(2, 1, 300, 240, 17);
      u.push(2, 0, PSS.x, PSS.y, 24);
    },
  },
  {
    name: 'rest 46 ticks, lift @60', upTo: 130,
    build: (u) => {
      u.push(0, 0, PSS.x, PSS.y, 10);
      u.push(0, 1, 300, 200, 14);
      u.push(2, 1, 300, 200, 60);           // well past holdTicks
      u.push(2, 0, PSS.x, PSS.y, 70);
    },
  },
];
for (const c of iconCases) {
  const bus = makeBus(); c.build(bus);
  const st = stateM.createState();
  rez.setSurface(st, W, H);
  rez.setContext(st, tuning.SIDE.QB);
  passSetup(st);
  const scratch = new Int32Array(64);
  const log = [];
  for (let t = 0; t <= c.upTo; t++) {
    rez.resolve(st, t, bus, null, scratch);
    if (st.action) log.push(`tick ${t} ${ACT_NAME[st.action]}${st.passTarget >= 0 ? ` #${st.passTarget}` : ''}`);
  }
  const good = st.actions === 1 && log.length === 1 && log[0] === 'tick 14 pass #82';
  ok(good, `receiver-icon tap fires exactly one PASS (${c.name})`, log.join(' THEN ') || 'nothing');
  L(`    ${c.name.padEnd(22)} -> ${log.join('  THEN  ') || '(nothing)'}  ${res(good)}`);
}

/* ------------------------------------------------------ 6  ALLOCATION */

L('');
L('=== ALLOCATION (the resolve path must not feed the GC) ===');
{
  const st = stateM.createState();
  rez.setSurface(st, W, H);
  const bus = makeBus();
  const scratch = new Int32Array(64);
  // A realistic mixed load: stick held and dragged, action pad tapped and swiped, turbo
  // held. 60,000 ticks of it.
  for (let t = 0; t < 600; t++) {
    if (t % 60 === 0) { bus.events.length = 0; bus.push(0, 0, STK.x, STK.y, t); bus.push(0, 1, TRB.x, TRB.y, t); }
    if (t % 60 === 10) bus.push(1, 0, STK.x + 30, STK.y - 20, t);
    if (t % 60 === 20) { bus.push(0, 2, A.x, A.y, t); bus.push(1, 2, A.x - 40, A.y, t); }
    if (t % 60 === 30) { bus.push(2, 2, A.x - 40, A.y, t); }
    if (t % 60 === 50) { bus.push(2, 0, STK.x + 30, STK.y - 20, t); bus.push(2, 1, TRB.x, TRB.y, t); }
  }
  if (global.gc) global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let pass = 0; pass < 100; pass++) {
    for (let t = 0; t < 600; t++) rez.resolve(st, t, bus, null, scratch);
  }
  const after = process.memoryUsage().heapUsed;
  const perTick = (after - before) / 60000;
  const good = perTick < 8;
  ok(good, 'resolve() allocates < 8 B/tick', `${perTick.toFixed(2)} B/tick`);
  L(`    60,000 resolve() calls over a mixed load -> ${perTick.toFixed(2)} bytes/tick of heap growth  ${res(good)}`);
  L('    (run with --expose-gc for a tighter number; anything under a byte or two is noise)');
}

L('');
L(`VERDICT  ${fails ? 'FAIL' : 'PASS'}   ${n} assertions, ${fails} failures`);
process.exit(fails ? 1 : 0);
