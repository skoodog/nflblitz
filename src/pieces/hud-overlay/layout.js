// PIECE hud-overlay — THUMB-SAFE LAYOUT.
//
// The bar puts TURBO in the bottom-left corner. On a phone that is precisely
// where the left thumb rests, so the shipped meter has to clear the thumb's
// resting arc while still reading as the bar's plate. This module owns that one
// decision so the shipped draw() and the iso_hud_thumbmask proof sheet cannot
// disagree — the sheet calls exactly these functions.
//
// The arc model: a thumb pivots from just below the lower corner of the screen.
// What matters here is the OCCLUSION disc — the part of the panel the hand and
// thumb actually cover while resting on a virtual stick — not the full reach
// sweep, which on a landscape phone would be most of the screen. Measured against
// the touch-controller's stick placement that disc is about 0.30 of the short
// edge, capped at 0.20 of the long edge so it never swallows a tablet.

export const TURBO_BOTTOM_INSET = 44;

/** Left thumb resting arc in LOGICAL coordinates, for a visible rect. */
export function thumbArc(vx, vy, vw, vh) {
  return {
    cx: vx + vw * 0.055,
    cy: vy + vh * 1.02,
    r: Math.min(vh * 0.30, vw * 0.20),
  };
}

/**
 * Top edge of the TURBO plate, logical px.
 *   plateX / plateH / plateMg  the meter's own geometry
 *   lift                       false on the capture path (match the bar exactly)
 */
export function turboTop(vx, vy, vw, vh, plateX, plateH, plateMg, lift) {
  const base = (vy + vh) - TURBO_BOTTOM_INSET - plateH - plateMg;
  if (!lift) return base;
  const a = thumbArc(vx, vy, vw, vh);
  const dx = (plateX + 6) - a.cx;
  const inside = a.r * a.r - dx * dx;
  if (inside <= 0) return base;
  const need = a.cy - Math.sqrt(inside) - plateH - plateMg - 12;
  return Math.min(base, Math.max(vy + vh * 0.34, need));
}

export default { thumbArc, turboTop, TURBO_BOTTOM_INSET };
