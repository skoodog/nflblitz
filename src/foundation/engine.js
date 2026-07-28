// FOUNDATION — FROZEN after t=0. Do not edit.
//
// The engine. Owns the WebGL2 renderer, the deterministic accumulation capture path,
// and the readiness signal every screenshot waits on.
//
// CAPTURE SEQUENCE (this is exactly what `window.__BLITZ_READY__ === true` means):
//   1. build the world from the ShotSpec
//   2. render `warmup` throwaway frames  -> every lazy texture bake, shader compile and
//      skinning upload has landed
//   3. render `accum` sub-pixel-jittered passes into a half-float accumulation target
//      (TAA + motion blur + accumulation-buffer DOF all resolve here)
//   4. resolve: supersample downfilter -> tone map -> sRGB -> the visible canvas
//   5. draw the Canvas2D overlay
//   6. THEN set __BLITZ_READY__ and document.documentElement.dataset.blitzReady="1"
//
// Two runs of the same URL produce identical PNGs. Nothing here reads a wall clock.

import * as THREE from 'three';
import { REG } from './registry.js';
import { buildFromShot } from './world.js';
import { createOverlay } from './overlay.js';
import { resolveScene } from './scenes.js';
import { qualityProfile } from './params.js';
import { makeRng, halton } from './rng.js';
import texlab from './texlab.js';
import { createInput } from './input.js';

const SIM_STEP = 1 / 120;

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

/* ------------------------------------------------------------------ engine */

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
  const input = createInput(params.quality === 'live');

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

  /** Interactive loop for ?quality=live. Never used by the capture path. */
  let rafId = 0;
  let liveT = params.t;
  function startLive() {
    const loop = () => {
      rafId = requestAnimationFrame(loop);
      input.update();
      liveT += SIM_STEP * 2;   // fixed step; never reads a wall clock
      renderPass(rtSample, liveT, 0, 0, 0);
      resolveToCanvas(rtSample);
      drawOverlay(liveT);
    };
    rafId = requestAnimationFrame(loop);
  }
  function stopLive() { if (rafId) cancelAnimationFrame(rafId); rafId = 0; }

  return {
    ctx, renderer, scene, camera, overlay, params, profile,
    buildScene, captureFrame, startLive, stopLive,
    get world() { return world; },
    dispose() {
      stopLive();
      if (world) world.dispose();
      rtSample.dispose(); rtAcc[0].dispose(); rtAcc[1].dispose();
      accumQuad.geo.dispose(); resolveQuad.geo.dispose();
      accumMat.dispose(); resolveMat.dispose();
      renderer.dispose();
      input.dispose();
    },
  };
}

export default { createEngine };
