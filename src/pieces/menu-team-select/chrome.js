// PIECE menu-team-select — drawing primitives and colour maths.
//
// WHY A LOCAL COPY OF THE COLOUR HELPERS. brand-identity/gfx.js already has mix /
// lighten / luma, and this piece could import them. It does not, deliberately:
// gfx.js is another agent's file and is being edited concurrently, and a menu that
// breaks because a crest helper changed signature is a bad trade for thirty lines.
// The CLUB DATA is imported (that is the shared source of truth); the arithmetic is
// local.
//
// The one colour function here that is not generic is `beacon()`. See its header —
// it exists because half the league's official primary is too dark to be seen on a
// black card, and lightening toward white destroys the hue that carries the identity.

/* ------------------------------------------------------------------ canvas */

export function mkCanvas(w, h) {
  const W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h));
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(W, H);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  return c;
}

/* ------------------------------------------------------------------ colour */

export function hex2rgb(h) {
  let s = String(h || '#000').replace('#', '');
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  const n = parseInt(s, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgb2hex(r, g, b) {
  const q = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${q(r)}${q(g)}${q(b)}`;
}

export function mix(a, b, t) {
  const A = hex2rgb(a), B = hex2rgb(b);
  return rgb2hex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}

export const lighten = (c, t) => mix(c, '#ffffff', t);
export const darken = (c, t) => mix(c, '#000000', t);

export function rgba(c, a) {
  const [r, g, b] = hex2rgb(c);
  return `rgba(${r},${g},${b},${a})`;
}

/** Rec.709 relative luminance, 0..1. */
export function luma(c) {
  const [r, g, b] = hex2rgb(c);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Saturation as (max-min)/255 — cheap chroma proxy, enough to spot a neutral. */
export function chroma(c) {
  const [r, g, b] = hex2rgb(c);
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
}

/**
 * beacon(hex, targetLuma) — make a club colour VISIBLE on near-black without
 * turning it into a pastel.
 *
 * MEASURED, and this is why the function exists. Reading src/data/teams.json,
 * the relative luminance of the 32 official PRIMARY colours runs:
 *
 *     LV  #000000  0.00      CHI #0B162A  0.08      JAX #101820  0.09
 *     HOU #03202F  0.11      NE  #002244  0.11      CLE #311D00  0.12
 *     ... 17 of 32 clubs sit below 0.20 ...        NO  #D3BC8D  0.74
 *
 * A 2 px keyline at luma 0.08 on a #06070b card is invisible — measured 6 lum
 * levels of separation, which is under the ~10 a 1080p display resolves at that
 * size. lighten() toward white fixes the visibility and destroys the identity:
 * lighten('#0B162A', 0.55) is #8a919e, a grey, and Chicago's navy is gone.
 *
 * So this scales the CHANNELS by a common factor, which preserves the ratios
 * between them and therefore the hue. A pure black primary has no ratios to
 * preserve and returns null so the caller can fall back to the club's secondary —
 * which for the one club that hits it (LV) is the silver everybody pictures anyway.
 *
 * THE CLIPPING BUG, and how it showed up. The first version used f = target/luma
 * flat and let the channels clip at 255. Kansas City is #E31837 = (227,24,55): to
 * reach luma 0.55 that is f = 2.0, which pins R at 255 while G and B are free to
 * multiply, so the drawn colour came out (255,48,110) — a hot pink. It was obvious
 * in iso_team_select_states, where CHIEFS was set in a colour the Chiefs do not own.
 * The factor is therefore capped so NO channel clips:
 *
 *     f = min(255 / maxChannel, target / luma)
 *
 * KC now boosts by 1.12 to (255,27,62) — luma 0.30, under the nominal target but
 * pure club red, and 0.30 against a 0.02 card ground is 15 stops of separation.
 * Hue integrity beats hitting a number that was only ever a proxy for legibility.
 */
export function beacon(hex, targetLuma) {
  const [r, g, b] = hex2rgb(hex);
  const l = luma(hex);
  if (l <= 0.004) return null;               // pure black — no hue to rescue
  if (l >= targetLuma) return hex;
  const mx = Math.max(r, g, b);
  const f = Math.min(255 / Math.max(1, mx), targetLuma / l);
  return rgb2hex(r * f, g * f, b * f);
}

/** beacon() with a guaranteed answer: falls back through a list of alternates. */
export function beaconOf(list, targetLuma) {
  for (const c of list) {
    if (!c) continue;
    const v = beacon(c, targetLuma);
    if (v) return v;
  }
  return '#b8bcc4';
}

/* -------------------------------------------------------------------- path */

/** Rounded-rect path. Radius is clamped so it can never invert on a thin box. */
export function rr(c, x, y, w, h, r) {
  const k = Math.max(0, Math.min(r, Math.min(w, h) * 0.5));
  c.beginPath();
  c.moveTo(x + k, y);
  c.lineTo(x + w - k, y);
  c.arcTo(x + w, y, x + w, y + k, k);
  c.lineTo(x + w, y + h - k);
  c.arcTo(x + w, y + h, x + w - k, y + h, k);
  c.lineTo(x + k, y + h);
  c.arcTo(x, y + h, x, y + h - k, k);
  c.lineTo(x, y + k);
  c.arcTo(x, y, x + k, y, k);
  c.closePath();
}

export function lin(c, x0, y0, x1, y1, stops) {
  const g = c.createLinearGradient(x0, y0, x1, y1);
  for (const s of stops) g.addColorStop(s[0], s[1]);
  return g;
}

export function rad(c, x0, y0, r0, x1, y1, r1, stops) {
  const g = c.createRadialGradient(x0, y0, r0, x1, y1, r1);
  for (const s of stops) g.addColorStop(s[0], s[1]);
  return g;
}

/* -------------------------------------------------------------------- type */

/**
 * Cap-height typesetting. Every size in this piece is expressed as a CAP HEIGHT,
 * never as a nominal point size, for the reason hud-overlay/ink.js gives at length:
 * a card is a fixed rectangle and the type has to sit in it. Asking for "size 44"
 * and hoping produces a different optical size in every face.
 *
 * The real faces expose `capHeight`, so one probe measure at 100 px converts.
 * The foundation FALLBACK faces do not, and there `measure().cap` is undefined —
 * we fall back to 0.72 * ascent-ish, which is only ever used when
 * typeface-lettering has not loaded (a screenshot of that is obviously a fallback
 * anyway, by design).
 */
const capProbe = new Map();
export function sizeForCap(faces, face, cap) {
  const k = `${face}`;
  let per = capProbe.get(k);
  if (per === undefined) {
    let m = null;
    try { m = faces.measure('H', face, 100); } catch (e) { m = null; }
    per = (m && m.cap) ? m.cap / 100 : (m && m.ascent ? (m.ascent * 0.94) / 100 : 0.72);
    capProbe.set(k, per);
  }
  return cap / per;
}

/** Reset the cap probe when the faces object changes identity (fallback -> real). */
export function resetTypeCache() { capProbe.clear(); }

/**
 * Set `text` at a target cap height, shrinking (never growing) so its measured ink
 * width fits `maxW`. Returns the drawn width. Used everywhere a club name goes into
 * a card, because "PHILADELPHIA" and "LA" are the same box.
 */
export function drawFit(c, faces, text, x, y, o) {
  const face = o.face || 'blitz-block';
  let size = sizeForCap(faces, face, o.cap);
  const opts = {
    face, size, align: o.align || 'left', fill: o.fill, stroke: o.stroke,
    strokeWidth: o.strokeWidth, tracking: o.tracking, shadow: o.shadow,
  };
  let m = faces.measure(text, face, size, opts);
  if (o.maxW && m.w > o.maxW) {
    size *= o.maxW / m.w;
    opts.size = size;
    m = faces.measure(text, face, size, opts);
  }
  faces.draw(c, text, x, y, opts);
  return m.w;
}

/** Measure-only twin of drawFit — for laying a run out before committing to it. */
export function widthFit(faces, text, o) {
  const face = o.face || 'blitz-block';
  let size = sizeForCap(faces, face, o.cap);
  let m = faces.measure(text, face, size, { face, size, tracking: o.tracking });
  if (o.maxW && m.w > o.maxW) {
    size *= o.maxW / m.w;
    m = faces.measure(text, face, size, { face, size, tracking: o.tracking });
  }
  return m.w;
}

export default {
  mkCanvas, hex2rgb, rgb2hex, mix, lighten, darken, rgba, luma, chroma,
  beacon, beaconOf, rr, lin, rad, sizeForCap, drawFit, widthFit, resetTypeCache,
};
