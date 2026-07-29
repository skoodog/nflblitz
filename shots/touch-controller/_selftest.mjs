#!/usr/bin/env node
// touch-controller SELF-TEST — headless, no browser, no renderer.
//
// The four harness commands judge the piece from the outside. This one judges the parts
// of it that are PURE FUNCTIONS OF TICKS, which is where the timing model lives, and it
// runs in milliseconds so it can be run on every edit:
//
//   1  the reach table, in mm, in BOTH orientations, against the 40 mm budget
//   2  the zone rectangles are disjoint (a control that loses a hit-test to table order
//      is a control that stops working when somebody reorders a list)
//   3  every timing window's boundaries, and grade() at every tick across each of them
//   4  the same gesture script resolved at 60 Hz and at 30 Hz produces the SAME grades
//   5  gesture classification against a fake bus of the exact shape touch.js exposes
//   6  zero allocation on the resolve path, measured with process.memoryUsage deltas
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

L('');
L('=== REACH (thumb pivots at the bottom corners; cap 40 mm; 1 CSS px = 0.1833 mm) ===');
for (const [vw, vh, name] of [[390, 844, 'portrait  390x844'], [844, 390, 'landscape 844x390']]) {
  const rows = layout.reachReport(vw, vh);
  const gap = layout.minZoneGap(vw, vh);
  L(`  ${name}`);
  L('    zone      home mm   hit-centre mm   px      nearest pivot');
  for (const r of rows) {
    const good = r.homeMm <= THUMB_MM && r.centreMm <= THUMB_MM;
    ok(good, `reach ${ZN[r.zone]} @ ${name}`, `${r.centreMm.toFixed(1)} mm`);
    L(`    ${ZN[r.zone].padEnd(8)} ${f(r.homeMm, 8)}   ${f(r.centreMm, 13)}  ${f(r.centrePx, 6, 0)}   ${r.pivot.padEnd(12)} ${res(good)}`);
  }
  ok(gap > 0, `zone rectangles disjoint @ ${name}`, `min gap ${gap.toFixed(1)} px`);
  L(`    minimum gap between any two hit rectangles: ${gap.toFixed(1)} px  ${res(gap > 0)}`);
}

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
const cases = [
  { name: 'tap', want: GESTURE.TAP, build: (u) => { u.push(0, 0, A.x, A.y, 10); u.push(2, 0, A.x, A.y, 15); } },
  { name: 'swipe', want: GESTURE.SWIPE, build: (u) => { u.push(0, 0, A.x, A.y, 10); u.push(1, 0, A.x - 40, A.y, 12); u.push(2, 0, A.x - 70, A.y, 16); } },
  { name: 'hold', want: GESTURE.HOLD, build: (u) => { u.push(0, 0, A.x, A.y, 10); u.push(2, 0, A.x, A.y, 55); } },
  { name: 'double', want: GESTURE.DOUBLE, build: (u) => { u.push(0, 0, A.x, A.y, 10); u.push(2, 0, A.x, A.y, 14); u.push(0, 0, A.x, A.y, 20); u.push(2, 0, A.x, A.y, 24); } },
];
for (const c of cases) {
  const bus = makeBus(); c.build(bus);
  const { seen } = run(bus, 70);
  const got = seen.gestures.some((g) => g[1] === c.want);
  ok(got, `gesture ${c.name}`, `saw ${seen.gestures.map((g) => GESTURE_NAME[g[1]]).join(',') || 'nothing'}`);
  L(`    ${c.name.padEnd(8)} -> ${seen.gestures.map((g) => GESTURE_NAME[g[1]]).join(',').padEnd(12)} action ${(seen.actions.map((a) => ACT_NAME[a[1]]).join(',') || '-').padEnd(20)} ${res(got)}`);
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
{
  const bus = makeBus();
  bus.push(0, 0, TRB.x, TRB.y, 0);
  const { st } = run(bus, 200);
  const good = st.fuel === 0 || st.overheatUntil > 0;
  ok(good, 'turbo burns to empty and latches the overheat lockout');
  L(`    turbo held 200 ticks -> fuel ${st.fuel}/1024, overheatUntil ${st.overheatUntil}, boost ${st.boost}  ${res(good)}`);
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
  let bad = 0;
  for (let d = -14; d <= 14; d++) {
    const bus = makeBus();
    const t0 = 100 + d;
    bus.push(0, 0, A.x, A.y, t0);
    bus.push(1, 0, A.x, A.y + 40, t0);     // swipe DOWN = hit stick on defence
    const { seen, st } = run(bus, 160, tuning.SIDE.DEF, TW.HIT_STICK, 100);
    const want = tuning.grade(TW.HIT_STICK, t0, 100);
    if (!seen.actions.length || seen.actions[0][1] !== ACT.HIT_STICK || st.grade !== want) bad++;
    if (d % 3 === 0) {
      L(`    ${String(t0).padStart(10)}  ${String(d).padStart(6)}   ${GRADE_NAME[st.grade]}`);
    }
  }
  ok(bad === 0, 'hit-stick graded correctly at every tick across its window', `${bad} bad`);
  L(`    25 press ticks around the peak, all graded to the table  ${res(bad === 0)}`);
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
    let g = -1, act = -1, judged = -1;
    for (let t = 0; t <= 160; t += stepsPerFrame) {
      for (let i = 0; i < stepsPerFrame; i++) {
        rez.resolve(st, t + i, bus, null, scratch);
        if (st.action) { g = st.grade; act = st.action; judged = st.actionTick; }
      }
    }
    return { g, act, judged, hash: rez.hash(st) };
  }
  const a = drive(1), c = drive(2);
  const good = a.g === c.g && a.act === c.act && a.judged === c.judged && a.hash === c.hash;
  ok(good, 'identical grade, action and state hash at 60 Hz and 30 Hz');
  L(`    60 Hz -> ${ACT_NAME[a.act]} ${GRADE_NAME[a.g]} judged@${a.judged} hash 0x${a.hash.toString(16)}`);
  L(`    30 Hz -> ${ACT_NAME[c.act]} ${GRADE_NAME[c.g]} judged@${c.judged} hash 0x${c.hash.toString(16)}   ${res(good)}`);
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
{ // bare tap -> primary read
  const r = passRun((u) => { u.push(0, 0, PSS.x, PSS.y, 10); u.push(2, 0, PSS.x, PSS.y, 16); });
  const good = r.out && r.out.act === ACT.PASS && r.out.target === 81;
  ok(good, 'bare tap on PASS throws to the primary read');
  L(`    tap                    -> ${ACT_NAME[r.out ? r.out.act : 0]} to #${r.out ? r.out.target : '-'} (primary)  ${res(good)}`);
}
{ // bearing flick up-right -> receiver 2
  const r = passRun((u) => {
    u.push(0, 0, PSS.x, PSS.y, 10);
    u.push(1, 0, PSS.x + 40, PSS.y - 40, 13);
    u.push(2, 0, PSS.x + 40, PSS.y - 40, 15);
  });
  const good = r.out && r.out.act === ACT.PASS && r.out.target === 82;
  ok(good, 'bearing flick up-right selects the up-right receiver');
  L(`    flick up-right         -> ${ACT_NAME[r.out ? r.out.act : 0]} to #${r.out ? r.out.target : '-'}            ${res(good)}`);
}
{ // drag onto an icon -> that receiver, whatever the bearing says
  const r = passRun((u) => {
    u.push(0, 0, PSS.x, PSS.y, 10);
    u.push(1, 0, 90, 200, 14);            // straight onto receiver 0's icon
    u.push(2, 0, 90, 200, 16);
  });
  const good = r.out && r.out.act === ACT.PASS && r.out.target === 80;
  ok(good, 'dragging onto a receiver icon overrides the bearing');
  L(`    drag onto icon 1       -> ${ACT_NAME[r.out ? r.out.act : 0]} to #${r.out ? r.out.target : '-'}            ${res(good)}`);
}
{ // second thumb on an icon while PASS is held
  const r = passRun((u) => {
    u.push(0, 0, PSS.x, PSS.y, 10);
    u.push(0, 1, 300, 200, 14);           // other thumb taps receiver 2's icon
    u.push(2, 1, 300, 200, 17);
    u.push(2, 0, PSS.x, PSS.y, 20);
  });
  const good = r.st.actions >= 1 && r.st.passTarget !== undefined;
  ok(good, 'a second thumb on an icon commits the throw');
  L(`    second thumb on icon 3 -> ${r.st.actions} action(s) fired                 ${res(good)}`);
}
{ // drag straight down -> tuck, not a throw
  const r = passRun((u) => {
    u.push(0, 0, PSS.x, PSS.y, 10);
    u.push(1, 0, PSS.x, PSS.y + 60, 14);
    u.push(2, 0, PSS.x, PSS.y + 60, 16);
  });
  const good = r.out && r.out.act === ACT.TUCK;
  ok(good, 'dragging down off the PASS pad tucks instead of throwing');
  L(`    drag down              -> ${ACT_NAME[r.out ? r.out.act : 0]}                          ${res(good)}`);
}
{ // cancel -> no throw at all
  const r = passRun((u) => {
    u.push(0, 0, PSS.x, PSS.y, 10);
    u.push(1, 0, PSS.x + 40, PSS.y - 40, 13);
    u.push(3, 0, PSS.x + 40, PSS.y - 40, 15);
  });
  const good = !r.out;
  ok(good, 'a cancelled PASS pointer never throws');
  L(`    cancel while aiming    -> no action                    ${res(good)}`);
}
{ // power from hold duration
  const bullet = passRun((u) => { u.push(0, 0, PSS.x, PSS.y, 10); u.push(2, 0, PSS.x, PSS.y, 15); });
  const lob = passRun((u) => { u.push(0, 0, PSS.x, PSS.y, 10); u.push(2, 0, PSS.x, PSS.y, 45); }, 90);
  const good = bullet.out.power === 0 && lob.out.power === 2;
  ok(good, 'pass power comes from the hold duration');
  L(`    5-tick hold -> power ${bullet.out.power} (bullet), 35-tick hold -> power ${lob.out.power} (lob)  ${res(good)}`);
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
