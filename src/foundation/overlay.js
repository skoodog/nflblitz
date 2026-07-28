// FOUNDATION — PERFCORE owns this file.
//
// TWO OVERLAYS, matching the two execution paths.
//
//   createOverlay()        CAPTURE. Backing store is the full capture size (1920x1080),
//                          redrawn once. No frame budget. UNCHANGED.
//   createRuntimeOverlay() RUNTIME. Backing store is the DEVICE's pixels, not 1920x1080,
//                          and it must fit inside 1.80 ms at 60 Hz (4.15 ms at 30 Hz).
//
// WHY THE RUNTIME ONE HAD TO EXIST. The capture overlay is a fixed 1920x1080 = 2.07 MP
// Canvas2D surface, fully cleared and fully redrawn every frame, with glows and shadow
// blurs. On a 390x844 phone that is 6.3x more pixels than the screen actually has, paid
// every frame, for a layer that mostly does not change. At runtime the backing store is
// the real device surface and the logical 1920x1080 coordinate space is FITTED onto it,
// so every UI piece keeps its coordinate system and its layout while the cost drops
// with the square of the resolution.
//
// THE LOGICAL SPACE IS PRESERVED. A piece still draws at 1920x1080 coordinates. The
// runtime overlay applies a uniform fit-scale plus a centring offset, so nothing
// distorts on a portrait phone; `ui.visible` reports the logical rectangle that is
// actually on screen, so a piece that wants to adapt its layout CAN, and a piece that
// does not still lands somewhere sane.
//
// DIRTY RECTS. `markDirty(x,y,w,h)` in LOGICAL coordinates restricts the next redraw to
// that region. A piece that declares its dirty regions pays for what it changes; a
// piece that declares nothing gets a full redraw and shows up in the overlay budget
// line, by name, in `perf.mjs`.
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

/* ================================================================== RUNTIME */

/**
 * createRuntimeOverlay(canvas, params) — the in-game HUD surface.
 *
 * Sized to the DEVICE, not to 1920x1080. Logical coordinates stay 1920x1080 via a
 * uniform fit transform, so every UI piece's layout code is unchanged.
 */
export function createRuntimeOverlay(canvas, params) {
  const c2d = canvas.getContext('2d', { alpha: true, desynchronized: true, willReadFrequently: false });

  let cssW = params.w || 390, cssH = params.h || 844;
  let dpr = 1, fit = 1, offX = 0, offY = 0;
  let fullDirty = true;
  let lastEpoch = -1;
  let lastDrawTick = -9999;
  // Dirty rects in LOGICAL space. Preallocated; the frame path never grows this.
  const DR = 16;
  const drX = new Float32Array(DR), drY = new Float32Array(DR);
  const drW = new Float32Array(DR), drH = new Float32Array(DR);
  let drN = 0;

  // The logical rectangle that is actually visible after the fit. On a 390x844 phone
  // the 16:9 logical space is letterboxed, so a piece that reads this can lay its HUD
  // out against the real screen instead of against a rectangle that is off-canvas.
  const visible = { x: 0, y: 0, w: LOGICAL_W, h: LOGICAL_H };

  const uiObj = {
    W: LOGICAL_W, H: LOGICAL_H,
    faces: null, brand: null,
    safe: { l: 48, t: 36, r: 48, b: 36 },
    visible,
    rng: null, texlab: null, quality: 'live', seed: 0, t: 0, variant: '', shot: null,
    dpr: 1, fit: 1, runtime: true,
    px: (n) => n,
    markDirty: null,
  };

  function setSize(w, h, ratio) {
    cssW = Math.max(16, Math.round(w));
    cssH = Math.max(16, Math.round(h));
    // DPR is capped at 2: beyond that a Canvas2D HUD costs 4x the fill for a
    // difference no one can see on a 5-inch panel.
    dpr = Math.min(2, ratio || (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1) || 1);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    // Uniform fit — never distort. Contain, so nothing is cropped away.
    fit = Math.min(cssW / LOGICAL_W, cssH / LOGICAL_H);
    offX = (cssW - LOGICAL_W * fit) * 0.5;
    offY = (cssH - LOGICAL_H * fit) * 0.5;
    visible.x = -offX / fit;
    visible.y = -offY / fit;
    visible.w = cssW / fit;
    visible.h = cssH / fit;
    uiObj.dpr = dpr; uiObj.fit = fit;
    fullDirty = true;
    drN = 0;
  }
  setSize(cssW, cssH, params.dpr);

  function markDirty(x, y, w, h) {
    if (x === undefined) { fullDirty = true; return; }
    if (drN >= DR) { fullDirty = true; return; }
    drX[drN] = x; drY[drN] = y; drW[drN] = w; drH[drN] = h; drN++;
  }
  uiObj.markDirty = markDirty;

  const api = {
    canvas, c2d,
    W: LOGICAL_W, H: LOGICAL_H,
    get scaleX() { return fit * dpr; },
    get scaleY() { return fit * dpr; },
    get visible() { return visible; },
    get dpr() { return dpr; },
    setSize,
    markDirty,
    markFullDirty() { fullDirty = true; },

    uiCtx(ctx) {
      uiObj.faces = REG.faces;
      uiObj.brand = REG.brand;
      uiObj.rng = ctx.rng;
      uiObj.texlab = ctx.texlab;
      uiObj.quality = ctx.quality;
      uiObj.seed = ctx.seed;
      uiObj.t = ctx.t;
      uiObj.variant = ctx.variant;
      uiObj.shot = ctx.shot;
      uiObj.rung = ctx.rung;
      return uiObj;
    },

    /**
     * THE OVERLAY IS REDRAWN ON CHANGE, NOT ON FRAME. This is the single most important
     * rule in this file and it came out of a measurement.
     *
     * Touching a Canvas2D surface makes the browser re-upload the WHOLE layer to the
     * compositor, whatever the dirty rect was. Measured on this box in loop-only mode
     * (no GL work at all), with the HUD redrawn every frame:
     *     overlay at dpr 2, every frame  -> 28.2% of frames dropped
     *     overlay at dpr 1, every frame  ->  9.1% dropped
     *     no overlay at all              ->  4.1% dropped, p95 16.8 ms
     * The Canvas2D DRAW itself measured 0.30 ms p95 — it was never the draw. It was the
     * per-frame re-upload and composite of a 0.33-1.3 MP layer.
     *
     * A HUD changes perhaps ten times a second. Redrawing it sixty times a second buys
     * nothing and costs a layer upload every frame, on a phone as well as here. So the
     * runtime redraws only when something actually changed, plus a slow keep-alive so
     * animated elements still move. A piece that genuinely needs per-frame animation
     * calls `ui.markDirty()` and is billed for it in the `overlay` budget line.
     */
    shouldDraw(epoch, tick, maxStaleTicks) {
      if (fullDirty || drN > 0) return true;
      if (epoch !== lastEpoch) return true;
      if (maxStaleTicks > 0 && (tick - lastDrawTick) >= maxStaleTicks) return true;
      return false;
    },
    noteDrawn(epoch, tick) { lastEpoch = epoch; lastDrawTick = tick; },

    /**
     * draw(t, shot, ctx). Allocation-free on the steady-state path: the ui object is
     * reused, the transform is set with numbers, and nothing here builds a string.
     */
    draw(t, shot, ctx) {
      const s = fit * dpr;
      c2d.setTransform(1, 0, 0, 1, 0, 0);
      if (fullDirty || drN === 0) {
        c2d.clearRect(0, 0, canvas.width, canvas.height);
      } else {
        for (let i = 0; i < drN; i++) {
          c2d.clearRect(
            (drX[i] * fit + offX) * dpr, (drY[i] * fit + offY) * dpr,
            drW[i] * fit * dpr, drH[i] * fit * dpr
          );
        }
      }
      c2d.setTransform(s, 0, 0, s, offX * dpr, offY * dpr);
      const ui = api.uiCtx(ctx);

      const hudVisible = ctx.forceHud === null || ctx.forceHud === undefined
        ? (shot && shot.hud && shot.hud.visible)
        : !!ctx.forceHud;
      if (hudVisible && REG.ui.hud) {
        try { REG.ui.hud.draw(c2d, t, shot.hud, ui); } catch (e) { overlayErr('hud', e); }
      }
      if (shot && shot.callout && shot.callout.visible && REG.ui.callout) {
        try { REG.ui.callout.draw(c2d, t, shot.callout, ui); } catch (e) { overlayErr('callout', e); }
      }
      const screensOn = ctx.forceUI === null || ctx.forceUI === undefined ? true : !!ctx.forceUI;
      if (screensOn && shot && shot.ui && shot.ui.screen) {
        const slot = SCREEN_SLOT[shot.ui.screen];
        const impl = slot && REG.ui[slot];
        if (impl) { try { impl.draw(c2d, t, shot.ui.state || {}, ui); } catch (e) { overlayErr('screen', e); } }
      }
      // The touch controller draws LAST and on top of everything: it is the layer the
      // player's thumbs live on and it must never be occluded by a menu.
      if (REG.controller && typeof REG.controller.draw === 'function') {
        try { REG.controller.draw(c2d, t, ui); } catch (e) { overlayErr('controller', e); }
      }

      c2d.setTransform(1, 0, 0, 1, 0, 0);
      fullDirty = false;
      drN = 0;
    },
  };
  return api;
}

let overlayErrN = 0;
function overlayErr(label, e) {
  if (overlayErrN++ > 8) return;      // never spam the console from the frame path
  console.error(`[overlay] ${label} threw:`, e);
  (window.__BLITZ_ERRORS__ = window.__BLITZ_ERRORS__ || []).push(`[overlay] ${label}: ${e && e.message}`);
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

export default { createOverlay, createRuntimeOverlay, LOGICAL_W, LOGICAL_H };
