// PIECE: character-anatomy — THE IMPOSTER BATCH. One InstancedMesh, every distant actor.
//
// WHAT THIS FIXES
//   The rung table has carried an `imposter` column since round 1 and it moved zero
//   triangles: LOD3 was a SkinnedMesh with one material group, exactly like LOD2, so
//   `budget.mjs` counted 14 skinned actors at the floor rung against a cap of 6, and
//   hiding the actors took the floor frame from 26.5 ms to 13.4 ms. The column was inert.
//
// WHAT AN IMPOSTER IS HERE
//   NOT a camera-facing billboard. A billboard is the cheapest thing that can be called
//   an imposter and the first thing a viewer catches: it shears as the camera trucks, it
//   needs an alpha-tested texture (overdraw the floor rung cannot pay for), and it has no
//   silhouette of its own when the camera drops to ground level — which is precisely the
//   camera this game uses. So the imposter is a REAL 3D PROXY: the same figure, built by
//   the same part builders from the same profile tables, with the parts that only exist
//   at conversational distance (face port, cage tubes, gloves, outsole plate, head)
//   removed rather than approximated. It is right from every angle because it IS the
//   shape, just coarse.
//
//   Cost per distant actor drops from "1 SkinnedMesh, 1 draw call, 2,256 triangles" to
//   "0 SkinnedMeshes, 1/N of a draw call, 814 triangles" — and the 814 is ONE geometry
//   shared by all of them, so eight distant actors are 6,512 triangles in a single call
//   instead of 18,048 in eight calls off eight SkinnedMeshes.
//
// COLOUR — TWO kit colours per instance, which is the whole reason this does not read as
// cardboard. The proxy geometry carries a per-vertex [value, mask] pair (PROXY_TINT in
// actor.js): the mask picks the instance's JERSEY colour or its PANTS colour, the value
// shades within that family. Twenty extra lines of onBeforeCompile, one program, and a
// distant Chicago player is black over white instead of the flat mid-grey a single
// multiplicative colour is mathematically stuck with.
//
// LIFETIME
//   Created on the first LOD3 actor of a build pass, torn down at the start of the next
//   pass. Build passes only happen at a play boundary or a scene load — never in a frame.
//   NOTHING in this file runs on the frame path except `sync()`, which is a flag check.

import { PROPORTIONS } from '../../foundation/rig.js';
import { buildProxyGeometry, PROXY_ARCHETYPE } from './actor.js';

/** Hard ceiling on instances. `live_play` is 14; this leaves room for a bigger cast. */
const CAPACITY = 32;

let batch = null;

/**
 * THE PROXY GEOMETRY AND ITS MATERIAL ARE BUILT ONCE FOR THE PAGE, not once per pass.
 *
 * A build pass happens on every rung change that crosses an LOD-plan edge, and
 * `prewarmPrograms` walks all sixteen rungs at load. Minting a fresh material each time
 * would drop three.js's program refcount to zero and force a RELINK on the next pass —
 * i.e. exactly the driver stall that prewarming exists to prevent, moved to a play
 * boundary. Rebuilding the geometry each time would also re-run the whole part builder
 * for a mesh whose inputs never change (reference archetype, fixed seed). Both are
 * cached; only the InstancedMesh wrapper is per-pass, because that is what carries the
 * instance count and the transforms.
 */
const sharedByPose = new Map();     // poseId -> { geometry, triangles, vertices, ... }
let sharedMat = null;

/* --------------------------------------------------------------- scratch */
// Allocated once, on first use, and reused forever. Nothing here allocates per frame,
// and the per-instance maths below runs at most CAPACITY times per build pass.
let M4 = null, VP = null, VS = null, QT = null, AXIS = null, COL = null;

function scratch(THREE) {
  if (M4) return;
  M4 = new THREE.Matrix4();
  VP = new THREE.Vector3();
  VS = new THREE.Vector3();
  QT = new THREE.Quaternion();
  AXIS = new THREE.Vector3(0, 1, 0);
  COL = new THREE.Color();
}

/* ----------------------------------------------------------------- colour */

/**
 * Read one colour out of a material set, DEFENSIVELY.
 *
 * `matSet.__kit` is uniform-kit's published kit record (CSS colour strings) and
 * `matSet[slot].color` is the material's own colour, which is what the clay look uses.
 * Both belong to other code, so every step falls back; a piece that cannot read a colour
 * must still draw a player, just not a particular club's.
 */
export function kitColor(THREE, matSet, kitKey, slot, fallbackHex, out) {
  scratch(THREE);
  const c = out || COL;
  const kit = matSet && matSet.__kit;
  const v = kit ? kit[kitKey] : undefined;
  let got = false;
  if (typeof v === 'string' || typeof v === 'number') {
    try { c.set(v); got = true; } catch (e) { /* fall through */ }
  }
  if (!got) {
    const m = matSet && matSet[slot];
    if (m && m.color && !(m.color.r === 1 && m.color.g === 1 && m.color.b === 1)) {
      c.copy(m.color); got = true;
    }
  }
  if (!got) c.set(fallbackHex === undefined ? 0x9aa0aa : fallbackHex);
  return c.multiplyScalar(KIT_WEAR);
}

/**
 * uniform-kit's real materials are not the flat kit colour: the slot shader blends five
 * colour blocks through a detail map and then multiplies in grime and wet, all of which
 * land net-darker than block A. The imposter samples none of that, so it arrived a stop
 * hot next to its LOD2 partner — visible in shots/character-anatomy/iso_player_imposter.png,
 * where the imposter's pants read lighter than the same club's LOD2 pants at 22 m. This is
 * the one number here that is an EYEBALL MATCH against that capture, not a derivation, and
 * it is written down as such.
 */
const KIT_WEAR = 0.85;

/* ------------------------------------------------------------------ batch */

/**
 * Tear the per-pass batch down. Called at the start of every build pass, and on dispose.
 * The shared geometry and material outlive it on purpose — see above.
 */
export function resetBatch() {
  if (!batch) return;
  if (batch.mesh.parent) batch.mesh.parent.remove(batch.mesh);
  batch.mesh.dispose();
  batch = null;
}

/** Release the page-lifetime resources. Only a full teardown should call this. */
export function disposeShared() {
  resetBatch();
  for (const p of sharedByPose.values()) p.geometry.dispose();
  sharedByPose.clear();
  if (sharedMat) sharedMat.dispose();
  sharedMat = null;
}

/** The live batch, or null when this pass has no distant actors. */
export function currentBatch() { return batch; }

function sharedProxy(THREE, poseId) {
  const key = poseId || 'idle';
  const hit = sharedByPose.get(key);
  if (hit) return hit;
  const proxy = buildProxyGeometry(THREE, { pose: key });
  // Per-instance kit colours live on the geometry as instanced attributes. Exactly one
  // batch is live at a time, so one pair per geometry is enough; a new pass overwrites
  // the slots it uses and the rest are parked at zero scale.
  proxy.kitA = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
  proxy.kitB = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
  proxy.kitA.setUsage(THREE.DynamicDrawUsage);
  proxy.kitB.setUsage(THREE.DynamicDrawUsage);
  proxy.geometry.setAttribute('aKitA', proxy.kitA);
  proxy.geometry.setAttribute('aKitB', proxy.kitB);
  sharedByPose.set(key, proxy);
  return proxy;
}

/**
 * The instanced kit shader. Twenty lines on top of MeshStandardMaterial, so the imposter
 * still sits in the same lighting model as everything else — same lights, same tone map,
 * same environment — and still counts as ONE program.
 *
 *   aTint.x  value within the family      aTint.y  0 = jersey family, 1 = pants family
 *   aKitA    this instance's jersey colour (per instance)
 *   aKitB    this instance's pants colour  (per instance)
 *
 * `instanceColor` is deliberately NOT used: three.js's built-in gives one colour per
 * instance, and one colour is exactly what could not express a kit.
 */
function sharedMaterial(THREE) {
  if (sharedMat) return sharedMat;
  sharedMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.78, metalness: 0.02, dithering: true,
  });
  sharedMat.name = 'ca.imposter';
  sharedMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec2 aTint;
attribute vec3 aKitA;
attribute vec3 aKitB;
varying vec3 vKitCol;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vKitCol = mix( aKitA, aKitB, aTint.y ) * aTint.x;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vKitCol;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.rgb *= vKitCol;`);
  };
  sharedMat.customProgramCacheKey = () => 'ca.imposter.kit';
  return sharedMat;
}

function ensureBatch(THREE, ctx, pieceId, poseId) {
  if (batch) return batch;
  const proxy = sharedProxy(THREE, poseId);
  const material = sharedMaterial(THREE);

  const mesh = new THREE.InstancedMesh(proxy.geometry, material, CAPACITY);
  mesh.name = 'actor.imposterBatch';
  mesh.count = 0;
  mesh.frustumCulled = false;      // the batch spans the whole field; culling it is wrong
  mesh.castShadow = true;          // the runtime's shadow-caster cap decides, not us
  mesh.receiveShadow = true;
  mesh.userData.piece = pieceId;   // attribution: budget.mjs bills this to us by name
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  scratch(THREE);
  M4.makeScale(0, 0, 0);
  for (let i = 0; i < CAPACITY; i++) {
    mesh.setMatrixAt(i, M4);
    proxy.kitA.setXYZ(i, 0.55, 0.57, 0.61);
    proxy.kitB.setXYZ(i, 0.72, 0.74, 0.78);
  }
  mesh.instanceMatrix.needsUpdate = true;
  proxy.kitA.needsUpdate = true;
  proxy.kitB.needsUpdate = true;

  batch = {
    mesh, material, geometry: proxy.geometry,
    kitA: proxy.kitA, kitB: proxy.kitB,
    triangles: proxy.triangles, vertices: proxy.vertices,
    pose: proxy.pose, refHeight: proxy.heightM,
    roots: new Array(CAPACITY).fill(null),
    scaleX: new Float32Array(CAPACITY),
    scaleY: new Float32Array(CAPACITY),
    needsSync: false,
    /**
     * ONE-SHOT RE-SYNC, run from the first imposter's `update()`. The instance matrices
     * are composed at build time from the ShotSpec, which is the same data the assembler
     * uses to place `actor.root`, so they are already correct — this exists so that if
     * anything ever DOES move a root after the build (a future play-sim, a tool), the
     * batch corrects itself on the very next frame instead of silently drifting. It is a
     * boolean test per frame after that, and allocates nothing.
     */
    sync() {
      if (!this.needsSync) return false;
      this.needsSync = false;
      for (let i = 0; i < this.mesh.count; i++) {
        const root = this.roots[i];
        if (!root) continue;
        root.updateWorldMatrix(true, false);
        M4.copy(root.matrixWorld);
        VS.set(this.scaleX[i], this.scaleY[i], this.scaleX[i]);
        M4.scale(VS);
        this.mesh.setMatrixAt(i, M4);
      }
      this.mesh.instanceMatrix.needsUpdate = true;
      return true;
    },
  };
  if (ctx && ctx.scene) ctx.scene.add(mesh);
  return batch;
}

/* -------------------------------------------------------------- instances */

/**
 * Claim one instance for an actor. `spec` is the actor's ShotSpec entry — the same
 * `pos` / `rotY` / `scale` the world assembler is about to write onto `root`, which is
 * why the matrix can be composed here, at build time, and never touched again.
 *
 * Returns null if the batch is full, in which case the caller must fall back to a real
 * mesh rather than silently drop an actor.
 */
export function addInstance(THREE, ctx, pieceId, spec, root, opts) {
  // The pose of the FIRST imposter claimed this pass fixes the batch's baked pose. It is
  // the nearest one, because instances are claimed in distance order.
  const b = ensureBatch(THREE, ctx, pieceId, (spec && spec.pose) || 'idle');
  if (b.mesh.count >= CAPACITY) return null;
  const slot = b.mesh.count++;
  scratch(THREE);

  const P = PROPORTIONS[opts.archetype] || PROPORTIONS[PROXY_ARCHETYPE];
  const R = PROPORTIONS[PROXY_ARCHETYPE];
  // Height is exact. Girth is the ONE thing a shared geometry cannot express, so it comes
  // back as a per-instance width: a lineman really is ~23% broader than a receiver and at
  // imposter scale that ratio is the whole archetype read.
  const sy = (opts.heightM || P.heightM) / (b.refHeight || R.heightM);
  const wRef = R.shoulderWidth + R.limbGirth + R.hipWidth;
  const sx = sy * ((P.shoulderWidth + P.limbGirth + P.hipWidth) / wRef);

  b.roots[slot] = root;
  b.scaleX[slot] = sx;
  b.scaleY[slot] = sy;

  const s = spec && spec.scale !== undefined ? spec.scale : 1;
  const pos = (spec && spec.pos) || [0, 0, 0];
  VP.set(pos[0], pos[1], pos[2]);
  QT.setFromAxisAngle(AXIS, (spec && spec.rotY) || 0);
  VS.set(sx * s, sy * s, sx * s);
  M4.compose(VP, QT, VS);
  b.mesh.setMatrixAt(slot, M4);
  b.mesh.instanceMatrix.needsUpdate = true;
  b.needsSync = true;
  return { batch: b, slot };
}

/** Set one instance's jersey + pants colours. From `setMaterials`, never per frame. */
export function setInstanceKit(handle, jersey, pants) {
  if (!handle || !handle.batch || !handle.batch.kitA) return;
  const b = handle.batch;
  b.kitA.setXYZ(handle.slot, jersey.r, jersey.g, jersey.b);
  b.kitB.setXYZ(handle.slot, pants.r, pants.g, pants.b);
  b.kitA.needsUpdate = true;
  b.kitB.needsUpdate = true;
}

/** Swap the whole batch onto a different material (the ink/clay iso looks do this). */
export function setBatchMaterial(material) {
  if (batch && material) batch.mesh.material = material;
}

export default {
  addInstance, setInstanceKit, setBatchMaterial, resetBatch, disposeShared,
  currentBatch, kitColor, CAPACITY,
};
