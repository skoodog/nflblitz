// PIECE menu-title — the lightning.
//
// A recursive mid-point-displacement channel with three orders of branching,
// generated once from makeRng(seed) — never Math.random — so the same bolt
// comes back byte for byte on every capture. Rendered as four additive passes
// (wide violet air glow, tight glow, violet body, white core) with the branch
// orders thinner and dimmer, and with the segments near the tips tapering out
// the way a real return stroke does.

import { makeRng } from '../../foundation/rng.js';
import { clamp, lerp, mkCanvas } from './geom.js';

export const RECT = { x: 880, y: -20, w: 1040, h: 700 };

function displace(pts, amp, falloff, depth, rng) {
  let cur = pts;
  for (let d = 0; d < depth; d++) {
    const next = [cur[0]];
    for (let i = 0; i < cur.length - 1; i++) {
      const a = cur[i], b = cur[i + 1];
      const mx = (a[0] + b[0]) * 0.5, my = (a[1] + b[1]) * 0.5;
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const l = Math.hypot(dx, dy) || 1;
      const k = amp * Math.pow(falloff, d) * (rng() * 2 - 1);
      next.push([mx + (-dy / l) * k, my + (dx / l) * k]);
      next.push(b);
    }
    cur = next;
  }
  return cur;
}

/**
 * buildBolt(seed) -> { main:[[x,y]...], branches:[{pts, w, a}] }
 * Coordinates are logical (1920x1080) space.
 */
export function buildBolt(seed) {
  const rng = makeRng(seed);
  const main = displace([[1496, -40], [1462, 74], [1424, 152], [1398, 226],
    [1362, 300], [1334, 372], [1312, 436]], 54, 0.58, 5, rng);

  const branches = [];
  const n = main.length;
  const spawn = [0.16, 0.30, 0.42, 0.55, 0.68, 0.80];
  for (let s = 0; s < spawn.length; s++) {
    const i = Math.floor(spawn[s] * (n - 2)) + 1;
    const a = main[i];
    const dirx = main[Math.min(n - 1, i + 3)][0] - main[Math.max(0, i - 3)][0];
    const diry = main[Math.min(n - 1, i + 3)][1] - main[Math.max(0, i - 3)][1];
    const ang = Math.atan2(diry, dirx) + (rng() < 0.62 ? -1 : 1) * (0.55 + rng() * 0.75);
    const len = 70 + rng() * 190;
    const b = displace([a, [a[0] + Math.cos(ang) * len * 0.45, a[1] + Math.sin(ang) * len * 0.45],
      [a[0] + Math.cos(ang + 0.2) * len, a[1] + Math.sin(ang + 0.2) * len]],
    30, 0.55, 4, rng);
    branches.push({ pts: b, w: 0.46 + rng() * 0.2, a: 0.5 + rng() * 0.3 });

    if (rng() < 0.7) {
      const j = Math.floor(b.length * (0.4 + rng() * 0.3));
      const c = b[j];
      const ang2 = ang + (rng() < 0.5 ? -1 : 1) * (0.6 + rng() * 0.6);
      const len2 = 34 + rng() * 92;
      const cc = displace([c, [c[0] + Math.cos(ang2) * len2, c[1] + Math.sin(ang2) * len2]],
        20, 0.55, 3, rng);
      branches.push({ pts: cc, w: 0.26, a: 0.34 });
    }
  }
  return { main, branches };
}

function stroke(c, pts, w, col, cap) {
  c.beginPath();
  c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
  c.lineWidth = w;
  c.strokeStyle = col;
  c.lineCap = cap || 'round';
  c.lineJoin = 'round';
  c.stroke();
}

/**
 * bakeBolt(texlab, bolt, scale) -> canvas covering RECT with alpha.
 * The flash animation modulates the blit alpha; the geometry never changes.
 */
export function bakeBolt(bolt, scale) {
  const w = Math.max(64, Math.round(RECT.w * scale));
  const h = Math.max(64, Math.round(RECT.h * scale));
  const o = mkCanvas(w, h);
  const c = o.ctx;
  c.save();
  c.scale(w / RECT.w, h / RECT.h);
  c.translate(-RECT.x, -RECT.y);
  c.globalCompositeOperation = 'lighter';

  // air glow along the channel — a chain of soft blobs, cheaper and softer
  // than a huge blurred stroke and it falls off along the length like real air.
  const n = bolt.main.length;
  for (let i = 0; i < n; i += 2) {
    const p = bolt.main[i];
    const k = 1 - i / n;
    const r = lerp(84, 196, k);
    const g = c.createRadialGradient(p[0], p[1], 0, p[0], p[1], r);
    g.addColorStop(0, `rgba(158,128,216,${(0.088 * (0.4 + k)).toFixed(3)})`);
    g.addColorStop(0.4, `rgba(120,96,180,${(0.028 * (0.4 + k)).toFixed(3)})`);
    g.addColorStop(1, 'rgba(80,60,140,0)');
    c.fillStyle = g;
    c.beginPath(); c.arc(p[0], p[1], r, 0, Math.PI * 2); c.fill();
  }

  for (const b of bolt.branches) {
    stroke(c, b.pts, 13 * b.w, `rgba(140,112,200,${(0.10 * b.a).toFixed(3)})`);
    stroke(c, b.pts, 5.4 * b.w, `rgba(190,168,238,${(0.30 * b.a).toFixed(3)})`);
    stroke(c, b.pts, 2.1 * b.w, `rgba(232,224,255,${(0.72 * b.a).toFixed(3)})`);
    stroke(c, b.pts, 1.0 * b.w, `rgba(255,255,255,${(0.85 * b.a).toFixed(3)})`);
  }
  stroke(c, bolt.main, 38, 'rgba(146,116,206,0.11)');
  stroke(c, bolt.main, 18, 'rgba(170,140,224,0.20)');
  stroke(c, bolt.main, 8.4, 'rgba(214,196,250,0.58)');
  stroke(c, bolt.main, 4.0, 'rgba(246,240,255,0.94)');
  stroke(c, bolt.main, 1.8, 'rgba(255,255,255,1)');

  c.restore();
  return o.cv;
}

/**
 * flashAt(t) -> 0..1. A four-lobe strike (leader, return stroke, two echoes) on
 * a 6.4 s cycle, phased so t = 0 — the frame every capture takes — lands on the
 * decay of the return stroke at ~0.6: the channel is still lit, the sky is not
 * blown out, and `iso_title_flash` (which forces 1.0) is a visibly different
 * frame rather than a duplicate of the hero shot.
 */
export function flashAt(t) {
  const P = 6.4;
  const p = ((t % P) + P) % P / P + 0.135;
  const q = p >= 1 ? p - 1 : p;
  const lobe = (c, w) => Math.exp(-((q - c) * w) * ((q - c) * w));
  const v = 0.62 * lobe(0.055, 30) + 1.0 * lobe(0.100, 34) + 0.42 * lobe(0.150, 26)
    + 0.16 * lobe(0.235, 18);
  return clamp(v, 0, 1);
}

export default { buildBolt, bakeBolt, flashAt, RECT };
