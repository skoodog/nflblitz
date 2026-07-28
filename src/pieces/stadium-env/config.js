// PIECE stadium-env — the numbers. Everything the bowl's silhouette depends on lives
// here so it can be tuned against a capture without touching the builders.
//
// WHY THE BOWL IS ANGULARLY COMPRESSED. Solved against the frozen `qb_dropback`
// camera (eye 1.75 m, pitch -1.69 deg, 34 deg vfov). A real NFL bowl 74 m away puts
// its upper-deck rim at 21 deg of elevation — 17% ABOVE the top of frame — so the roof
// light banks that dominate the top edge of every bar panel would simply not exist in
// our frame. The bar's stadium is a movie stadium: the whole stack (wall / lower bowl /
// dark concourse band / upper deck / ribbon / light banks / dark roof) reads inside one
// 34 deg frame. So the profile below is solved BACKWARDS from screen fractions:
//
//   screen f    elevation   what lands there
//   0.425       0.86 deg    top of the field wall  (LED ribbon 1)
//   0.278       5.83 deg    top of the lower bowl
//   0.275       5.94        concourse walkway
//   0.194       8.69        top of the dark fascia (suites, vomitories, LED ribbon 2)
//   0.184       9.02        upper deck first row
//   0.096      11.95        upper deck top
//   0.071      12.80        rim wall
//   0.02-0.05  ~14          the light banks
//   above                   dark roof soffit, cantilevered inward
//
// f = 0.5 - (elev + 1.69) / 34 ;  y = 1.75 + (43.4 + r) * tan(elev)  for the far
// sideline (base at z = -36, so 43.4 m of horizontal distance from the hero eye).

export const BOWL = {
  /** Plan curve: a superellipse (squircle) around the field. */
  halfX: 80.0,
  halfZ: 46.0,
  power: 4.4,
  /** Loop resolution. Capture gets more; both are trivially cheap. */
  segLive: 256,
  segCapture: 384,

  /**
   * The lofted profile. r = metres outward along the plan normal, y = height.
   * `seg` names the band BELOW each level (level i -> i+1).
   *   band ids used by the struct shader:
   *   0 wall  1 apron  2 lowerRake(crowd)  3 concourse  4 fascia
   *   5 shelf 6 upperRake(crowd)  7 rim  8 roofFace  9 soffit
   */
  profile: [
    { r: 0.00, y: 0.00, band: 0 },   // wall base, at field level
    { r: 0.00, y: 3.00, band: 1 },   // wall top  -> LED ribbon 1 lives on this face
    { r: 3.10, y: 3.55, band: 2 },   // apron walkway
    { r: 14.10, y: 9.35, band: 3 },  // lower bowl top   (27.8 deg rake, 15 rows)
    { r: 15.90, y: 9.70, band: 4 },  // concourse walkway
    { r: 16.50, y: 13.60, band: 5 }, // fascia top: suites, vomitories, LED ribbon 2
    { r: 18.60, y: 14.30, band: 6 }, // upper deck first row (under the dark overhang)
    { r: 29.50, y: 20.30, band: 7 }, // upper deck top   (28.8 deg rake)
    { r: 31.00, y: 22.90, band: 8 }, // rim wall
    { r: 31.80, y: 26.40, band: 9 }, // roof fascia -> the light banks hang here
    { r: 19.50, y: 29.00, band: -1 },// roof soffit, cantilevered back INWARD over the deck
  ],

  /** Which profile segments are crowd (their own mesh + material). */
  crowdBands: [2, 6],

  /** Seating sections around the loop (aisle every section). */
  sectionsLower: 40,
  sectionsUpper: 48,

  /**
   * LED ribbon rings, as a fraction of their band's span. Both are held near 1.0 m of
   * real height: the first pass made them 1.5-3 m and at 45 m they read as billboards
   * rather than as the thin bright line the bar puts under its upper deck.
   */
  ribbons: [
    { band: 0, f0: 0.66, f1: 0.79, row: 0, periodM: 14, inset: 0.09 },
    { band: 4, f0: 0.15, f1: 0.34, row: 1, periodM: 24, inset: 0.12 },
  ],

  /**
   * Roof light banks, grouped into TOWERS. A perfectly even ring of luminaires reads
   * as a dotted line and is the single most artificial thing the first pass produced;
   * real rigs cluster 5-7 heads per bank with dark gaps between banks, and the gaps
   * are what make the top edge of the frame look photographed.
   */
  lightTowersLive: 22,
  lightTowersCapture: 30,
  lightsPerTower: 6,
  lightRows: 2,
  lightY0: 21.60,
  lightY1: 23.80,
  lightR: 31.40,
};

/** Field constants we need locally (foundation FIELD is the authority). */
export const FIELDX = {
  goalLineX: 45.72,
  endLineX: 54.864,
  halfWidth: 24.4,
};

/**
 * THE GRADE. Authored in sRGB hex; the shaders linearise with c*c (gamma 2.0),
 * which is close enough to 2.2 at these values and costs one multiply instead of a
 * pow. Nothing here scales with the rung — value structure and colour never do.
 */
export const PALETTE = {
  concrete: '#23252b',
  concreteLo: '#0e0f13',
  fasciaDark: '#0c0d11',
  soffit: '#07080b',
  rimWall: '#181a20',
  handrail: '#6d747f',
  suiteGlow: '#ffcf8a',
  vomGlow: '#ffb257',
  wallPad: '#14161c',
  hazeNear: '#2d3442',
  hazeFar: '#4a4438',
  hazeWarm: '#5a4c46',
  skyZenith: '#05070d',
  skyHorizon: '#232a3a',
  skyGlow: '#6b6250',
  lightCore: '#fff6e2',
  lightHalo: '#ffdca8',
  goalpost: '#f0c419',
  pylon: '#ff5a1f',
};

/** Rung ladder. Everything here is a visibility flag or a uniform float. */
export function rungSpec(rung) {
  const r = rung < 0 ? 0 : rung > 15 ? 15 : rung | 0;
  const tier = r <= 2 ? 0 : r <= 6 ? 1 : r <= 11 ? 2 : 3;
  return {
    tier,
    crowdDetail: tier === 0 ? 0.0 : tier === 1 ? 0.75 : 1.0,
    flash: tier === 0 ? 0.0 : tier === 1 ? 0.7 : 1.0,
    scroll: tier === 0 ? 0 : 1,
    sideline: tier === 0 ? 0 : tier === 1 ? 0.5 : 1.0,
    lightFrac: tier === 0 ? 0.45 : tier === 1 ? 0.7 : 1.0,
    screens: 1,
    haloes: tier === 0 ? 0 : 1,
    props: 1,
  };
}

export default { BOWL, PALETTE, FIELDX, rungSpec };
