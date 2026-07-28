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
  // sky / upper bowl
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0.00, '#080a10');
  sky.addColorStop(0.24, '#0d1119');
  sky.addColorStop(0.40, '#12181c');
  sky.addColorStop(0.46, '#1b2a1e');
  sky.addColorStop(0.68, '#20321f');
  sky.addColorStop(1.00, '#111d12');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);

  // crowd bokeh above the turf line
  bokeh(g, rng, -w * 0.05, h * 0.02, w * 1.1, h * 0.40, 260,
    ['255,214,150', '210,225,255', '255,180,90', '160,190,230', '255,245,225'],
    w * 0.004, w * 0.020, 0.30);

  // stadium light bar + bloom
  const lx = w * (warm ? 0.78 : 0.30), ly = h * 0.07;
  const bl = g.createRadialGradient(lx, ly, 0, lx, ly, w * 0.34);
  bl.addColorStop(0, 'rgba(255,244,214,0.42)');
  bl.addColorStop(0.32, 'rgba(255,226,170,0.14)');
  bl.addColorStop(1, 'rgba(255,220,160,0)');
  g.fillStyle = bl;
  g.fillRect(0, 0, w, h * 0.7);

  // turf: mow stripes in perspective
  g.save();
  g.beginPath();
  g.rect(0, h * 0.42, w, h * 0.58);
  g.clip();
  const vpX = w * 0.42, vpY = h * 0.30;
  for (let i = -8; i <= 14; i++) {
    const x0 = vpX + i * w * 0.085;
    const x1 = vpX + i * w * 0.30;
    g.fillStyle = (i & 1) ? 'rgba(255,255,255,0.030)' : 'rgba(0,0,0,0.055)';
    g.beginPath();
    g.moveTo(x0, vpY);
    g.lineTo(x0 + w * 0.06, vpY);
    g.lineTo(x1 + w * 0.22, h);
    g.lineTo(x1, h);
    g.closePath();
    g.fill();
  }
  // yard lines receding
  for (let i = 0; i < 7; i++) {
    const f = i / 6;
    const y = vpY + (h - vpY) * (0.16 + f * f * 0.92);
    if (y > h) break;
    const t = (y - vpY) / (h - vpY);
    g.strokeStyle = `rgba(226,232,222,${0.05 + t * 0.16})`;
    g.lineWidth = 1 + t * 4.5;
    g.beginPath();
    g.moveTo(-w * 0.2, y + w * 0.02);
    g.lineTo(w * 1.2, y - w * 0.05);
    g.stroke();
  }
  // wet sheen
  const wet = g.createLinearGradient(0, h * 0.55, w * 0.4, h);
  wet.addColorStop(0, 'rgba(150,190,210,0.00)');
  wet.addColorStop(0.5, 'rgba(160,200,215,0.055)');
  wet.addColorStop(1, 'rgba(120,160,180,0.00)');
  g.fillStyle = wet;
  g.fillRect(0, h * 0.42, w, h * 0.58);
  g.restore();

  // out-of-focus foreground bodies
  g.save();
  g.filter = `blur(${(w * 0.012).toFixed(1)}px)`;
  for (let i = 0; i < 3; i++) {
    const cx = w * (0.06 + rng() * 0.9);
    const cy = h * (0.50 + rng() * 0.5);
    const rw = w * (0.05 + rng() * 0.09);
    const rh = h * (0.16 + rng() * 0.22);
    g.fillStyle = `rgba(8,10,9,${0.34 + rng() * 0.3})`;
    g.beginPath();
    g.ellipse(cx, cy, rw, rh, rng() * 0.6 - 0.3, 0, Math.PI * 2);
    g.fill();
  }
  g.filter = 'none';
  g.restore();

  // airborne debris / turf specks
  for (let i = 0; i < 90; i++) {
    const x = rng() * w, y = h * (0.30 + rng() * 0.62);
    const s = w * (0.0012 + rng() * rng() * 0.006);
    g.fillStyle = `rgba(${18 + rng() * 30 | 0},${16 + rng() * 26 | 0},${12 + rng() * 18 | 0},${0.25 + rng() * 0.6})`;
    g.save();
    g.translate(x, y);
    g.rotate(rng() * 3.14);
    g.fillRect(-s, -s * 0.5, s * 2.4, s);
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
