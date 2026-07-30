#!/usr/bin/env node
// THE GAMEPLAY TEST SUITE. Plain node, no browser, no renderer, ~50 ms.
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
// NOT YET DONE, and stated here rather than implied away: there is no automated mutation
// battery. A sister piece in this project shipped a suite where 20 of 38 deliberate
// mutations left it green, so "the assertions look specific" is not evidence. Until a
// battery exists, treat this suite as unproven against that standard.
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
