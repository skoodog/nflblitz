// PIECE: menu-title
// OWNER: this directory ONLY. Never edit anything outside src/pieces/menu-title/.
// SLOT:  ui.title                      REGISTER VIA: registerUI('title', impl)
// JUDGED ON: title screen — chrome BLITZ, red RELOADED, skyline, lightning, tagline
// HERO PANELS: title
//
// WHAT THIS IS. The whole title screen, in Canvas2D at logical 1920x1080, drawn
// opaque so it owns the frame. Every number in the layout is measured off
// bar/panel-title.png at 3.195 logical px per panel px (the bar panel is
// 455x338, and a matched-height A/B maps its 338 rows onto our 1080).
//
//   sky      domain-warped fBm cloud density, shaded by distance to the bolt
//            CHANNEL, over a nine-stop night gradient with a fixed air glow
//   bolt     recursive mid-point displacement, three branch orders, seeded
//   city     three depth layers, ~1400 seeded windows in five tenancies with a
//            quarter of the facades dark, real bloom, two cranes, beacons
//   chevron  three stacked stepped neon outlines: bracket 236, outer 262,
//            inset 297, apex 741, outer points at 960 +- 640
//   BLITZ    hand-authored letterforms, 20-step extrusion, mitre-offset chamfer
//            shaded per facet with a cross-facet gradient, an environment pass,
//            and the horizon value ramp sampled off the art
//   RELOADED / tagline  blitz-brush from REG.faces — never a system font
//
// ANIMATION, all a pure function of t: clouds drift, the strike envelope runs
// a four-lobe 6.4 s cycle that lifts the veil, the cloud response and the
// relight of the logo (the channel itself keeps a floor — the afterglow is
// what a camera sees), and a sheen band sweeps the wordmark every 5.6 s.
//
// COST. Everything above is baked ONCE into six offscreen layers at a scale
// taken from the device (`ui.fit * ui.dpr`, clamped to 0.30..1, so a 390x844
// phone bakes ~1.5 MB of surface, not 8), and the frame path is eight
// drawImage calls plus one clipped blit for the chrome sheen. No text is
// rasterised, no gradient is constructed and nothing is allocated per frame.
//
// CAPTURE
//   node scripts/shoot.mjs --piece=menu-title --layer=overlay
//   node scripts/shoot.mjs --piece=menu-title
//   node scripts/compare.mjs --panel=title --shot=shots/menu-title/title.png \
//                            --out=shots/menu-title/cmp-r1.png

import { registerUI, registerIsoShot } from '../../foundation/registry.js';
import { texlab as TEXLAB } from '../../foundation/texlab.js';
import { clamp, stopsInto, mkCanvas } from './geom.js';
import { bakeSkyBase, bakeClouds, bakeGrain, bakeFlashVeil, CLOUD_OVER } from './sky.js';
import { buildBolt, bakeBolt, flashAt, RECT as BOLT_RECT } from './bolt.js';
import { bakeCity, RECT as CITY_RECT } from './city.js';
import { bakeSheenBand } from './chrome.js';
import {
  drawLogo, drawTagline, wordmark, wordmarkClip, LOGO_RECT, TAG_RECT,
} from './lockup.js';

export const PIECE = 'menu-title';

/* --------------------------------------------------------------- bake cache */

const S = {
  ready: false, scale: 0, faces: null,
  sky: null, clouds: null, city: null, logo: null, bolt: null, tag: null,
  grain: null, veil: null, sheen: null, clip: null, pattern: null, wm: null,
};

function layer(rect, k, fn) {
  const o = mkCanvas(rect.w * k, rect.h * k);
  o.ctx.save();
  o.ctx.scale(o.cv.width / rect.w, o.cv.height / rect.h);
  o.ctx.translate(-rect.x, -rect.y);
  fn(o.ctx);
  o.ctx.restore();
  return o.cv;
}

function ensure(ui) {
  const tl = ui.texlab || TEXLAB;
  const k = clamp((ui.fit || 1) * (ui.dpr || 1) * (ui.runtime ? 1.15 : 1), 0.30, 1);
  if (S.ready && S.faces === ui.faces && Math.abs(S.scale - k) < 0.03) return;

  const W = ui.W, H = ui.H;
  S.sky = bakeSkyBase(tl, W, H, k);
  S.clouds = bakeClouds(tl, W, H, k);
  S.city = bakeCity(W, H, k);
  S.bolt = bakeBolt(buildBolt(20260728), k);
  S.logo = layer(LOGO_RECT, k, (c) => drawLogo(c, ui));
  S.tag = layer(TAG_RECT, k, (c) => drawTagline(c, ui));
  S.veil = bakeFlashVeil(H);
  S.sheen = bakeSheenBand(320, 32);
  if (!S.grain) {
    S.grain = bakeGrain(tl, 192);
    S.pattern = null;
  }
  S.clip = wordmarkClip();
  S.wm = wordmark();
  S.faces = ui.faces;
  S.scale = k;
  S.ready = true;
}

/* ------------------------------------------------------------------ compose */

/**
 * The channel and the SKY RESPONSE are decoupled on purpose. A return stroke is
 * gone in 40 ms; the ionised channel afterglow is what a camera catches, so the
 * bolt keeps a visible floor while the veil, the cloud lift and the relight of
 * the logo all scale with the strike envelope.
 */
function background(c, t, W, H, flash, veilK) {
  c.drawImage(S.sky, 0, 0, W, H);
  const span = W * CLOUD_OVER;
  const drift = -(((t * 2.15) % span) + span) % span;
  c.drawImage(S.clouds, drift, 0, W * (1 + CLOUD_OVER), H);
  c.globalCompositeOperation = 'lighter';
  c.globalAlpha = clamp(0.42 + 0.58 * flash, 0, 1);
  c.drawImage(S.bolt, BOLT_RECT.x, BOLT_RECT.y, BOLT_RECT.w, BOLT_RECT.h);
  if (flash > 0.02) {
    c.globalAlpha = clamp(0.085 * flash * veilK, 0, 1);
    c.drawImage(S.veil, 0, 0, W, H * 0.78);
  }
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'source-over';
}

function sheen(c, t) {
  const wm = S.wm;
  if (!wm) return;
  const u = ((t / 5.6) + 0.42) % 1;
  const bw = wm.width * 0.42;
  const x = wm.x0 - bw + u * (wm.width + bw * 2);
  const top = wm.baseline - wm.cap * 1.18;
  const hgt = wm.cap * 1.42;
  c.save();
  c.clip(S.clip);
  c.globalCompositeOperation = 'lighter';
  c.globalAlpha = 0.26;
  c.translate(x, top);
  c.transform(1, 0, -0.30, 1, 0, 0);
  c.drawImage(S.sheen, 0, 0, bw, hgt);
  c.restore();
}

function grainPass(c, W, H) {
  if (!S.pattern) {
    try { S.pattern = c.createPattern(S.grain, 'repeat'); } catch (e) { S.pattern = null; }
  }
  if (!S.pattern) return;
  c.save();
  c.globalCompositeOperation = 'overlay';
  c.globalAlpha = 0.055;
  c.fillStyle = S.pattern;
  c.fillRect(0, 0, W, H);
  c.restore();
}

/* --------------------------------------------------------------- iso scenes */

function isoBackdrop(c, W, H) {
  c.fillStyle = stopsInto(c.createLinearGradient(0, 0, 0, H), [
    [0, '#070611'], [0.42, '#140d21'], [0.72, '#100b1a'], [1, '#040309'],
  ]);
  c.fillRect(0, 0, W, H);
  const vg = c.createRadialGradient(W * 0.5, H * 0.44, H * 0.16, W * 0.5, H * 0.5, H * 1.1);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(1,1,4,0.85)');
  c.fillStyle = vg;
  c.fillRect(0, 0, W, H);
}

function isoZoom(c, ui, W, H, k, cx, cy) {
  isoBackdrop(c, W, H);
  c.save();
  c.translate(cx, cy);
  c.scale(k, k);
  c.translate(-cx, -cy);
  drawLogo(c, ui);
  c.restore();
}

/* ------------------------------------------------------- neighbour handover */

/**
 * DO NOT REGRESS brand-identity.
 *
 * Six of that piece's iso scenes (iso_crests, iso_league, iso_leaguemark, ...)
 * are declared with `ui.screen = 'title'`, and it paints its specimen sheets by
 * intercepting the brand hooks the FALLBACK title screen called — skyline(),
 * leagueMark(), blitzLogo() — then setting globalAlpha to 0 to suppress the
 * host screen. This screen does not call those hooks, so replacing the fallback
 * would have silently blanked another piece's entire capture set.
 *
 * So: when the scene belongs to somebody else, offer the entry hook first and
 * read the signal back. If the neighbour claimed the frame, get out of its way.
 */
function brandClaimedFrame(c, ui) {
  const b = ui.brand;
  if (!b || typeof b.skyline !== 'function') return false;
  const a0 = c.globalAlpha;
  let claimed = false;
  try {
    b.skyline(c, 'NYC', { x: 0, y: ui.H * 0.45, w: ui.W, h: ui.H * 0.55 }, { fill: '#17171d' });
    claimed = c.globalAlpha === 0;
  } catch (e) { claimed = false; }
  if (!claimed) c.globalAlpha = a0;
  return claimed;
}

/* -------------------------------------------------------------------- slot */

registerUI('title', {
  piece: PIECE,
  draw(c2d, t, state, ui) {
    const W = ui.W, H = ui.H;
    const owner = ui.shot && ui.shot.piece;
    if (owner && owner !== PIECE && brandClaimedFrame(c2d, ui)) return;
    const id = owner === PIECE ? ui.shot.id : null;
    ensure(ui);

    if (id === 'iso_logo_chrome') { isoZoom(c2d, ui, W, H, 1.86, 960, 452); grainPass(c2d, W, H); return; }
    if (id === 'iso_logo') { isoZoom(c2d, ui, W, H, 1.28, 960, -143); grainPass(c2d, W, H); return; }

    const strike = id === 'iso_title_flash';
    const flash = strike ? 1 : flashAt(t);
    const veilK = strike ? 2.4 : 1;

    c2d.save();
    background(c2d, t, W, H, flash, veilK);
    c2d.drawImage(S.city, CITY_RECT.x, CITY_RECT.y, CITY_RECT.w, CITY_RECT.h);

    if (id !== 'iso_skyline_night') {
      c2d.drawImage(S.logo, LOGO_RECT.x, LOGO_RECT.y, LOGO_RECT.w, LOGO_RECT.h);
      if (flash > 0.015) {
        c2d.globalCompositeOperation = 'lighter';
        c2d.globalAlpha = 0.12 * flash * (strike ? 1.6 : 1);
        c2d.drawImage(S.logo, LOGO_RECT.x, LOGO_RECT.y, LOGO_RECT.w, LOGO_RECT.h);
        c2d.globalAlpha = 1;
        c2d.globalCompositeOperation = 'source-over';
      }
      sheen(c2d, t);
      c2d.drawImage(S.tag, TAG_RECT.x, TAG_RECT.y, TAG_RECT.w, TAG_RECT.h);
    }
    grainPass(c2d, W, H);
    c2d.restore();
  },
});

/* --------------------------------------------------------------- iso shots */

const BASE = {
  piece: PIECE,
  panel: 'title',
  camera: { pos: [0, 3, 26], target: [0, 3, 0], fov: 40, roll: 0 },
  actors: [],
  ball: { visible: false },
  hud: { visible: false },
  callout: { visible: false },
  ui: { screen: 'title', state: { city: 'NYC' } },
};

registerIsoShot('iso_logo', Object.assign({}, BASE, {
  note: 'the lockup alone on a dark plate: chevron step stack, chrome BLITZ, red brush RELOADED, fictional league crest.',
}));

registerIsoShot('iso_logo_chrome', Object.assign({}, BASE, {
  note: 'BLITZ at 1.86x — chamfer facets, horizon band, specular sparkle, red neon bounce along every bottom edge.',
}));

registerIsoShot('iso_skyline_night', Object.assign({}, BASE, {
  note: 'storm sky + city with the lockup removed: cloud structure, branching bolt, three-layer skyline, lit windows, cranes.',
}));

registerIsoShot('iso_title_flash', Object.assign({}, BASE, {
  note: 'the strike frame — bolt at full return-stroke intensity lighting the clouds and the logo.',
}));
