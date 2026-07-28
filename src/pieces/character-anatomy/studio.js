// PIECE: character-anatomy — the isolation studio.
//
// The iso scenes exist so a critic can score THIS piece's contribution — silhouette,
// proportion, pad bulk, helmet form — without a neighbour's turf or sky masking it. So
// the studio owns its own value structure: a dark graded cyclorama, a warm key from
// camera-left, TWO hard rims (cool from behind-right, warm from behind-left) that draw
// the shoulder shelf and helmet crown as bright edges exactly the way every action panel
// in bar/ does, and a floor that carries a real contact shadow and a specular pool.
//
// It only ever installs itself for scenes this piece registered (`shot.piece ===
// 'character-anatomy'`), and it only ever touches the live scene graph — no foundation
// file is edited, nothing outside this directory is written.

import texlab from '../../foundation/texlab.js';

const BACKDROP = 'ca.studio';

function gradientTexture(THREE, silhouette) {
  const { cv, ctx } = texlab.canvas(64, 512);
  if (silhouette) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 64, 512);
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0.00, '#05070c');
    g.addColorStop(0.34, '#080b12');
    g.addColorStop(0.58, '#12161f');
    g.addColorStop(0.72, '#1a2029');
    g.addColorStop(0.86, '#0d1017');
    g.addColorStop(1.00, '#05070a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 512);
    // vertical banding so the cyc is not a mathematically clean ramp
    for (let y = 0; y < 512; y++) {
      const n = texlab.noise2(0.5, y * 0.06, 91) * 3.0;
      ctx.fillStyle = `rgba(255,255,255,${Math.max(0, n) * 0.010})`;
      ctx.fillRect(0, y, 64, 1);
    }
  }
  return texlab.toTexture({ cv, ctx }, { srgb: true, wrap: THREE.ClampToEdgeWrapping });
}

function floorTexture(THREE, silhouette) {
  const N = 256;
  const { cv, ctx } = texlab.canvas(N, N);
  if (silhouette) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, N, N);
    return texlab.toTexture({ cv, ctx }, { srgb: true, wrap: THREE.ClampToEdgeWrapping });
  }
  ctx.fillStyle = '#04050a';
  ctx.fillRect(0, 0, N, N);
  const g = ctx.createRadialGradient(N * 0.5, N * 0.5, N * 0.02, N * 0.5, N * 0.5, N * 0.46);
  g.addColorStop(0, 'rgba(96,110,138,0.55)');
  g.addColorStop(0.35, 'rgba(46,55,74,0.30)');
  g.addColorStop(1, 'rgba(4,5,10,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, N, N);
  // fine tooth so the floor is not a clean gradient under a 32-sample accumulation
  const img = ctx.getImageData(0, 0, N, N);
  const d = img.data;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4;
      const n = texlab.fbm2(x * 0.09, y * 0.09, { octaves: 3, seed: 17 }) * 10;
      d[i] = Math.max(0, Math.min(255, d[i] + n));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n * 1.2));
    }
  }
  ctx.putImageData(img, 0, 0);
  return texlab.toTexture({ cv, ctx }, { srgb: true, wrap: THREE.ClampToEdgeWrapping });
}

function glowTexture(THREE) {
  const N = 256;
  const { cv, ctx } = texlab.canvas(N, N);
  ctx.clearRect(0, 0, N, N);
  const g = ctx.createRadialGradient(N * 0.5, N * 0.52, 2, N * 0.5, N * 0.52, N * 0.5);
  g.addColorStop(0.00, 'rgba(150,178,224,0.85)');
  g.addColorStop(0.22, 'rgba(96,120,166,0.42)');
  g.addColorStop(0.55, 'rgba(48,62,94,0.13)');
  g.addColorStop(1.00, 'rgba(20,26,42,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, N, N);
  const t = texlab.toTexture({ cv, ctx }, { srgb: true, wrap: THREE.ClampToEdgeWrapping });
  return t;
}

/**
 * install(ctx, opts) -> studio handle. Idempotent per shot.
 * opts: { silhouette, camAz, exposure, keyBoost, scale, fog }
 *
 * `scale` exists for ONE reason: the LOD/imposter comparison shot has to be taken at the
 * distance the LOD is actually used at (~22 m), and a studio rigged for a 4 m subject
 * does not reach — the spots fall off, the shadow camera misses, and the exponential fog
 * eats 73% of the figure. Rather than judge an imposter under lighting that never
 * touches it, the whole rig scales: positions and ranges by `scale`, punctual intensity
 * by `scale^2` (inverse-square, so the subject receives the same illuminance), fog by
 * `fog`. Nothing about the close shots changes — they pass scale 1.
 */
export function installStudio(ctx, opts) {
  const THREE = ctx.THREE;
  const scene = ctx.scene;
  let g = scene.getObjectByName(BACKDROP);
  if (g) return g.userData.studio;

  g = new THREE.Group();
  g.name = BACKDROP;
  g.userData.piece = 'character-anatomy';
  const sil = !!opts.silhouette;
  const az = opts.camAz !== undefined ? opts.camAz : 0.5;
  const SC = opts.scale !== undefined && opts.scale > 0 ? opts.scale : 1;
  const SC2 = SC * SC;

  /* ---- cyclorama ------------------------------------------------------- */
  const cycGeo = new THREE.CylinderGeometry(16 * SC, 16 * SC, 26 * SC, 48, 1, true);
  const cycMat = new THREE.MeshBasicMaterial({
    map: gradientTexture(THREE, sil),
    side: THREE.BackSide,
    toneMapped: !sil,
    fog: false,
  });
  if (sil) cycMat.color.setRGB(7, 7, 7);
  const cyc = new THREE.Mesh(cycGeo, cycMat);
  cyc.position.y = 8 * SC;
  cyc.userData.wantShadow = false;
  g.add(cyc);

  /* ---- floor ----------------------------------------------------------- */
  const floorGeo = new THREE.PlaneGeometry(34 * SC, 34 * SC, 1, 1);
  floorGeo.rotateX(-Math.PI / 2);
  const floorMat = sil
    ? new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: false })
    : new THREE.MeshStandardMaterial({
      map: floorTexture(THREE, false),
      color: 0x3b4353,
      roughness: 0.34,
      metalness: 0.14,
      envMapIntensity: 0.5,
    });
  if (sil) floorMat.color.setRGB(7, 7, 7);
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.receiveShadow = !sil;
  floor.position.y = 0;
  g.add(floor);

  /* ---- separation glow behind the subject ------------------------------ */
  if (!sil) {
    const glowGeo = new THREE.PlaneGeometry(8.5 * SC, 6.2 * SC, 1, 1);
    const glowMat = new THREE.MeshBasicMaterial({
      map: glowTexture(THREE),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: true,
      fog: false,
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.position.set(-Math.sin(az) * 5.4 * SC, 1.9 * SC, -Math.cos(az) * 5.4 * SC);
    glow.rotation.y = az;
    glow.userData.wantShadow = false;
    g.add(glow);
  }

  /* ---- lights ---------------------------------------------------------- */
  const lights = [];
  if (!sil) {
    const boost = opts.keyBoost || 1;
    // camera basis on the ground plane
    const cx = Math.sin(az), cz = Math.cos(az);
    const lx = -cz, lz = cx;           // camera-left

    const key = new THREE.DirectionalLight(0xfff2e4, 2.95 * boost);
    key.position.set((lx * 3.9 + cx * 3.8) * SC, 5.0 * SC, (lz * 3.9 + cz * 3.8) * SC);
    key.target.position.set(0, 1.0, 0);
    key.castShadow = true;
    const S = (ctx.profile && ctx.profile.shadowSize) || 2048;
    key.shadow.mapSize.set(S, S);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 24 * SC;
    key.shadow.camera.left = -3.2 * SC;
    key.shadow.camera.right = 3.2 * SC;
    key.shadow.camera.top = 3.6 * SC;
    key.shadow.camera.bottom = -1.2 * SC;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.014;
    g.add(key, key.target);
    lights.push(key);

    // the two rims that draw the silhouette — this is the bar's lighting language
    const rimA = new THREE.SpotLight(0xd6e6ff, 330 * boost * SC2, 9.5 * SC, 0.34, 0.45, 1.30);
    rimA.position.set((-lx * 2.4 - cx * 3.4) * SC, 5.6 * SC, (-lz * 2.4 - cz * 3.4) * SC);
    rimA.target.position.set(0, 1.25, 0);
    g.add(rimA, rimA.target);
    lights.push(rimA);

    const rimB = new THREE.SpotLight(0xffb070, 300 * boost * SC2, 9.0 * SC, 0.32, 0.48, 1.30);
    rimB.position.set((lx * 2.0 - cx * 3.6) * SC, 5.2 * SC, (lz * 2.0 - cz * 3.6) * SC);
    rimB.target.position.set(0, 1.20, 0);
    g.add(rimB, rimB.target);
    lights.push(rimB);

    // a low warm bounce off the floor so the underside of the pads is not dead black
    const bounce = new THREE.PointLight(0xffb27e, 0.8 * boost * SC2, 3.0 * SC, 2.0);
    bounce.position.set(cx * 0.55 * SC, 0.20 * SC, cz * 0.55 * SC);
    g.add(bounce);
    lights.push(bounce);

    // soft frontal book light — just enough that the near side of the jersey holds
    // detail instead of going to mud. Kept dim: the rims still draw the silhouette.
    const book = new THREE.DirectionalLight(0xbcd0f0, 0.55 * boost);
    book.position.set((cx * 5.0 - lx * 1.2) * SC, 2.0 * SC, (cz * 5.0 - lz * 1.2) * SC);
    book.target.position.set(0, 1.1, 0);
    g.add(book, book.target);
    lights.push(book);

    const fill = new THREE.HemisphereLight(0x3a4a6e, 0x171310, 0.40);
    g.add(fill);
    lights.push(fill);
  }

  // Aerial perspective. The floor is fogged toward the cyclorama's horizon value, which
  // is what dissolves the floor/backdrop seam into a cove instead of a table edge, and
  // it costs the figure a deliberate ~6% wash at 4 m that reads as studio haze.
  if (!sil) scene.fog = new THREE.FogExp2(0x141922, opts.fog !== undefined ? opts.fog : 0.052);
  else scene.fog = null;

  g.userData.studio = {
    group: g,
    silhouette: sil,
    exposure: opts.exposure !== undefined ? opts.exposure : 1.0,
    lights,
  };
  scene.add(g);
  return g.userData.studio;
}

/**
 * Every frame: keep the studio authoritative over the fallback stadium / turf / lights.
 * Runs on the CAPTURE path only (iso scenes are capture scenes), so it is outside the
 * frame budget — but it still allocates nothing.
 */
export function enforceStudio(ctx, studio) {
  const scene = ctx.scene;
  scene.environment = null;
  if (studio.silhouette) scene.background = null;
  const kids = scene.children;
  for (let i = 0; i < kids.length; i++) sweep(kids[i], studio);
  ctx.renderer.toneMappingExposure = studio.exposure;
}

function sweep(o, studio) {
  if (o.name === BACKDROP) return;
  if (o.isLight) { o.intensity = 0; return; }
  const p = o.userData && o.userData.piece;
  if (p === 'turf-field' || p === 'stadium-env' || p === 'stadium-lighting' || p === 'impact-fx') {
    o.visible = false;
    return;
  }
  if (o.name === 'turf.fallback' || o.name === 'stadium.fallback') { o.visible = false; return; }
  const kids = o.children;
  for (let i = 0; i < kids.length; i++) sweep(kids[i], studio);
}

export default { installStudio, enforceStudio };
