// PIECE stadium-env — every pixel of the bowl, baked once at load.
//
// FOUR textures, ~4.6 MB resident at live resolution, which is why this piece can be
// the cheapest thing on screen while occupying the most pixels:
//   crowdTile   512 (1024 in capture)  ONE seating section, tiling in u, with the
//                                      aisle staircase SPLIT across the seam so the
//                                      tile boundary IS a real aisle. Alpha carries a
//                                      per-fan "team-colourable" flag, so a region can
//                                      be biased toward a club's palette with a mix in
//                                      the shader and no second texture.
//   ledStrip    2048x128               two rows of sponsor / matchup panels, masked
//                                      through a real dot-matrix so it reads as LED and
//                                      not as a JPEG of a sign.
//   videoWall   1024x512               the jumbotron feed: a broadcast frame, a score
//                                      bug, the club's own illustrated crest.
//   glowSprite  128                    the additive halo. There is no bloom pass in
//                                      this build (post belongs to `cinematography`),
//                                      so every light source carries its own bloom as
//                                      geometry. Without this the light banks are hard
//                                      white dots and the bar's top edge is unmatched.

import * as THREE from 'three';
import { canvas, toTexture, fillPixels, cached } from '../../foundation/texlab.js';
import { hash01 } from '../../foundation/rng.js';
import { PALETTE } from './config.js';

const FONT = (px, w) => `${w || 800} ${px}px "Liberation Sans Narrow","Liberation Sans","DejaVu Sans",Arial,sans-serif`;

function rgb(r, g, b) { return `rgb(${r | 0},${g | 0},${b | 0})`; }

function hex2(c) {
  let t = String(c).replace('#', '');
  if (t.length === 3) t = t[0] + t[0] + t[1] + t[1] + t[2] + t[2];
  const v = parseInt(t, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/* ============================================================== crowd tile */

/**
 * THE CROWD. One section: an aisle staircase split across the seam, ~30 seats by
 * 26 rows, a cross-aisle walkway two thirds of the way up, handrails, and a
 * population drawn back-row-first so the front rows correctly occlude the ones
 * behind. Occupancy, slouch, height, garment and skin all come from hash01 of the
 * seat's integer coordinates — no stream state, so the crowd is identical on every
 * run and identical at every tile resolution.
 */
export function crowdTile(size, seed) {
  return cached(`stadium-env:crowd:${size}:${seed}`, () => {
    const S = size;
    const A = canvas(S, S);      // colour
    const M = canvas(S, S);      // team-colourable mask -> alpha
    const ca = A.ctx, cm = M.ctx;

    ca.fillStyle = '#0a0b0e'; ca.fillRect(0, 0, S, S);
    cm.fillStyle = '#000000'; cm.fillRect(0, 0, S, S);

    const ROWS = 20;
    const SEATS = 26;
    const aisleW = S * 0.080;
    const rowH = S / ROWS;
    const seatW = (S - aisleW) / SEATS;
    const x0 = aisleW * 0.5;

    // --- seat decks -------------------------------------------------------
    // A packed night crowd is a MID-VALUE mass with dark gaps, not dark bodies on a
    // dark deck. The first pass authored coats at 6-20% luminance and the whole bowl
    // read as confetti: only skin and white shirts survived, so the crowd looked like
    // static instead of people. Everything here now sits in the 15-55% band, and the
    // grade darkens it globally through vertex colour where it belongs.
    for (let j = 0; j < ROWS; j++) {
      const y = j * rowH;
      const k = 1 - j / ROWS;                       // 1 at the back, 0 at the front
      const g = ca.createLinearGradient(0, y, 0, y + rowH);
      const base = 30 + k * 16;
      g.addColorStop(0, rgb(base * 1.30, base * 1.26, base * 1.34));
      g.addColorStop(0.40, rgb(base * 0.90, base * 0.88, base * 0.96));
      g.addColorStop(1, rgb(base * 0.30, base * 0.29, base * 0.34));
      ca.fillStyle = g;
      ca.fillRect(0, y, S, rowH);
      ca.globalAlpha = 0.34;
      ca.fillStyle = '#05060a';
      for (let i = 0; i <= SEATS; i++) ca.fillRect(x0 + i * seatW - 0.6, y + rowH * 0.52, 1.2, rowH * 0.48);
      ca.globalAlpha = 1;
    }

    // --- the cross-aisle walkway (a real bowl always has one)
    const wRow = Math.round(ROWS * 0.42);
    ca.fillStyle = '#23262d';
    ca.fillRect(0, wRow * rowH - rowH * 0.14, S, rowH * 0.82);
    ca.fillStyle = '#3d434e';
    ca.fillRect(0, wRow * rowH - rowH * 0.14, S, Math.max(1, rowH * 0.13));

    const COAT = [
      '#3a3d47', '#2b2f38', '#4a4b52', '#5b4a38', '#3c332b', '#565b66',
      '#262930', '#6a5b48', '#454a56', '#2f353f', '#6b6862', '#3a4250',
      '#7a6c58', '#8b8f99', '#9c948a', '#b0a89c', '#cfc8bc', '#e6e0d4',
      '#4e5460', '#332c26', '#585044', '#78808c',
    ];
    const SKIN = ['#b58358', '#7d5232', '#d4a888', '#583823', '#9c6a44', '#e2c3a2', '#6b432a'];

    function person(c, mc, cx, cy, w, h, si, teamFlag) {
      const coat = COAT[si % COAT.length];
      const skin = SKIN[(si >> 3) % SKIN.length];
      // shoulders, wide enough to close the gaps between neighbours
      c.fillStyle = coat;
      c.beginPath();
      c.ellipse(cx, cy, w * 0.54, h * 0.52, 0, 0, Math.PI * 2);
      c.fill();
      // head
      c.fillStyle = skin;
      c.beginPath();
      c.arc(cx, cy - h * 0.50, w * 0.25, 0, Math.PI * 2);
      c.fill();
      if (teamFlag && mc) {
        mc.fillStyle = '#ffffff';
        mc.beginPath();
        mc.ellipse(cx, cy, w * 0.54, h * 0.52, 0, 0, Math.PI * 2);
        mc.fill();
      }
    }

    // --- population, back rows first so the front rows occlude correctly
    for (let j = 0; j < ROWS; j++) {
      if (j === wRow) continue;
      const y = j * rowH;
      const k = 1 - j / ROWS;
      for (let i = 0; i < SEATS; i++) {
        const h0 = hash01(i, j, seed);
        const fill = 0.90 + k * 0.07;
        if (h0 > fill) continue;
        const h1 = hash01(i, j, seed ^ 0x9e37);
        const h2 = hash01(i, j, seed ^ 0x5f11);
        const h3 = hash01(i, j, seed ^ 0x1d3b);
        const stand = h3 > 0.95 ? 1.24 : 1.0;
        const w = seatW * (0.96 + h1 * 0.22);
        const h = rowH * (0.98 + h2 * 0.26) * stand;
        const cx = x0 + (i + 0.5) * seatW + (h1 - 0.5) * seatW * 0.16;
        const cy = y + rowH * (0.66 - (stand - 1) * 0.5) + (h2 - 0.5) * rowH * 0.14;
        const si = Math.floor(h1 * 977 + h2 * 331 + i * 7 + j * 13);
        const teamFlag = h3 < 0.32;
        person(ca, cm, cx, cy, w, h, si, teamFlag);
        // wrap the seam so tiling never clips a fan in half
        if (cx < w) person(ca, cm, cx + S, cy, w, h, si, teamFlag);
        if (cx > S - w) person(ca, cm, cx - S, cy, w, h, si, teamFlag);
      }
    }

    // --- aisle staircase, split across the seam (drawn last: it is in front)
    function stairs(cx) {
      const g = ca.createLinearGradient(cx - aisleW / 2, 0, cx + aisleW / 2, 0);
      g.addColorStop(0, '#14161b');
      g.addColorStop(0.5, '#4c515c');
      g.addColorStop(1, '#14161b');
      ca.fillStyle = g;
      ca.fillRect(cx - aisleW / 2, 0, aisleW, S);
      ca.fillStyle = 'rgba(210,216,226,0.50)';
      for (let j = 0; j < ROWS * 2; j++) {
        ca.fillRect(cx - aisleW / 2, j * (S / (ROWS * 2)), aisleW, Math.max(0.8, (S / (ROWS * 2)) * 0.16));
      }
      ca.fillStyle = 'rgba(170,178,192,0.62)';
      ca.fillRect(cx - aisleW * 0.54, 0, Math.max(1, S * 0.0032), S);
      ca.fillRect(cx + aisleW * 0.48, 0, Math.max(1, S * 0.0032), S);
    }
    stairs(0); stairs(S);

    // --- a sparse scatter of phone screens. 2.8% was a snowstorm; 0.5% is a crowd.
    for (let j = 0; j < ROWS; j++) {
      for (let i = 0; i < SEATS; i++) {
        const h = hash01(i, j, seed ^ 0x77aa);
        if (h > 0.005) continue;
        const cx = x0 + (i + 0.5) * seatW;
        const cy = j * rowH + rowH * 0.58;
        ca.fillStyle = 'rgba(170,214,255,0.80)';
        ca.fillRect(cx - seatW * 0.11, cy - rowH * 0.07, seatW * 0.22, rowH * 0.14);
      }
    }

    // --- grain, so nothing is ever perfectly flat
    const img = ca.getImageData(0, 0, S, S);
    const msk = cm.getImageData(0, 0, S, S);
    const d = img.data, m = msk.data;

    // THE OUTPUT IS A DataTexture, NOT A CanvasTexture, AND THAT IS LOAD-BEARING.
    // Canvas2D stores premultiplied alpha, so putImageData-ing this buffer back into a
    // canvas would multiply every fan's colour by its mask and zero the RGB of the two
    // thirds of the crowd flagged alpha = 0. Writing the bytes straight into a
    // DataTexture keeps colour and mask independent, which is the entire point of
    // packing the team-colourable flag into alpha.
    //
    // Rows are emitted bottom-up so v = 0 is the FRONT row of the deck, matching the
    // bowl geometry's own v, with no reliance on flipY semantics for typed-array
    // uploads.
    const out = new Uint8Array(S * S * 4);
    for (let y = 0; y < S; y++) {
      const src = (S - 1 - y) * S * 4;
      const dst = y * S * 4;
      for (let x = 0; x < S; x++) {
        const p = src + x * 4, q = dst + x * 4;
        const g = (hash01(x, S - 1 - y, 4919) - 0.5) * 22;
        out[q] = Math.max(0, Math.min(255, d[p] + g));
        out[q + 1] = Math.max(0, Math.min(255, d[p + 1] + g));
        out[q + 2] = Math.max(0, Math.min(255, d[p + 2] + g));
        out[q + 3] = m[p];            // alpha = team-colourable flag
      }
    }
    const tex = new THREE.DataTexture(out, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.colorSpace = THREE.NoColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 8;
    tex.flipY = false;
    tex.premultiplyAlpha = false;
    tex.needsUpdate = true;
    return tex;
  });
}

const SPONSORS = [
  ['VOLTRAX', '#0b2a6b', '#7cc4ff'],
  ['NORTHGATE', '#5c0f18', '#ffd2a0'],
  ['APEX FUEL', '#0d3a22', '#8affc0'],
  ['MERIDIAN', '#2a0d4a', '#e0a6ff'],
  ['IRONHOUSE', '#4a2a05', '#ffc95e'],
  ['CASCADE', '#062f3a', '#7ff0ff'],
  ['BRIGHTLINE', '#3a0a2a', '#ff9ad2'],
  ['STARK & CO', '#12141a', '#ffffff'],
];

/* ============================================================ emissive atlas */

/**
 * ONE texture for every emissive surface in the stadium: both LED ribbon rings and
 * the end-zone video walls. That is what lets ribbons and jumbotrons be a single
 * mesh, a single draw and a single program, which is the difference between fitting
 * the recut's program budget and blowing it.
 *
 * v layout (GL space; the canvas is flipped):
 *   0.9375 .. 1.0     ribbon row A   (field-level ring)
 *   0.8750 .. 0.9375  ribbon row B   (fascia ring)
 *   0.8200 .. 0.8750  black guard    (so mip bleed pulls in black, not sponsor soup)
 *   0.0720 .. 0.8050  the video wall
 */
export const ATLAS_V = {
  ribA: [0.9375, 1.0],
  ribB: [0.8750, 0.9375],
  wall: [0.0720, 0.8050],
};

export function emissiveAtlas(W, H, ctx, teamA, teamB, scoreA, scoreB) {
  const key = `stadium-env:atlas:${W}x${H}:${teamA}:${teamB}:${scoreA}:${scoreB}`;
  return cached(key, () => {
    const cv = canvas(W, H);
    const c = cv.ctx;
    c.fillStyle = '#000000'; c.fillRect(0, 0, W, H);

    const ribH = Math.round(H * 0.0625);
    drawRibbonRow(c, 0, W, ribH, SPONSORS.map((s, i) => ({ text: s[0], bg: s[1], fg: s[2], w: 236 + (i % 3) * 48 })));
    drawRibbonRow(c, ribH, W, ribH, [
      { text: `${teamA}  vs  ${teamB}`, bg: '#0d1016', fg: '#ffffff', w: 340 },
      { text: 'VOLTRAX', bg: '#0b2a6b', fg: '#8ecbff', w: 248 },
      { text: 'BLITZ NIGHT', bg: '#40060a', fg: '#ffd0a0', w: 268 },
      { text: 'APEX FUEL', bg: '#0d3a22', fg: '#8affc0', w: 244 },
      { text: 'MERIDIAN', bg: '#2a0d4a', fg: '#e6b4ff', w: 252 },
      { text: 'IRONHOUSE', bg: '#4a2a05', fg: '#ffc95e', w: 256 },
    ]);

    const wy0 = Math.round(H * (1 - ATLAS_V.wall[1]));
    const wy1 = Math.round(H * (1 - ATLAS_V.wall[0]));
    drawWall(c, 0, wy0, W, wy1 - wy0, ctx, teamA, teamB, scoreA, scoreB);

    // dot matrix over the whole atlas — the single strongest "this is an LED panel"
    // cue there is, and it costs one pass at bake time
    const img = c.getImageData(0, 0, W, H);
    const d = img.data;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = (y * W + x) * 4;
        const on = (x % 3 !== 2 && y % 3 !== 2) ? 1.0 : 0.30;
        d[p] *= on; d[p + 1] *= on; d[p + 2] *= on; d[p + 3] = 255;
      }
    }
    c.putImageData(img, 0, 0);

    const tex = toTexture(cv, { srgb: false, aniso: 8 });
    tex.wrapT = 1001;
    return tex;
  });
}

function drawRibbonRow(c, y, W, rowH, list) {
  let x = 0, i = 0;
  while (x < W) {
    const item = list[i % list.length];
    const w = item.w;
    c.save();
    c.beginPath();
    c.rect(x, y + rowH * 0.05, w - 5, rowH * 0.90);
    c.clip();
    const g = c.createLinearGradient(x, y, x, y + rowH);
    g.addColorStop(0, item.bg);
    g.addColorStop(1, '#000000');
    c.fillStyle = g;
    c.fillRect(x, y, w, rowH);
    c.globalAlpha = 0.26;
    c.fillStyle = item.fg;
    c.beginPath();
    c.moveTo(x + w * 0.64, y);
    c.lineTo(x + w * 1.04, y);
    c.lineTo(x + w * 0.88, y + rowH);
    c.lineTo(x + w * 0.48, y + rowH);
    c.closePath();
    c.fill();
    c.globalAlpha = 1;
    c.fillStyle = item.fg;
    c.font = FONT(Math.round(rowH * 0.52), 900);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(item.text, x + w * 0.5, y + rowH * 0.53);
    c.restore();
    x += w; i++;
  }
}

function drawWall(c, X, Y, W, H, ctx, teamA, teamB, scoreA, scoreB) {
  c.save();
  c.translate(X, Y);
  c.fillStyle = '#04050a'; c.fillRect(0, 0, W, H);

  const feedH = H * 0.74;
  const sky = c.createLinearGradient(0, 0, 0, feedH);
  sky.addColorStop(0, '#0a1119');
  sky.addColorStop(0.46, '#141d28');
  sky.addColorStop(0.52, '#22461f');
  sky.addColorStop(1, '#0c2410');
  c.fillStyle = sky; c.fillRect(0, 0, W, feedH);

  // crowd band on the feed's own horizon
  for (let i = 0; i < 2600; i++) {
    const x = hash01(i, 3, 71) * W;
    const y = feedH * 0.20 + hash01(i, 5, 71) * feedH * 0.29;
    const v = 30 + hash01(i, 7, 71) * 170;
    c.fillStyle = rgb(v * 1.12, v * 0.94, v * 0.7);
    c.fillRect(x, y, 3.0, 2.4);
  }
  // yard lines
  c.strokeStyle = 'rgba(235,248,235,0.62)';
  for (let i = -7; i <= 7; i++) {
    const t = i / 7;
    c.beginPath();
    c.lineWidth = 2.5 + Math.abs(t) * 2.5;
    c.moveTo(W * (0.5 + t * 0.68), feedH);
    c.lineTo(W * (0.5 + t * 0.19), feedH * 0.56);
    c.stroke();
  }
  // players
  for (let i = 0; i < 14; i++) {
    const x = W * (0.12 + hash01(i, 11, 13) * 0.76);
    const y = feedH * (0.64 + hash01(i, 13, 13) * 0.30);
    const s = H * 0.16 * (0.6 + (y / feedH) * 0.8);
    c.fillStyle = i % 2 ? 'rgba(228,233,242,0.95)' : 'rgba(20,22,30,0.96)';
    c.beginPath();
    c.ellipse(x, y, s * 0.22, s * 0.48, 0, 0, Math.PI * 2);
    c.fill();
    c.globalAlpha = 0.30;
    c.fillStyle = '#000';
    c.fillRect(x - s * 0.42, y + s * 0.44, s * 0.84, s * 0.07);
    c.globalAlpha = 1;
  }

  // the club's own illustrated mascot, straight from brand-identity
  try {
    const cr = ctx && ctx.brand && ctx.brand.crest ? ctx.brand.crest(teamA, 384) : null;
    if (cr) {
      c.globalAlpha = 0.96;
      c.drawImage(cr.cv || cr, W * 0.025, feedH * 0.06, feedH * 0.82, feedH * 0.82);
      c.globalAlpha = 1;
    }
  } catch (e) { /* brand not registered yet — the feed still reads */ }

  // score bug
  const bugH = H - feedH;
  c.fillStyle = '#070910'; c.fillRect(0, feedH, W, bugH);
  c.fillStyle = '#b8121a'; c.fillRect(0, feedH, W * 0.28, bugH * 0.60);
  c.fillStyle = '#123a72'; c.fillRect(W * 0.28, feedH, W * 0.28, bugH * 0.60);
  c.fillStyle = '#ffffff';
  c.font = FONT(Math.round(bugH * 0.42), 900);
  c.textBaseline = 'middle';
  c.textAlign = 'left';
  c.fillText(teamA, W * 0.018, feedH + bugH * 0.30);
  c.fillText(teamB, W * 0.298, feedH + bugH * 0.30);
  c.textAlign = 'right';
  c.fillText(String(scoreA), W * 0.268, feedH + bugH * 0.30);
  c.fillText(String(scoreB), W * 0.548, feedH + bugH * 0.30);
  c.fillStyle = '#ffcf4a';
  c.font = FONT(Math.round(bugH * 0.36), 900);
  c.fillText('4TH   :09', W * 0.985, feedH + bugH * 0.30);
  c.fillStyle = '#0a0c12'; c.fillRect(0, feedH + bugH * 0.60, W, bugH * 0.40);
  c.fillStyle = '#7cc4ff';
  c.font = FONT(Math.round(bugH * 0.27), 800);
  c.textAlign = 'left';
  c.fillText('VOLTRAX  ·  NORTHGATE  ·  APEX FUEL  ·  MERIDIAN  ·  CASCADE', W * 0.018, feedH + bugH * 0.80);
  c.restore();
}

/* ================================================================== glow */

/** Radial additive halo. One sprite serves every light source in the build. */
export function glowSprite(size) {
  return cached(`stadium-env:glow:${size}`, () => {
    const cv = canvas(size, size);
    fillPixels(cv, (x, y, u, v) => {
      const dx = u - 0.5, dy = v - 0.5;
      const r = Math.sqrt(dx * dx + dy * dy) * 2;
      const core = Math.exp(-r * r * 26.0);
      const halo = Math.exp(-r * 3.1) * 0.55;
      const streakH = Math.exp(-Math.abs(dy) * 90) * Math.exp(-Math.abs(dx) * 5.2) * 0.42;
      const streakV = Math.exp(-Math.abs(dx) * 90) * Math.exp(-Math.abs(dy) * 5.2) * 0.30;
      const a = Math.min(1, core + halo + streakH + streakV);
      const warm = 1 - Math.min(1, r * 0.7);
      return [a * (0.86 + warm * 0.14), a * (0.80 + warm * 0.16), a * (0.72 + warm * 0.10), a];
    });
    const tex = toTexture(cv, { srgb: false, mipmaps: true });
    tex.wrapS = tex.wrapT = 1001;
    return tex;
  });
}

/** Sky: a baked gradient with low cloud, sampled by view direction. */
export function skyTexture(W, H) {
  return cached(`stadium-env:sky:${W}x${H}`, () => {
    const cv = canvas(W, H);
    const zen = hex2(PALETTE.skyZenith), hor = hex2(PALETTE.skyHorizon), glo = hex2(PALETTE.skyGlow);
    fillPixels(cv, (x, y, u, v) => {
      // v: 0 = zenith (top of canvas), 1 = horizon
      const k = Math.pow(v, 1.5);
      let r = zen[0] + (hor[0] - zen[0]) * k;
      let g = zen[1] + (hor[1] - zen[1]) * k;
      let b = zen[2] + (hor[2] - zen[2]) * k;
      // the stadium's own light bleeding into low haze, strongest at the horizon
      const bleed = Math.pow(Math.max(0, v - 0.42) / 0.58, 2.1);
      r += glo[0] * bleed * 0.9; g += glo[1] * bleed * 0.8; b += glo[2] * bleed * 0.6;
      // torn low cloud
      let n = 0, amp = 0.5, f = 3.0;
      for (let o = 0; o < 4; o++) {
        const xi = Math.floor(u * f * 8), yi = Math.floor(v * f * 4);
        const fx = u * f * 8 - xi, fy = v * f * 4 - yi;
        const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
        const a = hash01(xi, yi, 17 + o * 91), b2 = hash01(xi + 1, yi, 17 + o * 91);
        const c2 = hash01(xi, yi + 1, 17 + o * 91), d2 = hash01(xi + 1, yi + 1, 17 + o * 91);
        n += amp * ((a + (b2 - a) * sx) + ((c2 + (d2 - c2) * sx) - (a + (b2 - a) * sx)) * sy);
        amp *= 0.5; f *= 2.05;
      }
      const cloud = Math.max(0, n - 0.42) * 1.5 * (0.25 + v * 0.9);
      r += cloud * 26; g += cloud * 24; b += cloud * 22;
      return [r / 255, g / 255, b / 255, 1];
    });
    const tex = toTexture(cv, { srgb: false });
    tex.wrapS = 1000; tex.wrapT = 1001;
    return tex;
  });
}

export default { crowdTile, emissiveAtlas, glowSprite, skyTexture, ATLAS_V };
