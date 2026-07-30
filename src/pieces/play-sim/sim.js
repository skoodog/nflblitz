// PIECE play-sim — THE PLAY SIMULATION.
//
// Seven attackers running the called play against seven defenders running theirs, on a
// fixed timestep, as a PURE FUNCTION of (state, tick). No renderer, no wall clock, no
// Math.random. That is what lets the whole thing be tested in plain node in milliseconds
// instead of through a 26-second software-rasterised screenshot.
//
// THE ONE INVARIANT EVERYTHING ELSE HANGS OFF: step() must be reproducible. Same seed,
// same play pair, same roster -> same yardage, tick for tick. The engine already proved
// bit-identical sim state across 60/45/30 present rates; this piece has to keep that
// property, so nothing here may read a clock or draw a random number outside the seeded
// generator threaded through state.
//
// UNITS. x is across the field in yards from centre (+-24). y is downfield in yards from
// the line of scrimmage. Speed is yards per tick at 60 ticks/s: a 99-speed player covers
// about 9.5 yd/s, which is roughly a real 4.3 forty, exaggerated slightly because this is
// arcade football and the whole point is that it feels fast.

import { makeRng } from '../../foundation/rng.js';

export const TICK_HZ = 60;
const YPS_MIN = 5.6;   // a 20-speed lineman
const YPS_MAX = 9.8;   // a 99-speed receiver
const TACKLE_RADIUS = 1.05;
const SACK_RADIUS = 1.25;
const CATCH_RADIUS = 1.6;
const BALL_YPS = 26;   // a thrown ball, yards per second

/* ------------------------------------------------------------- the pocket ---- */
// These five numbers are the whole pass rush, and they are set against each other
// deliberately rather than tuned one at a time. See the note above runPlay().
const BLOCK_HOLD_TICKS = 100;    // how long ONE blocker holds ONE rusher, before ratings
const BLOCK_RELEASE_TICKS = 26; // once beaten, how long the rusher takes to get back to speed
const BLOCK_SLOW = 0.16;        // a held rusher's speed while the block is winning
const BLOCK_REACH = 2.6;        // a blocker past this distance is no longer engaged
const PRESSURE_RADIUS = SACK_RADIUS * 2.4;   // 3.0 yd: where the passer feels it
const PRESSURE_FREE = 1.0;      // an unblocked rusher inside that radius
// A rusher still fighting a block is not the same threat. This weight is not tuned, it is
// CONSTRAINED: there are three blockers, so at most three rushers can ever be held at
// once, and 3 x PRESSURE_HELD must stay under PRESSURE_FLUSH or blocked men alone can trip
// the flush -- which is precisely the defect that made a six-man rush sack less than a
// two-man one. Anything at or above 1/3 reintroduces it.
const PRESSURE_HELD = 0.25;
const PRESSURE_FLUSH = 1.0;     // one free man in your lap is a flush
const FLUSH_REACT = 12;         // ticks between feeling it and the ball leaving
const HOT_SEP = 2.6;            // yards of separation before a hurried throw is on
const MIN_THROW_SEP = 1.9;      // below this the passer will not pull the trigger at all
const THROWAWAY_TICKS = 45;     // how long past the read he will wait before binning it
/**
 * Ticks either side of the play's own clock that the passer's read may actually land on.
 *
 * WHY THERE IS ANY VARIANCE AT ALL. Everything else here is deterministic geometry, and
 * the seeded generator is only consulted to break a contested catch, an interception or a
 * broken tackle -- so a play that completes cleanly never draws from it, and the same call
 * against the same call produced a byte-identical down every single time. For a game that
 * is not a neutral property: it means the same answer beats the same call forever.
 *
 * This is the one place variance is injected, and it is injected as TIMING rather than as
 * a roll on the result: a passer does not hit his back foot on the same frame twice. One
 * draw, at construction, from the seeded generator -- so the same seed still reproduces
 * the down tick for tick, which is the invariant the whole engine rests on.
 */
const READY_JITTER = 9;
/**
 * Scale of a thrown ball's miss, in yards, before the passer's rating and the length of
 * the throw are applied. See the note in throwTo() for why the error lives on the aim
 * point rather than on the catch.
 */
const THROW_ERR = 2.2;
/** How hard a scrambling passer runs, against his own speed. Running for his life. */
const SCRAMBLE_SPEED = 1.0;
/**
 * Ticks a rusher spends breaking down after the passer leaves the pocket.
 *
 * A rusher at full speed toward a spot cannot simply become a rusher at full speed toward
 * a different spot; seek() redirects instantly, which quietly made pursuit perfect. With
 * perfect pursuit no scramble can ever work -- measured, the passer's median scramble was
 * MINUS SEVEN yards, because he broke at two yards from a man who was faster than him with
 * seven yards of his own backfield still to cross. This is the commitment he beats.
 */
const RUSH_REDIRECT_TICKS = 22;
const RUSH_REDIRECT_SLOW = 0.55;
/**
 * How close an UNBLOCKED rusher must get before the passer gives up on the down and runs.
 *
 * Deliberately much tighter than PRESSURE_RADIUS. Triggering the scramble off pressure
 * instead of off this turned 27% of all downs into scrambles -- every down against every
 * overload front, whether or not the rush was ever going to arrive -- and dragged the
 * yardage down with it. At a hair over the sack radius it only rescues downs that were
 * about to end in a sack, which is the whole point of it.
 */
const SCRAMBLE_TRIGGER = SACK_RADIUS * 2.1;
/** A defender assigned to rush shows blitz: it walks up to the line before the snap. */
const BLITZ_DEPTH = 1.4;
const BLITZ_WIDTH = 0.45;

export const RESULT = Object.freeze({
  LIVE: 0, TACKLED: 1, SACK: 2, INCOMPLETE: 3, INTERCEPTION: 4,
  TOUCHDOWN: 5, OUT_OF_BOUNDS: 6, FUMBLE: 7,
});
export const RESULT_NAME = [
  'live', 'tackled', 'sack', 'incomplete', 'interception', 'touchdown', 'out-of-bounds', 'fumble',
];

/** Rating 0..99 -> yards per tick. Linear between the two anchors, clamped. */
function speedOf(rating) {
  const r = Math.max(0, Math.min(99, rating || 50)) / 99;
  return (YPS_MIN + (YPS_MAX - YPS_MIN) * r) / TICK_HZ;
}

function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }

/** Move `a` toward (tx,ty) by at most its speed. Returns true when it arrives. */
function seek(a, tx, ty, scale) {
  const dx = tx - a.x, dy = ty - a.y;
  const d = Math.hypot(dx, dy);
  const step = a.spd * (scale === undefined ? 1 : scale);
  if (d <= step) { a.x = tx; a.y = ty; return true; }
  a.x += (dx / d) * step;
  a.y += (dy / d) * step;
  return false;
}

/**
 * Position along a waypoint route at arc-length `travelled`.
 * Routes are SHAPES, not animations: a fast receiver reaches the end of the same route
 * sooner rather than running a different one, which is why this is parameterised by
 * distance travelled rather than by tick.
 */
function alongRoute(route, travelled) {
  let acc = 0;
  for (let i = 1; i < route.length; i++) {
    const [px, py] = route[i - 1], [cx, cy] = route[i];
    const seg = Math.hypot(cx - px, cy - py);
    if (acc + seg >= travelled) {
      const t = seg <= 0 ? 0 : (travelled - acc) / seg;
      return [px + (cx - px) * t, py + (cy - py) * t, false];
    }
    acc += seg;
  }
  const last = route[route.length - 1];
  return [last[0], last[1], true];
}

/**
 * Build a play. `offense`/`defense` are entries from src/data/playbook.json; `offRoster`
 * and `defRoster` are arrays of 14 players from src/data/players.json (the sim reads only
 * the seven on the field for each side, by slot).
 */
export function createPlay(seed, offense, defense, offRoster, defRoster, formation) {
  const rng = makeRng(seed);
  const bySlot = (roster) => {
    const m = {};
    for (const p of roster) m[p.slot] = p;
    return m;
  };
  const O = bySlot(offRoster), D = bySlot(defRoster);
  const F = formation.offense, G = formation.defense;

  const mk = (slot, p, side, spot) => ({
    slot, side,
    name: p ? p.name : slot,
    num: p && p.num !== undefined ? p.num : 0,
    x: spot[0], y: spot[1],
    spd: speedOf(p ? p.spd : 60),
    // Ratings the sim actually consults. Absent means "not rated for this role", which
    // the roster ingest preserves deliberately, so fall back per-role rather than to 0.
    cth: p && p.cth !== undefined ? p.cth : 40,
    pas: p && p.pas !== undefined ? p.pas : 50,
    cov: p && p.cov !== undefined ? p.cov : 40,
    tak: p && p.tak !== undefined ? p.tak : 50,
    pow: p && p.pow !== undefined ? p.pow : 50,
    prs: p && p.prs !== undefined ? p.prs : 50,
    blk: p && p.blk !== undefined ? p.blk : 50,
    itc: p && p.itc !== undefined ? p.itc : 30,
    bal: p && p.bal !== undefined ? p.bal : 60,
    rst: p && p.rst !== undefined ? p.rst : 50,
    travelled: 0, done: false, blocked: 0, engaged: null,
    // Last tick's position, so the sim can lead a throw along a receiver's REAL heading.
    px: spot[0], py: spot[1], vx: 0, vy: 0,
  });

  const off = Object.keys(F).map((s) => mk(s, O[s], 'OFF', F[s]));
  const def = Object.keys(G).map((s) => mk(s, D[s], 'DEF', G[s]));

  // SHOWING BLITZ. A defender whose assignment is `rush` does not rush from wherever it
  // happens to line up in coverage -- it walks up onto the ball first. Without this, a
  // six-man pressure sends three defensive backs at the passer from seven to fourteen
  // yards deep and they arrive around tick 110, long after the down is decided; measured,
  // that alone made an all-out rush LESS dangerous than a two-man rush, because the extra
  // men did nothing but trip the passer's pressure sense into an early throw. The single
  // shared alignment is a coverage look; this is what calling a blitz does to it.
  for (const d of def) {
    if (G[d.slot] === undefined || defense.assign[d.slot] !== 'rush') continue;
    if (d.y > BLITZ_DEPTH) d.y = BLITZ_DEPTH;
    if (Math.abs(d.x) > 4) d.x *= BLITZ_WIDTH;
    d.px = d.x; d.py = d.y;
  }

  const carrierSlot = offense.kind === 'run' || offense.kind === 'screen'
    ? offense.primary : 'QB';

  // Drawn here, once, before anything else consults the generator, so it is a pure
  // function of the seed and does not depend on how the down happens to unfold.
  const readyJitter = Math.round((rng() * 2 - 1) * READY_JITTER);

  return {
    rng, tick: 0, offense, defense, formation, readyJitter,
    off, def,
    result: RESULT.LIVE,
    // The ball starts with the passer and only moves to a carrier on a handoff or catch.
    carrier: offense.kind === 'run' ? carrierSlot : 'QB',
    ball: null,           // in flight: { x, y, tx, ty, target, travelled, len }
    yards: 0,
    events: [],
    pressure: 0,
  };
}

const find = (arr, slot) => arr.find((a) => a.slot === slot);

/** Where a zone defender wants to stand, by assignment name. */
function zoneAnchor(assign, a) {
  switch (assign) {
    case 'zone_flat': return [a.x < 0 ? -15 : 12, 6];
    case 'zone_hook': return [a.x * 0.5, 11];
    case 'zone_deep': return [a.x * 0.7, 21];
    case 'spy': return [0, 4];
    case 'contain': return [a.x < 0 ? -7 : 7, 2];
    default: return [a.x, a.y];
  }
}

/** Nearest receiver to a defender, for man coverage assignment at the snap. */
function assignMan(state) {
  const recs = state.off.filter((a) => a.slot.startsWith('REC'));
  const used = new Set();
  for (const d of state.def) {
    const as = state.defense.assign[d.slot];
    if (as !== 'man' && as !== 'press') continue;
    let best = null, bd = 1e9;
    for (const r of recs) {
      if (used.has(r.slot)) continue;
      const dd = dist(d.x, d.y, r.x, r.y);
      if (dd < bd) { bd = dd; best = r; }
    }
    if (best) { d.engaged = best.slot; used.add(best.slot); }
  }
}

/**
 * Hand the three blockers out over the rushers, most immediate threat first, and KEEP
 * GOING once every rusher has one. This is the mechanism that makes the rush count
 * matter, in both directions:
 *
 *   - more rushers than blockers -> the surplus run FREE at full speed
 *   - fewer rushers than blockers -> the spare blockers DOUBLE, and a doubled rusher is
 *     held roughly twice as long
 *
 * The first version slowed every rusher that came within reach of ANY blocker, so all six
 * were slowed by three -- an all-out rush and a two-man rush sacked at exactly the same
 * 67%. The second version paired one-to-one and left the spare blocker idle, so a two-man
 * rush was blocked exactly as well as a six-man one and nothing separated them either.
 * Protection is a RATIO of bodies, and both halves of the ratio have to be modelled.
 *
 * `blocked` ends up as the NUMBER of blockers on that rusher, and `holdTicks` as how long
 * they collectively keep it out, which is where the blocking and pass-rush ratings enter.
 */
function assignBlocks(state) {
  const blockers = state.off.filter((a) => a.slot.startsWith('OL'));
  const qb = find(state.off, 'QB');
  const rushers = state.def.filter((d) => state.defense.assign[d.slot] === 'rush');
  for (const r of rushers) { r.blocked = 0; r.holdTicks = 0; }
  // Threat order: closest to the passer first, because that is who arrives first.
  const order = rushers.slice().sort((a, b) => dist(a.x, a.y, qb.x, qb.y) - dist(b.x, b.y, qb.x, qb.y));
  const free = blockers.slice();
  const spare = [];
  for (const r of order) {
    if (!free.length) break;
    // Of the blockers left, the one nearest this rusher takes it.
    let bi = 0, bd = 1e9;
    for (let k = 0; k < free.length; k++) {
      const dd = dist(free[k].x, free[k].y, r.x, r.y);
      if (dd < bd) { bd = dd; bi = k; }
    }
    const b = free.splice(bi, 1)[0];
    b.engaged = r.slot;
    r.blocked += 1;
    // A blocker holds longer against a rusher it out-rates and gets beaten sooner by one
    // it does not. Clamped so no rating combination produces a block that never loses.
    const edge = Math.max(-0.55, Math.min(0.55, (b.blk - r.prs) / 120));
    r.holdTicks += BLOCK_HOLD_TICKS * (1 + edge);
  }
  // A SPARE BLOCKER HELPS EVERYWHERE, NOT ON ONE MAN. Handing it entirely to a single
  // rusher makes no difference to the down, because the down is decided by the FIRST
  // rusher home and the others are still singled -- measured, a two-man rush and a
  // three-man rush both sacked at exactly 33%, since the one rusher left singled arrived
  // on the same tick either way. Protection is a ratio: with three blocking two, both are
  // blocked by one and a half.
  const engaged = order.filter((r) => r.blocked > 0);
  if (free.length && engaged.length) {
    for (const b of free) {
      spare.push(b);
      b.engaged = engaged[0].slot;   // it stands somewhere, and that is next to the front
      for (const r of engaged) {
        const edge = Math.max(-0.55, Math.min(0.55, (b.blk - r.prs) / 120));
        r.holdTicks += (BLOCK_HOLD_TICKS * (1 + edge)) / engaged.length;
      }
    }
  } else {
    for (const b of free) b.engaged = null;
  }
  // What the offence can read at the line: more rushers than bodies to block them.
  state.overload = Math.max(0, rushers.length - blockers.length);
}

/** One tick. Returns the current result; LIVE means keep going. */
export function step(state) {
  if (state.result !== RESULT.LIVE) return state.result;
  if (state.tick === 0) { assignMan(state); assignBlocks(state); }
  state.tick++;

  const play = state.offense, dplay = state.defense;

  // --- receivers run their routes -------------------------------------------------
  for (const a of state.off) {
    if (!a.slot.startsWith('REC')) continue;
    const route = play.routes[a.slot];
    if (!route) continue;
    a.px = a.x; a.py = a.y;
    a.travelled += a.spd;
    const [rx, ry, atEnd] = alongRoute(route, a.travelled);
    // Past the end of a route a receiver keeps drifting upfield rather than freezing,
    // which is what stops zone defenders from parking on a stationary target.
    if (atEnd) { a.x = rx; a.y = ry + (a.travelled - routeLen(route)) * 0.35; }
    else { a.x = rx; a.y = ry; }
    a.done = atEnd;
    a.vx = a.x - a.px; a.vy = a.y - a.py;
  }

  // --- the rush, and the blockers who slow it -------------------------------------
  const qb = find(state.off, 'QB');
  const blockers = state.off.filter((a) => a.slot.startsWith('OL'));
  let pressureThisTick = 0, threatThisTick = 1e9;

  // PURSUIT. The moment the ball is in someone's hands and moving, coverage is over and
  // everyone runs at the football. Without this only the men assigned to rush ever chased
  // a ball carrier -- man defenders stayed glued to receivers who no longer mattered and
  // zone defenders stood on their landmarks -- so a passer who got outside ran untouched
  // to the end zone on a tenth of his scrambles, and every completion was chased by two
  // players instead of seven. It is also simply what this kind of football looks like:
  // when the ball breaks contain, the whole defence swarms it.
  const carrying = find(state.off, state.carrier);
  const swarm = !state.ball && carrying
    && (state.scrambling || state.carrier !== 'QB' || play.kind === 'run');

  for (const d of state.def) {
    const as = dplay.assign[d.slot];
    if (swarm && as !== 'rush') {
      seek(d, carrying.x, carrying.y, 1.0);
      continue;
    }
    if (as === 'rush') {
      // A BLOCK HOLDS, THEN IT LOSES. Not a decaying fraction -- a step. Instrumented,
      // the smooth-decay version had a blocked rusher back to 81% speed by tick 62, so
      // blocked and free rushers arrived together and the rush count changed nothing.
      // What a blocker actually sells is TIME: it keeps its man out for holdTicks (twice
      // that when doubled, longer or shorter by the blk/prs edge), and once beaten the
      // rusher gets back to full speed over BLOCK_RELEASE_TICKS and comes free.
      //
      // Contact still has to be real: a blocker that has lost touch is not blocking, which
      // is what lets a scrambling passer pull the rush away from its help.
      let slow = 1, held = false;
      if (d.blocked) {
        const inReach = blockers.some((x) => x.engaged === d.slot && dist(x.x, x.y, d.x, d.y) < BLOCK_REACH);
        if (inReach) {
          const past = state.tick - d.holdTicks;
          if (past <= 0) { slow = BLOCK_SLOW; held = true; }
          else if (past < BLOCK_RELEASE_TICKS) {
            const t = past / BLOCK_RELEASE_TICKS;
            slow = BLOCK_SLOW + (1 - BLOCK_SLOW) * t;
            held = true;
          }
        }
      }
      // Committed to where the passer WAS. See RUSH_REDIRECT_TICKS.
      if (state.scrambleAt !== undefined && state.tick < state.scrambleAt + RUSH_REDIRECT_TICKS) {
        slow *= RUSH_REDIRECT_SLOW;
      }
      const target = state.carrier === 'QB' ? qb : find(state.off, state.carrier) || qb;
      seek(d, target.x, target.y, slow);
      // WHAT THE PASSER FEELS. A rusher still fighting a block is not the same threat as
      // one running free, and weighting them anywhere near equally is what broke this
      // before: three HELD rushers tripped the flush at tick 66, the passer got a free
      // early throw, and the six-man rush ended up sacking LESS than the two-man rush that
      // could not trip it at all. One free man in the pocket is a flush; three men still
      // being blocked are not.
      const toQb = dist(d.x, d.y, qb.x, qb.y);
      if (toQb < PRESSURE_RADIUS) {
        pressureThisTick += held ? PRESSURE_HELD : PRESSURE_FREE;
      }
      // How close the nearest man who is NOT being blocked has actually got. Pressure says
      // the pocket is dirty; this says he is about to be hit, which is a different
      // decision. Keeping them apart is what stops the passer from abandoning a down that
      // was merely uncomfortable.
      if (!held && toQb < threatThisTick) threatThisTick = toQb;
    } else if (as === 'man' || as === 'press') {
      const r = find(state.off, d.engaged);
      if (r) {
        // Coverage quality is a trailing distance, not a teleport: a better cover man
        // simply sits closer, which is what makes separation emerge rather than be rolled.
        const lag = 0.55 + (60 - Math.max(20, Math.min(99, d.cov))) * 0.012;
        seek(d, r.x, r.y - lag, as === 'press' ? 1.02 : 1.0);
      }
    } else {
      const [zx, zy] = zoneAnchor(as, d);
      // A zone defender breaks on the ball once it is in the air, otherwise holds.
      if (state.ball) seek(d, state.ball.tx, state.ball.ty, 1.0);
      else seek(d, zx, zy, 0.92);
    }
  }
  state.pressure = pressureThisTick;
  state.threat = threatThisTick;

  // --- blockers stay between the rush and the passer -------------------------------
  for (const b of blockers) {
    const mine = b.engaged ? state.def.find((d) => d.slot === b.engaged) : null;
    if (mine) seek(b, (mine.x + qb.x) / 2, (mine.y + qb.y) / 2, 0.95);
  }

  // --- ball in flight ---------------------------------------------------------------
  if (state.ball) {
    const b = state.ball;
    b.travelled += BALL_YPS / TICK_HZ;
    if (b.travelled >= b.len) {
      const rec = find(state.off, b.target);
      const arrivedX = b.tx, arrivedY = b.ty;
      // Contest: whoever is closest to the arrival point, with catching or ball skills
      // deciding a near-tie. Both sides get a fair shot at the same spot.
      let closestDef = null, cd = 1e9;
      for (const d of state.def) {
        const dd = dist(d.x, d.y, arrivedX, arrivedY);
        if (dd < cd) { cd = dd; closestDef = d; }
      }
      const rd = rec ? dist(rec.x, rec.y, arrivedX, arrivedY) : 99;
      if (rd <= CATCH_RADIUS && (cd > rd || state.rng() < rec.cth / 140)) {
        state.carrier = b.target;
        state.ball = null;
        state.events.push({ tick: state.tick, kind: 'catch', slot: b.target });
      } else if (cd <= CATCH_RADIUS && closestDef && state.rng() < closestDef.itc / 260) {
        state.ball = null;
        state.result = RESULT.INTERCEPTION;
        state.yards = Math.round(arrivedY);
        state.events.push({ tick: state.tick, kind: 'interception', slot: closestDef.slot });
        return state.result;
      } else {
        state.ball = null;
        state.result = RESULT.INCOMPLETE;
        state.yards = 0;
        state.events.push({ tick: state.tick, kind: 'incomplete' });
        return state.result;
      }
    }
  }

  // --- carrier: tackle, sack, score ------------------------------------------------
  const car = find(state.off, state.carrier);
  if (car && !state.ball) {
    // A ball carrier who is not the passer runs upfield; the passer holds the pocket
    // until thrown or flushed.
    if (state.carrier !== 'QB') {
      const gap = play.kind === 'run' ? (play.gap || 0) : 0;
      seek(car, car.x + gap * 0.06, car.y + 3, 1.0);
    } else if (play.kind === 'run') {
      seek(car, car.x, car.y + 2, 1.0);
    } else if (state.scrambling) {
      // HE TAKES OFF. A passer with a free rusher on him and nobody to throw to had
      // exactly two futures before this -- get rid of it or die -- and measured over 5184
      // downs that made 21.7% of them sacks and left the median gain on ZERO: the yardage
      // was all-or-nothing because the middle outcome did not exist. Running is the middle
      // outcome, and in this kind of football it is not a last resort, it is an answer.
      //
      // He breaks away from the nearest rusher and heads upfield. This is also the only
      // thing that makes a quarterback's own speed worth anything: until now `spd` on the
      // QB set nothing but the pace of his drop.
      // OUTSIDE FIRST, THEN UPFIELD. He is seven yards deep and the rush is between him
      // and the line, so "run upfield" is a run straight back into it -- which is exactly
      // what the first version told him to do, and it showed: every scramble in 5184 downs
      // ended at the same six-yard loss, median and ninetieth percentile alike, because
      // they were all the same two strides into the same tackler. He beats the edge first
      // and only turns up once nothing is in front of him.
      let near = null, nd = 1e9;
      for (const d of state.def) {
        const dd = dist(d.x, d.y, car.x, car.y);
        if (dd < nd) { nd = dd; near = d; }
      }
      if (state.escapeSide === undefined) {
        state.escapeSide = near && near.x > car.x ? -1 : 1;
      }
      const side = state.escapeSide;
      // Wide first, then up the sideline. He NEVER retreats: letting him give ground while
      // the lane looked shut sent him seventy-five yards backwards on the tenth percentile,
      // because the lane never opened and nothing else ended the down. Getting caught is
      // the acceptable outcome here; running to his own goal line is not.
      const outside = Math.abs(car.x) > 15;
      seek(car, side * 23, car.y + (outside ? 9 : 2), SCRAMBLE_SPEED);
    } else {
      // Drop back, then hold.
      if (car.y > -7) car.y -= car.spd * 0.55;
    }

    for (const d of state.def) {
      const dd = dist(d.x, d.y, car.x, car.y);
      // ANYONE CARRYING IT gets the break-tackle contest below, a scrambling passer
      // included. But a scrambler is not immune to the rush he ran from: dropped BEHIND
      // the line he is sacked, exactly as the rule book has it, and only past the line is
      // it a run. Getting this wrong made the scramble a free escape -- every sack against
      // an all-out rush turned into a tackle for loss and the six-man rush read 0%.
      const running = state.carrier !== 'QB' || play.kind === 'run' || state.scrambling;
      // Classify from the yardage that will actually be REPORTED, not from the raw
      // position. Reading `car.y < 0` while reporting Math.round(car.y) let a scrambler
      // dropped four tenths of a yard short be recorded as a sack for zero yards -- the
      // classification and the number on the screen disagreeing about the same down.
      const gained = Math.round(car.y);
      const isSack = state.carrier === 'QB' && play.kind !== 'run'
        && (!state.scrambling || gained < 0);
      if (dd <= (isSack ? SACK_RADIUS : TACKLE_RADIUS)) {
        // Break-tackle contest: run strength against tackling, one roll, resolved here so
        // a test can pin it.
        const breakChance = Math.max(0, Math.min(0.45, (car.rst - d.tak) / 220));
        if (running && state.rng() < breakChance) {
          state.events.push({ tick: state.tick, kind: 'broken-tackle', slot: d.slot });
          d.x -= (d.x - car.x) * 0.6;
          d.y -= 2.2;
          continue;
        }
        state.yards = gained;
        state.result = isSack ? RESULT.SACK : RESULT.TACKLED;
        state.events.push({ tick: state.tick, kind: isSack ? 'sack' : 'tackle', slot: d.slot });
        return state.result;
      }
    }
    if (car.y >= 40) {
      state.yards = Math.round(car.y);
      state.result = RESULT.TOUCHDOWN;
      return state.result;
    }
    if (Math.abs(car.x) > 24) {
      state.yards = Math.round(car.y);
      state.result = RESULT.OUT_OF_BOUNDS;
      return state.result;
    }
  }

  return RESULT.LIVE;
}

function routeLen(route) {
  let n = 0;
  for (let i = 1; i < route.length; i++) n += Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]);
  return n;
}

/**
 * Arc length to a route's FIRST BREAK -- the first waypoint after the release.
 *
 * This is the number that decides whether a play can beat a blitz, and it comes straight
 * off the play sheet rather than out of a constant: across the eighteen calls it runs from
 * 5.0 yd on the x_cross underneath to 20.1 yd on the hail mary, which at receiver speed is
 * tick 33 against tick 134. An unblocked rusher arrives around tick 48. So the quick game
 * has its hot read before the rush gets there and the deep game does not -- which is the
 * entire reason those are different calls, and it is why the hot read is gated on this and
 * not on a uniform "has run seven yards".
 */
export function firstBreak(route) {
  if (!route || route.length < 2) return 0;
  return Math.hypot(route[1][0] - route[0][0], route[1][1] - route[0][1]);
}

/** Throw to a receiver slot. Returns false if the ball is not the passer's to throw. */
export function throwTo(state, slot) {
  if (state.result !== RESULT.LIVE || state.ball || state.carrier !== 'QB') return false;
  const rec = find(state.off, slot);
  const qb = find(state.off, 'QB');
  if (!rec) return false;
  // Lead the receiver ALONG ITS ROUTE over the ball's flight time.
  //
  // The first version led only downfield (+y), which works for a vertical route and fails
  // for every crosser on the sheet -- and most of this playbook crosses. Measured, it put
  // 87 of 162 play pairs incomplete and made receiver speed irrelevant, because the ball
  // arrived where the receiver had been rather than where it was going.
  //
  // The second led along the receiver's INSTANTANEOUS heading, which is right up until the
  // receiver breaks -- and the faster he is, the further past the break the aim point
  // lands. Measured across the speed range, that showed up as incompletions climbing with
  // speed at the top end: a corps at 99 threw 36% incomplete against 18% for the same
  // routes run at 25, so the sim was punishing its best receivers for being fast.
  //
  // The route is KNOWN, and a receiver is parameterised by arc length along it, so the
  // honest predictor is not an extrapolation at all: advance him along his own route by
  // the distance he will actually cover, breaks included. Two passes converge the flight
  // time against the point that answer produces.
  const route = state.offense.routes && state.offense.routes[slot];
  const at = (ticks) => {
    if (!route) return [rec.x + rec.vx * ticks, rec.y + rec.vy * ticks];
    const t = rec.travelled + rec.spd * ticks;
    const [rx, ry, atEnd] = alongRoute(route, t);
    // Past the last waypoint he drifts upfield, exactly as step() moves him.
    return atEnd ? [rx, ry + (t - routeLen(route)) * 0.35] : [rx, ry];
  };
  let flight = dist(qb.x, qb.y, rec.x, rec.y) / BALL_YPS * TICK_HZ;
  let [tx, ty] = at(flight);
  flight = dist(qb.x, qb.y, tx, ty) / BALL_YPS * TICK_HZ;
  [tx, ty] = at(flight);

  // AND THEN MISS IT, BY AN AMOUNT THE PASSER DECIDES.
  //
  // Solving the route exactly made the ball arrive on the receiver every single time, so
  // the defender could never be closer to it than the man it was thrown to and the catch
  // contest below stopped being a contest -- incompletions collapsed to a tenth of throws.
  // A pass has error. Putting it HERE, on the aim point, rather than as a roll on the
  // catch, is what makes it interact with everything else properly: a wide miss is nearer
  // the defender, so bad throws become interceptions rather than magically becoming
  // incompletions, and coverage that is already close punishes them harder.
  //
  // It is also where the passer's own rating finally enters the simulation. `pas` was
  // being read off the roster and then never consulted by anything -- Mahomes threw the
  // same ball as a third-string quarterback. Error falls with the rating and grows with
  // the length of the throw, which is why the deep calls carry real risk.
  const err = THROW_ERR * (1.25 - qb.pas / 120) * (1 + dist(qb.x, qb.y, tx, ty) / 50);
  tx += (state.rng() * 2 - 1) * err;
  ty += (state.rng() * 2 - 1) * err;
  state.ball = { x: qb.x, y: qb.y, tx, ty, target: slot, travelled: 0, len: dist(qb.x, qb.y, tx, ty) };
  // How open the man was when it left. Recorded rather than recomputed because it is the
  // only evidence that the passer's separation floor is doing anything -- a mutation that
  // removed it entirely went undetected by every outcome-level assertion in the suite.
  let sep = 1e9;
  for (const d of state.def) sep = Math.min(sep, dist(d.x, d.y, rec.x, rec.y));
  state.events.push({ tick: state.tick, kind: 'throw', slot, sep });
  return true;
}

/** When the play's own clock says the read is there, jitter included. */
export function readTick(state) {
  return Math.max(12, (state.offense.clock || 60) + (state.readyJitter || 0));
}

/**
 * ONE TICK, decisions included: the AI passer's choice for this tick, then step().
 *
 * Split out of runPlay() so the renderer can drive the down a tick at a time without
 * re-implementing the passer -- the adapter used to call runPlay(state, tick + 1), which
 * ran one tick and then hit runPlay's own "still live at the cap, call it a tackle"
 * fallback, ending every play on its first frame. One decision path, two callers.
 */
export function advance(state) {
  if (state.result !== RESULT.LIVE) return state.result;
  const readyAt = readTick(state);
  {
    // The AI passer throws when the play's own clock says the read is there, or earlier
    // if the pocket has collapsed. That is what makes a deep play genuinely riskier: it
    // asks the protection to hold for longer.
    if (state.offense.kind !== 'run' && !state.ball && state.carrier === 'QB') {
      // WHAT A FLUSHED PASSER MAY DO, AND WHY IT IS NOT SIMPLY "THROW SOONER".
      //
      // Every earlier version made the flush an unconditional early release, and every one
      // of them broke the same way: because the pocket geometry is the same on all
      // eighteen calls, the flush fires on a fixed tick and beats the rush by a fixed
      // margin, so all eighteen plays land on the same side of it. Instrumented, an
      // all-out rush flushed at tick 37 and the free rusher arrived at 48 -- an eleven
      // tick margin, identical every time, which is why the sack rate could only ever read
      // 0% or 83% and never anything between. Worse, the flush threw at tick 45, EARLIER
      // than the earliest play clock in the book, so the play call stopped mattering at all
      // under pressure.
      //
      // A flush is not a licence to throw. It is a decision to throw IF THERE IS SOMEWHERE
      // TO GO -- the hot read. So the early release is gated on a receiver being genuinely
      // open and genuinely into its route. That hands the outcome back to the play call,
      // which is where it belongs: a call whose routes break early has its hot read and
      // gets rid of it; a call that asks everyone to run deep has none, and the passer
      // wears it. Nothing about that is tuned -- it is the difference between the plays.
      //
      // Recognition is not all post-snap either. More rushers than blockers is something
      // the offence can SEE at the line, so an overload starts the clock at the snap
      // rather than when a rusher is finally three yards away. Without that, an all-out
      // rush and the passer's reaction resolved on a fixed tick against a fixed tick and
      // the play call was cut out of its own down.
      if (state.overload > 0 && state.flushedAt === undefined) state.flushedAt = 0;
      if (state.pressure >= PRESSURE_FLUSH && state.flushedAt === undefined) state.flushedAt = state.tick;
      const reacted = state.flushedAt !== undefined && state.tick >= state.flushedAt + FLUSH_REACT;
      // A PASSER MAY DECLINE. Without this the read tick was a command rather than a
      // decision -- the ball went to the most open receiver at readyAt no matter how
      // covered he was, which made a coverage sack impossible (a two-man rush sacked on
      // exactly 0% of downs however long its blocks held) and threw every interception
      // this sim produced. Holding the ball against good coverage is what turns a
      // well-covered down into a sack or a throwaway instead of a free attempt.
      const read = bestReceiver(state);
      // The rush is home and there is nowhere to go with it: run. Checked before the
      // throw branches, because once he is running he is no longer reading.
      if (!state.scrambling && reacted && state.threat <= SCRAMBLE_TRIGGER
          && !(read.hot && read.hotSep >= HOT_SEP)) {
        state.scrambling = true;
        state.scrambleAt = state.tick;
        state.events.push({ tick: state.tick, kind: 'scramble' });
      }
      if (state.scrambling) { step(state); return state.result; }
      if (state.tick >= readyAt + THROWAWAY_TICKS) {
        // Nobody has come open and the pocket is still standing: bin it and live.
        state.result = RESULT.INCOMPLETE;
        state.yards = 0;
        state.events.push({ tick: state.tick, kind: 'throwaway' });
        return state.result;
      } else if (state.tick >= readyAt) {
        if (read.slot && read.sep >= MIN_THROW_SEP) throwTo(state, read.slot);
      } else if (reacted && read.hot && read.hotSep >= HOT_SEP) {
        throwTo(state, read.hot);
      }
    }
  }
  step(state);
  return state.result;
}

/** Run a play to completion with the same AI passer. Returns the finished state. */
export function runPlay(state, maxTicks) {
  const cap = maxTicks || 600;
  while (state.result === RESULT.LIVE && state.tick < cap) advance(state);
  if (state.result === RESULT.LIVE) {
    const car = find(state.off, state.carrier);
    state.yards = car ? Math.round(car.y) : 0;
    state.result = RESULT.TACKLED;
  }
  return state;
}

/**
 * The most open receiver, with HOW open and how far into its route it is.
 *
 * The separation is what makes a hot read possible; the distance travelled is what stops
 * one being imagined at the snap. Before anyone has run, a receiver on the line is nine
 * yards clear of a safety at depth, so separation alone would call every receiver wide
 * open on tick one.
 */
export function bestReceiver(state) {
  let best = null, bestSep = -1;
  let hot = null, hotSep = -1;
  const routes = state.offense.routes || {};
  for (const r of state.off) {
    if (!r.slot.startsWith('REC')) continue;
    let nd = 1e9;
    for (const d of state.def) nd = Math.min(nd, dist(d.x, d.y, r.x, r.y));
    if (nd > bestSep) { bestSep = nd; best = r.slot; }
    // The HOT read is the most open receiver AMONG THOSE WHO HAVE BROKEN, which is not the
    // same as asking whether the most open receiver happens to have broken. A three-man
    // concept usually sends two deep and keeps one underneath; the deep men are the more
    // open ones early precisely because nobody has got to them yet, so the naive form
    // reported no hot read available on exactly the plays that have one.
    if (r.travelled >= firstBreak(routes[r.slot]) && nd > hotSep) { hotSep = nd; hot = r.slot; }
  }
  return { slot: best, sep: bestSep, hot, hotSep };
}

/** The most open receiver's slot. Kept as the simple form the callers already use. */
export function pickOpenReceiver(state) {
  return bestReceiver(state).slot;
}

export default { createPlay, step, throwTo, runPlay, pickOpenReceiver, RESULT, RESULT_NAME, TICK_HZ };
