// PIECE cinematography — THE EDITOR. What we are looking at, and when we cut.
//
// TWO DECISIONS, KEPT SEPARATE ON PURPOSE:
//   1. cutList(track)   WHICH shot is live at each moment. Pure editorial. Runs once per
//                       play, not per frame, because an edit is a property of the down.
//   2. stageAt(...)     WHERE the camera for that shot goes at time t. Pure geometry.
// Mixing the two is how you end up with a camera that "cuts" every time the subject
// moves, which is the single most common failure of an automatic sports camera.
//
// -------------------------------------------------------------- CUTS LAND ON BEATS
// Every cut in this file is triggered by an entry in the simulation's own event log — a
// throw, a catch, a sack, a broken tackle — or by the ball carrier crossing the line of
// scrimmage. There is no timer anywhere. Two rules keep that from turning into a stutter:
//
//   MIN_HOLD (0.50 s)  a beat of EQUAL OR LOWER priority than the shot already running is
//                      ignored unless the current shot has been on screen this long.
//   PRIORITY           a HIGHER-priority beat cuts immediately regardless. Priorities are
//                      in language.js: six 5 > impact 4 > deep 3 = catch 3 > pursuit 2 >
//                      pocket 1. The arcade rule is that the hit is always the story, so a
//                      tackle interrupts anything, including a cut made 80 ms earlier — and
//                      the one thing that outranks the hit is six points.
//
// MEASURED, not asserted. The editor was run against the real play-sim in plain node
// (no browser, no renderer) over 20 seeds; these are its actual outputs after round 2
// (`catch` and `six` were unreachable before it — see track.js BEAT):
//
//   seed 7   sack.      0.00 pocket -> 0.68 pursuit (scramble@0.62) -> 1.78 impact (sack)
//   seed 5   tackled.   0.00 pocket -> 0.65 deep (throw) -> 1.30 impact (tackle)
//            catch and tackle both fire on tick 77. The catch wants `catch` (prio 3) and
//            the tackle wants `impact` (prio 4); the tackle wins on the same tick. That is
//            the priority rule doing the job it exists for, and it is why the catch shot
//            only survives on downs where the receiver is not hit as he takes it.
//   seed 12  tackled — A RUN, no throw and no scramble at all.
//            0.00 pocket -> 0.20 pursuit (LINE-OF-SCRIMMAGE CROSS) -> 1.10 impact (tackle)
//            Without the geometric beat below, this down would be one static pocket shot
//            from the snap to the whistle.
//   seed 3   tackled.   0.00 pocket -> 0.53 deep -> 1.18 pursuit -> 1.28 CATCH -> 1.43
//            impact -> 2.13 pursuit. The full grammar on one down.
//   seed 16  TOUCHDOWN. 0.00 pocket -> 0.72 pursuit (scramble) -> 7.25 SIX. The score beat
//            is synthesised in track.js from `snap.result`, because play-sim has no
//            touchdown EVENT to cut on.
//
// ACROSS THOSE 20 SEEDS, 4732 live frames at 60 Hz: pocket 1235, pursuit 1837, deep 617,
// impact 842, six 172, catch 29. The catch count is small and honest — of 7 downs with a
// completion, 4 have the tackle on the SAME TICK as the catch and a fifth 30 ms later.
//
// ------------------------------------------------------- WHAT IT REFUSES TO KNOW
// The editor is CAUSAL: it only ever looks at beats whose time is <= now. It would be
// trivial to cheat — the whole track is precomputed — and cutting to the impact shot 200
// ms BEFORE the hit would look better. It is not done, because the same code has to run
// in the live game where the future does not exist, and a camera language that only works
// on replays is not a camera language. The one exception is documented at `focus`.

import { RECIPES, orbitStage, pushOffAxis, DEG } from './language.js';
import { sample, TRACK_DT, JUMP_M } from './track.js';

const MIN_HOLD = 0.50;

/** Shot ids as integers, so motion.js can compare them inside a Float64Array. */
export const SHOT_ID = { pocket: 0, pursuit: 1, deep: 2, impact: 3, catch: 4, six: 5 };
export const SHOT_NAME = ['pocket', 'pursuit', 'deep', 'impact', 'catch', 'six'];

/* --------------------------------------------------------------- the cut list */

/**
 * Build the ordered list of cuts for a whole down. Memoised on the track object.
 * Each entry: { t, shot, az, sub:[x,y,z], roll } — `az` and `sub` are FROZEN AT THE CUT
 * for the impact shot, because a tackled runner's velocity collapses to zero within three
 * ticks and an azimuth derived from it live would swing the camera around the body while
 * it is being hit.
 */
export function cutList(track) {
  if (track._cuts) return track._cuts;

  const scratch = [0, 0, 0];
  const merged = [];

  // The sim's own beats.
  for (const b of track.beats) merged.push({ at: b.at, t: b.t, shot: b.shot, hold: b.hold });

  // THE LINE-OF-SCRIMMAGE BEAT, which is not in the event log and has to be read off the
  // geometry. A run or a QB draw fires no `scramble` and no `throw`, so a purely
  // event-driven editor sits on the pocket shot for the entire play. That was this
  // piece's first bug and it is why the fallback's single wide shot looked no worse than
  // the first version of this one: on a running down they were the same shot.
  // The offence attacks -X (contracts.js), so past the line is x < los.
  for (let k = 1; k < track.n; k++) {
    if (track.carry[k * 3] < track.los - 1.2) {
      merged.push({ at: k * TRACK_DT, t: k * TRACK_DT, shot: 'pursuit', hold: 0 });
      break;
    }
  }

  // Scheduled returns out of a held shot (a broken tackle is a punctuation mark, not a
  // destination).
  for (const b of track.beats) {
    if (b.hold) merged.push({ at: b.at + b.hold, t: b.t, shot: 'pursuit', hold: 0, ret: true });
  }

  merged.sort((a, b) => a.at - b.at);

  const cuts = [makeCut(track, 0, 'pocket', scratch)];
  let cur = 'pocket';
  let lastCut = 0;

  for (const b of merged) {
    if (b.shot === cur) continue;
    const prio = RECIPES[b.shot].prio;
    const curPrio = RECIPES[cur].prio;
    if (prio <= curPrio && b.at - lastCut < MIN_HOLD) continue;
    // A CUT WITH NO FRAMES IN IT IS NOT A CUT. play-sim fires the catch and the tackle on
    // the same tick on 4 of the 7 completions in the first 20 seeds; the catch beat wins
    // the sort and the tackle then out-ranks it on the same timestamp, which used to leave
    // a zero-length `catch` entry in the list that nothing could ever render. Overwrite it
    // instead, so the list is the edit rather than a log of what was considered.
    const prev = cuts[cuts.length - 1];
    if (prev && Math.abs(prev.t - b.at) < 1e-9) cuts[cuts.length - 1] = makeCut(track, b.at, b.shot, scratch);
    else cuts.push(makeCut(track, b.at, b.shot, scratch));
    cur = b.shot;
    lastCut = b.at;
  }

  track._cuts = cuts;
  return cuts;
}

/**
 * THE POSSESSION FLIP, and it cost the flagship shot its subject.
 *
 * `track.carry` is the man holding the ball, and on the tick a pass is caught that is a
 * DIFFERENT MAN twenty metres away. On seed 5 the catch and the tackle fire on the same
 * tick; the impact cut sampled `carry` at exactly that tick, got the QB at x=+7.0, and
 * staged the hit around a man 17 m behind the one being hit. Measured: the impact camera
 * sat 18.7 m from the actual hero for the whole shot, on a recipe authored at 3.9 m.
 *
 * So the subject is sampled 50 ms AFTER the beat — the hit shot is about the aftermath
 * anyway — and the heading is taken from the last sample walking backwards that is both
 * CONTINUOUS with that subject and moving at a plausible football speed. A discontinuity in
 * `carry` shows up in `vel` as a ~1000 m/s spike, so "plausible" is all the test needs.
 */
const SUB_LAG = 3 * TRACK_DT;      // 50 ms
const HEAD_SCAN = 0.40;            // how far back to look for a usable heading

function headingAt(track, tS, sub, out) {
  for (let dt = 0; dt <= HEAD_SCAN; dt += TRACK_DT) {
    sample(out, track.carry, track.n, tS - dt, JUMP_M);
    const gap = Math.hypot(out[0] - sub[0], out[2] - sub[2]);
    if (gap > 9) break;            // walked back past a change of possession
    sample(out, track.vel, track.n, tS - dt);
    const sp = Math.hypot(out[0], out[2]);
    if (sp > 0.4 && sp < 16) return sp;
  }
  out[0] = 0; out[2] = 0;
  return 0;
}

function makeCut(track, t, shot, scratch) {
  const c = { t, shot, id: SHOT_ID[shot], az: 0, roll: 0, sub: [0, 0, 0], speed: 0 };
  sample(c.sub, track.carry, track.n, t + SUB_LAG, JUMP_M);
  const sp = headingAt(track, t + SUB_LAG, c.sub, scratch);
  const vx = scratch[0], vz = scratch[2];
  c.speed = sp;
  if (shot === 'impact') {
    // BROADSIDE. A hit shot down the axis of the collision is two men overlapping.
    // Rotate the runner's heading by +-90 and keep whichever puts the camera nearer the
    // near touchline (az closer to 0), because that is the side the crowd and the key
    // light are on and it is where the game is watched from.
    const head = sp > 0.4 ? Math.atan2(vx, vz) : Math.PI * 0.5;
    const a = wrap(head + Math.PI * 0.5);
    const b = wrap(head - Math.PI * 0.5);
    c.az = Math.abs(a) <= Math.abs(b) ? a : b;
    // The frame tips the way the body is thrown: roll signed by which way the runner
    // crosses the camera.
    c.roll = (Math.abs(a) <= Math.abs(b) ? 1 : -1) * RECIPES.impact.rollDeg;
  }
  return c;
}

function wrap(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** The cut in force at time t, and how long it has been running. */
export function cutAt(cuts, t) {
  let i = 0;
  for (let j = 0; j < cuts.length; j++) { if (cuts[j].t <= t + 1e-9) i = j; else break; }
  return cuts[i];
}

/** Total impact shake envelope at time t, from every beat that has already fired. */
export function shakeAt(track, t, shakeFn) {
  let s = 0;
  for (const b of track.beats) {
    if (b.t > t) break;
    if (b.power > 0) s += shakeFn(t - b.t, b.power);
  }
  return s;
}

/* ------------------------------------------------------------------- staging */

const _sub = [0, 0, 0];
const _ball = [0, 0, 0];
const _ballPrev = [0, 0, 0];
const _vel = [0, 0, 0];
const _out = { pos: [0, 0, 0], target: [0, 0, 0], fov: 38, roll: 0, dist: 10 };

/** Keep the camera on the near half of the field. See language.js azimuth convention. */
const AZ_CLAMP = 105 * DEG;

/** Downfield is -X (contracts.js). Reused as the "open the frame that way" preference. */
const DOWNFIELD = [-1, 0];
const _prefer = [0, 0];

/**
 * stageAt(track, cut, t, out, aspect) — where the camera for `cut.shot` belongs at time t.
 * Writes out.pos / out.target / out.fov / out.roll / out.dist.
 */
export function stageAt(track, cut, t, out, aspect) {
  const R = RECIPES[cut.shot];
  sample(_sub, track.carry, track.n, t, JUMP_M);
  sample(_ball, track.ball, track.n, t, JUMP_M);
  sample(_vel, track.vel, track.n, t);
  // The top of the subject: a 1.88 m man's helmet crown is 1.75 m above his feet, and his
  // feet are wherever the sim put his root. This is what `topAt` composes against.
  const topY = _sub[1] + 1.75;

  if (cut.shot === 'pocket') {
    // Behind the passer (+X, since the offence attacks -X) swung toward the near
    // touchline so we see PAST him rather than at the back of his helmet.
    const az = clampAz(Math.PI * 0.5 - R.side);
    orbitStage(out, _sub, az, {
      fov: R.fov, fill: R.fill, height: R.height, topY, topAt: R.topAt,
    });
    pushOffAxis(out, _sub, R.offAxis, aspect, DOWNFIELD);
    out.roll = 0.8;
    return out;
  }

  if (cut.shot === 'pursuit') {
    const sp = Math.hypot(_vel[0], _vel[2]);
    // Trail the runner. Below walking pace his heading is noise, so fall back to
    // "behind him downfield" rather than letting the camera spin.
    const trail = sp > 1.2 ? Math.atan2(-_vel[0], -_vel[2]) : Math.PI * 0.5;
    const az = clampAz(towardNearside(trail, R.side));
    orbitStage(out, _sub, az, {
      fov: R.fov, fill: R.fill, height: R.height, topY, topAt: R.topAt,
    });
    // Open the frame the way he is running.
    if (sp > 1.2) { _prefer[0] = _vel[0] / sp; _prefer[1] = _vel[2] / sp; }
    else { _prefer[0] = DOWNFIELD[0]; _prefer[1] = DOWNFIELD[1]; }
    pushOffAxis(out, _sub, R.offAxis, aspect, _prefer);
    // Lean into the turn: roll tracks the runner's LATERAL velocity, which is the one
    // thing about a cut-back that a fixed roll cannot express.
    out.roll = clamp(-2.8 * (sp > 1.2 ? _vel[2] / sp : 0), -3.6, 3.6);
    return out;
  }

  if (cut.shot === 'deep') {
    // The camera flies behind the ball. Its heading comes from the ball's own motion, so
    // a crossing route and a go route are not the same shot.
    sample(_ballPrev, track.ball, track.n, Math.max(0, t - 0.08), JUMP_M);
    const bvx = _ball[0] - _ballPrev[0], bvz = _ball[2] - _ballPrev[2];
    const bsp = Math.hypot(bvx, bvz);
    const trail = bsp > 0.05 ? Math.atan2(-bvx, -bvz) : Math.PI * 0.5;
    const az = clampAz(towardNearside(trail, R.side));
    // PUSH IN AS IT TRAVELS. Elapsed-time ramp, not a ramp toward the (unknown) arrival:
    // the editor is causal, see the header.
    const u = clamp((t - cut.t) / 1.05, 0, 1);
    const fill = R.fill + (0.16 * u);
    // The ball sits at topAt (0.30, the upper third) rather than dead centre — the frame
    // has to have room for the men running under it.
    orbitStage(out, _ball, az, {
      fov: R.fov, fill, subjectH: R.subjectH,
      // The camera rises with the ball, but at 0.28 of its height rather than 0.45: at
      // 0.45 a ball peaking at 6 m put the lens at 3.8 m, and a camera ABOVE a ball in
      // flight looks down at the grass under it — measured horizon 22%, the worst in the
      // language. Rising less than the ball is what keeps the shot pointed up.
      height: Math.max(R.height, _ball[1] * 0.28 + 0.90),
      topY: _ball[1], topAt: R.topAt,
    });
    out.roll = 1.1;
    return out;
  }

  if (cut.shot === 'impact') {
    // Staged on the FROZEN azimuth and subject captured at the beat; see makeCut.
    orbitStage(out, cut.sub, cut.az, {
      fov: R.fov, fill: R.fill, height: R.height,
      topY: cut.sub[1] + 1.75, topAt: R.topAt,
    });
    pushOffAxis(out, cut.sub, R.offAxis, aspect, DOWNFIELD);
    out.roll = cut.roll;
    return out;
  }

  if (cut.shot === 'catch') {
    // FROM DOWNFIELD, LOOKING BACK UP THE FIELD AT HIM. The offence attacks -X, so a camera
    // at -X of the receiver has him coming toward the lens and his face and his hands
    // toward us, which is bar/panel-catch.png. Behind him it would be a number on a back.
    const az = clampAz(-Math.PI * 0.5 + R.side);
    // AND IT AIMS AT THE BALL, not at his helmet. Every other recipe composes against
    // subject + 1.75; a receiver at full extension has the ball a good half metre above
    // that, and composing against the helmet is what put this shot's horizon at 23% on the
    // live path while the hero panel — which passed topY by hand — sat at 71%.
    const reach = _sub[1] + (R.reachY || 2.25);
    orbitStage(out, _sub, az, {
      fov: R.fov, fill: R.fill, height: R.height,
      topY: Math.max(_ball[1], reach), topAt: R.topAt,
    });
    pushOffAxis(out, _sub, R.offAxis, aspect, DOWNFIELD);
    out.roll = R.rollDeg || 0;
    return out;
  }

  if (cut.shot === 'six') {
    // FROM INSIDE THE END ZONE. Downfield is -X, so the end zone the runner is crossing
    // into is at -X of him and the camera belongs there, swung 32 degrees to the near
    // touchline so the goal line, the paint and the man are one image. Rolled the opposite
    // way from `impact` so a score never reads as a collision.
    const az = clampAz(-Math.PI * 0.5 + R.side);
    orbitStage(out, _sub, az, {
      fov: R.fov, fill: R.fill, height: R.height, topY, topAt: R.topAt,
    });
    // Open the frame BACK UP THE FIELD, toward the men he beat, rather than downfield into
    // empty paint.
    _prefer[0] = 1; _prefer[1] = 0;
    pushOffAxis(out, _sub, R.offAxis, aspect, _prefer);
    out.roll = R.rollDeg || 0;
    return out;
  }

  // Anything unrecognised degrades to a near-sideline stage on the recipe rather than
  // throwing; a camera piece that throws takes the whole capture down with it.
  orbitStage(out, _sub, clampAz(Math.PI * 0.5 - R.side), {
    fov: R.fov, fill: R.fill, height: R.height, topY, topAt: R.topAt,
  });
  pushOffAxis(out, _sub, R.offAxis, aspect, DOWNFIELD);
  out.roll = R.rollDeg || 0;
  return out;
}

/**
 * Where the lens is focused at time t.
 *
 * THE BALL, split with the man carrying it. While the ball is held those two distances are
 * the same number and this is just "focus the ball". While it is in the air they are not,
 * and the harmonic mean is the plane at which both have the same circle of confusion —
 * defocus is linear in dioptres, so the harmonic mean and not the arithmetic one. That is
 * what keeps a thrown ball AND the receiver it is going to both readable through a flight
 * the deep recipe shoots at f/2.8.
 */
export function focusAt(track, t, camPos) {
  sample(_ball, track.ball, track.n, t, JUMP_M);
  sample(_sub, track.carry, track.n, t, JUMP_M);
  const db = Math.hypot(_ball[0] - camPos[0], _ball[1] - camPos[1], _ball[2] - camPos[2]);
  const dh = Math.hypot(_sub[0] - camPos[0], _sub[1] + 1.25 - camPos[1], _sub[2] - camPos[2]);
  if (db < 0.3) return Math.max(0.6, dh);
  if (dh < 0.3) return Math.max(0.6, db);
  return Math.max(0.6, 2 * db * dh / (db + dh));
}

function clampAz(a) {
  a = wrap(a);
  if (a > AZ_CLAMP) return AZ_CLAMP;
  if (a < -AZ_CLAMP) return -AZ_CLAMP;
  return a;
}

/** Rotate an azimuth `side` radians toward the near touchline (az = 0), never past it. */
function towardNearside(a, side) {
  a = wrap(a);
  if (Math.abs(a) <= side) return 0;
  return a > 0 ? a - side : a + side;
}

function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

export { _out as stageScratch };
export default { cutList, cutAt, stageAt, focusAt, shakeAt, SHOT_ID, SHOT_NAME };
