// PIECE stadium-env — world.stadium.
//
// FIVE draws and FIVE programs for an entire night bowl:
//   1  bowl      crowd + structure, merged, branching on a per-vertex mask
//   2  emissive  both LED ribbon rings + four video walls, one atlas, one mesh
//                (2 end-zone giants + 2 sideline fascia boards)
//   3  glow      every halo in the stadium, view-aligned in the vertex shader
//   4  sky       one inverted sphere
//   5  props     goalposts, pylons, benches, scaffolds, ~150 sideline bodies
//
// Nothing in update() allocates: three Vector3 copies and four float writes.

import * as THREE from 'three';
import { BOWL, PALETTE, FIELDX, rungSpec } from './config.js';
import { buildBowl, pushRibbon, pushPanel, emissiveGeometry } from './bowlgeo.js';
import { crowdTile, emissiveAtlas, glowSprite, skyTexture, ATLAS_V } from './textures.js';
import { makeBowlMaterial, makeEmissiveMaterial, makeGlowMaterial, makeSkyMaterial, lin } from './shader.js';
import { buildProps, buildGlows } from './props.js';
import { hash01 } from '../../foundation/rng.js';

/* -------------------------------------------------------------- utilities */

function mergeBowl(a, b) {
  const g = new THREE.BufferGeometry();
  const keys = ['position', 'uv', 'color', 'aMask'];
  const sizes = { position: 3, uv: 2, color: 3, aMask: 2 };
  for (const k of keys) {
    const A = a.getAttribute(k), B = b.getAttribute(k);
    const out = new Float32Array(A.array.length + B.array.length);
    out.set(A.array, 0);
    out.set(B.array, A.array.length);
    g.setAttribute(k, new THREE.BufferAttribute(out, sizes[k]));
  }
  const ai = a.getIndex(), bi = b.getIndex();
  const off = a.getAttribute('position').count;
  const idx = new Uint32Array(ai.count + bi.count);
  for (let i = 0; i < ai.count; i++) idx[i] = ai.getX(i);
  for (let i = 0; i < bi.count; i++) idx[ai.count + i] = bi.getX(i) + off;
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  a.dispose(); b.dispose();
  return g;
}

function teamRecord(ctx, abbr) {
  try {
    if (ctx.brand && typeof ctx.brand.byId === 'function') return ctx.brand.byId(abbr);
    if (ctx.brand && Array.isArray(ctx.brand.teams)) {
      return ctx.brand.teams.find((t) => t.id === abbr || t.abbr === abbr) || ctx.brand.teams[0];
    }
  } catch (e) { /* fall through */ }
  return null;
}

function colOf(rec, key, fallback) {
  if (rec && rec.colors && typeof rec.colors[key] === 'string') return rec.colors[key];
  return fallback;
}

/* ------------------------------------------------------------------ impl */

const impl = {
  piece: 'stadium-env',

  _g: null,
  _mats: null,
  _parts: null,
  _rung: 15,
  _heat: null,

  build(ctx) {
    const T = ctx.THREE || THREE;
    const capture = ctx.quality === 'capture';
    const shot = ctx.shot || {};
    const hud = shot.hud || {};
    const weather = shot.weather || {};

    const abbrA = hud.teamA || 'CHI';
    const abbrB = hud.teamB || 'DAL';
    const recA = teamRecord(ctx, abbrA);
    const recB = teamRecord(ctx, abbrB);
    const primA = colOf(recA, 'primary', '#0B162A');
    const accA = colOf(recA, 'accent', '#E64100');
    const primB = colOf(recB, 'primary', '#002244');

    const group = new T.Group();
    group.name = 'stadium-env';

    /* ---- 1. THE BOWL ---------------------------------------------------- */
    const segments = capture ? BOWL.segCapture : BOWL.segLive;
    const built = buildBowl(T, {
      segments,
      teamPrimary: primA,
      teamAccent: accA,
      sectionSeed: 91177 + ((ctx.seed | 0) % 977),
    });
    const loop = built.loop;
    const bowlGeo = mergeBowl(built.crowd, built.struct);

    const tile = crowdTile(capture ? 1024 : 512, 20250 + ((ctx.seed | 0) % 13));
    const teamVec = lin(primA).multiplyScalar(1.0).add(lin(accA).multiplyScalar(0.55));
    const bowlMat = makeBowlMaterial(tile, teamVec);
    const bowl = new T.Mesh(bowlGeo, bowlMat);
    bowl.name = 'stadium.bowl';
    bowl.frustumCulled = false;
    bowl.castShadow = false; bowl.receiveShadow = false;
    bowl.userData.wantShadow = false;
    bowl.renderOrder = -4;
    group.add(bowl);

    /* ---- 2. LED RIBBONS + VIDEO WALLS ----------------------------------- */
    const atlas = emissiveAtlas(2048, 1024, ctx, abbrA, abbrB,
      hud.scoreA !== undefined ? hud.scoreA : 21,
      hud.scoreB !== undefined ? hud.scoreB : 17);
    const EM = { pos: [], uv: [], col: [], scr: [], idx: [] };

    for (const rb of BOWL.ribbons) {
      const vv = rb.row === 0 ? ATLAS_V.ribA : ATLAS_V.ribB;
      pushRibbon(EM, loop, rb.band, rb.f0, rb.f1, vv[0] + 0.004, vv[1] - 0.004,
        rb.periodM, rb.inset, rb.row === 0 ? [1.0, 1.0, 1.0] : [1.05, 1.02, 1.0]);
    }

    // SIX video walls, all mounted ON the bowl rather than floating: two end-zone
    // giants above the upper rim (the ones you see on the wide) and four sideline
    // boards on the suite fascia (the ones that actually land inside a 34-degree hero
    // frame — anything past x = +-34 m on the far touchline is outside it).
    const wallV0 = ATLAS_V.wall[0] + 0.006, wallV1 = ATLAS_V.wall[1] - 0.006;
    const walls = [];
    function wallOnLoop(sArc, r, y0, y1, halfW, gain) {
      const f = ((sArc % 1) + 1) % 1;
      const li = Math.min(loop.n - 1, Math.floor(f * loop.n));
      const k = f * loop.n - li;
      const x = loop.x[li] + (loop.x[li + 1] - loop.x[li]) * k + loop.nx[li] * r;
      const z = loop.z[li] + (loop.z[li + 1] - loop.z[li]) * k + loop.nz[li] * r;
      const tx = -loop.nz[li], tz = loop.nx[li];
      const c = [
        [x - tx * halfW, y0, z - tz * halfW],
        [x + tx * halfW, y0, z + tz * halfW],
        [x + tx * halfW, y1, z + tz * halfW],
        [x - tx * halfW, y1, z - tz * halfW],
      ];
      pushPanel(EM, c, 0.004, wallV0, 0.996, wallV1, gain);
      walls.push({ x, y: (y0 + y1) * 0.5, z, w: halfW * 2.1, h: (y1 - y0) * 1.5 });
    }
    // end-zone giants (arc param 0.0 = +X end, 0.5 = -X end)
    wallOnLoop(0.00, 30.2, 22.5, 33.6, 15.0, [1.0, 1.0, 1.0]);
    wallOnLoop(0.50, 30.2, 22.5, 33.6, 15.0, [1.0, 1.0, 1.0]);
    // sideline fascia boards, two per side, inside the hero frame
    for (const s of [0.245, 0.745]) {
      wallOnLoop(s, 15.6, 10.05, 13.25, 4.3, [0.86, 0.89, 0.96]);
    }

    const emMat = makeEmissiveMaterial(atlas);
    const em = new T.Mesh(emissiveGeometry(T, EM), emMat);
    em.name = 'stadium.boards';
    em.frustumCulled = false;
    em.castShadow = false; em.receiveShadow = false;
    em.userData.wantShadow = false;
    em.renderOrder = -3;
    group.add(em);

    /* ---- 3. GLOW -------------------------------------------------------- */
    const glowTex = glowSprite(128);
    const glows = [];
    // Light banks, grouped into towers with dark gaps between them.
    const towers = capture ? BOWL.lightTowersCapture : BOWL.lightTowersLive;
    const per = BOWL.lightsPerTower;
    const towerSpan = 0.62 / towers;    // 62% lit, 38% dark gap — that ratio is the look
    for (let tw = 0; tw < towers; tw++) {
      const s0 = tw / towers;
      const tp = 0.78 + hash01(tw, 3, 88) * 0.50;   // per-tower output varies
      for (let row = 0; row < BOWL.lightRows; row++) {
        const y = BOWL.lightY0 + (BOWL.lightY1 - BOWL.lightY0) * (row / Math.max(1, BOWL.lightRows - 1));
        for (let i = 0; i < per; i++) {
          const s = s0 + (towerSpan * (i + 0.5)) / per + (row === 1 ? towerSpan * 0.5 / per : 0);
          const li = Math.min(loop.n - 1, Math.floor(((s % 1) + 1) % 1 * loop.n));
          const k = (((s % 1) + 1) % 1) * loop.n - li;
          const x = loop.x[li] + (loop.x[li + 1] - loop.x[li]) * k;
          const z = loop.z[li] + (loop.z[li + 1] - loop.z[li]) * k;
          const nx = loop.nx[li], nz = loop.nz[li];
          const r = BOWL.lightR - 0.6;
          const p = tp * (0.85 + hash01(i, row, 88) * 0.35);
          glows.push({ x: x + nx * r, y, z: z + nz * r, w: 0.50, h: 0.50, power: p * 2.9 });
          glows.push({ x: x + nx * r, y, z: z + nz * r, w: 2.3, h: 1.7, power: p * 0.42 });
        }
      }
      // one soft bloom for the whole bank, which is what actually reads at panel scale
      const sm = s0 + towerSpan * 0.5;
      const lm = Math.min(loop.n - 1, Math.floor(((sm % 1) + 1) % 1 * loop.n));
      glows.push({
        x: loop.x[lm] + loop.nx[lm] * (BOWL.lightR - 0.6),
        y: (BOWL.lightY0 + BOWL.lightY1) * 0.5,
        z: loop.z[lm] + loop.nz[lm] * (BOWL.lightR - 0.6),
        w: 5.4, h: 2.1, power: tp * 0.24,
      });
    }
    // ribbon and jumbotron bloom
    for (let i = 0; i < 96; i++) {
      const s = i / 96;
      const li = Math.min(loop.n - 1, Math.floor(s * loop.n));
      const k = s * loop.n - li;
      const x = loop.x[li] + (loop.x[li + 1] - loop.x[li]) * k;
      const z = loop.z[li] + (loop.z[li + 1] - loop.z[li]) * k;
      const nx = loop.nx[li], nz = loop.nz[li];
      const P = BOWL.profile;
      const rf = P[4].r + (P[5].r - P[4].r) * 0.3 - 0.5;
      const yf = P[4].y + (P[5].y - P[4].y) * 0.3;
      glows.push({ x: x + nx * rf, y: yf, z: z + nz * rf, w: 4.4, h: 1.1, power: 0.26 });
      glows.push({ x: x + nx * (-0.4), y: 2.15, z: z + nz * (-0.4), w: 3.6, h: 0.9, power: 0.20 });
    }
    for (const w of walls) {
      glows.push({ x: w.x, y: w.y, z: w.z, w: w.w, h: w.h, power: 0.34 });
    }
    // vomitory mouths breathing warm light into the bowl
    for (let i = 0; i < 24; i++) {
      const s = (i + 0.5) / 24;
      const li = Math.min(loop.n - 1, Math.floor(s * loop.n));
      const x = loop.x[li], z = loop.z[li];
      const nx = loop.nx[li], nz = loop.nz[li];
      glows.push({ x: x + nx * (BOWL.profile[4].r - 0.3), y: 8.6, z: z + nz * (BOWL.profile[4].r - 0.3), w: 3.2, h: 2.0, power: 0.16 });
    }

    const glowMat = makeGlowMaterial(glowTex);
    const glow = new T.Mesh(buildGlows(glows), glowMat);
    glow.name = 'stadium.glow';
    glow.frustumCulled = false;
    glow.castShadow = false; glow.receiveShadow = false;
    glow.userData.wantShadow = false;
    glow.renderOrder = 6;
    group.add(glow);

    /* ---- 4. SKY --------------------------------------------------------- */
    const skyMat = makeSkyMaterial(skyTexture(512, 256));
    const sky = new T.Mesh(new T.SphereGeometry(300, 28, 18), skyMat);
    sky.name = 'stadium.sky';
    sky.frustumCulled = false;
    sky.castShadow = false; sky.receiveShadow = false;
    sky.userData.wantShadow = false;
    sky.renderOrder = -10;
    group.add(sky);

    /* ---- 5. PROPS ------------------------------------------------------- */
    const camPos = (shot.camera && shot.camera.pos) || [0, 2, 14];
    const props = buildProps({
      seed: 4407 + ((ctx.seed | 0) % 331),
      teamA: primA,
      teamB: primB,
      camPos,
      hazeCol: PALETTE.hazeFar,
    });
    const propMat = new T.MeshStandardMaterial({
      vertexColors: true, roughness: 0.72, metalness: 0.06,
      emissive: new T.Color(0x0a0c12), emissiveIntensity: 1.0,
    });
    const propMesh = new T.Mesh(props.geometry, propMat);
    propMesh.name = 'stadium.props';
    propMesh.castShadow = false; propMesh.receiveShadow = false;
    propMesh.userData.wantShadow = false;
    group.add(propMesh);

    /* ---- fog, from the shot's own weather ------------------------------- */
    const haze = weather.haze !== undefined ? weather.haze : 0.55;
    const density = 0.0090 + haze * 0.0125;
    const maxF = 0.34 + haze * 0.56;
    const fogCol = lin(PALETTE.hazeFar).multiplyScalar(0.55 + haze * 0.75);
    for (const m of [bowlMat, emMat, glowMat]) {
      m.uniforms.uFog.value.set(density, maxF, 11.0, 0.028);
      m.uniforms.uFogCol.value.copy(fogCol);
    }

    this._g = group;
    this._mats = { bowlMat, emMat, glowMat, skyMat, propMat };
    this._parts = { bowl, em, glow, sky, propMesh, loop, glowCount: glows.length };
    this._heat = { loop };
    this.applyRung(ctx.rung !== undefined ? ctx.rung : 15, null, ctx);
    return group;
  },

  /* ------------------------------------------------------------- runtime */

  update(t, ctx) {
    const m = this._mats;
    if (!m) return;
    const cam = ctx.camera;
    m.bowlMat.uniforms.uTime.value = t;
    m.emMat.uniforms.uTime.value = t;
    m.bowlMat.uniforms.uCam.value.copy(cam.position);
    m.emMat.uniforms.uCam.value.copy(cam.position);
    m.glowMat.uniforms.uCam.value.copy(cam.position);
    const s = this._parts.sky;
    s.position.set(cam.position.x, 0, cam.position.z);
  },

  /**
   * applyRung — visibility flags and uniform floats only. No allocation, no material
   * creation, no render-target work, and idempotent.
   */
  applyRung(rung, spec, ctx) {
    const p = this._parts, m = this._mats;
    if (!p || !m) return;
    this._rung = rung;
    const R = rungSpec(rung);
    m.bowlMat.uniforms.uDetail.value = R.crowdDetail;
    m.bowlMat.uniforms.uFlash.value = R.flash;
    m.emMat.uniforms.uScroll.value = R.scroll ? 0.016 : 0.0;
    m.glowMat.uniforms.uGain.value = R.haloes ? 1.0 : 0.0;
    p.glow.visible = !!R.haloes;
    // the sideline population is the first thing a floor-tier device loses
    p.propMesh.visible = R.props > 0;
    void spec; void ctx;
  },

  /**
   * stadiumHeat(x, z) -> 0..1
   * How loud the bowl is at a field position: 1 at the touchlines and behind the end
   * zones where the stands crowd in, falling off toward midfield. Other pieces may
   * ignore it entirely; `impact-fx` and `hud-overlay` can use it to bias crowd
   * reaction and shake.
   */
  stadiumHeat(x, z) {
    const ax = Math.abs(x) / FIELDX.endLineX;
    const az = Math.abs(z) / FIELDX.halfWidth;
    const prox = Math.max(ax * 0.82, az);
    const near = Math.min(1, Math.pow(prox, 1.6));
    const endzone = ax > 0.84 ? (ax - 0.84) / 0.16 : 0;
    return Math.min(1, 0.28 + near * 0.52 + endzone * 0.30);
  },

  dispose() {
    this._g = null; this._mats = null; this._parts = null;
  },
};

export default impl;
