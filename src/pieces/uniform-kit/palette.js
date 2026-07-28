// PIECE uniform-kit — the kit colour system.
//
// Every value here traces back to a REAL club's official colour set in
// src/data/teams.json (surfaced through REG.brand.byId().colors.officials).
// Nothing is invented: the five variants are five DIFFERENT ARRANGEMENTS of the
// same 2-4 official hexes, which is exactly how a real club builds home / away /
// colour-rush / alternate / throwback sets.
//
// The whole point of the file is that a variant is a small struct of colours, not
// a new texture set and never a new shader program. `materials.js` turns a Kit into
// uniforms on a material that is otherwise identical for all 32 clubs x 5 variants.

/* ------------------------------------------------------------------ colour */

export function hexToRgb(h) {
  let s = String(h || '#888').replace('#', '');
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  const n = parseInt(s, 16) || 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
export function rgbToHex(c) {
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0');
  return `#${f(c[0])}${f(c[1])}${f(c[2])}`;
}
export function luma(c) {
  const r = Array.isArray(c) ? c : hexToRgb(c);
  return r[0] * 0.2126 + r[1] * 0.7152 + r[2] * 0.0722;
}
export function chroma(c) {
  const r = Array.isArray(c) ? c : hexToRgb(c);
  return Math.max(r[0], r[1], r[2]) - Math.min(r[0], r[1], r[2]);
}
export function mixHex(a, b, k) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex([A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k]);
}
export function shade(h, k) { return k >= 0 ? mixHex(h, '#ffffff', k) : mixHex(h, '#000000', -k); }
export function desat(h, k) {
  const c = hexToRgb(h);
  const l = luma(c);
  return rgbToHex([c[0] + (l - c[0]) * k, c[1] + (l - c[1]) * k, c[2] + (l - c[2]) * k]);
}
/** Push a hue toward full chroma without changing its luma much — for rim/trim pops. */
export function vivid(h, k) {
  const c = hexToRgb(h);
  const mx = Math.max(c[0], c[1], c[2]) || 1;
  const s = 1 + k;
  const out = c.map((v) => Math.min(1, ((v / mx) ** (1 / s)) * mx * (1 + k * 0.18)));
  return rgbToHex(out);
}
export function rgba(h, a) {
  const c = hexToRgb(h);
  return `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;
}

const WHITE = '#e6e4dd';
const CREAM = '#e9dfc6';

/* --------------------------------------------------------------- club roles */

/**
 * Sort a club's official colours into the four roles a uniform actually needs.
 * DARK is the shell colour, HOT is the accent that carries every stripe and rim,
 * LIGHT is the road jersey, METAL is the neutral (silver/pewter/gold) if there is one.
 */
export function roles(team) {
  const off = (team && team.colors && team.colors.officials) || ['#101018', '#888888'];
  const list = off.slice(0, 4);
  let dark = list[0], hot = null, light = null, metal = null;
  let dl = 9, hs = -1, ll = -1;
  for (const c of list) {
    const l = luma(c), s = chroma(c);
    if (l < dl) { dl = l; dark = c; }
    if (l > ll && l > 0.42) { ll = l; light = c; }
    // "hot" wants chroma first, then enough luma to survive on a dark jersey
    const score = s * 2.2 + l * 0.55 - (l > 0.72 ? 0.9 : 0);
    if (score > hs) { hs = score; hot = c; }
  }
  for (const c of list) {
    if (chroma(c) < 0.09 && luma(c) > 0.30 && luma(c) < 0.80) metal = c;
  }
  if (!hot || hot === dark) hot = list.find((c) => c !== dark) || shade(dark, 0.45);
  if (chroma(hot) < 0.05 && luma(hot) < 0.55) hot = shade(hot, 0.35);
  const hasLight = !!light;      // does the club OWN a light colour, or are we inventing one?
  if (!light) light = WHITE;
  if (!metal) metal = shade(desat(hot, 0.75), 0.18);
  // A club whose primary IS bright (MIA aqua, GB green is dark, LAC powder) still needs
  // a genuinely dark shell for the blackout and helmet.
  const shell = luma(dark) > 0.30 ? shade(dark, -0.55) : dark;
  return { dark, shell, hot, light, metal, hasLight, primary: list[0] };
}

/* ------------------------------------------------------------------- kits */

/**
 * kitFor(team, variant, opts) -> Kit
 * Every field is a hex string. `materials.js` never invents a colour; it only
 * reads this struct.
 */
export function kitFor(team, variant) {
  const R = roles(team);
  const v = variant || 'home';

  // shared defaults
  const base = {
    id: `${team.id}|${v}`,
    variant: v,
    accent: R.hot,                 // the club's signal colour — drives UI + rim light
    helmet: R.shell,
    helmetStripe: R.hot,
    helmetTrim: R.metal,
    facemask: R.shell,
    visor: '#0a0d13',
    glove: R.shell,
    gloveGrip: R.hot,
    cleat: '#0b0c10',
    cleatTrim: R.hot,
    skinTan: 0,
    matte: 0.0,                    // 1 = throwback matte finish
    sleeveBands: 0,                // throwback sleeve striping
    nameplate: 1,
    piping: R.hot,
  };

  if (v === 'home') {
    return Object.assign(base, {
      jersey: R.dark,
      yoke: shade(R.dark, -0.16),
      panel: shade(R.dark, -0.30),
      trim: R.hot,
      numFill: R.hot,
      numOut: R.light,
      numShadow: '#05060a',
      // PANTS ARE NOT AUTOMATICALLY WHITE. A club only gets light pants at home if it
      // actually OWNS a light colour in its official set — Baltimore, Chicago, New
      // Orleans, Pittsburgh and the rest of the two-colour clubs do not, and inventing a
      // white for them both breaks the "never invent a colour" rule and wrecks the value
      // structure: a near-black jersey over paper-white pants is the one combination that
      // cannot read as one garment under a single hard key. Those clubs get their own dark
      // with the accent down the seam, which is a real kit and the bar's value structure.
      // Even a club that does own a white gets it toned — kit pants are never paper white
      // on camera.
      pants: R.hasLight ? mixHex(R.light, R.dark, 0.30) : shade(R.dark, 0.16),
      pantStripe: R.hot,
      pantPanel: R.hasLight ? mixHex(R.light, R.dark, 0.46) : shade(R.dark, 0.05),
      sock: R.dark,
      sockStripe: R.hot,
      sockTop: R.light,
      undershirt: shade(R.dark, -0.35),
    });
  }
  if (v === 'away') {
    return Object.assign(base, {
      jersey: R.light,
      yoke: shade(R.light, -0.06),
      panel: shade(R.light, -0.13),
      trim: R.hot,
      numFill: R.dark,
      numOut: R.hot,
      numShadow: '#1a1a20',
      pants: mixHex(R.light, R.dark, 0.24),
      pantStripe: R.dark,
      pantPanel: mixHex(R.light, R.dark, 0.38),
      sock: R.dark,
      sockStripe: R.light,
      sockTop: R.light,
      undershirt: shade(R.dark, -0.25),
      glove: R.light,
      gloveGrip: R.dark,
    });
  }
  if (v === 'alt1') {
    // the club's HOT colour as the jersey — the alternate every modern club owns
    return Object.assign(base, {
      jersey: R.hot,
      yoke: shade(R.hot, -0.18),
      panel: shade(R.hot, -0.28),
      trim: R.light,
      numFill: R.light,
      numOut: R.shell,
      numShadow: '#0a0a0e',
      pants: R.shell,
      pantStripe: R.hot,
      pantPanel: shade(R.shell, 0.06),
      sock: R.shell,
      sockStripe: R.hot,
      sockTop: R.hot,
      undershirt: R.shell,
      glove: R.hot,
      gloveGrip: R.shell,
      helmetStripe: R.light,
    });
  }
  if (v === 'alt2') {
    // colour rush / blackout: one value head to toe, accent only as a hairline
    const black = shade(R.shell, -0.42);
    return Object.assign(base, {
      jersey: black,
      yoke: shade(black, 0.05),
      panel: shade(black, -0.25),
      trim: R.hot,
      numFill: shade(black, 0.10),
      numOut: R.hot,
      numShadow: '#000000',
      pants: black,
      pantStripe: R.hot,
      pantPanel: shade(black, 0.04),
      sock: black,
      sockStripe: R.hot,
      sockTop: black,
      undershirt: black,
      helmet: black,
      helmetStripe: R.hot,
      helmetTrim: shade(R.hot, -0.2),
      facemask: black,
      glove: black,
      gloveGrip: R.hot,
      piping: R.hot,
    });
  }
  // throwback: desaturated, matte, sleeve bands, no nameplate
  const tb = desat(shade(R.dark, 0.04), 0.30);
  return Object.assign(base, {
    jersey: tb,
    yoke: tb,
    panel: shade(tb, -0.08),
    trim: CREAM,
    numFill: CREAM,
    numOut: shade(tb, -0.35),
    numShadow: '#0d0b08',
    pants: desat(mixHex(R.light, '#cbbf9c', 0.5), 0.2),
    pantStripe: desat(R.hot, 0.35),
    pantPanel: '#c9bd9c',
    sock: tb,
    sockStripe: CREAM,
    sockTop: CREAM,
    undershirt: shade(tb, -0.25),
    helmet: desat(shade(R.shell, 0.10), 0.45),
    helmetStripe: CREAM,
    helmetTrim: '#8a7a5c',
    facemask: '#b9ac8c',
    glove: desat(R.dark, 0.4),
    gloveGrip: CREAM,
    cleat: '#16130f',
    cleatTrim: CREAM,
    matte: 1.0,
    sleeveBands: 1,
    nameplate: 0,
    accent: desat(R.hot, 0.25),
    piping: CREAM,
  });
}

export const VARIANT_LABELS = ['HOME', 'AWAY', 'ALT 1', 'ALT 2', 'THROWBACK'];
export const VARIANT_IDS = ['home', 'away', 'alt1', 'alt2', 'throwback'];

export default { kitFor, roles, VARIANT_IDS, VARIANT_LABELS };
