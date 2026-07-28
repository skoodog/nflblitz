// FOUNDATION FALLBACK — replaced by piece `turf-field` via registerWorld('turf', ...).
// Deliberately plain: a flat untextured green plane with painted yard lines drawn
// into a low-res canvas. No displacement, no wetness, no torn divots.
//
// FIELD COORDS: origin midfield, +X right sideline, +Z near sideline, 1 unit = 1 m.
// Playing surface 91.44 x 48.8, goal lines at |X| = 45.72.

import * as THREE from 'three';
import { FIELD } from '../contracts.js';

function paintCanvas(texlab) {
  const W = 1024, H = 512;
  const { cv, ctx } = texlab.canvas(W, H);
  ctx.fillStyle = '#2f5a2c';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(225,230,225,0.75)';
  ctx.lineWidth = 3;
  // yard lines every 5 yards across the 100-yard playing field portion
  const totalM = FIELD.length;
  for (let yd = -50; yd <= 50; yd += 5) {
    const xm = yd * FIELD.yardM;
    const u = (xm + totalM / 2) / totalM;
    ctx.beginPath();
    ctx.moveTo(u * W, H * 0.04);
    ctx.lineTo(u * W, H * 0.96);
    ctx.stroke();
  }
  // endzone fills
  ctx.fillStyle = 'rgba(20,50,90,0.55)';
  const ez = (FIELD.endzoneDepth / totalM) * W;
  ctx.fillRect(0, 0, ez, H);
  ctx.fillRect(W - ez, 0, ez, H);
  // sidelines
  ctx.strokeStyle = 'rgba(235,240,235,0.9)';
  ctx.lineWidth = 5;
  ctx.strokeRect(2, 2, W - 4, H - 4);
  return { cv, ctx };
}

const impl = {
  piece: 'foundation-fallback',
  _marks: [],
  build(ctx) {
    const g = new THREE.Group();
    g.name = 'turf.fallback';
    const paint = paintCanvas(ctx.texlab);
    const tex = ctx.texlab.toTexture(paint, { srgb: true, wrap: THREE.ClampToEdgeWrapping, aniso: 8 });
    const geo = new THREE.PlaneGeometry(FIELD.length, FIELD.width, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0.0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'turf.plane';
    g.add(mesh);
    this._group = g;
    this._marks.length = 0;
    return g;
  },
  addDivot() { /* fallback: no displacement */ },
  addCleatMark() { /* fallback: no decals */ },
  addSkid() { /* fallback: no decals */ },
  reset() { this._marks.length = 0; },
  update() { },
  /** Ground height at a field position. Pieces may override with real displacement. */
  heightAt() { return 0; },
};

export default impl;
