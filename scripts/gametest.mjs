#!/usr/bin/env node
// THE GAMEPLAY TEST SUITE. Plain node, no browser, no renderer, ~40 s.
//
// It was ~50 ms when it only checked the rule set, the kick model and the control scheme,
// all of which are cheap pure functions. The play-sim section runs about fifty thousand
// simulated downs, because that is what its claims actually need: measured over eight
// clubs, "a faster receiving corps gains more" read 3.8 < 3.6 < 4.5 and failed, and over
// all thirty-two it reads 5.2 < 5.5 < 6.4 and holds. The sim is deterministic, so that gap
// was not statistical noise -- it was a sample small enough for a few matchups to decide
// the answer. Forty seconds is the price of the claim being true.
//
// This exists because the rule set, the control scheme and the kick model are all PURE
// FUNCTIONS of state and ticks. That makes them testable in a way the visual pieces are
// not: no software rasteriser, no 26-second screenshot, no threshold argument about what
// a pixel means. A gameplay regression shows up here as a red line, immediately.
//
// The rule this suite is written under, learned the hard way elsewhere in this project:
// any predicate that cannot be made to fail by a deliberate mutation of the code is not a
// test. So the assertions pin NUMBERS and BRANCHES, not shapes -- 30 yards, 4 downs, 6/1/3/2
// points, exact overlay strings, exact target indices -- rather than merely checking that
// something happened.
//
// THE STANDARD THIS IS HELD TO. "The assertions look specific" is not evidence -- a sister
// piece in this project shipped a suite where 20 of 38 deliberate mutations left it green.
// The play-sim section is now backed by an automated battery that reintroduces 30 real
// defects across both sim.js and adapt.js and requires each to be caught:
//
//   node scripts/simmutate.mjs
//
// That battery earns its keep. Bringing adapt.js under it exposed a replay bug on the
// UNMUTATED file: seekTo reset a state by assigning a fresh one over it, so keys a
// played-out down carries but a fresh one never sets (`scrambling`, `flushedAt`) survived
// the reset and a backward seek replayed a different down. None of the assertions below
// could see it, because every one of them drives the simulation forwards only.
//
// The rule set, kick and control-scheme sections above it are NOT yet covered by a battery,
// and are stated here as unproven against that standard rather than implied away.
//
//   node scripts/gametest.mjs
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, detail) {
  if (cond) { pass++; return true; }
  fail++; failures.push(`${name}${detail ? '  [' + detail + ']' : ''}`);
  return false;
}
function eq(a, b, name) { return ok(a === b, name, `got ${a}, want ${b}`); }
function near(a, b, tol, name) { return ok(Math.abs(a - b) <= tol, name, `got ${a}, want ${b}+-${tol}`); }
const L = (s) => console.log(s);

const R = await imp('src/pieces/game-flow/rules.js');
const K = await imp('src/pieces/game-flow/kick.js');
const P = await imp('src/pieces/game-flow/pad.js');
const T = await imp('src/pieces/touch-controller/tuning.js');
const playbook = (await imp('src/data/playbook.json', { with: { type: 'json' } }).catch(() => null))
  || JSON.parse((await import('node:fs')).readFileSync(path.join(ROOT, 'src/data/playbook.json'), 'utf8'));

L('\n=== THE SHARED PLAYBOOK (one sheet, all 32 clubs) ===');
{
  const raw = JSON.stringify(playbook);
  ok(playbook.meta.shared === true, 'playbook declares itself shared');
  ok(!raw.includes('byTeam'), 'playbook has no per-club keying');
  // The real guard: a club abbreviation appearing anywhere would mean a club-specific
  // play had been slipped in. Checked against the actual roster ids, not a guess.
  const teams = JSON.parse((await import('node:fs')).readFileSync(path.join(ROOT, 'src/data/teams.json'), 'utf8'));
  const abbrs = Object.keys(teams.teams);
  const leaked = abbrs.filter((a) => raw.includes(`"${a}"`));
  ok(leaked.length === 0, 'no club abbreviation appears in the playbook', leaked.join(','));
  eq(playbook.offense.length, 18, 'eighteen offensive plays');
  eq(playbook.defense.length, 9, 'nine defensive plays');
  // Two pages of nine, which is what the playcall screen actually shows.
  const byPage = {};
  for (const pl of playbook.offense) byPage[pl.page || 1] = (byPage[pl.page || 1] || 0) + 1;
  eq(Object.keys(byPage).length, 2, 'offence is laid out over two pages');
  ok(Object.values(byPage).every((n) => n === 9), 'nine plays on every page',
    JSON.stringify(byPage));

  // Every defensive call's declared rush count matches its assignment table. This is the
  // check that caught a real authoring error (LB ATTACK said 3, assigned 2).
  let mismatched = 0;
  for (const d of playbook.defense) {
    const counted = Object.values(d.assign).filter((v) => v === 'rush').length;
    if (counted !== d.rush) { mismatched++; L(`    ${d.name}: declares ${d.rush}, assigns ${counted}`); }
  }
  eq(mismatched, 0, 'every defensive rush count matches its assignments');

  // Every play routes all three eligible receivers, and every slot named is a real slot.
  const off = new Set(playbook.meta.offSlots), def = new Set(playbook.meta.defSlots);
  let badSlot = 0, badRoute = 0;
  for (const p of playbook.offense) {
    for (const s of ['REC1', 'REC2', 'REC3']) if (!p.routes[s] || p.routes[s].length < 2) badRoute++;
    for (const s of Object.keys(p.routes)) if (!off.has(s)) badSlot++;
    if (!off.has(p.primary)) badSlot++;
  }
  for (const d of playbook.defense) for (const s of Object.keys(d.assign)) if (!def.has(s)) badSlot++;
  eq(badRoute, 0, 'every offensive play routes all three receivers');
  eq(badSlot, 0, 'every slot named by a play is a real roster slot');

  // THE POINT OF EIGHTEEN PLAYS IS EIGHTEEN DIFFERENT NPC BEHAVIOURS, so distinctness is
  // measured, not assumed. Compared WITHIN a kind only: a run and a pass are never the
  // same play whatever the receivers do, because on a run the carrier and the gap are the
  // content. (The first version of this compared across kinds and its closest pairs were
  // all runs against hook concepts, which measured nothing.)
  const endp = (pl) => ['REC1', 'REC2', 'REC3'].map((s2) => pl.routes[s2][pl.routes[s2].length - 1]);
  let closest = 1e9, closestPair = '';
  for (let i = 0; i < playbook.offense.length; i++) {
    for (let j = i + 1; j < playbook.offense.length; j++) {
      const A = playbook.offense[i], B = playbook.offense[j];
      if (A.kind !== B.kind) continue;
      const a = endp(A), b = endp(B);
      let d = 0;
      for (let k = 0; k < 3; k++) d += Math.hypot(a[k][0] - b[k][0], a[k][1] - b[k][1]);
      d /= 3;
      if (d < closest) { closest = d; closestPair = `${A.name} vs ${B.name}`; }
    }
  }
  ok(closest >= 3.0, 'no two same-kind plays are near-duplicates', `${closest.toFixed(1)} yd — ${closestPair}`);

  // Runs are separated by carrier and gap, which is where a run's content actually lives.
  const runs = playbook.offense.filter((pl) => pl.kind === 'run');
  const runKeys = new Set(runs.map((pl) => `${pl.primary}@${pl.gap}`));
  eq(runKeys.size, runs.length, 'every run has its own carrier/gap combination');

  // Nine defensive calls, all structurally different from one another.
  const defKeys = new Set(playbook.defense.map((d) => JSON.stringify(d.assign)));
  eq(defKeys.size, playbook.defense.length, 'every defensive call assigns differently');

  // The rush counts have to actually spread, or every call plays the same on the field.
  const rushes = new Set(playbook.defense.map((d) => d.rush));
  ok(rushes.size >= 4, 'defensive calls span a real range of rush counts', [...rushes].sort().join(','));
  L(`    ${playbook.offense.length} offensive (2 pages of 9) + ${playbook.defense.length} defensive, no club keying`);
  L(`    closest same-kind pair ${closest.toFixed(1)} yd apart (${closestPair}); rush counts ${[...rushes].sort((x,y)=>x-y).join('/')}`);
}

L('\n=== KICKS ARE ALWAYS GOOD, AND SAY SO ===');
{
  // The headline rule. Swept over every kind and a wide spread of would-be distances to
  // prove no hidden distance term crept in.
  let allGood = true, allSay = true;
  for (const kind of ['pat', 'fg']) {
    const r = K.resolvePlacekick(kind);
    if (!r.good) allGood = false;
    if (r.overlay !== 'KICK IS GOOD') allSay = false;
  }
  ok(allGood, 'every placekick is good');
  ok(allSay, 'every placekick shows KICK IS GOOD');
  eq(K.resolvePlacekick('pat').points, 1, 'point after is worth 1');
  eq(K.resolvePlacekick('fg').points, 3, 'field goal is worth 3');
  // resolvePlacekick takes no distance and no rating: calling it repeatedly must never
  // vary. If someone adds an RNG later, this goes red.
  const many = new Set();
  for (let i = 0; i < 500; i++) many.add(JSON.stringify(K.resolvePlacekick('fg')));
  eq(many.size, 1, 'field goal result is invariant over 500 calls');
  L('    pat 1pt, fg 3pt, both always good, both overlay "KICK IS GOOD"');
}

L('\n=== THE ONSIDE KICK IS PLAYED, NOT GIVEN ===');
{
  // The meter is a symmetric triangle, so the two approaches to a perfect stop are equal.
  near(P.kickMeter(0), 0, 1e-9, 'meter starts at 0');
  near(P.kickMeter(P.KICK_METER_TICKS / 2), 1, 1e-9, 'meter peaks at half a sweep');
  near(P.kickMeter(P.KICK_METER_TICKS / 4), P.kickMeter(P.KICK_METER_TICKS * 3 / 4), 1e-9,
    'meter is symmetric about its peak');

  // Short of ten yards is an illegal touch, whatever the ratings say.
  const short = K.resolveOnside(2, 99, 20, 0.0);
  ok(!short.legal, 'a kick short of ten yards is illegal');
  ok(!short.recovered, 'an illegal onside kick is not recovered');
  eq(short.overlay, 'ONSIDE — NO GOOD', 'illegal onside shows NO GOOD');

  // A legal kick is a real contest: the SAME stop with a favourable and an unfavourable
  // roll must produce different outcomes, or the roll is being ignored.
  let legalTick = -1;
  for (let t = 1; t < P.KICK_METER_TICKS; t++) {
    if (K.onsideBounceYards(t) >= K.ONSIDE_LEGAL_YARDS) { legalTick = t; break; }
  }
  ok(legalTick > 0, 'some stop produces a legal onside kick');
  const win = K.resolveOnside(legalTick, 80, 80, 0.0);
  const lose = K.resolveOnside(legalTick, 80, 80, 0.999);
  ok(win.recovered && !lose.recovered, 'the roll decides a legal onside kick');
  eq(win.overlay, 'ONSIDE — RECOVERED!', 'a recovered onside says so');

  // Placement is the skill: a kick that only just clears ten must beat a long one.
  const tJust = legalTick;
  let tLong = -1;
  for (let t = 1; t < P.KICK_METER_TICKS; t++) {
    if (K.onsideBounceYards(t) >= K.ONSIDE_LEGAL_YARDS + 7) { tLong = t; break; }
  }
  if (ok(tLong > 0, 'some stop produces a long onside kick')) {
    const a = K.resolveOnside(tJust, 80, 80, 0.5).chance;
    const b = K.resolveOnside(tLong, 80, 80, 0.5).chance;
    ok(a > b, 'a kick that just clears ten beats a long one', `${a?.toFixed(3)} vs ${b?.toFixed(3)}`);
  }
  // Ratings matter, in the right direction.
  const strong = K.resolveOnside(legalTick, 95, 40, 0.5).chance;
  const weak = K.resolveOnside(legalTick, 40, 95, 0.5).chance;
  ok(strong > weak, 'a better kicking unit recovers more often', `${strong.toFixed(3)} vs ${weak.toFixed(3)}`);
  L(`    legal at ${K.onsideBounceYards(legalTick).toFixed(1)} yd; chance ${(K.resolveOnside(legalTick,80,80,0.5).chance*100).toFixed(0)}% even, skill and placement both bite`);
}

L('\n=== DOWNS, DISTANCE AND POSSESSION ===');
{
  const g = R.newGame('KC', 'BUF');
  eq(g.toGo, 30, 'a new series needs thirty yards');
  eq(g.down, 1, 'a new series starts on first down');

  R.applyPlay(g, 12, false);
  eq(g.down, 2, 'a twelve-yard gain is second down');
  eq(g.toGo, 18, 'and eighteen to go');

  R.applyPlay(g, 18, false);
  eq(g.down, 1, 'reaching thirty is a first down');
  eq(g.toGo, 30, 'and the chains reset');

  // Four downs, then it turns over.
  const h = R.newGame('KC', 'BUF');
  for (let i = 0; i < 3; i++) R.applyPlay(h, 1, false);
  eq(h.down, 4, 'three short gains reach fourth down');
  const out = R.applyPlay(h, 1, false);
  eq(out, R.OUTCOME.TURNOVER_ON_DOWNS, 'failing on fourth turns it over');
  eq(h.possession, 1, 'and the other side has it');
  eq(h.down, 1, 'on first down');

  // The field flips on a change of possession, so ballOn stays own-frame.
  const f = R.newGame('KC', 'BUF');
  f.ballOn = 30;
  R.changePossession(f);
  eq(f.ballOn, 70, 'the field flips on a change of possession');
  L('    4 downs / 30 yards, chains reset, field flips correctly');
}

L('\n=== SCORING ===');
{
  const g = R.newGame('KC', 'BUF');
  g.ballOn = 95;
  eq(R.applyPlay(g, 10, false), R.OUTCOME.TOUCHDOWN, 'crossing the goal line is a touchdown');
  eq(g.score[0], 6, 'a touchdown is six');
  R.applyPat(g);
  eq(g.score[0], 7, 'the automatic point after makes it seven');

  // A safety scores for the DEFENCE and is checked before a touchdown, so a huge negative
  // gain from midfield cannot be mistaken for a score the other way.
  const s = R.newGame('KC', 'BUF');
  s.ballOn = 4;
  eq(R.applyPlay(s, -6, false), R.OUTCOME.SAFETY, 'tackled behind your own goal is a safety');
  eq(s.score[1], 2, 'a safety is two, to the defence');
  eq(s.possession, 1, 'and possession changes');

  const t = R.newGame('KC', 'BUF');
  t.ballOn = 40;
  R.applyPlay(t, 20, true);
  eq(t.possession, 1, 'a turnover changes possession');
  eq(t.ballOn, 40, 'and spots the ball in the new frame', `got ${t.ballOn}`);
  L('    td 6 + auto pat 1, safety 2 to the defence, turnovers spot correctly');
}

L('\n=== THE CLOCK ===');
{
  const g = R.newGame('KC', 'BUF');
  R.tickClock(g, R.QUARTER_TICKS);
  eq(g.quarter, 2, 'a full quarter of ticks rolls the quarter');
  ok(!g.over, 'and the game is not over');
  R.tickClock(g, R.QUARTER_TICKS * 3);
  ok(g.over, 'four quarters ends the game');
  const before = g.score.slice();
  R.applyPlay(g, 50, false);
  ok(g.score[0] === before[0] && g.score[1] === before[1], 'no play scores after the game is over');
  L('    quarters roll, game ends, play after the end is inert');
}

L('\n=== THE CONTROL SCHEME: XBOX, WITH ITS N64 LINEAGE ===');
{
  const o = { act: 0, target: 0 };
  // Receiver select is the inherited three-C-button idiom on three face buttons.
  P.padAction(P.PHASE.OFFENSE_POCKET, P.BTN.X, o);
  eq(o.act, T.ACT.PASS, 'X passes'); eq(o.target, 1, 'X targets receiver 1');
  P.padAction(P.PHASE.OFFENSE_POCKET, P.BTN.Y, o); eq(o.target, 2, 'Y targets receiver 2');
  P.padAction(P.PHASE.OFFENSE_POCKET, P.BTN.B, o); eq(o.target, 3, 'B targets receiver 3');

  // The same physical button means different things by phase -- the reason the scheme
  // lives in game-flow at all.
  P.padAction(P.PHASE.OFFENSE_CARRY, P.BTN.A, o); eq(o.act, T.ACT.STIFF_ARM, 'A stiff-arms as a carrier');
  P.padAction(P.PHASE.DEFENSE, P.BTN.A, o); eq(o.act, T.ACT.TACKLE, 'A tackles on defence');
  P.padAction(P.PHASE.PRESNAP, P.BTN.A, o); eq(o.act, T.ACT.SNAP, 'A snaps the ball');

  // Turbo is on the trigger in every phase that has it -- one habit, never relearned.
  let turboEverywhere = true;
  for (const ph of [P.PHASE.OFFENSE_POCKET, P.PHASE.OFFENSE_CARRY, P.PHASE.DEFENSE, P.PHASE.PRESNAP]) {
    P.padAction(ph, P.BTN.RT, o);
    if (o.act !== T.ACT.TURBO_ON) turboEverywhere = false;
  }
  ok(turboEverywhere, 'RT is turbo in every phase that has turbo');

  // An unbound button is inert, not an accidental action.
  P.padAction(P.PHASE.DEFENSE, P.BTN.START, o);
  eq(o.act, T.ACT.NONE, 'an unbound button does nothing');
  P.padAction(999, P.BTN.A, o); eq(o.act, T.ACT.NONE, 'an unknown phase does nothing');

  // PARITY: every action the touch scheme can produce must be reachable on the pad too,
  // or the two devices have quietly drifted apart.
  const padActs = new Set();
  for (let ph = 0; ph < P.PHASE_NAME.length; ph++) {
    for (let b = 0; b < P.BTN_COUNT; b++) { P.padAction(ph, b, o); if (o.act) padActs.add(o.act); }
  }
  const touchActs = new Set(Array.from(T.PAD_MAP).filter((a) => a > 0));
  const missing = [...touchActs].filter((a) => !padActs.has(a)).map((a) => T.ACT_NAME[a]);
  ok(missing.length === 0, 'every touch action is reachable on the pad', missing.join(','));
  L(`    ${padActs.size} actions bound across ${P.PHASE_NAME.length} phases; touch parity holds`);
}

L('\n=== THE PLAY SIMULATION ===');
{
  const S = await imp('src/pieces/play-sim/sim.js');
  const players = JSON.parse((await import('node:fs')).readFileSync(path.join(ROOT, 'src/data/players.json'), 'utf8'));
  const clubs = Object.keys(players.byTeam);
  const KC = players.byTeam.KC, BUF = players.byTeam.BUF;
  const runOnce = (offIdx, defIdx, seed, off, def) => S.runPlay(S.createPlay(
    seed, playbook.offense[offIdx], playbook.defense[defIdx],
    off || KC, def || BUF, playbook.formation));

  // Sweep a statistic over MANY clubs rather than one matchup. Every rating-sensitivity
  // claim in this section used to be measured on KC against BUF alone, and that is how a
  // false one got through: Mahomes is rated 92 for speed, so he scrambles clear of a
  // six-man rush that flattens most of the league, and the six-versus-two comparison read
  // 0% against 0% on that matchup while reading 43% against 0% across the league. One
  // matchup is an anecdote regardless of how many seeds it is run with.
  const league = (fn, stride) => {
    let hit = 0, n = 0;
    for (let t = 0; t < clubs.length; t += (stride || 1)) {
      const off = players.byTeam[clubs[t]], def = players.byTeam[clubs[(t + 7) % clubs.length]];
      for (let o = 0; o < playbook.offense.length; o++) {
        const st = S.runPlay(S.createPlay(9000 + t * 131 + o * 41, playbook.offense[o],
          playbook.defense[fn.d], off, def, playbook.formation));
        if (fn.test(st)) hit++;
        n++;
      }
    }
    return { rate: hit / n, n };
  };
  const dIdx = (id) => playbook.defense.findIndex((x) => x.id === id);
  const isSack = (st) => st.result === S.RESULT.SACK;

  // DETERMINISM. Same seed and same inputs must give the same play, tick for tick.
  // Everything downstream (replays, the 60-vs-30 invariance the engine already proved)
  // depends on this, so it is asserted before anything else.
  const a = runOnce(0, 0, 4242), b = runOnce(0, 0, 4242);
  eq(a.yards, b.yards, 'same seed gives the same yardage');
  eq(a.result, b.result, 'same seed gives the same result');
  eq(a.tick, b.tick, 'same seed gives the same tick count');

  // AND THE SEED HAS TO REACH THE FIELD. Measured across the sheet, not on one pair: the
  // generator is only consulted to break a contested catch, an interception or a broken
  // tackle, so a play that resolves cleanly never touches it. Before the passer's read was
  // given a seeded jitter, the same call against the same call replayed byte-identically
  // forever, and a single-pair check of this happened to sit on one of the plays that did
  // draw. One pair is a coin toss dressed as a test.
  let seedDiff = 0, seedN = 0;
  for (let o = 0; o < playbook.offense.length; o++) {
    for (let d = 0; d < playbook.defense.length; d++) {
      const p1 = runOnce(o, d, 400 + o * 13 + d), p2 = runOnce(o, d, 90000 + o * 13 + d);
      if (p1.yards !== p2.yards || p1.result !== p2.result || p1.tick !== p2.tick) seedDiff++;
      seedN++;
    }
  }
  ok(seedDiff > seedN * 0.35, 'a different seed gives a different play',
    `${seedDiff}/${seedN} pairs differ`);

  // Plays terminate. A sim that can hang is unusable regardless of how it looks.
  let hung = 0, live = 0;
  for (let o = 0; o < playbook.offense.length; o++) {
    for (let d = 0; d < playbook.defense.length; d++) {
      const st = runOnce(o, d, 1000 + o * 31 + d);
      if (st.tick >= 600) hung++;
      if (st.result === S.RESULT.LIVE) live++;
    }
  }
  eq(hung, 0, 'no play hits the tick cap', `${hung} of 162`);
  eq(live, 0, 'every play reaches a terminal result');

  // Nobody may run off the map. A scrambling passer is steered at the sideline, so this is
  // a live risk rather than a theoretical one -- and an earlier version of that steering
  // sent him seventy-five yards BACKWARDS on the tenth percentile because no rule ended
  // the down while his escape lane stayed shut.
  let offField = 0;
  for (let o = 0; o < playbook.offense.length; o++) {
    for (let d = 0; d < playbook.defense.length; d++) {
      const st = runOnce(o, d, 1700 + o * 31 + d);
      if (st.yards < -25 || st.yards > 100) offField++;
      for (const m of st.off.concat(st.def)) if (Math.abs(m.x) > 30 || m.y < -30) offField++;
    }
  }
  eq(offField, 0, 'no player or result leaves the field of play');

  // THE REQUIREMENT THAT MATTERS: different plays must actually behave differently.
  // Measured as the spread of mean yardage across the eighteen offensive calls, each
  // averaged over every defence and several seeds so one lucky roll cannot carry it.
  const meanFor = (o) => {
    let t = 0, n = 0;
    for (let d = 0; d < playbook.defense.length; d++) {
      for (let s2 = 0; s2 < 6; s2++) { t += runOnce(o, d, 7000 + o * 977 + d * 31 + s2 * 7).yards; n++; }
    }
    return t / n;
  };
  const means = playbook.offense.map((_, o) => meanFor(o));
  const lo = Math.min(...means), hi = Math.max(...means);
  ok(hi - lo >= 6, 'offensive calls produce a real spread of yardage', `${lo.toFixed(1)} .. ${hi.toFixed(1)}`);

  // And the defensive calls must matter too, or the playcall screen is decoration.
  const dMeanFor = (d) => {
    let t = 0, n = 0;
    for (let o = 0; o < playbook.offense.length; o++) {
      for (let s2 = 0; s2 < 3; s2++) { t += runOnce(o, d, 5000 + o * 13 + d * 101 + s2 * 5).yards; n++; }
    }
    return t / n;
  };
  const dMeans = playbook.defense.map((_, d) => dMeanFor(d));
  const dlo = Math.min(...dMeans), dhi = Math.max(...dMeans);
  ok(dhi - dlo >= 3, 'defensive calls produce a real spread of yardage', `${dlo.toFixed(1)} .. ${dhi.toFixed(1)}`);

  // THE PASS RUSH, MONOTONE IN THE NUMBER OF RUSHERS. This is the assertion this piece
  // failed four separate times, each failure a different mechanism: blockers slowing every
  // rusher at once (a six-man and a two-man rush both sacked 67%), a block that decayed
  // back to full speed before it mattered (72% and 72%, identical to the tick), an
  // unconditional flush that let the extra rushers WARN the passer into an early throw (0%
  // against 61% -- backwards), and a scramble with no sack rule on it (0% against 0%).
  // Three blockers is the hinge: up to three rushers are blocked and the rest come free.
  const rush6 = league({ d: dIdx('all_out'), test: isSack });
  const rush4 = league({ d: dIdx('blitz_2'), test: isSack });
  const rush3 = league({ d: dIdx('blitz_1'), test: isSack });
  const rush2 = league({ d: dIdx('deep_zone'), test: isSack });
  const pc = (r) => `${(r.rate * 100).toFixed(0)}%`;
  ok(rush6.rate > rush2.rate, 'a six-man rush sacks more than a two-man rush',
    `${pc(rush6)} vs ${pc(rush2)} over ${rush6.n} downs`);
  ok(rush6.rate > rush4.rate && rush4.rate > rush3.rate && rush3.rate > rush2.rate,
    'sack rate is monotone in the number of rushers',
    `6r ${pc(rush6)} > 4r ${pc(rush4)} > 3r ${pc(rush3)} > 2r ${pc(rush2)}`);

  // The mechanism behind the bottom of that ladder: with fewer rushers than blockers the
  // spare blocker DOUBLES, and a doubled rusher is held about twice as long. Asserted on
  // the assignment itself, not on the outcome, so it cannot be satisfied by luck.
  {
    const two = S.createPlay(1, playbook.offense[0], playbook.defense[dIdx('deep_zone')], KC, BUF, playbook.formation);
    const six = S.createPlay(1, playbook.offense[0], playbook.defense[dIdx('all_out')], KC, BUF, playbook.formation);
    S.step(two); S.step(six);
    const held = (st) => st.def.filter((d) => d.blocked > 0);
    const freeMen = (st) => st.def.filter((d) => st.defense.assign[d.slot] === 'rush' && !d.blocked);
    eq(freeMen(two).length, 0, 'a two-man rush is fully blocked');
    eq(freeMen(six).length, 3, 'a six-man rush leaves three men unblocked', 'three blockers, six rushers');
    const twoHold = Math.min(...held(two).map((d) => d.holdTicks));
    const sixHold = Math.min(...held(six).map((d) => d.holdTicks));
    ok(twoHold > sixHold * 1.3, 'the spare blocker doubles rather than idling',
      `${twoHold.toFixed(0)} vs ${sixHold.toFixed(0)} ticks of hold`);
  }

  // RATINGS HAVE TO REACH THE FIELD. Each of these is swept over the league, and each one
  // is a rating that was at some point read off the roster and then consulted by nothing.
  const sweep = (mutate, label) => {
    const out = [];
    for (const v of [30, 65, 99]) {
      let tot = 0, n = 0;
      // The whole league at every point. An eight-club stride reported this curve as
      // 3.8 < 3.6 < 4.5 -- non-monotone -- where all thirty-two clubs give 5.2 < 5.5 < 6.4.
      // The sim is deterministic, so that was not statistical noise: it was a subsample
      // small enough for a handful of matchups to set the answer.
      for (let t = 0; t < clubs.length; t += 1) {
        const off = mutate(players.byTeam[clubs[t]], v);
        const def = players.byTeam[clubs[(t + 7) % clubs.length]];
        for (let o = 0; o < playbook.offense.length; o++) {
          for (let d = 0; d < playbook.defense.length; d += 1) {
            tot += S.runPlay(S.createPlay(9000 + t * 131 + o * 41 + d, playbook.offense[o],
              playbook.defense[d], off, def, playbook.formation)).yards;
            n++;
          }
        }
      }
      out.push(tot / n);
    }
    return out;
  };
  const bySpeed = sweep((r, v) => r.map((p) => (p.slot.startsWith('REC') ? { ...p, spd: v } : p)));
  ok(bySpeed[0] < bySpeed[1] && bySpeed[1] < bySpeed[2],
    'a faster receiving corps gains more, monotonically',
    bySpeed.map((x) => x.toFixed(1)).join(' < '));

  // The passer's arm. `pas` sat on the roster unread until the throw was given an error
  // term -- Mahomes threw exactly the ball a third-stringer threw.
  const byArm = sweep((r, v) => r.map((p) => (p.slot === 'QB' ? { ...p, pas: v } : p)));
  ok(byArm[0] < byArm[1] && byArm[1] < byArm[2], 'a better passer gains more, monotonically',
    byArm.map((x) => x.toFixed(1)).join(' < '));

  // And the passer's legs, which only started meaning anything when he was allowed to run.
  const byLegs = sweep((r, v) => r.map((p) => (p.slot === 'QB' ? { ...p, spd: v } : p)));
  ok(byLegs[2] > byLegs[0], 'a faster passer gains more than a slow one',
    byLegs.map((x) => x.toFixed(1)).join(' -> '));

  // A FAST RECEIVER MUST NOT BE HARDER TO THROW TO. The throw used to be led along the
  // receiver's instantaneous heading, which overshoots the moment he breaks -- and the
  // faster he was, the further past the break the ball landed. Measured, a corps at 99
  // threw 36% incomplete against 18% for the same routes at 25: the sim was punishing its
  // best receivers for their best attribute. Leading along the ROUTE instead is exact.
  const incAt = (spd) => {
    let inc = 0, n = 0;
    const off = KC.map((p) => (p.slot.startsWith('REC') ? { ...p, spd } : p));
    for (let o = 0; o < playbook.offense.length; o++) {
      for (let d = 0; d < playbook.defense.length; d++) {
        const st = S.runPlay(S.createPlay(600 + o * 41 + d * 7, playbook.offense[o],
          playbook.defense[d], off, BUF, playbook.formation));
        if (st.result === S.RESULT.INCOMPLETE) inc++;
        n++;
      }
    }
    return inc / n;
  };
  const incSlow = incAt(30), incFast = incAt(99);
  ok(incFast <= incSlow + 0.05, 'a fast receiving corps is not harder to complete to',
    `${(incFast * 100).toFixed(0)}% incomplete at 99 vs ${(incSlow * 100).toFixed(0)}% at 30`);

  // THE SCRAMBLE, AND THE RULE ON IT. A passer who runs is still a passer until he crosses
  // the line: dropped behind it he is sacked, past it he is a runner. Leaving that out
  // turned every sack against an all-out rush into a tackle for loss and made the rush
  // count unmeasurable.
  {
    let scr = 0, behind = 0, beyond = 0, n = 0;
    for (let t = 0; t < clubs.length; t += 2) {
      const off = players.byTeam[clubs[t]], def = players.byTeam[clubs[(t + 7) % clubs.length]];
      for (let o = 0; o < playbook.offense.length; o++) {
        const st = S.runPlay(S.createPlay(9000 + t * 131 + o * 41, playbook.offense[o],
          playbook.defense[dIdx('all_out')], off, def, playbook.formation));
        if (!st.events.some((e) => e.kind === 'scramble')) { n++; continue; }
        scr++; n++;
        if (st.result === S.RESULT.SACK) { behind++; ok(st.yards < 0, 'a sack loses ground'); }
        else if (st.result === S.RESULT.TACKLED || st.result === S.RESULT.TOUCHDOWN) beyond++;
      }
    }
    ok(scr > n * 0.15, 'the passer runs when the pocket goes', `${scr}/${n} downs`);
    ok(behind > 0 && beyond > 0, 'a scramble can end either side of the line',
      `${behind} sacked, ${beyond} past the line`);
  }

  // THE RUN GAME. Three of the eighteen calls are runs, and they spent this piece's whole
  // construction averaging MINUS 0.4 yards over 864 downs -- every single one a tackle,
  // none of them ever gaining anything. Four separate mechanisms were missing at once:
  // the carrier was being dragged along his own pass route while the carrier logic tried
  // to take him upfield; he lined up ON the line rather than in the backfield, two and a
  // half yards from a lineman at the snap; the defence swarmed him from tick zero with
  // perfect knowledge of a handoff it could not yet have seen; and a defender still
  // engaged with a blocker could tackle him anyway, so he sprinted into a man who was
  // being blocked and was stopped by him. A third of the sheet was decoration.
  {
    const byPlay = {};
    for (let t = 0; t < clubs.length; t += 2) {
      const off = players.byTeam[clubs[t]], def = players.byTeam[clubs[(t + 7) % clubs.length]];
      for (let o = 0; o < playbook.offense.length; o++) {
        const pl = playbook.offense[o];
        if (pl.kind !== 'run') continue;
        for (let d = 0; d < playbook.defense.length; d++) {
          const st = S.runPlay(S.createPlay(9000 + t * 131 + o * 41 + d * 7, pl,
            playbook.defense[d], off, def, playbook.formation));
          const b = (byPlay[pl.id] = byPlay[pl.id] || { n: 0, tot: 0, gained: 0 });
          b.n++; b.tot += st.yards;
          if (st.yards > 0) b.gained++;
        }
      }
    }
    const ids = Object.keys(byPlay);
    eq(ids.length, 3, 'three run calls on the sheet');
    for (const id of ids) {
      const b = byPlay[id];
      ok(b.tot / b.n > 1.5, `${id} averages real yardage`, `${(b.tot / b.n).toFixed(2)} yd over ${b.n} downs`);
      ok(b.gained > b.n * 0.4, `${id} gains ground more often than not`, `${b.gained}/${b.n}`);
    }
    // And the three must not be the same run wearing different names -- the gap on the play
    // sheet is aimed AT, not nudged toward, which is what separates them.
    const means = ids.map((id) => byPlay[id].tot / byPlay[id].n);
    ok(Math.max(...means) - Math.min(...means) >= 0.8, 'the three runs are genuinely different calls',
      ids.map((id, i) => `${id} ${means[i].toFixed(1)}`).join(', '));
  }

  // A BLOCKED MAN DOES NOT MAKE THE PLAY. Asserted directly, because it is the rule that
  // makes both the run game and the pass rush mean anything: a sack or a tackle must come
  // from someone who beat his block or was never blocked.
  {
    let byBlocked = 0, total = 0;
    for (let o = 0; o < playbook.offense.length; o++) {
      for (let d = 0; d < playbook.defense.length; d++) {
        for (let s2 = 0; s2 < 3; s2++) {
          const st = S.runPlay(S.createPlay(2500 + o * 41 + d * 7 + s2, playbook.offense[o],
            playbook.defense[d], KC, BUF, playbook.formation));
          const ev = st.events.find((e) => e.kind === 'tackle' || e.kind === 'sack');
          if (!ev) continue;
          total++;
          const man = st.def.find((x) => x.slot === ev.slot);
          if (!man || !man.blocked) continue;
          // A block is beaten two ways and BOTH count: its time runs out, or the blocker
          // loses contact. The first version of this check tested only the clock and
          // flagged three honest tackles by men whose blocker had simply been left behind.
          const stillOn = st.off.some((b) => b.engaged === man.slot
            && Math.hypot(b.x - man.x, b.y - man.y) < S.BLOCK_REACH);
          if (stillOn && st.tick < man.holdTicks) byBlocked++;
        }
      }
    }
    ok(total > 200, 'plays end in a tackle or a sack often enough to check', `${total}`);
    eq(byBlocked, 0, 'nobody makes a tackle while still being blocked', `${byBlocked} of ${total}`);
  }

  // THE BALL COMES LOOSE. RESULT.FUMBLE was declared and never once produced -- 5184 downs
  // across all 32 clubs, not a single one -- while `pow` (hit power) and `bal` (ball
  // security) were read off every roster and consulted by nothing. Three dead things that
  // were really one gap, and the same defect `pas` had before the throw got an error term.
  {
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

    // Hit power drives it up. Asserted across the WHOLE range, not just at the top: the
    // first version resolved the contest as a difference, which goes negative the moment a
    // hitter is out-rated, and since carriers here rate about 90 for ball security the
    // clamp swallowed everything below ~80 -- a defence at 30 and one at 65 both forced
    // fumbles on exactly 0.35% of downs. A rating that only exists at the top of its range
    // is not in the simulation.
    const byPow = sweep((o, d, v) => [o, d.map((p) => ({ ...p, pow: v }))]);
    ok(byPow[0] < byPow[1] && byPow[1] < byPow[2], 'hit power forces fumbles, across its whole range', pct(byPow));

    // And ball security drives it down.
    const byBal = sweep((o, d, v) => [o.map((p) => ({ ...p, bal: v })), d]);
    ok(byBal[0] > byBal[1] && byBal[1] > byBal[2], 'ball security prevents fumbles, across its whole range', pct(byBal));

    // A sack is the most dangerous hit there is -- he never saw it coming.
    // Counted over CONTACT, from the event, not inferred from the final state -- the first
    // version of this asked whether the passer still had the ball at the whistle, which is
    // also true of every incompletion and every throwaway, and it reported the strip-sack
    // as the SAFER of the two at 1.6% against 4.0%.
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
    ok(sackN > 100 && tackN > 100, 'enough of both kinds of contact to compare', `${sackN} / ${tackN}`);
    ok(sackF / sackN > tackF / tackN, 'a sack shakes the ball loose more often than a tackle',
      `${((sackF / sackN) * 100).toFixed(1)}% vs ${((tackF / tackN) * 100).toFixed(1)}%`);
  }

  // THE ENGINE'S CORE INVARIANT, APPLIED TO THIS PIECE. The renderer hands the sim seconds
  // at whatever rate it is presenting; the sim is a fixed 60 Hz tick. adapt.js accumulates
  // dt and consumes only WHOLE ticks, so the same elapsed time must produce the identical
  // state at any frame rate and must equal what plain node produces stepping tick by tick.
  // The engine already proved bit-identical sim state across 60/45/30 present rates before
  // this piece existed; it only stays true if the piece keeps it true, and until now that
  // was asserted nowhere -- it was a claim in a comment.
  {
    const per = 1 / S.TICK_HZ;
    const drive = (seed, o, d, dts) => {
      const st = S.createPlay(seed, playbook.offense[o], playbook.defense[d], KC, BUF, playbook.formation);
      st.acc = 0; st.t = 0;
      for (const dt of dts) {
        st.t += dt; st.acc += dt;
        let g = 0;
        while (st.acc >= per && g++ < 600) {
          st.acc -= per;
          if (st.result !== S.RESULT.LIVE) break;
          S.advance(st);
        }
      }
      return st;
    };
    const fill = (n, dt) => Array(n).fill(dt);
    const sig = (st) => `${st.tick}|${st.result}|`
      + st.off.concat(st.def).map((m) => `${m.x.toFixed(6)},${m.y.toFixed(6)}`).join(';');
    let divergent = 0, checked = 0;
    for (let o = 0; o < playbook.offense.length; o++) {
      for (let d = 0; d < playbook.defense.length; d++) {
        const seed = 1234 + o * 7 + d;
        // Two seconds of football, delivered three different ways.
        const a = drive(seed, o, d, fill(120, 1 / 60));
        const b = drive(seed, o, d, fill(60, 1 / 30));
        const c = drive(seed, o, d, fill(24, 1 / 12));
        // ...and the same two seconds stepped straight through in plain node.
        const ref = S.createPlay(seed, playbook.offense[o], playbook.defense[d], KC, BUF, playbook.formation);
        for (let i = 0; i < 120 && ref.result === S.RESULT.LIVE; i++) S.advance(ref);
        if (sig(a) !== sig(b) || sig(a) !== sig(c)) divergent++;
        else if (ref.tick === a.tick && sig(ref) !== sig(a)) divergent++;
        checked++;
      }
    }
    eq(divergent, 0, 'the sim is identical at 60, 30 and a ragged 12 frames a second',
      `${divergent} of ${checked} play pairs diverged`);
  }

  // AND PURSUIT, measured by HOW LONG A CATCH SURVIVES. Switching pursuit off changed no
  // yardage bound, no sack rate and no completion rate in this suite -- a silent no-op,
  // though it is the difference between a defence and seven men running their assignments
  // past the ball. "Who made the tackle" was not sharp enough to see it either: a zone
  // defender on his landmark still tackles a receiver who runs into him. With the defence
  // converging a caught ball is down in 17 ticks; without, the receiver runs 85 untouched.
  {
    let ticks = 0, caught = 0, byCover = 0, tot = 0;
    for (let o = 0; o < playbook.offense.length; o++) {
      for (let d = 0; d < playbook.defense.length; d++) {
        for (let s2 = 0; s2 < 3; s2++) {
          const st = S.runPlay(S.createPlay(2500 + o * 41 + d * 7 + s2, playbook.offense[o],
            playbook.defense[d], KC, BUF, playbook.formation));
          const ev = st.events.find((e) => e.kind === 'tackle' || e.kind === 'sack');
          if (ev) { tot++; if (st.defense.assign[ev.slot] !== 'rush') byCover++; }
          const cat = st.events.find((e) => e.kind === 'catch');
          if (cat && st.result === S.RESULT.TACKLED) { ticks += st.tick - cat.tick; caught++; }
        }
      }
    }
    ok(caught >= 40, 'enough catches are brought down to measure pursuit', `${caught}`);
    ok(ticks / caught <= 40, 'the defence converges on a catch rather than escorting it',
      `${(ticks / caught).toFixed(0)} ticks from catch to tackle`);
    ok(byCover > tot * 0.6, 'coverage defenders make most of the tackles',
      `${byCover}/${tot} by a man who was not rushing`);
  }

  // THE ENGINE'S CORE INVARIANT, APPLIED TO THIS PIECE. The renderer hands the sim seconds
  // at whatever rate it is presenting; the sim is a fixed 60 Hz tick. adapt.js accumulates
  // dt and consumes only WHOLE ticks, so the same elapsed time must produce the identical
  // state at any frame rate and must equal what plain node produces stepping tick by tick.
  // The engine already proved bit-identical sim state across 60/45/30 present rates before
  // this piece existed; it only stays true if the piece keeps it true, and until now that
  // was asserted nowhere -- it was a claim in a comment.
  {
    const per = 1 / S.TICK_HZ;
    const drive = (seed, o, d, dts) => {
      const st = S.createPlay(seed, playbook.offense[o], playbook.defense[d], KC, BUF, playbook.formation);
      st.acc = 0; st.t = 0;
      for (const dt of dts) {
        st.t += dt; st.acc += dt;
        let g = 0;
        while (st.acc >= per && g++ < 600) {
          st.acc -= per;
          if (st.result !== S.RESULT.LIVE) break;
          S.advance(st);
        }
      }
      return st;
    };
    const fill = (n, dt) => Array(n).fill(dt);
    const sig = (st) => `${st.tick}|${st.result}|`
      + st.off.concat(st.def).map((m) => `${m.x.toFixed(6)},${m.y.toFixed(6)}`).join(';');
    let divergent = 0, checked = 0;
    for (let o = 0; o < playbook.offense.length; o++) {
      for (let d = 0; d < playbook.defense.length; d++) {
        const seed = 1234 + o * 7 + d;
        // Two seconds of football, delivered three different ways.
        const a = drive(seed, o, d, fill(120, 1 / 60));
        const b = drive(seed, o, d, fill(60, 1 / 30));
        const c = drive(seed, o, d, fill(24, 1 / 12));
        // ...and the same two seconds stepped straight through in plain node.
        const ref = S.createPlay(seed, playbook.offense[o], playbook.defense[d], KC, BUF, playbook.formation);
        for (let i = 0; i < 120 && ref.result === S.RESULT.LIVE; i++) S.advance(ref);
        if (sig(a) !== sig(b) || sig(a) !== sig(c)) divergent++;
        else if (ref.tick === a.tick && sig(ref) !== sig(a)) divergent++;
        checked++;
      }
    }
    eq(divergent, 0, 'the sim is identical at 60, 30 and a ragged 12 frames a second',
      `${divergent} of ${checked} play pairs diverged`);
  }

  // AND PURSUIT, asserted through WHO MAKES THE TACKLE. Switching pursuit off changed no
  // yardage bound, no sack rate and no completion rate in this suite -- it survived as a
  // silent no-op even though it is the difference between a defence and seven men running
  // their assignments past the ball.
  {
    let byRush = 0, byCover = 0;
    for (let o = 0; o < playbook.offense.length; o++) {
      for (let d = 0; d < playbook.defense.length; d++) {
        for (let s2 = 0; s2 < 3; s2++) {
          const st = S.runPlay(S.createPlay(2500 + o * 41 + d * 7 + s2, playbook.offense[o],
            playbook.defense[d], KC, BUF, playbook.formation));
          const ev = st.events.find((e) => e.kind === 'tackle' || e.kind === 'sack');
          if (!ev) continue;
          if (st.defense.assign[ev.slot] === 'rush') byRush++; else byCover++;
        }
      }
    }
    const total = byRush + byCover;
    ok(byCover > total * 0.4, 'coverage defenders converge on the ball and make tackles',
      `${byCover}/${total} tackles by a man who was not rushing`);
  }

  // THREE MECHANISM-LEVEL CHECKS, each added because the mutation battery proved the
  // outcome-level assertions above could not see the mechanism at all. Deleting any of the
  // three behaviours below changed no yardage bound, no sack rate and no completion rate
  // this suite checks -- they survived as silent no-ops. That is precisely the failure mode
  // the battery exists to expose, and the fix is to assert where the thing happens.

  // (1) A fully blocked front must not panic the passer. Three blockers means at most three
  // rushers are held at once, so the held-pressure weight must stay under a third of the
  // flush threshold, or blocked men alone trip it -- the defect that once made a six-man
  // rush sack LESS than a two-man one.
  {
    const dz = playbook.defense[dIdx('deep_zone')];
    let flushed = 0, n = 0;
    for (let o = 0; o < playbook.offense.length; o++) {
      for (let s2 = 0; s2 < 6; s2++) {
        const st = S.runPlay(S.createPlay(500 + o * 31 + s2, playbook.offense[o], dz, KC, BUF, playbook.formation));
        if (st.flushedAt !== undefined) flushed++;
        n++;
      }
    }
    eq(flushed, 0, 'a front with nobody unblocked never flushes the passer', `${flushed} of ${n}`);
  }

  // (2) The release tick has to move. Ball placement already varies by seed through the
  // throw error, so an outcome check cannot tell whether the passer's TIMING varies at all.
  {
    const ticks = new Set();
    for (let s2 = 0; s2 < 40; s2++) {
      const st = S.runPlay(S.createPlay(7000 + s2 * 97, playbook.offense[0],
        playbook.defense[dIdx('deep_zone')], KC, BUF, playbook.formation));
      const th = st.events.find((e) => e.kind === 'throw');
      if (th) ticks.add(th.tick);
    }
    ok(ticks.size >= 8, 'the passer does not release on the same tick every time',
      `${ticks.size} distinct ticks over 40 seeds`);
  }

  // (3) The separation floor. He declines a covered receiver rather than forcing it.
  {
    let min = Infinity, n = 0;
    for (let o = 0; o < playbook.offense.length; o++) {
      for (let d = 0; d < playbook.defense.length; d++) {
        for (let s2 = 0; s2 < 3; s2++) {
          const st = S.runPlay(S.createPlay(300 + o * 41 + d * 7 + s2, playbook.offense[o],
            playbook.defense[d], KC, BUF, playbook.formation));
          for (const e of st.events) if (e.kind === 'throw') { min = Math.min(min, e.sep); n++; }
        }
      }
    }
    ok(n > 100, 'the sim throws the ball', `${n} throws`);
    ok(min >= 1.85, 'no throw leaves into blanket coverage', `closest was ${min.toFixed(2)} yd`);
  }

  // THE LEAGUE-WIDE SHAPE, reported rather than asserted tightly: these are balance
  // numbers, and pinning them would freeze a judgement call as if it were a requirement.
  const mix = {};
  let tot = 0, nAll = 0;
  for (let t = 0; t < clubs.length; t++) {
    const off = players.byTeam[clubs[t]], def = players.byTeam[clubs[(t + 7) % clubs.length]];
    for (let o = 0; o < playbook.offense.length; o++) {
      for (let d = 0; d < playbook.defense.length; d++) {
        const st = S.runPlay(S.createPlay(9000 + t * 131 + o * 41 + d * 7, playbook.offense[o],
          playbook.defense[d], off, def, playbook.formation));
        mix[S.RESULT_NAME[st.result]] = (mix[S.RESULT_NAME[st.result]] || 0) + 1;
        tot += st.yards; nAll++;
      }
    }
  }
  // Sanity bounds only -- wide enough that they catch a collapse, not a tuning drift.
  ok(mix.sack / nAll < 0.30, 'the pass rush does not eat the game', `${((mix.sack / nAll) * 100).toFixed(1)}% sacks`);
  ok((mix.interception || 0) / nAll < 0.08, 'interceptions stay rare', `${(((mix.interception || 0) / nAll) * 100).toFixed(1)}%`);
  ok((mix.fumble || 0) / nAll > 0.005 && (mix.fumble || 0) / nAll < 0.08, 'the ball comes loose, but not constantly',
    `${(((mix.fumble || 0) / nAll) * 100).toFixed(1)}% fumbles`);
  ok(tot / nAll > 3 && tot / nAll < 12, 'yards per play is in a football range', `${(tot / nAll).toFixed(2)} yd`);

  L(`    162 play pairs, all terminate; offence spread ${lo.toFixed(1)}..${hi.toFixed(1)} yd, defence ${dlo.toFixed(1)}..${dhi.toFixed(1)} yd`);
  L(`    sack rate by rushers: 6r ${pc(rush6)}  4r ${pc(rush4)}  3r ${pc(rush3)}  2r ${pc(rush2)}   (${rush6.n} downs each)`);
  L(`    ${nAll} downs over all 32 clubs: ${Object.entries(mix).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${((v / nAll) * 100).toFixed(1)}%`).join(', ')}`);
  L(`    ${(tot / nAll).toFixed(2)} yards per play`);
}
L('\n=== A WHOLE GAME RUNS TO COMPLETION ===');
{
  // The integration check: drive a full game with a seeded sequence and assert it ends in
  // a legal state. Catches rule interactions no single-rule test would.
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const g = R.newGame('KC', 'BUF');
  let plays = 0, tds = 0, illegal = 0;
  while (!g.over && plays < 4000) {
    const gain = Math.round((rnd() * 34) - 7);
    const turnover = rnd() < 0.04;
    const out = R.applyPlay(g, gain, turnover);
    if (out === R.OUTCOME.TOUCHDOWN) { tds++; R.applyPat(g); R.changePossession(g, 25); }
    if (g.ballOn < 0 || g.ballOn > 100) illegal++;
    if (g.down < 1 || g.down > 4) illegal++;
    if (g.possession !== 0 && g.possession !== 1) illegal++;
    R.tickClock(g, 90);
    plays++;
  }
  ok(g.over, 'the game reaches its end');
  eq(illegal, 0, 'no illegal state at any point in the game');
  ok(tds > 0, 'somebody scored');
  ok(g.score[0] >= 0 && g.score[1] >= 0, 'scores are sane');
  L(`    ${plays} plays, ${tds} touchdowns, final ${g.away} ${g.score[0]} - ${g.home} ${g.score[1]}`);
}

L('');
L('='.repeat(72));
if (fail) { for (const f of failures) L('  FAIL  ' + f); }
L(`VERDICT  ${fail ? 'FAIL' : 'PASS'}   ${pass} assertions, ${fail} failures`);
process.exit(fail ? 1 : 0);
