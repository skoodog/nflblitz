// FOUNDATION FALLBACK — replaced by piece `stadium-lighting` via registerWorld('lighting', ...).
// Deliberately plain: one white directional key + a flat hemisphere fill. No rim
// lights, no volumetric shafts, no lightning, no IBL.

import * as THREE from 'three';

const impl = {
  piece: 'foundation-fallback',
  build(ctx) {
    const T = ctx.THREE;
    const group = new T.Group();
    group.name = 'lighting.fallback';

    const key = new T.DirectionalLight(0xffffff, 2.4);
    key.position.set(28, 46, 26);
    key.target.position.set(0, 0, 0);
    key.castShadow = true;
    const S = ctx.profile ? ctx.profile.shadowSize : 2048;
    key.shadow.mapSize.set(S, S);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 160;
    key.shadow.camera.left = -40;
    key.shadow.camera.right = 40;
    key.shadow.camera.top = 40;
    key.shadow.camera.bottom = -40;
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.03;
    group.add(key);
    group.add(key.target);

    const hemi = new T.HemisphereLight(0x2a3550, 0x14180f, 0.9);
    group.add(hemi);

    const amb = new T.AmbientLight(0xffffff, 0.12);
    group.add(amb);

    return {
      group,
      key,
      env: null,
      exposure: 1.0,
      applyToRenderer(renderer) {
        renderer.toneMapping = T.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.0;
      },
    };
  },
  update() { },
};

export default impl;
