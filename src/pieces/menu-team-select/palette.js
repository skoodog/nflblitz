// PIECE menu-team-select — one club, five colours.
//
// THE RULE THIS SCREEN IS BUILT ON: club identity is carried by the club's OWN
// official colour, and by nothing else. No per-club decoration, no invented accent
// hue, no "team A is the red one". Every value below is a shade of a hex that is
// literally in src/data/teams.json, and the only transforms allowed are luminance
// ones.
//
// WHY brand-identity's `colors.accent` IS NOT USED FOR THE NAME COLOUR. It is
// defined there as the brightest/most chromatic non-primary official, and reading
// teams.json that resolves to #FFFFFF for FIFTEEN of the 32 clubs (BUF CHI CIN CLE
// DAL DEN KC LAC LAR LV MIN NO NYJ SF WAS). Setting fifteen nicknames in white
// would be exactly the "decoration instead of identity" failure the brief names.
// So the nickname takes the club's PRIMARY, raised to a readable luminance by
// chrome.beacon() which preserves the hue ratios — see its header for the measured
// justification.
//
// WHAT COMES FROM WHERE — and as of the last revision, ALL OF IT comes from the
// club's own `colors.officials`, i.e. straight out of src/data/teams.json.
//
//   name     the nickname. The club's PRIMARY, raised toward luma 0.50 (see
//            beacon() — the raise stops early rather than clip a channel).
//   key      card keyline, lens band, rail chip, selected bloom. The club's most
//            CHROMATIC non-primary official, raised to luma 0.42; when a club has no
//            chromatic second colour (Dallas, Las Vegas: silver and white) the
//            brightest non-white official, which is the silver.
//   deep/mid the card's tinted ground. The primary crushed to luma 0.045 / 0.075 —
//            dark enough that the crest and the type own the contrast, tinted enough
//            that a Dolphins card is not the same black as a Ravens card.
//
// WHY IT NO LONGER READS brand-identity's `art` RECORD, which is the correction that
// mattered most. `art.border` and `art.glow` are curated per club there and were the
// first choice for `key`. Then the hero `team_select` capture came back with LOS
// ANGELES RAMS wearing Chicago's orange keyline AND Chicago's bear crest. The cause
// is upstream: brand-identity/teams.js keys its ART table `LA` while
// src/data/teams.json keys the club `LAR`, so `ART[id] || ART.CHI` silently hands the
// Rams the Bears' entire art record. That is not this piece's file to fix — but it is
// this piece's job not to launder someone else's fallback into a club identity. So
// the palette now derives from teams.json alone, where LAR's officials are
// #003594 / #FFA300 and the keyline comes out Rams gold. (The crest is still the
// Bears' bear in that capture; that one can only be fixed in brand-identity.)
//
// A CONSEQUENCE WORTH STATING PLAINLY: two clubs in the same division can still land
// on similar hues, because the real league does that — Dallas and the New York Giants
// are both blue. The card carries TWO of its club's colours (name = primary,
// keyline/lens = second official) plus the crest, and those three together separate
// them. One colour per club never could.

import { beaconOf, luma, chroma } from './chrome.js';

const CACHE = new Map();

export function invalidatePalette() { CACHE.clear(); }

export function paletteOf(team) {
  if (!team) return FALLBACK;
  const k = team.id || 'x';
  const hit = CACHE.get(k);
  if (hit) return hit;

  const cols = team.colors || {};
  const primary = cols.primary || '#101018';
  const secondary = cols.secondary || '#8a8f98';
  const officials = (Array.isArray(cols.officials) && cols.officials.length)
    ? cols.officials : [primary, secondary];

  const second = secondOf(primary, officials, secondary);
  const key = beaconOf([second, primary, ...officials], 0.42);
  // Primary first for the name. beaconOf() falls through when a candidate is pure
  // black, which is the one club (LV) whose primary carries no hue to rescue — and
  // its next official is the silver everybody pictures anyway.
  const name = beaconOf([primary, second, ...officials], 0.50);
  const p = {
    id: k,
    key,
    name,
    glow: key,
    deep: crush(primary, 0.045),
    mid: crush(primary, 0.075),
    officials,
  };
  CACHE.set(k, p);
  return p;
}

/**
 * The club's SECOND colour: the most chromatic official that is not the primary and
 * not a near-black. Clubs whose whole set is neutral (Dallas silver/white, Las Vegas
 * silver/white) have no chromatic answer, so they fall through to the brightest
 * non-white official — which is the silver, which is right.
 */
function secondOf(primary, officials, secondary) {
  let best = null, bestC = 0.10;          // 0.10 chroma is the "this is a hue" floor
  let bright = null, brightL = 0;
  for (const c of officials) {
    if (!c || c.toLowerCase() === String(primary).toLowerCase()) continue;
    const l = luma(c);
    if (l < 0.03) continue;               // a near-black cannot be a keyline on black
    const ch = chroma(c);
    if (ch >= bestC) { bestC = ch; best = c; }
    if (l < 0.92 && l > brightL) { brightL = l; bright = c; }
  }
  return best || bright || secondary || primary;
}

/** Scale a colour's luminance to `target` while keeping its channel ratios. */
function crush(hex, target) {
  const l = luma(hex);
  if (l <= 0.002) return '#05060a';
  const f = target / l;
  const [r, g, b] = hexRgb(hex);
  return `#${q(r * f)}${q(g * f)}${q(b * f)}`;
}
function hexRgb(h) {
  let s = String(h).replace('#', '');
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  const n = parseInt(s, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function q(v) { return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'); }

const FALLBACK = {
  id: '?', key: '#8f97a6', name: '#c3cad6', glow: '#8f97a6',
  deep: '#0a0b10', mid: '#14161d', officials: ['#8f97a6'],
};

/* ------------------------------------------------- the screen's fixed inks */
//
// Sampled off bar/panel-team_select.png: the title's cream mean is (208,191,172)
// over its whole ink including the antialiased skirt; the solid interior runs
// warmer and lighter, which is where PAPER comes from. The gold of the stat
// segments was read from the lit blocks: mean (233,176,26) with the brightest
// interior rows at (250,200,60), hence GOLD / GOLD_HI.

export const PAPER = '#e8e1d2';        // title + nickname white
export const PAPER_DIM = '#9ea3ad';    // city line, labels
export const GOLD = '#e9b01a';
export const GOLD_HI = '#fbcf4a';
export const GOLD_LO = '#8a6408';
export const TRACK = '#1b1c21';        // unlit stat cell
export const TRACK_EDGE = '#34363d';
export const GROUND = '#05060a';       // the screen's black
export const INK = '#020305';

export default { paletteOf, invalidatePalette, PAPER, PAPER_DIM, GOLD, GOLD_HI, GOLD_LO, TRACK, TRACK_EDGE, GROUND, INK };
