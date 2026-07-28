// PIECE menu-title — the night skyline.
//
// Three depth layers with real atmospheric separation: the far layer is a
// hazed violet, the mid layer sits a stop darker, the near layer is almost
// black, and each is pushed back with its own horizon haze so the city has
// depth instead of being one silhouette with dots on it. Roughly two thousand
// windows are placed from a seeded rng in warm, pale, cool and one green
// tenancy, with occasional fully-lit floors, and the whole window pass gets a
// real bloom (down-sample, blit back additively) so the lit windows scatter in
// the haze the way they do in the art. Two construction cranes and a set of
// antenna beacons ride the tall towers.

import { makeRng } from '../../foundation/rng.js';
import { clamp, lerp, rgbCss, stopsInto, mkCanvas } from './geom.js';

export const RECT = { x: 0, y: 520, w: 1920, h: 560 };

const LAYERS = [
  { // far — hazed, violet, low contrast
    n: 40, base: 896, minH: 70, maxH: 196, minW: 28, maxW: 82,
    body: '#1b1528', edge: '#221b32', lit: 0.20, cell: [6, 8], win: [2, 3],
    winA: 0.34, seed: 101, heroes: [0.20, 0.62], haze: 0.66, hero: 1.34,
  },
  { // mid
    n: 30, base: 972, minH: 104, maxH: 262, minW: 40, maxW: 112,
    body: '#0d0a15', edge: '#141020', lit: 0.22, cell: [9, 11], win: [3, 4],
    winA: 0.56, seed: 202, heroes: [0.085, 0.79, 0.93], haze: 0.36, hero: 1.44,
  },
  { // near — near black
    n: 20, base: 1120, minH: 118, maxH: 300, minW: 58, maxW: 158,
    body: '#040409', edge: '#08070e', lit: 0.16, cell: [12, 15], win: [4, 5],
    winA: 0.86, seed: 303, heroes: [0.055, 0.15, 0.845, 0.935], haze: 0.09, hero: 1.62,
  },
];

const WIN_COLS = [
  [0.60, '#ffc463'], [0.78, '#ffb03e'], [0.90, '#ffe6bb'],
  [0.965, '#a8c6dd'], [1.00, '#7fd6a2'],
];

function winColour(r) {
  for (const w of WIN_COLS) if (r <= w[0]) return w[1];
  return '#ffc463';
}

function buildings(L, W) {
  const rng = makeRng(L.seed);
  const out = [];
  let x = -40;
  for (let i = 0; i < L.n && x < W + 40; i++) {
    const w = L.minW + rng() * (L.maxW - L.minW);
    let h = L.minH + Math.pow(rng(), 1.55) * (L.maxH - L.minH);
    if (rng() < 0.14) h *= 1.28;                 // scattered taller blocks
    const cx = (x + w / 2) / W;
    for (const hx of L.heroes) if (Math.abs(cx - hx) < 0.06) h *= (L.hero || 1.3);
    const b = {
      x, w, h, top: L.base - h,
      setback: rng() < 0.30 ? 0.45 + rng() * 0.3 : 0,
      spire: rng() < 0.16,
      // a quarter of the city is simply dark, and the lit ones vary wildly in
      // occupancy — an even sprinkle over every facade is the giveaway
      litK: rng() < 0.24 ? 0 : (0.35 + rng() * 1.5),
      phase: rng(),
      tank: rng() < 0.14,
      mast: rng() < 0.22,
      beacon: h > (L.maxH * 0.78),
      seed: (L.seed * 977 + i * 131) | 0,
    };
    out.push(b);
    x += w * (0.86 + rng() * 0.34);
  }
  return out;
}

function bodyPath(c, b) {
  c.beginPath();
  if (b.setback) {
    const sw = b.w * b.setback, sx = b.x + (b.w - sw) * (0.5 + 0.2);
    const sh = b.h * (0.22 + b.setback * 0.16);
    c.moveTo(b.x, b.top + sh);
    c.lineTo(sx, b.top + sh);
    c.lineTo(sx, b.top);
    c.lineTo(sx + sw, b.top);
    c.lineTo(sx + sw, b.top + sh);
    c.lineTo(b.x + b.w, b.top + sh);
    c.lineTo(b.x + b.w, b.top + b.h + 40);
    c.lineTo(b.x, b.top + b.h + 40);
  } else {
    c.rect(b.x, b.top, b.w, b.h + 40);
  }
  c.closePath();
}

function drawCrane(c, x, baseY, h, flip, col) {
  const s = flip ? -1 : 1;
  c.save();
  c.translate(x, baseY);
  c.scale(s, 1);
  c.fillStyle = col;
  c.fillRect(-5, -h, 10, h);
  for (let y = -h + 12; y < -6; y += 22) {
    c.fillRect(-5, y, 10, 2.5);
  }
  c.fillRect(-96, -h - 12, 240, 8);          // jib
  c.fillRect(-96, -h - 12, 6, 16);
  c.fillRect(-18, -h - 34, 34, 24);          // cab / a-frame
  c.beginPath();
  c.moveTo(-2, -h - 34); c.lineTo(120, -h - 12); c.lineTo(-2, -h - 12);
  c.closePath(); c.fill();
  c.fillRect(96, -h + 4, 3, 18);             // hook line
  c.restore();
}

/**
 * bakeCity(texlab, W, H, scale) -> canvas with alpha, covering RECT.
 */
export function bakeCity(W, H, scale) {
  const cw = Math.max(120, Math.round(RECT.w * scale));
  const chh = Math.max(80, Math.round(RECT.h * scale));
  const out = mkCanvas(cw, chh);
  const c = out.ctx;
  const k = cw / RECT.w;

  // window pass goes to its own surface so it can bloom
  const win = mkCanvas(cw, chh);
  const wc = win.ctx;

  c.save(); c.scale(k, k); c.translate(0, -RECT.y);
  wc.save(); wc.scale(k, k); wc.translate(0, -RECT.y);

  for (let li = 0; li < LAYERS.length; li++) {
    const L = LAYERS[li];
    const bs = buildings(L, W);

    for (const b of bs) {
      const rng = makeRng(b.seed);
      // body
      c.fillStyle = stopsInto(c.createLinearGradient(0, b.top, 0, L.base), [
        [0, L.edge], [0.55, L.body], [1, L.body],
      ]);
      bodyPath(c, b);
      c.fill();
      // a faint lit edge on the side facing the lockup
      c.fillStyle = `rgba(150,120,170,${(0.05 + li * 0.02).toFixed(3)})`;
      c.fillRect(b.x + (b.x + b.w / 2 < W / 2 ? b.w - 2.5 : 0), b.top, 2.5, b.h);

      // roof furniture
      if (b.spire) {
        c.fillStyle = L.body;
        c.beginPath();
        c.moveTo(b.x + b.w * 0.5, b.top - b.h * 0.30);
        c.lineTo(b.x + b.w * 0.5 + 5, b.top);
        c.lineTo(b.x + b.w * 0.5 - 5, b.top);
        c.closePath(); c.fill();
      }
      if (b.mast) {
        c.fillStyle = L.body;
        c.fillRect(b.x + b.w * 0.72, b.top - 26 - rng() * 24, 2.6, 30);
      }
      if (b.tank) {
        c.fillStyle = L.body;
        c.fillRect(b.x + b.w * 0.18, b.top - 16, b.w * 0.22, 16);
        c.fillRect(b.x + b.w * 0.20, b.top - 22, b.w * 0.18, 6);
      }

      // windows
      const [cwd, chd] = L.cell, [ww, wh] = L.win;
      const mx = Math.max(5, cwd * 0.5);
      const cols = Math.floor((b.w - mx * 2) / cwd);
      const rows = Math.floor((b.h - chd) / chd);
      if (cols < 1 || rows < 1 || b.litK <= 0) continue;
      const ox = b.x + (b.w - cols * cwd) / 2;
      for (let r = 0; r < rows; r++) {
        const floorLit = rng() < 0.05;
        for (let q = 0; q < cols; q++) {
          const v = rng();
          if (!floorLit && v > L.lit * b.litK) continue;
          const y = b.top + chd * (r + 0.55 + b.phase * 0.4);
          if (b.setback) {
            const sw = b.w * b.setback, sx = b.x + (b.w - sw) * 0.7;
            const sh = b.h * (0.22 + b.setback * 0.16);
            const x0 = ox + q * cwd;
            if (y < b.top + sh && (x0 < sx || x0 + ww > sx + sw)) continue;
          }
          const col = winColour(rng());
          const a = L.winA * (0.55 + rng() * 0.45) * (floorLit ? 0.85 : 1);
          wc.globalAlpha = clamp(a, 0, 1);
          wc.fillStyle = col;
          wc.fillRect(ox + q * cwd, y, ww, wh);
        }
      }
      // beacon
      if (b.beacon) {
        wc.globalAlpha = 0.9;
        wc.fillStyle = '#ff5a4a';
        const bx = b.x + b.w * (b.mast ? 0.72 : 0.5), by = b.top - (b.mast ? 24 : 4);
        wc.fillRect(bx - 1.6, by, 3.2, 3.2);
      }
    }

    // cranes ride the mid layer, left of frame, as in the art
    if (li === 1) {
      drawCrane(c, W * 0.055, L.base, 208, false, L.body);
      drawCrane(c, W * 0.145, L.base, 158, true, L.body);
      wc.globalAlpha = 0.85; wc.fillStyle = '#ff5a4a';
      wc.fillRect(W * 0.055 - 1.6, L.base - 232, 3.2, 3.2);
      wc.fillRect(W * 0.145 - 1.6, L.base - 182, 3.2, 3.2);
    }

    // atmospheric haze over the layer just drawn. source-atop: air in front of
    // the buildings, never a translucent slab painted across the open sky.
    c.save();
    c.globalCompositeOperation = 'source-atop';
    c.fillStyle = stopsInto(c.createLinearGradient(0, L.base - L.maxH * 1.7, 0, L.base + 30), [
      [0, `rgba(64,46,86,${(L.haze * 0.30).toFixed(3)})`],
      [0.45, `rgba(52,36,70,${(L.haze * 0.44).toFixed(3)})`],
      [1, `rgba(26,18,38,${(L.haze * 0.62).toFixed(3)})`],
    ]);
    c.fillRect(0, L.base - L.maxH * 1.7, W, L.maxH * 1.7 + 30);
    c.restore();
  }

  wc.globalAlpha = 1;
  wc.restore();
  c.restore();

  // bloom: down-sample the window pass and blit it back additively
  const bw = Math.max(24, Math.round(cw / 6)), bh = Math.max(16, Math.round(chh / 6));
  const small = mkCanvas(bw, bh);
  small.ctx.imageSmoothingEnabled = true;
  small.ctx.drawImage(win.cv, 0, 0, bw, bh);
  c.save();
  c.globalCompositeOperation = 'lighter';
  c.globalAlpha = 0.30;
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = 'high';
  c.drawImage(small.cv, 0, 0, cw, chh);
  c.globalAlpha = 1;
  c.drawImage(win.cv, 0, 0);
  c.restore();

  // neon spill from the lockup onto the rooftops
  c.save();
  c.globalCompositeOperation = 'source-atop';
  c.scale(k, k); c.translate(0, -RECT.y);
  const spill = c.createRadialGradient(W * 0.5, 680, 30, W * 0.5, 680, 720);
  spill.addColorStop(0, 'rgba(186,48,26,0.165)');
  spill.addColorStop(0.42, 'rgba(140,26,18,0.07)');
  spill.addColorStop(1, 'rgba(90,14,20,0)');
  c.fillStyle = spill;
  c.fillRect(0, RECT.y, W, RECT.h);
  c.restore();

  // foreground: the black bank the panel has across the bottom, with a hint of
  // water catching the city above it
  c.save();
  c.scale(k, k); c.translate(0, -RECT.y);
  c.globalCompositeOperation = 'source-atop';
  c.fillStyle = stopsInto(c.createLinearGradient(0, 952, 0, 1080), [
    [0, 'rgba(2,2,7,0)'], [0.34, 'rgba(2,2,6,0.66)'], [0.62, 'rgba(1,1,4,0.96)'], [1, '#000103'],
  ]);
  c.fillRect(0, 946, W, 134);
  c.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 22; i++) {
    const r = makeRng(7000 + i);
    const x = r() * W, w2 = 10 + r() * 46;
    c.fillStyle = rgbCss(120, 70, 30, 0.05 + r() * 0.05);
    c.fillRect(x, 992, w2, 8 + r() * 26);
  }
  c.restore();

  // one last push back: the panel's city is a silhouette, not a light source
  c.save();
  c.globalCompositeOperation = 'source-atop';
  c.scale(k, k); c.translate(0, -RECT.y);
  c.fillStyle = stopsInto(c.createLinearGradient(0, RECT.y, 0, 1080), [
    [0, 'rgba(6,4,12,0.34)'], [0.34, 'rgba(4,3,9,0.22)'], [1, 'rgba(2,1,5,0.30)'],
  ]);
  c.fillRect(0, RECT.y, W, RECT.h);
  c.restore();

  void lerp;
  return out.cv;
}

export default { bakeCity, RECT };
