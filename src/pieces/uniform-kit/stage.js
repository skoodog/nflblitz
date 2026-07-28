// PIECE uniform-kit — the LOCKER STAGE.
//
// The bar's PICK YOUR UNIFORM panel is not a gameplay frame: it is a studio portrait.
// Near-black surround, one figure held by a hard club-coloured rim from behind, a warm
// key raking the near shoulder, and a pool of club colour on a dark floor. The stadium
// bowl and the turf that the world assembler builds for every scene are exactly wrong
// for it — a green field under the model destroys the value structure the panel lives on.
//
// So on the scenes THIS PIECE OWNS (and on the `uniform` menu screen), the stage takes
// over the 3D layer: it hides the turf and the bowl, installs its own cyclorama, floor
// and five-light rig, and re-asserts them every frame through a CHAINED
// `scene.onBeforeRender` (chained, never clobbered, so a neighbouring piece that wants
// the same hook still runs). It touches the live scene graph only. It never edits, and
// never needs, a file outside this directory.

import texlab from '../../foundation/texlab.js';
import { hexToRgb, shade, mixHex, luma } from './palette.js';
import { stanceScene } from './stance.js';

const NAME = 'uk.stage';

function grad(THREE, stops, w, h, vertical) {
  const cv = texlab.canvas(w, h);
  const c = cv.ctx;
  const g = vertical ? c.createLinearGradient(0, 0, 0, h) : c.createLinearGradient(0, 0, w, 0);
  for (const s of stops) g.addColorStop(s[0], s[1]);
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  // fine vertical tooth so a 32-sample accumulation never resolves a clean mathematical ramp
  for (let y = 0; y < h; y++) {
    const n = Math.max(0, texlab.fbm2(0.5, y * 0.055, { octaves: 3, seed: 17 }));
    c.fillStyle = `rgba(255,255,255,${(n * 0.014).toFixed(4)})`;
    c.fillRect(0, y, w, 1);
  }
  return texlab.toTexture(cv, { srgb: true, wrap: THREE.ClampToEdgeWrapping });
}

function floorTex(THREE, accent) {
  const N = 512;
  const cv = texlab.canvas(N, N);
  const c = cv.ctx;
  c.fillStyle = '#04050a';
  c.fillRect(0, 0, N, N);
  // brushed concentric sweep — the sheen of a polished studio deck
  for (let i = 0; i < 260; i++) {
    const r = (i / 260) * N * 0.62;
    const a = 0.010 + texlab.noise2(i * 0.31, 3.1, 7) * 0.012;
    c.strokeStyle = `rgba(150,170,205,${Math.max(0, a).toFixed(4)})`;
    c.lineWidth = 0.8 + texlab.noise2(i * 0.11, 9.4, 3) * 1.6;
    c.beginPath(); c.arc(N * 0.5, N * 0.5, r, 0, Math.PI * 2); c.stroke();
  }
  const cc = hexToRgb(accent);
  const rgba = (a) => `rgba(${Math.round(cc[0] * 255)},${Math.round(cc[1] * 255)},${Math.round(cc[2] * 255)},${a})`;
  const g = c.createRadialGradient(N * 0.5, N * 0.5, N * 0.03, N * 0.5, N * 0.5, N * 0.44);
  g.addColorStop(0.00, rgba(0.42));
  g.addColorStop(0.28, rgba(0.15));
  g.addColorStop(0.62, rgba(0.05));
  g.addColorStop(1.00, rgba(0));
  c.fillStyle = g;
  c.fillRect(0, 0, N, N);
  const b = c.createRadialGradient(N * 0.5, N * 0.5, N * 0.02, N * 0.5, N * 0.5, N * 0.22);
  b.addColorStop(0, 'rgba(170,188,220,0.18)');
  b.addColorStop(1, 'rgba(180,196,224,0)');
  c.fillStyle = b;
  c.fillRect(0, 0, N, N);
  return texlab.toTexture(cv, { srgb: true, wrap: THREE.ClampToEdgeWrapping });
}

/** The club-coloured pool the model stands in. */
function poolTex(THREE, accent) {
  const N = 256;
  const cv = texlab.canvas(N, N);
  const c = cv.ctx;
  c.clearRect(0, 0, N, N);
  const cc = hexToRgb(accent);
  const rgba = (a) => `rgba(${Math.round(cc[0] * 255)},${Math.round(cc[1] * 255)},${Math.round(cc[2] * 255)},${a})`;
  const g = c.createRadialGradient(N * 0.5, N * 0.5, 2, N * 0.5, N * 0.5, N * 0.5);
  g.addColorStop(0.00, rgba(0.60));
  g.addColorStop(0.22, rgba(0.30));
  g.addColorStop(0.52, rgba(0.085));
  g.addColorStop(1.00, rgba(0));
  c.fillStyle = g;
  c.fillRect(0, 0, N, N);
  // a hot core right under the boots
  const h = c.createRadialGradient(N * 0.5, N * 0.5, 1, N * 0.5, N * 0.5, N * 0.16);
  h.addColorStop(0, 'rgba(255,224,190,0.30)');
  h.addColorStop(1, 'rgba(255,224,190,0)');
  c.fillStyle = h;
  c.fillRect(0, 0, N, N);
  // break the perfect circle so it never reads as a decal
  for (let i = 0; i < 90; i++) {
    const a = (i / 90) * Math.PI * 2;
    const r = N * (0.30 + texlab.noise2(Math.cos(a) * 2.1, Math.sin(a) * 2.1, 31) * 0.16);
    c.globalAlpha = 0.05;
    c.fillStyle = rgba(0.5);
    c.beginPath();
    c.arc(N * 0.5 + Math.cos(a) * r, N * 0.5 + Math.sin(a) * r, N * 0.045, 0, Math.PI * 2);
    c.fill();
  }
  c.globalAlpha = 1;
  return texlab.toTexture(cv, { srgb: true, wrap: THREE.ClampToEdgeWrapping });
}

function haloTex(THREE, accent) {
  const N = 256;
  const cv = texlab.canvas(N, N);
  const c = cv.ctx;
  c.clearRect(0, 0, N, N);
  const cc = hexToRgb(accent);
  const rgba = (a) => `rgba(${Math.round(cc[0] * 255)},${Math.round(cc[1] * 255)},${Math.round(cc[2] * 255)},${a})`;
  const g = c.createRadialGradient(N * 0.5, N * 0.56, 1, N * 0.5, N * 0.56, N * 0.5);
  g.addColorStop(0.00, 'rgba(255,246,232,0.34)');
  g.addColorStop(0.13, rgba(0.26));
  g.addColorStop(0.34, rgba(0.075));
  g.addColorStop(0.62, rgba(0.012));
  g.addColorStop(1.00, rgba(0));
  c.fillStyle = g;
  c.fillRect(0, 0, N, N);
  return texlab.toTexture(cv, { srgb: true, wrap: THREE.ClampToEdgeWrapping });
}

/**
 * The locker's own IBL, baked at load from an equirect painted in this file and run
 * through PMREM. Without it, `clearcoat`, `metalness` and the visor have nothing to
 * reflect, and a candy-coat helmet resolves to a flat dark shape — the single biggest
 * tell that a game's hard surfaces are fake. Two sources (a warm key blob and a
 * club-coloured rim blob) plus a floor bounce is all a studio needs.
 */
let ENV = null;
function buildEnv(ctx, accent, shell) {
  if (ENV) return ENV;
  const THREE = ctx.THREE;
  if (!ctx.renderer || !THREE.PMREMGenerator) return null;
  try {
    const W = 256, H = 128;
    const cv = texlab.canvas(W, H);
    const c = cv.ctx;
    const sky = mixHex(shell, '#04060c', 0.55);
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0.00, shade(sky, 0.16));
    g.addColorStop(0.44, sky);
    g.addColorStop(0.52, '#080a10');
    g.addColorStop(1.00, '#0d0f14');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    const blob = (x, y, r, col, a) => {
      const rg = c.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, col);
      rg.addColorStop(0.35, hexA(col, a * 0.45));
      rg.addColorStop(1, hexA(col, 0));
      c.fillStyle = rg;
      c.fillRect(x - r, y - r, r * 2, r * 2);
    };
    blob(W * 0.20, H * 0.24, 44, '#fff3e0', 0.9);       // key
    blob(W * 0.78, H * 0.30, 40, accent, 0.85);          // club rim
    blob(W * 0.52, H * 0.18, 22, '#cfe0ff', 0.6);        // steel rim
    blob(W * 0.42, H * 0.86, 60, mixHex(accent, '#0a0c12', 0.55), 0.6);   // floor bounce
    const tex = texlab.toTexture(cv, { srgb: true, wrap: THREE.ClampToEdgeWrapping });
    tex.mapping = THREE.EquirectangularReflectionMapping;
    const pm = new THREE.PMREMGenerator(ctx.renderer);
    pm.compileEquirectangularShader();
    ENV = pm.fromEquirectangular(tex).texture;
    pm.dispose();
    tex.dispose();
  } catch (e) {
    console.error('[uniform-kit] env bake failed', e);
    ENV = null;
  }
  return ENV;
}

function hexA(h, a) {
  const c = hexToRgb(h);
  return `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;
}

/**
 * install(ctx, opts) -> handle. Idempotent per scene build.
 * opts: { accent, shell, camAz, exposure, floorGlow }
 */
export function installStage(ctx, opts = {}) {
  const THREE = ctx.THREE;
  const scene = ctx.scene;
  const existing = scene.getObjectByName(NAME);
  if (existing) return existing.userData.stage;

  const accent = opts.accent || '#e64100';
  const shell = opts.shell || '#0b162a';
  const az = opts.camAz !== undefined ? opts.camAz : 0.0;
  const cx = Math.sin(az), cz = Math.cos(az);       // toward camera on the ground plane
  const lx = -cz, lz = cx;                          // camera-left

  const g = new THREE.Group();
  g.name = NAME;
  g.userData.piece = 'uniform-kit';

  /* ---- cyclorama: a cold near-black cove with a faint club wash ---------- */
  const deep = shade(mixHex(shell, '#04050a', 0.72), -0.40);
  const cyc = new THREE.Mesh(
    new THREE.CylinderGeometry(19, 19, 30, 56, 1, true),
    new THREE.MeshBasicMaterial({
      map: grad(THREE, [
        [0.00, '#010204'],
        [0.34, '#020306'],
        [0.56, deep],
        [0.66, shade(deep, 0.10)],
        [0.80, '#04060b'],
        [1.00, '#010204'],
      ], 32, 512, true),
      side: THREE.BackSide, toneMapped: true, fog: false,
    })
  );
  cyc.position.y = 9;
  g.add(cyc);

  /* ---- floor ------------------------------------------------------------ */
  const floorGeo = new THREE.PlaneGeometry(30, 30, 1, 1);
  floorGeo.rotateX(-Math.PI / 2);
  const floor = new THREE.Mesh(floorGeo, new THREE.MeshStandardMaterial({
    map: floorTex(THREE, accent),
    color: 0x2b3140,
    roughness: 0.22,
    metalness: 0.30,
    envMapIntensity: 0.7,
  }));
  floor.receiveShadow = true;
  g.add(floor);

  /* ---- separation halo behind the figure -------------------------------- */
  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(1.85, 2.15, 1, 1),
    new THREE.MeshBasicMaterial({
      map: haloTex(THREE, accent), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: true, fog: false,
    })
  );
  halo.position.set(-cx * 1.9, 1.24, -cz * 1.9);
  halo.rotation.y = az;
  g.add(halo);

  /* ---- floor pool -------------------------------------------------------- */
  // The bar puts a hot pool of club colour on the deck directly under the cleats. A
  // reflective floor alone will not produce it in a near-black studio — there is nothing
  // bright enough to reflect — so it is an additive disc, one draw call, sitting a
  // centimetre proud of the floor.
  const pool = new THREE.Mesh(
    new THREE.CircleGeometry(1.45, 48),
    new THREE.MeshBasicMaterial({
      map: poolTex(THREE, accent), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: true, fog: false,
    })
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.012;
  g.add(pool);

  /* ---- lights ----------------------------------------------------------- */
  const lights = [];
  const S = (ctx.profile && ctx.profile.shadowSize) || 2048;

  // KEY — warm, high, from camera-left. It draws the near shoulder and the number.
  const key = new THREE.DirectionalLight(0xffeeda, 1.72);
  key.position.set(lx * 4.2 + cx * 3.4, 5.6, lz * 4.2 + cz * 3.4);
  key.target.position.set(0, 1.05, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(S, S);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 22;
  key.shadow.camera.left = -2.6;
  key.shadow.camera.right = 2.6;
  key.shadow.camera.top = 3.2;
  key.shadow.camera.bottom = -1.0;
  key.shadow.bias = -0.00035;
  key.shadow.normalBias = 0.013;
  key.shadow.radius = 2.2;
  g.add(key, key.target);
  lights.push(key);

  // RIM A — the club's own colour, hard, from behind-left. This is the bar's signature:
  // the whole outline of the figure is drawn in the team's accent.
  const ac = new THREE.Color().setStyle(accent);
  const rimA = new THREE.SpotLight(ac.getHex(), 300, 9.5, 0.32, 0.62, 1.35);
  rimA.position.set(-lx * 2.5 - cx * 2.9, 3.05, -lz * 2.5 - cz * 2.9);
  rimA.target.position.set(0, 1.20, 0);
  g.add(rimA, rimA.target);
  lights.push(rimA);

  // RIM B — cool steel from behind-right, so the two edges are not the same colour.
  const rimB = new THREE.SpotLight(0xc6dcff, 230, 9.5, 0.30, 0.62, 1.35);
  rimB.position.set(lx * 2.8 - cx * 3.0, 3.25, lz * 2.8 - cz * 3.0);
  rimB.target.position.set(0, 1.32, 0);
  g.add(rimB, rimB.target);
  lights.push(rimB);

  // BOOK — a dim frontal fill so the jersey blocking and the twill number hold detail
  // instead of collapsing into a black shape. Deliberately weak; the rims still draw.
  const book = new THREE.DirectionalLight(0xa8bfe0, 0.92);
  book.position.set(cx * 6.0 - lx * 1.6, 2.3, cz * 6.0 - lz * 1.6);
  book.target.position.set(0, 1.15, 0);
  g.add(book, book.target);
  lights.push(book);

  // BOUNCE — club colour off the floor, up into the underside of the pads and helmet.
  const bounce = new THREE.PointLight(ac.getHex(), 0.85, 2.6, 2.0);
  bounce.position.set(cx * 0.8, 0.52, cz * 0.8);
  g.add(bounce);
  lights.push(bounce);

  // HAIR — a tight hot spot on the helmet crown. A candy-coat clearcoat is defined by its
  // specular hotspot; without a small hard source aimed at the shell the helmet resolves
  // to a black blob no matter how low its roughness is.
  const hair = new THREE.SpotLight(0xfff6e8, 130, 5.2, 0.22, 0.68, 1.6);
  hair.position.set(lx * 1.1 + cx * 1.4, 3.5, lz * 1.1 + cz * 1.4);
  hair.target.position.set(0, 1.70, 0);
  g.add(hair, hair.target);
  lights.push(hair);

  const amb = new THREE.HemisphereLight(0x30405f, 0x140f0b, 0.42);
  g.add(amb);
  lights.push(amb);

  scene.add(g);

  const stage = {
    group: g,
    lights,
    env: buildEnv(ctx, accent, shell),
    exposure: opts.exposure !== undefined ? opts.exposure : 1.0,
    fog: new THREE.FogExp2(0x080b12, 0.055),
  };
  g.userData.stage = stage;

  // ---- chained per-frame enforcement -------------------------------------
  // CHAINED, not clobbered: whatever was on scene.onBeforeRender still runs.
  const prev = scene.onBeforeRender;
  let stanced = !opts.stance;
  scene.onBeforeRender = function stageEnforce(renderer, sc, camera) {
    enforce(ctx, stage);
    if (!stanced) { stanced = stanceScene(THREE, sc) > 0; }
    if (typeof prev === 'function') prev.call(this, renderer, sc, camera);
  };
  enforce(ctx, stage);
  return stage;
}

/**
 * Keep the stage authoritative over whatever the world assembler built. Zero allocation:
 * this can run on the runtime path when the uniform screen is up.
 */
export function enforce(ctx, stage) {
  const scene = ctx.scene;
  scene.fog = stage.fog;
  scene.background = null;
  if (stage.env) scene.environment = stage.env;
  const kids = scene.children;
  for (let i = 0; i < kids.length; i++) sweep(kids[i], stage);
  if (ctx.renderer) {
    ctx.renderer.toneMappingExposure = stage.exposure;
    ctx.renderer.shadowMap.enabled = true;
  }
}

function sweep(o, stage) {
  if (!o || o === stage.group) return;
  const p = o.userData && o.userData.piece;
  if (p === 'turf-field' || p === 'stadium-env') { o.visible = false; return; }
  if (o.isLight && !isMine(o, stage)) { o.intensity = 0; return; }
  const kids = o.children;
  for (let i = 0; i < kids.length; i++) sweep(kids[i], stage);
}

function isMine(light, stage) {
  let n = light;
  while (n) { if (n === stage.group) return true; n = n.parent; }
  return false;
}

export default { installStage, enforce };
