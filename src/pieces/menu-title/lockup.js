// PIECE menu-title — the title lockup: badge, chevron, BLITZ, RELOADED, tagline.
//
// Every number here is measured off bar/panel-title.png at 3.195 logical px
// per panel px, with x taken relative to the lockup centre (the bar panel is a
// slightly off-centre crop of the concept sheet, so panel-centre would put the
// whole thing 20 px right).
//
//   badge      198 x 253 at (960, 40) — fictional crest, NEVER the NFL shield
//   BLITZ      987 wide, cap 166, baseline 506
//   RELOADED   594 wide, cap ~105, baseline 648
//   tagline    1182 wide, cap 70, baseline 975, rotated -2.3 degrees
//
// RELOADED and the tagline are set in `blitz-brush` from REG.faces — the
// hand-lettered vector face. Nothing here ever touches a system font.

import { drawChevron, OUTER, CX } from './chevron.js';
import { drawBadge } from './badge.js';
import { buildWordmark, drawWordmark, wordmarkPath } from './chrome.js';
import { offsetPoly } from './geom.js';

export const LAYOUT = {
  badge: { x: CX - 99, y: 40, w: 198 },
  word: { cx: CX, baseline: 506, cap: 166, w: 987 },
  reloaded: { cx: CX, baseline: 648, cap: 105, w: 594 },
  tagline: { cx: CX, baseline: 975, cap: 70, w: 1182, rot: -2.3 * Math.PI / 180 },
};

/** Rect of the baked logo layer, logical coords. */
export const LOGO_RECT = { x: 214, y: 8, w: 1492, h: 880 };
export const TAG_RECT = { x: 240, y: 872, w: 1440, h: 176 };

const INNER = offsetPoly(OUTER, -35);

/* ------------------------------------------------------------------ pieces */

/**
 * Size a string by CAP HEIGHT, then track it out (or in) to hit a target width.
 * Sizing by width alone is the trap: `blitz-brush` is more condensed than the
 * art's lettering, so matching the width alone makes the caps 20% too tall and
 * the A/B reads as "their RELOADED is bigger than the bar's".
 */
function fit(F, text, face, capPx, targetW, opts) {
  const p0 = F.measure(text, face, 100, opts);
  const capRatio = (p0 && p0.cap) ? p0.cap / 100 : 0.72;
  const size = capPx / capRatio;
  const p1 = F.measure(text, face, size, opts);
  const n = Math.max(1, text.length - 1);
  const track = (opts && opts.tracking !== undefined ? opts.tracking : 0)
    + (targetW - (p1 ? p1.w : targetW)) / n / size;
  return { size, tracking: track };
}

export function drawReloaded(c, ui) {
  const F = ui.faces;
  const L = LAYOUT.reloaded;
  const f = fit(F, 'RELOADED', 'blitz-brush', L.cap, L.w, { tracking: 0.02, slant: 0.34 });
  const size = f.size;

  const base = {
    face: 'blitz-brush', size, align: 'center', tracking: f.tracking, slant: 0.34,
  };
  // halo
  c.save();
  c.globalCompositeOperation = 'lighter';
  F.draw(c, 'RELOADED', L.cx, L.baseline, Object.assign({}, base, {
    fill: 'rgba(214,26,16,0.30)',
    glow: { color: 'rgba(255,60,26,0.75)', blur: size * 0.55, alpha: 0.55, reps: 2 },
  }));
  c.restore();
  // body: dark outline, drop shadow, vertical red gradient, brush grain
  F.draw(c, 'RELOADED', L.cx, L.baseline, Object.assign({}, base, {
    outline: 'rgba(8,3,6,0.95)',
    outlineWidth: size * 0.055,
    shadow: { color: 'rgba(0,0,0,0.78)', blur: size * 0.24, dy: size * 0.085, reps: 2 },
    grain: 0.34,
    gradient: [
      [0.00, '#ff8a62'], [0.16, '#ff4a2a'], [0.42, '#e11f18'],
      [0.74, '#a8110f'], [1.00, '#5e0708'],
    ],
    fill: '#e11f18',
  }));
  // top rim light
  c.save();
  c.beginPath();
  c.rect(0, L.baseline - size * 1.02, 1920, size * 0.22);
  c.clip();
  c.globalCompositeOperation = 'lighter';
  F.draw(c, 'RELOADED', L.cx, L.baseline, Object.assign({}, base, { fill: 'rgba(255,150,110,0.42)' }));
  c.restore();
}

export function drawTagline(c, ui) {
  const F = ui.faces;
  const L = LAYOUT.tagline;
  const TXT = 'NO FLAGS. NO RULES. ALL BLITZ.';
  const f = fit(F, TXT, 'blitz-brush', L.cap, L.w, { tracking: 0.012 });
  const size = f.size;

  c.save();
  c.translate(L.cx, L.baseline);
  c.rotate(L.rot);
  F.draw(c, TXT, 0, 0, {
    face: 'blitz-brush', size, align: 'center', tracking: f.tracking,
    outline: 'rgba(6,4,10,0.85)',
    outlineWidth: size * 0.05,
    shadow: { color: 'rgba(0,0,0,0.80)', blur: size * 0.34, dy: size * 0.10, reps: 2 },
    grain: 0.30,
    gradient: [
      [0.00, '#fffaf0'], [0.30, '#f2e9d8'], [0.72, '#ddd0ba'], [1.00, '#c3b49b'],
    ],
    fill: '#efe6d5',
  });
  c.restore();
}

/**
 * drawLogo(c, ui) — chevron plate, neon outlines, badge, chrome wordmark and
 * RELOADED, in logical 1920x1080 coordinates. Baked once into LOGO_RECT.
 */
export function drawLogo(c, ui) {
  drawChevron(c, INNER);
  drawBadge(c, LAYOUT.badge);
  const wm = wordmark();
  drawWordmark(c, wm);
  drawReloaded(c, ui);
  return wm;
}

let WM = null;
export function wordmark() {
  if (!WM) {
    const L = LAYOUT.word;
    WM = buildWordmark(L.cx, L.baseline, L.cap, L.w);
  }
  return WM;
}
export function wordmarkClip() {
  return wordmarkPath(wordmark());
}

export default { LAYOUT, LOGO_RECT, TAG_RECT, drawLogo, drawTagline, drawReloaded, wordmark, wordmarkClip };
