// PIECE: score-callout — backdrops for this piece's OWN isolation scenes.
//
// These exist so a critic can pose the lockups without a neighbouring piece's
// half-built world masking them, and so the overlay-only capture is a complete image.
// They are never drawn on a hero scene: over `midair_hit` / `truck` the lockup sits on
// the real 3D frame like it does in the shipped game.
//
// Baked once per (variant, size) and blitted after that.

import { makeRng, hash } from '../../foundation/rng.js';
import { newCanvas } from './ink.js';

const CACHE = new Map();

function bokeh(g, rng, x, y, w, h, n, palette, rMin, rMax, alpha) {
  for (let i = 0; i < n; i++) {
    const cx = x + rng() * w;
    const cy = y + rng() * h;
    const r = rMin + rng() * rng() * (rMax - rMin);
    const c = palette[(rng() * palette.length) | 0];
    const a = alpha * (0.25 + rng() * 0.75);
    const rg = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    rg.addColorStop(0, `rgba(${c},${a})`);
    rg.addColorStop(0.55, `rgba(${c},${a * 0.55})`);
    rg.addColorStop(1, `rgba(${c},0)`);
    g.fillStyle = rg;
    g.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
}

function grain(g, rng, w, h, n, amt) {
  for (let i = 0; i < n; i++) {
    const x = rng() * w, y = rng() * h;
    const s = 1 + rng() * 1.6;
    g.fillStyle = rng() < 0.5
      ? `rgba(255,255,255,${amt * (0.2 + rng() * 0.8)})`
      : `rgba(0,0,0,${amt * (0.2 + rng() * 0.8)})`;
    g.fillRect(x, y, s, s);
  }
}

function paintNight(g, w, h, rng, warm) {
  // The value structure of the bar's night frames: near-black upper bowl, ONE hot
  // source high and off-centre, a mid-dark turf that never brightens past ~28% luma,
  // and everything falling off hard into the corners.
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0.00, '#04060a');
  sky.addColorStop(0.22, '#070a10');
  sky.addColorStop(0.40, '#0a0f13');
  sky.addColorStop(0.455, '#101a13');
  sky.addColorStop(0.60, '#16261a');
  sky.addColorStop(0.82, '#132015');
  sky.addColorStop(1.00, '#0a120c');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);

  // crowd: dense, small, low-contrast. A crowd is texture, not confetti.
  bokeh(g, rng, -w * 0.05, h * 0.03, w * 1.1, h * 0.36, 420,
    ['255,206,140', '188,206,238', '255,168,80', '140,168,208', '250,238,214'],
    w * 0.0022, w * 0.0105, 0.20);
  // a dark rail under the crowd so the bowl reads as architecture
  const rail = g.createLinearGradient(0, h * 0.33, 0, h * 0.45);
  rail.addColorStop(0, 'rgba(2,3,5,0)');
  rail.addColorStop(0.55, 'rgba(2,3,5,0.72)');
  rail.addColorStop(1, 'rgba(2,3,5,0.30)');
  g.fillStyle = rail;
  g.fillRect(0, h * 0.31, w, h * 0.16);

  // one stadium light + its bloom
  const lx = w * (warm ? 0.74 : 0.62), ly = h * 0.05;
  const bl = g.createRadialGradient(lx, ly, 0, lx, ly, w * 0.30);
  bl.addColorStop(0.00, 'rgba(255,246,224,0.55)');
  bl.addColorStop(0.14, 'rgba(255,232,182,0.20)');
  bl.addColorStop(0.44, 'rgba(255,214,150,0.055)');
  bl.addColorStop(1.00, 'rgba(255,210,140,0)');
  g.fillStyle = bl;
  g.fillRect(0, 0, w, h * 0.8);

  // turf
  g.save();
  g.beginPath();
  g.rect(0, h * 0.43, w, h * 0.57);
  g.clip();
  const vpX = w * 0.40, vpY = h * 0.24;
  for (let i = -9; i <= 15; i++) {
    const x0 = vpX + i * w * 0.070;
    const x1 = vpX + i * w * 0.285;
    g.fillStyle = (i & 1) ? 'rgba(190,225,175,0.026)' : 'rgba(0,6,0,0.075)';
    g.beginPath();
    g.moveTo(x0, vpY);
    g.lineTo(x0 + w * 0.052, vpY);
    g.lineTo(x1 + w * 0.21, h);
    g.lineTo(x1, h);
    g.closePath();
    g.fill();
  }
  // yard lines receding + hash marks
  for (let i = 0; i < 8; i++) {
    const f = i / 7;
    const y = vpY + (h - vpY) * (0.24 + f * f * 0.86);
    if (y > h * 1.05) break;
    const tt = (y - vpY) / (h - vpY);
    const slope = w * 0.055;
    const yAt = (a) => y + w * 0.02 - a * slope;
    g.strokeStyle = `rgba(212,222,206,${(0.06 + tt * 0.20).toFixed(3)})`;
    g.lineWidth = 1 + tt * 4.0;
    g.beginPath();
    g.moveTo(-w * 0.2, yAt(-0.2));
    g.lineTo(w * 1.2, yAt(1.2));
    g.stroke();
    // wear: a couple of scrubbed-out chunks per line, drawn as the turf, not as gaps
    for (let k = 0; k < 3; k++) {
      const a0 = -0.15 + rng() * 1.2;
      const a1 = a0 + 0.02 + rng() * 0.05;
      g.strokeStyle = `rgba(16,30,18,${(0.10 + tt * 0.22).toFixed(3)})`;
      g.lineWidth = (1 + tt * 4.0) * 1.3;
      g.beginPath();
      g.moveTo(w * a0, yAt(a0));
      g.lineTo(w * a1, yAt(a1));
      g.stroke();
    }
    // hash marks between the yard lines
    if (tt > 0.25) {
      for (let k = 0; k < 9; k++) {
        const a = -0.1 + (k / 8) * 1.2;
        g.strokeStyle = `rgba(206,216,200,${(0.04 + tt * 0.12).toFixed(3)})`;
        g.lineWidth = 1 + tt * 3.2;
        g.beginPath();
        g.moveTo(w * a, yAt(a) + h * 0.035 * tt);
        g.lineTo(w * (a + 0.012), yAt(a + 0.012) + h * 0.035 * tt);
        g.stroke();
      }
    }
  }
  // wet sheen, raking
  const wet = g.createLinearGradient(w * 0.75, h * 0.45, w * 0.25, h);
  wet.addColorStop(0, 'rgba(170,205,225,0.00)');
  wet.addColorStop(0.45, 'rgba(178,212,230,0.065)');
  wet.addColorStop(1, 'rgba(130,170,190,0.00)');
  g.fillStyle = wet;
  g.fillRect(0, h * 0.43, w, h * 0.57);
  // turf tooth — short, near-horizontal, low contrast. Vertical scratches read as rain.
  for (let i = 0; i < Math.round(w * 0.7); i++) {
    const x = rng() * w;
    const y = h * (0.44 + rng() * 0.56);
    const dep = (y / h - 0.44) / 0.56;
    const l = w * (0.0012 + rng() * 0.0032) * (0.4 + dep);
    g.strokeStyle = rng() < 0.5
      ? `rgba(158,196,138,${(0.012 + rng() * 0.030).toFixed(3)})`
      : `rgba(4,10,4,${(0.02 + rng() * 0.055).toFixed(3)})`;
    g.lineWidth = w * 0.0011;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + l * 2.2, y - l * 0.35);
    g.stroke();
  }
  g.restore();

  // the light's pool on the grass, plus its falloff — this is what stops the turf
  // reading as one flat plane of green
  g.save();
  g.beginPath();
  g.rect(0, h * 0.43, w, h * 0.57);
  g.clip();
  const pool = g.createRadialGradient(lx, h * 0.52, w * 0.03, lx, h * 0.62, w * 0.62);
  pool.addColorStop(0.00, 'rgba(206,232,178,0.115)');
  pool.addColorStop(0.34, 'rgba(176,208,150,0.055)');
  pool.addColorStop(1.00, 'rgba(120,160,110,0)');
  g.fillStyle = pool;
  g.fillRect(0, h * 0.43, w, h * 0.57);
  const fall = g.createLinearGradient(w, h * 0.5, 0, h);
  fall.addColorStop(0.00, 'rgba(0,4,2,0.00)');
  fall.addColorStop(0.52, 'rgba(0,4,2,0.16)');
  fall.addColorStop(1.00, 'rgba(0,4,2,0.46)');
  g.fillStyle = fall;
  g.fillRect(0, h * 0.43, w, h * 0.57);
  g.restore();
  // horizon glow where the bowl meets the grass
  const hz2 = g.createLinearGradient(0, h * 0.40, 0, h * 0.50);
  hz2.addColorStop(0, 'rgba(150,180,150,0)');
  hz2.addColorStop(0.5, 'rgba(160,190,155,0.055)');
  hz2.addColorStop(1, 'rgba(150,180,150,0)');
  g.fillStyle = hz2;
  g.fillRect(0, h * 0.40, w, h * 0.10);

  // out-of-focus foreground bodies, low and to the sides only — the middle stays clean
  g.save();
  g.filter = `blur(${(w * 0.016).toFixed(1)}px)`;
  for (let i = 0; i < 3; i++) {
    const side = i === 0 ? 0.05 : (i === 1 ? 0.20 : 0.93);
    const cx = w * (side + rng() * 0.06);
    const cy = h * (0.62 + rng() * 0.45);
    const rw = w * (0.045 + rng() * 0.055);
    const rh = h * (0.20 + rng() * 0.20);
    g.fillStyle = `rgba(5,7,6,${0.42 + rng() * 0.28})`;
    g.beginPath();
    g.ellipse(cx, cy, rw, rh, rng() * 0.5 - 0.25, 0, Math.PI * 2);
    g.fill();
  }
  g.filter = 'none';
  g.restore();

  // airborne turf debris, motion-smeared
  for (let i = 0; i < 46; i++) {
    const x = rng() * w, y = h * (0.34 + rng() * 0.5);
    const s = w * (0.0009 + rng() * rng() * 0.0035);
    g.fillStyle = `rgba(${22 + rng() * 26 | 0},${20 + rng() * 22 | 0},${14 + rng() * 14 | 0},${0.20 + rng() * 0.45})`;
    g.save();
    g.translate(x, y);
    g.rotate(rng() * 3.14);
    g.fillRect(-s, -s * 0.4, s * 3.0, s * 0.8);
    g.restore();
  }
}

function paintBright(g, w, h, rng) {
  const bg = g.createLinearGradient(0, 0, w * 0.4, h);
  bg.addColorStop(0.00, '#fff6dc');
  bg.addColorStop(0.42, '#f4e2ac');
  bg.addColorStop(0.72, '#e9dfc6');
  bg.addColorStop(1.00, '#cfd6c4');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  bokeh(g, rng, 0, 0, w, h, 90, ['255,255,255', '255,240,190'], w * 0.01, w * 0.05, 0.30);
  for (let i = 0; i < 5; i++) {
    g.fillStyle = `rgba(255,255,255,${0.10 + rng() * 0.12})`;
    g.fillRect(0, h * rng(), w, h * 0.06);
  }
}

function paintCrowd(g, w, h, rng) {
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0.00, '#2a0f3a');
  bg.addColorStop(0.45, '#4a1550');
  bg.addColorStop(0.75, '#7a1f4a');
  bg.addColorStop(1.00, '#3a1030');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  bokeh(g, rng, 0, 0, w, h, 320,
    ['255,120,220', '160,120,255', '255,220,120', '255,255,255', '120,220,255'],
    w * 0.005, w * 0.030, 0.42);
}

function paintGrey(g, w, h, rng) {
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#8f9298');
  bg.addColorStop(0.5, '#787b81');
  bg.addColorStop(1, '#63666c');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  grain(g, rng, w, h, 2600, 0.05);
}

/** A baked backdrop tile. `variant` = night | nightWarm | bright | crowd | grey. */
export function backdrop(variant, w, h, seed) {
  const W = Math.ceil(w), H = Math.ceil(h);
  const key = `${variant}|${W}|${H}|${seed | 0}`;
  let cv = CACHE.get(key);
  if (cv) return cv;
  cv = newCanvas(W, H);
  const g = cv.getContext('2d');
  const rng = makeRng(hash(0x5c0, W, H, seed | 0, variant.length * 977));
  if (variant === 'bright') paintBright(g, W, H, rng);
  else if (variant === 'crowd') paintCrowd(g, W, H, rng);
  else if (variant === 'grey') paintGrey(g, W, H, rng);
  else paintNight(g, W, H, rng, variant === 'nightWarm');

  // common: haze, vignette, grain
  const hz = g.createLinearGradient(0, 0, 0, H);
  hz.addColorStop(0, 'rgba(120,140,160,0.05)');
  hz.addColorStop(0.5, 'rgba(120,140,160,0.02)');
  hz.addColorStop(1, 'rgba(120,140,160,0.00)');
  g.fillStyle = hz;
  g.fillRect(0, 0, W, H);
  const vg = g.createRadialGradient(W * 0.5, H * 0.46, Math.min(W, H) * 0.25, W * 0.5, H * 0.5, Math.max(W, H) * 0.78);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(0.62, 'rgba(0,0,0,0.20)');
  vg.addColorStop(1, 'rgba(0,0,0,0.62)');
  g.fillStyle = vg;
  g.fillRect(0, 0, W, H);
  grain(g, rng, W, H, Math.round(W * H * 0.0016), 0.055);

  CACHE.set(key, cv);
  return cv;
}

export default { backdrop };
