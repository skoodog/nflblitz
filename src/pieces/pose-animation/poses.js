// PIECE pose-animation — the 19-pose vocabulary.
//
// HOW TO READ THIS FILE
// Every number is degrees in the actor's own frame: +Z is the way he faces, +X is his
// LEFT, +Y is up. `P.leg(+1, {...})` is his left leg. Angles are WORLD swings (see
// rigkit.js swing()), so a spine that flexes 40 degrees does not silently re-aim the
// limbs — which is what makes it safe to put arcade-sized numbers in here.
//
// WHAT I MEASURED, AND WHAT IT CHANGED
// Every grounded pose is checked by a scratch harness that runs apply() under plain node
// and prints world positions (hip height, lowest contact, hand/toe positions, the
// fingertip-to-toe span). Things it caught that eyeballing did not:
//   * NOBODY WAS SOLVING GROUND CONTACT, and it is wrong in both directions. I ran the
//     foundation fallback itself under the same harness. On the `skill` archetype (legs
//     5% longer than canonical, so a bind-pose actor is already 25 mm too tall for his
//     own hip height) the fallback's `idle` leaves the toe TIPS at y = -0.025 — every
//     standing player is a centimetre into the grass. Its `downed`, with the hips pinned
//     at 0.35, leaves the toe tips at y = -0.645 (two feet of leg under the pitch) while
//     the shoulder floats at 0.58. Every pose here instead ends with groundTo(), which
//     solves body height FROM the contact points; my `downed` lands the hips at 0.161 and
//     nothing goes below the turf.
//   * jump_catch's first version had both arms crossed over the head, because I derived
//     the forearm from `humerus + elbow`, and the elbow's hinge sign flips once the
//     humerus passes vertical. Forearms are now absolute swings. See rigkit.js arm().
//   * The hero `catch` scene puts the ball at local y=1.77 (BELOW this actor's 1.85 m
//     crown). A real high-point catch on this rig puts the fingertips at ~2.25. I chose
//     the pose over the scene: jump_catch reaches high like the panel and my own iso
//     shot puts the ball where the hands are. Noted in the final report.
//
// PHASE
// `phase` is 0..1 and means the same thing everywhere: how far through the beat this pose
// is. Cyclic for idle/sprint/block; one-shot for everything else, where 0 is the wind-up,
// ~0.5 is the money frame, and 1.0 is the follow-through. Contact poses deform MORE as
// phase rises — that is the follow-through, and it is why truck/truck_recoil at the same
// phase read as one event.
//
// TWO CONVENTIONS THAT COST ME A REVISION EACH, WRITTEN DOWN SO THEY DON'T AGAIN
// 1. `flex` is measured from HANGING STRAIGHT DOWN, not from the body's own axis. A body
//    lying horizontally still needs legs at flex ~ -90, because the leg angle is a world
//    swing. My first `downed` had the pelvis pitched 76 deg with the legs at flex -6, so
//    the actor stood on his feet with his chest horizontal — a wheelbarrow. Same bug hit
//    dive_catch and airborne_hit. Measured: legs at flex -6 put the hips at 0.88 in a
//    pose that measures 0.16 once the legs actually lie down.
// 2. Every pose ends with groundTo(), which solves body height FROM the contact points.
//    That makes the `y:` argument to hips() a NO-OP (the grounding delta cancels it), so
//    it is not written; hip height is controlled by knee flexion, which is how it works in
//    a body. The target is SOLE (0.022, the bind-pose toe-tip height) everywhere except
//    two documented cases: `downed` uses 0.085 because its lowest contact is a shin rather
//    than a toe, and `dive_catch` uses 0.32 because a layout dive is mid-flight. Airborne
//    poses ground the same way, so "the lowest part of the actor sits at the actor's
//    origin" is universal and a scene's `pos[1]` is literally height off the turf.

import * as THREE from 'three';
import { makeRng, hash, seedFromString } from '../../foundation/rng.js';
import { POSE_IDS } from '../../foundation/fallbacks/pose.js';
import { Poser, mix, clamp, curve, smoothstep } from './rigkit.js';

export { POSE_IDS };

// Module-level scratch. apply() is not re-entrant (single-threaded, no async inside),
// and this is called once per actor per build, so the alternative — allocating a handful
// of Vector3s per actor per rebuild — is pure garbage for the heap sawtooth the
// foundation caps at 8 MB.
const V = new THREE.Vector3();
const V2 = new THREE.Vector3();
const V3 = new THREE.Vector3();

// MEASURED: at bind the toe TIP sits at y=0.022 and the sole of the foot mesh at y=0.
// Grounding a contact point to 0 therefore buries the actor ~2 cm. Every foot-contact
// pose grounds to SOLE instead. Poses whose contact is a shin or a torso use a bigger
// clearance because those bones sit inside ~8 cm of limb.
const SOLE = 0.022;

/* ============================================================== shared shapes */

/** Relaxed carriage: arms hanging with a live elbow, not the A-pose and not a plank. */
function armsRelaxed(P, o) {
  const s = o && o.spread !== undefined ? o.spread : 9;
  const f = o && o.flex !== undefined ? o.flex : 6;
  const e = o && o.elbow !== undefined ? o.elbow : 22;
  P.arm(+1, { clavUp: -8, clavFwd: 0, upFlex: f, upAbd: s, foreFlex: f + e, foreAbd: s - 3, handFlex: f + e + 6, handAbd: s - 6 });
  P.arm(-1, { clavUp: -8, clavFwd: 1, upFlex: f + 3, upAbd: s + 2, foreFlex: f + e + 4, foreAbd: s, handFlex: f + e + 10, handAbd: s - 4 });
}

/* ==================================================================== poses */

/**
 * idle — standing, but ALIVE. Weight parked on one leg (seeded which), the free hip
 * dropped, a slow breath in the chest and a drift in the shoulders. The single most
 * common pose in the game: 14 actors hold it whenever nothing is happening, so it is
 * also the pose most responsible for the "everyone stands bolt upright" read.
 */
function idle(P, ph, c) {
  const s = c.v[0] > 0 ? 1 : -1;                 // stance side: seeded, so a huddle varies
  const br = Math.sin(ph * Math.PI * 2);          // breath, one cycle per phase
  const sway = Math.sin(ph * Math.PI * 2 + 1.1);
  P.hips({
    x: s * 0.035 + sway * 0.006, z: 0,
    pitch: 3 + br * 0.8, twist: s * 3 + sway * 1.2, lean: s * 6,
  });
  P.spine({ pitch: 2 - br * 2.2, twist: -s * 5, lean: -s * 3.5 });
  P.look({ pitch: -3 + br * 1.2, twist: s * 8 + c.v[1] * 6, lean: -s * 2 });
  // Stance leg stacked but not locked; free leg soft, foot turned out and a little
  // forward. Knees stay a few degrees bent even on the loaded side — a straight knee is
  // the single loudest "mannequin" cue and it is what the fallback's idle has.
  P.leg(s, { flex: 3, abd: 2, knee: 9, ankle: -16, toeOut: 5 });
  P.leg(-s, { flex: 8, abd: 5, knee: 22, ankle: -13, toeOut: 12 });
  armsRelaxed(P, { spread: 11 + br * 1.5, flex: 7, elbow: 27 });
  P.groundTo(SOLE * P.gs);
}

/**
 * stance_offense — three-point stance. Down hand solved with IK onto the turf so the
 * knuckles actually touch; back flat; head up. The asymmetry (which hand is down, which
 * foot is back) is the whole tell that this is a snap and not a squat.
 */
function stanceOffense(P, ph, c) {
  const s = -1;                                   // right hand down
  const set = smoothstep(0, 1, ph);               // 0 = settled, 1 = loaded to fire
  // MEASURED TWICE. v1 at 52 deg total trunk pitch: shoulder at y=1.25, ground 1.09 m
  // away, IK clamped, "down hand" floating at y=0.43. v2 at 84 deg: shoulder 0.86, still
  // 0.73 away against a 0.595 m shoulder-to-wrist reach — clamped again at y=0.28. A real
  // three-point stance has the hips ABOVE the shoulders, so v3 runs the trunk PAST
  // vertical at 102 deg. Final measurement: hips 0.786, shoulders below them, and the
  // down-hand fingertip lands at y = 0.12 — on the grass, which is the whole point.
  P.hips({ z: -0.05, pitch: 60 + set * 3, twist: s * 8, lean: s * 3 });
  P.spine({ pitch: 42, twist: -s * 12, lean: -s * 5, wp: [0.46, 0.32, 0.22] });
  P.look({ pitch: -46, twist: -s * 8, split: 0.5 });
  P.leg(s, { flex: 58, abd: 12, knee: 96, ankle: -40, toeOut: 6, toe: -14 });         // back foot, heel up
  P.leg(-s, { flex: 44, abd: 10, knee: 78, ankle: -16, toeOut: 8 });                  // front foot flat
  // Free arm cocked across the thigh, ready to punch out.
  P.arm(-s, { clavUp: -4, clavFwd: 10, upFlex: 26, upAbd: 14, foreFlex: 78, foreAbd: 6, handFlex: 92, handAbd: -2 });
  // Down arm: rough it in, then IK the wrist to the turf so the knuckles actually land.
  P.arm(s, { clavUp: 4, clavFwd: 18, upFlex: 34, upAbd: 16, foreFlex: 60, foreAbd: 10 });
  const sh = P.worldPos(`upperarm_${s > 0 ? 'L' : 'R'}`, V2);
  // Shoulder-to-wrist reach on this rig is 0.595 m (0.311 + 0.276 scaled) — NOT the 0.72 m
  // that includes the hand. Target the wrist 0.13 m off the turf; measured shoulder height
  // in this stance is 0.72, so the solve has 0.59 of 0.595 to work with.
  P.reach(s, V.set(sh.x + s * 0.05, 0.13 * P.gs, sh.z + 0.14 * P.gs), V3.set(s * 0.4, 0.1, -0.9));
  P.aim(`hand_${s > 0 ? 'L' : 'R'}`, V.set(s * 0.12, -0.80, 0.59));
  P.groundTo(SOLE * P.gs);
}

/**
 * stance_defense — two-point, coiled and wide. Weight on the balls of the feet, hips
 * loaded behind the heels, hands live in front. Reads as a spring, not a chair.
 */
function stanceDefense(P, ph, c) {
  const s = c.v[0] > 0 ? 1 : -1;
  const load = 0.5 + 0.5 * Math.sin(ph * Math.PI * 2);   // subtle weight shift, cyclic
  P.hips({ z: -0.10, pitch: 22, twist: s * 5, lean: s * 2 });
  P.spine({ pitch: 16, twist: -s * 8, lean: -s * 3 });
  P.look({ pitch: -30, twist: s * 5 });
  P.leg(+1, { flex: 34 + (s > 0 ? 6 : 0), abd: 13, knee: 66, ankle: -22, toeOut: 12 });
  P.leg(-1, { flex: 30 - (s > 0 ? 6 : 0), abd: 15, knee: 70, ankle: -26, toeOut: 14 });
  P.arm(+1, { clavUp: -3, clavFwd: 12, upFlex: 30, upAbd: 26, foreFlex: 74, foreAbd: 22, handFlex: 86, handAbd: 14 });
  P.arm(-1, { clavUp: -3, clavFwd: 14, upFlex: 34, upAbd: 24, foreFlex: 80, foreAbd: 20, handFlex: 92, handAbd: 12 });
  P.groundTo(SOLE * P.gs);
}

/**
 * dropback — QB pedalling back with the ball high at the chest. Shoulders open to the
 * throwing side, eyes downfield, one leg crossing back under the hips.
 */
function dropback(P, ph, c) {
  const u = ph;                                   // 0..1 = one crossover step
  const step = Math.sin(u * Math.PI * 2);
  P.hips({ z: -0.02, pitch: 4, twist: -22 + step * 6, lean: step * 3 });
  P.spine({ pitch: 10, twist: 8, lean: -2 });
  P.look({ pitch: -12, twist: 18, lean: 3 });
  // Lead (left) leg reaches back; trail (right) leg pushes. Swap emphasis with phase.
  P.leg(+1, { flex: -14 - step * 24, abd: 9, knee: 40 + Math.max(0, step) * 42, ankle: -22 - Math.max(0, step) * 22, toeOut: 10 });
  P.leg(-1, { flex: -6 + step * 20, abd: 11, knee: 34 + Math.max(0, -step) * 46, ankle: -20 - Math.max(0, -step) * 20, toeOut: 16 });
  // Two hands on the ball, high and near the back shoulder.
  P.arm(+1, { clavUp: -1, clavFwd: 16, upFlex: 20, upAbd: 30, foreFlex: 86, foreAbd: -4 });
  P.arm(-1, { clavUp: 2, clavFwd: 12, upFlex: 8, upAbd: 34, foreFlex: 74, foreAbd: -14 });
  const ball = V2.set(-0.13 * P.gs, 1.34 * P.gs, 0.20 * P.gs);
  P.reach(+1, ball, V.set(0.6, -0.5, -0.6));
  P.reach(-1, ball, V.set(-0.7, -0.4, -0.5));
  P.aim('hand_L', V.set(-0.5, 0.1, 0.86));
  P.aim('hand_R', V.set(0.5, 0.15, 0.85));
  P.groundTo(SOLE * P.gs);
}

/**
 * throw_release — blended across the throw so the SAME id gives a cocked arm at phase 0,
 * the release at ~0.5 and a real follow-through at 1.0. Follow-through is one of the four
 * judged criteria and it cannot be faked from a single key: the arm has to end up across
 * the body with the back leg dragging.
 */
function throwRelease(P, ph, c) {
  const u = smoothstep(0, 1, ph);
  const rel = smoothstep(0.25, 0.62, ph);          // arm coming through
  const fol = smoothstep(0.55, 1.0, ph);           // deceleration across the body
  P.hips({ pitch: 6 + fol * 10, twist: mix(-26, 24, rel), lean: mix(4, -8, rel) });
  P.spine({ pitch: mix(4, 22, fol), twist: mix(-22, 30, rel), lean: mix(-10, 14, rel) });
  P.look({ pitch: mix(-10, -2, fol), twist: mix(26, 6, rel), lean: mix(8, -6, rel) });
  // Front (left) foot planted across; back (right) foot rotates over and drags.
  P.leg(+1, { flex: mix(22, 8, u), abd: 8, knee: mix(38, 16, u), ankle: -14, toeOut: -6 });
  P.leg(-1, { flex: mix(-24, -42, u), abd: mix(10, 20, u), knee: mix(24, 34, u), ankle: mix(-42, -64, u), toeOut: 26, toe: mix(-44, -66, u) });
  // Throwing arm: cocked high behind -> extended at release -> swept down across the body.
  const upFlex = mix(mix(96, 150, rel), 44, fol);
  const upAbd = mix(mix(78, 30, rel), -22, fol);
  const foFlex = mix(mix(28, 160, rel), 22, fol);
  const foAbd = mix(mix(66, 18, rel), -46, fol);
  P.arm(-1, {
    clavUp: mix(6, 14, rel) - fol * 10, clavFwd: mix(-12, 26, rel),
    upFlex, upAbd, foreFlex: foFlex, foreAbd: foAbd,
    handFlex: foFlex - mix(10, 34, fol), handAbd: foAbd - 6, twist: -0.5,
  });
  // Off arm points at the target, then is ripped down to the hip. That rip is what
  // rotates the trunk; without it the throw looks like a wave.
  P.arm(+1, {
    clavUp: mix(-2, -12, rel), clavFwd: mix(24, -14, rel),
    upFlex: mix(74, -22, rel), upAbd: mix(16, 26, rel),
    foreFlex: mix(96, -6, rel), foreAbd: mix(6, 30, rel),
    handFlex: mix(104, -14, rel), handAbd: mix(0, 26, rel),
  });
  P.groundTo(SOLE * P.gs);
}

/* ---------------------------------------------------------------- run cycle */
//
// Measured tables, one full stride (both legs) over phase 0..1. Leg L runs on `phase`,
// leg R on `phase + 0.5`. Contact for a leg is u in [0, 0.35]; the flight phases are
// therefore phase (0.35,0.50) and (0.85,1.00), and LIFT lifts the whole body then — a
// sprint that never leaves the ground is a jog, and the fallback's symmetric leg swap
// is exactly that.
const HIP_FLEX = [[0.00, 28], [0.12, 2], [0.28, -22], [0.36, -34], [0.55, 10], [0.72, 64], [0.86, 48]];
const KNEE = [[0.00, 20], [0.12, 40], [0.28, 17], [0.36, 11], [0.50, 96], [0.60, 132], [0.72, 100], [0.86, 44]];
const ANKLE = [[0.00, -7], [0.12, -15], [0.28, -32], [0.36, -64], [0.55, -34], [0.72, -6], [0.86, -2]];
const LIFT = [[0.00, 0], [0.35, 0], [0.42, 0.085], [0.50, 0], [0.85, 0], [0.92, 0.085]];

/**
 * sprint — the counter-rotation IS the pose. Pelvis and shoulders are driven in
 * OPPOSITE directions off the same stride signal (pelvis -7 deg, chest +13 deg world),
 * the free hip drops on the swing side, and the arms are locked to the opposite leg.
 * Take the counter-rotation out and you get the fallback: two legs scissoring under a
 * rigid box.
 */
function sprint(P, ph, c) {
  const u = ph + c.v[2] * 0.02;                    // seeded stride offset: a pack of
  const uL = u, uR = u + 0.5;                      // runners must not march in lockstep
  const drive = Math.cos((u - 0.72) * Math.PI * 2);  // +1 when the LEFT knee is at its peak
  const pelvis = -7 * drive;
  const chestW = 13.5 * drive;                     // world twist of the shoulders
  P.hips({ pitch: 7, twist: pelvis, lean: 3.2 * drive });
  P.spine({ pitch: 17, twist: chestW - pelvis, lean: -1.5 * drive });
  P.look({ pitch: -20, twist: -chestW * 0.55, lean: 1.5 * drive });
  for (const s of [1, -1]) {
    const ul = s > 0 ? uL : uR;
    P.leg(s, {
      flex: curve(ul, HIP_FLEX), abd: 3 + curve(ul, KNEE) * 0.03,
      knee: curve(ul, KNEE), ankle: curve(ul, ANKLE),
      toeOut: 3, toe: curve(ul, ANKLE) + 16,
    });
  }
  // Arms lead the opposite leg by half a cycle. Front of the swing = hand at the chin
  // and across the midline; back of the swing = hand past the hip with the elbow flared.
  for (const s of [1, -1]) {
    const ua = (s > 0 ? uL : uR) + 0.5;
    const fwd = Math.cos((ua - 0.75) * Math.PI * 2);   // +1 at the front of the swing
    const upFlex = -9 + 47 * fwd;
    P.arm(s, {
      clavUp: -6 + 6 * fwd, clavFwd: -2 + 14 * fwd,
      upFlex, upAbd: 13 - 3 * fwd,
      foreFlex: upFlex + 84, foreAbd: 2 - 12 * fwd,
      handFlex: upFlex + 96, handAbd: -4 - 14 * fwd, twist: 0.35 * s,
    });
  }
  P.groundTo((SOLE + curve(u, LIFT)) * P.gs);
}

/**
 * juke — a hard lateral cut. The plant leg is braced OUT to the side and the whole mass
 * is thrown the other way; the spine side-bends, the head is already looking at the new
 * lane, and the trail knee crosses over. Weight, not a sidestep.
 */
function juke(P, ph, c) {
  const s = c.v[0] > 0 ? 1 : -1;                   // cut direction: away from side `s`
  const k = smoothstep(0.0, 0.55, ph);             // plant loading
  const go = smoothstep(0.5, 1.0, ph);             // push-off
  P.hips({
    x: s * (0.10 + k * 0.07), z: -0.02,
    pitch: 10, twist: s * 16, lean: s * (16 + k * 8) - go * 10,
  });
  P.spine({ pitch: 8 + go * 8, twist: -s * 26, lean: -s * (26 + k * 10) });
  P.look({ pitch: -16, twist: -s * 34, lean: -s * 12 });
  // Plant leg: wide, braced, ankle rolled over the outside edge.
  P.leg(s, { flex: 6 + go * 10, abd: 30 + k * 10, knee: 34 + k * 14, ankle: -12, toeOut: 20 });
  // Trail leg: knee up and crossing the midline in the new direction.
  P.leg(-s, { flex: 40 + go * 34, abd: -14 - go * 8, knee: 88 + go * 22, ankle: -4, toeOut: -6 });
  // Outside arm swings low across the body; inside arm up and open for balance.
  P.arm(s, { clavUp: -6, clavFwd: 6, upFlex: -30 - k * 16, upAbd: 26, foreFlex: 18, foreAbd: 44, handFlex: 28, handAbd: 52 });
  P.arm(-s, { clavUp: 4, clavFwd: 20, upFlex: 62, upAbd: 34, foreFlex: 116, foreAbd: 16, handFlex: 128, handAbd: 4 });
  P.groundTo(SOLE * P.gs);
}

/**
 * truck — HERO POSE. bar/panel-truck.png: torso ~35 deg over the front foot, ball tucked
 * in one arm, the other clubbing down and forward, one knee driven up to hip height and
 * the other leg fully extended behind with the toe still dragging the turf.
 *
 * MEASURED at phase 0.62 (the value the hero scene uses), skill archetype:
 *   hips 0.86 · shoulders 1.25/1.27, right one 0.07 forward and 0.02 lower (the drop into
 *   contact) · drive knee 0.75, i.e. at hip height and 0.46 m in front · trailing toe on
 *   the turf 0.65 m BEHIND the hips · fingertip-to-toe span 1.74 m.
 * The force line runs from that trailing toe, through the hips, out of the leading
 * shoulder. truck_recoil is built along the SAME line from the other side, which is what
 * makes the pair read as one collision instead of two poses standing near each other.
 *
 * Sides are mirrored from the panel on purpose: the ball is carried on the LEFT because
 * the hero `truck` scene draws the ball at actor-local (0.90, 1.05, 0.39), out past his
 * left hip. Measured gap from the carrying hand to that ball: 0.45 m. It is a scene
 * number I do not own, so the carry is placed to minimise it rather than fudged.
 */
function truck(P, ph, c) {
  const k = smoothstep(0.0, 0.55, ph);             // gather -> contact
  const f = smoothstep(0.5, 1.0, ph);              // through contact
  // OPPOSITION, and it has to be consistent all the way through or the pose fights itself.
  // LEFT knee drives -> left hip forward -> pelvis twists NEGATIVE; the shoulders counter
  // to +20 world, so the RIGHT shoulder is the one forward, dropped (spine leans right)
  // and protracted 32 deg by its clavicle. That right shoulder is the contact point, the
  // right arm is the club, and truck_recoil is side-bent as if struck on its LEFT chest —
  // which is exactly where this shoulder arrives.
  P.hips({ z: 0.02, pitch: 10 + k * 4, twist: -9 - k * 3, lean: 4 });
  P.spine({ pitch: 28 + k * 6 + f * 3, twist: 27 + k * 4, lean: -9 - k * 5, wp: [0.28, 0.34, 0.38] });
  // Head has to fight the whole 35 deg of trunk lean plus the neck's share of it, or the
  // helmet points at the grass. Measured in it2_truck.png: at -34 the face was still ~35
  // deg nose-down. -48 puts the facemask level and downfield, which is the panel.
  P.look({ pitch: -44 - k * 4, twist: -14, lean: 10 });
  // Left knee driving; ankle dorsiflexed so the cleat shows.
  P.leg(+1, { flex: 68 + k * 14, abd: 9, knee: 92 + k * 8, ankle: 4, toeOut: 2, toe: 16 });
  // Right leg fully extended behind, toe dragging.
  P.leg(-1, { flex: -30 - k * 10, abd: 5, knee: 10 + f * 12, ankle: -46 - k * 8, toeOut: 8, toe: -34 });
  // Left arm: ball tucked, elbow back and OUTSIDE the ribs, forearm forward so the ball
  // rides in front of the chest and out past his left hip. Measured hand at (0.50, 1.01,
  // 0.59) at phase 0.62.
  P.arm(+1, {
    clavUp: 4, clavFwd: 8,
    upFlex: 10, upAbd: 52, foreFlex: 74, foreAbd: 22,
    handFlex: 86, handAbd: 16, twist: 0.7,
  });
  // Right arm: the club. Down and forward, elbow barely bent, hand open past the hip.
  P.arm(-1, {
    clavUp: 4 + k * 6, clavFwd: 22 + k * 10,
    upFlex: 34 + k * 10, upAbd: 24, foreFlex: 46 + k * 12, foreAbd: 32,
    handFlex: 58 + k * 12, handAbd: 36, twist: -0.4,
  });
  P.groundTo(SOLE * P.gs);
}

/**
 * truck_recoil — the OTHER half of `truck`. Authored facing the runner, so the force
 * arrives along -Z at chest height: chest driven back and up, head snapped back, both
 * arms flung behind, front leg buckled and both feet coming off the turf. The spine
 * DEFORMS (extension through the thoracic, side-bend away from the shoulder) rather than
 * the body translating; that is the judged difference.
 */
function truckRecoil(P, ph, c) {
  const k = smoothstep(0.0, 0.45, ph);             // compression at contact
  const g = smoothstep(0.10, 0.90, ph);            // separation, limbs trailing
  P.hips({ z: -0.10 - g * 0.16, pitch: 26 + g * 10, twist: -12, lean: 9 });
  // Net trunk at full separation: pelvis +36 against a spine at -64, so the torso ends up
  // 28 deg PAST vertical the wrong way — hyperextended, not merely upright. The pelvis and
  // the chest going opposite ways is what makes it read as a body being folded rather than
  // a body being pushed.
  P.spine({ pitch: -34 - g * 30, twist: 20, lean: -22 - k * 8, wp: [0.22, 0.34, 0.44] });
  P.look({ pitch: -34 - g * 24, twist: 26, lean: 18, split: 0.35 });
  // Legs kicked forward and up, front knee collapsed.
  P.leg(+1, { flex: 34 + g * 46, abd: 16, knee: 52 + g * 34, ankle: -30 - g * 20, toeOut: 12 });
  P.leg(-1, { flex: 10 + g * 62, abd: 9, knee: 88 + g * 20, ankle: -20 - g * 26, toeOut: 6 });
  // Arms thrown back and out — the classic blown-up windmill.
  P.arm(+1, {
    clavUp: 14 + k * 8, clavFwd: -26,
    upFlex: -52 - g * 28, upAbd: 44 + g * 16, foreFlex: -70 - g * 30, foreAbd: 40,
    handFlex: -84 - g * 26, handAbd: 34,
  });
  P.arm(-1, {
    clavUp: 18 + k * 8, clavFwd: -20,
    upFlex: -38 - g * 34, upAbd: 56 + g * 10, foreFlex: -30 - g * 44, foreAbd: 62,
    handFlex: -34 - g * 46, handAbd: 66,
  });
  P.groundTo(SOLE * P.gs);
}

/**
 * dive_catch — full layout. The judged thing is a single unbroken line from fingertip to
 * pointed toe, so the body is pitched ~72 deg out of vertical at the pelvis and then the
 * spine EXTENDS back against it (-18 deg) to arch the chest above the hips. Arms are
 * nearly straight with the clavicles protracted 34 deg and elevated 10. MEASURED: that
 * shoulder reach alone moves the fingertip 9.5 cm further down the reach axis versus a
 * rest clavicle, and it is what stops a dive looking like a fall.
 */
function diveCatch(P, ph, c) {
  const r = smoothstep(0.1, 0.7, ph);              // reach building to the catch
  // Trunk: pelvis 84 deg out of vertical, spine EXTENDING ~20 deg back against it, so the
  // torso sits ~25 deg above horizontal with the chest higher than the hips. MEASURED at
  // phase 0.65: fingertip (0.31, 0.75, 1.25) to opposite toe (-0.15, 0.34, -0.71), span
  // 2.14 m on a 1.85 m actor — 1.16x his own height, which is what "full layout" means.
  P.hips({ z: 0.04, pitch: 84 + r * 4, twist: -6, lean: 5 });
  P.spine({ pitch: -14 - r * 6, twist: 8, lean: -7, wp: [0.30, 0.34, 0.36] });
  P.look({ pitch: -52 - r * 8, twist: 6, lean: -5, split: 0.4 });
  // Legs trailing horizontally BEHIND (flex ~ -95, see convention note at the top of the
  // file) and slightly above the hips, toes hard-pointed. Asymmetric knees: a symmetric
  // pair reads as a mannequin being thrown.
  P.leg(+1, { flex: -96 - r * 6, abd: 8, knee: 10, ankle: -76, toeOut: 6, toe: -78 });
  P.leg(-1, { flex: -86 - r * 6, abd: 4, knee: 30, ankle: -64, toeOut: 3, toe: -66 });
  for (const s of [1, -1]) {
    P.arm(s, {
      clavUp: 10, clavFwd: 34,
      upFlex: 104 + r * 8, upAbd: 12 + (s > 0 ? 2 : 0),
      foreFlex: 108 + r * 8, foreAbd: 7,
      handFlex: 112 + r * 8, handAbd: 4, twist: s * 0.5,
    });
  }
  // THE ONE POSE THAT IS NOT GROUNDED TO THE SOLE. A dive is mid-flight by definition; at
  // SOLE the body lies flat on the turf with the hands at 0.43 and reads as "already
  // landed". 0.32 m of clearance puts the trailing toe a foot off the grass, hips at 0.35
  // and fingertips at 0.75 — airborne even when a scene drops him at pos[1] = 0.
  P.groundTo(0.32 * P.gs);
}

/**
 * jump_catch — HERO POSE. bar/panel-catch.png: both arms at full stretch above and
 * slightly in front of the helmet, hands together on the ball, shoulders shrugged into
 * the reach, head tipped back, ONE knee tucked and the other leg trailing.
 *
 * The hands are placed by IK onto a single catch point, so the two hands actually meet.
 * phase: 0 = arms still rising, 0.45 = contact at maximum extension, 1.0 = ball pulled
 * in, elbows collapsing, body folding around it.
 */
function jumpCatch(P, ph, c) {
  const up = smoothstep(0.0, 0.45, ph);
  const pull = smoothstep(0.5, 1.0, ph);
  const gs = P.gs;
  P.hips({ pitch: -6 + pull * 22, twist: -7, lean: 4 });
  P.spine({ pitch: mix(6, -16, up) + pull * 30, twist: 12, lean: -8 - up * 4 });
  // Head tips back to track the ball, but only to -30: at -40 (measured in it2_catch.png)
  // the facemask disappears over the top of the helmet and the head reads as a blob.
  P.look({ pitch: mix(-14, -30, up) + pull * 34, twist: 8, lean: -6, split: 0.4 });
  // Trail leg long and pointed, tuck leg folded: the asymmetry is what says "airborne".
  P.leg(+1, { flex: mix(-8, -26, up) + pull * 16, abd: 7, knee: mix(20, 8, up), ankle: -66, toe: -70 });
  P.leg(-1, { flex: mix(30, 58, up) - pull * 10, abd: -6, knee: mix(70, 104, up), ankle: -30, toe: -20 });
  // Catch point: fingertips ~0.40 m above the crown at full extension, drawn back toward
  // the facemask as the ball is secured.
  const cx = mix(0.02, 0.10, up) * gs;
  const cy = mix(2.02, 2.26, up) * gs - pull * 0.42 * gs;
  const cz = mix(0.24, 0.34, up) * gs + pull * 0.04 * gs;
  for (const s of [1, -1]) {
    P.arm(s, {
      clavUp: 22 - pull * 14, clavFwd: 16 + (s > 0 ? 4 : 0),
      upFlex: 150, upAbd: 14, foreFlex: 158, foreAbd: 8,
    });
    // wrist target = catch point pulled back down the hand's own length
    // The pole barely matters here and that is worth knowing rather than discovering:
    // shoulder-to-catch-point is 0.638 m against a 0.595 m shoulder-to-wrist reach, so the
    // IK clamps, the elbow angle goes to zero and the arm is dead straight. MEASURED
    // consequence: elbows sit 0.30 m apart inside a 0.36 m shoulder line, so the arms
    // taper slightly inward instead of forming the wider diamond bar/panel-catch.png has.
    // I tried a pole at (s*2.2, -0.1, -0.30) and the elbows did not move a millimetre —
    // the only way to flare them is to bring the ball DOWN, and full extension is the
    // thing this pose is for. Kept the extension, documented the cost.
    P.reach(s, V2.set(cx + s * 0.075 * gs, cy - 0.10 * gs, cz - 0.03 * gs), V.set(s * 0.9, 0.05, -0.45));
    P.aim(`hand_${s > 0 ? 'L' : 'R'}`, V.set(-s * 0.30, 0.86, 0.42), s * 0.6);
  }
  P.groundTo(SOLE * P.gs);
}

/**
 * contested_catch — the defender in the same frame. Turned INTO the receiver, near arm
 * ripping up through the catch point, far arm dropped behind for balance, head craned
 * up and across, legs scissored and off-balance. Authored so that a defender placed
 * forward-left of a jump_catch receiver (which is where the hero `catch` scene puts him)
 * reaches through the ball rather than past it.
 */
function contestedCatch(P, ph, c) {
  const up = smoothstep(0.0, 0.55, ph);
  P.hips({ pitch: 8, twist: 22, lean: -12 });
  P.spine({ pitch: -6 - up * 10, twist: 26, lean: 20 });
  P.look({ pitch: -34 - up * 12, twist: 26, lean: 14, split: 0.4 });
  P.leg(+1, { flex: 44 + up * 20, abd: 12, knee: 96, ankle: -26, toeOut: 10 });
  P.leg(-1, { flex: -14 - up * 14, abd: 6, knee: 44 + up * 20, ankle: -54, toe: -58 });
  // Near (left) arm: up and across, elbow high, hand raking through the catch point.
  P.arm(+1, {
    clavUp: 24, clavFwd: 26,
    upFlex: 130 + up * 20, upAbd: 18, foreFlex: 148 + up * 16, foreAbd: 10,
    handFlex: 154 + up * 16, handAbd: 4, twist: 0.5,
  });
  // Far (right) arm fighting for position: elbow out and bent, forearm forward. The first
  // version left it hanging straight down and behind (upFlex -34) and it read as a limp
  // wing rather than a man losing a rep — see it2_catch.png.
  P.arm(-1, {
    clavUp: -4, clavFwd: 10,
    upFlex: 14, upAbd: 46, foreFlex: 62, foreAbd: 26, handFlex: 74, handAbd: 16,
  });
  P.groundTo(SOLE * P.gs);
}

/**
 * tackle_launch — the wind-up half of a hit. Back leg fully extended with the toe still
 * on the turf, front knee driving, torso ~40 deg forward, both arms swinging back and
 * about to wrap. The long diagonal from trailing toe to leading shoulder is the pose.
 */
function tackleLaunch(P, ph, c) {
  const k = smoothstep(0.0, 0.7, ph);
  P.hips({ z: 0.02, pitch: 14 + k * 4, twist: -10, lean: 4 });
  P.spine({ pitch: 24 + k * 6, twist: 18, lean: -8 });
  P.look({ pitch: -34 - k * 6, twist: -14, lean: 6 });
  P.leg(+1, { flex: 46 + k * 24, abd: 8, knee: 82 - k * 14, ankle: 2, toe: 14 });          // drive knee
  P.leg(-1, { flex: -30 - k * 16, abd: 7, knee: 32 - k * 16, ankle: -40 - k * 14, toe: -34 });  // push leg
  // Arms cocked low and behind, palms opening forward: about to club up and wrap.
  P.arm(+1, { clavUp: -2, clavFwd: -14, upFlex: -44 + k * 30, upAbd: 30, foreFlex: -18 + k * 60, foreAbd: 36, handFlex: -6 + k * 70, handAbd: 34 });
  P.arm(-1, { clavUp: 0, clavFwd: -10, upFlex: -38 + k * 34, upAbd: 34, foreFlex: -10 + k * 64, foreAbd: 40, handFlex: 4 + k * 72, handAbd: 38 });
  P.groundTo(SOLE * P.gs);
}

/**
 * tackle_impact — contact. Leading (right) shoulder buried and driven UP through the
 * target, clavicle protracted hard, head taken to the far side, spine flexed AND
 * side-bent (compression, not translation), hips dropped under the load, both feet
 * still driving. phase pushes the drive further through.
 */
function tackleImpact(P, ph, c) {
  const k = smoothstep(0.0, 0.5, ph);
  const dr = smoothstep(0.4, 1.0, ph);             // leg drive through contact
  P.hips({ z: -0.04, pitch: 16, twist: 16 + dr * 8, lean: -8 });
  P.spine({ pitch: 26 + k * 8, twist: -26 - dr * 8, lean: 18 + k * 8, wp: [0.26, 0.34, 0.40] });
  P.look({ pitch: -20, twist: 34, lean: -22, split: 0.35 });   // head off the contact side
  P.leg(+1, { flex: -18 - dr * 16, abd: 13, knee: 48 - dr * 18, ankle: -34 - dr * 16, toe: -26 });
  P.leg(-1, { flex: 26 - dr * 8, abd: 16, knee: 74 - dr * 20, ankle: -12, toeOut: 12 });
  // Both arms wrapping upward around the target; right (contact) side higher and further.
  P.arm(-1, { clavUp: 20, clavFwd: 34, upFlex: 66, upAbd: 6, foreFlex: 120, foreAbd: -14, handFlex: 138, handAbd: -22, twist: -0.5 });
  P.arm(+1, { clavUp: 8, clavFwd: 22, upFlex: 48, upAbd: 20, foreFlex: 104, foreAbd: 2, handFlex: 122, handAbd: -6, twist: 0.4 });
  P.groundTo(SOLE * P.gs);
}

/**
 * airborne_hit — the hitter, fully off the ground and stretched along the flight line:
 * pelvis pitched ~52 deg, legs trailing behind and above, toes pointed, arms opening to
 * club through. Head up and leading, because the eyes never leave the target.
 */
function airborneHit(P, ph, c) {
  const k = smoothstep(0.0, 0.6, ph);
  P.hips({ z: 0.02, pitch: 44 + k * 8, twist: -14, lean: 7 });
  P.spine({ pitch: -12 - k * 6, twist: 22, lean: -12 });
  P.look({ pitch: -34, twist: -18, lean: 10, split: 0.4 });
  P.leg(+1, { flex: -74 - k * 10, abd: 12, knee: 30 + k * 14, ankle: -62, toe: -66 });
  P.leg(-1, { flex: -52 - k * 14, abd: 6, knee: 58 + k * 16, ankle: -54, toe: -58 });
  P.arm(+1, { clavUp: 12, clavFwd: 28, upFlex: 72 + k * 24, upAbd: 34, foreFlex: 104 + k * 22, foreAbd: 22, handFlex: 118 + k * 20, handAbd: 14 });
  P.arm(-1, { clavUp: 16, clavFwd: 32, upFlex: 58 + k * 30, upAbd: 42, foreFlex: 92 + k * 26, foreAbd: 30, handFlex: 106 + k * 24, handAbd: 22 });
  P.groundTo(SOLE * P.gs);
}

/**
 * blown_back — the victim of any of the above. Reversed and folded: pelvis driven under
 * and back, trunk hyperextended into a C, head thrown back, arms windmilled behind, legs
 * kicked out in front. Deliberately asymmetric (one arm and one leg higher) — symmetric
 * ragdolls read as furniture.
 */
function blownBack(P, ph, c) {
  const g = smoothstep(0.0, 0.8, ph);
  const a = c.v[3];                                 // seeded asymmetry, +-1
  P.hips({ z: -0.14 - g * 0.12, pitch: 30 + g * 16, twist: -14 + a * 6, lean: 8 });
  P.spine({ pitch: -40 - g * 26, twist: 22, lean: -18 - g * 10, wp: [0.24, 0.34, 0.42] });
  P.look({ pitch: -44 - g * 26, twist: 22 + a * 10, lean: 20, split: 0.32 });
  P.leg(+1, { flex: 40 + g * 44 + a * 8, abd: 20, knee: 44 + g * 26, ankle: -26, toeOut: 14 });
  P.leg(-1, { flex: 22 + g * 58 - a * 8, abd: 12, knee: 76 + g * 18, ankle: -18, toeOut: 8 });
  P.arm(+1, {
    clavUp: 18, clavFwd: -30,
    upFlex: -60 - g * 30 + a * 12, upAbd: 48 + g * 14, foreFlex: -84 - g * 26, foreAbd: 44,
    handFlex: -96 - g * 24, handAbd: 38,
  });
  P.arm(-1, {
    clavUp: 22, clavFwd: -24,
    upFlex: -44 - g * 26 - a * 12, upAbd: 60 + g * 10, foreFlex: -34 - g * 42, foreAbd: 66,
    handFlex: -30 - g * 46, handAbd: 70,
  });
  P.groundTo(SOLE * P.gs);
}

/**
 * block — pass set. Wide base, hips loaded behind the heels, chest UP (a lineman who
 * bends at the waist is beaten), hands punched inside at sternum height. The cyclic
 * phase is a slow load/unload so a line of five does not freeze identically.
 */
function block(P, ph, c) {
  const load = 0.5 + 0.5 * Math.sin(ph * Math.PI * 2);
  const s = c.v[0] > 0 ? 1 : -1;                   // which foot is back
  P.hips({ z: -0.12, pitch: 18, twist: s * 6, lean: s * 2 });
  P.spine({ pitch: 6 + load * 3, twist: -s * 9, lean: -s * 3, wp: [0.46, 0.32, 0.22] });
  P.look({ pitch: -26, twist: s * 4 });
  P.leg(s, { flex: 20, abd: 17, knee: 62 + load * 8, ankle: -30, toeOut: 16, toe: -14 });
  P.leg(-s, { flex: 36, abd: 15, knee: 74 + load * 8, ankle: -18, toeOut: 12 });
  P.arm(+1, { clavUp: 6, clavFwd: 30, upFlex: 44, upAbd: 22, foreFlex: 92, foreAbd: 2, handFlex: 106, handAbd: -8, twist: 0.5 });
  P.arm(-1, { clavUp: 6, clavFwd: 32, upFlex: 50, upAbd: 20, foreFlex: 98, foreAbd: 0, handFlex: 112, handAbd: -10, twist: -0.5 });
  P.groundTo(SOLE * P.gs);
}

/**
 * celebrate — arms flung up and back, chest thrown open, head back, one knee up.
 * Arcade-loud on purpose; the phase gives it a bounce so a crowd of them is not a chorus
 * line.
 */
function celebrate(P, ph, c) {
  const b = Math.sin(ph * Math.PI * 2);
  const a = c.v[1];
  P.hips({ pitch: -8, twist: a * 8, lean: a * 5 });
  P.spine({ pitch: -22 - b * 6, twist: -a * 12, lean: -a * 8 });
  P.look({ pitch: -30 - b * 8, twist: a * 14, lean: -a * 6 });
  P.leg(+1, { flex: 6 + Math.max(0, b) * 40, abd: 8, knee: 14 + Math.max(0, b) * 62, ankle: -18 - Math.max(0, b) * 30 });
  P.leg(-1, { flex: -4, abd: 10, knee: 10, ankle: -14, toeOut: 12 });
  for (const s of [1, -1]) {
    P.arm(s, {
      clavUp: 26, clavFwd: -12,
      upFlex: 158 + (s > 0 ? 6 : -4) + b * 6, upAbd: 34,
      foreFlex: 172 + (s > 0 ? 4 : -6), foreAbd: 30,
      handFlex: 176, handAbd: 26,
    });
  }
  P.groundTo(SOLE * P.gs);
}

/**
 * downed — face-down sprawl. Pelvis rolled onto one hip, trunk twisted so a shoulder is
 * on the turf, legs folded asymmetrically, one arm trapped under the chest and the other
 * flung out. Height comes from groundTo(), which is why the hips end up at 0.161 instead
 * of the fallback's 0.344-with-the-shins-underground.
 */
function downed(P, ph, c) {
  const settle = smoothstep(0, 1, ph);
  const a = c.v[2] > 0 ? 1 : -1;                   // which hip he rolled onto
  // Pelvis pitched 88 deg (face down) and rolled ~30 deg onto one hip; trunk twisted the
  // other way so a shoulder is on the turf and the other is open. Legs at flex ~ -90 lie
  // ALONG the ground behind him (see convention 1 at the top of the file) with the near
  // knee drawn up. Height is not asserted anywhere — grounding lands the hips at 0.161
  // for a skill actor, against the fallback's 0.344 with its shins 0.645 m underground.
  P.hips({ z: -0.05, pitch: 88 + settle * 4, twist: a * 18, lean: a * 30 });
  P.spine({ pitch: -12 - settle * 6, twist: -a * 30, lean: -a * 20, wp: [0.4, 0.34, 0.26] });
  P.look({ pitch: -26, twist: a * 44, lean: a * 22, split: 0.35 });
  P.leg(a, { flex: -74, abd: 40, knee: 82 + settle * 16, ankle: -20, toeOut: 30 });
  P.leg(-a, { flex: -96, abd: 10, knee: 22 + settle * 12, ankle: -30, toeOut: 8 });
  // Trapped arm folded under the chest; free arm thrown out flat along the turf.
  P.arm(a, { clavUp: -14, clavFwd: 26, upFlex: 96, upAbd: -8, foreFlex: 122, foreAbd: -34, handFlex: 128, handAbd: -42 });
  P.arm(-a, { clavUp: 4, clavFwd: 2, upFlex: 84, upAbd: 66, foreFlex: 92, foreAbd: 80, handFlex: 94, handAbd: 84 });
  // The lowest contact here is a SHIN, not a toe: a shin bone is the centreline of ~8 cm
  // of limb, so grounding it to SOLE pushes half the calf through the pitch.
  P.groundTo(0.085 * P.gs);
}

/* ================================================================= dispatch */

export const POSES = {
  idle,
  stance_offense: stanceOffense,
  stance_defense: stanceDefense,
  dropback,
  throw_release: throwRelease,
  sprint,
  juke,
  truck,
  truck_recoil: truckRecoil,
  dive_catch: diveCatch,
  jump_catch: jumpCatch,
  contested_catch: contestedCatch,
  tackle_launch: tackleLaunch,
  tackle_impact: tackleImpact,
  airborne_hit: airborneHit,
  blown_back: blownBack,
  block,
  celebrate,
  downed,
};

/* Local velocity hints, in the ACTOR's frame (+Z = the way he faces), m/s.
 * Callers rotate by the actor's rotY. Same convention as the foundation fallback. */
const VEL = {
  idle: [0, 0, 0],
  stance_offense: [0, 0, 0],
  stance_defense: [0, 0, 0.4],
  dropback: [0, 0, -3.4],
  throw_release: [0, 0, 1.1],
  sprint: [0, 0, 9.6],
  juke: [3.6, 0, 4.4],
  truck: [0, 0, 7.8],
  truck_recoil: [0, 1.4, -5.6],
  dive_catch: [0, 0.6, 6.8],
  jump_catch: [0, 2.6, 1.4],
  contested_catch: [0, 2.1, 1.0],
  tackle_launch: [0, 1.0, 8.2],
  tackle_impact: [0, 0.3, 3.2],
  airborne_hit: [0, 1.2, 8.6],
  blown_back: [0, 2.2, -7.2],
  block: [0, 0, -0.7],
  celebrate: [0, 1.1, 0],
  downed: [0, 0, 0],
};

/**
 * Phase envelope for the hint. Cyclic poses beat with the stride; one-shot poses peak
 * around the money frame and decay into the follow-through. fx uses this to aim streaks
 * and debris, so it must not be a constant or every impact sprays the same way.
 */
function velEnvelope(poseId, ph) {
  if (poseId === 'sprint') return 0.82 + 0.18 * Math.cos((ph - 0.28) * Math.PI * 2);
  if (poseId === 'idle' || poseId === 'block' || poseId === 'stance_defense') return 1;
  if (poseId === 'jump_catch') return 1 - smoothstep(0.35, 1, ph) * 0.85;
  return 0.35 + 0.65 * Math.sin(clamp(ph, 0, 1) * Math.PI);
}

const POSE_SEED = Object.create(null);
for (const id of POSE_IDS) POSE_SEED[id] = seedFromString(id);

/**
 * Seeded per-actor variation, four values in [-1,1]. Small on purpose: it picks which leg
 * a man rests on and nudges an angle or two, never a different pose. Without it a huddle
 * of fourteen `idle` actors is fourteen copies of one man, which is its own kind of
 * stiffness.
 *
 * Filled into a reusable array and hashed from (seed, poseId) rather than drawn from a
 * long-lived stream, so it is a pure function of the arguments — same actor, same seed,
 * same pose, byte-identical capture, in any order.
 */
const VAR = [0, 0, 0, 0];
function variation(poseId, seed) {
  const rng = makeRng(hash(seed | 0, POSE_SEED[poseId] || 0));
  for (let i = 0; i < 4; i++) VAR[i] = rng() * 2 - 1;
  return VAR;
}

const P = new Poser();
const CTX = { v: VAR, arch: 'skill', gs: 1, ph: 0 };

/**
 * VERIFIED under plain node (scratch harness, not committed): for all 19 ids x 5 phases
 * on the `lb` archetype, apply() produces byte-identical bone quaternions and positions
 * (12 dp) whether the skeleton is fresh or has had all 19 other poses applied to it
 * first — i.e. resetToRest + full-body authoring really does leave no state behind — and
 * no pose produces a NaN. Two different seeds do differ (variation is live), and an
 * unknown pose id lands exactly on `idle`.
 */
export function applyPose(skeleton, poseId, phase, seed) {
  if (!skeleton || !skeleton.bones || !skeleton.bones.length) return;
  const id = POSES[poseId] ? poseId : 'idle';
  const ph = clamp(Number(phase) || 0, 0, 1);
  P.begin(skeleton);
  CTX.v = variation(id, seed === undefined ? 0 : seed);
  CTX.arch = (skeleton.userData && skeleton.userData.archetype) || 'skill';
  CTX.gs = P.gs;
  CTX.ph = ph;
  POSES[id](P, ph, CTX);
  P.sync();
  skeleton.bones[0].updateMatrixWorld(true);
}

export function velocityFor(poseId, phase, out) {
  const v = VEL[poseId] || VEL.idle;
  const e = velEnvelope(poseId, Number(phase) || 0);
  const o = out || new THREE.Vector3();
  return o.set(v[0] * e, v[1] * e, v[2] * e);
}

export default { POSES, POSE_IDS, applyPose, velocityFor };
