// PIECE turf-field — near-camera shell grass (turf class 3, rungs 12-15 and capture).
//
// Six shells of a shared radial disc, drawn as ONE InstancedMesh: 1 draw call, 1
// geometry, 1 program for the whole grass volume. Each instance sits a little higher
// and alpha-tests against the blade-height sheet, so only progressively taller blades
// survive — real grass volume at the bottom of frame where a low camera can see it,
// and nothing at all beyond the fade radius.
//
// Alpha TEST, never alpha blend: depth writes stay on, there is no sort, and the
// overdraw contribution stays bounded (the top shells cover a few percent of texels).

import * as THREE from 'three';
import { MOW_PERIOD, LINE_HW, GOAL_X, YD, HASH_Z, HASH_HALF_LEN, HALF_W } from './field.js';

const F = (n) => (Math.round(n * 1e6) / 1e6).toFixed(6);

/** Polar disc, denser toward the middle where the camera actually is. */
function discGeometry(radius, rings, segs) {
  const nv = (rings + 1) * (segs + 1);
  const pos = new Float32Array(nv * 3);
  const nrm = new Float32Array(nv * 3);
  const uvs = new Float32Array(nv * 2);
  const idx = [];
  let p = 0, q = 0;
  for (let r = 0; r <= rings; r++) {
    const tr = r / rings;
    const rad = radius * tr * tr * (3 - 2 * tr);   // smoothstep radial density
    for (let s = 0; s <= segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      pos[p] = Math.cos(a) * rad; pos[p + 1] = 0; pos[p + 2] = Math.sin(a) * rad;
      nrm[p] = 0; nrm[p + 1] = 1; nrm[p + 2] = 0;
      uvs[q] = tr; uvs[q + 1] = s / segs;
      p += 3; q += 2;
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segs; s++) {
      const a = r * (segs + 1) + s;
      const b = a + segs + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export function createShells(cfg, tex, uniforms) {
  const count = cfg.shells;
  if (!count) return null;

  const radius = cfg.shellRadius;
  const geo = discGeometry(radius, 18, 54);
  const shellH = 0.075;

  const u = {
    uTDetail: uniforms.uTDetail,
    uTHeight: { value: tex.height },
    uPaintTint: uniforms.uPaintTint,
    uWet: uniforms.uWet,
    uGrassGain: uniforms.uGrassGain,
    uShellH: { value: shellH },
    uShellR: { value: radius },
  };

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.88, metalness: 0.0,
    alphaTest: 0.5, side: THREE.DoubleSide,
  });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vShWP;
varying float vShT;
varying float vShR;
uniform float uShellH;
uniform float uShellR;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  vShT = clamp( instanceMatrix[ 3 ][ 1 ] / max( uShellH, 1e-4 ), 0.0, 1.0 );
#else
  vShT = 0.5;
#endif
vShR = length( position.xz ) / max( uShellR, 0.01 );
vShWP = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`);

    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vShWP;
varying float vShT;
varying float vShR;
uniform sampler2D uTDetail;
uniform sampler2D uTHeight;
uniform vec3 uPaintTint;
uniform float uWet;
uniform float uGrassGain;
float shBand( float d, float hw, float w ) { return 1.0 - smoothstep( hw - w, hw + w, d ); }
float shRep( float x, float p ) { return abs( fract( x / p + 0.5 ) - 0.5 ) * p; }`)
      .replace('#include <map_fragment>', `
{
  vec2 P = vShWP.xz;
  vec2 Pl = P + vec2( 0.018, 0.011 ) * vShT;      // blades lean a little more each shell
  float hgt = texture2D( uTHeight, Pl * 0.826446 ).r;
  float fade = 1.0 - smoothstep( 0.52, 1.0, vShR );
  // Alpha-tested foliage MUST fade out once a texel is smaller than a pixel or it
  // aliases into a moire of black specks. This is that gate, in world metres/pixel.
  float aa = smoothstep( 0.0035, 0.017, fwidth( P.x ) );
  float thr = mix( 0.30, 0.86, vShT ) + ( 1.0 - fade ) * 1.2 + aa * 1.8;
  if ( hgt < thr ) discard;
  vec3 alb = texture2D( uTDetail, Pl * 0.826446 ).rgb * uGrassGain;
  alb *= mix( 0.92, 1.42, vShT );                 // tips catch the key, roots occlude
  alb *= mix( 1.0, 0.58, uWet );
  float w = max( fwidth( P.x ), 1e-5 ) * 0.9;
  float onLine = max(
    shBand( shRep( P.x, ${F(MOW_PERIOD)} ), ${F(LINE_HW)}, w ) * step( abs( P.x ), ${F(GOAL_X)} ),
    shBand( shRep( P.x, ${F(YD)} ), ${F(HASH_HALF_LEN)}, w ) * shBand( abs( abs( P.y ) - ${F(HASH_Z)} ), ${F(LINE_HW)}, w )
  ) * step( abs( P.y ), ${F(HALF_W)} );
  alb = mix( alb, uPaintTint * 0.8, onLine * 0.72 );
  diffuseColor.rgb *= alb;
}`);
  };
  mat.customProgramCacheKey = () => 'turfshell:1';

  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.name = 'turf.shells';

  const m = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    const t = (i + 1) / count;
    m.makeRotationY(i * 0.41);
    m.elements[13] = t * shellH;
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;

  return {
    mesh,
    material: mat,
    geometry: geo,
    uniforms: u,
    setCenter(x, z) { mesh.position.set(x, 0, z); },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}

export default { createShells };
