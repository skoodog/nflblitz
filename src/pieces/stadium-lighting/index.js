// PIECE: stadium-lighting  (plan id "night-lighting")
// SLOT:  world.lighting   -> registerWorld('lighting', impl)
// OWNS:  src/pieces/stadium-lighting/**  and  shots/stadium-lighting/**, shots/night-lighting/**
// HERO PANELS: midair_hit, qb_dropback   (also appears in leveler)
//
// WHAT THIS PIECE CLAIMS
//   Every photon. A five-light rig whose key rakes the subject from back-left-high to
//   make the hard white rim the bar puts on every shoulder pad and helmet, a cooler
//   half-power kicker from back-right for the second rim, warm sodium field bounce, a
//   blue-violet sky fill and a lightning light that lives at intensity 0. Then the
//   air: graded exponential fog, thirty cylindrically-billboarded volumetric shafts
//   with analytic occlusion so bodies carve real cylinders of darkness downstream of
//   themselves, an fBm-torn haze layer, authored anamorphic lens flares on every
//   luminaire (there is no bloom pass in the post chain, so this IS the bloom), GPU
//   rain, a three-layer scrolling storm dome and a three-variant branching lightning
//   system with a scene-wide flash. Plus a FLOAT procedural IBL baked from this exact
//   stadium, so helmets get the hot specular pips a real night rig puts on them.
//
// WHAT IT COSTS  (counted, at rung 15 / capture)
//   6 draw calls, 3 shader programs, ~3.1k triangles, ~1.3 MB of texture plus a
//   ~0.7 MB PMREM environment, ONE 2048 shadow map allocated once and never resized.
//   Against the recut budget of 0/2/8/16 light-volume draws, 0/2k/12k/40k triangles,
//   1/2/3/4 programs and 0/1/4/10 MB at floor/low/mid/high: inside every line at
//   every tier except texture bytes at LOW, where the shared 0.5 MB atlas plus the
//   0.7 MB environment is ~1.2 MB against a 1.0 MB cap. Called out, not hidden.
//
// THE LADDER (config.js rungSpec)
//   0-2   floor  ZERO drawables. Key + kicker + bounce + hemi + fog only, no shadow
//                map. Same key direction, same rim, same near-black midtones.
//   3-6   low    + flares and haze (1 draw), 512 shadow on a wide frustum.
//   7-11  mid    + billboard shafts with occlusion, storm dome, rain, veil. 1024 map.
//   12-15 high   + 5-step raymarched shafts, branching bolt geometry. 2048 map.
//
// CAPTURE — NOTE THE SIZE AND THE TIMEOUT.
//   The committed frames were shot at 1280x720 with --accum=16 --warmup=3. That is NOT
//   a quality choice, it is a pipeline one: with stadium-env, turf-field and
//   character-anatomy all live, a default 1920x1080 / accum=32 capture of any world
//   scene is 40 renders of a ~250k-triangle scene under SwiftShader, and `shoot.mjs`
//   dies on its HARD-CODED 120 s `page.screenshot` timeout (shoot.mjs:259) long after
//   __BLITZ_READY__ has been set. `--timeout=` raises page.goto but not that one, so a
//   full-size capture of this scene cannot currently complete. compare.mjs normalises
//   both images to 720 px anyway, so the A/B is unaffected. Reported, not patched —
//   scripts/ belongs to PerfCore.
//
//   node scripts/shoot.mjs --scene=iso_light  --accum=16 --warmup=3 --w=1280 --h=720 \
//        --timeout=660000 --out=shots/night-lighting/iso_light.png
//   node scripts/shoot.mjs --scene=iso_light_rungs --variant=0  ...  (variant = rung)
//   node scripts/compare.mjs --panel=midair_hit --shot=shots/night-lighting/iso_light.png \
//                            --out=shots/night-lighting/cmp-r1.png
//
// EXPORTED FOR OTHER PIECES
//   REG.world.lighting.lightHeat(x, z) -> 0..1 rig intensity over a field position.

import { registerWorld, registerIsoShot } from '../../foundation/registry.js';
import lighting from './lighting.js';

export const PIECE = 'stadium-lighting';

registerWorld('lighting', lighting);

/* --------------------------------------------------------------- iso shots */

const OFF = { visible: false };
const NOCALL = { visible: false };

/**
 * iso_light — THE RIM TEST.
 * Three grey-clay mannequins under the rig at hero framing. Nothing else in this
 * frame is a variable: no team colour, no uniform detail, no callout. If the key is
 * placed correctly, all three carry a hard bright edge along their upper-LEFT/BACK
 * silhouette and their camera-facing fronts fall into near-black, which is the exact
 * language of bar/panel-midair_hit and bar/panel-leveler.
 */
registerIsoShot('iso_light', {
  piece: PIECE,
  panel: 'midair_hit',
  camera: { pos: [2.15, 1.62, 5.55], target: [-0.35, 1.22, -0.55], fov: 33, roll: -1.4 },
  lens: { fStop: 2.0, focusDist: 5.6, bokehScale: 1.2, shutter: 1 / 80 },
  exposure: 1.0,
  weather: { rain: 0.28, lightning: 0.30, haze: 0.58 },
  actors: [
    { id: 'a', team: 'NYC', variant: 'home', archetype: 'lb', pose: 'stance_defense', phase: 0.35, pos: [-0.35, 0, 0.15], rotY: 0.42, hero: true },
    { id: 'b', team: 'NYC', variant: 'home', archetype: 'lineman', pose: 'block', phase: 0.5, pos: [-3.05, 0, -2.30], rotY: 1.05 },
    { id: 'c', team: 'NYC', variant: 'home', archetype: 'skill', pose: 'sprint', phase: 0.45, pos: [2.55, 0, -1.55], rotY: -0.55 },
  ],
  hud: OFF,
  callout: NOCALL,
  note: 'THE RIM TEST. Three grey mannequins, no other variable. Hard white edge on the upper-left/back, front into deep shadow, near-black midtones.',
});

/**
 * iso_shafts — THE VOLUMETRIC TEST.
 * A low camera looking up across the field, so the light banks and the beams hanging
 * under them fill the upper third the way they do in bar/panel-qb_dropback. Six
 * bodies are standing in the beams: every one of them should be carving a visible
 * cylinder of shadow downstream of itself.
 */
registerIsoShot('iso_shafts', {
  piece: PIECE,
  panel: 'qb_dropback',
  camera: { pos: [7.4, 1.30, 17.5], target: [-5.5, 8.2, -13.0], fov: 43, roll: 1.1 },
  lens: { fStop: 2.4, focusDist: 14.0, bokehScale: 1.0, shutter: 1 / 80 },
  exposure: 1.02,
  weather: { rain: 0.35, lightning: 0.30, haze: 0.72 },
  actors: [
    { id: 'a', team: 'NYC', variant: 'home', archetype: 'qb', pose: 'dropback', phase: 0.55, pos: [1.2, 0, 4.0], rotY: 0.35, hero: true },
    { id: 'b', team: 'CHI', variant: 'away', archetype: 'lb', pose: 'sprint', phase: 0.4, pos: [-4.6, 0, -1.2], rotY: 2.1 },
    { id: 'c', team: 'NYC', variant: 'home', archetype: 'lineman', pose: 'block', phase: 0.5, pos: [5.6, 0, -3.4], rotY: -1.2 },
    { id: 'd', team: 'CHI', variant: 'away', archetype: 'lineman', pose: 'block', phase: 0.6, pos: [8.4, 0, -6.0], rotY: 2.4 },
    { id: 'e', team: 'CHI', variant: 'away', archetype: 'skill', pose: 'sprint', phase: 0.7, pos: [-9.5, 0, -8.5], rotY: -2.2 },
    { id: 'f', team: 'NYC', variant: 'home', archetype: 'skill', pose: 'sprint', phase: 0.25, pos: [-1.5, 0, -12.0], rotY: 2.8 },
  ],
  hud: OFF,
  callout: NOCALL,
  note: 'THE VOLUMETRIC TEST. Beams descending from the roof rig through haze, with six bodies carving occlusion cylinders into them.',
});

/**
 * iso_storm — THE SKY TEST.
 * Angled up through the roof oculus so the storm dome is actually in frame: three
 * scrolling cloud layers, sodium light-pollution on their bases, cool sky on their
 * tops, rain crossing the beams, and two silhouetted bodies along the bottom edge for
 * scale and for one more rim.
 */
registerIsoShot('iso_storm', {
  piece: PIECE,
  panel: 'midair_hit',
  camera: { pos: [0.8, 1.25, 23.0], target: [-4.6, 17.5, -19.0], fov: 50, roll: -0.8 },
  lens: { fStop: 3.2, focusDist: 26.0, bokehScale: 0.8, shutter: 1 / 60 },
  exposure: 1.05,
  weather: { rain: 0.62, lightning: 0.55, haze: 0.80 },
  actors: [
    { id: 'a', team: 'NYC', variant: 'home', archetype: 'lb', pose: 'stance_defense', phase: 0.3, pos: [-2.6, 0, 15.5], rotY: 0.6, hero: true },
    { id: 'b', team: 'CHI', variant: 'away', archetype: 'lineman', pose: 'block', phase: 0.5, pos: [4.2, 0, 13.0], rotY: -1.4 },
  ],
  hud: OFF,
  callout: NOCALL,
  note: 'THE SKY TEST. Storm dome through the roof oculus: layered scrolling cloud with lit bases, rain, haze, and the light-bank ring across the lower frame.',
});

/**
 * iso_lightning — THE STRIKE.
 * weather.lightning = 1.0 puts the rig into storm mode, and strike 0 is authored to
 * land 20 ms before t=0, so the default capture time catches a branching bolt at full
 * brightness with the scene-wide flash just past its attack. The bolt's lower half
 * runs down BEHIND the bowl and is occluded by it, which is what a real strike over a
 * stadium looks like from inside one.
 */
registerIsoShot('iso_lightning', {
  piece: PIECE,
  panel: 'midair_hit',
  camera: { pos: [1.8, 1.40, 25.0], target: [15.2, 20.0, -28.0], fov: 54, roll: 1.6 },
  lens: { fStop: 3.5, focusDist: 40.0, bokehScale: 0.7, shutter: 1 / 60 },
  exposure: 0.98,
  weather: { rain: 0.58, lightning: 1.0, haze: 0.72 },
  actors: [
    { id: 'a', team: 'CHI', variant: 'away', archetype: 'lb', pose: 'sprint', phase: 0.45, pos: [3.6, 0, 17.0], rotY: 1.9, hero: true },
    { id: 'b', team: 'NYC', variant: 'home', archetype: 'skill', pose: 'sprint', phase: 0.7, pos: [-3.4, 0, 15.5], rotY: 2.3 },
  ],
  hud: OFF,
  callout: NOCALL,
  note: 'THE STRIKE. Multi-branch bolt + scene-wide flash + exposure burst on the clouds, all a pure function of t. Shoot at --t=0 for the peak, --t=0.35 for the falloff.',
});

/**
 * iso_light_rungs — THE LADDER.
 * The same frame at four rungs, shot with --variant=0|4|9|15. The rung-0 frame has
 * ZERO drawables from this piece and no shadow map, and it still has to carry the
 * same key direction, the same rim on the same edge, and the same near-black
 * midtones. If it does not, the ladder is broken and the floor tier is ugly.
 */
registerIsoShot('iso_light_rungs', {
  piece: PIECE,
  panel: 'qb_dropback',
  camera: { pos: [3.4, 1.68, 8.2], target: [-1.2, 3.4, -6.5], fov: 39, roll: -1.0 },
  lens: { fStop: 2.4, focusDist: 9.0, bokehScale: 1.0, shutter: 1 / 80 },
  exposure: 1.0,
  weather: { rain: 0.30, lightning: 0.30, haze: 0.62 },
  actors: [
    { id: 'a', team: 'NYC', variant: 'home', archetype: 'lb', pose: 'stance_defense', phase: 0.35, pos: [-0.2, 0, 1.2], rotY: 0.5, hero: true },
    { id: 'b', team: 'CHI', variant: 'away', archetype: 'lineman', pose: 'block', phase: 0.5, pos: [-3.4, 0, -1.6], rotY: 1.2 },
    { id: 'c', team: 'NYC', variant: 'home', archetype: 'skill', pose: 'sprint', phase: 0.45, pos: [3.2, 0, -2.4], rotY: -0.7 },
  ],
  hud: OFF,
  callout: NOCALL,
  note: 'THE LADDER. Shoot with --variant=0 / 4 / 9 / 15. Rung 0 draws nothing from this piece and must still read as a night game, not a flat-lit one.',
});

export default { PIECE };
