// FOUNDATION — PERFCORE. The structural budget counter — the ONLY gate on the GPU axis.
//
// This box cannot measure GPU cost. Measured here: a shadowed MeshStandardMaterial
// scene costs roughly 100 ms per megapixel under SwiftShader. No number this machine
// produces about fill rate is a phone number. So the GPU axis is not measured, it is
// GOVERNED — with hard per-tier caps that are COUNTED.
//
// Every scene object must carry `userData.piece = '<piece-id>'` (inherited from any
// ancestor). Then every draw call and every triangle is attributed to a piece BY NAME,
// and a piece that quietly adds 400 draw calls fails a command instead of a vibe.
//
// Counted, never estimated:
//   draw calls (incl. shadow casters), triangles, shader programs, texture bytes
//   resident, render targets, live particles, skinned actors, and — via a real
//   additive GL pass, not a guess — average overdraw.

import { TIERS, RUNGS, tierOfRung } from './quality.js';

/* ------------------------------------------------------------- attribution */

export function pieceOf(obj) {
  let o = obj;
  while (o) {
    if (o.userData && o.userData.piece) return o.userData.piece;
    o = o.parent;
  }
  return 'unattributed';
}

/** Tag a subtree. Every piece calls this on whatever it returns from build(). */
export function tagPiece(obj, pieceId) {
  if (!obj) return obj;
  obj.userData = obj.userData || {};
  obj.userData.piece = pieceId;
  return obj;
}

/* ------------------------------------------------------------ texture bytes */

const TYPE_BYTES = { 1009: 1, 1010: 1, 1011: 2, 1012: 2, 1013: 4, 1014: 4, 1015: 4, 1016: 2, 1017: 4, 1020: 2, 1021: 4 };
const FORMAT_CH = { 1023: 4, 1022: 3, 1028: 1, 1029: 2, 1030: 1, 1031: 2 };

function textureBytes(tex) {
  if (!tex) return 0;
  const img = tex.image || (tex.source && tex.source.data) || null;
  let w = 0, h = 0;
  if (img) {
    w = img.width || (img.videoWidth) || 0;
    h = img.height || (img.videoHeight) || 0;
    if (!w && Array.isArray(img) && img[0]) { w = img[0].width || 0; h = img[0].height || 0; }
  }
  if (!w || !h) return 0;
  const ch = FORMAT_CH[tex.format] !== undefined ? FORMAT_CH[tex.format] : 4;
  const bpc = TYPE_BYTES[tex.type] !== undefined ? TYPE_BYTES[tex.type] : 1;
  let bytes = w * h * ch * bpc;
  if (tex.generateMipmaps !== false) bytes = Math.round(bytes * 4 / 3);
  if (tex.isCubeTexture) bytes *= 6;
  return bytes;
}

/* ----------------------------------------------------------- program keying */

/**
 * A conservative proxy for "one compiled shader program". Two materials that differ in
 * any of these compile to different programs in three.js. Under-counting here would let
 * a piece smuggle in shader-compile stalls, so we deliberately over-count on ambiguity.
 */
function programKey(mat, obj) {
  if (!mat) return 'none';
  const f = [];
  f.push(mat.type || 'Material');
  if (mat.isShaderMaterial || mat.isRawShaderMaterial) {
    f.push('src:' + (mat.uuid.slice(0, 8)));
    if (mat.defines) f.push('def:' + Object.keys(mat.defines).sort().join(','));
  }
  f.push(mat.map ? 'M' : '-');
  f.push(mat.normalMap ? 'N' : '-');
  f.push(mat.roughnessMap ? 'R' : '-');
  f.push(mat.metalnessMap ? 'X' : '-');
  f.push(mat.emissiveMap ? 'E' : '-');
  f.push(mat.aoMap ? 'A' : '-');
  f.push(mat.alphaMap ? 'L' : '-');
  f.push(mat.envMap ? 'V' : '-');
  f.push(mat.displacementMap ? 'D' : '-');
  f.push(mat.vertexColors ? 'C' : '-');
  f.push(mat.transparent ? 'T' : '-');
  f.push(mat.fog ? 'F' : '-');
  f.push('side' + mat.side);
  f.push('bl' + mat.blending);
  if (obj) {
    if (obj.isSkinnedMesh) f.push('SKIN');
    if (obj.isInstancedMesh) f.push('INST');
    if (obj.isPoints) f.push('PTS');
    if (obj.isLine) f.push('LINE');
    if (obj.isSprite) f.push('SPR');
    if (obj.morphTargetInfluences) f.push('MORPH');
  }
  if (mat.onBeforeCompile && mat.onBeforeCompile.length) f.push('OBC');
  return f.join('/');
}

/* ------------------------------------------------------------------- count */

/**
 * countScene(scene, opts) -> a full structural report.
 * opts: { shadowsEnabled, extraRenderTargets, particleCount }
 */
export function countScene(scene, opts) {
  const o = opts || {};
  const shadowsEnabled = !!o.shadowsEnabled;
  const byPiece = Object.create(null);
  const programs = new Set();
  const textures = new Set();
  const geoms = new Set();

  const rep = {
    drawCalls: 0, shadowCasterDraws: 0, triangles: 0, programs: 0,
    textureBytes: 0, renderTargets: o.extraRenderTargets || 0,
    particles: o.particleCount || 0, skinned: 0, instanced: 0, points: 0,
    meshes: 0, unattributed: 0, byPiece,
  };

  function bucket(p) {
    let b = byPiece[p];
    if (!b) {
      b = byPiece[p] = { piece: p, drawCalls: 0, shadowCasterDraws: 0, triangles: 0, textureBytes: 0, programs: new Set(), skinned: 0, particles: 0 };
    }
    return b;
  }

  function addTexturesOf(mat, b) {
    for (const k in mat) {
      const v = mat[k];
      if (v && v.isTexture && !textures.has(v)) {
        textures.add(v);
        const bytes = textureBytes(v);
        rep.textureBytes += bytes;
        b.textureBytes += bytes;
      }
    }
  }

  scene.traverse((obj) => {
    if (!obj.visible) return;
    const isDrawable = obj.isMesh || obj.isPoints || obj.isLine || obj.isSprite;
    if (!isDrawable) return;
    const mats = Array.isArray(obj.material) ? obj.material : (obj.material ? [obj.material] : []);
    if (!mats.length) return;

    const p = pieceOf(obj);
    if (p === 'unattributed') rep.unattributed++;
    const b = bucket(p);

    const inst = obj.isInstancedMesh ? Math.max(1, obj.count) : 1;
    // three.js issues one draw per material group; an InstancedMesh is ONE call.
    const groups = (obj.geometry && obj.geometry.groups && obj.geometry.groups.length) || 1;
    const calls = Math.max(1, Math.min(groups, mats.length));
    rep.drawCalls += calls; b.drawCalls += calls;
    rep.meshes++;

    if (shadowsEnabled && obj.castShadow) { rep.shadowCasterDraws += calls; b.shadowCasterDraws += calls; }

    const g = obj.geometry;
    if (g) {
      if (!geoms.has(g)) geoms.add(g);
      let tris = 0;
      if (obj.isMesh) {
        const idx = g.index;
        const pos = g.attributes && g.attributes.position;
        const verts = idx ? idx.count : (pos ? pos.count : 0);
        tris = Math.floor(verts / 3) * inst;
      } else if (obj.isPoints) {
        const pos = g.attributes && g.attributes.position;
        const range = g.drawRange && g.drawRange.count !== Infinity ? g.drawRange.count : (pos ? pos.count : 0);
        rep.points += range;
        b.particles += range;
      }
      rep.triangles += tris; b.triangles += tris;
    }

    if (obj.isSkinnedMesh) { rep.skinned++; b.skinned++; }
    if (obj.isInstancedMesh) rep.instanced++;

    for (const m of mats) {
      if (!m) continue;
      const key = programKey(m, obj);
      programs.add(key); b.programs.add(key);
      addTexturesOf(m, b);
      if (shadowsEnabled && obj.castShadow) programs.add('DEPTH/' + (obj.isSkinnedMesh ? 'SKIN' : obj.isInstancedMesh ? 'INST' : 'STD') + (m.alphaMap ? '/A' : ''));
    }
  });

  if (!rep.particles) rep.particles = rep.points;
  rep.programs = programs.size;
  rep.programList = Array.from(programs);
  rep.geometries = geoms.size;
  rep.byPiece = Object.keys(byPiece).sort().map((k) => {
    const b = byPiece[k];
    return {
      piece: b.piece, drawCalls: b.drawCalls, shadowCasterDraws: b.shadowCasterDraws,
      triangles: b.triangles, textureMB: b.textureBytes / 1048576, programs: b.programs.size,
      skinned: b.skinned, particles: b.particles,
    };
  });
  rep.textureMB = rep.textureBytes / 1048576;
  return rep;
}

/* ---------------------------------------------------------------- overdraw */

/**
 * Average overdraw, COUNTED. Renders the scene at 1/4 scale with an additive override
 * material writing a known increment per fragment, reads the buffer back, and averages
 * the layer count over covered pixels. Depth test stays ON so occluded-and-rejected
 * fragments are not counted as overdraw they never paid for; depth WRITE is off so
 * every layer that would shade actually registers.
 *
 * Costs one readback. Never called in the frame loop — only by scripts/budget.mjs.
 */
export function measureOverdraw(THREE, renderer, scene, camera, opts) {
  const o = opts || {};
  const scale = o.scale || 0.25;
  const size = renderer.getSize(new THREE.Vector2());
  const w = Math.max(16, Math.round(size.x * scale));
  const h = Math.max(16, Math.round(size.y * scale));
  const STEP = 8;   // 8/255 per layer -> up to 31 layers before saturation

  const rt = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.UnsignedByteType, format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    depthBuffer: true, stencilBuffer: false,
  });
  const override = new THREE.MeshBasicMaterial({
    color: new THREE.Color(STEP / 255, STEP / 255, STEP / 255),
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    depthTest: true, fog: false, toneMapped: false,
  });

  const prevOverride = scene.overrideMaterial;
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevTone = renderer.toneMapping;
  const prevShadow = renderer.shadowMap.enabled;

  scene.overrideMaterial = override;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = false;
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 1);
  renderer.clear(true, true, true);
  renderer.render(scene, camera);

  const buf = new Uint8Array(w * h * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);

  renderer.setRenderTarget(null);
  scene.overrideMaterial = prevOverride;
  renderer.setClearColor(prevClear, prevAlpha);
  renderer.toneMapping = prevTone;
  renderer.shadowMap.enabled = prevShadow;
  rt.dispose(); override.dispose();

  let covered = 0, layers = 0, maxL = 0, saturated = 0;
  for (let i = 0; i < w * h; i++) {
    const v = buf[i * 4];
    if (v === 0) continue;
    covered++;
    const l = v / STEP;
    layers += l;
    if (l > maxL) maxL = l;
    if (v >= 248) saturated++;
  }
  return {
    avg: covered ? layers / covered : 0,
    max: maxL,
    coveragePct: 100 * covered / (w * h),
    saturatedPct: covered ? 100 * saturated / covered : 0,
    w, h,
  };
}

/* ------------------------------------------------------------------ verdict */

/** Check a report against a tier's caps. Returns { pass, rows[] }. */
export function checkTier(rep, tier, overdrawAvg) {
  const T = TIERS[tier];
  const caps = T.caps;
  const rung = RUNGS[T.rungHi];
  const rows = [];
  const row = (metric, value, cap, fmt) => {
    const pass = value <= cap + 1e-9;
    rows.push({ metric, value, cap, pass, fmt: fmt || 'n' });
    return pass;
  };
  let ok = true;
  ok = row('draw calls', rep.drawCalls, caps.drawCalls) && ok;
  ok = row('triangles', rep.triangles, caps.triangles) && ok;
  ok = row('programs', rep.programs, caps.programs) && ok;
  ok = row('texture MB', rep.textureMB, caps.textureMB, 'mb') && ok;
  ok = row('render targets', rep.renderTargets, caps.renderTargets) && ok;
  ok = row('particles', rep.particles, caps.particles) && ok;
  ok = row('shadow casters', rep.shadowCasterDraws, caps.shadowCasters) && ok;
  ok = row('skinned actors', rep.skinned, caps.skinned) && ok;
  if (overdrawAvg !== undefined && overdrawAvg !== null) {
    ok = row('avg overdraw', overdrawAvg, caps.overdraw, 'f2') && ok;
  }
  return { pass: ok, rows, tier, rung: T.rungHi, renderScale: rung.renderScale, dprCap: rung.dprCap };
}

/**
 * Per-piece caps. A piece's share is proportional to its declared weight; the point is
 * not the exact split, it is that `budget.mjs` can name the piece that blew it.
 * Weights sum to 1.0 within each metric family.
 */
export const PIECE_WEIGHTS = Object.freeze({
  'character-anatomy': { calls: 0.30, tris: 0.52, tex: 0.24 },
  'stadium-env': { calls: 0.26, tris: 0.22, tex: 0.22 },
  'turf-field': { calls: 0.06, tris: 0.11, tex: 0.20 },
  'impact-fx': { calls: 0.10, tris: 0.06, tex: 0.07 },
  'stadium-lighting': { calls: 0.06, tris: 0.03, tex: 0.05 },
  'uniform-kit': { calls: 0.02, tris: 0.01, tex: 0.14 },
  'cinematography': { calls: 0.04, tris: 0.01, tex: 0.04 },
  'pose-animation': { calls: 0.02, tris: 0.01, tex: 0.01 },
  'brand-identity': { calls: 0.02, tris: 0.01, tex: 0.02 },
  'play-sim': { calls: 0.02, tris: 0.01, tex: 0.00 },
  'game-flow': { calls: 0.02, tris: 0.00, tex: 0.00 },
  'touch-controller': { calls: 0.04, tris: 0.01, tex: 0.01 },
  'foundation': { calls: 0.04, tris: 0.00, tex: 0.00 },
});

export function pieceCaps(pieceId, tier) {
  const w = PIECE_WEIGHTS[pieceId];
  const caps = TIERS[tier].caps;
  if (!w) return null;
  return {
    drawCalls: Math.round(caps.drawCalls * w.calls),
    triangles: Math.round(caps.triangles * w.tris),
    textureMB: +(caps.textureMB * w.tex).toFixed(1),
  };
}

export default { countScene, measureOverdraw, checkTier, pieceOf, tagPiece, pieceCaps, PIECE_WEIGHTS };
