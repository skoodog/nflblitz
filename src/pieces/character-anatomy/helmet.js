// PIECE: character-anatomy — helmet shell, tubular facemask, chin strap, visor.
//
// The helmet is the second half of the silhouette read (the shoulder shelf is the first)
// and the facemask is the single detail a critic checks first: in bar/panel-truck and
// bar/panel-catch it is unmistakably a CAGE OF TUBES with a centre bar, not a flat card.
// So the mask is real swept tube geometry, and the shell is a masked grid with a real
// extruded rim so the cut edge round the face port catches a highlight.

import {
  V, clamp01, mix, smooth01, newPart, addVert, addTri, addQuad, computeNormals,
  shellFromMask, tube, loft,
} from './mesh.js';

/* helmet local shape ------------------------------------------------------- */

/** Unit-sphere direction -> helmet outer surface offset from the helmet centre. */
function shellPoint(sx, sy, sz, A, B, C) {
  const down = sy < 0 ? -sy : 0;
  const widen = 1 + 0.62 * Math.pow(down, 1.3);
  let x = sx * A * widen;
  let z = sz * C * widen;
  let y = sy * B;
  // occipital: the shell runs further back and hangs lower behind the ear
  if (sz < 0) { z *= 1 + 0.13 * (-sz); y -= 0.016 * (-sz) * (1 - clamp01(sy)) * B; }
  // flat-ish crown, brow ridge
  if (sy > 0) y *= 1 - 0.05 * Math.pow(sy, 5);
  if (sz > 0.25) z += 0.012 * C * smooth01((sz - 0.25) / 0.5) * (1 - Math.abs(sy));
  // jaw flap comes forward as it descends
  if (sy < -0.25 && sz > -0.2) z += 0.10 * C * smooth01((-sy - 0.25) / 0.55) * clamp01(sz + 0.2);
  return [x, y, z];
}

function elMinAt(az) {
  const a = Math.abs(az);
  const k = clamp01((a - 0.52) / 0.58);
  const front = -0.80, side = -1.05, back = -0.70;
  if (a <= 1.10) return mix(front, side, smooth01(k));
  return mix(side, back, smooth01((a - 1.10) / (Math.PI - 1.10)));
}

const OPEN_AZ = 0.845;
const OPEN_EL0 = -0.305;
const OPEN_ELR = 0.505;

function inFacePort(az, el) {
  if (Math.abs(az) > 1.3) return false;
  const a = Math.abs(az) / OPEN_AZ;
  const b = Math.abs(el - OPEN_EL0) / OPEN_ELR;
  return Math.pow(a, 2.7) + Math.pow(b, 2.7) < 1;
}

function inEarPort(az, el) {
  const a = (Math.abs(az) - 1.78) / 0.105;
  const b = (el + 0.315) / 0.125;
  return a * a + b * b < 1;
}

/* ----------------------------------------------------------------- shell */

export function buildHelmet(S, parts) {
  const { gs, BI } = S;
  const hs = S.headS;
  const A = 0.134 * gs * hs, B = 0.153 * gs * hs, C = 0.156 * gs * hs;
  const cx = 0, cy = S.yHeadC + 0.010 * gs, cz = 0.004 * gs;
  const W = [[BI.head, 1]];

  if (S.proxy) { buildProxyHelmet(S, parts, { A, B, C, cx, cy, cz, W }); return; }

  const shell = newPart('helmetShell');
  const rim = newPart('helmetShell', { flat: true });
  const NU = S.helmU;
  const NV = S.helmV;

  const rowStep = Math.PI / (NV - 1);

  shellFromMask(shell, rim, NU, NV, (iu, iv) => {
    const th = (iu / NU) * Math.PI * 2 - Math.PI;   // 0 = front, +ve = player's left
    const ph = (iv / (NV - 1)) * Math.PI;
    const el = Math.PI / 2 - ph;

    // TOPOLOGY is decided on the raw grid point...
    const keep = el > elMinAt(th) && !inFacePort(th, el) && !inEarPort(th, el);

    // ...but the POSITION of a boundary vertex is snapped onto the exact cut curve.
    // A masked grid drops whole quads, so without this the face port is a staircase of
    // ~3-degree steps — invisible at panel scale, glaring in iso_helmet, and the first
    // thing that says "procedural" about an otherwise good helmet.
    let th2 = th, el2 = el;
    if (Math.abs(th) < 1.35) {
      const fa = Math.abs(th) / OPEN_AZ;
      const fb = Math.abs(el - OPEN_EL0) / OPEN_ELR;
      const F = Math.pow(fa, 2.7) + Math.pow(fb, 2.7);
      if (F > 1 && F < 1.45) {
        const w = clamp01((1.45 - F) / 0.45);
        const k = Math.pow(F, -1 / 2.7);
        th2 = mix(th, (th < 0 ? -1 : 1) * fa * k * OPEN_AZ, w);
        el2 = mix(el, OPEN_EL0 + (el < OPEN_EL0 ? -1 : 1) * fb * k * OPEN_ELR, w);
      }
    }
    const em = elMinAt(th2);
    if (el2 > em && el2 - em < rowStep * 0.98) el2 = em;

    const sy = Math.sin(el2);
    const sh = Math.cos(el2);
    const sx = sh * Math.sin(th2);
    const sz = sh * Math.cos(th2);
    const p = shellPoint(sx, sy, sz, A, B, C);
    // outward normal of the (slightly non-spherical) shell — good enough for the rim
    const n = V.norm([p[0] / (A * A), p[1] / (B * B), p[2] / (C * C)]);
    return {
      p: [cx + p[0], cy + p[1], cz + p[2]],
      n, keep,
      uv: [iu / NU, 1 - iv / (NV - 1)],
    };
  }, W, 0.013 * gs * hs);

  computeNormals(shell);
  computeNormals(rim);
  parts.push(shell, rim);

  buildFacemask(S, parts, { A, B, C, cx, cy, cz, W });
  buildChinStrap(S, parts, { A, B, C, cx, cy, cz, W });
  if (S.visor) buildVisor(S, parts, { A, B, C, cx, cy, cz, W });
  buildHelmetBumper(S, parts, { A, B, C, cx, cy, cz, W });
}

/* ---------------------------------------------------- proxy (LOD3) helmet */

/**
 * THE IMPOSTER HELMET. The real helmet is a masked grid + an extruded rim + seven swept
 * tubes + a chin strap + a chin cup, and it cost 718 of the old LOD3 actor's 2,256
 * triangles — 32% of the whole figure. None of that survives at imposter distance except
 * two things, and both of them are SILHOUETTE:
 *
 *   1. the dome, which is wider at the jaw than at the crown and hangs low at the back;
 *   2. the forward jut of the facemask, which is what stops a helmeted head reading as a
 *      bald head. Without it the imposter's profile is a ball on a neck and it POPS
 *      against LOD2 the moment an actor crosses the boundary.
 *
 * So: one closed shell sampled from the SAME `shellPoint()` the real helmet uses (so the
 * profiles agree by construction, not by eye), plus one small swept wedge for the cage.
 * ~104 triangles, no face port, no rim, no tubes.
 */
function buildProxyHelmet(S, parts, H) {
  const shell = newPart('helmetShell');
  // Azimuth count is the whole game here: at 8 the dome reads as a visible OCTAGON
  // against LOD2's 20-segment shell, which is a pop even in pure silhouette. 12 is the
  // point where the facets stop being readable at imposter distance.
  const NU = S.helmU || 12;   // azimuths
  const EL_TOP = 1.20;        // just below the crown pole
  const EL_BOT = -1.02;       // bottom of the jaw flap
  const NV = S.helmV || 5;    // rings between the poles

  // crown pole
  const crownP = shellPoint(0, 1, 0, H.A, H.B, H.C);
  const crown = addVert(shell, [H.cx + crownP[0], H.cy + crownP[1], H.cz + crownP[2]], 0.5, 1, H.W);

  const rows = [];
  let bx = 0, by = 0, bz = 0;
  for (let iv = 0; iv < NV; iv++) {
    const el = mix(EL_TOP, EL_BOT, iv / (NV - 1));
    const sy = Math.sin(el), sh = Math.cos(el);
    const row = new Array(NU);
    for (let iu = 0; iu < NU; iu++) {
      const th = (iu / NU) * Math.PI * 2 - Math.PI;
      const p = shellPoint(sh * Math.sin(th), sy, sh * Math.cos(th), H.A, H.B, H.C);
      const x = H.cx + p[0], y = H.cy + p[1], z = H.cz + p[2];
      row[iu] = addVert(shell, [x, y, z], iu / NU, 1 - iv / (NV - 1), H.W);
      if (iv === NV - 1) { bx += x; by += y; bz += z; }
    }
    rows.push(row);
  }

  for (let iu = 0; iu < NU; iu++) addTri(shell, crown, rows[0][iu], rows[0][(iu + 1) % NU]);
  for (let iv = 0; iv < NV - 1; iv++) {
    for (let iu = 0; iu < NU; iu++) {
      const iu2 = (iu + 1) % NU;
      addQuad(shell, rows[iv][iu], rows[iv + 1][iu], rows[iv + 1][iu2], rows[iv][iu2]);
    }
  }
  // close the underside so the shell is a solid, not a bowl seen from below
  const base = addVert(shell, [bx / NU, by / NU, bz / NU], 0.5, 0, H.W);
  for (let iu = 0; iu < NU; iu++) addTri(shell, base, rows[NV - 1][(iu + 1) % NU], rows[NV - 1][iu]);

  computeNormals(shell);
  parts.push(shell);

  // the cage, as one 4-sided swept wedge from brow to jaw
  const cage = newPart('facemask');
  const rings = [];
  const M = 4;
  for (let i = 0; i < M; i++) {
    const f = i / (M - 1);
    const row = maskRowAt(f);
    rings.push({
      c: [H.cx, H.cy + row.y * H.B, H.cz + row.z * H.C * 0.86],
      u: [1, 0, 0], v: [0, 0, 1],
      rx: row.w * H.A * 0.92, ry: 0.115 * H.C,
      w: H.W, vc: f,
    });
  }
  loft(cage, rings, 5, { capStart: true, capEnd: true });
  computeNormals(cage);
  parts.push(cage);
}

/* -------------------------------------------------------------- facemask */

// Bar y (local, fraction of B) -> half-width and forward reach (fractions of A / C).
const MASK_ROWS = [
  /* brow   */ { y: 0.235, w: 0.865, z: 0.985 },
  /* eye    */ { y: -0.140, w: 0.855, z: 1.115 },
  /* nose   */ { y: -0.455, w: 0.775, z: 1.130 },
  /* chin   */ { y: -0.800, w: 0.630, z: 1.045 },
  /* jaw    */ { y: -1.070, w: 0.430, z: 0.860 },
];

function maskPt(u, row, H) {
  const x = u * row.w * H.A;
  const y = row.y * H.B;
  const z = row.z * H.C - 0.30 * u * u * H.C;
  return [H.cx + x, H.cy + y, H.cz + z];
}

function maskRowAt(f) {
  // f in [0,1] across the 5 rows, linear interpolation for the vertical bars
  const t = f * (MASK_ROWS.length - 1);
  const i = Math.min(MASK_ROWS.length - 2, Math.floor(t));
  const k = t - i;
  const a = MASK_ROWS[i], b = MASK_ROWS[i + 1];
  return { y: mix(a.y, b.y, k), w: mix(a.w, b.w, k), z: mix(a.z, b.z, k) };
}

function buildFacemask(S, parts, H) {
  const mask = newPart('facemask');
  const R = 0.0098 * S.gs * S.headS;
  const rad = S.lod >= 1 ? 7 : 5;
  const nU = S.rows.mask;
  const rf = () => R;

  // horizontal bars
  for (let r = 0; r < MASK_ROWS.length; r++) {
    const row = MASK_ROWS[r];
    const pts = [];
    const span = r === MASK_ROWS.length - 1 ? 0.98 : 1.0;
    for (let i = 0; i < nU; i++) {
      const u = mix(-span, span, i / (nU - 1));
      pts.push(maskPt(u, row, H));
    }
    // curl the outer ends back into the shell so the cage looks bolted on
    pts[0] = V.madd(pts[0], [0, 0, -1], 0.030 * S.gs);
    pts[pts.length - 1] = V.madd(pts[pts.length - 1], [0, 0, -1], 0.030 * S.gs);
    tube(mask, pts, rf, rad, H.W);
  }

  // vertical bars: centre nose bar + two side posts
  const verts = [0, 0.62, -0.62];
  for (let v = 0; v < verts.length; v++) {
    const u = verts[v];
    const pts = [];
    const nV = S.rows.maskV;
    const f0 = 0.0, f1 = v === 0 ? 1.0 : 0.80;
    for (let i = 0; i < nV; i++) {
      const f = mix(f0, f1, i / (nV - 1));
      pts.push(maskPt(u, maskRowAt(f), H));
    }
    pts[0] = V.madd(pts[0], [0, 0.02 * S.gs, -0.018 * S.gs], 1);
    tube(mask, pts, rf, rad, H.W);
  }

  computeNormals(mask);
  parts.push(mask);
}

/* ------------------------------------------------------------ chin strap */

function buildChinStrap(S, parts, H) {
  const strap = newPart('pad');
  const R = 0.0105 * S.gs * S.headS;
  const cupY = H.cy - 1.235 * H.B;
  const cupZ = H.cz + 0.62 * H.C;
  const pts = [];
  const anchorL = [H.cx + 0.86 * H.A, H.cy - 0.62 * H.B, H.cz + 0.30 * H.C];
  const anchorR = [H.cx - 0.86 * H.A, H.cy - 0.62 * H.B, H.cz + 0.30 * H.C];
  const n = S.rows.maskV;
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    const a = f < 0.5 ? anchorL : anchorR;
    const g = f < 0.5 ? f * 2 : (1 - f) * 2;
    const p = V.lerp(a, [H.cx, cupY, cupZ], smooth01(g));
    p[1] -= 0.035 * H.B * Math.sin(g * Math.PI);
    pts.push(p);
  }
  tube(strap, pts, () => R, S.lod >= 1 ? 6 : 4, H.W);

  // chin cup
  const cup = newPart('pad');
  const rings = [];
  for (let i = 0; i < 5; i++) {
    const a = i / 4;
    rings.push({
      c: [H.cx, cupY + 0.05 * H.B * (a - 0.5), cupZ - 0.16 * H.C + 0.32 * H.C * a],
      u: [1, 0, 0], v: [0, 1, 0],
      rx: (0.40 - 0.16 * Math.abs(a - 0.45) * 2) * H.A,
      ry: 0.16 * H.B,
      w: H.W, vc: a,
    });
  }
  loft(cup, rings, 10, { capStart: true, capEnd: true });
  computeNormals(strap);
  computeNormals(cup);
  parts.push(strap, cup);
}

/* ----------------------------------------------------------------- visor */

function buildVisor(S, parts, H) {
  const vis = newPart('visor');
  const NU = 16, NV = 5;
  const rows = [];
  for (let iv = 0; iv < NV; iv++) {
    const f = iv / (NV - 1);
    const row = maskRowAt(mix(0.02, 0.44, f));
    const ids = [];
    const span = 0.94 * Math.sqrt(Math.max(0.04, 1 - Math.pow((f - 0.42) / 0.72, 2)));
    for (let iu = 0; iu < NU; iu++) {
      const u = mix(-span, span, iu / (NU - 1));
      const p = maskPt(u, row, H);
      p[2] -= 0.085 * H.C;
      ids.push(addVert(vis, p, iu / (NU - 1), f, H.W));
    }
    rows.push(ids);
  }
  for (let iv = 0; iv < NV - 1; iv++) {
    for (let iu = 0; iu < NU - 1; iu++) {
      addQuad(vis, rows[iv][iu], rows[iv][iu + 1], rows[iv + 1][iu + 1], rows[iv + 1][iu]);
    }
  }
  computeNormals(vis);
  parts.push(vis);
}

/* ------------------------------------- front shell bumper / occipital pad */

function buildHelmetBumper(S, parts, H) {
  if (S.lod < 1) return;
  const p = newPart('pad');
  const rings = [];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    const az = mix(-0.80, 0.80, f);
    const el = 0.30;
    const sy = Math.sin(el), sh = Math.cos(el);
    const sx = sh * Math.sin(az), sz = sh * Math.cos(az);
    const q = shellPoint(sx, sy, sz, H.A, H.B, H.C);
    rings.push({
      c: [H.cx + q[0] * 1.0, H.cy + q[1], H.cz + q[2]],
      u: [0, 1, 0], v: V.norm([q[0], 0, q[2]]),
      rx: 0.055 * H.B, ry: 0.030 * H.C,
      w: H.W, vc: f,
    });
  }
  loft(p, rings, 8, { capStart: true, capEnd: true });
  computeNormals(p);
  parts.push(p);
}

export default { buildHelmet };
