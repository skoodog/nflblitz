// PIECE turf-field — the dynamic damage buffer.
//
// One RGBA byte texture over a window of the field:
//   R  torn      — grass destroyed, substrate exposed
//   G  mud       — wet dark smear (skids, drag marks)
//   B  relief    — how much the shader is allowed to break the normal
//   A  wetness   — churned ground holds water
//
// Writes are STAMPS into a typed array plus a dirty rectangle, and the flush uploads
// only that rectangle via copyTextureToTexture. A full re-bake of the field during a
// play is a dropped frame, so there is never one: the paint sheet is baked once at
// load and this buffer is the only thing that changes.
//
// Deterministic: every stamp's irregularity comes from makeRng(seed + stampIndex).

import * as THREE from 'three';
import { makeRng } from '../../foundation/rng.js';

const MAX_SCRATCH = 256;

export function createDamage(w, h, win, seed) {
  const W = w, H = h;
  const data = new Uint8Array(W * H * 4);
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;

  // window: [cx, cz, halfX, halfZ] in metres
  const win4 = new THREE.Vector4(win[0], win[1], win[2], win[3]);

  const scratchData = new Uint8Array(MAX_SCRATCH * MAX_SCRATCH * 4);
  const scratch = new THREE.DataTexture(scratchData, MAX_SCRATCH, MAX_SCRATCH, THREE.RGBAFormat, THREE.UnsignedByteType);
  scratch.colorSpace = THREE.NoColorSpace;
  scratch.minFilter = THREE.NearestFilter;
  scratch.magFilter = THREE.NearestFilter;
  scratch.generateMipmaps = false;

  const box = new THREE.Box2(new THREE.Vector2(0, 0), new THREE.Vector2(1, 1));
  const dst = new THREE.Vector2(0, 0);

  let dirtyMinX = 1e9, dirtyMinY = 1e9, dirtyMaxX = -1e9, dirtyMaxY = -1e9;
  let dirty = false;
  let firstUpload = true;
  let subOk = true;
  let stampIndex = 0;
  let bakes = 0;      // full uploads; asserted to stay at 1 (the load-time one)

  const pxX = W / (win4.z * 2);      // texels per metre
  const pxZ = H / (win4.w * 2);

  function toU(x) { return (x - win4.x) * pxX + W * 0.5; }
  function toV(z) { return (z - win4.y) * pxZ + H * 0.5; }

  function mark(x0, y0, x1, y1) {
    if (x0 < dirtyMinX) dirtyMinX = x0;
    if (y0 < dirtyMinY) dirtyMinY = y0;
    if (x1 > dirtyMaxX) dirtyMaxX = x1;
    if (y1 > dirtyMaxY) dirtyMaxY = y1;
    dirty = true;
  }

  /** max-blend one texel. */
  function put(ix, iy, r, g, b, a) {
    if (ix < 0 || iy < 0 || ix >= W || iy >= H) return;
    const i = (iy * W + ix) * 4;
    const R = r * 255, G = g * 255, B = b * 255, A = a * 255;
    if (R > data[i]) data[i] = R;
    if (G > data[i + 1]) data[i + 1] = G;
    if (B > data[i + 2]) data[i + 2] = B;
    if (A > data[i + 3]) data[i + 3] = A;
  }

  /**
   * Elliptical gouge with a torn fan downrange. This is the shape a planted cleat
   * makes when a 110 kg back changes direction: a deep heel, a long spray.
   */
  function divot(x, z, dx, dz, strength) {
    const s = Math.max(0.05, Math.min(2.2, strength || 1));
    const rng = makeRng(((seed | 0) * 7919 + (stampIndex++) * 131) | 0);
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len, uz = dz / len;
    const R = 0.50 * (0.7 + 0.55 * s);        // metres, across
    const L = R * (1.7 + 1.5 * s);            // metres, downrange
    // lobes make the outline irregular before the shader even breaks it up
    const lobes = 5;
    const lobeR = new Float32Array(lobes);
    for (let i = 0; i < lobes; i++) lobeR[i] = 0.68 + rng() * 0.62;

    const x0 = Math.floor(toU(x - (R + L))), x1 = Math.ceil(toU(x + (R + L)));
    const y0 = Math.floor(toV(z - (R + L))), y1 = Math.ceil(toV(z + (R + L)));
    for (let iy = y0; iy <= y1; iy++) {
      for (let ix = x0; ix <= x1; ix++) {
        const wx = (ix + 0.5 - W * 0.5) / pxX + win4.x - x;
        const wz = (iy + 0.5 - H * 0.5) / pxZ + win4.y - z;
        // rotate into gouge space: +u downrange
        const u = wx * ux + wz * uz;
        const v = -wx * uz + wz * ux;
        const ang = Math.atan2(v, u);
        const li = ((ang + Math.PI) / (2 * Math.PI)) * lobes;
        const l0 = lobeR[Math.floor(li) % lobes];
        const l1 = lobeR[(Math.floor(li) + 1) % lobes];
        const lf = li - Math.floor(li);
        const wob = l0 + (l1 - l0) * (lf * lf * (3 - 2 * lf));
        // an egg: short behind, long in front
        const fwd = u > 0 ? L : R * 0.85;
        const d = Math.sqrt((u / (fwd * wob)) ** 2 + (v / (R * wob)) ** 2);
        if (d > 1.15) continue;
        const core = 1 - Math.min(1, d);
        const torn = Math.pow(core, 0.55) * (0.75 + 0.35 * s);
        const relief = Math.pow(core, 1.4);
        put(ix, iy, Math.min(1, torn), Math.min(1, 0.55 * torn), Math.min(1, relief), Math.min(1, 0.6 * torn));
      }
    }
    mark(x0, y0, x1, y1);
  }

  /** A boot: rounded sole plus studs, which is what actually reads at panel scale. */
  function cleat(x, z, rotY, depth) {
    const d = Math.max(0.1, Math.min(1.5, depth === undefined ? 0.7 : depth));
    const c = Math.cos(rotY || 0), s = Math.sin(rotY || 0);
    const HL = 0.155, HW = 0.058;             // half sole, metres
    const pad = 0.05;
    const x0 = Math.floor(toU(x - (HL + pad))), x1 = Math.ceil(toU(x + (HL + pad)));
    const y0 = Math.floor(toV(z - (HL + pad))), y1 = Math.ceil(toV(z + (HL + pad)));
    for (let iy = y0; iy <= y1; iy++) {
      for (let ix = x0; ix <= x1; ix++) {
        const wx = (ix + 0.5 - W * 0.5) / pxX + win4.x - x;
        const wz = (iy + 0.5 - H * 0.5) / pxZ + win4.y - z;
        const u = wx * c + wz * s;
        const v = -wx * s + wz * c;
        // sole: a capsule pinched at the arch
        const arch = 1 - 0.42 * Math.exp(-((u * u) / (0.0034)));
        const hw = HW * arch;
        const du = Math.max(0, Math.abs(u) - (HL - hw));
        const dd = Math.sqrt(du * du + v * v) / hw;
        if (dd > 1.3) continue;
        const core = 1 - Math.min(1, dd);
        // studs
        const su = Math.abs(((u / 0.062) % 1) - 0.5) * 2;
        const sv = Math.abs(((v / 0.055) % 1) - 0.5) * 2;
        const stud = Math.max(0, 1 - Math.hypot(su, sv) * 1.25);
        const torn = Math.min(1, core * (0.30 + 0.85 * d) + stud * core * 0.65 * d);
        put(ix, iy, torn, Math.min(1, core * 0.42 * d), Math.min(1, core * (0.22 + stud * 0.45)), Math.min(1, core * 0.30 * d));
      }
    }
    mark(x0, y0, x1, y1);
  }

  /** A dragged body: a tapered capsule with streaks, mud-heavy, shallow relief. */
  function skid(x0m, z0m, x1m, z1m, wm, strength) {
    const s = Math.max(0.1, Math.min(2.0, strength === undefined ? 1 : strength));
    const halfW = Math.max(0.08, (wm || 0.5) * 0.5);
    const rng = makeRng(((seed | 0) * 104729 + (stampIndex++) * 977) | 0);
    const streak = new Float32Array(9);
    for (let i = 0; i < 9; i++) streak[i] = 0.45 + rng() * 0.75;
    const dxm = x1m - x0m, dzm = z1m - z0m;
    const len = Math.hypot(dxm, dzm) || 1e-4;
    const ux = dxm / len, uz = dzm / len;

    const pad = halfW + 0.2;
    const bx0 = Math.floor(toU(Math.min(x0m, x1m) - pad)), bx1 = Math.ceil(toU(Math.max(x0m, x1m) + pad));
    const by0 = Math.floor(toV(Math.min(z0m, z1m) - pad)), by1 = Math.ceil(toV(Math.max(z0m, z1m) + pad));
    for (let iy = by0; iy <= by1; iy++) {
      for (let ix = bx0; ix <= bx1; ix++) {
        const wx = (ix + 0.5 - W * 0.5) / pxX + win4.x - x0m;
        const wz = (iy + 0.5 - H * 0.5) / pxZ + win4.y - z0m;
        let t = (wx * ux + wz * uz) / len;
        const v = -wx * uz + wz * ux;
        if (t < -0.12 || t > 1.12) continue;
        const tc = Math.max(0, Math.min(1, t));
        // widens and deepens toward the end of the drag
        const grow = 0.55 + 0.75 * tc;
        const si = tc * 8;
        const s0 = streak[Math.floor(si)], s1 = streak[Math.min(8, Math.floor(si) + 1)];
        const sf = si - Math.floor(si);
        const wob = s0 + (s1 - s0) * sf;
        const hw = halfW * grow * (0.7 + 0.55 * wob);
        const ends = Math.min(1, Math.min(t + 0.12, 1.12 - t) / 0.14);
        const dd = Math.abs(v) / hw;
        if (dd > 1.2) continue;
        const core = (1 - Math.min(1, dd)) * ends;
        // longitudinal furrows
        const fur = 0.55 + 0.45 * Math.cos(v / Math.max(0.02, halfW * 0.28) * 3.1416);
        const torn = Math.min(1, Math.pow(core, 0.8) * (0.42 + 0.62 * s) * fur);
        put(ix, iy, torn, Math.min(1, core * (0.5 + 0.4 * s)), Math.min(1, Math.pow(core, 1.6) * 0.7), Math.min(1, core * 0.75));
      }
    }
    mark(bx0, by0, bx1, by1);
  }

  function reset() {
    data.fill(0);
    stampIndex = 0;
    dirty = true;
    firstUpload = true;
    dirtyMinX = dirtyMinY = 1e9; dirtyMaxX = dirtyMaxY = -1e9;
  }

  /**
   * Upload. The first flush after a rebuild is the one full upload (load time). After
   * that it is always a sub-rectangle, so a play never pays for the whole buffer.
   */
  function flush(renderer) {
    if (!dirty) return 0;
    dirty = false;
    if (firstUpload || !subOk || !renderer) {
      firstUpload = false;
      tex.needsUpdate = true;
      bakes++;
      dirtyMinX = dirtyMinY = 1e9; dirtyMaxX = dirtyMaxY = -1e9;
      return 1;
    }
    let x0 = Math.max(0, Math.floor(dirtyMinX)), y0 = Math.max(0, Math.floor(dirtyMinY));
    let x1 = Math.min(W - 1, Math.ceil(dirtyMaxX)), y1 = Math.min(H - 1, Math.ceil(dirtyMaxY));
    dirtyMinX = dirtyMinY = 1e9; dirtyMaxX = dirtyMaxY = -1e9;
    if (x1 < x0 || y1 < y0) return 0;
    let rw = x1 - x0 + 1, rh = y1 - y0 + 1;
    if (rw > MAX_SCRATCH || rh > MAX_SCRATCH) { tex.needsUpdate = true; bakes++; return 1; }
    for (let y = 0; y < rh; y++) {
      const src = ((y0 + y) * W + x0) * 4;
      scratchData.set(data.subarray(src, src + rw * 4), y * MAX_SCRATCH * 4);
    }
    scratch.needsUpdate = true;
    box.min.set(0, 0);
    box.max.set(rw, rh);
    dst.set(x0, y0);
    try {
      renderer.copyTextureToTexture(scratch, tex, box, dst);
    } catch (e) {
      subOk = false;
      tex.needsUpdate = true;
      bakes++;
      return 1;
    }
    return 0;
  }

  return {
    texture: tex,
    window: win4,
    divot, cleat, skid, reset, flush,
    setWindow(cx, cz, hx, hz) { win4.set(cx, cz, hx, hz); },
    get fullBakes() { return bakes; },
    dispose() { tex.dispose(); scratch.dispose(); },
    bytes: W * H * 4,
  };
}

export default { createDamage };
