// PIECE brand-identity — layered city skylines.
//
// Three depth layers per city with real atmospheric perspective: the far layer is
// desaturated toward the sky and hazy, the near layer is near-black. Every tower
// carries lit windows (irregular, clustered, warm), roof plant, spires, aviation
// beacons and a few setbacks, so the silhouette never reads as a bar chart.

import { makeRng, hash01 } from '../../foundation/rng.js';
import { lin, rgba, mix, darken, lighten } from './gfx.js';

/* Signature towers, placed at a fixed fraction of the band so a city is
   recognisable rather than generically urban. */
const CITY = {
  NYC: {
    sky: '#3a2a48',
    marks: [
      [0.16, 'setback', 0.62, 0.052],
      [0.27, 'deco', 0.96, 0.062],
      [0.38, 'box', 0.58, 0.05],
      [0.47, 'spire', 1.0, 0.044],
      [0.58, 'setback', 0.72, 0.058],
      [0.70, 'box', 0.64, 0.062],
      [0.82, 'twin', 0.80, 0.05],
    ],
  },
  CHI: {
    sky: '#2c2f4a',
    marks: [
      [0.18, 'box', 0.60, 0.06],
      [0.30, 'twin', 1.0, 0.058],
      [0.42, 'deco', 0.76, 0.05],
      [0.53, 'setback', 0.88, 0.066],
      [0.66, 'box', 0.62, 0.056],
      [0.79, 'spire', 0.72, 0.04],
    ],
  },
  DAL: {
    sky: '#3d2b34',
    marks: [
      [0.20, 'box', 0.54, 0.058],
      [0.32, 'ball', 0.82, 0.03],
      [0.44, 'pyramid', 0.96, 0.062],
      [0.58, 'box', 0.66, 0.07],
      [0.72, 'setback', 0.74, 0.052],
      [0.84, 'spire', 0.6, 0.036],
    ],
  },
  LA: {
    sky: '#42304a',
    marks: [
      [0.18, 'box', 0.5, 0.062],
      [0.30, 'cyl', 0.7, 0.046],
      [0.42, 'box', 0.92, 0.068],
      [0.54, 'cyl', 0.64, 0.042],
      [0.66, 'setback', 0.78, 0.058],
      [0.80, 'box', 0.56, 0.066],
    ],
  },
  SEA: { sky: '#233a44', marks: [[0.24, 'box', 0.6, 0.06], [0.38, 'spire', 1.0, 0.03], [0.52, 'box', 0.72, 0.064], [0.68, 'setback', 0.66, 0.056], [0.82, 'box', 0.5, 0.05]] },
  MIA: { sky: '#3a2450', marks: [[0.2, 'cyl', 0.62, 0.05], [0.34, 'box', 0.86, 0.06], [0.5, 'cyl', 0.7, 0.046], [0.66, 'box', 0.58, 0.064], [0.8, 'setback', 0.66, 0.052]] },
  BAL: { sky: '#28254a', marks: [[0.22, 'box', 0.56, 0.06], [0.36, 'deco', 0.84, 0.052], [0.52, 'box', 0.7, 0.066], [0.68, 'spire', 0.62, 0.034], [0.82, 'setback', 0.6, 0.056]] },
  PHI: { sky: '#22322c', marks: [[0.2, 'setback', 0.64, 0.058], [0.34, 'spire', 0.94, 0.05], [0.5, 'box', 0.76, 0.062], [0.66, 'deco', 0.68, 0.05], [0.82, 'box', 0.54, 0.058]] },
};

function winGrid(c, x, y, w, h, seed, warm, density, cellW, cellH) {
  const cols = Math.max(1, Math.floor(w / cellW));
  const rows = Math.max(1, Math.floor(h / cellH));
  const gw = w / cols, gh = h / rows;
  const ww = Math.max(0.8, gw * 0.42), wh = Math.max(0.8, gh * 0.44);
  for (let r = 0; r < rows; r++) {
    const floorLit = hash01(seed, r, 3) < 0.10;
    for (let k = 0; k < cols; k++) {
      const v = hash01(seed + k * 31, r * 17, 7);
      if (!floorLit && v > density) continue;
      const bright = v * 0.55 + (floorLit ? 0.45 : 0.1);
      c.fillStyle = rgba(warm, Math.min(0.95, 0.18 + bright * 0.8));
      c.fillRect(x + k * gw + (gw - ww) / 2, y + r * gh + (gh - wh) / 2, ww, wh);
    }
  }
}

function tower(c, kind, x, w, top, ground, fill, seed, opts) {
  const h = ground - top;
  const rng = makeRng(seed);
  c.fillStyle = fill;

  if (kind === 'setback') {
    const s1 = h * 0.55, s2 = h * 0.8;
    c.fillRect(x, ground - s1, w, s1);
    c.fillRect(x + w * 0.12, ground - s2, w * 0.76, s2);
    c.fillRect(x + w * 0.28, top, w * 0.44, h);
    if (opts.windows) {
      winGrid(c, x + 2, ground - s1 + 3, w - 4, s1 - 6, seed, opts.warm, opts.density, opts.cw, opts.ch);
      winGrid(c, x + w * 0.3, top + 4, w * 0.4, h - s2 + 10, seed + 9, opts.warm, opts.density * 0.8, opts.cw, opts.ch);
    }
  } else if (kind === 'deco') {
    c.fillRect(x, ground - h * 0.72, w, h * 0.72);
    c.beginPath();
    c.moveTo(x + w * 0.18, ground - h * 0.7);
    c.lineTo(x + w * 0.5, top + h * 0.02);
    c.lineTo(x + w * 0.82, ground - h * 0.7);
    c.closePath(); c.fill();
    c.fillRect(x + w * 0.46, top - h * 0.12, w * 0.08, h * 0.16);
    if (opts.windows) winGrid(c, x + 2, ground - h * 0.7 + 3, w - 4, h * 0.68, seed, opts.warm, opts.density, opts.cw, opts.ch);
  } else if (kind === 'spire') {
    c.fillRect(x, ground - h * 0.62, w, h * 0.62);
    c.beginPath();
    c.moveTo(x + w * 0.24, ground - h * 0.6);
    c.lineTo(x + w * 0.5, top + h * 0.10);
    c.lineTo(x + w * 0.76, ground - h * 0.6);
    c.closePath(); c.fill();
    c.fillRect(x + w * 0.47, top, w * 0.06, h * 0.14);
    if (opts.windows) winGrid(c, x + 2, ground - h * 0.6 + 3, w - 4, h * 0.58, seed, opts.warm, opts.density, opts.cw, opts.ch);
  } else if (kind === 'twin') {
    c.fillRect(x, ground - h * 0.78, w, h * 0.78);
    c.fillRect(x + w * 0.2, top + h * 0.06, w * 0.6, h);
    c.fillRect(x + w * 0.3, top, w * 0.035, h * 0.1);
    c.fillRect(x + w * 0.66, top, w * 0.035, h * 0.1);
    if (opts.windows) {
      winGrid(c, x + 2, ground - h * 0.76, w - 4, h * 0.74, seed, opts.warm, opts.density, opts.cw, opts.ch);
      winGrid(c, x + w * 0.22, top + h * 0.08, w * 0.56, h * 0.24, seed + 5, opts.warm, opts.density * 0.7, opts.cw, opts.ch);
    }
  } else if (kind === 'ball') {
    c.fillRect(x + w * 0.36, ground - h, w * 0.28, h);
    c.beginPath();
    c.arc(x + w * 0.5, top + w * 0.62, w * 0.62, 0, Math.PI * 2);
    c.fill();
    if (opts.windows) {
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        c.fillStyle = rgba(opts.warm, 0.35 + hash01(seed, i, 2) * 0.5);
        c.fillRect(x + w * 0.5 + Math.cos(a) * w * 0.44 - 1, top + w * 0.62 + Math.sin(a) * w * 0.44 - 1, 2.2, 2.2);
      }
    }
  } else if (kind === 'pyramid') {
    c.fillRect(x, ground - h * 0.74, w, h * 0.74);
    c.beginPath();
    c.moveTo(x, ground - h * 0.72);
    c.lineTo(x + w * 0.5, top);
    c.lineTo(x + w, ground - h * 0.72);
    c.closePath(); c.fill();
    if (opts.windows) winGrid(c, x + 2, ground - h * 0.72 + 3, w - 4, h * 0.7, seed, opts.warm, opts.density, opts.cw, opts.ch);
  } else if (kind === 'cyl') {
    c.beginPath();
    c.moveTo(x, ground);
    c.lineTo(x, top + w * 0.3);
    c.quadraticCurveTo(x + w * 0.5, top - w * 0.16, x + w, top + w * 0.3);
    c.lineTo(x + w, ground);
    c.closePath(); c.fill();
    if (opts.windows) winGrid(c, x + 2, top + w * 0.4, w - 4, h - w * 0.4, seed, opts.warm, opts.density, opts.cw, opts.ch);
  } else {
    c.fillRect(x, top, w, h);
    // roof plant
    c.fillRect(x + w * 0.2, top - h * 0.03, w * 0.2, h * 0.035);
    c.fillRect(x + w * 0.62, top - h * 0.05, w * 0.06, h * 0.055);
    if (opts.windows) winGrid(c, x + 2, top + 3, w - 4, h - 6, seed, opts.warm, opts.density, opts.cw, opts.ch);
  }
  return rng;
}

/**
 * skyline(c2d, cityId, box, opts)
 *   opts.fill      base colour of the NEAR layer (the foundation fallback passes one)
 *   opts.sky       horizon colour used for atmospheric perspective
 *   opts.layers    1..3 (default 3)
 *   opts.windows   default true
 *   opts.haze      0..1 horizon glow (default 0.55)
 */
export function skyline(c2d, cityId, box, opts = {}) {
  const { x, y, w, h } = box;
  const id = String(cityId || 'NYC').toUpperCase();
  const cfg = CITY[id] || CITY.NYC;
  const near = opts.fill || '#0a0a0f';
  const sky = opts.sky || cfg.sky;
  const warm = opts.warm || '#ffca6a';
  const layers = opts.layers === undefined ? 3 : opts.layers;
  const windows = opts.windows !== false;
  const ground = y + h;

  c2d.save();
  c2d.beginPath();
  c2d.rect(x, y, w, h);
  c2d.clip();

  // horizon haze so the far layer has something to sit in
  if (opts.haze !== 0) {
    const a = opts.haze === undefined ? 0.55 : opts.haze;
    c2d.fillStyle = lin(c2d, x, y, x, ground, [
      [0, rgba(sky, 0)],
      [0.55, rgba(sky, 0.28 * a)],
      [0.86, rgba(sky, 0.62 * a)],
      [1, rgba(sky, 0.1 * a)],
    ]);
    c2d.fillRect(x, y, w, h);
  }

  const L_CW = 10, L_CH = 13;
  const depth = [
    { t: 0.70, hs: 0.56, dy: 0.02, cw: 6, ch: 8, dens: 0.26, haze: 0.34 },
    { t: 0.38, hs: 0.80, dy: 0.0, cw: 8, ch: 10, dens: 0.32, haze: 0.18 },
    { t: 0.05, hs: 1.0, dy: -0.02, cw: 10, ch: 13, dens: 0.30, haze: 0 },
  ].slice(3 - layers);

  depth.forEach((L, li) => {
    const fill = mix(near, sky, L.t);
    const seedBase = 900 + li * 137 + id.charCodeAt(0) * 11;
    const rng = makeRng(seedBase);
    const gy = ground + h * L.dy;

    // filler blocks across the whole band
    let bx = x - w * 0.03;
    let i = 0;
    while (bx < x + w * 1.03) {
      const bw = w * (0.020 + rng() * 0.030);
      const bh = h * L.hs * (0.16 + rng() * 0.5);
      const kind = rng() < 0.13 ? 'setback' : 'box';
      tower(c2d, kind, bx, bw - w * 0.003, gy - bh, gy, fill, seedBase + i * 29, {
        windows: windows && li >= 1, warm, density: L.dens * (0.5 + L.t * 0.2), cw: L.cw, ch: L.ch,
      });
      bx += bw;
      i++;
    }

    // signature towers only on the two nearer layers
    if (li >= 1) {
      for (let k = 0; k < cfg.marks.length; k++) {
        const [fx, kind, hf, wf] = cfg.marks[k];
        const jitter = li === 1 ? -0.035 : 0.0;
        const bw = w * wf * (li === 1 ? 0.8 : 1);
        const bx2 = x + w * (fx + jitter) - bw / 2;
        const bh = h * L.hs * hf * (li === 1 ? 0.82 : 1);
        tower(c2d, kind, bx2, bw, gy - bh, gy, fill, seedBase + k * 71 + 3, {
          windows, warm, density: L.dens, cw: L.cw, ch: L.ch,
        });
      }
    }

    // atmospheric wash between depth slices — this is what makes the layers read
    if (L.haze) {
      c2d.fillStyle = lin(c2d, x, y, x, ground, [
        [0, rgba(sky, L.haze * 0.5)],
        [0.55, rgba(sky, L.haze)],
        [1, rgba(sky, L.haze * 1.25)],
      ]);
      c2d.fillRect(x, y, w, h);
    }
  });

  // near-black foreground row — the layer the bar art puts closest to camera
  if (layers >= 3) {
    const frng = makeRng(7700 + id.charCodeAt(0));
    let fx = x - w * 0.04;
    let fi = 0;
    while (fx < x + w * 1.04) {
      const bw = w * (0.026 + frng() * 0.05);
      const bh = h * (0.10 + frng() * 0.26);
      c2d.fillStyle = '#04050a';
      c2d.fillRect(fx, ground - bh, bw - w * 0.002, bh + 4);
      if (frng() < 0.35) c2d.fillRect(fx + bw * 0.3, ground - bh - h * 0.05, w * 0.004, h * 0.05);
      if (windows) {
        winGrid(c2d, fx + 3, ground - bh + 5, bw - 8, bh - 10, 7700 + fi * 41, warm, 0.14, L_CW, L_CH);
      }
      fx += bw;
      fi++;
    }
    c2d.fillStyle = '#030408';
    c2d.fillRect(x, ground - 2, w, h * 0.06 + 4);
  }

  // aviation beacons — small, sparse, only up in the tower band
  const brng = makeRng(4141 + id.charCodeAt(0));
  for (let i = 0; i < 5; i++) {
    const bx = x + w * (0.08 + brng() * 0.84);
    const by = ground - h * (0.5 + brng() * 0.42);
    const r = Math.max(0.9, h * 0.0035);
    c2d.fillStyle = 'rgba(255,80,64,0.16)';
    c2d.beginPath(); c2d.arc(bx, by, r * 3.4, 0, Math.PI * 2); c2d.fill();
    c2d.fillStyle = 'rgba(255,120,96,0.9)';
    c2d.beginPath(); c2d.arc(bx, by, r, 0, Math.PI * 2); c2d.fill();
  }

  // ground darkening so the city sits into the frame
  c2d.fillStyle = lin(c2d, x, ground - h * 0.32, x, ground, [
    [0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.72)'],
  ]);
  c2d.fillRect(x, ground - h * 0.32, w, h * 0.32);

  c2d.restore();
  return box;
}

export const CITY_IDS = Object.keys(CITY);
export default { skyline, CITY_IDS };
