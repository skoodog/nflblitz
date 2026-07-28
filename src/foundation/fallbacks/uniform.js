// FOUNDATION FALLBACK — replaced by piece `uniform-kit`, which calls BOTH
//   registerWorld('uniform', impl)   and   registerUI('uniformScreen', impl.screen)
// Deliberately plain: flat untextured grey MeshStandardMaterials for every slot.
// No team colour, no numbers, no cloth weave, no dirt, no wetness.

import * as THREE from 'three';
import { MAT_SLOTS } from '../contracts.js';
import fbUI from './ui.js';

const GREY = {
  skin: 0x9a8f86,
  undershirt: 0x6f6f74,
  jersey: 0x8e8e93,
  pants: 0x9b9ba0,
  sock: 0x7c7c82,
  cleat: 0x55555a,
  glove: 0x6a6a70,
  helmetShell: 0xa2a2a8,
  facemask: 0x4a4a50,
  visor: 0x30343a,
  pad: 0x86868c,
  towel: 0xb0b0b4,
};

const cache = new Map();

const impl = {
  piece: 'foundation-fallback',

  /** materials(ctx, teamId, variant, {number, name, dirt, wet}) -> matSet */
  materials(ctx, teamId, variant, opts = {}) {
    const key = `${teamId}|${variant}`;
    if (cache.has(key)) return cache.get(key);
    const set = {};
    for (const slot of MAT_SLOTS) {
      const m = new THREE.MeshStandardMaterial({
        color: GREY[slot],
        roughness: slot === 'visor' ? 0.15 : slot === 'helmetShell' ? 0.4 : 0.85,
        metalness: 0.0,
        transparent: slot === 'visor',
        opacity: slot === 'visor' ? 0.75 : 1,
      });
      m.name = `fallback.${slot}`;
      set[slot] = m;
    }
    cache.set(key, set);
    return set;
  },

  /** The uniform menu screen. Same object the piece will register into REG.ui. */
  screen: fbUI.uniformScreen,
};

export default impl;
