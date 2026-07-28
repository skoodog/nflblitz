// PIECE stadium-lighting — the numbers.
//
// THE INVARIANT (never scales with the rung, at any tier, ever):
//   key direction, rim placement, colour temperature separation, and the value
//   structure — near-black midtones, blown highlights ONLY at sources and rims.
// Everything below marked RUNG is a visibility flag or a uniform float.
//
// WHY THE KEY IS WHERE IT IS. Every action panel in bar/ puts a hard white rim on the
// upper-LEFT/BACK edge of the hero and drops the camera-facing front into near-black.
// The hero cameras all sit at +Z looking toward -Z, so screen-left is -X and "behind"
// is -Z. A key at (-52, 46, -40) rakes the subject from back-left-high: the silhouette
// picks up a hot edge along its top and left, and the front gets nothing but the fill.
// A second, COOLER kicker from back-right at half the power produces the double rim
// visible on the ball carrier in panel-truck. That two-source separation — warm hot
// key, cool kicker — is most of what makes the bar's players read as sculpted rather
// than lit.

/* ------------------------------------------------------- the bowl plan curve
 * MIRRORED, not imported: piece files may not import another piece's files. These
 * four numbers must stay equal to stadium-env/config.js BOWL.{halfX,halfZ,power}
 * and lightR/lightY0/lightY1/lightTowers*, or our shafts and flares will not sit on
 * their luminaires. If the bowl is ever re-proportioned, this block moves with it.
 */
export const RING = {
  halfX: 80.0,
  halfZ: 46.0,
  power: 4.4,
  lightR: 31.40,
  lightY0: 21.60,
  lightY1: 23.80,
  towersCapture: 30,
  towersLive: 22,
  towerSpan: 0.62,     // 62% lit arc / 38% dark gap — the ratio that reads as a real rig
};

/* ------------------------------------------------------------------ the rig */

// LEVELS. Measured against the bar, not guessed: in panel-midair_hit and panel-leveler
// the jersey in shadow sits around 8-14% sRGB and the lit shoulder edge is clipped
// white. That is a contrast ratio of roughly 25:1 between the key and everything else.
// The first pass ran key 5.35 / kick 2.35 / hemi 0.62 / bounce 0.30 and produced a
// milky, evenly-lit frame with no rim at all — the fill was within 3 stops of the key,
// so nothing could read as an edge. These numbers hold the key where it was and CRUSH
// the fill, which is what actually makes a rim.
export const RIG = {
  /** THE KEY. Warm metal-halide white, back-left-high. Makes the rim. Casts. */
  key: {
    color: 0xfff2d8,
    pos: [-48, 58, -36],
    target: [0, 1.25, 0],
    intensity: 7.40,
  },
  /** THE KICKER. Cool, back-right, quarter power. The second rim edge. No shadow. */
  kick: {
    color: 0x9dc0ff,
    pos: [46, 40, -31],
    target: [0, 1.35, 0],
    intensity: 1.70,
  },
  /** FIELD BOUNCE. Warm sodium, from below and slightly camera-side. Barely there. */
  bounce: {
    color: 0xffab5e,
    pos: [7, -9, 27],
    target: [0, 1.4, 0],
    intensity: 0.13,
  },
  /** SKY FILL. Blue-violet above, warm turf bounce below. This is what makes the
   *  shadows TEAL rather than grey, and it has to stay under a twentieth of the key. */
  hemi: {
    sky: 0x1b4272,
    ground: 0x1a140c,
    intensity: 0.38,
  },
  /** LIGHTNING. Intensity is 0 except during a strike; the light itself never moves. */
  flash: {
    color: 0xcdd8ff,
    pos: [66, 44, -96],
    target: [0, 4, 0],
  },
};

/**
 * Graded exponential haze, and the ONLY tool this piece has for the single largest
 * value error in the A/B: the field.
 *
 * A directional key has no distance falloff, so a flat turf plane lit at a 44-degree
 * elevation returns the SAME value at 5 m and at 80 m — and the frame ends up with a
 * pale slab across its whole lower half, while bar/panel-qb_dropback puts the field
 * at roughly a third of that value everywhere except right under the subject. Density
 * 0.0105 leaves the near field (under 10 m) untouched, takes 24% out at 40 m, and
 * crushes everything past 70 m into the warm dark. Note that stadium-env's bowl runs
 * its own fog inside its own shader and is unaffected by scene.fog, so this darkens
 * the TURF and the distant ACTORS only — which is exactly the region that is wrong.
 */
export const FOG = {
  color: 0x181104,
  density: 0.0105,
};

/* ---------------------------------------------------------------- the grade */

export const PAL = {
  lightCore: [1.00, 0.965, 0.885],   // luminaire core — blown
  lightHalo: [1.00, 0.815, 0.520],   // sodium-warm halo around it
  streak: [0.72, 0.815, 1.00],       // anamorphic streak, cool
  shaftWarm: [1.00, 0.760, 0.430],   // beam near the source
  shaftCool: [0.560, 0.660, 0.940],  // beam far from the source, scattered blue
  hazeWarm: [0.560, 0.455, 0.330],
  hazeCool: [0.230, 0.275, 0.400],
  cloudDark: [0.055, 0.048, 0.082],
  cloudLit: [0.310, 0.222, 0.148],   // sodium light-pollution on the cloud base
  cloudRim: [0.150, 0.170, 0.270],
  boltCore: [1.00, 0.980, 1.00],
  boltHalo: [0.620, 0.560, 1.00],
  rain: [0.640, 0.740, 0.940],
};

/* --------------------------------------------------------------- the ladder
 * The 0-15 rung ladder, expressed ONLY as visibility flags and uniform floats so
 * applyRung never allocates, never compiles and never resizes anything.
 *
 * volumetric column of RUNGS[]:  0 off | 1 baked haze | 2 billboard shafts | 3 raymarched
 *
 * Light-volume DRAW CALL budget by tier is 0 / 2 / 8 / 16. That is why the floor tier
 * turns every one of this piece's drawables off: at floor the frame is carried by the
 * key, the kicker, the fill and the fog alone — the same key direction, the same rim,
 * the same near-black midtones, just without the atmosphere. Handsome, not flat.
 */
export function rungSpec(rung) {
  const r = rung < 0 ? 0 : rung > 15 ? 15 : rung | 0;
  const tier = r <= 2 ? 0 : r <= 6 ? 1 : r <= 11 ? 2 : 3;
  const vol = r <= 2 ? (r === 0 ? 0 : 1) : r <= 6 ? 1 : r <= 11 ? 2 : 3;
  return {
    tier,
    vol,
    /* drawables — the sum of the `true`s is this piece's light-volume draw count */
    flares: tier >= 1,           // 1 draw
    haze: tier >= 1,             // 1 draw
    shafts: tier >= 2,           // 1 draw
    sky: tier >= 2,              // 1 draw
    rain: tier >= 2,             // 1 draw
    veil: tier >= 2,             // 1 draw
    bolt: tier >= 3,             // 1 draw
    /* uniform floats */
    shaftSteps: tier >= 3 ? 5 : 1,
    shaftOcclude: tier >= 2 ? 1 : 0,
    cloudOctaves: tier >= 3 ? 3 : 2,
    hazeGain: tier === 0 ? 0 : tier === 1 ? 0.72 : 1.0,
    flareGain: tier === 1 ? 0.80 : 1.0,
    rainGain: tier >= 3 ? 1.0 : 0.65,
    /* shadow frustum: tight where we can afford the resolution, wide where we cannot */
    shadowHalf: tier === 0 ? 0 : tier === 1 ? 30 : tier === 2 ? 22 : 17,
    shadowBias: tier <= 1 ? -0.0016 : tier === 2 ? -0.0009 : -0.00055,
    shadowNormalBias: tier <= 1 ? 0.055 : tier === 2 ? 0.032 : 0.020,
  };
}

export default { RING, RIG, FOG, PAL, rungSpec };
