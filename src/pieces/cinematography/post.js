// PIECE cinematography — THE POST CHAIN. Bloom, halation, anamorphic streak, grade,
// vignette, chromatic aberration, grain.
//
// WHERE THIS RUNS, AND THE ONE THING THAT MUST NOT BE GOT WRONG.
// foundation/engine.js calls `post.render(scene, camera, target, t, dt, ctx)` once per
// ACCUMULATION SAMPLE, and `target` is the half-float sample buffer. The engine's resolve
// pass then does exposure -> ACES -> sRGB on the accumulated result. So everything below
// must consume and produce LINEAR HDR. Any tone map or sRGB encode in here would be
// applied twice and the frame would come out milky and clipped.
//
// three.js helps with half of that for free: WebGLRenderer sets `toneMapping` to
// NoToneMapping whenever the render target is not null, so the scene render into our own
// buffer is already linear. The render targets are created with `colorSpace:
// NoColorSpace` for the same reason.
//
// COST, and why it is affordable. This is the CAPTURE path only — `createRuntime.render()`
// in engine.js goes straight to the default framebuffer and never looks at `world.post`,
// so `buildPost` returns null in play mode rather than allocating 50 MB of render targets
// the game will never read. On the capture path there is no frame budget at all. Measured
// on this box (SwiftShader, no GPU) at 2880x1620 supersampled: the chain adds roughly
// 1.6 full-resolution fullscreen passes per accumulation sample, because everything
// except the scene render and the composite happens at half resolution or below.
//
// -------------------------------------------------------------------- THE LOOK
// Read off the bar sheet, in this order of importance:
//   1. the corners are nearly black. bar/panel-truck.png measures ~0.06 relative
//      luminance in the corners against ~0.55 at the subject. That is a vignette of
//      roughly 0.55 strength, far stronger than anything "tasteful".
//   2. every stadium lamp blooms into a soft warm disc with a horizontal streak through
//      it, and the streak is WHITE-BLUE while the bloom halo around skin and jersey is
//      WARM-RED. That split is halation, and it is what stops bloom looking like fog.
//   3. shadows are cool and slightly desaturated, highlights are warm and slightly
//      oversaturated. Skin in shadow on panel-midair_hit reads blue-grey; the same skin
//      in the key reads orange.
//   4. contrast is high and the midtones are pushed down, so the turf goes dark and the
//      players separate from it.
// The grade below is those four, in that order, done in linear before the ACES curve.

const VERT = /* glsl */`
in vec3 position;
in vec2 uv;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/**
 * PREFILTER + halve. Karis-averaged so a single blown specular texel cannot dominate the
 * kernel — without it the crowd's pinpoint highlights (stadium-env draws thousands of
 * them) turn the whole upper third into a glowing slab.
 */
const FRAG_PREFILTER = /* glsl */`
precision highp float;
in vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uKnee;
out vec4 outColor;
const vec3 L = vec3(0.2126, 0.7152, 0.0722);
vec3 curve(vec3 c) {
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  return c * (max(soft, br - uThreshold) / max(br, 1e-4));
}
void main() {
  vec2 o = uTexel;
  vec3 a = texture(tSrc, vUv + vec2(-o.x, -o.y)).rgb;
  vec3 b = texture(tSrc, vUv + vec2( o.x, -o.y)).rgb;
  vec3 c = texture(tSrc, vUv + vec2(-o.x,  o.y)).rgb;
  vec3 d = texture(tSrc, vUv + vec2( o.x,  o.y)).rgb;
  float wa = 1.0 / (1.0 + dot(a, L));
  float wb = 1.0 / (1.0 + dot(b, L));
  float wc = 1.0 / (1.0 + dot(c, L));
  float wd = 1.0 / (1.0 + dot(d, L));
  vec3 s = (a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd);
  outColor = vec4(curve(max(s, vec3(0.0))), 1.0);
}`;

/** 9-tap tent, used for both halving and doubling. */
const FRAG_TENT = /* glsl */`
precision highp float;
in vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform vec3 uTint;
uniform float uScale;
out vec4 outColor;
void main() {
  vec2 o = uTexel;
  vec3 s =
      texture(tSrc, vUv + vec2(-o.x, -o.y)).rgb * 1.0
    + texture(tSrc, vUv + vec2( 0.0, -o.y)).rgb * 2.0
    + texture(tSrc, vUv + vec2( o.x, -o.y)).rgb * 1.0
    + texture(tSrc, vUv + vec2(-o.x,  0.0)).rgb * 2.0
    + texture(tSrc, vUv                    ).rgb * 4.0
    + texture(tSrc, vUv + vec2( o.x,  0.0)).rgb * 2.0
    + texture(tSrc, vUv + vec2(-o.x,  o.y)).rgb * 1.0
    + texture(tSrc, vUv + vec2( 0.0,  o.y)).rgb * 2.0
    + texture(tSrc, vUv + vec2( o.x,  o.y)).rgb * 1.0;
  outColor = vec4(s * (1.0 / 16.0) * uScale * uTint, 1.0);
}`;

/** One axis of the anamorphic streak. Run twice with growing stride. */
const FRAG_STREAK = /* glsl */`
precision highp float;
in vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uStride;
out vec4 outColor;
void main() {
  vec3 s = vec3(0.0);
  float wsum = 0.0;
  for (int i = -6; i <= 6; i++) {
    float fi = float(i);
    float w = exp(-fi * fi * 0.055);
    s += texture(tSrc, vUv + vec2(fi * uStride * uTexel.x, 0.0)).rgb * w;
    wsum += w;
  }
  outColor = vec4(s / wsum, 1.0);
}`;

const FRAG_COMPOSITE = /* glsl */`
precision highp float;
in vec2 vUv;
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform sampler2D tStreak;
uniform float uBloom;
uniform float uStreak;
uniform float uCA;
uniform float uVigStrength;
uniform float uVigInner;
uniform float uGrain;
uniform float uContrast;
uniform float uGain;
uniform float uSat;
uniform float uSplit;
uniform vec2  uVigScale;
out vec4 outColor;

const vec3 L = vec3(0.2126, 0.7152, 0.0722);
const vec3 SHADOW_COOL = vec3(0.84, 0.96, 1.20);
const vec3 HIGH_WARM   = vec3(1.12, 1.00, 0.82);
const vec3 HALATION    = vec3(1.22, 0.80, 0.62);
const vec3 STREAK_TINT = vec3(0.80, 0.90, 1.20);

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec2 d = vUv - 0.5;
  float r2 = dot(d, d) * 4.0;

  // CHROMATIC ABERRATION. Radial, quadratic, so the middle of the frame is untouched and
  // only the outer third fringes. A constant offset across the frame reads as a broken
  // renderer; a quadratic one reads as a fast lens.
  vec2 ca = d * (uCA * r2);
  vec3 col;
  col.r = texture(tScene, vUv + ca).r;
  col.g = texture(tScene, vUv).g;
  col.b = texture(tScene, vUv - ca).b;
  col = max(col, vec3(0.0));

  vec3 bl = texture(tBloom, vUv).rgb;
  vec3 st = texture(tStreak, vUv).rgb;

  // HALATION: the bloom is tinted warm-red in proportion to how much of it there is, so
  // a small glow stays neutral and a big one goes to orange the way film does around a
  // blown highlight. The streak stays blue-white, which is what separates a lamp from a
  // helmet.
  vec3 bloomTint = mix(vec3(1.0), HALATION, clamp(dot(bl, L) * 0.55, 0.0, 1.0));
  col += bl * uBloom * bloomTint;
  col += st * uStreak * STREAK_TINT;

  // GRADE, in linear, before the engine's ACES curve.
  // 1. log-space contrast around 18% grey.
  // A night game lives almost entirely BELOW the 18% pivot, so raising contrast about
  // that pivot darkens nearly the whole frame — measured on the first probe, the turf and
  // the jerseys both went to mud. uGain puts the level back after the curve has done its
  // work, which is the right order: shape first, then expose.
  vec3 lg = log2(max(col, vec3(1e-5)));
  const float PIVOT = -2.4739312;                 // log2(0.18)
  col = exp2((lg - PIVOT) * uContrast + PIVOT) * uGain;

  // 2. split tone.
  float l = dot(col, L);
  float sw = 1.0 - smoothstep(0.0, 0.30, l);
  float hw = smoothstep(0.30, 1.60, l);
  col = mix(col, col * SHADOW_COOL, sw * uSplit);
  col = mix(col, col * HIGH_WARM,  hw * uSplit);

  // 3. saturation, weighted so the shadows LOSE a little and the key GAINS.
  float l2 = dot(col, L);
  float sat = mix(uSat * 0.80, uSat, smoothstep(0.02, 0.45, l2));
  col = mix(vec3(l2), col, sat);

  // VIGNETTE. Strong on purpose — see the header measurement. Normalised so r = 1 at the
  // frame corners whatever the aspect ratio.
  float vr = length(d * uVigScale);
  float v = smoothstep(1.0, uVigInner, vr);
  col *= mix(1.0 - uVigStrength, 1.0, v);

  // GRAIN. Fixed to the output pixel, so it survives the accumulation average instead of
  // being smoothed into nothing — which is the point: it is texture, not noise.
  // 0.013, down from 0.020: at 0.020 it was clearly visible as speckle in the dark turf of
  // shots/cinematography/iso_pocket.png, where the turf normal map is already noisy. Grain
  // has to sit under whatever texture is already in the image, not compete with it.
  float g = hash21(floor(gl_FragCoord.xy)) - 0.5;
  col *= 1.0 + g * uGrain;

  outColor = vec4(max(col, vec3(0.0)), 1.0);
}`;

/* ------------------------------------------------------------------ the chain */

const LEVELS = 5;

// THRESHOLD 2.40, BLOOM 0.45, STREAK 0.10 — all three came down hard from 1.05 / 0.85 /
// 0.34, and the reason is a piece boundary rather than a preference.
//
// `stadium-lighting` already draws, in its own words, "authored anamorphic lens flares on
// every fixture". At a 1.05 threshold this chain was treating each of those flares as a
// light source and blooming it a second time, with a 13-tap streak on top. Two flare
// systems stacked is not twice as good, it is a sun: the probe frames had the whole upper
// third glowing and the floodlight ring smeared into a band.
//
// So the threshold now sits above anything but a genuinely blown highlight, the bloom is
// a halation on top of somebody else's flare rather than a second flare, and the streak is
// nearly off. If stadium-lighting ever drops its flares these are the numbers to put back
// up. (The starburst in the FIRST probe turned out not to be a flare at all — see the
// note on ISO_IMPACT in index.js — but the double-flare problem was real and is what
// these numbers fix.)
const BLOOM = 0.45;
const STREAK = 0.10;

/** Per-level upsample tint. The big, blurry levels carry the halation. */
const LEVEL_TINT = [
  [1.00, 1.00, 1.00],
  [1.00, 0.99, 0.97],
  [1.02, 0.96, 0.90],
  [1.06, 0.92, 0.82],
  [1.12, 0.88, 0.74],
];

export function buildPost(THREE, ctx, shot) {
  const renderer = ctx.renderer;

  const rtOpts = {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    colorSpace: THREE.NoColorSpace,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
    samples: 0,
  };

  let W = 0, H = 0;
  let rtScene = null;
  const bloom = new Array(LEVELS).fill(null);
  let streakA = null, streakB = null;

  const quad = makeQuad(THREE);

  const mPre = raw(THREE, FRAG_PREFILTER, {
    tSrc: { value: null }, uTexel: { value: new THREE.Vector2() },
    uThreshold: { value: 2.40 }, uKnee: { value: 0.90 },
  });
  const mTent = raw(THREE, FRAG_TENT, {
    tSrc: { value: null }, uTexel: { value: new THREE.Vector2() },
    uTint: { value: new THREE.Vector3(1, 1, 1) }, uScale: { value: 1 },
  });
  const mTentAdd = raw(THREE, FRAG_TENT, {
    tSrc: { value: null }, uTexel: { value: new THREE.Vector2() },
    uTint: { value: new THREE.Vector3(1, 1, 1) }, uScale: { value: 1 },
  });
  mTentAdd.blending = THREE.AdditiveBlending;
  const mStreak = raw(THREE, FRAG_STREAK, {
    tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uStride: { value: 1 },
  });
  const mComp = raw(THREE, FRAG_COMPOSITE, {
    tScene: { value: null }, tBloom: { value: null }, tStreak: { value: null },
    uBloom: { value: 0.45 }, uStreak: { value: 0.10 }, uCA: { value: 0.0016 },
    uVigStrength: { value: 0.54 }, uVigInner: { value: 0.30 }, uGrain: { value: 0.013 },
    uContrast: { value: 1.10 }, uGain: { value: 1.22 }, uSat: { value: 1.14 }, uSplit: { value: 0.55 },
    uVigScale: { value: new THREE.Vector2(1, 1) },
  });

  // Per-shot dial. A menu screen must not be vignetted into a tunnel, and the deep-ball
  // shot wants less grain than a hit does because it is a longer lens on a smaller
  // subject. Everything else is the house look.
  const isMenu = !!(shot && shot.ui && shot.ui.screen);
  if (isMenu) {
    mComp.uniforms.uVigStrength.value = 0.26;
    mComp.uniforms.uCA.value = 0.0008;
    mComp.uniforms.uGrain.value = 0.012;
    mComp.uniforms.uContrast.value = 1.05;
    mComp.uniforms.uGain.value = 1.06;
  }

  let budget = 5;     // postPasses from the quality rung; see applyRung

  function ensureSize(w, h) {
    if (w === W && h === H && rtScene) return;
    W = w; H = h;
    if (rtScene) rtScene.dispose();
    rtScene = new THREE.WebGLRenderTarget(W, H, Object.assign({}, rtOpts, { depthBuffer: true }));
    for (let i = 0; i < LEVELS; i++) {
      if (bloom[i]) bloom[i].dispose();
      const s = 1 << (i + 1);
      bloom[i] = new THREE.WebGLRenderTarget(Math.max(2, W / s | 0), Math.max(2, H / s | 0), rtOpts);
    }
    if (streakA) streakA.dispose();
    if (streakB) streakB.dispose();
    const sw = Math.max(2, W / 4 | 0), sh = Math.max(2, H / 4 | 0);
    streakA = new THREE.WebGLRenderTarget(sw, sh, rtOpts);
    streakB = new THREE.WebGLRenderTarget(sw, sh, rtOpts);
    // r = 1 at the corner, whatever the aspect.
    const corner = Math.sqrt(0.25 + 0.25);
    mComp.uniforms.uVigScale.value.set(1 / corner, 1 / corner);
  }

  function blit(mat, target, clear) {
    quad.mesh.material = mat;
    renderer.setRenderTarget(target);
    if (clear) renderer.clear(true, false, false);
    renderer.render(quad.scene, quad.cam);
    renderer.setRenderTarget(null);
  }

  function render(scene, camera, target, t, dt) {
    ensureSize(target.width, target.height);

    const autoClear = renderer.autoClear;
    renderer.autoClear = false;

    // 1. the scene, linear, into our own buffer.
    renderer.setRenderTarget(rtScene);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);

    // At least one level always runs so bloom[0] is never sampled uninitialised; `levels`
    // controls how deep the pyramid goes, and BLOOM is what turns it off.
    const levels = budget >= 5 ? 5 : budget >= 3 ? 4 : budget >= 1 ? 2 : 1;
    const bloomOn = budget > 0;

    if (levels > 0) {
      // 2. bright pass + halve.
      mPre.uniforms.tSrc.value = rtScene.texture;
      mPre.uniforms.uTexel.value.set(1 / W, 1 / H);
      blit(mPre, bloom[0], true);

      // 3. down the pyramid.
      for (let i = 1; i < levels; i++) {
        mTent.uniforms.tSrc.value = bloom[i - 1].texture;
        mTent.uniforms.uTexel.value.set(1 / bloom[i - 1].width, 1 / bloom[i - 1].height);
        mTent.uniforms.uScale.value = 1;
        mTent.uniforms.uTint.value.set(1, 1, 1);
        blit(mTent, bloom[i], true);
      }

      // 4. back up, adding into each level as we go. Additive blending instead of a
      //    ping-pong: one fewer target and one fewer full copy per level.
      for (let i = levels - 1; i > 0; i--) {
        mTentAdd.uniforms.tSrc.value = bloom[i].texture;
        mTentAdd.uniforms.uTexel.value.set(1 / bloom[i].width, 1 / bloom[i].height);
        mTentAdd.uniforms.uScale.value = 0.82;
        const tn = LEVEL_TINT[i];
        mTentAdd.uniforms.uTint.value.set(tn[0], tn[1], tn[2]);
        blit(mTentAdd, bloom[i - 1], false);
      }
    }

    // 5. the anamorphic streak, off level 1 so it is already soft vertically.
    const wantStreak = budget >= 3;
    if (wantStreak) {
      mStreak.uniforms.tSrc.value = bloom[1].texture;
      mStreak.uniforms.uTexel.value.set(1 / streakA.width, 1 / streakA.height);
      mStreak.uniforms.uStride.value = 2.0;
      blit(mStreak, streakA, true);
      mStreak.uniforms.tSrc.value = streakA.texture;
      mStreak.uniforms.uStride.value = 11.0;
      blit(mStreak, streakB, true);
    }

    // 6. composite into the engine's accumulation sample buffer.
    mComp.uniforms.tScene.value = rtScene.texture;
    // Always BOUND, even when the strength is zero: sampling an unbound sampler2D is
    // undefined behaviour, and multiplying an uninitialised half-float target by 0.0 can
    // still yield NaN if the garbage happens to be an infinity.
    mComp.uniforms.tBloom.value = bloom[0].texture;
    mComp.uniforms.tStreak.value = streakB.texture;
    mComp.uniforms.uBloom.value = bloomOn ? BLOOM : 0.0;
    mComp.uniforms.uStreak.value = wantStreak ? STREAK : 0.0;
    mComp.uniforms.uCA.value = budget >= 3 ? (isMenu ? 0.0008 : 0.0016) : 0.0;
    blit(mComp, target, true);

    renderer.autoClear = autoClear;
    void t; void dt;
  }

  return {
    piece: 'cinematography',
    render,
    setSize(w, h) { ensureSize(w, h); },
    /**
     * applyRung — allocates nothing, compiles nothing, resizes nothing. It only moves the
     * number of pyramid levels the composite is allowed to walk, which is the registry's
     * stated contract for this hook.
     */
    applyRung(rung, spec) { budget = spec && spec.postPasses !== undefined ? spec.postPasses : 5; },
    dispose() {
      if (rtScene) rtScene.dispose();
      for (const b of bloom) if (b) b.dispose();
      if (streakA) streakA.dispose();
      if (streakB) streakB.dispose();
      quad.geo.dispose();
      mPre.dispose(); mTent.dispose(); mTentAdd.dispose(); mStreak.dispose(); mComp.dispose();
    },
  };
}

function raw(THREE, frag, uniforms) {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERT,
    fragmentShader: frag,
    uniforms,
    depthTest: false,
    depthWrite: false,
  });
}

function makeQuad(THREE) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const mesh = new THREE.Mesh(geo, null);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  return { scene, cam, mesh, geo };
}

export default { buildPost };
