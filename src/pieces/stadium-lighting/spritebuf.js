// PIECE stadium-lighting — the additive-quad accumulator.
//
// Every flare, streak, star, haze billow, rain streak and bolt segment in the piece is
// one entry here. They are merged into ONE BufferGeometry per mesh, so the whole
// atmosphere costs a handful of draw calls instead of a few hundred sprites.
//
// Built once at load. Nothing in this file runs inside the frame loop.

import * as THREE from 'three';
import { tileUV } from './textures.js';

/** GAIN GROUPS — the index into the shared material's `uGains` vec4. */
export const GRP = { atmos: 0, rain: 1, bolt: 2, veil: 3 };

export function makeSpriteBuf(group) {
  return {
    group: group || 0,
    pos: [], nrm: [], corner: [], size: [], color: [], rect: [], param: [], extra: [], idx: [], n: 0,
  };
}

/**
 * push(buf, x, y, z, w, h, [r,g,b], tile, mode, phase, speed, rotOrSpan, axis?)
 *   mode 0  camera-facing billboard, `rotOrSpan` rotates it in screen space
 *   mode 1  rain streak: falls at `speed` m/s and wraps over `rotOrSpan` metres
 *   mode 2  ribbon billboarded about `axis`
 */
export function push(buf, x, y, z, w, h, col, tile, mode, phase, speed, rotOrSpan, axis, tilt) {
  const r = tileUV(tile);
  const base = buf.n * 4;
  const ax = axis ? axis[0] : 0, ay = axis ? axis[1] : 1, az = axis ? axis[2] : 0;
  const C = [-1, -1, 1, -1, 1, 1, -1, 1];
  for (let k = 0; k < 4; k++) {
    buf.pos.push(x, y, z);
    buf.nrm.push(ax, ay, az);
    buf.corner.push(C[k * 2], C[k * 2 + 1]);
    buf.size.push(w, h);
    buf.color.push(col[0], col[1], col[2]);
    buf.rect.push(r[0], r[1], r[2], r[3]);
    buf.param.push(mode, phase, speed, rotOrSpan);
    buf.extra.push(buf.group, tilt || 0);
  }
  buf.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  buf.n++;
  return buf;
}

export function toGeometry(buf, name) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(buf.nrm, 3));
  g.setAttribute('aCorner', new THREE.Float32BufferAttribute(buf.corner, 2));
  g.setAttribute('aSize', new THREE.Float32BufferAttribute(buf.size, 2));
  g.setAttribute('aColor', new THREE.Float32BufferAttribute(buf.color, 3));
  g.setAttribute('aRect', new THREE.Float32BufferAttribute(buf.rect, 4));
  g.setAttribute('aParam', new THREE.Float32BufferAttribute(buf.param, 4));
  g.setAttribute('aExtra', new THREE.Float32BufferAttribute(buf.extra, 2));
  g.setIndex(buf.idx);
  g.name = name || 'sl.sprites';
  // These meshes are deliberately never culled: the flare ring wraps the whole bowl
  // and its bounding sphere is meaningless, and a per-frame bounds test on a merged
  // 400-quad buffer buys nothing.
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 12, 0), 400);
  return g;
}

/** Standard mesh setup for anything additive this piece owns. */
export function makeSpriteMesh(geo, mat, name, order) {
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  m.frustumCulled = false;
  m.castShadow = false;
  m.receiveShadow = false;
  m.userData.wantShadow = false;
  m.renderOrder = order === undefined ? 8 : order;
  m.matrixAutoUpdate = false;
  return m;
}

export default { makeSpriteBuf, push, toGeometry, makeSpriteMesh, GRP };
