// FOUNDATION — PERFCORE owns this file. TWO EXECUTION PATHS AGAINST TWO BARS.
//
// ===========================================================================
// PATH 1 — CAPTURE  (`?mode=capture`, formerly `?quality=capture`)
// ===========================================================================
// 1920x1080, ssaa 1.5, accum 32, half-float RT, preserveDrawingBuffer, ~20 s/frame.
// Judged ONLY on fidelity against the bar. NO FRAME BUDGET APPLIES. Byte-deterministic:
// two runs of the same URL produce identical PNGs.
//
//   1. build the world from the ShotSpec
//   2. render `warmup` throwaway frames  -> every lazy texture bake, shader compile and
//      skinning upload has landed
//   3. render `accum` sub-pixel-jittered passes into a half-float accumulation target
//      (TAA + motion blur + accumulation-buffer DOF all resolve here)
//   4. resolve: supersample downfilter -> tone map -> sRGB -> the visible canvas
//   5. draw the Canvas2D overlay
//   6. THEN set __BLITZ_READY__ and document.documentElement.dataset.blitzReady="1"
//
// `createEngine` below is UNCHANGED in behaviour. It is the fidelity instrument and it
// still produces the same md5. Do not "optimise" it — it has no frame budget.
//
// ===========================================================================
// PATH 2 — RUNTIME  (`?mode=play`)  <-- THE GAME
// ===========================================================================
// Direct to the default framebuffer. NO accumulation target, NO resolve quad, NO
// preserveDrawingBuffer, internal render scale from the active quality rung.
// Judged ONLY on the performance contract.
//
// WHY THE SPLIT EXISTS, with the measurement that forced it. The previous build had one
// renderer and called a branch of it "live". Measured on this box before the split, the
// live path ran the `live_play` scene at p50 166.6 ms/frame at 960x540 and 66.7 ms at
// 256x144 — 4x to 10x over even a 30 Hz budget with nothing but fallback content in the
// scene. Two of its choices are correct for accumulation capture and catastrophic for a
// game loop: `preserveDrawingBuffer:true` forces a per-frame copy of the whole
// framebuffer, and every frame round-tripped through a half-float render target plus a
// fullscreen resolve quad. Neither buys a game loop anything. Both are gone from path 2.
//
// NO RESULT FROM ONE PATH MAY EVER BE CITED AS EVIDENCE ABOUT THE OTHER.

import * as THREE from 'three';
import { REG } from './registry.js';
import { buildFromShot } from './world.js';
import { createOverlay, createRuntimeOverlay } from './overlay.js';
import { resolveScene } from './scenes.js';
import { qualityProfile } from './params.js';
import { makeRng, halton } from './rng.js';
import texlab from './texlab.js';
import { createInput } from './input.js';
import { RUNGS, TIERS, tierOfRung } from './quality.js';
import { countScene } from './budget.js';
import { fillToTierCap, buildCanary } from './synthetic.js';

const SIM_STEP = 1 / 120;

// Module-scope scratch for the runtime's shadow-caster pass. Allocated once.
const TMP_V = new THREE.Vector3();
function sortByShadowDist(a, b) { return a.userData._shadowDist - b.userData._shadowDist; }

/* ------------------------------------------------------------ resolve pass */

// RawShaderMaterial + GLSL3: nothing is injected, so declare the attributes.
const RESOLVE_VERT = /* glsl */`
in vec3 position;
in vec2 uv;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const RESOLVE_FRAG = /* glsl */`
precision highp float;
in vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uExposure;
uniform int uTone;
uniform float uDownfilter;
out vec4 outColor;

vec3 acesFilm(vec3 x) {
  const mat3 IN = mat3(
    0.59719, 0.07600, 0.02840,
    0.35458, 0.90834, 0.13383,
    0.04823, 0.01566, 0.83777);
  const mat3 OUT = mat3(
     1.60475, -0.10208, -0.00327,
    -0.53108,  1.10813, -0.07276,
    -0.07367, -0.00605,  1.07602);
  vec3 v = IN * x;
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return clamp(OUT * (a / b), 0.0, 1.0);
}

vec3 reinhard(vec3 x) { return x / (1.0 + x); }

vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(0.41666)) - 0.055, step(0.0031308, c));
}

void main() {
  vec3 c = texture(tSrc, vUv).rgb;
  if (uDownfilter > 0.5) {
    // rotated-grid tent for the supersampled case
    vec2 o = uTexel * 0.5;
    c = c * 0.36
      + texture(tSrc, vUv + vec2( o.x,  o.y)).rgb * 0.16
      + texture(tSrc, vUv + vec2(-o.x,  o.y)).rgb * 0.16
      + texture(tSrc, vUv + vec2( o.x, -o.y)).rgb * 0.16
      + texture(tSrc, vUv + vec2(-o.x, -o.y)).rgb * 0.16;
  }
  c *= uExposure;
  if (uTone == 1) c = acesFilm(c);
  else if (uTone == 2) c = reinhard(c);
  else c = clamp(c, 0.0, 1.0);
  outColor = vec4(toSRGB(c), 1.0);
}`;

const ACCUM_FRAG = /* glsl */`
precision highp float;
in vec2 vUv;
uniform sampler2D tPrev;
uniform sampler2D tSample;
uniform float uWeight;
out vec4 outColor;
void main() {
  vec3 p = texture(tPrev, vUv).rgb;
  vec3 s = texture(tSample, vUv).rgb;
  outColor = vec4(mix(p, s, uWeight), 1.0);
}`;

function fullscreenQuad(material) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  return { scene, cam, mesh, geo };
}

/* ================================================================== CAPTURE */

export function createEngine(opts) {
  const { glCanvas, uiCanvas, params } = opts;
  const profile = qualityProfile(params.quality);
  const W = params.w, H = params.h;
  const ss = params.quality === 'capture' ? profile.ssaa : 1.0;
  const SW = Math.max(1, Math.round(W * ss));
  const SH = Math.max(1, Math.round(H * ss));

  const renderer = new THREE.WebGLRenderer({
    canvas: glCanvas,
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true,      // required: we render once, then screenshot
    stencil: false,
    depth: true,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(0x05060a, 1);

  const gl = renderer.getContext();
  const hasFloatRT = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
  const accumType = hasFloatRT ? THREE.HalfFloatType : THREE.UnsignedByteType;

  const rtOpts = {
    type: accumType,
    format: THREE.RGBAFormat,
    colorSpace: THREE.NoColorSpace,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
    stencilBuffer: false,
    samples: 0,
  };
  const rtSample = new THREE.WebGLRenderTarget(SW, SH, rtOpts);
  const rtAcc = [
    new THREE.WebGLRenderTarget(SW, SH, Object.assign({}, rtOpts, { depthBuffer: false })),
    new THREE.WebGLRenderTarget(SW, SH, Object.assign({}, rtOpts, { depthBuffer: false })),
  ];

  const accumMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: RESOLVE_VERT,
    fragmentShader: ACCUM_FRAG,
    uniforms: { tPrev: { value: null }, tSample: { value: null }, uWeight: { value: 1 } },
    depthTest: false, depthWrite: false,
  });
  const resolveMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: RESOLVE_VERT,
    fragmentShader: RESOLVE_FRAG,
    uniforms: {
      tSrc: { value: null },
      uTexel: { value: new THREE.Vector2(1 / SW, 1 / SH) },
      uExposure: { value: 1 },
      uTone: { value: 1 },
      uDownfilter: { value: ss > 1.001 ? 1 : 0 },
    },
    depthTest: false, depthWrite: false,
  });
  const accumQuad = fullscreenQuad(accumMat);
  const resolveQuad = fullscreenQuad(resolveMat);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, W / H, 0.08, 600);
  scene.add(camera);

  const overlay = createOverlay(uiCanvas, params);
  const input = createInput(false);

  const ctx = {
    THREE,
    renderer,
    scene,
    camera,
    rng: makeRng(params.seed),
    texlab,
    brand: REG.brand,
    faces: REG.faces,
    quality: params.quality,
    profile,
    t: params.t,
    seed: params.seed,
    shot: null,
    variant: params.variant,
    debug: params.debug,
    forceHud: params.hud,
    forceUI: params.ui,
    input,
    mode: 'capture',
    rung: 15,
    W: 1920,
    H: 1080,
    pixelW: W,
    pixelH: H,
    fieldOfPlay: null,
  };

  let world = null;
  let frames = 0;
  const lastSceneInfo = { drawCalls: 0, tris: 0, programs: 0, geometries: 0, textures: 0 };

  function buildScene(sceneId) {
    if (world) world.dispose();
    while (scene.children.length) {
      const c = scene.children[0];
      scene.remove(c);
    }
    scene.add(camera);
    ctx.brand = REG.brand;
    ctx.faces = REG.faces;
    ctx.rng = makeRng(params.seed);
    const shot = resolveScene(sceneId, params);
    ctx.shot = shot;
    camera.aspect = W / H;
    world = buildFromShot(shot, ctx);
    return shot;
  }

  function renderPass(target, tSub, jx, jy, subIndex) {
    ctx.t = tSub;
    if (world) world.update(tSub, ctx);

    // aperture offset (accumulation-buffer depth of field) — cinema-owned
    let ap = null;
    if (REG.cinema.apertureOffset) {
      try { ap = REG.cinema.apertureOffset(subIndex, params.accum, ctx.shot, camera, ctx); } catch (e) { ap = null; }
    }
    if (ap) {
      const focus = (ctx.shot && ctx.shot.lens && ctx.shot.lens.focusDist) || 10;
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      camera.position.addScaledVector(right, ap[0]).addScaledVector(up, ap[1]);
      camera.updateMatrixWorld(true);
      camera.updateProjectionMatrix();
      const e = camera.projectionMatrix.elements;
      e[8] += -e[0] * ap[0] / focus;
      e[9] += -e[5] * ap[1] / focus;
    } else {
      camera.updateProjectionMatrix();
    }

    // sub-pixel jitter
    if (jx !== 0 || jy !== 0) {
      const e = camera.projectionMatrix.elements;
      e[8] += (jx * 2) / SW;
      e[9] += (jy * 2) / SH;
    }
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();

    const post = world && world.post;
    if (post && typeof post.render === 'function') {
      post.render(scene, camera, target, tSub, SIM_STEP, ctx);
    } else {
      renderer.setRenderTarget(target);
      renderer.clear(true, true, true);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
    }
    // capture scene stats here — renderer.info is reset by every subsequent
    // render(), including the accumulate/resolve full-screen quads.
    lastSceneInfo.drawCalls = renderer.info.render.calls;
    lastSceneInfo.tris = renderer.info.render.triangles;
    lastSceneInfo.programs = renderer.info.programs ? renderer.info.programs.length : 0;
    lastSceneInfo.geometries = renderer.info.memory.geometries;
    lastSceneInfo.textures = renderer.info.memory.textures;
    frames++;
  }

  function accumulate(n, t) {
    const shutter = (ctx.shot && ctx.shot.lens && ctx.shot.lens.shutter) || 0;
    const blur = profile.motionBlur ? shutter : 0;

    // clear accumulator
    renderer.setRenderTarget(rtAcc[0]);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, false, false);
    renderer.setRenderTarget(null);
    renderer.setClearColor(0x05060a, 1);

    let src = 0;
    for (let i = 0; i < n; i++) {
      const jx = n === 1 ? 0 : halton(i + 1, 2) - 0.5;
      const jy = n === 1 ? 0 : halton(i + 1, 3) - 0.5;
      const frac = n === 1 ? 0 : ((i + 0.5) / n - 0.5);
      renderPass(rtSample, t + frac * blur, jx, jy, i);

      accumMat.uniforms.tPrev.value = rtAcc[src].texture;
      accumMat.uniforms.tSample.value = rtSample.texture;
      accumMat.uniforms.uWeight.value = 1 / (i + 1);
      renderer.setRenderTarget(rtAcc[1 - src]);
      renderer.render(accumQuad.scene, accumQuad.cam);
      renderer.setRenderTarget(null);
      src = 1 - src;
    }
    return rtAcc[src];
  }

  function resolveToCanvas(rt) {
    resolveMat.uniforms.tSrc.value = rt.texture;
    resolveMat.uniforms.uExposure.value = renderer.toneMappingExposure;
    resolveMat.uniforms.uTone.value =
      renderer.toneMapping === THREE.NoToneMapping ? 0
        : renderer.toneMapping === THREE.ReinhardToneMapping ? 2 : 1;
    const prevTone = renderer.toneMapping;
    renderer.toneMapping = THREE.NoToneMapping;   // resolve does it in-shader
    renderer.setRenderTarget(null);
    renderer.clear(true, true, true);
    renderer.render(resolveQuad.scene, resolveQuad.cam);
    renderer.toneMapping = prevTone;
  }

  function drawOverlay(t) {
    overlay.draw(t, ctx.shot, ctx);
  }

  /** One deterministic still. Returns stats. */
  function captureFrame(t) {
    const t0 = Date.now();
    frames = 0;
    for (let i = 0; i < params.warmup; i++) renderPass(rtSample, t, 0, 0, 0);
    const rt = accumulate(params.accum, t);
    resolveToCanvas(rt);
    drawOverlay(t);
    return {
      ms: Date.now() - t0,
      frames,
      drawCalls: lastSceneInfo.drawCalls,
      tris: lastSceneInfo.tris,
      programs: lastSceneInfo.programs,
      geometries: lastSceneInfo.geometries,
      textures: lastSceneInfo.textures,
      sceneId: ctx.shot ? ctx.shot.id : null,
      seed: params.seed,
      t,
      quality: params.quality,
      w: W, h: H, ssaa: ss, accum: params.accum, warmup: params.warmup,
      accumType: hasFloatRT ? 'half-float' : 'uint8',
      provenance: Object.assign({}, REG.provenance),
      errors: (window.__BLITZ_ERRORS__ || []).slice(),
    };
  }

  return {
    ctx, renderer, scene, camera, overlay, params, profile,
    buildScene, captureFrame,
    get world() { return world; },
    dispose() {
      if (world) world.dispose();
      rtSample.dispose(); rtAcc[0].dispose(); rtAcc[1].dispose();
      accumQuad.geo.dispose(); resolveQuad.geo.dispose();
      accumMat.dispose(); resolveMat.dispose();
      renderer.dispose();
      input.dispose();
    },
  };
}

/* ================================================================== RUNTIME */

/**
 * createRuntime({ glCanvas, uiCanvas, params }) — THE GAME LOOP'S RENDERER.
 *
 * Everything here is chosen against the frame wall:
 *   preserveDrawingBuffer FALSE  — the capture path needs it, a game never does, and it
 *                                  costs a full framebuffer copy every single frame.
 *   NO accumulation target       — no half-float RT, no ping-pong, no resolve quad.
 *   NO fullscreen resolve pass   — tone mapping happens in the renderer's own output
 *                                  stage, not in an extra fullscreen draw.
 *   internal render scale        — the drawing buffer is sized by the active RUNG, and
 *                                  the browser scales it to the CSS box for free.
 *   antialias FALSE              — MSAA on a mobile tiler is a bandwidth tax; the rung
 *                                  ladder buys AA back through render scale instead.
 */
export function createRuntime(opts) {
  const { glCanvas, uiCanvas, params } = opts;
  const profile = qualityProfile('live');

  const renderer = new THREE.WebGLRenderer({
    canvas: glCanvas,
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,     // <- THE single most expensive line in the old loop
    stencil: false,
    depth: true,
    failIfMajorPerformanceCaveat: false,
  });
  renderer.setPixelRatio(1);          // we size the drawing buffer explicitly
  renderer.shadowMap.enabled = false;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(0x05060a, 1);
  renderer.info.autoReset = false;    // we reset once per frame, after reading

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.08, 600);
  scene.add(camera);

  const overlay = createRuntimeOverlay(uiCanvas, params);

  // --- sizing ---------------------------------------------------------------
  let cssW = params.w, cssH = params.h;
  let bufW = cssW, bufH = cssH;
  let rung = params.rung !== null && params.rung !== undefined ? params.rung : 8;
  const rasterMin = params.raster === 'min' || params.raster === 'none';
  const rasterNone = params.raster === 'none';

  function computeBuffer() {
    if (rasterMin) {
      // `--raster=min`: 256x144 so SOFTWARE RASTER IS NOT THE VARIABLE. What is being
      // measured in this mode is the loop's CPU and tail behaviour, which transfers to
      // a phone. Fill rate, which does not transfer, is taken off the table.
      bufW = 256; bufH = 144;
      return;
    }
    const r = RUNGS[rung];
    const dpr = Math.min(
      (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1) || 1,
      r.dprCap
    );
    bufW = Math.max(16, Math.round(cssW * dpr * r.renderScale));
    bufH = Math.max(16, Math.round(cssH * dpr * r.renderScale));
  }

  function applySize() {
    computeBuffer();
    renderer.setSize(bufW, bufH, false);      // false: never touch canvas CSS
    glCanvas.style.width = cssW + 'px';
    glCanvas.style.height = cssH + 'px';
    camera.aspect = cssW / Math.max(1, cssH);
    camera.updateProjectionMatrix();
    overlay.setSize(cssW, cssH);
    ctx.pixelW = bufW; ctx.pixelH = bufH;
  }

  function setViewport(w, h) {
    cssW = Math.max(16, Math.round(w));
    cssH = Math.max(16, Math.round(h));
    applySize();
  }

  const ctx = {
    THREE,
    renderer,
    scene,
    camera,
    rng: makeRng(params.seed),
    texlab,
    brand: REG.brand,
    faces: REG.faces,
    quality: 'live',
    profile,
    t: 0,
    seed: params.seed,
    shot: null,
    variant: params.variant,
    debug: params.debug,
    forceHud: params.hud,
    forceUI: params.ui,
    input: null,
    mode: 'play',
    rung,
    W: 1920,
    H: 1080,
    pixelW: bufW,
    pixelH: bufH,
    fieldOfPlay: null,
  };

  let world = null;
  let synth = null;
  let canary = null;
  const info = {
    drawCalls: 0, tris: 0, programs: 0, geometries: 0, textures: 0, points: 0, lines: 0,
  };

  function buildScene(sceneId) {
    if (world) world.dispose();
    if (synth) { synth.dispose(); synth = null; }
    if (canary) { canary.dispose(); canary = null; }
    while (scene.children.length) scene.remove(scene.children[0]);
    scene.add(camera);
    ctx.brand = REG.brand;
    ctx.faces = REG.faces;
    ctx.rng = makeRng(params.seed);
    // `perf_synthetic` is the LOAD-BEARING PROOF SCENE. It reuses the live_play world
    // (14 fallback actors) and then tops the scene up to the tier's structural cap, so
    // pacing is measured against the worst scene a piece is legally allowed to build,
    // not against an empty one.
    const isSynth = sceneId === 'perf_synthetic';
    const shot = resolveScene(isSynth ? 'live_play' : sceneId, params);
    ctx.shot = shot;
    if (isSynth) shot.id = 'perf_synthetic';
    world = buildFromShot(shot, ctx);

    if (isSynth) {
      const tier = params.tier || tierOfRung(rung);
      let base = null;
      try { base = countScene(scene, { shadowsEnabled: false }); } catch (e) { base = null; }
      synth = fillToTierCap(THREE, tier, base, rung);
      scene.add(synth.group);
      ctx.syntheticAdded = synth.added;
      ctx.syntheticBase = base;
    }
    if (params.canary) {
      canary = buildCanary(THREE);
      scene.add(canary.group);
    }
    applyRung(rung, true);
    return shot;
  }

  /* ---------------------------------------------------------------- rungs */

  /**
   * applyRung(n) — THE CONTRACT EVERY VISUAL PIECE IMPLEMENTS.
   *
   * Foundation applies the rung to everything it owns (render scale, shadow map,
   * tone-map exposure floor) and then forwards to every registered slot that declares
   * `applyRung`. A piece MUST NOT allocate, compile a shader, or resize a render target
   * inside applyRung — every program for every rung is pre-warmed at load time
   * (see `prewarmPrograms`), and a rung change during play must be invisible.
   */
  function applyRung(n, force) {
    const next = n < 0 ? 0 : n > 15 ? 15 : n | 0;
    if (!force && next === rung) return false;
    rung = next;
    ctx.rung = rung;
    const r = RUNGS[rung];

    if (!rasterMin) applySize();

    const wantShadow = r.shadowSize > 0;
    if (renderer.shadowMap.enabled !== wantShadow) renderer.shadowMap.enabled = wantShadow;
    renderer.shadowMap.needsUpdate = wantShadow;
    enforceShadowCasters(wantShadow ? r.shadowCasters : 0);

    for (const slot of Object.keys(REG.world)) {
      const impl = REG.world[slot];
      if (impl && typeof impl.applyRung === 'function') {
        try { impl.applyRung(rung, r, ctx); } catch (e) { reportErr(`world.${slot}.applyRung`, e); }
      }
    }
    for (const slot of Object.keys(REG.ui)) {
      const impl = REG.ui[slot];
      if (impl && typeof impl.applyRung === 'function') {
        try { impl.applyRung(rung, r, ctx); } catch (e) { reportErr(`ui.${slot}.applyRung`, e); }
      }
    }
    for (const k of ['cinema', 'controller', 'flow', 'timing', 'sim']) {
      const impl = REG[k];
      if (impl && typeof impl.applyRung === 'function') {
        try { impl.applyRung(rung, r, ctx); } catch (e) { reportErr(`${k}.applyRung`, e); }
      }
    }
    if (world && world.post && typeof world.post.applyRung === 'function') {
      try { world.post.applyRung(rung, r, ctx); } catch (e) { reportErr('post.applyRung', e); }
    }
    return true;
  }

  function reportErr(label, e) {
    const msg = `[runtime] ${label} threw: ${e && e.message}`;
    console.error(msg, e);
    (window.__BLITZ_ERRORS__ = window.__BLITZ_ERRORS__ || []).push(msg);
  }

  /**
   * THE SHADOW CASTER CAP, enforced centrally.
   *
   * Shadow casters are a renderer-level budget, not a per-piece one: each caster is a
   * whole extra draw into the shadow map, and no single piece can know how many other
   * pieces have already spent the budget. So the runtime enforces it, and pieces simply
   * mark what they would LIKE to cast.
   *
   * Priority is by distance to the camera — the nearest N casters keep their shadow,
   * everything else drops to none. That is the right ordering visually (a contact shadow
   * under the ball carrier matters; one on a lineman 40 m upfield does not) and it is
   * stable frame to frame because it only runs on a rung change, never per frame.
   *
   * `budget.mjs` measured the fallback scene casting 113 shadows against a mid cap of
   * 20 before this existed.
   */
  const casterScratch = [];
  function enforceShadowCasters(limit) {
    casterScratch.length = 0;
    scene.traverse((o) => {
      if (o.isMesh && o.userData && o.userData.wantShadow !== false) {
        if (o.castShadow || o.userData.canCastShadow) casterScratch.push(o);
      }
    });
    if (limit <= 0) {
      for (let i = 0; i < casterScratch.length; i++) {
        const o = casterScratch[i];
        o.userData.canCastShadow = true;
        o.castShadow = false;
      }
      return;
    }
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    for (let i = 0; i < casterScratch.length; i++) {
      const o = casterScratch[i];
      o.userData.canCastShadow = true;
      o.getWorldPosition(TMP_V);
      o.userData._shadowDist = (TMP_V.x - cx) ** 2 + (TMP_V.y - cy) ** 2 + (TMP_V.z - cz) ** 2;
    }
    casterScratch.sort(sortByShadowDist);
    // BUDGET IN DRAW CALLS, NOT MESHES. A multi-material mesh issues one shadow draw
    // PER MATERIAL GROUP, and the cap is a cap on shadow-map draws. The fallback actor
    // mesh carries 8 groups, so 14 casting actors is 112 shadow draws, not 14 — which
    // is exactly what budget.mjs counts and why capping mesh count left the scene at
    // 113 draws against a cap of 20. Both sides must agree on the unit or the gate
    // measures one thing and the enforcement fixes another.
    let spent = 0;
    for (let i = 0; i < casterScratch.length; i++) {
      const o = casterScratch[i];
      const cost = drawCallsOf(o);
      if (spent + cost <= limit) { o.castShadow = true; spent += cost; }
      else o.castShadow = false;
    }
  }

  /** Draw calls one drawable issues — must match countScene()'s accounting exactly. */
  function drawCallsOf(obj) {
    const mats = Array.isArray(obj.material) ? obj.material : (obj.material ? [obj.material] : []);
    if (!mats.length) return 1;
    const groups = (obj.geometry && obj.geometry.groups && obj.geometry.groups.length) || 1;
    return Math.max(1, Math.min(groups, mats.length));
  }

  /**
   * PROGRAM PRE-WARM — the mitigation for ASSUMPTION D, the one mobile stall this box
   * cannot otherwise see. A real mobile driver costs 5-50 ms per shader program link
   * and WILL stall a frame. So every program for every rung is compiled during the
   * loading screen, before the first play, and `renderer.info.programs.length` must not
   * increase by even 1 afterwards.
   *
   * Both shadow states are walked, because three.js's program cache key includes shadow
   * configuration: flipping `shadowMap.enabled` mid-play would otherwise recompile every
   * material in the scene at exactly the moment the scaler was trying to help.
   */
  function prewarmPrograms() {
    const before = renderer.info.programs ? renderer.info.programs.length : 0;
    const saveRung = rung;
    const saveShadow = renderer.shadowMap.enabled;
    for (let r = 0; r <= 15; r++) {
      applyRung(r, true);
      try { renderer.compile(scene, camera); } catch (e) { reportErr('compile', e); }
    }
    // Explicitly cover both shadow states at the current geometry set.
    for (const s of [true, false]) {
      renderer.shadowMap.enabled = s;
      try { renderer.compile(scene, camera); } catch (e) { reportErr('compile/shadow', e); }
    }
    renderer.shadowMap.enabled = saveShadow;
    applyRung(saveRung, true);
    // One real draw so the driver actually uses the programs, not just links them.
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    const after = renderer.info.programs ? renderer.info.programs.length : 0;
    return { before, after, programs: after };
  }

  /* --------------------------------------------------------------- render */

  /**
   * render(alpha) — the JS half of render dispatch. Billed to the `renderJS` span.
   * Straight to the default framebuffer. No RT, no resolve, no readback, no copy.
   */
  function render() {
    renderer.info.reset();
    if (rasterNone) {
      // LOOP-ONLY MODE. Everything the main thread does still happens — input, sim,
      // anim, fx, camera, overlay, scaler — and the scene graph is still built and
      // updated. Only the GL submission is skipped. This is the ONLY configuration in
      // which this box can measure the loop's own pacing, because SwiftShader's
      // geometry cost otherwise dominates the frame at every resolution. It proves the
      // loop machinery; it proves NOTHING about rendering, and the harness says so.
      camera.updateMatrixWorld();
      return;
    }
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    const ri = renderer.info.render;
    info.drawCalls = ri.calls;
    info.tris = ri.triangles;
    info.points = ri.points;
    info.lines = ri.lines;
    info.programs = renderer.info.programs ? renderer.info.programs.length : 0;
    info.geometries = renderer.info.memory.geometries;
    info.textures = renderer.info.memory.textures;
  }

  function update(simTime) {
    ctx.t = simTime;
    if (world) world.update(simTime, ctx);
  }

  applySize();

  return {
    ctx, renderer, scene, camera, overlay, params, profile, info,
    buildScene, applyRung, prewarmPrograms, render, update, setViewport,
    get rung() { return rung; },
    get world() { return world; },
    get bufferSize() { return { w: bufW, h: bufH }; },
    get cssSize() { return { w: cssW, h: cssH }; },
    get synthetic() { return synth ? synth.added : null; },
    get hasCanary() { return !!canary; },
    dispose() {
      if (world) world.dispose();
      if (synth) synth.dispose();
      if (canary) canary.dispose();
      renderer.dispose();
    },
  };
}

export default { createEngine, createRuntime };
