// PIECE game-flow — THE GAMEPLAY CAMERA.
//
// WHY THIS EXISTS, and it is not because the cinematography piece is wrong.
//
// `cinematography` is a DIRECTOR: it precomputes a whole down into a track, builds a cut
// list from the sim's event log, and stages each cut with a spring-damped body. That is
// the right machine for a replay and for every captured still in this project, and it is
// the machine the hero frames were shot with. It is the wrong machine for a down that is
// being played RIGHT NOW, for one structural reason: it needs the future. `cutList()`
// walks the beats of a completed play to decide where the cuts land, and `getTrack(seed)`
// builds that track by simulating a down of its own from `sim.create(seed)`.
//
// In play mode that produced exactly the failure this file was written to end. The
// director framed a PHANTOM down -- seed 7, NYC against CHI, a play nobody was playing --
// while the player's actual down happened somewhere off-camera. The screen showed an
// empty patch of grass and the lower bowl of the stadium, and it did so smoothly and
// confidently, which is why it read as "the game is broken" rather than "the camera is
// looking the wrong way". A live camera may only ever use the past and the present.
//
// WHAT A BLITZ CAMERA IS. Behind the offence, high enough to read the whole route
// concept, tilted down about 23 degrees, looking downfield. It tracks the ball, leads it
// downfield so the player sees where he is going rather than where he has been, and it
// gives ground laterally more slowly than the ball moves so a jitter in the carrier's
// path is not a jitter in the frame. It does not cut. It does not shake. It never loses
// the ball, because a camera that loses the ball in an arcade football game has taken the
// game away from the player.
//
// AXES, from adapt.js: world.x = -sim.y (the offence attacks -x) and world.z = sim.x
// (across the field). So "behind the offence" is +x from the ball, and the target is
// downfield at -x.

/* ------------------------------------------------------------------- framing */

/** Sideline, in metres from the centre line. 160 ft / 2 = 26.667 yd. Stated, not imported:
 *  a piece owns its own directory, and one constant is not worth a cross-piece edge. */
const HALF_W = 24.384;

/** Metres behind the ball, along +x. */
const BACK = 12.5;
/** Camera height. 8 m over a 12.5 m stand-off is a 33 degree depression to the ball. */
const HEIGHT = 8.0;
/** How far downfield of the ball the camera looks. This is what puts the routes on screen. */
const AHEAD = 9.0;
/** Aim height, roughly a receiver's shoulders. */
const AIM_Y = 1.7;
const FOV = 42;

/**
 * Lateral give. The camera moves 0.62 m across for every metre the ball moves across, so
 * a runner cutting between the hashes stays inside the frame without the frame chasing
 * him. At 1.0 the picture swims; at 0 the ball leaves the frame on a wide route.
 */
const LATERAL = 0.72;
/**
 * The far end of that give, in metres either side of centre. The field is 24.384 m to a
 * sideline, so 9 m keeps both sidelines in shot at every legal ball position.
 */
const LATERAL_CLAMP = 9.0;

/** Downfield clamp, so the camera never sits behind the back of the end zone. */
const X_MIN = -62.0;
const X_MAX = 62.0;

/* ---------------------------------------------------------------- smoothing */

/**
 * Critically-damped follow, expressed as a per-second half-life so it is frame-rate
 * invariant: the same down looks the same at 60 Hz and at 30 Hz. Position is slower than
 * aim, which is what makes the camera feel like it is being carried rather than driven.
 */
const HL_POS = 0.16;
const HL_AIM = 0.11;

/** Distance, in metres, past which the camera teleports instead of travelling. */
const CUT_DIST = 22.0;

function damp(cur, goal, hl, dt) {
  if (hl <= 0) return goal;
  // 2^(-dt/hl): exact half-life decay, no exponential-of-a-frame-rate approximation.
  const k = Math.pow(2, -dt / hl);
  return goal + (cur - goal) * k;
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

export function createCamera() {
  return {
    ready: false,
    px: 0, py: HEIGHT, pz: 0,
    tx: 0, ty: AIM_Y, tz: 0,
    /** The play this camera is following. A change is a cut, not a pan. */
    key: null,
  };
}

/**
 * Where the camera wants to be for a given snapshot.
 *
 * THE ANCHOR IS NOT SIMPLY THE BALL. A ball in flight travels forty yards in under a
 * second; anchoring on it makes the camera lunge downfield and leaves the player's own
 * man behind at the exact moment he is deciding whether to throw. So the anchor is the
 * BALL CARRIER while there is one, and while the ball is in the air it is the MIDPOINT of
 * the ball and the man who threw it, weighted toward the ball as the throw completes.
 * Both ends of the pass are then on screen, which is the only framing in which a player
 * can judge a catch.
 */
function anchor(snap, out) {
  const b = snap.ball;
  const held = b && b.held;
  let ax = 0, az = 0;
  if (held) {
    const man = snap.actors.find((a) => a.id === held);
    ax = man ? man.pos[0] : b.pos[0];
    az = man ? man.pos[2] : b.pos[2];
  } else if (b) {
    // In flight. `hero` is the man the sim says the shot is about.
    const hero = snap.actors.find((a) => a.hero);
    if (hero) {
      ax = (b.pos[0] + hero.pos[0]) * 0.5;
      az = (b.pos[2] + hero.pos[2]) * 0.5;
    } else { ax = b.pos[0]; az = b.pos[2]; }
  }
  out[0] = ax; out[1] = az;
  return out;
}

const _a = [0, 0];

/**
 * step(cam, snap, dt, key) — advance one frame and write pos/target into `cam`.
 *
 * `key` identifies the down. When it changes the camera cuts rather than travelling
 * across the field, because a two-second pan back to the new line of scrimmage is two
 * seconds in which the player cannot see his own team.
 */
export function step(cam, snap, dt, key) {
  if (!snap || !snap.actors || !snap.actors.length) return cam;
  anchor(snap, _a);
  const ax = clamp(_a[0], X_MIN, X_MAX);
  const az = clamp(_a[1] * LATERAL, -LATERAL_CLAMP, LATERAL_CLAMP);

  const gpx = ax + BACK, gpz = az;
  const gtx = ax - AHEAD, gtz = az;

  const cut = !cam.ready || key !== cam.key
    || Math.abs(gpx - cam.px) > CUT_DIST;
  if (cut) {
    cam.px = gpx; cam.py = HEIGHT; cam.pz = gpz;
    cam.tx = gtx; cam.ty = AIM_Y; cam.tz = gtz;
    cam.ready = true;
    cam.key = key;
    return cam;
  }

  const d = dt > 0.25 ? 0.25 : dt < 0 ? 0 : dt;
  cam.px = damp(cam.px, gpx, HL_POS, d);
  cam.pz = damp(cam.pz, gpz, HL_POS, d);
  cam.py = HEIGHT;
  cam.tx = damp(cam.tx, gtx, HL_AIM, d);
  cam.tz = damp(cam.tz, gtz, HL_AIM, d);
  cam.ty = AIM_Y;
  return cam;
}

/** Apply to a THREE.PerspectiveCamera. The only three.js this file touches. */
export function apply(cam, camera) {
  camera.fov = FOV;
  camera.position.set(cam.px, cam.py, cam.pz);
  camera.up.set(0, 1, 0);
  camera.lookAt(cam.tx, cam.ty, cam.tz);
  camera.near = 0.25;
  camera.far = 400;
  camera.updateProjectionMatrix();
}

export const TUNING = {
  BACK, HEIGHT, AHEAD, AIM_Y, FOV, LATERAL, LATERAL_CLAMP,
  HL_POS, HL_AIM, CUT_DIST, HALF_W,
};

export default { createCamera, step, apply, TUNING };
