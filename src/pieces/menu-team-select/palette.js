// PIECE menu-team-select — one club, five colours.
//
// THE RULE THIS SCREEN IS BUILT ON: club identity is carried by the club's OWN
// official colour, and by nothing else. No per-club decoration, no invented accent
// hue, no "team A is the red one". Every value below is a shade of a hex that is
// literally in src/data/teams.json (via brand-identity's colour system), and the
// only transforms allowed are luminance ones.
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
// WHAT COMES FROM WHERE
//   key      card keyline / rail chip / lens band.  art.border if the brand piece
//            supplied one (it is curated per club and already a club colour),
//            else the primary. Raised to luma 0.42.
//   deep     the card's tinted ground. primary crushed to luma ~0.045 — dark enough
//            that the crest and the type own the contrast, tinted enough that a
//            Dolphins card is not the same black as a Ravens card.
//   glow     the outer bloom on the selected card. art.glow, else key.
//   name     the nickname. key, further raised to 0.55 so 44 px of it holds up
//            against the warm white of the city line above it.
//   trim     the secondary/metal — used for the star player's number only.

import { beaconOf, beacon, luma, mix, darken, rgba } from './chrome.js';

const CACHE = new Map();

export function paletteOf(team) {
  if (!team) return FALLBACK;
  const k = team.id || 'x';
  const hit = CACHE.get(k);
  if (hit) return hit;

  const cols = team.colors || {};
  const art = team.art || {};
  const primary = cols.primary || '#101018';
  const secondary = cols.secondary || '#8a8f98';
  const officials = Array.isArray(cols.officials) ? cols.officials : [primary, secondary];

  // Candidate order for the identity colour: the club's curated card border if the
  // brand piece gave one, then primary, then any official that is not near-white.
  const cands = [art.border, primary, ...officials.filter((c) => luma(c) < 0.9), secondary];
  const key = beaconOf(cands, 0.42);
  const name = beaconOf(cands, 0.55);
  // deep: the primary is the ground tint, but a near-white primary (NO #D3BC8D,
  // PIT #FFB612) would make a pale card, so it is crushed by luminance not by mix
  // with a fixed grey.
  const deep = crush(primary, 0.045);
  const p = {
    id: k,
    key,
    name,
    deep,
    mid: crush(primary, 0.10),
    glow: beacon(art.glow || key, 0.5) || key,
    shard: art.shard || darken(primary, 0.25),
    trim: beacon(art.trim || secondary, 0.55) || '#c9ccd2',
    officials,
  };
  CACHE.set(k, p);
  return p;
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
  id: '?', key: '#8f97a6', name: '#c3cad6', deep: '#0a0b10', mid: '#14161d',
  glow: '#8f97a6', shard: '#20242e', trim: '#c9ccd2', officials: ['#8f97a6'],
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

export { rgba, mix };
export default { paletteOf, PAPER, PAPER_DIM, GOLD, GOLD_HI, GOLD_LO, TRACK, TRACK_EDGE, GROUND, INK };
