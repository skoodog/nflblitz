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
// bar/panel-touchdown.png and bar/panel-catch.png:
//
//   panel-truck      hero spans ~8%..95% of frame height   -> fill ~0.87 (but that hero
//                                                              is mid-stride and leaning,
//                                                              a standing man is ~0.62)
//   panel-touchdown  hero spans ~14%..86%                  -> fill ~0.72
//   panel-catch      hero spans ~10%..92%, ball at ~6%     -> fill ~0.80
//   panel-qb_dropback QB spans ~18%..100%, ~30% of width   -> over-the-shoulder, ~2.8 m
//
// THE HORIZON, AND A NUMBER THIS FILE GOT BACKWARDS FOR A WHOLE ROUND.
//
// This comment used to claim the crowd/turf boundary sits at "40%..62% down the frame".
// It does not. Every panel in bar/ was decoded and classified ROW BY ROW — turf in this
// grade is yellow-green ((g-b)/(g+10) > 0.42 with g >= 0.72r), the crowd and the bowl are
// neutral or warm — and the boundary is the topmost row from which that classification
// holds for the next 6% of the frame:
//
//   panel-qb_dropback  66%      panel-truck      76%      panel-catch    70%
//   panel-midair_hit   70%      panel-leveler    60%      panel-touchdown 39% (end-zone
//                                                          paint defeats the classifier)
//
// So the band is 60%..76% down the frame, not 40%..62%, and the difference is not
// cosmetic: it is the difference between a camera that looks DOWN at grass and a camera
// that looks UP at men against a crowd. The bar is the second thing.
//
// WHAT THE PIECE WAS ACTUALLY DELIVERING, measured the same way but geometrically, off
// the solved camera rather than off a PNG. For a camera pitched by theta on a lens of
// half-angle h, a level ray lands at (1 + tan(theta)/tan(h))/2 down the frame. Round 1
// delivered pocket 32%, pursuit 39%, deep 22%, impact 49% — every one of them ABOVE the
// bar's band, i.e. tilted down, with turf covering half the frame. iso_pocket.png bears
// it out: turf covers more than 0.44 of every row from 50% down.
//
// THE CAUSE IS MECHANICAL, not stylistic. `fill`, `topAt` and `height` OVER-DETERMINE the
// solve. For a man standing on the ground the horizon crosses his body at exactly the
// camera's own height, so
//
//     horizonFrac  =  topAt  +  fill * (1 - height / 1.75)
//
// is an identity, not a preference. Round 1 asked for topAt 0.15, fill 0.64 and a 1.18 m
// camera, which is 0.15 + 0.64*0.326 = 0.36 — the solver was doing exactly what it was
// told and what it was told was wrong. Only two of the three are free. `fill` is the bar's
// number and stays; `topAt` and `height` are now solved TOGETHER so the identity lands in
// 60%..70%, which is why every camera below dropped to 0.80-0.95 m and every `topAt` grew.
// The heights are low because the bar's heights are low: a 1.88 m man at fill 0.76 with
// his feet on the frame edge and the horizon at 63% pins the camera at 0.86 m and there is
// no other answer.
//
// WHAT THE FILL FRACTION COST US, measured. The foundation fallback stages `truck` at
// 7.28 m from the hero on a 36 degree lens. Frame height at 7.28 m is 2*7.28*tan(18) =
// 4.73 m, so a 1.88 m player fills 0.40 of the frame — less than half the bar. Confirmed
// against shots/character-anatomy/truck.png, where the ball carrier occupies about 45% of
// the frame height and the composition reads as a wide, neutral, broadcast frame. The bar
// is not a broadcast frame. Every recipe here is therefore built around a FILL FRACTION
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
 * `aimY` is a raw look-at height and is only a fallback. The composition control is
 * `topY` + `topAt`; see the block inside the function for what happened when it was not.
 *
 * `lead` is an optional world-space offset on the look-at point. It is used only where a
 * fixed metric offset is genuinely what is meant (nudging a hero panel's aim onto a second
 * body); the general "open the frame ahead of him" control is pushOffAxis(), in FRAME
 * units, for the reason recorded there.
 */
export function orbitStage(out, subject, azimuth, o) {
  const fov = o.fov;
  const fill = o.fill;
  const subjectH = o.subjectH !== undefined ? o.subjectH : ACTOR_H;
  const height = o.height;
  const tanH = Math.tan(fov * 0.5 * DEG);

  const dist = subjectH / (2 * fill * tanH);
  // The circle is horizontal, so the slant range asked for has to lose the rise first.
  // Guarded at 0.6 m so a camera asked for an impossible height still gets a real frame
  // instead of a NaN.
  let aimY = o.aimY !== undefined ? o.aimY : 1.30;
  let horiz = Math.sqrt(Math.max(0.36, dist * dist - (height - aimY) * (height - aimY)));

  // TOP-OF-SUBJECT PLACEMENT — the control everything in this piece is actually authored
  // with, and the one that a bar sheet can be measured into directly.
  //
  // WHAT WENT WRONG WITHOUT IT, measured. The first version set `aimY` by hand per shot.
  // Projecting the results (scratch script, reported in the build log) showed the pocket
  // shot putting the passer's helmet at 39.1% down the frame and HIS FEET AT 109.4% —
  // out of frame — where bar/panel-qb_dropback.png has him at 18% and 100%. The truck
  // shot put the carrier's helmet at 37.3% against the bar's 8%. `aimY` is a look-at
  // height, and a look-at height is not a composition: it interacts with camera height,
  // distance and lens, so the same number means a different frame in every shot.
  //
  // `topY` + `topAt` says the thing that was actually meant — "put the top of him HERE in
  // the frame" — and solves for the aim. It is iterated three times because the aim
  // height feeds back into the horizontal range through the slant correction; three
  // passes converge to under a millimetre at every distance this game uses.
  if (o.topY !== undefined && o.topAt !== undefined) {
    const rel = Math.atan((1 - 2 * o.topAt) * tanH);
    for (let it = 0; it < 3; it++) {
      const topPitch = Math.atan((o.topY - height) / horiz);
      aimY = height + horiz * Math.tan(topPitch - rel);
      horiz = Math.sqrt(Math.max(0.36, dist * dist - (height - aimY) * (height - aimY)));
    }
  }

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
  out.aimY = aimY;
  return out;
}

/* ------------------------------------------------------------------- recipes */
//
// SIX SHOTS. Each one exists because a different moment of a down is illegible in the
// others, and each carries its own LENS, not just its own position — that is the whole
// point of calling this a camera language rather than a set of camera positions.
//
//  fill     how much of the frame height a 1.88 m man occupies -> sets the DISTANCE
//  height   camera height in metres. Solved WITH topAt against the horizon identity in
//           THE MEASUREMENT, never picked; all of them are hip height or lower because
//           that is what a 60-70% horizon costs.
//  topAt    where the TOP of the subject sits, as a fraction down the frame. 0.24 means
//           "his helmet is 24% from the top". topAt + fill is where his FEET land, so a
//           value just under 1.0 is a full figure and just over is the bar's shin crop.
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
   * free. So the aim is rotated DOWNFIELD until he sits 52% of the way to the frame edge:
   * he ends up large and off-centre, and the geometry of the rush is the subject.
   * Measured on the panel, the QB's helmet sits at 22% from the top and 38% across.
   *
   * HORIZON 0.24 + 0.76*(1 - 0.86/1.75) = 0.627, against the panel's measured 0.66. His
   * feet land at 0.24 + 0.76 = 1.00, on the frame edge, which is the panel's crop.
   */
  pocket: {
    fov: 38, fill: 0.76, height: 0.86, topAt: 0.24,
    fStop: 3.4, bokeh: 1.0, shutter: 1 / 160,
    stiff: 30, hand: 0.55, prio: 1,
    offAxis: 0.52,        // fraction of the horizontal half-frame the passer is pushed
    side: 26 * DEG,       // camera swung off dead-behind so we see past him
  },

  /**
   * PURSUIT — the open field. Low, wide, trailing quarter.
   *
   * "The pocket wants a different lens from the open field": this one is 42 degrees
   * against the pocket's 38. Wide + low is what makes ground speed read; the same run on
   * the pocket's lens looks like a jog. The frame is opened ahead of the runner
   * (offAxis 0.40) so he is chasing space rather than centred in it.
   *
   * HORIZON 0.28 + 0.68*(1 - 0.82/1.75) = 0.641, against panel-truck's 0.76 and
   * panel-catch's 0.70. `fill` went 0.64 -> 0.68 because a runner is the subject of this
   * shot and 0.64 was under the fallback wide it exists to replace.
   */
  pursuit: {
    fov: 42, fill: 0.68, height: 0.82, topAt: 0.28,
    fStop: 2.4, bokeh: 1.1, shutter: 1 / 90,
    stiff: 14, hand: 1.0, prio: 2,
    offAxis: 0.40,
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
  // THE HORIZON IDENTITY DOES NOT APPLY HERE — the subject is a point in the air, not a
  // man standing on the ground, so the horizon is topAt + ((ballY - height)/horiz) /
  // (2 tan(fov/2)). At 18 m the camera height barely moves it and `topAt` does all the
  // work. Round 1 used topAt 0.30 with a 2.60 m camera and delivered 22%: the deep shot,
  // the one shot in the language that is entirely about something in the AIR, was looking
  // down at the grass.
  deep: {
    fov: 28, fill: 0.38, height: 1.80, topAt: 0.34,
    fStop: 2.8, bokeh: 1.15, shutter: 1 / 320,
    stiff: 20, hand: 0.7, prio: 3,
    offAxis: 0.0,
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
  // HORIZON 0.22 + 0.72*(1 - 0.80/1.75) = 0.611, against panel-midair_hit's measured 0.70
  // and panel-leveler's 0.60. This is the shot where getting it wrong shows most: round 1
  // delivered 49%, which puts the collision on a bed of grass instead of against the bowl.
  impact: {
    fov: 39, fill: 0.72, height: 0.80, topAt: 0.22,
    fStop: 1.8, bokeh: 1.3, shutter: 1 / 48,
    stiff: 9, hand: 1.6, prio: 4,
    offAxis: 0.10,
    side: 90 * DEG,       // broadside to the collision axis
    rollDeg: 5.5,
  },

  /**
   * CATCH — the ball at full extension. bar/panel-catch.png.
   *
   * Aimed HIGH and staged close, so the receiver's hands and the ball sit in the top
   * quarter of the frame against dark sky rather than against the crowd. That single
   * choice is most of why the panel reads: the ball has nothing behind it.
   *
   * `reachY` is what makes it aim high in the LIVE path and it is the one recipe that
   * needs its own field. The other five compose against the top of a man's helmet
   * (subject + 1.75); this one composes against the ball, which is above his hands. The
   * hero panel passed topY 2.85 by hand and the live director passed 1.75, so the same
   * recipe delivered a 71% horizon on the panel and 23% live — the same class of bug as
   * the horizon itself, and found the same way. director.js now uses
   * max(ball.y, subject.y + reachY) for both.
   */
  catch: {
    fov: 35, fill: 0.80, height: 1.20, topAt: 0.16,
    fStop: 1.9, bokeh: 1.25, shutter: 1 / 110,
    stiff: 16, hand: 0.9, prio: 3,
    offAxis: 0.20,
    side: 12 * DEG,
    rollDeg: 1.6,
    reachY: 2.25,         // a jumping receiver's hands, not his helmet crown
  },

  /**
   * SIX — the score. bar/panel-touchdown.png.
   *
   * Staged from INSIDE the end zone looking back at the runner coming in, which is the
   * only angle where the goal line, the painted end zone and the man crossing it are all
   * one image. Low and rolled hard the other way from `impact`, so a score never feels
   * like a hit.
   *
   * HORIZON 0.24 + 0.72*(1 - 0.88/1.75) = 0.598. PRIORITY 5, above the hit — the only
   * recipe that outranks `impact`, because a score is the end of the down and nothing that
   * happens in the same tick is a bigger story than six points.
   */
  six: {
    fov: 40, fill: 0.72, height: 0.88, topAt: 0.24,
    fStop: 2.2, bokeh: 1.15, shutter: 1 / 70,
    stiff: 13, hand: 1.0, prio: 5,
    offAxis: 0.30,
    side: 32 * DEG,
    rollDeg: -3.4,
  },
};

/**
 * pushOffAxis — put the subject `frac` of the way to the horizontal frame edge.
 *
 * WHY THIS AND NOT A METRIC LEAD, and it is a mistake this piece made and measured.
 * The first version expressed "open the frame ahead of the runner" as a look-at point
 * pushed N metres along his velocity: pursuit had lead 4.5 m, pocket had 6.4 m. Those are
 * enormous compared with the staging distance the fill fraction produces — pursuit stages
 * at 3.95 m and pocket at 3.50 m. Worked through for the qb_dropback panel, a 6.4 m lead
 * at 3.50 m distance puts the passer 53.4 degrees off the camera axis against a
 * horizontal half-fov of 31.5 degrees: THE SUBJECT OF THE SHOT WAS OUTSIDE THE FRAME.
 *
 * A composition rule has to be expressed in frame units, not world units, or it stops
 * meaning anything as soon as the lens changes. So: rotate the aim by `frac` of the
 * horizontal half-angle, and let the world distance be whatever it turns out to be.
 * `prefer` is a world XZ direction; of the two rotations, the one that carries the aim
 * further along it wins, which is how "open the frame DOWNFIELD" gets said.
 */
export function pushOffAxis(out, subject, frac, aspect, prefer) {
  if (!frac) return out;
  const hHalf = Math.atan(aspect * Math.tan(out.fov * 0.5 * DEG));
  const ang = frac * hHalf;
  const dx = subject[0] - out.pos[0];
  const dz = subject[2] - out.pos[2];
  const d = Math.hypot(dx, dz);
  if (d < 1e-4) return out;
  const h = Math.atan2(dx, dz);
  const h1 = h + ang, h2 = h - ang;
  const t1x = out.pos[0] + Math.sin(h1) * d, t1z = out.pos[2] + Math.cos(h1) * d;
  const t2x = out.pos[0] + Math.sin(h2) * d, t2z = out.pos[2] + Math.cos(h2) * d;
  const s1 = (t1x - subject[0]) * prefer[0] + (t1z - subject[2]) * prefer[1];
  const s2 = (t2x - subject[0]) * prefer[0] + (t2z - subject[2]) * prefer[1];
  if (s1 >= s2) { out.target[0] = t1x; out.target[2] = t1z; }
  else { out.target[0] = t2x; out.target[2] = t2z; }
  return out;
}

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
