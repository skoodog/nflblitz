// PIECE cinematography — THE GRAMMAR. Every camera in this game is one of six
// staging recipes plus a lens, and this file is the whole vocabulary.
//
// WHY A SOLVER AND NOT A TABLE OF HAND-PLACED CAMERAS. A table cannot follow a play.
// The live director has to stage a shot around a ball carrier who is somewhere
// different every tick, and the ten hero panels have to be staged by THE SAME rules or
// the game reads as ten unrelated renders. So the unit of authorship here is
// "recipe + subject", never "position + target", and `orbitStage()` turns the pair into
// a camera. The hero panels in index.js call this solver exactly the way the live
// director does; that is the only reason they look like the same film.
//
// ------------------------------------------------------------------ THE MEASUREMENT
// Every number below was set from the bar sheet in bar/, by measuring how tall the hero
// stands in the frame and where his head and feet sit. Read off bar/panel-truck.png,
// bar/panel-touchdown.png and bar/panel-catch.png at 1920x1080:
//
//   panel-truck      hero spans ~8%..95% of frame height   -> fill ~0.87 (but that hero
//                                                              is mid-stride and leaning,
//                                                              a standing man is ~0.62)
//   panel-touchdown  hero spans ~14%..86%                  -> fill ~0.72
//   panel-catch      hero spans ~10%..92%, ball at ~6%     -> fill ~0.80
//   panel-qb_dropback QB spans ~18%..100%, ~30% of width   -> over-the-shoulder, ~2.8 m
//   horizon (crowd/turf boundary) sits at 40%..62% down the frame in all five in-game
//   panels, i.e. THE CAMERA IS BELOW CHEST HEIGHT AND LOOKING SLIGHTLY UP.
//
// WHAT THAT COST US, measured. The foundation fallback stages `truck` at 7.28 m from the
// hero on a 36 degree lens. Frame height at 7.28 m is 2*7.28*tan(18) = 4.73 m, so a
// 1.88 m player fills 0.40 of the frame — less than half the bar. Confirmed against
// shots/character-anatomy/truck.png, where the ball carrier occupies about 45% of the
// frame height and the composition reads as a wide, neutral, broadcast frame. The bar is
// not a broadcast frame. Every recipe here is therefore built around a FILL FRACTION
// rather than a distance, and the distance falls out of the lens.

export const DEG = Math.PI / 180;

/** A 1.88 m actor, the contract's reference height (contracts.js: hip at Y=0.98). */
export const ACTOR_H = 1.88;

/**
 * orbitStage — the one staging primitive.
 *
 * Places the camera on a circle around `subject` at the azimuth given, at the distance
 * that makes a man of `subjectH` fill `fill` of the frame height on a `fov` lens.
 *
 *   frameH(D) = 2 * D * tan(fov/2)      ->      D = subjectH / (2 * fill * tan(fov/2))
 *
 * AZIMUTH is measured in world space as atan2(dx, dz) of the CAMERA-FROM-SUBJECT
 * direction, so az=0 puts the camera on the near touchline side (+Z, the camera side per
 * contracts.js) and az=+PI/2 puts it toward the right sideline (+X). The offence attacks
 * -X, so "behind the ball carrier on a downfield run" is az near +PI/2.
 *
 * `aimY` is the height of the look-at point, and it is the composition control: aiming at
 * the chest (1.30) puts a standing man's head at ~20% from the top and his feet at ~93%
 * down, which is the bar's framing. Aiming at the head flattens him into the middle.
 *
 * `lead` is a world-space offset added to the look-at point only — used to push the
 * subject off-centre and open the frame in the direction he is going, which is what makes
 * the pursuit shot read as motion rather than as a portrait.
 */
export function orbitStage(out, subject, azimuth, o) {
  const fov = o.fov;
  const fill = o.fill;
  const subjectH = o.subjectH !== undefined ? o.subjectH : ACTOR_H;
  const aimY = o.aimY !== undefined ? o.aimY : 1.30;
  const height = o.height;

  const dist = subjectH / (2 * fill * Math.tan(fov * 0.5 * DEG));
  // The circle is horizontal, so the slant range asked for has to lose the rise first.
  // Guarded at 0.6 m so a camera asked for an impossible height still gets a real frame
  // instead of a NaN.
  const dy = height - aimY;
  const horiz = Math.sqrt(Math.max(0.36, dist * dist - dy * dy));

  const s = Math.sin(azimuth), c = Math.cos(azimuth);
  out.pos[0] = subject[0] + s * horiz;
  out.pos[1] = height;
  out.pos[2] = subject[2] + c * horiz;

  const lead = o.lead;
  out.target[0] = subject[0] + (lead ? lead[0] : 0);
  out.target[1] = aimY + (lead ? lead[1] : 0);
  out.target[2] = subject[2] + (lead ? lead[2] : 0);

  out.fov = fov;
  out.roll = o.roll || 0;
  out.dist = dist;
  return out;
}

/* ------------------------------------------------------------------- recipes */
//
// SIX SHOTS. Each one exists because a different moment of a down is illegible in the
// others, and each carries its own LENS, not just its own position — that is the whole
// point of calling this a camera language rather than a set of camera positions.
//
//  fill     how much of the frame height a 1.88 m man occupies
//  height   camera height in metres (all of them are below chest height; see MEASUREMENT)
//  aimY     height of the look-at point
//  fov      VERTICAL fov, degrees (three.js convention)
//  fStop    aperture; small = shallow = the crowd dissolves
//  bokeh    artistic multiplier on the aperture, see index.js apertureOffset()
//  shutter  motion-blur arc for the accumulation pass, in seconds
//  stiff    spring constant of the camera body in motion.js — a big number is a locked
//           tripod, a small one is a heavy operator who lags and overshoots
//  hand     handheld amplitude multiplier
//  prio     editorial priority; a higher-priority beat may cut away from a lower one
//           before the minimum hold has elapsed. The hit always wins.

export const RECIPES = {
  /**
   * POCKET — over the passer's shoulder, from behind and to his throwing side.
   * The bar for this is bar/panel-qb_dropback.png: the QB owns the left third with his
   * back to us, and the whole field, the routes and the rush open up past him.
   *
   * WHY IT IS NOT A "FILL" SHOT. Framing the passer to a fill fraction frames the passer
   * and nothing else, and the pocket is not about the passer — it is about who is coming
   * free. So the look-at point is pushed 6.4 m DOWNFIELD of him: he ends up large and
   * off-centre at the frame edge, and the geometry of the rush is the subject. Measured
   * on the panel, the QB's helmet sits at 22% from the top and 38% across.
   */
  pocket: {
    fov: 38, fill: 0.78, height: 1.88, aimY: 1.52,
    fStop: 3.4, bokeh: 1.0, shutter: 1 / 160,
    stiff: 30, hand: 0.55, prio: 1,
    lead: 6.4,            // metres downfield the aim point is pushed
    side: 26 * DEG,       // camera swung off dead-behind so we see past him
  },

  /**
   * PURSUIT — the open field. Low, wide, trailing quarter.
   *
   * "The pocket wants a different lens from the open field": this one is 42 degrees
   * against the pocket's 38 and sits 0.65 m lower. Wide + low is what makes ground speed
   * read; the same run on the pocket's lens looks like a jog. The frame is opened ahead
   * of the runner by a 4.5 m lead so he is chasing space rather than centred in it.
   */
  pursuit: {
    fov: 42, fill: 0.62, height: 1.22, aimY: 1.26,
    fStop: 2.4, bokeh: 1.1, shutter: 1 / 90,
    stiff: 14, hand: 1.0, prio: 2,
    lead: 4.5,
    side: 24 * DEG,       // off the runner's trailing quarter, not dead behind
  },

  /**
   * DEEP — the ball in flight.
   *
   * A LONG lens (28 degrees), which is the opposite instinct from the rest of the game
   * and is the correct one: a long lens compresses the gap between a receiver and the man
   * covering him, so a contested ball reads as contested. On a 42 degree lens the same
   * two men look ten yards apart. The subject is THE BALL, and the camera pushes in as
   * the ball travels (see director.js: `fill` ramps 0.16 -> 0.30 over the flight).
   */
  deep: {
    fov: 28, fill: 0.20, height: 2.60, aimY: 2.10,
    fStop: 2.8, bokeh: 1.15, shutter: 1 / 320,
    stiff: 20, hand: 0.7, prio: 3,
    lead: 0,
    side: 18 * DEG,
    subjectH: 3.4,        // the "subject" is a ball-plus-receiver column, not a man
  },

  /**
   * IMPACT — the hit. bar/panel-midair_hit.png and bar/panel-leveler.png.
   *
   * Three things separate this from every other shot and all three are deliberate:
   *   1. it is staged BROADSIDE to the collision axis (director.js), because a hit shot
   *      down the line of the collision is two men overlapping and reads as nothing;
   *   2. the roll is hard — 5.5 degrees against the pocket's 0.8 — and signed by the
   *      direction the victim is going, so the frame tips the way the body is thrown;
   *   3. the shutter is 1/48, six times longer than the pocket's, so the accumulation
   *      pass actually smears the bodies.
   * The spring is deliberately soft (stiff 9): the operator is thrown by the hit.
   */
  impact: {
    fov: 39, fill: 0.66, height: 1.05, aimY: 1.34,
    fStop: 1.8, bokeh: 1.3, shutter: 1 / 48,
    stiff: 9, hand: 1.6, prio: 4,
    lead: 0,
    side: 90 * DEG,       // broadside to the collision axis
    rollDeg: 5.5,
  },

  /**
   * CATCH — the ball at full extension. bar/panel-catch.png.
   *
   * Aimed HIGH (2.35 m) and staged close, so the receiver's hands and the ball sit in the
   * top quarter of the frame against dark sky rather than against the crowd. That single
   * choice is most of why the panel reads: the ball has nothing behind it.
   */
  catch: {
    fov: 35, fill: 0.80, height: 1.62, aimY: 2.02,
    fStop: 1.9, bokeh: 1.25, shutter: 1 / 110,
    stiff: 16, hand: 0.9, prio: 3,
    lead: 0,
    side: 12 * DEG,
    rollDeg: 1.6,
  },

  /**
   * SIX — the score. bar/panel-touchdown.png.
   *
   * Staged from INSIDE the end zone looking back at the runner coming in, which is the
   * only angle where the goal line, the painted end zone and the man crossing it are all
   * one image. Low and rolled hard the other way from `impact`, so a score never feels
   * like a hit.
   */
  six: {
    fov: 40, fill: 0.72, height: 1.18, aimY: 1.24,
    fStop: 2.2, bokeh: 1.15, shutter: 1 / 70,
    stiff: 13, hand: 1.0, prio: 4,
    lead: -2.4,
    side: 32 * DEG,
    rollDeg: -3.4,
  },
};

/* ------------------------------------------------------- ball legibility guard */

/**
 * THE ONE RULE THAT OUTRANKS EVERY OTHER RULE IN THIS FILE.
 *
 * A staged frame is rejected and corrected if the ball falls outside the safe rect. The
 * brief is explicit that legibility of the ball beats style, and a follow camera that
 * loses the ball behind the frame edge for even one frame of a scramble is worse than a
 * static wide. So after staging, the ball is projected and, if it is outside
 * (|ndc.x| > 0.80, |ndc.y| > 0.74), the LOOK-AT POINT is walked toward it — up to three
 * passes — and if that is still not enough the lens is widened by up to 9 degrees.
 *
 * The aim point moves and not the camera, because moving the camera changes the staging
 * (height, angle, the whole reason the shot was chosen) while moving the aim point only
 * re-composes it. Widening the lens is the last resort because it changes the shot's
 * character, which is why it is capped.
 *
 * Implemented with a scratch camera so it allocates nothing on the frame path.
 */
const SAFE_X = 0.80;
const SAFE_Y = 0.74;

export function ballGuard(THREE, out, ball, aspect, scratchCam) {
  if (!ball) return 0;
  let widened = 0;

  for (let pass = 0; pass < 4; pass++) {
    scratchCam.fov = out.fov;
    scratchCam.aspect = aspect;
    scratchCam.near = 0.08;
    scratchCam.far = 600;
    scratchCam.position.set(out.pos[0], out.pos[1], out.pos[2]);
    scratchCam.up.set(0, 1, 0);
    scratchCam.lookAt(out.target[0], out.target[1], out.target[2]);
    scratchCam.updateMatrixWorld(true);
    scratchCam.updateProjectionMatrix();

    _v.set(ball[0], ball[1], ball[2]).project(scratchCam);
    const ox = Math.abs(_v.x) - SAFE_X;
    const oy = Math.abs(_v.y) - SAFE_Y;
    // Behind the camera projects to a mirrored point; treat it as maximally out.
    const behind = _v.z > 1;
    if (!behind && ox <= 0 && oy <= 0) return widened;

    if (pass < 3) {
      // Walk the aim point a fraction of the way to the ball. A fraction, not all of it,
      // because snapping the aim onto the ball every frame IS a rigid lerp and it looks
      // like one; this leaves the spring in motion.js something to do.
      const k = behind ? 0.75 : 0.42;
      out.target[0] += (ball[0] - out.target[0]) * k;
      out.target[1] += (ball[1] - out.target[1]) * k;
      out.target[2] += (ball[2] - out.target[2]) * k;
    } else {
      const need = Math.max(ox, oy);
      const add = Math.min(9, 22 * need);
      out.fov += add;
      widened = add;
    }
  }
  return widened;
}

// Module scratch — allocated once, never on the frame path.
let _v = null;
export function initScratch(THREE) {
  if (!_v) _v = new THREE.Vector3();
  return _v;
}

export default { DEG, ACTOR_H, RECIPES, orbitStage, ballGuard, initScratch };
