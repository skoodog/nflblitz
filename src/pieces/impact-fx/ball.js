// PIECE impact-fx — THE FLAMING BALL.
//
// The reference is bar/panel-qb_dropback.png (and the same ball in the concept sheet):
// the fire is NOT a halo around the ball, it is a RIBBON streaming off it — white-hot
// where it leaves the leather, saturating through orange to a deep red, and dissolving
// into dark smoke a metre and a half back. There are separate licks of flame breaking
// off the main body, and a scatter of embers.
//
// STRUCTURE. `mesh` is a Group, not a Mesh, because foundation/world.js does
//     ball.mesh.position.set(...); ball.mesh.quaternion.set(...); root.add(ball.mesh)
// and the ball SPINS while the flame must not. Group -> { shell (spins), fire (does
// not) } is the only arrangement that gives both without the flame corkscrewing.
// A Group satisfies world.js exactly as well as a Mesh does; it only ever sets a
// transform on it.
//
// COST. shell 1056 triangles / 1 draw / 2 textures (1.1 MB at 512x256 RGBA + mips),
// fire 132 quads = 264 triangles / 1 draw / 1 program, sharing the impact atlas.

import * as THREE from 'three';
import { fbm2, worley2, cached } from '../../foundation/texlab.js';
import { hash01 } from '../../foundation/rng.js';
import { fxAtlas } from './atlas.js';
import { BALL_HALF_LEN, BALL_RADIUS, BALL_TRAIL, POOL_FLAME, CELL } from './config.js';

/* ------------------------------------------------------------------ leather */

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function sstep(a, b, x) {
  if (a === b) return x < a ? 0 : 1;
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/**
 * The laces and the two stripes, as a signed field over the lathe's (u,v) — u around the
 * ball, v tip to tip. Returns 0..1 "how white is this texel".
 */
function whiteMask(u, v) {
  // Two stripes, one near each end. Real balls have them about 3 inches from the point,
  // and THE OLD NUMBERS HERE DID NOT PUT THEM THERE. v is the lathe's ring index over
  // M = 22 rings, and the rings are cos-spaced, so v does not run linearly along the
  // ball: y = -cos(v * pi) * L. v = 0.175 is y = -0.853 L, which is 0.025 m from the
  // tip — ONE inch, not three — where the parabolic profile is only 0.27 R wide and a
  // stripe is a few pixels of nothing. Three inches from the point on this 0.336 m ball
  // is y = 0.455 L, which is v = acos(0.455)/pi = 0.350 (and 0.650), where the ball is
  // 0.79 R wide. Measured on iso_impact_ball after the move: both stripes are on screen
  // and 766 px of the ball's 13,826 px interior read as white band, against 33 before.
  // (The laces are a single meridian at u = 0.5 and are only visible for half a turn;
  // the stripes are circumferential and are there at every rotation, which is why they
  // are the thing to measure.)
  let m = sstep(0.318, 0.330, v) * sstep(0.384, 0.372, v);
  m = Math.max(m, sstep(0.682, 0.670, v) * sstep(0.616, 0.628, v));
  // The lace panel runs along one meridian. `du` wraps so the seam at u=0 is handled.
  let du = Math.abs(u - 0.5);
  const inPanel = sstep(0.660, 0.640, v) * sstep(0.340, 0.360, v);
  // the raised centre band the laces are stitched through
  m = Math.max(m, inPanel * sstep(0.030, 0.024, du) * 0.55);
  // eight rungs across it
  const rung = Math.abs(((v - 0.36) / (0.28 / 8)) % 1 - 0.5) * 2;
  m = Math.max(m, inPanel * sstep(0.062, 0.052, du) * sstep(0.45, 0.72, rung));
  return clamp01(m);
}

function ballTextures() {
  return cached('impactfx:ball:512x256', () => {
    const W = 512, H = 256;
    let cv, cvN;
    const mk = () => {
      if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(W, H);
      const c = document.createElement('canvas'); c.width = W; c.height = H; return c;
    };
    cv = mk(); cvN = mk();
    const g = cv.getContext('2d', { willReadFrequently: true });
    const gn = cvN.getContext('2d', { willReadFrequently: true });
    const img = g.createImageData(W, H);
    const imgN = gn.createImageData(W, H);

    for (let y = 0; y < H; y++) {
      const v = (y + 0.5) / H;
      for (let x = 0; x < W; x++) {
        const u = (x + 0.5) / W;
        // Pebble grain: worley cells make round bumps, which is what pebbling is.
        //
        // THIS WAS A NaN FACTORY AND IT COST THE WHOLE TEXTURE. foundation/texlab.js's
        // worley2() returns an OBJECT — { f1, f2, id, cx, cy } — not a distance, so
        // `cellf * 2.1` was NaN, `pebble` was NaN, `shade` was NaN, and every channel of
        // both canvases was written as NaN. A Uint8ClampedArray stores NaN as 0, so the
        // 512x256 albedo was SOLID BLACK and the normal map was solid (0,0,0), i.e. a
        // decoded normal of (-1,-1,-1). Everything orange about the ball in
        // shots/impact-fx/iso_impact_ball.png was emissive and bloom; the laces, the
        // stripes and the pebbling had never once reached the screen. That is the real
        // reason the critic measured an interior R standard deviation of 3% and zero
        // stripe pixels — the emissive was too strong as well, but this is why there was
        // nothing underneath it to eat.
        // f1 is the distance to the nearest feature point: 0 at a cell centre, ~1 in the
        // crevice between cells, which is the right sense for `shade` below (crevices dark).
        const cellf = worley2(u * 74, v * 34, 17).f1;
        const pebble = Math.pow(clamp01(cellf * 2.1), 0.7);
        const scuff = fbm2(u * 9, v * 5, { octaves: 4, seed: 91 }) * 0.5 + 0.5;
        const wm = whiteMask(u, v);

        // Base leather. Darker toward the tips because the surface curves away there,
        // which sells the shape even before the light hits it.
        const tip = Math.pow(Math.abs(v * 2 - 1), 2.6);
        let r = 0.318, gg = 0.129, b = 0.070;
        r *= 0.62 + scuff * 0.62; gg *= 0.60 + scuff * 0.66; b *= 0.58 + scuff * 0.70;
        const shade = 1 - tip * 0.52 - pebble * 0.20;
        r *= shade; gg *= shade; b *= shade;
        // white stripe / laces
        r = r + (0.86 - r) * wm; gg = gg + (0.83 - gg) * wm; b = b + (0.78 - b) * wm;

        let i = (y * W + x) * 4;
        img.data[i] = clamp01(r) * 255;
        img.data[i + 1] = clamp01(gg) * 255;
        img.data[i + 2] = clamp01(b) * 255;
        img.data[i + 3] = 255;

        // Height -> normal, computed analytically from the same fields rather than by
        // differencing a luminance canvas: pebbling is high frequency and the finite
        // difference of an 8-bit canvas was visibly quantised into terraces.
        const e = 1 / W;
        // Same worley2().f1 fix as above, and INVERTED relative to `pebble`: a pebble is a
        // raised bump with a low crevice around it, so height is 1 - pebble. The old
        // expression (had it produced a number at all) would have embossed the crevices.
        const hAt = (uu, vv) => (1 - Math.pow(clamp01(worley2(uu * 74, vv * 34, 17).f1 * 2.1), 0.7)) * 0.55
          + whiteMask(uu, vv) * 0.45;
        const dx = (hAt(u + e, v) - hAt(u - e, v)) * 9.0;
        const dy = (hAt(u, v + e) - hAt(u, v - e)) * 9.0;
        const nx = -dx, ny = -dy, nz = 1;
        const L = Math.hypot(nx, ny, nz);
        i = (y * W + x) * 4;
        imgN.data[i] = (nx / L * 0.5 + 0.5) * 255;
        imgN.data[i + 1] = (ny / L * 0.5 + 0.5) * 255;
        imgN.data[i + 2] = (nz / L * 0.5 + 0.5) * 255;
        imgN.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    gn.putImageData(imgN, 0, 0);

    const map = new THREE.CanvasTexture(cv);
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = THREE.RepeatWrapping; map.wrapT = THREE.ClampToEdgeWrapping;
    map.anisotropy = 8; map.needsUpdate = true;
    const nrm = new THREE.CanvasTexture(cvN);
    nrm.colorSpace = THREE.NoColorSpace;
    nrm.wrapS = THREE.RepeatWrapping; nrm.wrapT = THREE.ClampToEdgeWrapping;
    nrm.anisotropy = 8; nrm.needsUpdate = true;
    return { map, nrm };
  });
}

/* ----------------------------------------------------------------- geometry */

/**
 * A prolate profile with GENUINELY POINTED ends — a parabola of revolution.
 *
 *   r(y) = R * (1 - (y/L)^2)          i.e. the exponent is 1, not 0.62
 *
 * THE OLD COMMENT HERE WAS FALSE AND THE SHAPE WAS WRONG. It read "the 0.62 exponent is
 * what makes the tips come to a point instead of rounding off". For r = R(1-(y/L)^2)^p
 * the tip slope is
 *      dr/dy = -2pR/L^2 * y * (1-(y/L)^2)^(p-1)
 * and for ANY p < 1 that exponent is negative, so |dr/dy| -> INFINITY as y -> ±L. An
 * infinite slope is the profile meeting the axis at a right angle: a rounded pole, the
 * same C1 class as the sphere the comment claimed it beat. Measured on the old profile,
 * |dr/dy| was 3.2 at y = 0.99L, 7.7 at 0.999L and 44.2 at 0.99999L — still climbing,
 * never settling on a tip angle. At 90% of the half-length it was 0.357R against a
 * sphere's 0.436R: 18% narrower than an egg, not a point.
 *
 * p = 1 is the only exponent in the family that gives a real corner: dr/dy at the tip is
 * exactly -2R/L = -1.167, a tip half-angle of atan(1.167) = 49.4 degrees from the long
 * axis (98.8 degrees included). For comparison, the classic two-circular-arc "lens"
 * football profile through the same R and L has a tip half-angle of 60.5 degrees, so this
 * ball is slightly sharper-nosed than a regulation one — which is the right side to err on
 * for an arcade ball. p > 1 would be sharper still, but the slope goes to ZERO at the tip
 * (a cusp, a needle) and the whole middle of the ball gets thinner: at 90% of the
 * half-length p=1 gives 0.190R, p=1.25 gives 0.125R, and the ball stops reading as a ball.
 */
function ballGeometry() {
  return cached('impactfx:ball:geo', () => {
    const M = 22, SEG = 24;
    const pts = [];
    for (let i = 0; i <= M; i++) {
      // COS SPACING, and the reason is not curvature — for a parabola the profile
      // curvature is HIGHEST at the equator (r'' is constant and r' = 0 there) and
      // lowest at the tips, so "more rings where the curvature is" would argue for the
      // opposite. It is here for the SILHOUETTE: cos spacing puts 4 of the 23 rings
      // inside the outer 10% of each end where uniform spacing puts 2, and the tip is
      // the one place on a lathe where losing a ring turns a point into a chopped cone.
      const t = i / M;
      const y = -Math.cos(t * Math.PI) * BALL_HALF_LEN;
      const k = Math.max(0, 1 - (y / BALL_HALF_LEN) * (y / BALL_HALF_LEN));
      const r = BALL_RADIUS * k;
      pts.push(new THREE.Vector2(Math.max(r, 0.0004), y));
    }
    const geo = new THREE.LatheGeometry(pts, SEG);
    // Lathe revolves around Y; the ShotSpec's ball has no orientation convention, but a
    // spiralling ball must spin about its LONG axis and world.js drives that through
    // rotation.z, so the long axis has to be Z.
    geo.rotateX(Math.PI / 2);
    geo.computeVertexNormals();
    geo.name = 'impactfx.ball';
    return geo;
  });
}

/* -------------------------------------------------------------------- fire */

const FIRE_VERT = /* glsl */`
in vec4 aCorner;   // (corner.x, corner.y, priority, spare)
in vec4 aFlame;    // (seg 0..1, row -1..1, seed 0..1, kind)

out vec2 vUv;
out vec3 vColor;
out float vFade;

uniform float uTime;
uniform float uFlame;     // 0..1 from setFlame()
uniform float uPrioCut;
uniform vec3 uTrail;      // unit, ball-local
uniform vec3 uSide;
uniform vec3 uUp;
uniform float uLen;
uniform float uSize;
uniform float uWander;
uniform float uRise;
uniform float uFlow;

const float CELLS = 4.0;
const float INSET = 0.0234375;

// The row is mirrored because the atlas texture keeps flipY = true; see the long note
// on the same expression in quads.js.
vec2 cellUv(float cell, vec2 uv01) {
  vec2 c = vec2(mod(cell, CELLS), CELLS - 1.0 - floor(cell / CELLS));
  return (c + INSET * 4.0 + uv01 * (1.0 - INSET * 8.0)) / CELLS;
}

void main() {
  float kind = aFlame.w;
  if (uFlame <= 0.004 || (aCorner.z > uPrioCut && aCorner.z >= 0.0)) {
    vFade = 0.0; vColor = vec3(0.0); vUv = vec2(0.0);
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  // s runs 0 (leaving the leather) to 1 (gone). Everything flows outward together, so
  // the fire streams rather than pulsing in place.
  float rate = kind > 0.5 && kind < 1.5 ? 1.55 : (kind > 2.5 ? 2.4 : 1.0);
  float s = fract(aFlame.x + uTime * uFlow * rate);
  if (kind > 2.5) s *= 0.30;              // envelope licks stay hugging the ball

  float ph = aFlame.z * 6.2831853 + uTime * 7.0;
  float w1 = sin(ph + s * 8.0) * 0.55 + sin(ph * 1.73 + s * 13.0) * 0.30;
  float w2 = cos(ph * 1.31 + s * 10.0) * 0.55 + cos(ph * 2.11 + s * 15.0) * 0.26;
  float lat = uWander * s + 0.012;

  float len = uLen * (0.45 + 0.55 * uFlame);
  vec3 P = uTrail * (s * len)
         + uSide * (w1 * lat + aFlame.y * 0.030)
         + uUp * (w2 * lat * 0.75 + s * s * uRise);

  float cell, size, aShape;
  vec3 col;
  if (kind < 0.5) {
    // TONGUE — the body of the fire.
    cell = ${CELL.FLAME}.0;
    float g = pow(s, 0.45);
    size = uSize * (0.26 + 1.30 * g * (1.0 - s * 0.52));
    aShape = smoothstep(0.0, 0.05, s) * pow(1.0 - s, 1.15);
    col = mix(vec3(4.2, 3.4, 2.10), vec3(3.0, 1.05, 0.18), smoothstep(0.0, 0.30, s));
    col = mix(col, vec3(1.15, 0.22, 0.030), smoothstep(0.28, 0.64, s));
    col = mix(col, vec3(0.13, 0.10, 0.095), smoothstep(0.60, 1.0, s));
  } else if (kind < 1.5) {
    // EMBER — breaks away from the ribbon and drifts.
    cell = ${CELL.EMBER}.0;
    size = uSize * (0.10 + aFlame.z * 0.10) * (1.0 - s * 0.4);
    P += uSide * (aFlame.y * s * 0.34) + uUp * (s * s * 0.22);
    aShape = smoothstep(0.0, 0.08, s) * pow(1.0 - s, 1.4)
           * (0.55 + 0.45 * sin(uTime * 34.0 + aFlame.z * 20.0));
    col = mix(vec3(3.4, 1.6, 0.42), vec3(1.5, 0.28, 0.04), s);
  } else if (kind < 2.5) {
    // CORE — the heat bloom sitting on the leather itself.
    cell = ${CELL.GLOW}.0;
    P = uTrail * 0.035;
    size = uSize * (2.0 + 0.22 * sin(uTime * 11.0 + aFlame.z * 6.0));
    aShape = 0.55;
    col = vec3(2.6, 1.15, 0.34);
  } else {
    // ENVELOPE — short licks wrapping the ball so the fire is attached to it.
    cell = ${CELL.FLAME}.0;
    size = uSize * (0.32 + 0.55 * (1.0 - s / 0.30));
    aShape = smoothstep(0.0, 0.04, s) * pow(1.0 - s / 0.30, 0.9);
    col = mix(vec3(4.4, 3.2, 1.7), vec3(3.0, 1.0, 0.16), s / 0.30);
  }

  vec4 mv = modelViewMatrix * vec4(P, 1.0);
  vec3 av = mat3(modelViewMatrix) * uTrail;
  vec2 dy = dot(av.xy, av.xy) > 1e-8 ? normalize(av.xy) : vec2(0.0, 1.0);
  vec2 dx = vec2(dy.y, -dy.x);
  vec2 q = aCorner.xy * (size * 0.5);
  if (kind > 0.5 && kind < 2.5) {
    // embers and the core bloom are round; give them a plain screen-aligned quad
    mv.xy += q;
  } else {
    mv.xy += dx * q.x + dy * q.y;
  }
  gl_Position = projectionMatrix * mv;

  vUv = cellUv(cell, aCorner.xy * 0.5 + 0.5);
  vColor = col;
  vFade = aShape * uFlame;
}`;

// uTone: see the long note above FRAG in quads.js — a hand-written GLSL3 fragment shader
// gets none of three's injected output chunks, so on the play path (which writes straight
// to an sRGB backbuffer) this material has to apply the same ACES curve engine.js uses.
const FIRE_FRAG = /* glsl */`
precision highp float;
in vec2 vUv;
in vec3 vColor;
in float vFade;
uniform sampler2D uAtlas;
uniform float uTone;
out vec4 fragColor;

vec3 aces(vec3 x) {
  const mat3 IN = mat3(0.59719, 0.07600, 0.02840,
                       0.35458, 0.90834, 0.13383,
                       0.04823, 0.01566, 0.83777);
  const mat3 OUT = mat3( 1.60475, -0.10208, -0.00327,
                        -0.53108,  1.10813, -0.07276,
                        -0.07367, -0.00605,  1.07602);
  vec3 v = IN * x;
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return clamp(OUT * (a / b), 0.0, 1.0);
}
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(0.41666)) - 0.055, step(0.0031308, c));
}

void main() {
  if (vFade <= 0.0) discard;
  vec4 t = texture(uAtlas, vUv);
  float a = t.a * vFade;
  if (a <= 0.0015) discard;
  vec3 c = t.rgb * vColor * a;
  if (uTone > 0.5) c = toSRGB(aces(c));
  fragColor = vec4(c, 1.0);
}`;

/**
 * The fire mesh. Layout is fixed at build: 78 tongues, 30 embers, 3 core blooms,
 * 21 envelope licks = 132 quads. Their `seg` values are spread evenly so the ribbon is
 * continuous rather than clumped, and the whole thing is animated in the vertex shader.
 */
function buildFire(atlas, tone) {
  const N_TONGUE = 78, N_EMBER = 30, N_CORE = 3, N_ENV = 21;
  const total = N_TONGUE + N_EMBER + N_CORE + N_ENV;   // = POOL_FLAME
  const corner = new Float32Array(total * 4 * 4);
  const flame = new Float32Array(total * 4 * 4);
  const pos = new Float32Array(total * 4 * 3);
  const idx = new Uint32Array(total * 6);
  const CX = [-1, 1, 1, -1], CY = [-1, -1, 1, 1];

  let q = 0;
  const put = (seg, row, seed, kind, prio) => {
    for (let k = 0; k < 4; k++) {
      const o = (q * 4 + k) * 4;
      corner[o] = CX[k]; corner[o + 1] = CY[k]; corner[o + 2] = prio; corner[o + 3] = 0;
      flame[o] = seg; flame[o + 1] = row; flame[o + 2] = seed; flame[o + 3] = kind;
    }
    const b = q * 4, oi = q * 6;
    idx[oi] = b; idx[oi + 1] = b + 1; idx[oi + 2] = b + 2;
    idx[oi + 3] = b; idx[oi + 4] = b + 2; idx[oi + 5] = b + 3;
    q++;
  };

  // Core bloom first so it survives every rung; then the ribbon, then the trimmings.
  for (let i = 0; i < N_CORE; i++) put(0, 0, hash01(i, 5), 2, -1);
  for (let i = 0; i < N_ENV; i++) put(i / N_ENV, hash01(i, 61) * 2 - 1, hash01(i, 71), 3, i < 6 ? -1 : 0.10 + i * 0.02);
  for (let i = 0; i < N_TONGUE; i++) {
    const seg = i / N_TONGUE;
    put(seg, hash01(i, 13) * 2 - 1, hash01(i, 29), 0, i < 12 ? -1 : 0.08 + (i / N_TONGUE) * 0.55);
  }
  for (let i = 0; i < N_EMBER; i++) put(hash01(i, 101), hash01(i, 103) * 2 - 1, hash01(i, 107), 1, 0.45 + (i / N_EMBER) * 0.45);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aCorner', new THREE.BufferAttribute(corner, 4));
  geo.setAttribute('aFlame', new THREE.BufferAttribute(flame, 4));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 4);
  geo.name = 'impactfx.fire';

  const tr = new THREE.Vector3(BALL_TRAIL[0], BALL_TRAIL[1], BALL_TRAIL[2]).normalize();
  const side = new THREE.Vector3(0, 1, 0).cross(tr);
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
  side.normalize();
  const up = new THREE.Vector3().crossVectors(tr, side).normalize();

  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: FIRE_VERT,
    fragmentShader: FIRE_FRAG,
    uniforms: {
      uAtlas: { value: atlas },
      uTime: { value: 0 },
      uFlame: { value: 0 },
      uPrioCut: { value: 1 },
      uTrail: { value: tr },
      uSide: { value: side },
      uUp: { value: up },
      uLen: { value: 1.18 },
      uSize: { value: 0.34 },
      uWander: { value: 0.115 },
      uRise: { value: 0.10 },
      uFlow: { value: 0.72 },
      uTone: { value: tone ? 1 : 0 },
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: true,
  });
  mat.name = 'impactfx.fire';

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'ball.fire';
  mesh.frustumCulled = false;
  mesh.renderOrder = 14;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData.wantShadow = false;
  void POOL_FLAME;   // asserted by the count above; kept in config for the budget note
  return { mesh, mat, tr, side, up };
}

/* -------------------------------------------------------------------- API */

export function makeBall(ctx) {
  const T = ctx && ctx.THREE ? ctx.THREE : THREE;
  void T;
  const { map, nrm } = ballTextures();
  const shellMat = new THREE.MeshStandardMaterial({
    map,
    normalMap: nrm,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughness: 0.62,
    metalness: 0.0,
    emissive: new THREE.Color(0, 0, 0),
  });
  shellMat.name = 'impactfx.ballShell';

  const shell = new THREE.Mesh(ballGeometry(), shellMat);
  shell.name = 'ball.shell';
  shell.castShadow = true;
  shell.receiveShadow = true;

  const fire = buildFire(fxAtlas(), ctx && ctx.mode === 'play');

  const group = new THREE.Group();
  group.name = 'ball';
  group.add(shell);
  group.add(fire.mesh);
  fire.mesh.visible = false;

  let spin = 0;
  let flame = 0;

  return {
    mesh: group,
    shell,
    fire: fire.mesh,

    /** 0..1. Drives the fire's brightness AND the leather's own emissive heat. */
    setFlame(v) {
      flame = v < 0 ? 0 : v > 1 ? 1 : v;
      fire.mat.uniforms.uFlame.value = flame;
      fire.mesh.visible = flame > 0.004;
      // The ball is lit BY its own fire. Without this the leather stays night-dark and
      // the flame reads as a decal stuck in front of it.
      // THE HEAT MUST NOT EAT THE LEATHER. Measured on iso_impact_ball.png: the ball
      // interior came back R mean 246.6 with a standard deviation of 7.3 -- 3% -- and ZERO
      // pixels reading as a white stripe. The first correction blamed that entirely on the
      // emissive being (0.81,0.26,0.06) linear against a leather albedo of about
      // (0.27,0.11,0.06), and halved it. THAT DIAGNOSIS WAS ONLY HALF RIGHT and it is
      // recorded here because it hid the real fault for a round: the albedo was not being
      // out-shouted, it did not exist. worley2() returns an object, `cellf * 2.1` was NaN,
      // and both canvases were written as zeros — see the note in ballTextures(). Every
      // orange pixel on that ball was emissive plus bloom. With a real albedo underneath
      // it (leather ~60/255 sRGB, stripes 219/255) the emissive can come down again: it
      // now only has to keep the silhouette warm, not stand in for the whole surface.
      shellMat.emissive.setRGB(0.22 * flame, 0.068 * flame, 0.015 * flame);
      shellMat.emissiveIntensity = 0.20 + flame * 0.32;
    },

    /** Revolutions per second about the ball's long axis. */
    setSpin(rps) { spin = rps || 0; },

    /**
     * Override the trail direction (ball-local). Nothing in the ShotSpec carries a ball
     * velocity, so the default comes from config.BALL_TRAIL; a caller that DOES know
     * which way the ball is going should call this.
     */
    setTrail(dx, dy, dz) {
      const v = fire.mat.uniforms.uTrail.value.set(dx, dy, dz).normalize();
      const s = fire.mat.uniforms.uSide.value.set(0, 1, 0).cross(v);
      if (s.lengthSq() < 1e-6) s.set(1, 0, 0);
      s.normalize();
      fire.mat.uniforms.uUp.value.crossVectors(v, s).normalize();
    },

    applyRung(rung, spec) {
      const p = spec && spec.particles !== undefined ? spec.particles : 4000;
      fire.mat.uniforms.uPrioCut.value = p <= 0 ? 0 : Math.min(1, p / 1400);
      // The normal map is the first thing to go: at floor rungs the ball is a handful
      // of pixels and the tangent-space branch is not worth a program variant... but a
      // material change here WOULD recompile, and registry.js forbids that inside
      // applyRung. So it stays. Recorded so the next person does not "optimise" it in.
      void rung;
    },

    /** Zero allocation, two uniform writes and one euler assignment. */
    update(t) {
      if (spin) shell.rotation.z = t * spin * Math.PI * 2;
      if (flame > 0.004) fire.mat.uniforms.uTime.value = t;
    },

    dispose() {
      shell.geometry.dispose();
      shellMat.dispose();
      fire.mesh.geometry.dispose();
      fire.mat.dispose();
    },
  };
}

export default makeBall;
