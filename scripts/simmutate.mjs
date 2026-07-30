#!/usr/bin/env node
// THE MUTATION BATTERY FOR play-sim.
//
// The rule this project works under: any predicate that cannot be made to fail by a
// deliberate mutation of the code is not a test. A sister piece here shipped a suite where
// 20 of 38 deliberate mutations left it green, so "the assertions look specific" is not
// evidence of anything. This is the evidence.
//
// Each mutation below breaks ONE named mechanism in sim.js -- and each one is a defect this
// piece actually shipped at some point during its construction, not an invented one. The
// battery patches the source, re-imports it, and requires the checks to notice. A mutation
// that survives is reported as SURVIVED and is a hole in the suite, stated rather than
// hidden.
//
//   node scripts/simmutate.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SIM = path.join(ROOT, 'src/pieces/play-sim/sim.js');
const SRC = fs.readFileSync(SIM, 'utf8');
const playbook = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/playbook.json'), 'utf8'));
const players = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/players.json'), 'utf8'));
const clubs = Object.keys(players.byTeam);
const KC = players.byTeam.KC, BUF = players.byTeam.BUF;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'simmut-'));
let serial = 0;

/** Load a copy of sim.js with `edits` applied. Each edit must match exactly, once. */
async function load(edits) {
  let src = SRC.replace(/from '\.\.\/\.\.\/foundation\/rng\.js'/,
    `from ${JSON.stringify(pathToFileURL(path.join(ROOT, 'src/foundation/rng.js')).href)}`);
  for (const [find, repl] of edits || []) {
    const n = src.split(find).length - 1;
    if (n !== 1) throw new Error(`anchor matched ${n} times, expected 1: ${find.slice(0, 70)}`);
    src = src.replace(find, repl);
  }
  const f = path.join(tmp, `sim${serial++}.mjs`);
  fs.writeFileSync(f, src);
  return import(pathToFileURL(f).href);
}

/* ------------------------------------------------------------ the predicates ---- */
// Compact forms of what scripts/gametest.mjs asserts, on smaller samples so the battery
// runs in seconds rather than minutes. Each returns null when satisfied, or a reason.

const dIdx = (id) => playbook.defense.findIndex((x) => x.id === id);
const play = (S, o, d, seed, off, def) => S.runPlay(S.createPlay(
  seed, playbook.offense[o], playbook.defense[d], off || KC, def || BUF, playbook.formation));

/** Sack rate for one defensive call, swept over a slice of the league. */
// SIXTEEN CLUBS, NOT EIGHT. An eight-club sample reported the unmutated sim as failing its
// own rush-monotonicity and receiver-speed predicates -- the same subsampling artefact that
// had earlier put a false failure in the suite itself. A battery whose baseline is noisy
// cannot tell a killed mutation from a coincidence. Sixteen was measured against all
// thirty-two and agrees on both (rush 40/26/12/0 vs 41/28/12/0; speed 5.49<5.75<6.67 vs
// 5.21<5.47<6.41) at half the runtime.
function sackRate(S, id, stride) {
  let s = 0, n = 0;
  const d = dIdx(id);
  for (let t = 0; t < clubs.length; t += (stride || 2)) {
    const off = players.byTeam[clubs[t]], def = players.byTeam[clubs[(t + 7) % clubs.length]];
    for (let o = 0; o < playbook.offense.length; o++) {
      if (play(S, o, d, 9000 + t * 131 + o * 41, off, def).result === S.RESULT.SACK) s++;
      n++;
    }
  }
  return s / n;
}

function leagueMix(S, mutate, stride) {
  const mix = {};
  let tot = 0, n = 0;
  for (let t = 0; t < clubs.length; t += (stride || 2)) {
    const off = mutate ? mutate(players.byTeam[clubs[t]]) : players.byTeam[clubs[t]];
    const def = players.byTeam[clubs[(t + 7) % clubs.length]];
    for (let o = 0; o < playbook.offense.length; o++) {
      for (let d = 0; d < playbook.defense.length; d++) {
        const st = play(S, o, d, 9000 + t * 131 + o * 41 + d * 7, off, def);
        mix[S.RESULT_NAME[st.result]] = (mix[S.RESULT_NAME[st.result]] || 0) + 1;
        tot += st.yards; n++;
      }
    }
  }
  return { mix, ypp: tot / n, n };
}

const PREDICATES = {
  determinism(S) {
    const a = play(S, 0, 0, 4242), b = play(S, 0, 0, 4242);
    return (a.yards === b.yards && a.result === b.result && a.tick === b.tick)
      ? null : 'same seed gave a different play';
  },

  seedMatters(S) {
    let diff = 0, n = 0;
    for (let o = 0; o < playbook.offense.length; o++) {
      for (let d = 0; d < playbook.defense.length; d++) {
        const p1 = play(S, o, d, 400 + o * 13 + d), p2 = play(S, o, d, 90000 + o * 13 + d);
        if (p1.yards !== p2.yards || p1.result !== p2.result || p1.tick !== p2.tick) diff++;
        n++;
      }
    }
    return diff > n * 0.35 ? null : `only ${diff}/${n} pairs differ by seed`;
  },

  terminates(S) {
    for (let o = 0; o < playbook.offense.length; o++) {
      for (let d = 0; d < playbook.defense.length; d++) {
        const st = play(S, o, d, 1000 + o * 31 + d);
        if (st.tick >= 600 || st.result === S.RESULT.LIVE) return `play ${o}/${d} did not finish`;
      }
    }
    return null;
  },

  onField(S) {
    for (let o = 0; o < playbook.offense.length; o++) {
      for (let d = 0; d < playbook.defense.length; d++) {
        const st = play(S, o, d, 1700 + o * 31 + d);
        if (st.yards < -25 || st.yards > 100) return `result ${st.yards} yd off the map`;
        for (const m of st.off.concat(st.def)) {
          if (Math.abs(m.x) > 30 || m.y < -30) return `${m.slot} at ${m.x.toFixed(0)},${m.y.toFixed(0)}`;
        }
      }
    }
    return null;
  },

  rushMonotone(S) {
    const r6 = sackRate(S, 'all_out'), r4 = sackRate(S, 'blitz_2');
    const r3 = sackRate(S, 'blitz_1'), r2 = sackRate(S, 'deep_zone');
    const shown = `6r ${(r6 * 100).toFixed(0)}% 4r ${(r4 * 100).toFixed(0)}% 3r ${(r3 * 100).toFixed(0)}% 2r ${(r2 * 100).toFixed(0)}%`;
    return (r6 > r4 && r4 > r3 && r3 > r2) ? null : `not monotone: ${shown}`;
  },

  doubleTeam(S) {
    const two = S.createPlay(1, playbook.offense[0], playbook.defense[dIdx('deep_zone')], KC, BUF, playbook.formation);
    const six = S.createPlay(1, playbook.offense[0], playbook.defense[dIdx('all_out')], KC, BUF, playbook.formation);
    S.step(two); S.step(six);
    const freeMen = (st) => st.def.filter((d) => st.defense.assign[d.slot] === 'rush' && !d.blocked).length;
    if (freeMen(two) !== 0) return `two-man rush left ${freeMen(two)} unblocked`;
    if (freeMen(six) !== 3) return `six-man rush left ${freeMen(six)} unblocked, want 3`;
    const hold = (st) => Math.min(...st.def.filter((d) => d.blocked > 0).map((d) => d.holdTicks));
    return hold(two) > hold(six) * 1.3 ? null
      : `spare blocker idle: ${hold(two).toFixed(0)} vs ${hold(six).toFixed(0)} ticks`;
  },

  receiverSpeed(S) {
    const at = (v) => leagueMix(S, (r) => r.map((p) => (p.slot.startsWith('REC') ? { ...p, spd: v } : p))).ypp;
    const a = at(30), b = at(65), c = at(99);
    return (a < b && b < c) ? null : `${a.toFixed(2)} / ${b.toFixed(2)} / ${c.toFixed(2)}`;
  },

  passerArm(S) {
    const at = (v) => leagueMix(S, (r) => r.map((p) => (p.slot === 'QB' ? { ...p, pas: v } : p))).ypp;
    const a = at(30), b = at(65), c = at(99);
    return (a < b && b < c) ? null : `${a.toFixed(2)} / ${b.toFixed(2)} / ${c.toFixed(2)}`;
  },

  fastReceiverNotPenalised(S) {
    const incAt = (spd) => {
      let inc = 0, n = 0;
      const off = KC.map((p) => (p.slot.startsWith('REC') ? { ...p, spd } : p));
      for (let o = 0; o < playbook.offense.length; o++) {
        for (let d = 0; d < playbook.defense.length; d++) {
          if (play(S, o, d, 600 + o * 41 + d * 7, off).result === S.RESULT.INCOMPLETE) inc++;
          n++;
        }
      }
      return inc / n;
    };
    const slow = incAt(30), fast = incAt(99);
    return fast <= slow + 0.05 ? null
      : `${(fast * 100).toFixed(0)}% incomplete at 99 vs ${(slow * 100).toFixed(0)}% at 30`;
  },

  scrambleBothWays(S) {
    let behind = 0, beyond = 0, scr = 0, n = 0;
    const d = dIdx('all_out');
    for (let t = 0; t < clubs.length; t += 2) {
      const off = players.byTeam[clubs[t]], def = players.byTeam[clubs[(t + 7) % clubs.length]];
      for (let o = 0; o < playbook.offense.length; o++) {
        const st = play(S, o, d, 9000 + t * 131 + o * 41, off, def);
        n++;
        if (!st.events.some((e) => e.kind === 'scramble')) continue;
        scr++;
        if (st.result === S.RESULT.SACK) behind++;
        else if (st.result === S.RESULT.TACKLED || st.result === S.RESULT.TOUCHDOWN) beyond++;
      }
    }
    if (scr <= n * 0.15) return `only ${scr}/${n} downs scrambled`;
    return (behind > 0 && beyond > 0) ? null : `${behind} sacked, ${beyond} past the line`;
  },

  sackLosesGround(S) {
    for (let t = 0; t < clubs.length; t += 4) {
      const off = players.byTeam[clubs[t]], def = players.byTeam[clubs[(t + 7) % clubs.length]];
      for (let o = 0; o < playbook.offense.length; o++) {
        for (let d = 0; d < playbook.defense.length; d++) {
          const st = play(S, o, d, 9000 + t * 131 + o * 41 + d * 7, off, def);
          if (st.result === S.RESULT.SACK && st.yards >= 0) return `sack recorded for ${st.yards} yd`;
        }
      }
    }
    return null;
  },

  // A FULLY BLOCKED FRONT MUST NOT PANIC THE PASSER. Three blockers means at most three
  // rushers are ever held at once, so the held-pressure weight has to stay under a third of
  // the flush threshold or blocked men alone trip it -- which is exactly the defect that
  // made a six-man rush sack LESS than a two-man one. Every outcome-level assertion missed
  // that mutation once the scramble existed to absorb it; this one looks at the mechanism.
  flushNeedsFreeMan(S) {
    const dz = playbook.defense[dIdx('deep_zone')];   // two rushers, three blockers, none free
    let flushed = 0, n = 0;
    for (let o = 0; o < playbook.offense.length; o++) {
      for (let s = 0; s < 6; s++) {
        const st = S.runPlay(S.createPlay(500 + o * 31 + s, playbook.offense[o], dz, KC, BUF, playbook.formation));
        if (st.flushedAt !== undefined) flushed++;
        n++;
      }
    }
    return flushed === 0 ? null : `${flushed}/${n} downs flushed with nobody unblocked`;
  },

  // THE RELEASE TICK HAS TO MOVE. Ball placement already varies by seed through the throw
  // error, which is enough to make outcomes differ -- so a check on outcomes cannot see
  // whether the passer's TIMING varies at all. Without the read jitter every down releases
  // on the identical tick, and the same answer beats the same call forever.
  releaseSpread(S) {
    const ticks = new Set();
    for (let s = 0; s < 40; s++) {
      const st = S.runPlay(S.createPlay(7000 + s * 97, playbook.offense[0],
        playbook.defense[dIdx('deep_zone')], KC, BUF, playbook.formation));
      const th = st.events.find((e) => e.kind === 'throw');
      if (th) ticks.add(th.tick);
    }
    return ticks.size >= 8 ? null : `only ${ticks.size} distinct release ticks over 40 seeds`;
  },

  // THE PASSER'S SEPARATION FLOOR. He declines a covered receiver rather than forcing it,
  // which is what turns a well-covered down into a sack or a throwaway instead of a free
  // attempt. Removing the floor entirely changed no outcome bound this suite checks, so it
  // is asserted where it happens: on the separation recorded at release.
  separationFloor(S) {
    let min = Infinity, n = 0;
    for (let o = 0; o < playbook.offense.length; o++) {
      for (let d = 0; d < playbook.defense.length; d++) {
        for (let s = 0; s < 3; s++) {
          const st = S.runPlay(S.createPlay(300 + o * 41 + d * 7 + s, playbook.offense[o],
            playbook.defense[d], KC, BUF, playbook.formation));
          for (const e of st.events) if (e.kind === 'throw') { min = Math.min(min, e.sep); n++; }
        }
      }
    }
    if (!n) return 'no throws at all';
    return min >= 1.85 ? null : `a throw left with ${min.toFixed(2)} yd of separation`;
  },

  balance(S) {
    const { mix, ypp, n } = leagueMix(S);
    if ((mix.sack || 0) / n >= 0.30) return `${(((mix.sack || 0) / n) * 100).toFixed(1)}% sacks`;
    if ((mix.interception || 0) / n >= 0.08) return `${(((mix.interception || 0) / n) * 100).toFixed(1)}% picks`;
    if (!(ypp > 3 && ypp < 12)) return `${ypp.toFixed(2)} yards per play`;
    return null;
  },

  playSpread(S) {
    const meanFor = (o) => {
      let t = 0, n = 0;
      for (let d = 0; d < playbook.defense.length; d++) {
        for (let s = 0; s < 4; s++) { t += play(S, o, d, 7000 + o * 977 + d * 31 + s * 7).yards; n++; }
      }
      return t / n;
    };
    const m = playbook.offense.map((_, o) => meanFor(o));
    const spread = Math.max(...m) - Math.min(...m);
    return spread >= 6 ? null : `only ${spread.toFixed(1)} yd between best and worst call`;
  },
};

/* -------------------------------------------------------------- the mutations ---- */
// Every one of these is a defect this piece actually shipped, reintroduced on purpose.

const MUTATIONS = [
  {
    name: 'block: the spare blocker idles instead of doubling',
    was: 'a two-man rush was blocked exactly as well as a six-man one; 2r and 3r both sacked 33%',
    edits: [['  const engaged = order.filter((r) => r.blocked > 0);',
      '  const engaged = [];']],
  },
  {
    name: 'block: a held rusher is never slowed at all',
    edits: [['const BLOCK_SLOW = 0.16;', 'const BLOCK_SLOW = 1.0;']],
  },
  {
    name: 'block: a block never loses',
    edits: [['const BLOCK_HOLD_TICKS = 100;', 'const BLOCK_HOLD_TICKS = 100000;']],
  },
  {
    name: 'block: rushers are paired one-to-one with no surplus running free',
    was: 'blockers slowed every rusher within reach of ANY blocker; 6r and 2r both sacked 67%',
    edits: [['  for (const r of rushers) { r.blocked = 0; r.holdTicks = 0; }',
      '  for (const r of rushers) { r.blocked = 1; r.holdTicks = BLOCK_HOLD_TICKS; }']],
  },
  {
    name: 'pressure: blocked men count as much as free ones',
    was: 'three blocked rushers tripped the flush at tick 66 and the six-man rush sacked LESS than the two-man',
    edits: [['const PRESSURE_HELD = 0.25;', 'const PRESSURE_HELD = 1.0;']],
  },
  {
    name: 'blitz: rushers do not walk up, they rush from their coverage alignment',
    was: 'a six-man pressure sent three DBs from 7-14 yards deep; they arrived around tick 110',
    edits: [['    if (d.y > BLITZ_DEPTH) d.y = BLITZ_DEPTH;', '    if (false) d.y = BLITZ_DEPTH;']],
  },
  {
    name: 'read: the hot throw ignores whether the receiver has broken',
    was: 'a uniform "has run seven yards" erased the difference between a slant and a go route',
    edits: [['export function firstBreak(route) {\n  if (!route || route.length < 2) return 0;',
      'export function firstBreak(route) {\n  if (route) return 0;\n  if (!route || route.length < 2) return 0;']],
  },
  {
    name: 'throw: lead along instantaneous heading instead of along the route',
    was: 'a corps at 99 threw 36% incomplete against 18% at 25 -- speed was a penalty',
    edits: [['    if (!route) return [rec.x + rec.vx * ticks, rec.y + rec.vy * ticks];',
      '    return [rec.x + rec.vx * ticks, rec.y + rec.vy * ticks];']],
  },
  {
    name: 'throw: a perfectly accurate ball, and the passer rating unread',
    was: 'incompletions collapsed to a tenth of throws; Mahomes threw a third-stringer\'s ball',
    edits: [['const THROW_ERR = 2.2;', 'const THROW_ERR = 0;']],
  },
  {
    name: 'scramble: the passer never runs',
    was: '21.7% of all downs were sacks and the median gain sat on zero',
    edits: [['        state.scrambling = true;', '        state.scrambling = false;']],
  },
  {
    name: 'scramble: a scrambler is never sacked, wherever he is dropped',
    was: 'every sack against an all-out rush became a tackle for loss and 6r read 0%',
    edits: [['        && (!state.scrambling || gained < 0);', '        && !state.scrambling;']],
  },
  {
    name: 'scramble: he retreats whenever the lane looks shut',
    was: 'seventy-five yards backwards on the tenth percentile',
    edits: [['      seek(car, side * 23, car.y + (outside ? 9 : 2), SCRAMBLE_SPEED);',
      '      seek(car, side * 23, car.y - 0.4, SCRAMBLE_SPEED);']],
  },
  {
    name: 'pursuit: only the rush ever chases the ball carrier',
    was: 'a passer who got outside ran untouched to the end zone on a tenth of his scrambles',
    edits: [['    if (swarm && as !== \'rush\') {', '    if (false) {']],
  },
  {
    name: 'timing: the passer\'s read lands on the same tick every time',
    was: 'the same call against the same call replayed byte-identically forever',
    edits: [['const READY_JITTER = 9;', 'const READY_JITTER = 0;']],
  },
  {
    name: 'coverage: the passer throws regardless of separation',
    edits: [['const MIN_THROW_SEP = 1.9;', 'const MIN_THROW_SEP = -1;']],
  },
  {
    name: 'routes: every receiver runs the same route',
    edits: [['    const route = play.routes[a.slot];',
      '    const route = play.routes[Object.keys(play.routes)[0]];']],
  },
];

/* --------------------------------------------------------------------- run it ---- */

const names = Object.keys(PREDICATES);
const only = process.argv.includes('--quick');
const list = only ? MUTATIONS.slice(0, 6) : MUTATIONS;

console.log(`\nMUTATION BATTERY — play-sim   ${list.length} mutations x ${names.length} predicates\n`);

const base = await load();
const baseFails = [];
for (const n of names) {
  const r = await PREDICATES[n](base);
  if (r) baseFails.push(`${n}: ${r}`);
}
if (baseFails.length) {
  console.log('  THE UNMUTATED SIM DOES NOT PASS ITS OWN PREDICATES:');
  for (const f of baseFails) console.log(`    ${f}`);
  console.log('\n  Nothing below means anything until that is fixed.\n');
  process.exit(1);
}
console.log(`  baseline: all ${names.length} predicates hold on the unmutated sim\n`);

let killed = 0;
const survived = [];
for (const m of list) {
  let S;
  try {
    S = await load(m.edits);
  } catch (e) {
    console.log(`  ERROR  ${m.name}\n         ${e.message}`);
    survived.push({ ...m, caughtBy: [], error: e.message });
    continue;
  }
  const caught = [];
  for (const n of names) {
    let r;
    try { r = await PREDICATES[n](S); } catch (e) { r = `threw: ${e.message}`; }
    if (r) caught.push(`${n} (${r})`);
  }
  if (caught.length) {
    killed++;
    console.log(`  KILLED    ${m.name}`);
    console.log(`            caught by ${caught.length}: ${caught.slice(0, 2).join('; ')}`);
  } else {
    survived.push(m);
    console.log(`  SURVIVED  ${m.name}`);
  }
}

console.log(`\n${'='.repeat(72)}`);
console.log(`  ${killed}/${list.length} mutations killed`);
if (survived.length) {
  console.log('\n  SURVIVING MUTATIONS — each one is a hole in the suite:');
  for (const m of survived) console.log(`    - ${m.name}${m.error ? `  [${m.error}]` : ''}`);
}
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(survived.length ? 1 : 0);
