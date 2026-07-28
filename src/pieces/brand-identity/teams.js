// PIECE brand-identity — the league roster.
//
// The eight identities (ids, cities, names, abbreviations, colour values and stats)
// are FROZEN by the foundation because uniform-kit, hud-overlay and menu-team-select
// key off them. We import them rather than restating them, and layer the art system
// on top: crest palettes, shard colours, card border colour, skyline id.
//
// FICTIONAL LEAGUE ONLY. No real shield, no real club marks.

import { TEAMS as BASE } from '../../foundation/fallbacks/brand.js';

/** Art layer, keyed by frozen team id. */
const ART = {
  NYC: {
    crest: 'liberty',
    // weathered oxidised copper / patina steel
    body: '#3d8e8c', bodyHi: '#a8e3d2', bodyLo: '#08222a',
    trim: '#7fb4b2', ink: '#040d12',
    shard: '#1d5a63', glow: '#3fd0e6', border: '#d8dee6',
    skyline: 'NYC',
  },
  CHI: {
    crest: 'bulldog',
    body: '#7e8088', bodyHi: '#dcdee6', bodyLo: '#191a1f',
    trim: '#a9abb3', ink: '#08080a',
    shard: '#8c1116', glow: '#e03a3a', border: '#e03a3a',
    skyline: 'CHI',
  },
  DAL: {
    crest: 'longhorn',
    body: '#d8d2bf', bodyHi: '#fbf9f0', bodyLo: '#575246',
    trim: '#a8a294', ink: '#060b07',
    shard: '#1c6b34', glow: '#3ec46d', border: '#3ec46d',
    skyline: 'DAL',
  },
  LA: {
    crest: 'spartan',
    body: '#26262e', bodyHi: '#6e6f7c', bodyLo: '#0c0c10',
    trim: '#f2c033', ink: '#050506',
    shard: '#7a5c10', glow: '#f2c033', border: '#f2c033',
    skyline: 'LA',
  },
  SEA: {
    crest: 'stormcrow',
    body: '#26474a', bodyHi: '#93cfc4', bodyLo: '#08191b',
    trim: '#38e0b0', ink: '#03090a',
    shard: '#10534a', glow: '#38e0b0', border: '#38e0b0',
    skyline: 'SEA',
  },
  MIA: {
    crest: 'voltage',
    body: '#452063', bodyHi: '#d6a8f2', bodyLo: '#120520',
    trim: '#c04df0', ink: '#080312',
    shard: '#5b1a80', glow: '#c04df0', border: '#c04df0',
    skyline: 'MIA',
  },
  BAL: {
    crest: 'ironside',
    body: '#3d3763', bodyHi: '#b4addf', bodyLo: '#100d20',
    trim: '#7c6cf0', ink: '#060414',
    shard: '#332a7a', glow: '#7c6cf0', border: '#7c6cf0',
    skyline: 'BAL',
  },
  PHI: {
    crest: 'forge',
    body: '#354b34', bodyHi: '#bcdba6', bodyLo: '#0b1610',
    trim: '#8fe04a', ink: '#040a06',
    shard: '#31641f', glow: '#8fe04a', border: '#8fe04a',
    skyline: 'PHI',
  },
};

export const TEAMS = BASE.map((t) => Object.assign({}, t, { art: ART[t.id] || ART.NYC }));

const BY_ID = new Map(TEAMS.map((t) => [t.id, t]));

export function byId(id) {
  return BY_ID.get(String(id || '').toUpperCase()) || TEAMS[0];
}

export const HERO_IDS = ['NYC', 'CHI', 'DAL', 'LA'];

export default { TEAMS, byId, HERO_IDS };
