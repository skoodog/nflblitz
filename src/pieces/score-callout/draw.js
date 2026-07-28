// PIECE: score-callout — the frame path.
//
// ZERO PER-FRAME ALLOCATION. `lockupFor()` builds a string cache key, so it is guarded
// by a primitive-compare memo; `animate()` writes into a module-level scratch object;
// the draw itself is a transform plus drawImage of an already-baked plate. Nothing in
// here rasterises a glyph, walks a path or makes an object.

import { lockupFor, GEO } from './lockup.js';
import { animate } from './anim.js';

const A = { alpha: 1, scale: 1, dx: 0, dy: 0, rot: 0, streak: 0, hot: 0 };
let mL1 = null, mL2 = null, mPts = -1, mAcc = null, mCol = null;
let mFaces = null, mScale = -1, mSeed = -1, mRas = -1, mLk = null;

function lockup(faces, state, scale, seed, raster) {
  const l1 = state.line1 || '', l2 = state.line2 || '', pts = state.pts | 0;
  const acc = state.accent || 'gold', col = state.line2Color || '';
  if (mLk && mL1 === l1 && mL2 === l2 && mPts === pts && mAcc === acc && mCol === col
    && mFaces === faces && mScale === scale && mSeed === seed && mRas === raster) return mLk;
  mLk = lockupFor(faces, state, { scale, seed, raster });
  mL1 = l1; mL2 = l2; mPts = pts; mAcc = acc; mCol = col;
  mFaces = faces; mScale = scale; mSeed = seed; mRas = raster;
  return mLk;
}

/**
 * drawLockup(c2d, faces, state, ax, ay, scale, seed, age)
 * `ax` is line-2's centre x; `ay` is the points line's baseline y.
 */
export function drawLockup(c2d, faces, state, ax, ay, scale, seed, ageOverride, raster) {
  const r = raster || 1;
  const lk = lockup(faces, state, scale, seed, r);
  if (!lk) return null;
  const age = ageOverride === undefined ? (state.age || 0) : ageOverride;
  animate(age, A);
  if (A.alpha <= 0.003) return lk;

  c2d.save();
  c2d.translate(ax + A.dx * scale, ay + A.dy * scale);
  c2d.rotate(GEO.rotation + A.rot);
  c2d.scale(A.scale / r, A.scale / r);

  // Motion streak: the same baked plate smeared back along the entry vector. Cheap,
  // and it is what sells the slam without a real motion-blur pass.
  if (A.streak > 0.02) {
    for (let i = 5; i >= 1; i--) {
      const f = i / 5;
      c2d.globalAlpha = A.alpha * A.streak * 0.22 * (1 - f * 0.70);
      c2d.drawImage(lk.cv, -lk.ox + f * 170 * A.streak * r, -lk.oy - f * 12 * A.streak * r);
    }
  }

  c2d.globalAlpha = A.alpha;
  c2d.drawImage(lk.cv, -lk.ox, -lk.oy);

  // Impact flash: one additive pass over the ink itself.
  if (A.hot > 0.02) {
    c2d.globalCompositeOperation = 'lighter';
    c2d.globalAlpha = A.alpha * A.hot * 0.55;
    c2d.drawImage(lk.cv, -lk.ox, -lk.oy);
    c2d.globalCompositeOperation = 'source-over';
  }
  c2d.restore();
  return lk;
}

export default { drawLockup };
