// PIECE menu-playcall — the adapter over src/data/playbook.json.
//
// THE PLAYBOOK IS THE SOURCE OF TRUTH AND IT IS SHARED. Nothing in this file is keyed
// by club, and nothing here invents a play: the 18 offensive plays (two pages of nine)
// and the 9 defensive plays are read straight out of the JSON, and if the JSON changes
// the screen changes with it. The one thing this file adds is DERIVED geometry — the
// bounds of each play's routes and, for a defensive call, where each assignment is
// pointed — because the renderer needs those every frame and they are a pure function
// of the data.
//
// VERIFIED AGAINST THE SHIPPED DATA (printed from node, not assumed):
//   offense 18 rows, page 1 -> 9, page 2 -> 9        defense 9 rows
//   route extent  max|x| = 20 yd, max y = 44 yd (HAIL MARY), min y = -3 yd
//   kinds  pass / run / screen        clocks 30..150 ticks
//   assignments actually used: rush, press, man, spy, zone_flat, zone_hook, zone_deep
//     (`contain` is in the schema, unused by the shipped book, and still drawn)
//   longest name 12 chars ("OVER THE TOP") — the plate type is fitted, not trusted
//
// THE SLOT PAIRING FOR MAN COVERAGE IS DERIVED, NOT INVENTED. The defensive rows say
// `DB1: 'man'` and never say whom. Rather than making one up, the target is the
// NEAREST offensive skill position to that defender in the shipped formation:
//   DB1 x=-14 -> REC1 x=-14, DB2 x=+9 -> REC2 x=+9, DB3 x=-5 -> REC3 x=-4.5,
//   DB4 x=+4  -> REC2 (5 yd) rather than REC3 (8.5 yd)
// which is what the formation says those players are lined up over.

import PLAYBOOK from '../../data/playbook.json';

export const FORMATION = PLAYBOOK.formation;
export const OFF_SLOTS = PLAYBOOK.meta.offSlots;
export const DEF_SLOTS = PLAYBOOK.meta.defSlots;
export const PAGES = PLAYBOOK.pages || 2;
export const REC_SLOTS = ['REC1', 'REC2', 'REC3'];
export const OL_SLOTS = ['OL1', 'OL2', 'OL3'];

function bounds(routes) {
  let x0 = 0, x1 = 0, y0 = 0, y1 = 0;
  for (const k in routes) {
    for (const p of routes[k]) {
      if (p[0] < x0) x0 = p[0];
      if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1];
      if (p[1] > y1) y1 = p[1];
    }
  }
  return { x0, x1, y0, y1 };
}

/** Total path length in yards — used only to space the beads evenly along a route. */
function pathLen(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}

const OFFENSE = PLAYBOOK.offense.map((p, i) => Object.assign({}, p, {
  index: i,
  bounds: bounds(p.routes),
  lengths: Object.fromEntries(Object.keys(p.routes).map((k) => [k, pathLen(p.routes[k])])),
  /** Ticks -> the seconds the play is expected to last, for the plate tag. 60 Hz. */
  seconds: p.clock / PLAYBOOK.meta.tickRate,
}));

/** Nearest offensive skill position, in the shipped formation, to a defender. */
function nearestTarget(defSlot) {
  const d = FORMATION.defense[defSlot];
  let best = null, bestD = 1e9;
  for (const s of REC_SLOTS) {
    const o = FORMATION.offense[s];
    const dd = Math.hypot(o[0] - d[0], o[1] - d[1]);
    if (dd < bestD) { bestD = dd; best = s; }
  }
  return best;
}

/**
 * Where an assignment points, in yards. Zones are placed by their family and by the
 * defender's own side of the field, so DEEP ZONE's four deep quarters actually sit in
 * four different places instead of stacking on the hash.
 */
function assignGeometry(slot, kind) {
  const at = FORMATION.defense[slot];
  const side = at[0] === 0 ? 0 : (at[0] > 0 ? 1 : -1);
  switch (kind) {
    case 'rush':
      return { kind, to: FORMATION.offense.QB.slice(), target: 'QB' };
    case 'man':
    case 'press': {
      const t = nearestTarget(slot);
      return { kind, to: FORMATION.offense[t].slice(), target: t };
    }
    case 'spy':
      return { kind, to: FORMATION.offense.QB.slice(), target: 'QB' };
    case 'contain':
      return { kind, to: [side * 16, 3], target: null };
    case 'zone_flat':
      return { kind, zone: [side * 13 || 12, 5], rx: 7.5, ry: 4.0 };
    case 'zone_hook':
      return { kind, zone: [at[0] * 0.55, 11], rx: 6.5, ry: 4.2 };
    case 'zone_deep':
      return { kind, zone: [at[0] * 1.15, 23], rx: 9.0, ry: 6.5 };
    default:
      return { kind, to: [at[0], at[1] + 4], target: null };
  }
}

const DEFENSE = PLAYBOOK.defense.map((p, i) => Object.assign({}, p, {
  index: i,
  geom: Object.fromEntries(DEF_SLOTS.map((s) => [s, assignGeometry(s, p.assign[s] || 'zone_hook')])),
}));

export function offensePage(page) {
  const p = page === 2 ? 2 : 1;
  return OFFENSE.filter((o) => o.page === p);
}
export function defense() { return DEFENSE; }
export function allOffense() { return OFFENSE; }

/** The nine plays a given (side,page) shows. Never more than nine — the grid is 3x3. */
export function sheet(side, page) {
  const list = side === 'offense' ? offensePage(page) : DEFENSE;
  return list.slice(0, 9);
}

/** Human tag for a card's plate, right-hand side. */
export function tagOf(play, side) {
  if (side === 'offense') return String(play.kind || '').toUpperCase();
  const cov = play.cover === 'zone' ? 'ZONE' : 'MAN';
  return `${play.rush} RUSH · ${cov}`;
}

export default { sheet, offensePage, defense, allOffense, FORMATION, tagOf, PAGES };
