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
//
// BOTH FILES ARE COVERED. sim.js is mutated directly. adapt.js -- the world-units layer
// and, importantly, the accumulator that consumes whole ticks so the sim is identical at
// any frame rate -- was previously reported here as UNCOVERED, because it imports JSON that
// only the bundler resolves and so cannot be imported by plain node at all.
//
// That was a real hole and it is closed rather than restated: resolving a JSON import is
// exactly what the bundler does, and the loader below does the same thing, rewriting each
// one into a readFileSync at an absolute path. The frame-rate invariance that gametest.mjs
// asserts is now guarded by mutations that can actually break it.
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

const ADAPT = path.join(ROOT, 'src/pieces/play-sim/adapt.js');
const ADAPT_SRC = fs.readFileSync(ADAPT, 'utf8');

/**
 * Load a copy of adapt.js with `edits` applied.
 *
 * adapt.js cannot be imported by plain node as it stands: `import PLAYBOOK from
 * '../../data/playbook.json'` is a bundler feature. Rewriting each JSON import into a
 * readFileSync at an absolute path is precisely what the bundler does, so the module under
 * test is the real one -- and its two relative code imports are re-pointed at the real
 * files rather than at the temp directory the copy lives in.
 */
async function loadAdapt(edits) {
  let src = ADAPT_SRC
    .replace(/import PLAYBOOK from '[^']*playbook\.json';/,
      `const PLAYBOOK = JSON.parse(fs.readFileSync(${JSON.stringify(path.join(ROOT, 'src/data/playbook.json'))}, 'utf8'));`)
    .replace(/import PLAYERS from '[^']*players\.json';/,
      `const PLAYERS = JSON.parse(fs.readFileSync(${JSON.stringify(path.join(ROOT, 'src/data/players.json'))}, 'utf8'));`)
    .replace(/from '\.\.\/\.\.\/foundation\/rng\.js'/,
      `from ${JSON.stringify(pathToFileURL(path.join(ROOT, 'src/foundation/rng.js')).href)}`)
    .replace(/from '\.\/sim\.js'/,
      `from ${JSON.stringify(pathToFileURL(SIM).href)}`);
  src = `import fs from 'node:fs';\n` + src;
  for (const [find, repl] of edits || []) {
    const n = src.split(find).length - 1;
    if (n !== 1) throw new Error(`adapt anchor matched ${n} times, expected 1: ${find.slice(0, 70)}`);
    src = src.replace(find, repl);
  }
  const f = path.join(tmp, `adapt${serial++}.mjs`);
  fs.writeFileSync(f, src);
  return (await import(pathToFileURL(f).href)).default;
}


const FLOW = path.join(ROOT, 'src/pieces/game-flow/flow.js');
const FLOW_SRC = fs.readFileSync(FLOW, 'utf8');
const GF = (n) => path.join(ROOT, `src/pieces/game-flow/${n}.js`);

/**
 * Load the flow machine with `edits` applied to one of the game-flow files.
 *
 * `which` names the file being mutated: flow, coach, rules or kick. Only flow.js needs its
 * JSON imports rewritten; the other three are plain modules, so they are copied verbatim
 * unless they are the target, and flow.js is re-pointed at whichever copies exist.
 */
async function loadFlow(which, edits) {
  const dir = fs.mkdtempSync(path.join(tmp, `gf${serial++}-`));
  const names = ['coach', 'rules', 'kick', 'pad'];
  const at = {};
  for (const n of names) {
    let src = fs.readFileSync(GF(n), 'utf8')
      .replace(/from '\.\.\/\.\.\/foundation\/rng\.js'/g,
        `from ${JSON.stringify(pathToFileURL(path.join(ROOT, 'src/foundation/rng.js')).href)}`)
      .replace(/from '\.\/(rules|kick|pad|coach)\.js'/g, (m, g) => `from './${g}.js'`)
      // pad.js reaches sideways into another piece for its touch-parity table; the copies
      // live in a temp tree, so that one has to be re-pointed at the real file too.
      .replace(/from '\.\.\/([a-z-]+)\/([a-z-]+)\.js'/g,
        (m, piece, mod) => `from ${JSON.stringify(pathToFileURL(path.join(ROOT, `src/pieces/${piece}/${mod}.js`)).href)}`);
    if (which === n) src = applyEdits(src, edits, n);
    fs.writeFileSync(path.join(dir, `${n}.js`), src);
    at[n] = path.join(dir, `${n}.js`);
  }
  let src = FLOW_SRC
    .replace(/import PLAYBOOK from '[^']*playbook\.json';/,
      `const PLAYBOOK = JSON.parse(fs.readFileSync(${JSON.stringify(path.join(ROOT, 'src/data/playbook.json'))}, 'utf8'));`)
    .replace(/import PLAYERS from '[^']*players\.json';/,
      `const PLAYERS = JSON.parse(fs.readFileSync(${JSON.stringify(path.join(ROOT, 'src/data/players.json'))}, 'utf8'));`)
    .replace(/from '\.\.\/\.\.\/foundation\/rng\.js'/,
      `from ${JSON.stringify(pathToFileURL(path.join(ROOT, 'src/foundation/rng.js')).href)}`)
    .replace(/from '\.\.\/play-sim\/sim\.js'/,
      `from ${JSON.stringify(pathToFileURL(SIM).href)}`);
  if (which === 'flow') src = applyEdits(src, edits, 'flow');
  src = `import fs from 'node:fs';\n` + src;
  const f = path.join(dir, 'flow.mjs');
  fs.writeFileSync(f, src);
  return (await import(pathToFileURL(f).href)).default;
}

function applyEdits(src, edits, label) {
  for (const [find, repl] of edits || []) {
    const n = src.split(find).length - 1;
    if (n !== 1) throw new Error(`${label} anchor matched ${n} times, expected 1: ${find.slice(0, 60)}`);
    src = src.replace(find, repl);
  }
  return src;
}

/* --------------------------------------------------- the game-flow predicates ---- */
// The rule set, the kick model, the control scheme and the flow machine were all stated in
// gametest.mjs as UNPROVEN against this project's own standard -- asserted, but never shown
// able to fail. This closes that.

/** Drive a game to its end. Returns the final state, or null if it never finished. */
function playOut(flow, seed) {
  const st = flow.create({ seed });
  let t = 0, guard = 0;
  while (!st.game.over && guard++ < 300000) flow.step(st, t++);
  return guard >= 300000 ? null : st;
}

const FLOW_PREDICATES = {
  finishes(F) {
    for (const seed of [7, 99, 4242]) {
      const st = playOut(F, seed);
      if (!st) return `seed ${seed} never finished`;
      if (st.game.quarter !== 4) return `seed ${seed} ended in Q${st.game.quarter}`;
      if (!(st.playCount > 60 && st.playCount < 260)) return `seed ${seed} ran ${st.playCount} downs`;
    }
    return null;
  },

  deterministic(F) {
    const a = F.create({ seed: 7 }), b = F.create({ seed: 7 }), c = F.create({ seed: 8 });
    for (let t = 0; t < 30000; t++) { F.step(a, t); F.step(b, t); F.step(c, t); }
    if (F.hash(a) !== F.hash(b)) return 'the same seed replayed differently';
    if (F.hash(a) === F.hash(c)) return 'a different seed replayed identically';
    return null;
  },

  // THE PLAY BOUNDARY. An expensive rung change committed mid-play is a visible stall, and
  // this is the only contract the flow slot exists to enforce.
  boundaryOnly(F) {
    const st = F.create({ seed: 3 });
    let t = 0, outside = 0, last = st.commits;
    while (!st.game.over && t < 60000) {
      if (t % 997 === 0) F.queueRung(st, 5, 1);
      const before = st.state;
      F.step(st, t++);
      if (st.commits !== last) {
        last = st.commits;
        if (!(st.state === F.STATE.PLAY && before !== F.STATE.PLAY)) outside++;
      }
    }
    if (!st.commits) return 'nothing was ever committed';
    return outside === 0 ? null : `${outside} rung changes landed mid-play`;
  },

  // THE PLAY CALLER, which exists precisely because a uniform sweep blitzes 44% of downs.
  callingIsFootball(F) {
    let plays = 0, blitz = 0;
    const byDown = {};
    const kinds = {};
    for (let seed = 1; seed <= 8; seed++) {
      const st = F.create({ seed });
      let t = 0, guard = 0;
      const seen = new Set();
      while (!st.game.over && guard++ < 300000) {
        F.step(st, t++);
        if (st.state === F.STATE.PLAY && st.play && !seen.has(st.playCount)) {
          seen.add(st.playCount);
          plays++;
          const d = st.game.down;
          byDown[d] = byDown[d] || { n: 0, b: 0 };
          byDown[d].n++;
          if (st.defense.rush > 3) { blitz++; byDown[d].b++; }
          kinds[st.offense.kind] = (kinds[st.offense.kind] || 0) + 1;
        }
      }
    }
    if (plays < 400) return `only ${plays} downs called`;
    const rate = blitz / plays;
    if (!(rate > 0.16 && rate < 0.36)) return `blitz rate ${(rate * 100).toFixed(1)}%`;
    const r1 = byDown[1].b / byDown[1].n;
    const r3 = (byDown[3] || { b: 0, n: 1 }).b / (byDown[3] || { b: 0, n: 1 }).n;
    if (!(r3 > r1 + 0.04)) return `pressure flat by down: 1st ${(r1 * 100).toFixed(0)}% 3rd ${(r3 * 100).toFixed(0)}%`;
    if (Object.keys(kinds).length < 3) return `offence only calls ${Object.keys(kinds).join('/')}`;
    if ((kinds.run || 0) / plays < 0.05) return `it never runs the ball (${kinds.run || 0}/${plays})`;
    return null;
  },

  // THE BALL HAS TO MOVE AND POINTS HAVE TO BE SCORED. `rulesHold` only checked that the
  // state stayed inside legal bounds, which a game where every play gains exactly zero
  // satisfies perfectly -- that mutation survived the first run. A game of football is not
  // just a legal game state.
  gameProgresses(F) {
    let scored = 0, moved = 0, games = 0;
    for (const seed of [7, 31, 77]) {
      const st = F.create({ seed });
      let t = 0, guard = 0, spots = new Set(), gains = 0;
      while (!st.game.over && guard++ < 300000) {
        F.step(st, t++);
        spots.add(st.game.ballOn);
        if (st.state === F.STATE.RESULT && st.lastGain > 0) gains++;
      }
      games++;
      if (st.game.score[0] + st.game.score[1] > 0) scored++;
      if (spots.size > 12 && gains > 20) moved++;
    }
    if (scored < games) return 'a whole game finished without a single point';
    if (moved < games) return 'the ball never really moved';
    return null;
  },

  // FOUR DOWNS. A series that does not convert must turn the ball over on the fourth, and
  // nothing in the suite could see that number change.
  fourDowns(F) {
    let maxDown = 0, sawFourth = 0;
    for (const seed of [5, 41]) {
      const st = F.create({ seed });
      let t = 0, guard = 0;
      while (!st.game.over && guard++ < 300000) {
        F.step(st, t++);
        if (st.game.down > maxDown) maxDown = st.game.down;
        if (st.game.down === 4) sawFourth++;
      }
    }
    if (maxDown !== 4) return `the down counter reached ${maxDown}, not 4`;
    if (!sawFourth) return 'no fourth down ever happened';
    return null;
  },

  // THE RULE SET, through the machine that drives it.
  rulesHold(F) {
    for (const seed of [11, 23]) {
      const st = playOut(F, seed);
      if (!st) return `seed ${seed} never finished`;
      const g = st.game;
      if (g.ballOn < 0 || g.ballOn > 100) return `ball off the field at ${g.ballOn}`;
      if (g.down < 1 || g.down > 4) return `down ${g.down}`;
      for (const s of g.score) {
        if (s < 0 || s > 200) return `score ${s}`;
        // Every scoring play here is worth 6+1, 3 or 2, so no score may be 1 or 5.
        if (s === 1 || s === 5) return `score of ${s} is unreachable under this rule set`;
      }
    }
    return null;
  },
};

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

  // THE RUN GAME MUST GAIN GROUND, and each of the three calls must be its own play.
  runGame(S) {
    const byPlay = {};
    for (let t = 0; t < clubs.length; t += 2) {
      const off = players.byTeam[clubs[t]], def = players.byTeam[clubs[(t + 7) % clubs.length]];
      for (let o = 0; o < playbook.offense.length; o++) {
        const pl = playbook.offense[o];
        if (pl.kind !== 'run') continue;
        for (let d = 0; d < playbook.defense.length; d++) {
          const st = S.runPlay(S.createPlay(9000 + t * 131 + o * 41 + d * 7, pl,
            playbook.defense[d], off, def, playbook.formation));
          const b = (byPlay[pl.id] = byPlay[pl.id] || { n: 0, tot: 0 });
          b.n++; b.tot += st.yards;
        }
      }
    }
    const ids = Object.keys(byPlay);
    const means = ids.map((id) => byPlay[id].tot / byPlay[id].n);
    const shown = ids.map((id, i) => `${id} ${means[i].toFixed(1)}`).join(', ');
    if (means.some((m) => m <= 1.5)) return `a run call averages nothing: ${shown}`;
    if (Math.max(...means) - Math.min(...means) < 0.8) return `the runs are one play: ${shown}`;
    return null;
  },

  // Nobody makes a tackle or a sack while a blocker is still on him and the block has not
  // yet timed out. This is the rule the whole run game and half the pass rush rest on.
  blockedManCannotTackle(S) {
    let bad = 0, total = 0;
    for (let o = 0; o < playbook.offense.length; o++) {
      for (let d = 0; d < playbook.defense.length; d++) {
        for (let s = 0; s < 3; s++) {
          const st = S.runPlay(S.createPlay(2500 + o * 41 + d * 7 + s, playbook.offense[o],
            playbook.defense[d], KC, BUF, playbook.formation));
          const ev = st.events.find((e) => e.kind === 'tackle' || e.kind === 'sack');
          if (!ev) continue;
          total++;
          const man = st.def.find((x) => x.slot === ev.slot);
          if (!man || !man.blocked) continue;
          const stillOn = st.off.some((b) => b.engaged === man.slot
            && Math.hypot(b.x - man.x, b.y - man.y) < S.BLOCK_REACH);
          if (stillOn && st.tick < man.holdTicks) bad++;
        }
      }
    }
    if (total < 200) return `only ${total} plays ended in a tackle or sack`;
    return bad === 0 ? null : `${bad} of ${total} tackles made by a man still on a block`;
  },

  // PURSUIT, MEASURED BY HOW LONG A CATCH SURVIVES. Turning pursuit off changed no yardage
  // bound, no sack rate and no completion rate -- it survived as a silent no-op through two
  // rounds of this battery. The first replacement, "who made the tackle", was not sharp
  // enough either: a zone defender standing on his landmark still tackles a receiver who
  // runs into him, so that read 86% with pursuit and 45% without, and squeaked past a 40%
  // bar. THIS is the signature -- with the defence converging, a caught ball is brought
  // down in 17 ticks; without it the receiver runs for 85, a second and a half, untouched.
  pursuitConverges(S) {
    let ticks = 0, caught = 0, byCover = 0, tot = 0;
    for (let o = 0; o < playbook.offense.length; o++) {
      for (let d = 0; d < playbook.defense.length; d++) {
        for (let s = 0; s < 3; s++) {
          const st = S.runPlay(S.createPlay(2500 + o * 41 + d * 7 + s, playbook.offense[o],
            playbook.defense[d], KC, BUF, playbook.formation));
          const ev = st.events.find((e) => e.kind === 'tackle' || e.kind === 'sack');
          if (ev) { tot++; if (st.defense.assign[ev.slot] !== 'rush') byCover++; }
          const cat = st.events.find((e) => e.kind === 'catch');
          if (cat && st.result === S.RESULT.TACKLED) { ticks += st.tick - cat.tick; caught++; }
        }
      }
    }
    if (caught < 40) return `only ${caught} catches to look at`;
    const avg = ticks / caught;
    if (avg > 40) return `a catch runs ${avg.toFixed(0)} ticks before anyone gets there`;
    if (byCover <= tot * 0.6) return `only ${byCover}/${tot} tackles by a man who was not rushing`;
    return null;
  },

  // THE BIG HIT, and both ratings behind it, across their whole range.
  bigHit(S) {
    const sweep = (mutate) => [30, 65, 99].map((v) => {
      let f = 0, n = 0;
      for (let t = 0; t < clubs.length; t += 2) {
        const [off, def] = mutate(players.byTeam[clubs[t]], players.byTeam[clubs[(t + 7) % clubs.length]], v);
        for (let o = 0; o < playbook.offense.length; o++) {
          for (let d = 0; d < playbook.defense.length; d++) {
            if (S.runPlay(S.createPlay(9000 + t * 131 + o * 41 + d * 7, playbook.offense[o],
              playbook.defense[d], off, def, playbook.formation)).result === S.RESULT.FUMBLE) f++;
            n++;
          }
        }
      }
      return f / n;
    });
    const pct = (a) => a.map((x) => `${(x * 100).toFixed(2)}%`).join(' -> ');
    const byPow = sweep((o, d, v) => [o, d.map((p) => ({ ...p, pow: v }))]);
    if (!(byPow[0] < byPow[1] && byPow[1] < byPow[2])) return `hit power flat or inverted: ${pct(byPow)}`;
    const byBal = sweep((o, d, v) => [o.map((p) => ({ ...p, bal: v })), d]);
    if (!(byBal[0] > byBal[1] && byBal[1] > byBal[2])) return `ball security flat or inverted: ${pct(byBal)}`;

    // A strip-sack must be the most dangerous contact there is. Nothing here watched that
    // at all, so setting the multiplier to 1 survived the whole battery untouched.
    // Counted from the fumble event, which records the kind of contact -- inferring it
    // from the final state also counts every incompletion as a sack that held on.
    let sackF = 0, sackN = 0, tackF = 0, tackN = 0;
    for (let t = 0; t < clubs.length; t += 2) {
      const off = players.byTeam[clubs[t]], def = players.byTeam[clubs[(t + 7) % clubs.length]];
      for (let o = 0; o < playbook.offense.length; o++) {
        for (let d = 0; d < playbook.defense.length; d++) {
          const st = S.runPlay(S.createPlay(9000 + t * 131 + o * 41 + d * 7, playbook.offense[o],
            playbook.defense[d], off, def, playbook.formation));
          const fum = st.events.find((e) => e.kind === 'fumble');
          if (fum) { if (fum.sack) { sackN++; sackF++; } else { tackN++; tackF++; } }
          else if (st.result === S.RESULT.SACK) sackN++;
          else if (st.result === S.RESULT.TACKLED || st.result === S.RESULT.TOUCHDOWN) tackN++;
        }
      }
    }
    if (sackN < 100 || tackN < 100) return `not enough contact to compare: ${sackN}/${tackN}`;
    if (sackF / sackN <= tackF / tackN) {
      return `a sack is no more dangerous than a tackle: ${((sackF / sackN) * 100).toFixed(1)}% vs ${((tackF / tackN) * 100).toFixed(1)}%`;
    }
    return null;
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

/* ------------------------------------------------------ the adapt predicates ---- */
// These take the ADAPTER's default export (create/step/seekTo/snapshot), not the sim
// namespace, so they are kept in their own table and run only against adapt mutations.

const REALSIM = await import(pathToFileURL(SIM).href);

/** Signature of the simulation state, to the micro-yard. */
const simSig = (st) => `${st.tick}|${st.result}|`
  + st.off.concat(st.def).map((m) => `${m.x.toFixed(6)},${m.y.toFixed(6)}`).join(';');

const ADAPT_PREDICATES = {
  // THE ONE THE HOLE WAS ABOUT. The renderer hands the adapter seconds at whatever rate it
  // is presenting; the sim is a fixed 60 Hz tick. Whole ticks only, remainder carried, so
  // the same elapsed time gives the identical state at any frame rate.
  frameRate(A) {
    const drive = (dts) => {
      const st = A.create(33, { teamA: 'NYC', teamB: 'CHI' });
      for (const dt of dts) A.step(st, dt);
      return st;
    };
    const fill = (n, dt) => Array(n).fill(dt);
    const a = drive(fill(120, 1 / 60));
    const b = drive(fill(60, 1 / 30));
    const c = drive(fill(24, 1 / 12));
    // Two seconds of football, delivered three ways, plus a deliberately ragged rate.
    const d = drive([...fill(30, 1 / 60), ...fill(15, 1 / 30), ...fill(6, 1 / 12), ...fill(30, 1 / 60)]);
    if (simSig(a) !== simSig(b)) return `60 fps and 30 fps disagree (tick ${a.tick} vs ${b.tick})`;
    if (simSig(a) !== simSig(c)) return `60 fps and 12 fps disagree (tick ${a.tick} vs ${c.tick})`;
    if (simSig(a) !== simSig(d)) return `a ragged frame rate diverges (tick ${a.tick} vs ${d.tick})`;
    return null;
  },

  // And it must agree with what plain node produces stepping the sim directly -- otherwise
  // the renderer is running a different game from the one the test suite measures.
  agreesWithPlainNode(A) {
    const st = A.create(33, { teamA: 'NYC', teamB: 'CHI' });
    for (let i = 0; i < 120; i++) A.step(st, 1 / 60);
    const ref = REALSIM.createPlay(33, st.offense, st.defense,
      players.byTeam[st.teamA], players.byTeam[st.teamB], playbook.formation);
    for (let i = 0; i < 120 && ref.result === REALSIM.RESULT.LIVE; i++) REALSIM.advance(ref);
    if (ref.tick !== st.tick) return `adapter ran ${st.tick} ticks, plain node ran ${ref.tick}`;
    return simSig(ref) === simSig(st) ? null : 'adapter and plain node disagree on the same tick';
  },

  // THE AXES. The world runs downfield along -x and across along +z; the simulation runs
  // downfield along +y and across along +x. Every actor must obey it, or the whole team
  // renders sideways or mirrored and only a rendered capture would ever reveal it.
  axes(A) {
    const st = A.create(33, { teamA: 'NYC', teamB: 'CHI' });
    A.seekTo(st, 1.2);
    const snap = A.snapshot(st);
    for (const m of st.off.concat(st.def)) {
      const id = (m.side === 'OFF' ? 'o_' : 'd_') + m.slot.toLowerCase();
      const a = snap.actors.find((x) => x.id === id);
      if (!a) return `no actor for ${m.slot}`;
      if (Math.abs(a.pos[0] - (-m.y)) > 1e-9) return `${m.slot} world.x ${a.pos[0].toFixed(3)} != -sim.y ${(-m.y).toFixed(3)}`;
      if (Math.abs(a.pos[2] - m.x) > 1e-9) return `${m.slot} world.z ${a.pos[2].toFixed(3)} != sim.x ${m.x.toFixed(3)}`;
    }
    return snap.actors.length === 14 ? null : `${snap.actors.length} actors, want 14`;
  },

  // seekTo must be reproducible, and must re-simulate from zero when asked to go backwards
  // rather than quietly returning a later state.
  seekReproducible(A) {
    const one = A.create(7, {});
    A.seekTo(one, 1.5);
    const sigAt15 = simSig(one);
    A.seekTo(one, 2.5);
    A.seekTo(one, 1.5);            // backwards: must land on the same state as before
    if (simSig(one) !== sigAt15) return 'seeking backwards did not reproduce the earlier state';
    const two = A.create(7, {});
    A.seekTo(two, 1.5);
    return simSig(two) === sigAt15 ? null : 'two seeks to the same time disagree';
  },

  // THE BALL MUST POINT WHERE IT IS GOING. A football is a prolate spheroid whose long
  // axis is Z; sending an identity quaternion pinned that axis across the field, so every
  // pass thrown downfield was viewed end-on and rendered as a flat orange DISC. It shipped
  // that way through every capture in this project and was mistaken twice for a defect in
  // the ball geometry, which is in fact a correct lathe with pointed ends and laces.
  ballNose(A) {
    let checked = 0, offAxis = 0, nonUnit = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const st = A.create(seed, {});
      for (let k = 1; k <= 14; k++) {
        A.seekTo(st, k * 0.22);
        const snap = A.snapshot(st);
        if (!st.ball) continue;
        checked++;
        const q = snap.ball.rotQ;
        if (Math.abs(Math.hypot(q[0], q[1], q[2], q[3]) - 1) > 1e-6) nonUnit++;
        // The long axis is +Z carried through the quaternion.
        const [x, y, z, w] = q;
        const ax = 2 * (x * z + w * y), ay = 2 * (y * z - w * x), az = 1 - 2 * (x * x + y * y);
        const b = st.ball;
        const dx = -(b.ty - b.y), dz = b.tx - b.x;
        const dl = Math.hypot(dx, dz) || 1;
        const align = (ax * dx / dl + az * dz / dl) / (Math.hypot(ax, ay, az) || 1);
        if (align < 0.55) offAxis++;
      }
    }
    if (checked < 30) return `only ${checked} in-flight samples`;
    if (nonUnit) return `${nonUnit}/${checked} quaternions are not unit length`;
    return offAxis === 0 ? null : `${offAxis}/${checked} frames have the nose off the flight line`;
  },

  // The ball is where the man holding it is, or in the air on its own arc -- never adrift.
  ball(A) {
    let held = 0, air = 0, checked = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const st = A.create(seed, {});
      for (let k = 1; k <= 12; k++) {
        A.seekTo(st, k * 0.25);
        const snap = A.snapshot(st);
        checked++;
        if (st.ball) {
          air++;
          if (snap.ball.pos[1] < 1.35) return `a ball in flight at y=${snap.ball.pos[1].toFixed(2)}, under the release height`;
        } else {
          const car = st.off.find((m) => m.slot === st.carrier);
          if (!car) continue;
          held++;
          const dx = snap.ball.pos[0] - (-car.y), dz = snap.ball.pos[2] - car.x;
          if (Math.hypot(dx, dz) > 1.2) return `the carrier's ball is ${Math.hypot(dx, dz).toFixed(2)} yd away from him`;
        }
      }
    }
    if (held < 50 || air < 5) return `only ${held} held / ${air} in flight over ${checked} samples`;
    return null;
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
    edits: [['  for (const r of targets) { r.blocked = 0; r.holdTicks = 0; }',
      '  for (const r of targets) { r.blocked = 1; r.holdTicks = BLOCK_HOLD_TICKS; }']],
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
    name: 'run: the carrier also runs his pass route',
    was: 'the route loop dragged him sideways while the carrier logic pulled him upfield',
    edits: [["    if (play.kind === 'run' && a.slot === state.carrier) continue;",
      "    if (false) continue;"]],
  },
  {
    name: 'run: the carrier lines up on the line instead of in the backfield',
    was: 'two and a half yards from a lineman at the snap, tackled by tick 11 every time',
    edits: [["      car.y = -4.2;", "      car.y = -1.0;"]],
  },
  {
    name: 'run: the defence diagnoses the handoff instantly',
    was: 'all seven converged from tick zero and the runs averaged minus 0.4 yards',
    edits: [['const RUN_DIAGNOSE_TICKS = 20;', 'const RUN_DIAGNOSE_TICKS = 0;']],
  },
  {
    name: 'block: a man still being blocked can make the tackle anyway',
    was: 'the runner sprinted into a lineman who was being blocked and was stopped by him',
    edits: [['      if (blockSlow(d) < 1) continue;', '      if (false) continue;']],
  },
  {
    name: 'run: every run aims at the same gap',
    edits: [['      const through = car.y < 1.5 ? gap : car.x;',
      '      const through = car.x;']],
  },
  {
    name: 'hit: the ball never comes loose',
    was: 'RESULT.FUMBLE declared and never produced in 5184 downs; pow and bal both dead',
    edits: [['const FUMBLE_BASE = 0.035;', 'const FUMBLE_BASE = 0;']],
  },
  {
    name: 'hit: the fumble contest is a difference, not a ratio',
    was: 'the clamp swallowed every hitter under ~80: 30 and 65 hit power both forced 0.35%',
    // The mutation has to reproduce the defect that actually shipped: the swing ADDED to
    // the base, so it goes negative against a well-rated carrier and the floor flattens it.
    // Writing it as a multiplier (base * (1 + swing)) stays monotone and proves nothing --
    // that version survived this battery, and the fault was the mutation, not the sim.
    edits: [['          FUMBLE_BASE * edge * (isSack ? FUMBLE_SACK_MULT : 1)));',
      '          (FUMBLE_BASE + (d.pow - car.bal) / 260) * (isSack ? FUMBLE_SACK_MULT : 1)));']],
  },
  {
    name: 'hit: a sack is no more dangerous than any other tackle',
    edits: [['const FUMBLE_SACK_MULT = 1.9;', 'const FUMBLE_SACK_MULT = 1.0;']],
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
  {
    target: 'adapt',
    name: 'adapter: every dt advances a tick, whatever its size',
    was: 'the sim would run at a different speed on every device',
    edits: [['    while (state.acc >= per && guard++ < 600) {', '    while (guard++ < 1) {']],
  },
  {
    target: 'adapt',
    name: 'adapter: the leftover fraction of a tick is thrown away',
    was: 'a slow frame would silently drop the remainder and the sim would drift',
    edits: [['      state.acc -= per;', '      state.acc = 0;']],
  },
  {
    target: 'adapt',
    name: 'adapter: the field axes are mirrored',
    edits: [['    pos: [-m.y, 0, m.x],', '    pos: [m.y, 0, m.x],']],
  },
  {
    target: 'adapt',
    name: 'adapter: seeking backwards does not re-simulate',
    edits: [['    if (t < state.t) {', '    if (false) {']],
  },
  {
    target: 'adapt',
    name: 'adapter: the ball is not attached to the man carrying it',
    // Anchor re-pointed after the ball gained an orientation: the held branch became a
    // multi-line object literal and this mutation silently stopped applying. The battery
    // reported it as an ERROR rather than counting a kill, which is the third time it has
    // caught a fault in itself rather than in the code -- exactly what it is for.
    edits: [['        pos: [-carrier.y - 0.3, 1.42, carrier.x + 0.35],',
      '        pos: [0, 1.42, 0],']],
  },
  {
    target: 'adapt',
    name: 'adapter: the ball never turns to face its flight path',
    was: 'the football rendered as a flat orange disc in every capture in the project',
    edits: [['        quat: ballQuat(-(b.ty - b.y), slope * (b.len || 1), b.tx - b.x, b.travelled * BALL_SPIRAL),',
      '        quat: [0, 0, 0, 1],']],
  },
  {
    target: 'flow', file: 'flow',
    name: 'flow: an expensive rung change commits mid-play',
    was: 'the one contract the flow slot exists for -- a commit mid-play is a visible stall',
    // The first version of this mutation incremented commits INSIDE enterPlay -- which is
    // the boundary, so it tested nothing and survived. It has to commit while the down is
    // actually running.
    edits: [['      case STATE.PLAY: {', '      case STATE.PLAY: {\n        if (st.pendingRung >= 0) { st.committedRung = st.pendingRung; st.pendingRung = -1; st.commits++; }']],
  },
  {
    target: 'flow', file: 'flow',
    name: 'flow: the clock never runs',
    edits: [['    tickClock(g, playTicks(p));\n    impl.go(st, STATE.RESULT, tick);', '    tickClock(g, 0);\n    impl.go(st, STATE.RESULT, tick);']],
  },
  {
    target: 'flow', file: 'flow',
    name: 'flow: the down never advances because the result is discarded',
    edits: [['    const outcome = applyPlay(g, gain, turnover);', '    const outcome = applyPlay(g, 0, false);']],
  },
  {
    target: 'flow', file: 'coach',
    name: 'coach: the defence blitzes on every down',
    was: 'the uniform-sweep artefact that put the sack rate at 16.7%',
    edits: [['  const blitzing = rng() < blitzRate;', '  const blitzing = true;']],
  },
  {
    target: 'flow', file: 'coach',
    name: 'coach: pressure does not rise with the down',
    edits: [['export const BLITZ_LONG = 0.40;', 'export const BLITZ_LONG = 0.24;']],
  },
  {
    target: 'flow', file: 'coach',
    name: 'coach: the offence never runs the ball',
    edits: [["      w *= s.shortYardage ? 2.6 : 0.55;", "      w *= 0.0001;"]],
  },
  {
    target: 'flow', file: 'kick',
    name: 'kick: a touchdown is worth the wrong points',
    edits: [['  TOUCHDOWN: 6,', '  TOUCHDOWN: 5,']],
  },
  {
    target: 'flow', file: 'rules',
    name: 'rules: there are five downs',
    edits: [['export const DOWNS = 4;', 'export const DOWNS = 5;']],
  },
];

/* --------------------------------------------------------------------- run it ---- */

const names = Object.keys(PREDICATES);
const anames = Object.keys(ADAPT_PREDICATES);
const fnames = Object.keys(FLOW_PREDICATES);
const list = MUTATIONS;
const total = names.length + anames.length + fnames.length;

console.log(`\nMUTATION BATTERY — play-sim   ${list.length} mutations x ${total} predicates`);
console.log(`  sim.js: ${names.length}   adapt.js: ${anames.length}   game-flow: ${fnames.length}\n`);

/** Run every predicate for one target. Returns the list of complaints. */
async function checkSim(S) {
  const out = [];
  for (const n of names) {
    let r;
    try { r = await PREDICATES[n](S); } catch (e) { r = `threw: ${e.message}`; }
    if (r) out.push(`${n} (${r})`);
  }
  return out;
}
async function checkFlow(F) {
  const out = [];
  for (const n of fnames) {
    let r;
    try { r = await FLOW_PREDICATES[n](F); } catch (e) { r = `threw: ${e.message}`; }
    if (r) out.push(`${n} (${r})`);
  }
  return out;
}
async function checkAdapt(A) {
  const out = [];
  for (const n of anames) {
    let r;
    try { r = await ADAPT_PREDICATES[n](A); } catch (e) { r = `threw: ${e.message}`; }
    if (r) out.push(`${n} (${r})`);
  }
  return out;
}

const baseFails = (await checkSim(await load()))
  .concat(await checkAdapt(await loadAdapt()))
  .concat(await checkFlow(await loadFlow('none')));
if (baseFails.length) {
  console.log('  THE UNMUTATED CODE DOES NOT PASS ITS OWN PREDICATES:');
  for (const f of baseFails) console.log(`    ${f}`);
  console.log('\n  Nothing below means anything until that is fixed.\n');
  process.exit(1);
}
console.log(`  baseline: all ${total} predicates hold on the unmutated sim.js and adapt.js\n`);

let killed = 0;
const survived = [];
for (const m of list) {
  const isAdapt = m.target === 'adapt';
  const isFlow = m.target === 'flow';
  let caught;
  try {
    caught = isFlow ? await checkFlow(await loadFlow(m.file, m.edits))
      : isAdapt ? await checkAdapt(await loadAdapt(m.edits))
        : await checkSim(await load(m.edits));
  } catch (e) {
    console.log(`  ERROR  ${m.name}\n         ${e.message}`);
    survived.push({ ...m, error: e.message });
    continue;
  }
  const tag = isFlow ? `[${m.file}] ` : isAdapt ? '[adapt] ' : '';
  if (caught.length) {
    killed++;
    console.log(`  KILLED    ${tag}${m.name}`);
    console.log(`            caught by ${caught.length}: ${caught.slice(0, 2).join('; ')}`);
  } else {
    survived.push(m);
    console.log(`  SURVIVED  ${tag}${m.name}`);
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
