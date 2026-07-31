// PIECE pose-animation — the posing kit.
//
// WHY THIS FILE EXISTS AT ALL.
// The rig contract (src/foundation/rig.js) says every bone's rest quaternion is identity
// and every bone's local axes are world-aligned at bind. The tempting consequence is
// "just write Euler angles per bone" — which is what the foundation fallback does, and it
// is exactly why the fallback looks stiff. As soon as ONE parent moves (a spine that
// flexes 40 degrees, a clavicle that shrugs) every child Euler you wrote in world terms is
// now measured in a rotated frame, so an arm you meant to point straight up points
// somewhere else, and the only way to fix it is to fudge numbers until the picture looks
// right. That fudging is the stiffness: nobody dares put a big number anywhere.
//
// So this kit inverts the problem. You declare the WORLD direction each segment should
// point, and it solves the local quaternion:
//
//     local = inverse(parentWorldQuat) * (rotation taking REST.dir onto the wanted dir)
//
// which is exact, because REST.dir is that bone's bind-pose world direction and the bind
// world rotation is identity. Result: `spine flexes 45 deg` and `the left forearm points
// up and forward` are independent statements. That independence is what lets a pose be
// exaggerated without becoming incoherent.
//
// It also keeps a live FK cache (world quat + world pos per bone), which buys three
// things a pure-Euler approach cannot have:
//   * two-bone IK, so "the fingertips are ON the ball" is a statement, not a hope;
//   * groundTo(), so a crouch or a sprawl actually touches the turf instead of floating
//     or sinking (the fallback's `downed` sinks the hips to 0.35 and the knees go under
//     the pitch — measured, see scratch verify run in the piece README comment in poses.js);
//   * measurement, which is how every number in poses.js was checked.
//
// Writes ONLY bone.quaternion and bone.position. Never geometry, never materials.

import * as THREE from 'three';
import { BONES, PARENT, REST, TIPS, resetToRest } from '../../foundation/rig.js';

export const D = Math.PI / 180;

export function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
export function mix(a, b, t) { return a + (b - a) * t; }
export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
/** Wrap into [0,1). */
export function wrap01(x) { return x - Math.floor(x); }

/**
 * Cyclic keyframe curve. keys = [[u,v], ...] with u ascending in [0,1).
 * Smoothstep between keys, wrapping past the last key back to the first.
 * Used for the run cycle: a table of measured angles reads far better in review than a
 * stack of sine terms, and it is trivial to retune one instant of the stride.
 */
export function curve(u, keys) {
  const n = keys.length;
  if (n === 0) return 0;
  if (n === 1) return keys[0][1];
  const x = wrap01(u);
  for (let i = 0; i < n; i++) {
    const a = keys[i];
    const b = i + 1 < n ? keys[i + 1] : [keys[0][0] + 1, keys[0][1]];
    if (x >= a[0] && x < b[0]) {
      const t = smoothstep(a[0], b[0], x);
      return mix(a[1], b[1], t);
    }
  }
  // x is before the first key: interpolate from the wrapped last key.
  const a = keys[n - 1];
  const b = [keys[0][0] + 1, keys[0][1]];
  const t = smoothstep(a[0] - 1, b[0] - 1, x);
  return mix(a[1], b[1], t);
}

const IDX = Object.create(null);
BONES.forEach((n, i) => { IDX[n] = i; });

/* ----------------------------------------------------------------- direction */

/**
 * "Swing" parameterisation for a limb segment, in DEGREES, in the actor's frame
 * (+Z forward, +X to the actor's LEFT, +Y up).
 *
 *   side   +1 = the actor's left limb, -1 = the right limb
 *   flex   0 = hanging straight down, +90 = pointing straight forward,
 *          +180 = pointing straight up, negative = behind the body
 *   abduct 0 = in the sagittal plane, + = swung away from the midline
 *
 * The abduction is applied FIRST and the flexion second, deliberately: that ordering
 * keeps the lateral component alive all the way to +180 (arms overhead still spread),
 * whereas flex-then-abduct flips the lateral sign past 90 degrees. I got that wrong on
 * the first pass of jump_catch — both arms ended up crossed over the head.
 */
export function swing(out, side, flexDeg, abductDeg) {
  const c = side * abductDeg * D;
  const f = flexDeg * D;
  return out.set(Math.sin(c), -Math.cos(c) * Math.cos(f), Math.cos(c) * Math.sin(f));
}

/**
 * Pitch/yaw direction, for feet and toes where "how far is the toe below horizontal"
 * is the natural thing to say. pitch: + = up, - = toe down. yaw: + = toward +X.
 * Rest foot measures pitch = -16.1 deg, yaw = +1.1 deg (from REST.foot_L.dir).
 */
export function dirPitchYaw(out, pitchDeg, yawDeg) {
  const p = pitchDeg * D, y = yawDeg * D;
  return out.set(Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p));
}

/* --------------------------------------------------------------------- Poser */

const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e0 = new THREE.Euler();
const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();

/** Points sampled by groundTo()/lowest(): every part of a body that can touch turf. */
const CONTACTS = [
  ['toe_L', true], ['toe_R', true], ['foot_L', false], ['foot_R', false],
  ['shin_L', false], ['shin_R', false], ['hand_L', true], ['hand_R', true],
  ['forearm_L', false], ['forearm_R', false], ['head', true], ['hips', false],
  ['chest', false], ['spine01', false],
];

export class Poser {
  constructor() {
    this.by = Object.create(null);
    this.gs = 1;
    this.P = null;
    this.wq = BONES.map(() => new THREE.Quaternion());
    this.wp = BONES.map(() => new THREE.Vector3());
    this.rest = BONES.map((n) => new THREE.Vector3().fromArray(REST[n].dir));
    this.tipLen = BONES.map(() => 0);
    this._dirty = true;
    this._hipRest = 0.98;
  }

  /** Bind to a skeleton, reset to rest, and prime the FK cache. */
  begin(skeleton) {
    const bones = skeleton.bones;
    resetToRest(skeleton);
    for (let i = 0; i < bones.length; i++) this.by[bones[i].name] = bones[i];
    const ud = skeleton.userData || {};
    this.gs = ud.globalScale || 1;
    this.P = ud.proportions || null;
    this._hipRest = REST.hips.pos[1] * this.gs;
    // Terminal-bone tip lengths need the same per-chain multiplier anatomy applied to
    // the child offsets, because there is no child bone to read the length from.
    const P = this.P;
    const arm = P ? P.arm : 1, leg = P ? P.leg : 1, torso = P ? P.torso : 1;
    for (let i = 0; i < BONES.length; i++) {
      const n = BONES[i];
      let m = 1;
      if (n === 'hand_L' || n === 'hand_R') m = arm;
      else if (n === 'toe_L' || n === 'toe_R') m = leg;
      else if (n === 'head') m = torso;
      this.tipLen[i] = (TIPS[n] ? REST[n].len : 0) * m * this.gs;
    }
    this._dirty = true;
    this.sync();
    return this;
  }

  /** Recompute every world quat/pos from the current locals. 23 bones; call freely. */
  sync() {
    if (!this._dirty) return this;
    for (let i = 0; i < BONES.length; i++) {
      const n = BONES[i];
      const b = this.by[n];
      if (!b) continue;
      const p = PARENT[n];
      if (!p) {
        this.wq[i].copy(b.quaternion);
        this.wp[i].copy(b.position);
      } else {
        const pi = IDX[p];
        this.wq[i].copy(this.wq[pi]).multiply(b.quaternion);
        this.wp[i].copy(b.position).applyQuaternion(this.wq[pi]).add(this.wp[pi]);
      }
    }
    this._dirty = false;
    return this;
  }

  worldPos(name, out) { this.sync(); return (out || _v3).copy(this.wp[IDX[name]]); }
  worldQuat(name, out) { this.sync(); return (out || _q2).copy(this.wq[IDX[name]]); }

  /** World position of a terminal bone's tip (fingertip, toe tip, crown). */
  tip(name, out) {
    this.sync();
    const i = IDX[name];
    const o = (out || _v3).copy(this.rest[i]).applyQuaternion(this.wq[i]).multiplyScalar(this.tipLen[i]);
    return o.add(this.wp[i]);
  }

  /** Local Euler (XYZ, radians). Use for spine/neck/head where twist matters. */
  rot(name, x, y, z) {
    const b = this.by[name];
    if (!b) return this;
    _e0.set(x, y, z, 'XYZ');
    b.quaternion.setFromEuler(_e0);
    this._dirty = true;
    return this;
  }

  /**
   * Point a bone's rest direction along `dir` IN WORLD SPACE, with an optional roll
   * about that direction. The whole point of the kit — see the header.
   */
  aim(name, dir, twist) {
    const b = this.by[name];
    if (!b) return this;
    this.sync();
    const i = IDX[name];
    _v0.copy(dir).normalize();
    _q0.setFromUnitVectors(this.rest[i], _v0);
    if (twist) _q0.premultiply(_q1.setFromAxisAngle(_v0, twist));
    const p = PARENT[name];
    if (p) b.quaternion.copy(this.wq[IDX[p]]).invert().multiply(_q0);
    else b.quaternion.copy(_q0);
    this._dirty = true;
    return this;
  }

  /* --------------------------------------------------------------- body parts */

  /**
   * Hip block. x/y/z are metres of translation on top of the rest hip height (scaled
   * with the actor), pitch/twist/lean are degrees.
   *   pitch + = pelvis tips forward (anterior tilt)
   *   twist + = pelvis turns to the actor's LEFT
   *   lean  + = pelvis drops/leans to the actor's LEFT
   */
  hips(o) {
    const b = this.by.hips;
    if (!b) return this;
    const s = this.gs;
    b.position.set((o.x || 0) * s, this._hipRest + (o.y || 0) * s, (o.z || 0) * s);
    this.rot('hips', (o.pitch || 0) * D, (o.twist || 0) * D, -(o.lean || 0) * D);
    return this;
  }

  /**
   * Spine chain. Total bend, distributed over spine01/spine02/chest.
   * Weights are lumbar-heavy for flexion and thoracic-heavy for twist, which is how a
   * real trunk works and is why an arched back reads as an arch and not as a hinge.
   *   pitch + = forward flexion,  - = extension (arch back)
   *   twist + = shoulders turn to the actor's LEFT
   *   lean  + = side-bend to the actor's LEFT
   */
  spine(o) {
    const p = (o.pitch || 0) * D, t = (o.twist || 0) * D, l = (o.lean || 0) * D;
    const wp = o.wp || [0.34, 0.34, 0.32];
    const wt = o.wt || [0.20, 0.34, 0.46];
    const wl = o.wl || [0.38, 0.34, 0.28];
    this.rot('spine01', p * wp[0], t * wt[0], -l * wl[0]);
    this.rot('spine02', p * wp[1], t * wt[1], -l * wl[1]);
    this.rot('chest', p * wp[2], t * wt[2], -l * wl[2]);
    return this;
  }

  /** Neck + head, degrees. pitch + = chin down. Split 45/55 neck/head by default. */
  look(o) {
    const p = (o.pitch || 0) * D, t = (o.twist || 0) * D, l = (o.lean || 0) * D;
    const k = o.split === undefined ? 0.45 : o.split;
    this.rot('neck', p * k, t * k, -l * k);
    this.rot('head', p * (1 - k), t * (1 - k), -l * (1 - k));
    return this;
  }

  /**
   * One arm, in degrees. side +1 = left. Every angle is a WORLD swing (see swing()),
   * so `upFlex:170` means "the upper arm points nearly straight up" no matter what the
   * spine is doing.
   *   clavUp / clavFwd : shoulder elevation (shrug) and protraction. Rest is (-9, -2).
   *   upFlex/upAbd     : humerus
   *   foreFlex/foreAbd : forearm (absolute, NOT relative to the humerus — the elbow's
   *                      hinge sign flips as the humerus passes overhead and deriving it
   *                      cost me two wrong catch poses)
   *   handFlex/handAbd : hand segment; omit to keep it in line with the forearm
   *   twist            : roll of the hand about its own axis
   */
  arm(side, o) {
    const S = side > 0 ? 'L' : 'R';
    const e = (o.clavUp === undefined ? -9 : o.clavUp) * D;
    const pr = (o.clavFwd === undefined ? -2 : o.clavFwd) * D;
    _v1.set(side * Math.cos(e) * Math.cos(pr), Math.sin(e), Math.cos(e) * Math.sin(pr));
    this.aim(`clavicle_${S}`, _v1);
    this.aim(`upperarm_${S}`, swing(_v1, side, o.upFlex || 0, o.upAbd || 0));
    const ff = o.foreFlex === undefined ? o.upFlex || 0 : o.foreFlex;
    const fa = o.foreAbd === undefined ? o.upAbd || 0 : o.foreAbd;
    this.aim(`forearm_${S}`, swing(_v1, side, ff, fa));
    const hf = o.handFlex === undefined ? ff : o.handFlex;
    const ha = o.handAbd === undefined ? fa : o.handAbd;
    this.aim(`hand_${S}`, swing(_v1, side, hf, ha), (o.twist || 0) * D);
    return this;
  }

  /**
   * One leg, in degrees. side +1 = left.
   *   flex  + = thigh forward,  - = thigh behind the body
   *   abd   + = knee out from the midline
   *   knee  + = flexion (shin swings behind the thigh). A true hinge, so deriving the
   *             shin from thigh-minus-knee IS safe here (unlike the elbow).
   *   ankle : foot pitch from HORIZONTAL, - = toe down (rest is -16)
   *   toeOut: foot yaw, + = toward +X
   *   toe   : toe-segment pitch, defaults to a couple of degrees above the foot
   */
  leg(side, o) {
    const S = side > 0 ? 'L' : 'R';
    const flex = o.flex || 0, abd = o.abd || 0, knee = o.knee || 0;
    this.aim(`thigh_${S}`, swing(_v1, side, flex, abd));
    this.aim(`shin_${S}`, swing(_v1, side, flex - knee, abd * 0.55));
    const ank = o.ankle === undefined ? -16 : o.ankle;
    const yaw = (o.toeOut === undefined ? 4 : o.toeOut) * side;
    this.aim(`foot_${S}`, dirPitchYaw(_v1, ank, yaw));
    this.aim(`toe_${S}`, dirPitchYaw(_v1, o.toe === undefined ? ank + 14 : o.toe, yaw));
    return this;
  }

  /**
   * Two-bone IK for one arm: put the WRIST on `target` (world space, actor frame),
   * with the elbow pushed toward `pole`.
   *
   * Solved in the plane of (shoulder -> target, pole): law of cosines for the included
   * angle, then the upper segment is the unit vector at that angle off the target line,
   * on the pole side. No sign ambiguity, no axis-order trap.
   *
   * This exists for exactly one reason: a catch is judged on whether the hands are ON
   * the ball. Guessing shoulder angles gets you within ~12 cm; that reads as a drop.
   * The clavicle is a PARENT of the shoulder, so set clavUp/clavFwd (via arm()) before
   * calling this, or the shoulder moves out from under the solution.
   */
  reach(side, target, pole) {
    const S = side > 0 ? 'L' : 'R';
    this.sync();
    // MUST be a copy: this.wp[] entries are live cache vectors and the aim() calls below
    // re-run sync(), which would move the "shoulder" out from under the elbow maths.
    const sh = _v4.copy(this.wp[IDX[`upperarm_${S}`]]);
    const L1 = this.by[`forearm_${S}`].position.length();
    const L2 = this.by[`hand_${S}`].position.length();
    _v0.copy(target).sub(sh);
    let dist = _v0.length();
    if (dist < 1e-5) { _v0.set(0, -1, 0); dist = 1e-5; }
    const dmax = (L1 + L2) * 0.999;
    const dmin = Math.abs(L1 - L2) + 1e-4;
    dist = clamp(dist, dmin, dmax);
    _v0.normalize();                                   // unit shoulder -> target
    const cosA = clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1);
    const A = Math.acos(cosA);
    // perpendicular component of the pole, in the plane
    _v1.copy(pole).normalize();
    _v1.addScaledVector(_v0, -_v1.dot(_v0));
    if (_v1.lengthSq() < 1e-8) _v1.set(0, 0, 1).addScaledVector(_v0, -_v0.z);   // degenerate pole
    _v1.normalize();
    // upper segment direction
    _v2.copy(_v0).multiplyScalar(Math.cos(A)).addScaledVector(_v1, Math.sin(A)).normalize();
    this.aim(`upperarm_${S}`, _v2);
    // elbow, then the forearm direction straight at the target
    _v1.copy(sh).addScaledVector(_v2, L1);
    _v2.copy(target).sub(_v1).normalize();
    this.aim(`forearm_${S}`, _v2);
    return this;
  }

  /* ----------------------------------------------------------------- grounding */

  /** Lowest world Y of any part of the body that could touch the turf. */
  lowest() {
    this.sync();
    let m = Infinity;
    for (let i = 0; i < CONTACTS.length; i++) {
      const [n, useTip] = CONTACTS[i];
      const v = useTip ? this.tip(n, _v2) : this.worldPos(n, _v2);
      if (v.y < m) m = v.y;
    }
    return m;
  }

  /**
   * Slide the whole body vertically so its lowest contact sits at `y`.
   * Called at the end of every GROUNDED pose. Without it, any pose with real knee
   * flexion either floats (fallback `stance_*`: hips dropped 0.12 but the feet stay at
   * rest, so the actor hovers) or buries its feet.
   */
  groundTo(y) {
    const b = this.by.hips;
    if (!b) return this;
    const d = y - this.lowest();
    b.position.y += d;
    this._dirty = true;
    this.sync();
    return this;
  }

  /** Push the whole body up so nothing dips below `y`. For airborne poses. */
  clearAbove(y) {
    const low = this.lowest();
    if (low >= y) return this;
    return this.groundTo(y);
  }
}

export default { Poser, swing, dirPitchYaw, curve, mix, clamp, smoothstep, D };
