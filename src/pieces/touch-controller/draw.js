// PIECE touch-controller — THE FRAME PATH.
//
// BUDGET: 1.80 ms at 60 Hz, 4.15 ms at 30 Hz, for the WHOLE overlay — the HUD, the
// callout, any menu screen, and this. So the controller's share is small and this file
// is written to a hard rule:
//
//   NO GRADIENT, NO GLYPH, NO SHADOW, NO FILTER, NO CLIP, NO STRING, NO ALLOCATION.
//   Everything expensive is baked in sprites.js and blitted with numeric sub-rects.
//
// The only paths drawn live are three thin strokes — the timing arc, the aim ray and the
// bearing cone — because each of them is a function of a continuously varying number and
// baking 60 phases of each would cost more memory than the strokes cost time. They are
// arcs and lines with no gradient and no shadow, which is the cheap end of Canvas2D.
//
// COORDINATES. The overlay's logical space is a fixed 1920x1080 fitted onto the device
// surface. The LAYOUT, however, is in CSS PIXELS, because reach is physical (see
// layout.js). One number converts between them: `L = ui.visible.w / st.w`, the number of
// logical units in one CSS pixel. It is the same on both axes because the overlay's fit
// is uniform, and it is derived from the surface the controller was actually laid out
// for rather than from a devicePixelRatio the piece would have to guess at.

import { ZONE, TUNING, GRADE, SIDE } from './tuning.js';
import { ZONE_ART } from './layout.js';
import { bake, SHEET, GRADE_TINT } from './sprites.js';
import { armedInfo } from './resolve.js';

const TAU = 6.283185307179586;
const HALF_PI = 1.5707963267948966;

/** Caller-owned scratch for armedInfo. Module-level so the frame path never allocates. */
const ARM = new Int32Array(5);
/** Fallback visible rect when a host hands us no `ui.visible` (capture-mode overlay). */
const VIS = { x: 0, y: 0, w: 1920, h: 1080 };

/** Row lookup for ZONE_ART. Four rows, so a linear scan is the fastest thing available. */
function artOf(zone) {
  for (let i = 0; i < ZONE_ART.length; i++) if (ZONE_ART[i][0] === zone) return ZONE_ART[i];
  return null;
}

/**
 * blit(c2d, img, S, sheet, col, row, ox, oy, L, cxCss, cyCss)
 * One sprite cell, centred on a CSS-px point, at exactly 1:1 device pixels.
 */
function blit(c2d, img, S, sheet, col, row, ox, oy, L, cx, cy) {
  const W = sheet.w, H = sheet.h;
  c2d.drawImage(img,
    col * W * S, row * H * S, W * S, H * S,
    ox + (cx - W * 0.5) * L, oy + (cy - H * 0.5) * L, W * L, H * L);
}

/**
 * draw(c2d, t, ui, st, SP) — the controller layer. Called LAST by the runtime overlay,
 * on top of everything, because it is the layer the player's thumbs live on and it must
 * never be occluded by a menu.
 */
export function draw(c2d, t, ui, st, SP) {
  if (!st) return;
  const v = ui && ui.visible ? ui.visible : VIS;
  const L = v.w / Math.max(16, st.w);
  const ox = v.x, oy = v.y;
  const tick = st.lastTick | 0;

  // Bake on first use, and again only when the device pixel ratio moves. In practice
  // this runs inside foundation's overlay pre-warm, on the loading screen.
  const dpr = Math.max(0.5, Math.min(3, (ui && ui.dpr) || 1));
  if (!SP.ok || SP.dpr !== dpr) bake(SP, dpr, ui && ui.faces);
  const S = SP.dpr;

  c2d.save();
  c2d.lineCap = 'round';
  c2d.lineJoin = 'round';

  /* ================================================================= STICK */
  {
    const a = artOf(ZONE.STICK);
    if (a) {
      const live = st.stickActive;
      // The well is drawn AT THE ANCHOR when live — wherever the thumb landed — and at
      // the pad's home when idle. That is the whole floating-stick idea made visible:
      // the control comes to the thumb, the thumb does not go to the control.
      const wx = live ? st.anchorX : a[1];
      const wy = live ? st.anchorY : a[2];
      c2d.globalAlpha = live ? 1 : 0.85;
      blit(c2d, SP.stick, S, SHEET.stick, live ? 1 : 0, 0, ox, oy, L, wx, wy);
      c2d.globalAlpha = 1;
      if (live) {
        const R = TUNING.stickRadiusPx;
        blit(c2d, SP.head, S, SHEET.head, st.boost ? 1 : 0, 0, ox, oy, L,
          wx + st.stickX * R, wy + st.stickY * R);
      }
    }
  }

  /* ================================================================= TURBO */
  {
    const a = artOf(ZONE.TURBO);
    if (a) {
      const W = SHEET.turbo.w, H = SHEET.turbo.h;
      const dx = ox + (a[1] - W * 0.5) * L;
      const dy = oy + (a[2] - H * 0.5) * L;
      const dw = W * L, dh = H * L;
      // plate
      c2d.drawImage(SP.turbo, 0, 0, W * S, H * S, dx, dy, dw, dh);
      // fill — a horizontal SOURCE SUB-RECT, so a draining meter is one blit and not a
      // re-render. This is the "bake once, blit" rule applied to the one element on the
      // controller that changes every single tick it is held.
      const f = st.fuel / TUNING.fuelMax;
      if (f > 0.001) {
        c2d.drawImage(SP.turbo,
          0, H * S, W * S * f, H * S,
          dx, dy, dw * f, dh);
      }
      // white-hot leading smear at the bar's edge. Same source geometry as the fill row,
      // so it lands inside the bar's band and never over the word.
      if (f > 0.06 && f < 0.975) {
        const lead = 13 * L;
        c2d.globalAlpha = 0.9;
        c2d.drawImage(SP.turbo, 0, H * S * 2, W * S, H * S,
          dx + dw * f - lead, dy, lead, dh);
        c2d.globalAlpha = 1;
      }
      if (tick < st.overheatUntil) {
        // Overheat pulses on SIM TIME, not on wall time: (tick>>2)&1 is a 7.5 Hz square
        // wave that is identical at 60 Hz and at 30 Hz present.
        c2d.globalAlpha = ((tick >> 2) & 1) ? 1 : 0.45;
        c2d.drawImage(SP.turbo, 0, H * S * 3, W * S, H * S, dx, dy, dw, dh);
        c2d.globalAlpha = 1;
      } else if (st.turbo) {
        c2d.drawImage(SP.turbo, 0, H * S * 4, W * S, H * S, dx, dy, dw, dh);
      }
    }
  }

  /* ============================================================== PASS PAD */
  {
    const a = artOf(ZONE.PASS);
    if (a) {
      blit(c2d, SP.pass, S, SHEET.pass, st.aiming ? 1 : 0, 0, ox, oy, L, a[1], a[2]);

      if (st.aiming) {
        const px = ox + a[1] * L, py = oy + a[2] * L;

        // THE BEARING CONE. Two faint lines at +/- 40 degrees around the flick direction,
        // drawn FROM THE PASSER, because the cone is measured against each receiver's
        // bearing from the passer and not from the thumb. Drawing it anywhere else would
        // be drawing a lie about how the selection works.
        if (st.aimMag >= TUNING.aimFlickPx && st.tgtN > 0) {
          const qx = ox + st.passerX * L, qy = oy + st.passerY * L;
          const len = 260 * L;
          c2d.lineWidth = 1.5 * L;
          c2d.strokeStyle = 'rgba(255,198,30,0.22)';
          c2d.beginPath();
          c2d.moveTo(qx + Math.cos(st.aimDirRad - TUNING.aimConeRad) * len,
            qy + Math.sin(st.aimDirRad - TUNING.aimConeRad) * len);
          c2d.lineTo(qx, qy);
          c2d.lineTo(qx + Math.cos(st.aimDirRad + TUNING.aimConeRad) * len,
            qy + Math.sin(st.aimDirRad + TUNING.aimConeRad) * len);
          c2d.stroke();
        }

        // The aim ray: the thumb's own vector, off the pad. Short, so it never covers the
        // part of the field the player is reading.
        if (st.aimMag > 4) {
          const m = Math.min(st.aimMag, 84);
          const ux = st.aimDx / st.aimMag, uy = st.aimDy / st.aimMag;
          c2d.lineWidth = 4 * L;
          c2d.strokeStyle = st.aimLatched >= 0 ? '#ffe9a3' : '#ffc61e';
          c2d.beginPath();
          c2d.moveTo(px, py);
          c2d.lineTo(px + ux * m * L, py + uy * m * L);
          c2d.stroke();
        }

        // receiver icons, hot row for whichever man is currently selected
        const sel = st.aimLatched >= 0 ? st.aimLatched : st.aimBearingPick;
        for (let i = 0; i < st.tgtN; i++) {
          const num = i % 6;
          const hot = (i === sel) || (sel < 0 && i === st.tgtPrimary) ? 1 : 0;
          blit(c2d, SP.recv, S, SHEET.recv, num, hot, ox, oy, L, st.tgtX[i], st.tgtY[i]);
        }
      }
    }
  }

  /* ============================================================ ACTION PAD */
  {
    const a = artOf(ZONE.ACTION);
    if (a) {
      const side = st.side < 0 || st.side > SIDE.DEF ? 0 : st.side;
      blit(c2d, SP.pad, S, SHEET.pad, st.btnA ? 1 : 0, side, ox, oy, L, a[1], a[2]);

      const px = ox + a[1] * L, py = oy + a[2] * L;

      // THE TIMING ARC — the only reason a window is learnable on a phone.
      //
      // While an opportunity is open, a ring around the pad drains clockwise over the
      // window's own span, coloured by the band the CURRENT tick is in: cyan while it is
      // still early, gold through the perfect band, orange once it is late. A player who
      // presses when the ring is gold gets a PERFECT, and after about three of them they
      // stop watching the ring and start feeling the window. That transfer is the entire
      // point; a window with no visible shape can only ever be guessed at.
      if (armedInfo(st, tick, ARM)) {
        const span = ARM[2] > 0 ? ARM[2] : 1;
        const frac = Math.max(0, Math.min(1, (ARM[3] + 1) / (span + 1)));
        const band = ARM[4];
        // Radius 56, not 60: the pad's centre sits 56 CSS px from the right edge of a
        // 390 pt screen, and a 60 px arc with a 5 px stroke ran off it.
        c2d.lineWidth = 4.5 * L;
        c2d.strokeStyle = band === 1 ? '#ffc61e' : band === 0 ? '#29c8ff' : '#ff5a2b';
        c2d.beginPath();
        c2d.arc(px, py, 56 * L, -HALF_PI, -HALF_PI + TAU * frac);
        c2d.stroke();
      }

      // THE GRADE FLASH. What you just got, for 20 ticks, in the grade's colour.
      if (tick < st.flashUntil && st.grade !== GRADE.UNARMED) {
        const age = TUNING.flashTicks - (st.flashUntil - tick);
        c2d.globalAlpha = Math.max(0, 1 - age / TUNING.flashTicks);
        blit(c2d, SP.ring, S, SHEET.ring, st.grade, 0, ox, oy, L, a[1], a[2]);
        c2d.globalAlpha = 1;
      }
    }
  }

  c2d.restore();
}

export default { draw, GRADE_TINT };
