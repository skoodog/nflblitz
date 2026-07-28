// FOUNDATION FALLBACKS for all six UI slots.
//   hud            -> piece `hud-overlay`
//   callout        -> piece `score-callout`
//   teamSelect     -> piece `menu-team-select`
//   uniformScreen  -> piece `uniform-kit`
//   playcall       -> piece `menu-playcall`
//   title          -> piece `menu-title`
//
// Deliberately plain: flat rectangles, system font, no bevels, no gradients, no
// texture, and a visible "FALLBACK" tag so a screenshot can never be mistaken for
// finished UI work.

const SYS = (px, w = 700) => `${w} ${px}px "Liberation Sans","DejaVu Sans",Arial,sans-serif`;

function tag(c, x, y, label) {
  c.save();
  c.font = SYS(13, 400);
  c.fillStyle = 'rgba(255,90,90,0.85)';
  c.textAlign = 'left';
  c.textBaseline = 'top';
  c.fillText(`FALLBACK · ${label}`, x, y);
  c.restore();
}

function box(c, x, y, w, h, fill = 'rgba(20,20,24,0.72)', stroke = 'rgba(160,160,170,0.5)') {
  c.fillStyle = fill;
  c.fillRect(x, y, w, h);
  c.strokeStyle = stroke;
  c.lineWidth = 1;
  c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

function bar(c, x, y, w, h, v, fill) {
  box(c, x, y, w, h, 'rgba(255,255,255,0.10)', 'rgba(255,255,255,0.22)');
  c.fillStyle = fill;
  c.fillRect(x + 1, y + 1, Math.max(0, (w - 2) * Math.max(0, Math.min(1, v))), h - 2);
}

/* ------------------------------------------------------------------- HUD */

const hud = {
  piece: 'foundation-fallback',
  draw(c, t, state, ui) {
    if (!state || state.visible === false) return;
    const S = ui.safe;
    const x = S.l, y = S.t;
    box(c, x, y, 470, 62);
    c.fillStyle = '#e6e6ea';
    c.textBaseline = 'middle';

    c.font = SYS(20);
    c.textAlign = 'left';
    c.fillText(String(state.clock || ':15'), x + 12, y + 20);
    c.font = SYS(12, 400);
    c.fillText(`Q${state.quarter || 1}  ${state.dist || ''} & ${state.yards || ''}`, x + 12, y + 44);

    c.font = SYS(22);
    c.fillText(String(state.teamA || 'AAA'), x + 90, y + 31);
    c.textAlign = 'right';
    c.fillText(String(state.scoreA ?? 0), x + 218, y + 31);
    c.textAlign = 'left';
    c.fillText(String(state.teamB || 'BBB'), x + 250, y + 31);
    c.textAlign = 'right';
    c.fillText(String(state.scoreB ?? 0), x + 380, y + 31);

    bar(c, x + 90, y + 48, 128, 6, state.momentumA ?? 0.5, '#c05050');
    bar(c, x + 250, y + 48, 128, 6, state.momentumB ?? 0.5, '#5070c0');

    // TURBO, bottom-left
    const ty = ui.H - S.b - 34;
    box(c, S.l, ty, 250, 34);
    c.fillStyle = '#dcdce0';
    c.font = SYS(16);
    c.textAlign = 'left';
    c.fillText('TURBO', S.l + 10, ty + 17);
    bar(c, S.l + 80, ty + 11, 158, 12, state.turbo ?? 0.5, '#4060c8');

    tag(c, x, y + 66, 'hud-overlay');
  },
};

/* --------------------------------------------------------------- CALLOUT */

const callout = {
  piece: 'foundation-fallback',
  draw(c, t, state, ui) {
    if (!state || !state.visible) return;
    const x = ui.W - ui.safe.r;
    const y = ui.H - ui.safe.b - 170;
    c.save();
    c.textAlign = 'right';
    c.textBaseline = 'alphabetic';
    const accent = state.accent === 'red' ? '#d84040' : '#e8b53c';
    ui.faces.draw(c, String(state.line1 || ''), x, y, { face: 'blitz-brush', size: 62, align: 'right', fill: '#e8e8ec' });
    ui.faces.draw(c, String(state.line2 || ''), x, y + 70, { face: 'blitz-brush', size: 78, align: 'right', fill: accent });
    if (state.pts) {
      ui.faces.draw(c, `${state.pts} PTS`, x, y + 132, { face: 'blitz-num', size: 44, align: 'right', fill: '#e8b53c' });
    }
    c.restore();
    tag(c, ui.W - 260, y + 146, 'score-callout');
  },
};

/* ------------------------------------------------------------ TEAM SELECT */

const teamSelect = {
  piece: 'foundation-fallback',
  draw(c, t, state, ui) {
    const teams = (state && state.teams) || ['NYC', 'CHI', 'DAL', 'LA'];
    c.fillStyle = '#0b0b0e';
    c.fillRect(0, 0, ui.W, ui.H);
    ui.faces.draw(c, 'CHOOSE YOUR CITY', ui.W / 2, 118, { face: 'blitz-brush', size: 66, align: 'center', fill: '#e6e0d2' });
    const n = teams.length;
    const cw = 300, ch = 620, gap = 34;
    const total = n * cw + (n - 1) * gap;
    let x = (ui.W - total) / 2;
    for (let i = 0; i < n; i++) {
      const team = ui.brand.byId(teams[i]);
      box(c, x, 190, cw, ch);
      const crest = ui.brand.crest(team.id, 256);
      c.drawImage(crest, x + cw / 2 - 100, 220, 200, 200);
      ui.faces.draw(c, team.city, x + cw / 2, 470, { face: 'blitz-block', size: 24, align: 'center', fill: '#b8b8be' });
      ui.faces.draw(c, team.name, x + cw / 2, 508, { face: 'blitz-block', size: 34, align: 'center', fill: '#e8e8ec' });
      const labels = [['SPEED', team.stats.speed], ['HIT POWER', team.stats.hitPower], ['TURBO', team.stats.turbo]];
      labels.forEach((L, k) => {
        const by = 560 + k * 40;
        ui.faces.draw(c, L[0], x + 16, by, { face: 'blitz-block', size: 15, fill: '#9a9aa2' });
        bar(c, x + 16, by + 8, cw - 32, 14, L[1], '#c8a83c');
      });
      if (state && state.selected === i) {
        c.strokeStyle = '#e0e0e6'; c.lineWidth = 3; c.strokeRect(x - 2, 188, cw + 4, ch + 4);
      }
      x += cw + gap;
    }
    tag(c, 20, ui.H - 26, 'menu-team-select');
  },
};

/* --------------------------------------------------------- UNIFORM SCREEN */

const uniformScreen = {
  piece: 'foundation-fallback',
  draw(c, t, state, ui) {
    const teamId = (state && state.team) || 'CHI';
    const team = ui.brand.byId(teamId);
    ui.faces.draw(c, 'PICK YOUR UNIFORM', ui.W / 2, 110, { face: 'blitz-brush', size: 60, align: 'center', fill: '#e6e0d2' });
    const crest = ui.brand.crest(team.id, 256);
    c.drawImage(crest, 190, 330, 260, 260);
    ui.faces.draw(c, team.city, 320, 640, { face: 'blitz-block', size: 22, align: 'center', fill: '#a8a8b0' });
    ui.faces.draw(c, team.name, 320, 682, { face: 'blitz-block', size: 34, align: 'center', fill: '#e8e8ec' });
    const opts = ['HOME', 'AWAY', 'ALT 1', 'ALT 2', 'THROWBACK'];
    const sel = (state && state.variantIndex) || 0;
    opts.forEach((o, i) => {
      const y = 300 + i * 78;
      box(c, 1420, y, 340, 60, i === sel ? 'rgba(80,20,20,0.8)' : 'rgba(24,24,28,0.8)');
      ui.faces.draw(c, o, 1590, y + 40, { face: 'blitz-block', size: 28, align: 'center', fill: i === sel ? '#e05050' : '#c8c8ce' });
    });
    tag(c, 20, ui.H - 26, 'uniform-kit (screen)');
  },
};

/* -------------------------------------------------------------- PLAYCALL */

const playcall = {
  piece: 'foundation-fallback',
  draw(c, t, state, ui) {
    c.fillStyle = '#0a0a10';
    c.fillRect(0, 0, ui.W, ui.H);
    ui.faces.draw(c, 'DEFENSE!  PICK A PLAY', 96, 96, { face: 'blitz-brush', size: 62, fill: '#e8e4d8' });
    ui.faces.draw(c, (state && state.clock) || ':09', ui.W - 96, 96, { face: 'blitz-num', size: 62, align: 'right', fill: '#e8b53c' });
    const names = (state && state.plays) || ['SAFE COVER', 'STUFF IT', '2 MAN BLITZ', 'ZONE HOOK', 'SLAM WALL', 'LB ATTACK', 'IN YOUR FACE', 'DEATH WISH'];
    const cols = 4, cw = 300, ch = 300, gx = 26, gy = 30;
    const x0 = ui.W - ui.safe.r - (cols * cw + (cols - 1) * gx);
    for (let i = 0; i < 8; i++) {
      const cx = x0 + (i % cols) * (cw + gx);
      const cy = 210 + Math.floor(i / cols) * (ch + gy);
      box(c, cx, cy, cw, ch);
      c.strokeStyle = 'rgba(200,200,210,0.35)';
      c.beginPath();
      for (let k = 0; k < 7; k++) {
        c.moveTo(cx + 40 + k * 36, cy + 150);
        c.lineTo(cx + 40 + k * 36, cy + 90);
      }
      c.stroke();
      ui.faces.draw(c, names[i] || `PLAY ${i + 1}`, cx + cw / 2, cy + ch - 24, { face: 'blitz-block', size: 24, align: 'center', fill: '#dcdce2' });
    }
    tag(c, 20, ui.H - 26, 'menu-playcall');
  },
};

/* ----------------------------------------------------------------- TITLE */

const title = {
  piece: 'foundation-fallback',
  draw(c, t, state, ui) {
    c.fillStyle = '#0a0810';
    c.fillRect(0, 0, ui.W, ui.H);
    ui.brand.skyline(c, 'NYC', { x: 0, y: ui.H * 0.45, w: ui.W, h: ui.H * 0.55 }, { fill: '#17171d' });
    ui.brand.leagueMark(c, { x: ui.W / 2 - 55, y: 110, w: 110, h: 130 });
    ui.brand.blitzLogo(c, { x: ui.W / 2 - 460, y: 270, w: 920, h: 300 });
    ui.faces.draw(c, 'NO FLAGS.  NO RULES.  ALL BLITZ.', ui.W / 2, 880, {
      face: 'blitz-brush', size: 52, align: 'center', fill: '#dcdce2',
    });
    tag(c, 20, ui.H - 26, 'menu-title');
  },
};

export default { hud, callout, teamSelect, uniformScreen, playcall, title };
