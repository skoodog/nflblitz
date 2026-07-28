// PIECE menu-title — the storm sky.
//
// The panel's sky is not a gradient with a texture on it: it is layered cloud
// with structure, lit from ONE place (the bolt, upper right) and dark
// everywhere else, with a red bloom pushed up from the neon below. So the
// clouds are generated as a density field — domain-warped fBm, twice, so the
// billows curl instead of reading as noise — and then SHADED by distance to
// the bolt CHANNEL rather than to a point, which is what makes the sky look
// volumetric instead of papered.
//
// Two layers come out of here:
//   base   opaque: sky gradient, the air glow around the channel, vignette
//   clouds RGBA, 8% oversized so it can drift sideways for free at runtime
//
// Both are baked once at `scale` and blitted. The field is band-limited, so a
// 1/3-resolution bake upscales with no visible cost and the bake touches ~230k
// pixels instead of 2.07M.

import { clamp, lerp, smoothstep, stopsInto, mkCanvas } from './geom.js';

/** Where the bolt lives, in logical coords — the sky is lit from here. */
export const BOLT_ORIGIN = [1487, 30];
export const BOLT_TIP = [1338, 344];

const SKY_STOPS = [
  [0.00, '#080714'], [0.10, '#0b0918'], [0.22, '#130d20'], [0.36, '#1c1230'],
  [0.52, '#241634'], [0.66, '#20142c'], [0.78, '#160f22'], [0.90, '#0c0a16'],
  [1.00, '#05050c'],
];

function segDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const wx = px - ax, wy = py - ay;
  const L = vx * vx + vy * vy || 1e-6;
  const t = clamp((wx * vx + wy * vy) / L, 0, 1);
  return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
}

/* ------------------------------------------------------------------- base */

export function bakeSkyBase(texlab, W, H, scale) {
  const cw = Math.max(160, Math.round(W * scale));
  const chh = Math.max(90, Math.round(H * scale));
  const o = mkCanvas(cw, chh);
  const c = o.ctx;
  c.save();
  c.scale(cw / W, chh / H);

  c.fillStyle = stopsInto(c.createLinearGradient(0, 0, 0, H), SKY_STOPS);
  c.fillRect(0, 0, W, H);

  // a slow lateral falloff so the base is never a flat band
  const side = c.createLinearGradient(0, 0, W, 0);
  side.addColorStop(0, 'rgba(3,2,8,0.42)');
  side.addColorStop(0.42, 'rgba(6,4,12,0.06)');
  side.addColorStop(0.70, 'rgba(26,16,40,0.10)');
  side.addColorStop(1, 'rgba(4,3,10,0.34)');
  c.fillStyle = side;
  c.fillRect(0, 0, W, H);

  // the air around the channel actually glowing — fixed to the bolt, so it
  // lives here and not on the drifting cloud layer
  c.globalCompositeOperation = 'lighter';
  const mx = (BOLT_ORIGIN[0] + BOLT_TIP[0]) * 0.5, my = (BOLT_ORIGIN[1] + BOLT_TIP[1]) * 0.5;
  const air = c.createRadialGradient(mx, my, 16, mx, my, 430);
  air.addColorStop(0, 'rgba(126,100,182,0.22)');
  air.addColorStop(0.30, 'rgba(92,70,140,0.10)');
  air.addColorStop(0.66, 'rgba(60,44,100,0.032)');
  air.addColorStop(1, 'rgba(40,30,80,0)');
  c.fillStyle = air;
  c.fillRect(0, 0, W, H);
  c.globalCompositeOperation = 'source-over';

  // vignette — cool, never pure black
  const vg = c.createRadialGradient(W * 0.5, H * 0.44, H * 0.20, W * 0.5, H * 0.48, H * 1.18);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(0.48, 'rgba(4,3,10,0.34)');
  vg.addColorStop(1, 'rgba(2,1,6,0.95)');
  c.fillStyle = vg;
  c.fillRect(0, 0, W, H);

  // deep band above the cloud deck
  c.fillStyle = stopsInto(c.createLinearGradient(0, 0, 0, H * 0.26), [
    [0, 'rgba(3,2,9,0.74)'], [0.55, 'rgba(4,3,11,0.24)'], [1, 'rgba(6,4,14,0)'],
  ]);
  c.fillRect(0, 0, W, H * 0.26);

  c.restore();
  return o.cv;
}

/* ----------------------------------------------------------------- clouds */

export const CLOUD_OVER = 0.08;

export function bakeClouds(texlab, W, H, scale) {
  const CW = W * (1 + CLOUD_OVER);
  const fw = Math.max(180, Math.round(clamp(scale * 2.2, 0.9, 2.0) * 300));
  const fh = Math.max(100, Math.round(fw * (H / CW)));
  const field = mkCanvas(fw, fh);

  const ar = CW / H;
  const bx = BOLT_ORIGIN[0] / CW, by = BOLT_ORIGIN[1] / H;
  const tx = BOLT_TIP[0] / CW, ty = BOLT_TIP[1] / H;

  texlab.fillPixels(field, (px, py, u, v) => {
    // Warp gently. A strong warp makes ribbons — ink in water, not weather.
    const wx = texlab.fbm2(u * 2.2 * ar, v * 2.2, { octaves: 3, seed: 11 });
    const wy = texlab.fbm2(u * 2.2 * ar + 5.2, v * 2.2 + 1.7, { octaves: 3, seed: 23 });
    const d1 = texlab.fbm2(u * 2.4 * ar + wx * 0.44, v * 1.7 + wy * 0.36,
      { octaves: 6, gain: 0.52, seed: 7 });
    const d2 = texlab.fbm2(u * 6.0 * ar + wx * 0.5 + 3.1, v * 4.2 + wy * 0.4,
      { octaves: 5, gain: 0.5, seed: 31 });

    const vmask = smoothstep(0.94, 0.38, v) * smoothstep(-0.03, 0.12, v);
    let dens = smoothstep(-0.14, 0.54, d1) * 0.92 + smoothstep(0.10, 0.66, d2) * 0.26;
    dens = clamp(dens, 0, 1) * vmask;
    if (dens <= 0.002) return [0, 0, 0, 0];

    const seg = segDist(u * ar, v, bx * ar, by, tx * ar, ty);
    const lit = Math.exp(-seg * 4.4) * 1.0 + Math.exp(-seg * 1.7) * 0.20;
    const nd = Math.hypot((u - 0.5) * ar * 0.85, (v - 0.40) * 1.25);
    const neon = Math.exp(-nd * 2.35) * 0.6;

    const kk = clamp(lit, 0, 1);
    let cr = lerp(0.112, 0.74, kk);
    let cg = lerp(0.080, 0.67, kk);
    let cb = lerp(0.172, 0.86, kk);
    // silver lining: thin cloud beside the channel goes hot
    const edge = dens * (1 - dens) * 4 * Math.exp(-seg * 4.4);
    cr += edge * 0.52; cg += edge * 0.46; cb += edge * 0.60;
    // warm underlight off the neon lockup
    cr += neon * 0.60; cg += neon * 0.13; cb += neon * 0.10;

    const a = clamp(dens * (0.30 + 0.92 * kk + neon * 0.45), 0, 1);
    return [clamp(cr, 0, 1), clamp(cg, 0, 1), clamp(cb, 0, 1), a];
  });

  const cw = Math.max(180, Math.round(CW * scale));
  const chh = Math.max(100, Math.round(H * scale));
  const out = mkCanvas(cw, chh);
  out.ctx.imageSmoothingEnabled = true;
  out.ctx.imageSmoothingQuality = 'high';
  out.ctx.drawImage(field.cv, 0, 0, cw, chh);
  return out.cv;
}

/** Fine grain tile — kills the banding a 12-stop gradient would otherwise show. */
export function bakeGrain(texlab, size = 192) {
  const o = mkCanvas(size, size);
  texlab.fillPixels(o, (px, py) => {
    const n = texlab.noise2(px * 1.71, py * 1.71, 991) * 0.5 + 0.5;
    const m = texlab.noise2(px * 0.41, py * 0.41, 17) * 0.5 + 0.5;
    const v = 0.5 + (n - 0.5) * 0.92 + (m - 0.5) * 0.22;
    return [v, v, v, 1];
  });
  return o.cv;
}

/** A one-column lavender veil, stretched across the frame on a flash. */
export function bakeFlashVeil(H) {
  const o = mkCanvas(4, 256);
  const g = o.ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0.00, 'rgba(168,146,224,0.85)');
  g.addColorStop(0.26, 'rgba(140,118,200,0.52)');
  g.addColorStop(0.58, 'rgba(96,78,150,0.20)');
  g.addColorStop(0.82, 'rgba(60,48,100,0.06)');
  g.addColorStop(1.00, 'rgba(40,32,72,0)');
  o.ctx.fillStyle = g;
  o.ctx.fillRect(0, 0, 4, 256);
  void H;
  return o.cv;
}

export default { bakeSkyBase, bakeClouds, bakeGrain, bakeFlashVeil, BOLT_ORIGIN, BOLT_TIP, CLOUD_OVER };
