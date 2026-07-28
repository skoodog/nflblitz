// FOUNDATION — FROZEN after t=0. Do not edit.
//
// The Canvas2D overlay layer. ALWAYS a logical 1920x1080 drawing space regardless of
// the capture size — the backing store is w x h and the context is pre-scaled, so
// every UI piece may hard-code 1920x1080 coordinates and get pixel-identical layout
// at any capture resolution.
//
// Draw order (fixed):
//   1. REG.ui.hud.draw(c2d, t, shot.hud, ui)
//   2. REG.ui.callout.draw(c2d, t, shot.callout, ui)
//   3. if shot.ui.screen -> that screen's draw(c2d, t, shot.ui.state, ui)
//   4. debug grid (only with ?debug=1)
//
// Menu screens are drawn LAST so a screen may cover the in-game HUD. A screen that
// wants the HUD hidden should ship shot.hud.visible=false in its ShotSpec.

import { REG } from './registry.js';

export const LOGICAL_W = 1920;
export const LOGICAL_H = 1080;

const SCREEN_SLOT = {
  title: 'title',
  teamSelect: 'teamSelect',
  uniform: 'uniformScreen',
  playcall: 'playcall',
};

export function createOverlay(canvas, params) {
  const w = params.w, h = params.h;
  canvas.width = w;
  canvas.height = h;
  const c2d = canvas.getContext('2d', { alpha: true, willReadFrequently: false });

  const api = {
    canvas,
    c2d,
    W: LOGICAL_W,
    H: LOGICAL_H,
    scaleX: w / LOGICAL_W,
    scaleY: h / LOGICAL_H,
    clear() {
      c2d.setTransform(1, 0, 0, 1, 0, 0);
      c2d.clearRect(0, 0, w, h);
    },
    /** Build the `ui` object handed to every UIScreen / HUD draw call. */
    uiCtx(ctx) {
      return {
        W: LOGICAL_W,
        H: LOGICAL_H,
        faces: REG.faces,
        brand: REG.brand,
        safe: { l: 48, t: 36, r: 48, b: 36 },
        rng: ctx.rng,
        texlab: ctx.texlab,
        quality: ctx.quality,
        seed: ctx.seed,
        t: ctx.t,
        variant: ctx.variant,
        shot: ctx.shot,
        /** px(n): logical px -> logical px. Present so pieces never need devicePixelRatio. */
        px: (n) => n,
      };
    },
    draw(t, shot, ctx) {
      api.clear();
      c2d.setTransform(api.scaleX, 0, 0, api.scaleY, 0, 0);
      const ui = api.uiCtx(ctx);

      const call = (label, fn) => {
        try { fn(); } catch (e) {
          console.error(`[overlay] ${label} threw:`, e);
          (window.__BLITZ_ERRORS__ = window.__BLITZ_ERRORS__ || []).push(`[overlay] ${label}: ${e && e.message}`);
        }
      };

      const hudVisible = ctx.forceHud === null || ctx.forceHud === undefined
        ? (shot.hud && shot.hud.visible)
        : !!ctx.forceHud;
      if (hudVisible && REG.ui.hud) {
        call('hud', () => REG.ui.hud.draw(c2d, t, Object.assign({}, shot.hud, { visible: true }), ui));
      }

      if (shot.callout && shot.callout.visible && REG.ui.callout) {
        call('callout', () => REG.ui.callout.draw(c2d, t, shot.callout, ui));
      }

      const screensOn = ctx.forceUI === null || ctx.forceUI === undefined ? true : !!ctx.forceUI;
      if (screensOn && shot.ui && shot.ui.screen) {
        const slot = SCREEN_SLOT[shot.ui.screen];
        const impl = slot && REG.ui[slot];
        if (impl) call(`screen:${shot.ui.screen}`, () => impl.draw(c2d, t, shot.ui.state || {}, ui));
      }

      if (ctx.debug) drawDebugGrid(c2d, ui);

      c2d.setTransform(1, 0, 0, 1, 0, 0);
    },
  };
  return api;
}

function drawDebugGrid(c, ui) {
  c.save();
  c.strokeStyle = 'rgba(0,255,180,0.28)';
  c.lineWidth = 1;
  for (let x = 0; x <= ui.W; x += 120) { c.beginPath(); c.moveTo(x + 0.5, 0); c.lineTo(x + 0.5, ui.H); c.stroke(); }
  for (let y = 0; y <= ui.H; y += 120) { c.beginPath(); c.moveTo(0, y + 0.5); c.lineTo(ui.W, y + 0.5); c.stroke(); }
  c.strokeStyle = 'rgba(255,60,60,0.8)';
  c.lineWidth = 2;
  c.strokeRect(ui.safe.l, ui.safe.t, ui.W - ui.safe.l - ui.safe.r, ui.H - ui.safe.t - ui.safe.b);
  c.strokeStyle = 'rgba(255,200,0,0.55)';
  c.strokeRect(ui.W * 0.5 - 1, 0, 2, ui.H);
  c.fillStyle = 'rgba(0,255,180,0.85)';
  c.font = '600 18px "Liberation Sans",Arial,sans-serif';
  c.fillText('1920 x 1080 logical · grid 120 · safe 48/36', 56, 26);
  c.restore();
}

export default { createOverlay, LOGICAL_W, LOGICAL_H };
