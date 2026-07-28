// FOUNDATION FALLBACK — replaced by piece `impact-fx` via registerWorld('fx', ...).
// Deliberately plain: a handful of flat white square points per impact and an
// untextured brown ellipsoid for the ball. No sparks, no turf spray, no smoke,
// no flame, no motion trails.

import * as THREE from 'three';

const MAX = 2048;

const impl = {
  piece: 'foundation-fallback',

  build(ctx) {
    const T = ctx.THREE;
    const group = new T.Group();
    group.name = 'fx.fallback';

    const geo = new T.BufferGeometry();
    const pos = new Float32Array(MAX * 3);
    const alpha = new Float32Array(MAX);
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('aAlpha', new T.BufferAttribute(alpha, 1));
    geo.setDrawRange(0, 0);

    const mat = new T.PointsMaterial({
      color: 0xffffff, size: 0.09, sizeAttenuation: true,
      transparent: true, opacity: 0.9, depthWrite: false,
    });
    const points = new T.Points(geo, mat);
    points.frustumCulled = false;
    group.add(points);

    this._state = { group, points, geo, pos, count: 0, emitters: [] };
    return group;
  },

  /** emitImpact(pos, dir, power, kind) */
  emitImpact(pos, dir, power = 1, kind = 'hit') {
    const S = this._state;
    if (!S) return;
    const n = Math.min(48, Math.round(12 + power * 18));
    const d = Array.isArray(dir) ? dir : [dir.x, dir.y, dir.z];
    const p = Array.isArray(pos) ? pos : [pos.x, pos.y, pos.z];
    for (let i = 0; i < n && S.count < MAX; i++) {
      // deterministic fan — no RNG, no time
      const a = (i / n) * Math.PI * 2;
      const r = 0.15 + (i % 5) * 0.09 * power;
      S.pos[S.count * 3 + 0] = p[0] + Math.cos(a) * r + d[0] * 0.2;
      S.pos[S.count * 3 + 1] = p[1] + Math.sin(a * 1.7) * r * 0.6 + 0.1;
      S.pos[S.count * 3 + 2] = p[2] + Math.sin(a) * r + d[2] * 0.2;
      S.count++;
    }
    S.geo.attributes.position.needsUpdate = true;
    S.geo.setDrawRange(0, S.count);
    void kind;
  },

  /** ball(ctx) -> { mesh, setFlame(0..1), setSpin(rps) } */
  ball(ctx) {
    const T = ctx.THREE;
    const geo = new T.SphereGeometry(0.145, 16, 12);
    geo.scale(1.0, 1.0, 1.72);
    const mat = new T.MeshStandardMaterial({ color: 0x6b4326, roughness: 0.75, metalness: 0.0 });
    const mesh = new T.Mesh(geo, mat);
    mesh.name = 'ball.fallback';
    mesh.castShadow = true;
    let spin = 0;
    return {
      mesh,
      setFlame(v) { mat.emissive = new T.Color(0x000000).lerp(new T.Color(0xff5a1e), Math.max(0, Math.min(1, v)) * 0.6); },
      setSpin(rps) { spin = rps; },
      update(t) { if (spin) mesh.rotation.z = t * spin * Math.PI * 2; },
    };
  },

  reset() {
    const S = this._state;
    if (!S) return;
    S.count = 0;
    S.geo.setDrawRange(0, 0);
  },

  update() { },
};

export default impl;
