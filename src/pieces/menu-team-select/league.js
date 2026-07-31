// PIECE menu-team-select — the data adapter.
//
// EVERYTHING ON THIS SCREEN TRACES TO A FILE. Nothing is invented here:
//
//   identity + official colours   src/data/teams.json,  via REG.brand (brand-identity)
//   the three club stat bars      brand-identity/teams.js `stats`, which are means of
//                                 the top-6 real ratings on the real 14-man roster,
//                                 spread across the observed league range. This piece
//                                 does NOT re-derive them — the brief is explicit that
//                                 the derivation is shared, and two different answers
//                                 to "how fast is Chicago" between the team screen and
//                                 the rest of the game would be worse than either.
//   the star player               brand-identity `star` (highest ovr on the roster),
//                                 falling back to a direct scan of src/data/players.json
//                                 when the brand slot is still the foundation fallback.
//
// WHAT WAS TRIED AND THROWN AWAY. A "SQUAD 94" overall badge on each card. Computed
// from players.json it is the mean ovr of the 14 men, and measured across the league
// that runs 93 .. 96 — a four-point spread on a 0-99 scale. Four points cannot carry a
// card corner: every club would read "94" and the badge would be decoration wearing a
// number's clothes. The best-player ovr is no better (97 .. 99). Both were deleted.
// The three spread stats are the only club-level numbers on this screen that actually
// separate 32 clubs, and the star line carries a NAME, which does.

import playerData from '../../data/players.json';
import { STAT_KEYS } from './layout.js';

const BY_TEAM = (playerData && playerData.byTeam) || {};

const DIV_ORDER = ['East', 'North', 'South', 'West'];
const CONF_ORDER = ['AFC', 'NFC'];

/** The 8 real divisions, in ladder order, each holding exactly its 4 clubs. */
export function divisionsOf(brand) {
  const teams = (brand && brand.teams) || [];
  const groups = [];
  for (const conf of CONF_ORDER) {
    for (const div of DIV_ORDER) {
      const list = teams.filter((t) => t.conf === conf && t.div === div);
      if (list.length) {
        groups.push({
          conf, div,
          label: `${conf} ${div.toUpperCase()}`,
          teams: list.slice().sort((a, b) => (a.id < b.id ? -1 : 1)),
        });
      }
    }
  }
  // The foundation FALLBACK brand ships 8 fictional clubs with no conf/div at all.
  // Rather than render an empty screen, chunk whatever it gave us into fours.
  if (!groups.length && teams.length) {
    for (let i = 0; i < teams.length; i += 4) {
      groups.push({
        conf: '', div: '',
        label: `GROUP ${Math.floor(i / 4) + 1}`,
        teams: teams.slice(i, i + 4),
      });
    }
  }
  return groups;
}

/** Which division index holds `id`, and which slot inside it. -1/-1 if absent. */
export function locate(groups, id) {
  for (let g = 0; g < groups.length; g++) {
    const k = groups[g].teams.findIndex((t) => t.id === id);
    if (k >= 0) return { division: g, slot: k };
  }
  return { division: -1, slot: -1 };
}

/**
 * The star line. brand-identity already picked the highest-ovr man on each roster;
 * this only re-scans players.json when that field is missing (fallback brand, or a
 * club the brand piece does not know).
 */
export function starOf(team) {
  if (team && team.star && team.star.name) return team.star;
  const roster = BY_TEAM[team && team.id] || [];
  let best = null;
  for (const p of roster) if (!best || p.ovr > best.ovr) best = p;
  return best ? { name: best.name, pos: best.pos, num: best.num, ovr: best.ovr } : null;
}

/** "Walter Payton" -> "W. PAYTON", so a 22 px cap line never has to shrink to fit. */
export function shortName(name) {
  const s = String(name || '').trim();
  if (!s) return '';
  const parts = s.split(/\s+/);
  if (parts.length === 1) return parts[0].toUpperCase();
  const last = parts[parts.length - 1];
  return `${parts[0][0]}. ${last}`.toUpperCase();
}

/** The three bar values, clamped. Missing stats become 0.5 rather than throwing. */
export function statsOf(team) {
  const s = (team && team.stats) || {};
  return STAT_KEYS.map((k) => {
    const v = s[k];
    return typeof v === 'number' && v === v ? Math.max(0, Math.min(1, v)) : 0.5;
  });
}

/**
 * resolve(state, brand) — the whole screen's model, from a loose ShotSpec state.
 *
 * ACCEPTED STATE, all optional:
 *   team        club id to select, e.g. 'CHI'. Wins over division/selected.
 *   division    0..7, or a label like 'NFC NORTH'
 *   selected    0..3 slot inside the shown division
 *   teams       explicit array of 4 club ids — the FOUNDATION FALLBACK's contract
 *               (['NYC','CHI','DAL','LA']); honoured so an old ShotSpec still works.
 */
export function resolve(state, brand) {
  const st = state || {};
  const groups = divisionsOf(brand);
  const byId = (brand && brand.byId) ? brand.byId : (() => null);

  // Explicit 4-up list: build a synthetic group so the rest of the screen is uniform.
  if (Array.isArray(st.teams) && st.teams.length) {
    const list = st.teams.slice(0, 4).map((id) => byId(id)).filter(Boolean);
    if (list.length) {
      const sel = Math.max(0, Math.min(list.length - 1, st.selected | 0));
      const at = locate(groups, list[sel].id);
      return {
        groups,
        division: at.division >= 0 ? at.division : 0,
        shown: list,
        selected: sel,
        label: at.division >= 0 ? groups[at.division].label : 'SELECT',
        team: list[sel],
      };
    }
  }

  let div = 0;
  let slot = 0;
  if (st.team) {
    const at = locate(groups, String(st.team).toUpperCase());
    if (at.division >= 0) { div = at.division; slot = at.slot; }
  } else {
    if (typeof st.division === 'string') {
      const k = groups.findIndex((g) => g.label === st.division.toUpperCase());
      if (k >= 0) div = k;
    } else if (typeof st.division === 'number') {
      div = ((st.division | 0) % Math.max(1, groups.length) + groups.length) % Math.max(1, groups.length);
    }
    if (typeof st.selected === 'number') slot = st.selected | 0;
  }
  const g = groups[div] || { label: '', teams: [] };
  slot = Math.max(0, Math.min(g.teams.length - 1, slot));
  return {
    groups, division: div, shown: g.teams, selected: slot,
    label: g.label, team: g.teams[slot] || null,
  };
}

export default { divisionsOf, locate, starOf, shortName, statsOf, resolve };
