// PIECE: character-anatomy — geometry toolkit.
//
// Everything here builds RAW ARRAYS in bind-pose WORLD space and carries explicit skin
// weights per vertex. Parts are merged into one SkinnedMesh at the end, grouped by
// material slot, so an actor is one geometry with N groups (N = draw calls) and the LOD
// chain is just "build the same parts with fewer rings / fewer slots".
//
// Nothing in this file runs inside the frame loop — actors are built at load.

/* ------------------------------------------------------------------ vec3 */

export const V = {
  add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; },
  sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; },
  mul(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; },
  dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; },
  cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  },
  len(a) { return Math.hypot(a[0], a[1], a[2]); },
  norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; },
  madd(a, b, s) { return [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s]; },
};

export function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
export function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
export function smooth01(x) { x = clamp01(x); return x * x * (3 - 2 * x); }
export function mix(a, b, t) { return a + (b - a) * t; }

/** Smooth bump: 1 at d=0, 0 at |d|>=w. */
export function bump(d, w) {
  const x = 1 - Math.abs(d) / w;
  return x <= 0 ? 0 : x * x * (3 - 2 * x);
}

/** Directional lobe used for muscle / pad swells: pow(max(0,dot),k). */
export function lobe(rad, dir, k) {
  const d = rad[0] * dir[0] + rad[1] * dir[1] + rad[2] * dir[2];
  return d <= 0 ? 0 : Math.pow(d, k);
}

/**
 * Piecewise-linear table lookup. `tab` is a flat [x0,y0, x1,y1, ...] ascending in x.
 * Used for every radius profile so the shapes stay readable as data.
 */
export function curve(tab, x) {
  const n = tab.length >> 1;
  if (x <= tab[0]) return tab[1];
  if (x >= tab[(n - 1) * 2]) return tab[(n - 1) * 2 + 1];
  for (let i = 1; i < n; i++) {
    const x1 = tab[i * 2];
    if (x <= x1) {
      const x0 = tab[(i - 1) * 2], y0 = tab[(i - 1) * 2 + 1], y1 = tab[i * 2 + 1];
      const f = (x - x0) / (x1 - x0 || 1);
      return y0 + (y1 - y0) * (f * f * (3 - 2 * f));
    }
  }
  return tab[(n - 1) * 2 + 1];
}

/* ------------------------------------------------------------------ parts */

/**
 * A part is one contiguous chunk of geometry belonging to exactly one material slot.
 * `flat:true` duplicates vertices per face so normals are faceted (used for hard-surface
 * gear rims and cleat soles where a smoothed normal reads as mush).
 */
export function newPart(slot, opts) {
  return {
    slot,
    pos: [], uv: [], si: [], sw: [], idx: [],
    flat: !!(opts && opts.flat),
    nrm: null,
    // [value, mask], used ONLY by the LOD3 imposter proxy, which collapses every slot
    // into one draw call. `mask` picks which of the instance's TWO kit colours this part
    // wears (0 = jersey family, 1 = pants family) and `value` is the shade within it. That
    // pair is what lets a single instanced draw call reproduce the thing that actually
    // makes a distant football player legible — a dark jersey over light pants over a dark
    // boot — instead of a one-colour lozenge. See imposter.js.
    tint: null,
  };
}

/** weights: array of [boneIndex, weight]; up to 4, normalised here. */
export function addVert(p, pos, u, v, weights) {
  p.pos.push(pos[0], pos[1], pos[2]);
  p.uv.push(u, v);
  let s = 0;
  const n = Math.min(4, weights.length);
  for (let i = 0; i < n; i++) s += weights[i][1];
  const inv = s > 0 ? 1 / s : 0;
  for (let i = 0; i < 4; i++) {
    const w = i < n ? weights[i] : null;
    p.si.push(w ? w[0] : 0);
    p.sw.push(w ? w[1] * inv : 0);
  }
  return (p.pos.length / 3) - 1;
}

export function addTri(p, a, b, c) { p.idx.push(a, b, c); }
export function addQuad(p, a, b, c, d) { p.idx.push(a, b, c, a, c, d); }

/** Face-area-weighted smooth normals (or faceted if part.flat). */
export function computeNormals(part) {
  const P = part.pos, I = part.idx;
  if (part.flat) {
    // explode: one vertex per corner
    const pos = [], uv = [], si = [], sw = [], nrm = [], idx = [];
    for (let f = 0; f < I.length; f += 3) {
      const a = I[f], b = I[f + 1], c = I[f + 2];
      const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
      const bx = P[b * 3], by = P[b * 3 + 1], bz = P[b * 3 + 2];
      const cx = P[c * 3], cy = P[c * 3 + 1], cz = P[c * 3 + 2];
      const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
      const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
      let nx = e1y * e2z - e1z * e2y;
      let ny = e1z * e2x - e1x * e2z;
      let nz = e1x * e2y - e1y * e2x;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      const base = pos.length / 3;
      for (const v of [a, b, c]) {
        pos.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
        uv.push(part.uv[v * 2], part.uv[v * 2 + 1]);
        si.push(part.si[v * 4], part.si[v * 4 + 1], part.si[v * 4 + 2], part.si[v * 4 + 3]);
        sw.push(part.sw[v * 4], part.sw[v * 4 + 1], part.sw[v * 4 + 2], part.sw[v * 4 + 3]);
        nrm.push(nx, ny, nz);
      }
      idx.push(base, base + 1, base + 2);
    }
    part.pos = pos; part.uv = uv; part.si = si; part.sw = sw; part.idx = idx; part.nrm = nrm;
    return part;
  }
  const n = P.length;
  const N = new Float64Array(n);
  for (let f = 0; f < I.length; f += 3) {
    const a = I[f] * 3, b = I[f + 1] * 3, c = I[f + 2] * 3;
    const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
    const e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    N[a] += nx; N[a + 1] += ny; N[a + 2] += nz;
    N[b] += nx; N[b + 1] += ny; N[b + 2] += nz;
    N[c] += nx; N[c + 1] += ny; N[c + 2] += nz;
  }
  const out = new Array(n);
  for (let i = 0; i < n; i += 3) {
    const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1;
    out[i] = N[i] / l; out[i + 1] = N[i + 1] / l; out[i + 2] = N[i + 2] / l;
  }
  part.nrm = out;
  return part;
}

/* ------------------------------------------------------------------ frames */

/** Orthonormal cross-section frame for a chain direction. */
export function frame(dir, ref) {
  const d = V.norm(dir);
  let r = ref || [0, 0, 1];
  if (Math.abs(V.dot(d, r)) > 0.97) r = [1, 0, 0];
  const u = V.norm(V.cross(r, d));
  const v = V.norm(V.cross(d, u));
  return { u, v, d };
}

/* ------------------------------------------------------------------- loft */

/**
 * loft(part, rings, seg, opts)
 * ring = { c:[x,y,z], u:[..], v:[..], rx, ry, w:[[bone,weight]..], vc, prof(rad, ringIdx, theta) }
 *
 * `prof` receives the WORLD-space radial unit vector, so a swell is written as
 * `1 + 0.12 * lobe(rad, FRONT, 3)` and means exactly what it says regardless of which
 * way the limb happens to point.
 *
 * Winding is decided empirically from the first quad so a loft is never inside-out.
 */
export function loft(part, rings, seg, opts) {
  const o = opts || {};
  const N = seg;
  const rows = [];
  for (let i = 0; i < rings.length; i++) {
    const r = rings[i];
    const row = new Array(N);
    for (let j = 0; j < N; j++) {
      const th = (j / N) * Math.PI * 2;
      const ct = Math.cos(th), st = Math.sin(th);
      const rad = [
        r.u[0] * ct + r.v[0] * st,
        r.u[1] * ct + r.v[1] * st,
        r.u[2] * ct + r.v[2] * st,
      ];
      const s = r.prof ? r.prof(rad, i, th) : 1;
      const x = r.c[0] + r.u[0] * ct * r.rx * s + r.v[0] * st * r.ry * s;
      const y = r.c[1] + r.u[1] * ct * r.rx * s + r.v[1] * st * r.ry * s;
      const z = r.c[2] + r.u[2] * ct * r.rx * s + r.v[2] * st * r.ry * s;
      const uu = o.uFn ? o.uFn(j / N) : (j / N);
      row[j] = addVert(part, [x, y, z], uu, r.vc !== undefined ? r.vc : i / (rings.length - 1), r.w);
    }
    rows.push(row);
  }

  // decide winding from the first quad: face normal must point away from the ring axis
  let flip = false;
  if (rings.length > 1) {
    const a = rows[0][0], b = rows[0][1], c = rows[1][1];
    const P = part.pos;
    const e1 = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]];
    const e2 = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
    const nrm = V.cross(e1, e2);
    const outward = V.sub([P[a * 3], P[a * 3 + 1], P[a * 3 + 2]], rings[0].c);
    if (V.dot(nrm, outward) < 0) flip = true;
  }

  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < N; j++) {
      const j2 = (j + 1) % N;
      const a = rows[i][j], b = rows[i][j2], c = rows[i + 1][j2], d = rows[i + 1][j];
      if (flip) addQuad(part, a, d, c, b);
      else addQuad(part, a, b, c, d);
    }
  }

  if (o.capStart) capRing(part, rings[0], rows[0], flip, true);
  if (o.capEnd) capRing(part, rings[rings.length - 1], rows[rows.length - 1], flip, false);
  return rows;
}

function capRing(part, ring, row, flip, isStart) {
  const centre = addVert(part, ring.c, 0.5, isStart ? 0 : 1, ring.w);
  const N = row.length;
  for (let j = 0; j < N; j++) {
    const j2 = (j + 1) % N;
    const inv = isStart ? !flip : flip;
    if (inv) addTri(part, centre, row[j], row[j2]);
    else addTri(part, centre, row[j2], row[j]);
  }
}

/* ------------------------------------------------- masked shell (helmet etc.) */

/**
 * shellFromMask — a grid surface with arbitrary holes, plus an extruded rim so the
 * cut edges read as a moulded shell with real thickness rather than paper.
 *
 * sample(iu, iv) -> { p:[x,y,z], n:[x,y,z], keep:bool, uv:[u,v] }
 * The rim is emitted double-wound into a flat-shaded part so it is correct from both
 * sides without needing a DoubleSide material (materials belong to uniform-kit).
 */
export function shellFromMask(part, rimPart, NU, NV, sample, weights, thickness) {
  const ids = new Int32Array(NU * NV).fill(-1);
  const keep = new Uint8Array(NU * NV);
  const pts = new Array(NU * NV);
  const nrms = new Array(NU * NV);
  for (let iv = 0; iv < NV; iv++) {
    for (let iu = 0; iu < NU; iu++) {
      const s = sample(iu, iv);
      const k = iv * NU + iu;
      pts[k] = s.p; nrms[k] = s.n; keep[k] = s.keep ? 1 : 0;
      if (s.keep) ids[k] = addVert(part, s.p, s.uv[0], s.uv[1], weights);
    }
  }
  const edges = new Map();
  const quads = [];
  for (let iv = 0; iv < NV - 1; iv++) {
    for (let iu = 0; iu < NU; iu++) {
      const iu2 = (iu + 1) % NU;
      const a = iv * NU + iu, b = iv * NU + iu2, c = (iv + 1) * NU + iu2, d = (iv + 1) * NU + iu;
      if (!keep[a] || !keep[b] || !keep[c] || !keep[d]) continue;
      // winding: outward, checked against the vertex normal
      const P = part.pos;
      const ia = ids[a], ib = ids[b], ic = ids[c];
      const e1 = [P[ib * 3] - P[ia * 3], P[ib * 3 + 1] - P[ia * 3 + 1], P[ib * 3 + 2] - P[ia * 3 + 2]];
      const e2 = [P[ic * 3] - P[ia * 3], P[ic * 3 + 1] - P[ia * 3 + 1], P[ic * 3 + 2] - P[ia * 3 + 2]];
      const fn = V.cross(e1, e2);
      const order = V.dot(fn, nrms[a]) >= 0 ? [a, b, c, d] : [a, d, c, b];
      addQuad(part, ids[order[0]], ids[order[1]], ids[order[2]], ids[order[3]]);
      quads.push(order);
      for (let e = 0; e < 4; e++) {
        const p0 = order[e], p1 = order[(e + 1) & 3];
        const key = p0 < p1 ? `${p0}_${p1}` : `${p1}_${p0}`;
        const rec = edges.get(key);
        if (rec) rec.n++;
        else edges.set(key, { n: 1, a: p0, b: p1 });
      }
    }
  }
  if (rimPart && thickness > 0) {
    const inner = new Map();
    const innerOf = (gi) => {
      let id = inner.get(gi);
      if (id === undefined) {
        id = addVert(rimPart, V.madd(pts[gi], nrms[gi], -thickness), 0.5, 0.5, weights);
        inner.set(gi, id);
      }
      return id;
    };
    const outerCopy = new Map();
    const outerOf = (gi) => {
      let id = outerCopy.get(gi);
      if (id === undefined) {
        id = addVert(rimPart, pts[gi], 0.5, 0.5, weights);
        outerCopy.set(gi, id);
      }
      return id;
    };
    for (const rec of edges.values()) {
      if (rec.n !== 1) continue;
      const oa = outerOf(rec.a), ob = outerOf(rec.b);
      const ia = innerOf(rec.a), ib = innerOf(rec.b);
      addQuad(rimPart, oa, ob, ib, ia);
      addQuad(rimPart, oa, ia, ib, ob);
    }
  }
  return ids;
}

/* -------------------------------------------------------------------- tube */

/** Swept circular tube along a polyline — facemask bars, chin straps, fingers. */
export function tube(part, pts, radiusFn, radial, weights, uv0) {
  const rows = [];
  const n = pts.length;
  let prevU = null;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const d = V.norm(V.sub(b, a));
    let f;
    if (prevU) {
      // parallel transport: project the previous u onto the new normal plane
      const u = V.norm(V.sub(prevU, V.mul(d, V.dot(prevU, d))));
      f = { u, v: V.norm(V.cross(d, u)), d };
    } else {
      f = frame(d, [0, 1, 0]);
    }
    prevU = f.u;
    const r = radiusFn(i / (n - 1), i);
    const row = new Array(radial);
    for (let j = 0; j < radial; j++) {
      const th = (j / radial) * Math.PI * 2;
      const p = [
        pts[i][0] + f.u[0] * Math.cos(th) * r + f.v[0] * Math.sin(th) * r,
        pts[i][1] + f.u[1] * Math.cos(th) * r + f.v[1] * Math.sin(th) * r,
        pts[i][2] + f.u[2] * Math.cos(th) * r + f.v[2] * Math.sin(th) * r,
      ];
      row[j] = addVert(part, p, uv0 ? uv0[0] : j / radial, uv0 ? uv0[1] : i / (n - 1), weights);
    }
    rows.push(row);
  }
  let flip = false;
  {
    const P = part.pos;
    const a = rows[0][0], b = rows[0][1], c = rows[1][1];
    const e1 = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]];
    const e2 = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
    const nrm = V.cross(e1, e2);
    const outward = V.sub([P[a * 3], P[a * 3 + 1], P[a * 3 + 2]], pts[0]);
    if (V.dot(nrm, outward) < 0) flip = true;
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const j2 = (j + 1) % radial;
      const a = rows[i][j], b = rows[i][j2], c = rows[i + 1][j2], d = rows[i + 1][j];
      if (flip) addQuad(part, a, d, c, b); else addQuad(part, a, b, c, d);
    }
  }
  // end caps (round-ish): a single centre fan keeps bars from looking hollow
  capTube(part, pts[0], rows[0], !flip, weights);
  capTube(part, pts[n - 1], rows[n - 1], flip, weights);
  return rows;
}

function capTube(part, c, row, inv, weights) {
  const centre = addVert(part, c, 0.5, 0.5, weights);
  const N = row.length;
  for (let j = 0; j < N; j++) {
    const j2 = (j + 1) % N;
    if (inv) addTri(part, centre, row[j], row[j2]);
    else addTri(part, centre, row[j2], row[j]);
  }
}

/* ------------------------------------------------------------------- merge */

const FLAT_TINT = [1, 0];

/**
 * Merge parts into one indexed BufferGeometry, one group per material slot in
 * `slotOrder`. Group count == draw calls for the actor, which is the number the
 * structural budget counts.
 */
export function mergeParts(THREE, parts, slotOrder, opts) {
  const o = opts || {};
  const bySlot = new Map();
  for (const p of parts) {
    if (!p || !p.idx.length) continue;
    if (!bySlot.has(p.slot)) bySlot.set(p.slot, []);
    bySlot.get(p.slot).push(p);
  }
  const order = slotOrder.filter((s) => bySlot.has(s));
  let vCount = 0, iCount = 0;
  for (const s of order) for (const p of bySlot.get(s)) { vCount += p.pos.length / 3; iCount += p.idx.length; }

  const pos = new Float32Array(vCount * 3);
  const nrm = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const si = new Uint16Array(vCount * 4);
  const sw = new Float32Array(vCount * 4);
  const col = o.tint ? new Float32Array(vCount * 2) : null;
  const idx = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);

  let vo = 0, io = 0;
  const groups = [];
  for (const s of order) {
    const start = io;
    for (const p of bySlot.get(s)) {
      const nv = p.pos.length / 3;
      pos.set(p.pos, vo * 3);
      nrm.set(p.nrm, vo * 3);
      uv.set(p.uv, vo * 2);
      si.set(p.si, vo * 4);
      sw.set(p.sw, vo * 4);
      if (col) {
        const t = p.tint || FLAT_TINT;
        for (let i = 0; i < nv; i++) { col[(vo + i) * 2] = t[0]; col[(vo + i) * 2 + 1] = t[1]; }
      }
      for (let i = 0; i < p.idx.length; i++) idx[io + i] = p.idx[i] + vo;
      io += p.idx.length;
      vo += nv;
    }
    groups.push({ slot: s, start, count: io - start });
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  if (col) geo.setAttribute('aTint', new THREE.BufferAttribute(col, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  const outOrder = [];
  for (let i = 0; i < groups.length; i++) {
    outOrder.push(groups[i].slot);
    geo.addGroup(groups[i].start, groups[i].count, i);
  }
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return { geometry: geo, slotOrder: outOrder, triangles: iCount / 3, vertices: vCount };
}

export default {
  V, clamp, clamp01, smooth01, mix, bump, lobe, curve,
  newPart, addVert, addTri, addQuad, computeNormals,
  frame, loft, shellFromMask, tube, mergeParts,
};
