// FOUNDATION FALLBACK — replaced by piece `stadium-env` via registerWorld('stadium', ...).
// Deliberately plain: an untextured grey bowl and a flat dark backdrop. No crowd,
// no jumbotron, no light towers, no volumetrics.

import * as THREE from 'three';
import { FIELD } from '../contracts.js';

const impl = {
  piece: 'foundation-fallback',
  build(ctx) {
    const { THREE: T } = ctx;
    const g = new T.Group();
    g.name = 'stadium.fallback';

    const grey = new T.MeshStandardMaterial({ color: 0x3a3a3e, roughness: 0.95, metalness: 0.0 });
    const dark = new T.MeshStandardMaterial({ color: 0x17171b, roughness: 1.0, metalness: 0.0, side: T.BackSide });

    // Sloped bowl: four trapezoid walls around the field.
    const inset = 6;
    const halfL = FIELD.length / 2 + inset;
    const halfW = FIELD.width / 2 + inset;
    const rise = 22, depth = 34;

    function stand(cx, cz, w, rotY) {
      const geo = new T.PlaneGeometry(w, Math.hypot(rise, depth), 1, 1);
      const m = new T.Mesh(geo, grey);
      m.position.set(cx, rise / 2, cz);
      m.rotation.y = rotY;
      m.rotation.x = -Math.atan2(depth, rise) + Math.PI / 2;
      m.receiveShadow = true;
      return m;
    }
    g.add(stand(0, halfW + depth / 2, halfL * 2, 0));
    const far = stand(0, -(halfW + depth / 2), halfL * 2, Math.PI);
    g.add(far);
    g.add(stand(halfL + depth / 2, 0, halfW * 2, -Math.PI / 2));
    g.add(stand(-(halfL + depth / 2), 0, halfW * 2, Math.PI / 2));

    // Enclosing shell so the sky is never pure black.
    const shell = new T.Mesh(new T.SphereGeometry(220, 24, 16), dark);
    shell.name = 'stadium.shell';
    g.add(shell);

    this._group = g;
    return g;
  },
  update() { },
};

export default impl;
