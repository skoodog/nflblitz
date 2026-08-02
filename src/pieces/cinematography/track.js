// PIECE cinematography — THE PLAY TRACK. What the director is allowed to know.
//
// A camera that cannot read the play can only frame the middle of the field. This file
// runs the registered simulation once per (seed) and records, at 60 Hz:
//
//   ball[k]      world position of the ball
//   carry[k]     world position of the man holding it (or of the intended receiver while
//                it is in the air)
//   vel[k]       the carrier's velocity, which is what the pursuit and impact recipes
//                stage against
//   events[]     the simulation's OWN event log — throw, catch, tackle, sack, fumble,
//                scramble, broken-tackle, interception, incomplete, throwaway — with the
//                tick each one fired on
//   result       WHICH way the down ended ('tackled', 'sack', 'touchdown', 'out-of-bounds',
//                ...), and `endedAt`, the second it ended. A touchdown is a result and not
//                an event, so without this the camera cannot see a score.
//
// WHY IT RE-RUNS THE SIM INSTEAD OF READING THE SHOT. foundation/scenes.js resolves a
// live spec by running the sim to exactly params.t and freezing the result into the
// ShotSpec. That gives the camera ONE sample: where everything is right now. A camera
// body with inertia needs the HISTORY (it is integrating from t=0), and an editor needs
// the event log with times. So the track is a second, independent run of the same
// deterministic simulation.
//
// IT MUST AGREE WITH scenes.js EXACTLY, and that is a real trap. scenes.js calls
//   REG.sim.create(params.seed, { teamA: 'NYC', teamB: 'CHI' })
// with those two clubs HARD-CODED in foundation. Creating the state with any other opts
// gives a different down — different play call, different men — and the camera would be
// framing a play that is not the one on screen. The literal below is copied from
// scenes.js for that reason and must be kept in step with it.
//
// COST, measured on this box: 600 ticks of play-sim's 14-man step plus 600 snapshots
// takes 12-30 ms, once, at world-build time. It is not on the frame path — the memo is
// keyed by seed and the same track is reused for every accumulation sample of a capture.

import { REG } from '../../foundation/registry.js';

export const TRACK_HZ = 60;
export const TRACK_DT = 1 / TRACK_HZ;
const TRACK_MAX_S = 11.0;
const TRAIL_S = 1.4;          // keep sampling this long after the whistle

/**
 * Beats the editor is allowed to cut on, and how hard each one hits the camera.
 *
 * TWO OF THE SIX RECIPES USED TO BE DEAD CODE IN THE LIVE PATH, and both entries below are
 * the fix. `catch` mapped to `pursuit`, so the money shot of the bar sheet —
 * bar/panel-catch.png, a receiver at full extension — was framed as a trailing wide from
 * behind, and the `catch` recipe (35 deg, f/1.9, aimed at the ball rather than the helmet)
 * never fired on a live down at all. `six` was worse: play-sim emits no `touchdown` EVENT
 * because a touchdown is a RESULT, and build() below read `snap.result` only to decide when
 * to stop sampling — it threw away WHICH result, so the camera could not tell six points
 * from a man stepping out of bounds. The result is now carried on the track and a score
 * synthesises the beat the event log does not contain.
 */
export const BEAT = {
  throw: { shot: 'deep', delay: 0.00, power: 0.0 },
  catch: { shot: 'catch', delay: 0.10, power: 0.30, hold: 0.85 },
  touchdown: { shot: 'six', delay: 0.00, power: 0.60 },
  interception: { shot: 'pursuit', delay: 0.34, power: 0.45 },
  incomplete: { shot: 'pursuit', delay: 0.20, power: 0.20 },
  throwaway: { shot: 'pursuit', delay: 0.20, power: 0.15 },
  scramble: { shot: 'pursuit', delay: 0.06, power: 0.20 },
  'broken-tackle': { shot: 'impact', delay: 0.00, power: 1.30, hold: 0.55 },
  tackle: { shot: 'impact', delay: 0.00, power: 1.00 },
  sack: { shot: 'impact', delay: 0.00, power: 1.55 },
  fumble: { shot: 'impact', delay: 0.00, power: 1.75 },
};

const cache = new Map();

/**
 * build(seed) -> track, memoised. Returns null if the sim slot cannot produce one, in
 * which case the director falls back to staging the ShotSpec's own frozen actors — the
 * camera degrades to a good static frame rather than to a broken one.
 */
export function getTrack(seed) {
  const key = seed | 0;
  if (cache.has(key)) return cache.get(key);
  let tr = null;
  try { tr = build(key); } catch (e) { tr = null; }
  cache.set(key, tr);
  return tr;
}

function build(seed) {
  const sim = REG.sim;
  if (!sim || typeof sim.create !== 'function') return null;
  const state = sim.create(seed, { teamA: 'NYC', teamB: 'CHI' });

  const nMax = Math.ceil(TRACK_MAX_S * TRACK_HZ) + 1;
  const ball = new Float32Array(nMax * 3);
  const carry = new Float32Array(nMax * 3);
  const vel = new Float32Array(nMax * 3);
  let n = 0;
  let events = [];
  let endedAt = -1;
  let result = 'live';

  for (let k = 0; k < nMax; k++) {
    const t = k * TRACK_DT;
    sim.seekTo(state, t);
    const snap = sim.snapshot(state);
    if (!snap) break;

    const b = (snap.ball && snap.ball.pos) || [0, 1.4, 0];
    ball[k * 3] = b[0]; ball[k * 3 + 1] = b[1]; ball[k * 3 + 2] = b[2];

    // The man the shot is about: the sim marks him `hero`. Falling back to the actor
    // nearest the ball keeps this working against the foundation sim fallback, which
    // marks the QB hero for the whole play including after he has thrown it.
    let hero = null;
    let best = 1e9;
    for (let i = 0; i < snap.actors.length; i++) {
      const a = snap.actors[i];
      if (a.hero) { hero = a; break; }
      const dx = a.pos[0] - b[0], dz = a.pos[2] - b[2];
      const d = dx * dx + dz * dz;
      if (d < best) { best = d; hero = a; }
    }
    const hp = hero ? hero.pos : [0, 0, 0];
    carry[k * 3] = hp[0]; carry[k * 3 + 1] = hp[1]; carry[k * 3 + 2] = hp[2];
    if (k > 0) {
      vel[k * 3] = (carry[k * 3] - carry[(k - 1) * 3]) / TRACK_DT;
      vel[k * 3 + 2] = (carry[k * 3 + 2] - carry[(k - 1) * 3 + 2]) / TRACK_DT;
    }
    if (snap.events && snap.events.length > events.length) events = snap.events;
    n = k + 1;

    // CASE MATTERS AND IT COST A WHOLE TRACK. `play-sim`'s RESULT_NAME is lower case
    // ('live', 'tackled', 'sack', ...) while the foundation sim fallback has no `result`
    // field at all. Comparing against 'LIVE' therefore matched NOTHING, every sample
    // looked like the end of the play, and the track was truncated to TRAIL_S = 1.4 s —
    // so every cut after 1.4 s silently never happened. Found by running the editor
    // against the real sim in plain node rather than by looking at a frame, which is the
    // only way a 1.4 s track and an 11 s track look different.
    //
    // AND WHICH RESULT IT WAS MATTERS AS MUCH AS THAT IT ENDED. This test used to discard
    // `snap.result` the instant it had answered "is the play over", which is why the `six`
    // recipe was unreachable: a touchdown is a RESULT in play-sim (RESULT_NAME[5]) and
    // never an entry in the event log, so an editor that only reads events cannot see a
    // score at all. It is kept, and the FIRST tick it appears on is the beat time.
    if (snap.result && String(snap.result).toLowerCase() !== 'live') {
      if (endedAt < 0) { endedAt = t; result = String(snap.result).toLowerCase(); }
      // Keep rolling a little past the whistle so the impact shot has somewhere to settle.
      if (t - endedAt > TRAIL_S) break;
    }
  }
  if (n < 2) return null;
  vel[0] = vel[3]; vel[2] = vel[5];

  // The event log, normalised to seconds and sorted, with the beat table resolved so the
  // director does not have to look anything up per frame.
  const beats = [];
  for (const e of events) {
    const spec = BEAT[e.kind];
    if (!spec) continue;
    const t = e.t !== undefined ? e.t : (e.tick !== undefined ? e.tick / 60 : 0);
    beats.push({ kind: e.kind, t, shot: spec.shot, at: t + spec.delay, power: spec.power, hold: spec.hold || 0 });
  }

  // THE SYNTHETIC SCORE BEAT. There is no `touchdown` event to read, so one is made from
  // the result and the tick it first showed up on. It is the only beat in this file that is
  // not verbatim out of the simulation's own log, and it is here rather than in director.js
  // because "what happened" is the track's job and "when do we cut" is the editor's.
  if (result === 'touchdown' && endedAt >= 0) {
    const spec = BEAT.touchdown;
    beats.push({ kind: 'touchdown', t: endedAt, shot: spec.shot, at: endedAt + spec.delay, power: spec.power, hold: 0 });
  }
  beats.sort((a, b) => a.at - b.at);

  // LINE OF SCRIMMAGE, taken from where the ball actually starts. The offence attacks
  // -X (contracts.js), so "past the line" means x < los. Used by the director to leave
  // the pocket on a run or a draw, which fire no `scramble` event at all — a purely
  // event-driven editor sits on the pocket shot through an entire running play, which is
  // exactly what the first version of this piece did.
  const los = ball[0];

  return {
    seed, n, ball, carry, vel, beats, los, result,
    endedAt: endedAt < 0 ? -1 : endedAt,
    endT: (n - 1) * TRACK_DT,
  };
}

/** Sample a Float32Array triple track at continuous time, clamped at both ends. */
export function sample(out, arr, n, t) {
  let f = t / TRACK_DT;
  if (!(f > 0)) f = 0;
  if (f > n - 1) f = n - 1;
  const i = Math.floor(f);
  const j = i + 1 < n ? i + 1 : i;
  const u = f - i;
  out[0] = arr[i * 3] + (arr[j * 3] - arr[i * 3]) * u;
  out[1] = arr[i * 3 + 1] + (arr[j * 3 + 1] - arr[i * 3 + 1]) * u;
  out[2] = arr[i * 3 + 2] + (arr[j * 3 + 2] - arr[i * 3 + 2]) * u;
  return out;
}

export default { getTrack, sample, BEAT, TRACK_DT, TRACK_HZ };
