// PIECE uniform-kit — TEMPORARY presentation stance.
//
// READ THIS BEFORE JUDGING IT. Posing belongs to `pose-animation`, and this file does not
// try to take that slot: it registers nothing, and it runs on NOTHING except the four iso
// scenes this piece owns (`shot.piece === 'uniform-kit'`). It exists because the pose slot
// is still the foundation fallback, whose `idle` is documented as "a stiff, near-A-pose
// stance", and a locker-room hero shot of a mannequin standing at attention would be
// judging this piece's MATERIALS through someone else's placeholder.
//
// The bar's model stands with the feet at shoulder width and slightly toed out, the knees
// unlocked, the arms carried ~22 degrees off the body with the hands forward of the hips,
// the chest lifted and the weight very slightly onto one leg. That is what this writes —
// bone quaternions only, exactly the surface `pose.apply` is allowed to touch, and never
// geometry or materials.
//
// DELETE THIS FILE the moment pose-animation ships a `hero_stance` pose id; the iso scenes
// then just ask for it by name. It is 90 lines and it is scaffolding, not a position.

const STANCE = {
  //  bone          x       y       z
  hips: [0.000, 0.000, -0.028],
  spine01: [-0.030, 0.000, 0.014],
  spine02: [-0.040, 0.020, 0.010],
  chest: [0.026, 0.000, 0.000],
  neck: [0.020, -0.030, 0.000],
  head: [-0.010, 0.045, 0.000],

  clavicle_L: [0.000, 0.000, -0.070],
  clavicle_R: [0.000, 0.000, 0.070],
  upperarm_L: [-0.150, 0.060, -0.400],
  upperarm_R: [-0.130, -0.060, 0.420],
  forearm_L: [-0.100, 0.000, -0.230],
  forearm_R: [-0.090, 0.000, 0.250],
  hand_L: [-0.180, 0.000, -0.120],
  hand_R: [-0.180, 0.000, 0.120],

  thigh_L: [-0.070, 0.175, 0.150],
  thigh_R: [-0.045, -0.160, -0.135],
  shin_L: [0.185, 0.000, 0.000],
  shin_R: [0.130, 0.000, 0.000],
  foot_L: [-0.115, 0.060, 0.000],
  foot_R: [-0.085, -0.055, 0.000],
  toe_L: [0.040, 0.000, 0.000],
  toe_R: [0.030, 0.000, 0.000],
};

/**
 * apply(THREE, skeleton) — absolute local rotations, so it is idempotent and does not
 * depend on what the pose fallback happened to leave behind.
 */
export function applyStance(THREE, skeleton) {
  if (!skeleton || !skeleton.bones) return false;
  const e = new THREE.Euler();
  for (let i = 0; i < skeleton.bones.length; i++) {
    const b = skeleton.bones[i];
    const r = STANCE[b.name];
    if (!r) continue;
    e.set(r[0], r[1], r[2], 'XYZ');
    b.quaternion.setFromEuler(e);
  }
  skeleton.bones[0].updateMatrixWorld(true);
  return true;
}

/** Walk the live scene once and stance every skinned actor in it. */
export function stanceScene(THREE, scene) {
  let n = 0;
  scene.traverse((o) => {
    if (o.isSkinnedMesh && o.skeleton) { if (applyStance(THREE, o.skeleton)) n++; }
  });
  return n;
}

export default { applyStance, stanceScene };
