// FOUNDATION FALLBACK — replaced by piece `brand-identity` via registerBrand().
// Deliberately plain: flat grey shields with system-font abbreviations. A critic
// must never mistake this for finished crest work.
//
// The 8-team roster IS frozen (ids, cities, names, colours, stats). A brand piece
// may re-render every mark but must keep these identities and colour values, since
// uniform-kit, hud-overlay and menu-team-select all key off them.

const T = (id, city, name, abbr, primary, secondary, accent, metal, helmet, speed, hitPower, turbo) => ({
  id, city, name, abbr,
  colors: { primary, secondary, accent, metal, helmet },
  stats: { speed, hitPower, turbo },
});

export const TEAMS = [
  T('NYC', 'NEW YORK', 'STRYKERS', 'NYC', '#0d1b2a', '#1b3a5c', '#3fd0e6', '#c9d6e2', '#0a1420', 0.86, 0.62, 0.78),
  T('CHI', 'CHICAGO', 'MAULERS', 'CHI', '#7a0e13', '#1a1a1c', '#e03a3a', '#b9bcc2', '#141416', 0.62, 0.94, 0.70),
  T('DAL', 'DALLAS', 'OUTLAWS', 'DAL', '#0f2a1c', '#0b0b0c', '#3ec46d', '#cfd4cf', '#0a1610', 0.74, 0.80, 0.66),
  T('LA', 'LOS ANGELES', 'TITANS', 'LA', '#141414', '#3a2f08', '#f2c033', '#e8dca6', '#101010', 0.80, 0.72, 0.88),
  T('SEA', 'SEATTLE', 'STORMCROWS', 'SEA', '#0b2b2b', '#08181c', '#38e0b0', '#c2d8d6', '#08191a', 0.90, 0.58, 0.82),
  T('MIA', 'MIAMI', 'VOLTAGE', 'MIA', '#2a0f3a', '#120720', '#c04df0', '#d9c8e6', '#1a0a26', 0.84, 0.60, 0.86),
  T('BAL', 'BALTIMORE', 'IRONSIDES', 'BAL', '#1c1440', '#0a0718', '#7c6cf0', '#c6c2e0', '#120e2a', 0.68, 0.88, 0.64),
  T('PHI', 'PHILADELPHIA', 'FORGE', 'PHI', '#12301f', '#0a1a12', '#8fe04a', '#c8d6c2', '#0c2016', 0.72, 0.84, 0.72),
];

const crestCache = new Map();

function mkCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}

const SYS = '700 %spx "Liberation Sans","DejaVu Sans",Arial,sans-serif';
const sys = (px) => SYS.replace('%s', String(px));

function byId(id) {
  return TEAMS.find((t) => t.id === id) || TEAMS[0];
}

/** Flat grey placeholder shield with the team abbreviation. */
function crest(id, sizePx = 256) {
  const key = `${id}:${sizePx}`;
  if (crestCache.has(key)) return crestCache.get(key);
  const team = byId(id);
  const cv = mkCanvas(sizePx, sizePx);
  const c = cv.getContext('2d');
  const s = sizePx;
  c.clearRect(0, 0, s, s);
  c.fillStyle = '#6a6a6e';
  c.strokeStyle = '#3a3a3e';
  c.lineWidth = Math.max(2, s * 0.02);
  c.beginPath();
  c.moveTo(s * 0.5, s * 0.06);
  c.lineTo(s * 0.9, s * 0.22);
  c.lineTo(s * 0.9, s * 0.6);
  c.quadraticCurveTo(s * 0.9, s * 0.86, s * 0.5, s * 0.96);
  c.quadraticCurveTo(s * 0.1, s * 0.86, s * 0.1, s * 0.6);
  c.lineTo(s * 0.1, s * 0.22);
  c.closePath();
  c.fill();
  c.stroke();
  c.fillStyle = team.colors.accent;
  c.globalAlpha = 0.35;
  c.fillRect(s * 0.1, s * 0.44, s * 0.8, s * 0.08);
  c.globalAlpha = 1;
  c.fillStyle = '#e8e8ea';
  c.font = sys(Math.round(s * 0.28));
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(team.abbr, s * 0.5, s * 0.52);
  c.font = sys(Math.round(s * 0.075));
  c.fillStyle = '#bbbbc0';
  c.fillText('PLACEHOLDER', s * 0.5, s * 0.78);
  crestCache.set(key, cv);
  return cv;
}

function wordmark(c2d, id, box, opts = {}) {
  const team = byId(id);
  const { x, y, w, h } = box;
  c2d.save();
  c2d.textAlign = opts.align || 'center';
  c2d.textBaseline = 'middle';
  c2d.fillStyle = opts.fill || '#dcdce0';
  c2d.font = sys(Math.round(h * 0.34));
  const cx = opts.align === 'left' ? x : opts.align === 'right' ? x + w : x + w / 2;
  c2d.fillText(team.city, cx, y + h * 0.3);
  c2d.font = sys(Math.round(h * 0.5));
  c2d.fillStyle = opts.accent || team.colors.accent;
  c2d.fillText(team.name, cx, y + h * 0.72);
  c2d.restore();
  return box;
}

/** Flat grey skyline blocks. */
function skyline(c2d, cityId, box, opts = {}) {
  const { x, y, w, h } = box;
  c2d.save();
  c2d.fillStyle = opts.fill || '#26262b';
  let bx = x;
  let i = 0;
  const seedish = String(cityId || '').length + 3;
  while (bx < x + w) {
    const bw = w * (0.03 + ((i * 7 + seedish) % 5) * 0.012);
    const bh = h * (0.25 + (((i * 13 + seedish) % 9) / 9) * 0.7);
    c2d.fillRect(bx, y + h - bh, bw - 2, bh);
    bx += bw;
    i++;
  }
  c2d.restore();
  return box;
}

/** Plain chevron badge. NOT the NFL shield — this league is fictional. */
function leagueMark(c2d, box, opts = {}) {
  const { x, y, w, h } = box;
  c2d.save();
  c2d.strokeStyle = opts.stroke || '#8a8a90';
  c2d.fillStyle = opts.fill || '#2a2a30';
  c2d.lineWidth = Math.max(1.5, h * 0.06);
  c2d.beginPath();
  c2d.moveTo(x + w * 0.5, y + h * 0.05);
  c2d.lineTo(x + w * 0.95, y + h * 0.35);
  c2d.lineTo(x + w * 0.5, y + h * 0.95);
  c2d.lineTo(x + w * 0.05, y + h * 0.35);
  c2d.closePath();
  c2d.fill();
  c2d.stroke();
  c2d.fillStyle = opts.text || '#c8c8cc';
  c2d.font = sys(Math.round(h * 0.3));
  c2d.textAlign = 'center';
  c2d.textBaseline = 'middle';
  c2d.fillText('BR', x + w * 0.5, y + h * 0.5);
  c2d.restore();
  return box;
}

/** Plain text logotype. menu-title replaces this with the chrome/red treatment. */
function blitzLogo(c2d, box, opts = {}) {
  const { x, y, w, h } = box;
  c2d.save();
  c2d.textAlign = 'center';
  c2d.textBaseline = 'middle';
  c2d.fillStyle = opts.fill || '#d8d8dc';
  c2d.font = sys(Math.round(h * 0.5));
  c2d.fillText('BLITZ', x + w / 2, y + h * 0.38);
  c2d.font = `italic ${sys(Math.round(h * 0.28))}`;
  c2d.fillStyle = opts.accent || '#c04040';
  c2d.fillText('RELOADED', x + w / 2, y + h * 0.75);
  c2d.restore();
  return box;
}

export default {
  piece: 'foundation-fallback',
  teams: TEAMS,
  byId,
  crest,
  wordmark,
  skyline,
  leagueMark,
  blitzLogo,
};
