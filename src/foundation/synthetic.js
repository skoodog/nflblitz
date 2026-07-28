// FOUNDATION — PERFCORE. The synthetic load generator.
//
// PROOF 1 depends on this file. A pacing number measured on an empty scene proves
// nothing: the loop can obviously hold its wall with nothing to do. What has to be
// proven is that the loop holds the wall AT THE TIER'S STRUCTURAL CAP — the worst legal
// scene a piece is allowed to build — while the CPU is throttled to that tier's rate.
//
// So this builds a scene UP TO the cap, using foundation fallback content plus
// deliberately dumb filler geometry, and reports exactly what it added. It never
// exceeds a cap: `budget.mjs` runs against the same scene and must PASS.
//
// It is also where the CANARY lives (`?canary=1`): a 400-draw-call group tagged
// `perfcore-canary`, whose only purpose is to make `budget.mjs` exit 1 and name it.
// A gate that has never been shown to fail is not a gate.

import { TIERS, RUNGS } from './quality.js';

/**
 * Plane subdivisions that yield close to `want` triangles without exceeding it.
 * PlaneGeometry(w, h, sx, sy) produces sx * sy * 2 triangles exactly.
 */
function segsFor(want) {
  if (want < 2) return [1, 1];
  const target = Math.floor(want / 2);
  let sx = Math.max(1, Math.floor(Math.sqrt(target)));
  let sy = Math.max(1, Math.floor(target / sx));
  while (sx * sy * 2 > want && sx > 1) sx--;
  while ((sx + 1) * sy * 2 <= want) sx++;
  while (sx * (sy + 1) * 2 <= want) sy++;
  return [sx, sy];
}

/**
 * buildSyntheticLoad(THREE, opts) -> { group, added, dispose }
 *
 * opts: { drawCalls, triangles, particles, materials, seed, piece }
 * Creates exactly `drawCalls` drawable meshes (+1 for the particle system if
 * particles > 0), distributing `triangles` across them.
 *
 * Materials are SHARED across the filler meshes and deliberately few: the program cap
 * is a separate axis and the filler must not eat it. Three materials -> three programs.
 */
export function buildSyntheticLoad(THREE, opts) {
  const o = opts || {};
  const wantCalls = Math.max(0, o.drawCalls | 0);
  const wantTris = Math.max(0, o.triangles | 0);
  const wantParticles = Math.max(0, o.particles | 0);
  const nMat = Math.max(1, Math.min(4, o.materials || 3));
  const piece = o.piece || 'perfcore-synthetic';

  const group = new THREE.Group();
  group.name = piece;
  group.userData.piece = piece;

  const mats = [];
  for (let i = 0; i < nMat; i++) {
    mats.push(new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(0.08 + i * 0.11, 0.35, 0.32),
      roughness: 0.72 - i * 0.12,
      metalness: i === 2 ? 0.55 : 0.05,
      fog: true,
    }));
  }

  const geos = [];
  const added = { drawCalls: 0, triangles: 0, particles: 0, geometries: 0, materials: nMat };

  if (wantCalls > 0) {
    // TWO BUGS LIVED HERE AND BOTH MADE THIS FILE FAIL AT ITS ONE JOB.
    //
    // 1. THE LOOP STOPPED AT THE TRIANGLE BUDGET, NOT THE DRAW-CALL BUDGET.
    //    `perMesh = floor(wantTris / wantCalls)` was rounded DOWN by `segsFor` to the
    //    nearest sx*sy*2, and the loop then broke as soon as one more mesh would have
    //    exceeded `wantTris`. Every rounding-down compounded, so the scene ran out of
    //    triangle budget several meshes before it ran out of draw calls and the filler
    //    quietly stopped short of BOTH caps. The last mesh now carries the remainder in
    //    its own geometry, so all `wantCalls` meshes are placed AND the triangle total
    //    lands within a few hundred of the cap.
    //
    // 2. THE FILLER WAS FRUSTUM CULLED, SO MOST OF IT NEVER DREW.
    //    The meshes were scattered on a golden-angle spiral out to r = 35 around the
    //    origin, which puts most of them behind or beside a sideline camera. three.js
    //    culls them, so `renderer.info.render.calls` — the number the report prints and
    //    the number a reader believes — counted a fraction of what was built. Measured
    //    at the floor tier the "cap" scene drew 30 calls against a 60 cap. A proof scene
    //    that is half-culled proves half of nothing. `frustumCulled = false` now forces
    //    every filler draw to be ISSUED, which is the axis under test, and the shell is
    //    tightened to sit in front of the play so the fill is real too.
    const perMesh = Math.max(2, Math.floor(wantTris / wantCalls));
    const [sx, sy] = segsFor(perMesh);
    const triPer = sx * sy * 2;
    // ONE geometry shared by every filler mesh but the last. Each mesh is still its own
    // draw call, which is the metric under test; sharing the geometry keeps the geometry
    // count and the upload cost out of the measurement.
    const geo = new THREE.PlaneGeometry(2.2, 2.2, sx, sy);
    geos.push(geo);

    // The last mesh absorbs everything `segsFor`'s rounding left on the table.
    const remainder = Math.max(2, wantTris - (wantCalls - 1) * triPer);
    const [rx, ry] = segsFor(remainder);
    const geoLast = (rx === sx && ry === sy) ? geo : new THREE.PlaneGeometry(2.2, 2.2, rx, ry);
    if (geoLast !== geo) geos.push(geoLast);
    const triLast = rx * ry * 2;

    let tris = 0;
    for (let i = 0; i < wantCalls; i++) {
      const last = i === wantCalls - 1;
      const g = last ? geoLast : geo;
      const m = new THREE.Mesh(g, mats[i % nMat]);
      // A shell in FRONT of the play, not a sphere around it: the point is that these
      // draws cost something, and a quad behind the camera costs nothing.
      const a = i * 2.399963;                       // golden angle: no visible lattice
      const r = 2.5 + (i % 23) * 0.42;
      m.position.set(Math.cos(a) * r * 0.8, 0.4 + (i % 11) * 0.42, Math.sin(a) * r * 0.5 - 6);
      m.rotation.set(-1.2 + (i % 7) * 0.11, a, 0);
      m.castShadow = false;
      m.receiveShadow = false;
      // NEVER CULLED. See bug 2 above: this is the difference between a proof and a
      // number that looks like one.
      m.frustumCulled = false;
      m.userData.piece = piece;
      group.add(m);
      tris += last ? triLast : triPer;
    }
    added.drawCalls = wantCalls;
    added.triangles = tris;
    added.geometries = geoLast === geo ? 1 : 2;
  }

  if (wantParticles > 0) {
    const pos = new Float32Array(wantParticles * 3);
    for (let i = 0; i < wantParticles; i++) {
      const a = i * 2.399963, r = 2 + (i % 53) * 0.31;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = 0.2 + (i % 29) * 0.14;
      pos[i * 3 + 2] = Math.sin(a) * r - 6;
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geos.push(pg);
    const pm = new THREE.PointsMaterial({ size: 0.09, color: 0xffd24a, transparent: true, opacity: 0.75, depthWrite: false });
    const pts = new THREE.Points(pg, pm);
    pts.userData.piece = piece;
    pts.frustumCulled = false;
    group.add(pts);
    mats.push(pm);
    added.particles = wantParticles;
    added.drawCalls += 1;
  }

  return {
    group, added,
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
    },
  };
}

/**
 * Top a scene UP to a tier's caps, given what the base scene already costs.
 * `base` is a report from countScene(). Never exceeds a cap; if the base scene is
 * already over, adds nothing and says so.
 */
export function fillToTierCap(THREE, tier, base, rung) {
  const caps = TIERS[tier].caps;
  const r = RUNGS[rung === undefined ? TIERS[tier].rungHi : rung];
  const headroomCalls = Math.max(0, caps.drawCalls - (base ? base.drawCalls : 0));
  const headroomTris = Math.max(0, caps.triangles - (base ? base.triangles : 0));
  // Leave one draw call for the particle system when the tier allows particles.
  const particles = Math.min(caps.particles, r.particles);
  const callBudget = Math.max(0, headroomCalls - (particles > 0 ? 1 : 0));
  return buildSyntheticLoad(THREE, {
    drawCalls: callBudget,
    triangles: headroomTris,
    particles,
    materials: 3,
  });
}

/**
 * THE CANARY. Deliberately over budget: 400 draw calls tagged `perfcore-canary`.
 * Exists so `budget.mjs` can be SHOWN failing, by name, with the count and the cap.
 */
export function buildCanary(THREE) {
  return buildSyntheticLoad(THREE, {
    drawCalls: 400,
    triangles: 400 * 2,
    particles: 0,
    materials: 1,
    piece: 'perfcore-canary',
  });
}

export default { buildSyntheticLoad, fillToTierCap, buildCanary };
