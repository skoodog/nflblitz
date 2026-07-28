// PIECE stadium-lighting — the implementation behind registerWorld('lighting', ...).
//
// WHAT IS INVARIANT AT EVERY RUNG, ON EVERY TIER:
//   the key direction (back-left-high), the kicker direction (back-right, cooler and
//   half as strong), the field bounce, the hemisphere separation (blue-violet sky /
//   warm turf), the ACES response and the fog colour. Those five things are the value
//   structure, they cost nothing, and they are why a floor-tier frame still reads as
//   the bar: near-black midtones, blown highlights only at sources and rims.
//
// WHAT SCALES: the shadow map's frustum, the volumetric ladder (off -> baked haze ->
// billboard shafts -> occluded raymarched shafts), the storm dome, the rain and the
// bolt. All of it is visibility flags and uniform floats, so applyRung allocates
// nothing, compiles nothing and resizes nothing.
//
// THE SHADOW MAP IS SIZED ONCE, AT BUILD. Resizing a shadow map means disposing and
// reallocating a depth texture, and the budget for this piece is "0 shadow map
// reallocations after load". The rung moves the FRUSTUM instead, which is free and
// buys most of the same resolution back.

import * as THREE from 'three';
import { makeRng } from '../../foundation/rng.js';
import { RIG, FOG, PAL, rungSpec } from './config.js';
import { buildTowers } from './ring.js';
import { spriteAtlas, cloudField, beamDust, envEquirect } from './textures.js';
import { makeSpriteMaterial, makeShaftMaterial, makeSkyMaterial } from './materials.js';
import { buildAtmos, buildRain, buildShafts, buildVeil } from './volumetrics.js';
import { buildBolts, buildSkyDome, strikeState } from './storm.js';
import { makeSpriteMesh } from './spritebuf.js';

export const PIECE = 'stadium-lighting';

/* ---- module scratch. Allocated once; the frame loop never allocates. ------ */
const S_DIR = new THREE.Vector3();
const S_POS = new THREE.Vector3();

function hex3(h) {
  return [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
}

/** PMREM is per-renderer and per-seed; bake it once and reuse it forever. */
const ENV_CACHE = new Map();
function bakeEnv(renderer, towers, seed) {
  const key = `${seed}`;
  if (ENV_CACHE.has(key)) return ENV_CACHE.get(key);
  let env = null;
  try {
    const eq = envEquirect(towers, seed);
    eq.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const rt = pmrem.fromEquirectangular(eq);
    env = rt.texture;
    env.name = 'sl.env';
    pmrem.dispose();
    eq.dispose();
  } catch (e) {
    console.error('[stadium-lighting] IBL bake failed:', e);
    env = null;
  }
  ENV_CACHE.set(key, env);
  return env;
}

const impl = {
  piece: PIECE,

  _rung: 15,
  _spec: rungSpec(15),
  _parts: null,
  _mats: null,
  _lights: null,
  _shot: null,
  _seed: 7,
  _capture: true,
  _rainW: 0.25,
  _lightW: 0.35,
  _hazeW: 0.55,
  _boltRanges: null,
  _veilSize: null,

  build(ctx) {
    const T = ctx.THREE || THREE;
    const capture = ctx.quality === 'capture' || ctx.mode === 'capture';
    this._capture = capture;
    this._seed = ctx.seed | 0;

    const shot = ctx.shot || null;
    this._shot = shot;
    const w = (shot && shot.weather) || { rain: 0.25, lightning: 0.35, haze: 0.55 };
    this._rainW = w.rain;
    this._lightW = w.lightning;
    this._hazeW = w.haze;

    // `--variant=<0..15>` forces a rung so `iso_light_rungs` can be shot at 0/4/9/15
    // through the capture path, which never runs the adaptive scaler.
    let rung = 15;
    const v = ctx.variant;
    if (v !== undefined && v !== null && v !== '' && /^\d{1,2}$/.test(String(v))) {
      rung = Math.max(0, Math.min(15, parseInt(String(v), 10)));
    } else if (!capture && typeof ctx.rung === 'number') {
      rung = ctx.rung;
    }
    this._rung = rung;
    const spec = rungSpec(rung);
    this._spec = spec;

    const rng = makeRng(this._seed * 7919 + 31);
    const group = new T.Group();
    group.name = 'stadium-lighting';

    /* ---------------------------------------------------------- 1. LIGHTS */

    const key = new T.DirectionalLight(RIG.key.color, RIG.key.intensity);
    key.position.set(RIG.key.pos[0], RIG.key.pos[1], RIG.key.pos[2]);
    key.target.position.set(RIG.key.target[0], RIG.key.target[1], RIG.key.target[2]);
    key.castShadow = true;
    // sized ONCE — see the header note. 2048 at a 34 m frustum is 1.7 cm/texel, which
    // is finer than a facemask bar at the distances these cameras shoot from.
    const SM = capture ? 2048 : (rungSpec(rung).tier === 0 ? 512 : rungSpec(rung).tier === 1 ? 512 : rungSpec(rung).tier === 2 ? 1024 : 2048);
    key.shadow.mapSize.set(SM, SM);
    key.shadow.camera.near = 26;
    key.shadow.camera.far = 165;
    key.shadow.bias = spec.shadowBias;
    key.shadow.normalBias = spec.shadowNormalBias;
    key.name = 'sl.key';
    group.add(key, key.target);

    const kick = new T.DirectionalLight(RIG.kick.color, RIG.kick.intensity);
    kick.position.set(RIG.kick.pos[0], RIG.kick.pos[1], RIG.kick.pos[2]);
    kick.target.position.set(RIG.kick.target[0], RIG.kick.target[1], RIG.kick.target[2]);
    kick.castShadow = false;
    kick.name = 'sl.kick';
    group.add(kick, kick.target);

    const bounce = new T.DirectionalLight(RIG.bounce.color, RIG.bounce.intensity);
    bounce.position.set(RIG.bounce.pos[0], RIG.bounce.pos[1], RIG.bounce.pos[2]);
    bounce.target.position.set(RIG.bounce.target[0], RIG.bounce.target[1], RIG.bounce.target[2]);
    bounce.castShadow = false;
    bounce.name = 'sl.bounce';
    group.add(bounce, bounce.target);

    const hemi = new T.HemisphereLight(RIG.hemi.sky, RIG.hemi.ground, RIG.hemi.intensity);
    hemi.name = 'sl.hemi';
    group.add(hemi);

    // The lightning light. It EXISTS at every rung with intensity 0 so that a strike
    // never changes the light count — which would recompile every material in the
    // scene at exactly the wrong moment.
    const flash = new T.DirectionalLight(RIG.flash.color, 0);
    flash.position.set(RIG.flash.pos[0], RIG.flash.pos[1], RIG.flash.pos[2]);
    flash.target.position.set(RIG.flash.target[0], RIG.flash.target[1], RIG.flash.target[2]);
    flash.castShadow = false;
    flash.name = 'sl.flash';
    group.add(flash, flash.target);

    this._lights = { key, kick, bounce, hemi, flash };

    /* ------------------------------------------------------------ 2. FOG */

    // Graded exponential haze. The bowl carries its own height fog in its own shader;
    // this is what makes the TURF and the ACTORS recede into the same warm dark.
    if (ctx.scene) {
      const density = FOG.density * (0.55 + 0.85 * this._hazeW);
      ctx.scene.fog = new T.FogExp2(FOG.color, density);
      this._fogD = density;
    } else {
      this._fogD = FOG.density;
    }

    /* -------------------------------------------------------- 3. THE AIR */

    const towers = buildTowers(capture);
    const atlas = spriteAtlas();
    const dust = beamDust();
    const cloud = cloudField();

    const matSprite = makeSpriteMaterial(atlas, this._fogD);
    const matShaft = makeShaftMaterial(dust, PAL.shaftWarm, PAL.shaftCool);
    matShaft.uniforms.uFogD.value = this._fogD;
    const matSky = makeSkyMaterial(cloud, PAL.cloudDark, PAL.cloudLit, PAL.cloudRim);

    const vol = new T.Group();
    vol.name = 'sl.volumetrics';

    const sky = new T.Mesh(buildSkyDome(capture), matSky);
    sky.name = 'sl.sky';
    sky.frustumCulled = false;
    sky.castShadow = false; sky.receiveShadow = false;
    sky.userData.wantShadow = false;
    sky.renderOrder = -9;              // after stadium-env's sky (-10), before the bowl
    vol.add(sky);

    const atmos = makeSpriteMesh(buildAtmos(towers, capture, rng), matSprite, 'sl.atmos', 9);
    vol.add(atmos);

    const shafts = new T.Mesh(buildShafts(towers, capture), matShaft);
    shafts.name = 'sl.shafts';
    shafts.frustumCulled = false;
    shafts.castShadow = false; shafts.receiveShadow = false;
    shafts.userData.wantShadow = false;
    shafts.renderOrder = 7;            // under the flares, over the world
    shafts.matrixAutoUpdate = false;
    vol.add(shafts);

    const rain = makeSpriteMesh(buildRain(capture, rng), matSprite, 'sl.rain', 10);
    vol.add(rain);

    const bolts = buildBolts(rng);
    const bolt = makeSpriteMesh(bolts.geometry, matSprite, 'sl.bolt', 11);
    this._boltRanges = bolts.ranges;
    vol.add(bolt);

    const veil = makeSpriteMesh(buildVeil(), matSprite, 'sl.veil', 12);
    veil.matrixAutoUpdate = true;
    vol.add(veil);

    group.add(vol);

    this._mats = { matSprite, matShaft, matSky };
    this._parts = { vol, sky, atmos, shafts, rain, bolt, veil };
    this._veilSize = veil.geometry.attributes.aSize;

    /* -------------------------------------------------------- 4. THE IBL */

    const env = ctx.renderer ? bakeEnv(ctx.renderer, towers, this._seed) : null;

    this.applyRung(rung, null, ctx);
    this.update(ctx.t || 0, ctx);

    const self = this;
    return {
      group,
      key,
      env,
      exposure: 1.0,
      applyToRenderer(renderer) {
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.0;
        // Soft PCF only on the capture path: it is five taps instead of one and the
        // runtime path has a frame wall. The shadow's SHAPE is identical either way.
        renderer.shadowMap.type = self._capture ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
        renderer.shadowMap.enabled = true;
      },
    };
  },

  /* ------------------------------------------------------------ per frame */

  update(t, ctx) {
    const P = this._parts;
    if (!P) return;
    const M = this._mats;
    const L = this._lights;
    const spec = this._spec;

    const shot = (ctx && ctx.shot) || this._shot;
    if (shot && shot.weather) {
      this._rainW = shot.weather.rain;
      this._lightW = shot.weather.lightning;
    }

    const st = strikeState(t, this._seed, this._lightW);

    /* --- the scene-wide burst ------------------------------------------- */
    L.flash.intensity = st.flash * 5.8;
    // The clouds only need to BREATHE with the strike. Push this and they go white,
    // and a white sky is a sky a white-hot bolt cannot be seen against.
    M.matSky.uniforms.uFlash.value = st.flash * 0.16;

    /* --- gains: 0 atmos, 1 rain, 2 bolt, 3 veil ------------------------- */
    const g = M.matSprite.uniforms.uGains.value;
    g.x = spec.hazeGain * spec.flareGain;
    g.y = spec.rain ? spec.rainGain * (0.28 + 1.05 * this._rainW) : 0;
    g.z = spec.bolt ? st.bolt * 15.0 : 0;
    // 0.34 put a quarter-stop of white over the ENTIRE frame during a strike and
    // flattened bar/panel-midair_hit's value structure completely. The flash's job
    // is done by the flash LIGHT (which makes a real rim from the strike's
    // direction) and by the clouds; the veil is only the last few percent.
    g.w = spec.veil ? st.flash * 0.10 : 0;

    M.matSprite.uniforms.uT.value = t;
    M.matShaft.uniforms.uT.value = t;
    M.matSky.uniforms.uT.value = t;

    /* --- which bolt is discharging -------------------------------------- */
    if (g.z > 0 && this._boltRanges) {
      const r = this._boltRanges[st.index % this._boltRanges.length];
      P.bolt.geometry.setDrawRange(r[0], r[1]);
      P.bolt.visible = true;
    } else {
      P.bolt.visible = false;
    }

    /* --- the flash veil rides the camera -------------------------------- */
    if (g.w > 0 && ctx && ctx.camera) {
      const cam = ctx.camera;
      cam.getWorldDirection(S_DIR);
      S_POS.copy(cam.position).addScaledVector(S_DIR, 2.2);
      P.veil.position.copy(S_POS);
      const hh = 2.2 * Math.tan((cam.fov * Math.PI) / 360) * 2.4;
      const ww = hh * (cam.aspect || 1.777);
      const a = this._veilSize.array;
      for (let i = 0; i < 4; i++) { a[i * 2] = ww; a[i * 2 + 1] = hh; }
      this._veilSize.needsUpdate = true;
      P.veil.visible = true;
    } else {
      P.veil.visible = false;
    }

    /* --- shaft occluders: the bodies standing in the beams --------------- */
    const occ = M.matShaft.uniforms.uOcc.value;
    if (spec.shaftOcclude && shot && shot.actors) {
      const acts = shot.actors;
      const n = acts.length < 6 ? acts.length : 6;
      for (let i = 0; i < n; i++) {
        const a = acts[i];
        const o = occ[i];
        o.x = a.pos[0];
        o.y = a.pos[1] + 1.05;
        o.z = a.pos[2];
        o.w = a.archetype === 'lineman' ? 1.12 : a.archetype === 'lb' ? 1.02 : 0.94;
      }
      for (let i = n; i < 6; i++) occ[i].w = 0;
      M.matShaft.uniforms.uOccluding.value = 1;
    } else {
      for (let i = 0; i < 6; i++) occ[i].w = 0;
      M.matShaft.uniforms.uOccluding.value = 0;
    }
  },

  /* ------------------------------------------------------------ the ladder */

  applyRung(rung, r, ctx) {
    const spec = rungSpec(rung);
    this._spec = spec;
    this._rung = rung;
    const P = this._parts;
    const M = this._mats;
    const L = this._lights;
    if (!P) return;

    P.atmos.visible = !!spec.flares;
    P.shafts.visible = !!spec.shafts;
    P.sky.visible = !!spec.sky;
    P.rain.visible = !!spec.rain;
    // bolt + veil visibility is decided per frame in update(); the rung only gates them

    M.matShaft.uniforms.uSteps.value = spec.shaftSteps;
    M.matShaft.uniforms.uStepLen.value = spec.shaftSteps > 1 ? 0.95 : 0;
    M.matShaft.uniforms.uOccluding.value = spec.shaftOcclude;
    M.matShaft.uniforms.uGain.value = spec.tier >= 3 ? 2.15 : 1.75;
    M.matSky.uniforms.uDetail.value = spec.cloudOctaves >= 3 ? 1.0 : 0.45;

    // The shadow FRUSTUM moves, never the shadow MAP. See the header note.
    if (L && L.key && spec.shadowHalf > 0) {
      const c = L.key.shadow.camera;
      const h = spec.shadowHalf;
      if (c.left !== -h) {
        c.left = -h; c.right = h; c.top = h; c.bottom = -h;
        c.updateProjectionMatrix();
      }
      L.key.shadow.bias = spec.shadowBias;
      L.key.shadow.normalBias = spec.shadowNormalBias;
    }
    void r; void ctx;
  },

  /** stadiumLightAt(x, z) -> 0..1 — how hot the rig is over a field position.
   *  Other pieces may ignore it; turf and fx can use it to bias specular. */
  lightHeat(x, z) {
    const d = Math.hypot(x / 55, z / 32);
    return Math.max(0, Math.min(1, 1.05 - d * 0.35));
  },
};

export default impl;
