// PIECE turf-field — field geometry constants, light-bank rig, rung ladder config.
// Everything here is a pure constant or a pure function. No RNG, no clocks.
//
// FIELD COORDS (foundation): origin midfield, +X right sideline, +Z near sideline
// (camera side), +Y up, metres. Goal lines at |X| = 45.72, end lines |X| = 54.864,
// sidelines |Z| = 24.384.

import { RUNGS } from '../../foundation/quality.js';

export const YD = 0.9144;
export const FT = 0.3048;
export const IN = 0.0254;

/* ------------------------------------------------------------- dimensions */

export const GOAL_X = 50 * YD;            // 45.720  goal line
export const END_X = 60 * YD;             // 54.864  end line
export const HALF_W = 26.6667 * YD;       // 24.384  sideline (160 ft / 2)
export const LINE_HW = 2 * IN;            // 4-inch stripe, half width
export const GOAL_HW = 4 * IN;            // 8-inch goal line, half width
export const BORDER = 6 * FT;             // solid white border outside the sidelines
export const APRON = 9.0;                 // dark surround beyond the border

// NFL hash marks: 70 ft 9 in from each sideline -> 18 ft 6 in apart.
export const HASH_Z = HALF_W - 70.75 * FT;   // 2.8194
export const HASH_HALF_LEN = 1 * FT;         // 2 ft long, along X
export const TICK_LEN = 1 * FT;              // 1-yard ticks inside the sideline

// Yard numerals: 6 ft tall, 4 ft wide per digit, bottom 12 yards from the sideline.
export const NUM_BOT_Z = HALF_W - 12 * YD;   // 13.4112
export const NUM_TOP_Z = NUM_BOT_Z - 6 * FT; // 11.5824
export const DIGIT_W = 4 * FT;               // 1.2192
export const DIGIT_GAP = 2 * FT;             // 0.6096 between the two digits
export const ARROW_OFF = 2.55;               // arrow centre offset from the yard line
export const ARROW_LEN = 3 * FT;
export const ARROW_HW = 0.75 * FT;

// The mesh: the playing surface plus enough apron that the plane never ends on screen.
export const PLANE_X = 340;   // the ground, not just the field: the camera sets the horizon
export const PLANE_Z = 260;

// Mow stripes: 5-yard bands running sideline to sideline (banded along X).
export const MOW_PERIOD = 5 * YD;         // 4.572

/* ------------------------------------------------------------ light banks */
//
// The roof truss rig, as the TURF sees it. These drive the material's own
// reflection/sheen response — the bright pooled streaks a wet field throws back at a
// low camera, which no point light in a standard material can produce. Diffuse
// illumination still comes entirely from the scene lights, so this never
// double-counts what `stadium-lighting` puts in the scene.
//
// Ordered far-side first: with the camera on the +Z sideline the mirror ray points
// toward -Z, so the -Z banks are the ones that actually show. Truncating the list
// for a lower rung therefore drops the banks you cannot see.

export const BANKS = Object.freeze([
  [-47, 41.5, -35], [-19, 40.0, -35], [11, 41.5, -35], [39, 39.5, -35],
  [-63, 37.0, -22], [66, 38.5, -17],
  [-41, 41.5, 35], [-13, 40.5, 35], [17, 41.5, 35], [45, 39.0, 35],
  [-65, 37.5, 20], [62, 38.0, 18],
]);

export const MAX_BANKS = 12;

/* --------------------------------------------------------------- the ladder */
//
// RUNGS[n].turf is the foundation's turf class: 0 flat, 1 normal-mapped,
// 2 aniso + wet sheen, 3 shell grass. Class is the EXPENSIVE axis (it recompiles the
// program), so it only ever changes at a play boundary. Everything else below is a
// uniform and is free to change live.

const CLASS_CFG = [
  { // 0 — floor. One draw, one program, no damage buffer, no normal map.
    detail: 256, macro: 128, atlas: [512, 384], word: [512, 128], crest: 256,
    soil: 128, damage: 0, banks: 2, normalMap: false, aniso: false,
    detail2: false, shells: 0, soilDetail: false,
  },
  { // 1 — low. Normal-mapped, small damage buffer.
    detail: 256, macro: 128, atlas: [512, 384], word: [512, 128], crest: 256,
    soil: 256, damage: [512, 256], banks: 3, normalMap: true, aniso: false,
    detail2: false, shells: 0, soilDetail: true,
  },
  { // 2 — mid. Anisotropic wet sheen, stripe-aware normal, full damage.
    detail: 512, macro: 256, atlas: [1024, 768], word: [1024, 256], crest: 512,
    soil: 512, damage: [1024, 512], banks: 6, normalMap: true, aniso: true,
    detail2: true, shells: 0, soilDetail: true,
  },
  { // 3 — high. Adds near-camera shell grass.
    detail: 512, macro: 256, atlas: [1024, 768], word: [1024, 256], crest: 512,
    soil: 512, damage: [2048, 1024], banks: 10, normalMap: true, aniso: true,
    detail2: true, shells: 6, soilDetail: true,
  },
];

/** rungConfig(n) -> the full per-rung configuration, including sub-class knobs. */
export function rungConfig(rung) {
  const n = rung < 0 ? 0 : rung > 15 ? 15 : rung | 0;
  const cls = RUNGS[n].turf;
  const c = Object.assign({}, CLASS_CFG[cls]);
  c.rung = n;
  c.cls = cls;
  // Uniform-only knobs interpolate WITHIN a class so the ladder is 16 steps, not 4.
  if (cls === 3) {
    c.shells = n >= 14 ? 6 : 4;
    c.banks = n >= 14 ? 10 : 8;
  } else if (cls === 2) {
    c.banks = n >= 10 ? 6 : n >= 8 ? 5 : 4;
  } else if (cls === 1) {
    c.banks = n >= 5 ? 3 : 2;
  }
  c.shellRadius = cls === 3 ? (n >= 14 ? 13.0 : 10.0) : 0;
  return c;
}

/** The capture path is not on the ladder — it is always the top of the top class. */
export const CAPTURE_RUNG = 15;

/* ------------------------------------------------------------------ helpers */

export function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

/** Yard-line number painted at a given X, or 0 for "none". 50 at midfield. */
export function numberAtX(x) {
  const yd = Math.round(x / (10 * YD)) * 10;
  if (Math.abs(yd) > 40) return 0;
  return 50 - Math.abs(yd);
}

export default {
  YD, FT, IN, GOAL_X, END_X, HALF_W, LINE_HW, GOAL_HW, BORDER, APRON,
  HASH_Z, HASH_HALF_LEN, TICK_LEN, NUM_BOT_Z, NUM_TOP_Z, DIGIT_W, DIGIT_GAP,
  ARROW_OFF, ARROW_LEN, ARROW_HW, PLANE_X, PLANE_Z, MOW_PERIOD, BANKS, MAX_BANKS,
  rungConfig, CAPTURE_RUNG, clamp, numberAtX,
};
