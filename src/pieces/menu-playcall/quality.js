// PIECE menu-playcall — the one quality scalar.
//
// Kept in its own module so `applyRung` can set it without importing the bake modules
// in a cycle (screen.js -> card.js -> chrome.js all read it; index.js writes it).
// Q is a multiplier on the two things on this screen that cost anything and that a
// floor-tier device does not need: the plate grain and the selection halo's blur.
// Q = 0 does not remove the halo, it removes its SHADOW — the stroke stays, so the
// selection is never invisible on a cheap phone.

let Q = 1;

export function setQuality(k) { Q = Math.max(0, Math.min(1, k)); }
export function quality() { return Q; }

export default { setQuality, quality };
