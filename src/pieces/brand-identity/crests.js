// PIECE brand-identity — the crest generator: 32 club marks, drawn as
// heavy ILLUSTRATED mascots in the concept sheet's idiom.
//
// The bar's crest language is not a flat vector logo: it is a chunky painted
// mascot head with a black keyline, faceted plate shading, near-white specular
// slivers, hot glowing eyes, a team-colour shard burst behind and a scratch +
// grain finish. Club primary marks are flat vector; dropped into this
// treatment they would read as clip art. So every club is rendered as its OWN
// mascot / identity in that painted style, in that club's real official colours.
//
// Everything is authored in a 1000x1000 unit space and scaled to the requested
// size, so a crest is sharp at 24 px on a HUD chip and at 900 px on a hero card.
// Deterministic: no Math.random, no clocks.

import {
  mkCanvas, plate, line, spec, sym, lin, rad, mirrorClose,
  lighten, darken, mix, rgba, hex2rgb,
  scratchPass, grainPass, sheenPass, innerGlowPass, shardBurst, pathOf, rr,
} from './gfx.js';
import { byId } from './teams.js';
import { REG } from '../../foundation/registry.js';

const U = 1000;
const EYE = '#ffc247';
const EYE_HOT = '#fff6d8';

/* ------------------------------------------------------------------ shared */

function plateFill(c, box, base, hi, lo, dir) {
  const [x, y, w, h] = box;
  const a = dir === undefined ? 1.05 : dir;   // light from upper-left
  const dx = Math.cos(a), dy = Math.sin(a);
  const L = Math.max(w, h) * 0.75;
  const cx = x + w / 2, cy = y + h / 2;
  return lin(c, cx - dx * L, cy - dy * L, cx + dx * L, cy + dy * L, [
    [0.00, hi],
    [0.20, lighten(base, 0.22)],
    [0.44, base],
    [0.70, mix(base, lo, 0.65)],
    [1.00, lo],
  ]);
}

/** Hot amber eye with a black socket and a specular pip. */
function eye(c, cx, cy, rx, ry, rot = 0, hue) {
  const h0 = hue || EYE;
  c.save();
  c.translate(cx, cy);
  c.rotate(rot);
  c.beginPath();
  c.ellipse(0, 0, rx * 1.45, ry * 1.5, 0, 0, Math.PI * 2);
  c.fillStyle = '#07070a';
  c.fill();
  c.beginPath();
  c.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  c.fillStyle = rad(c, -rx * 0.22, -ry * 0.28, 0, 0, 0, rx * 1.2, [
    [0, EYE_HOT], [0.36, h0], [0.8, darken(h0, 0.42)], [1, darken(h0, 0.7)],
  ]);
  c.fill();
  c.beginPath();
  c.ellipse(-rx * 0.34, -ry * 0.36, rx * 0.3, ry * 0.34, 0, 0, Math.PI * 2);
  c.fillStyle = 'rgba(255,255,255,0.8)';
  c.fill();
  c.restore();
}

/** A slit pupil over an amber iris — the feline / reptile read. */
function slitEye(c, cx, cy, rx, ry, rot, hue) {
  eye(c, cx, cy, rx, ry, rot, hue);
  c.save();
  c.translate(cx, cy);
  c.rotate(rot);
  c.beginPath();
  c.ellipse(0, 0, rx * 0.22, ry * 0.86, 0, 0, Math.PI * 2);
  c.fillStyle = 'rgba(6,4,2,0.92)';
  c.fill();
  c.restore();
}

/** One ivory tooth: [x,y] apex pointing along `dir` (+1 down, -1 up). */
function fang(c, x, yBase, w, h, dir, ink) {
  const s = dir >= 0 ? 1 : -1;
  plate(c, [
    [x - w / 2, yBase], [x + w / 2, yBase],
    [x + w * 0.26, yBase + s * h], [x, yBase + s * h * 1.28], [x - w * 0.26, yBase + s * h],
  ], {
    ink: Math.max(5, w * 0.22), inkColor: ink,
    fill: lin(c, x - w / 2, yBase, x + w / 2, yBase + s * h * 1.3,
      s > 0 ? [[0, '#ffffff'], [0.45, '#efeadd'], [1, '#a2988a']]
            : [[0, '#9b9284'], [0.5, '#ded9cb'], [1, '#ffffff']]),
  });
}

/** Hard-edged facet: a light or dark polygon laid over a filled mass. */
function facet(c, seg, color, alpha) {
  pathOf(c, seg, true);
  c.fillStyle = rgba(color, alpha);
  c.fill();
}

function inkOf(A, w) { return { ink: w === undefined ? 22 : w, inkColor: A.ink }; }

/* ============================================================ CHI — BEAR ==== */

function drawBear(c, A) {
  const base = A.body, hi = A.bodyHi, lo = A.bodyLo, ink = A.ink;
  const I = inkOf(A);

  // ears — small, set wide and high, chewed edges
  sym(c, (cc) => {
    plate(cc, [[664, 328], [716, 196], [820, 200], [860, 300], [812, 396], [706, 404]],
      Object.assign({}, I, { ink: 20, fill: plateFill(cc, [664, 196, 196, 208], darken(base, 0.34), lighten(base, 0.2), darken(lo, 0.42), 1.1) }));
    pathOf(cc, [[704, 326], [742, 240], [812, 244], [834, 306], [796, 366], [726, 372]], true);
    cc.fillStyle = lin(cc, 704, 240, 834, 372, [[0, '#5b2a16'], [0.6, '#2c1108'], [1, '#120602']]); cc.fill();
    facet(cc, [[716, 300], [756, 254], [800, 262], [770, 316]], A.trim, 0.16);
  });

  // head mass — a wedge: broad at the brow, tapering to the jaw
  plate(c, mirrorClose([
    [500, 918],
    ['c', 608, 912, 674, 866, 708, 786],
    ['c', 764, 664, 794, 542, 776, 452],
    ['c', 750, 338, 652, 280, 500, 278],
  ]), Object.assign({}, I, { ink: 27, fill: plateFill(c, [224, 278, 552, 640], base, hi, lo, 1.0) }));

  // faceting: hard light plane upper-left, shadow plane lower-right
  facet(c, [[500, 288], [230, 456], [258, 704], [500, 786]], hi, 0.22);
  facet(c, [[500, 288], [772, 456], [742, 780], [500, 812]], lo, 0.42);
  facet(c, [[276, 386], [438, 306], [452, 378], [306, 462]], '#ffffff', 0.16);
  facet(c, [[500, 288], [612, 322], [560, 470], [500, 460]], lo, 0.16);
  // fur direction strokes
  for (let i = 0; i < 5; i++) {
    const s = i - 2;
    line(c, [[500 + s * 96, 300 + Math.abs(s) * 26], ['q', 500 + s * 128, 380, 500 + s * 116, 448]], 8, rgba(ink, 0.3));
  }

  // brow ridges — two separate wedges with a deep furrow between them
  sym(c, (cc) => {
    plate(cc, [[534, 418], [660, 358], [762, 424], [744, 512], [618, 470], [536, 468]],
      Object.assign({}, I, { ink: 19, fill: plateFill(cc, [534, 358, 228, 154], lighten(base, 0.2), lighten(hi, 0.24), darken(lo, 0.24), 1.25) }));
    facet(cc, [[548, 442], [656, 402], [750, 462], [738, 506], [614, 466], [548, 464]], lo, 0.45);
    spec(cc, [[566, 428], [648, 386], [676, 410], [582, 452]], 'rgba(255,255,255,0.22)');
  });
  // furrow
  plate(c, [[466, 388], [500, 468], [534, 388], [500, 356]], { ink: 12, inkColor: ink, fill: rgba(darken(lo, 0.4), 0.95) });
  line(c, [[470, 396], [452, 480]], 14, rgba(ink, 0.88));
  line(c, [[530, 396], [548, 480]], 14, rgba(ink, 0.88));

  eye(c, 646, 494, 29, 20, -0.3);
  eye(c, 354, 494, 29, 20, 0.3);

  // cheek / fur tufts framing the mouth — this is what stops the snout blobbing
  sym(c, (cc) => {
    plate(cc, [[598, 578], [742, 626], [772, 758], [692, 872], [566, 842], [560, 668]],
      Object.assign({}, I, { ink: 23, fill: plateFill(cc, [560, 578, 212, 294], darken(base, 0.14), lighten(base, 0.42), darken(lo, 0.3), 0.86) }));
    line(cc, [[632, 644], ['c', 696, 686, 716, 760, 696, 824]], 9, rgba(ink, 0.55));
    line(cc, [[600, 692], ['c', 654, 726, 668, 786, 652, 836]], 8, rgba(ink, 0.4));
  });

  // narrow snout bridge from between the eyes down to the nose
  plate(c, mirrorClose([
    [500, 462], ['c', 574, 476, 596, 540, 592, 606], ['c', 588, 656, 552, 682, 500, 686],
  ]), Object.assign({}, I, { ink: 22, fill: plateFill(c, [408, 462, 184, 224], lighten(base, 0.24), lighten(hi, 0.34), mix(base, lo, 0.68), 1.12) }));
  facet(c, [[500, 470], [588, 540], [578, 656], [500, 674]], lo, 0.3);
  spec(c, [[424, 520], [478, 490], [482, 528], [426, 558]], 'rgba(255,255,255,0.34)');

  // nose — small, wet, high on the muzzle
  plate(c, mirrorClose([
    [500, 570], ['c', 568, 562, 600, 596, 598, 632], ['c', 596, 668, 552, 690, 500, 702],
  ]), { ink: 14, inkColor: '#000000', fill: lin(c, 436, 566, 580, 710, [[0, '#61616e'], [0.3, '#22222b'], [1, '#07070a']]) });
  spec(c, [[452, 590], [506, 580], [500, 606], [452, 614]], 'rgba(255,255,255,0.42)');
  pathOf(c, [[466, 636], ['q', 448, 662, 472, 674], ['q', 488, 650, 480, 636]], true);
  c.fillStyle = 'rgba(0,0,0,0.9)'; c.fill();
  pathOf(c, [[534, 636], ['q', 552, 662, 528, 674], ['q', 512, 650, 520, 636]], true);
  c.fillStyle = 'rgba(0,0,0,0.9)'; c.fill();

  // ROAR — wide open mouth, wider than the snout, lips curled back
  plate(c, mirrorClose([
    [500, 690], ['c', 632, 692, 694, 738, 682, 802], ['c', 664, 892, 588, 942, 500, 946],
  ]), { ink: 24, inkColor: ink, fill: rad(c, 500, 800, 20, 500, 812, 220, [
    [0, '#7d1622'], [0.35, '#520d16'], [0.75, '#26060b'], [1, '#0e0305']]) });
  // curled upper lip
  line(c, [[326, 706], ['c', 402, 762, 598, 762, 674, 706]], 18, rgba(ink, 0.92));
  pathOf(c, [[318, 700], ['c', 400, 756, 600, 756, 682, 700], ['c', 620, 716, 380, 716, 318, 700]], true);
  c.fillStyle = rgba(lighten(base, 0.3), 0.5); c.fill();

  fang(c, 596, 726, 46, 104, 1, ink);
  fang(c, 404, 726, 46, 104, 1, ink);
  fang(c, 530, 726, 28, 52, 1, ink);
  fang(c, 470, 726, 28, 52, 1, ink);
  fang(c, 566, 926, 34, 62, -1, ink);
  fang(c, 434, 926, 34, 62, -1, ink);
  pathOf(c, [[444, 884], ['q', 500, 852, 556, 884], ['q', 500, 924, 444, 884]], true);
  c.fillStyle = 'rgba(184,54,64,0.55)'; c.fill();
}

/* ========================================================= RAPTOR HEADS ==== */
// One parametric bird-of-prey profile facing left. Real club differences ride
// on the beak, the crown treatment, the mask and the accent feather colour.

const RAPTOR = {
  eagle: { head: 'hi', len: 250, hook: 1.0, beak: '#f2b32b', beakHi: '#ffeaa0', beakLo: '#7a4c02',
    crown: 'swept', eyeHue: '#ffd24a', gape: 0.9 },
  raven: { head: 'body', len: 214, hook: 0.30, beak: '#1c1c24', beakHi: '#787890', beakLo: '#020204',
    crown: 'shag', eyeHue: '#ffc82f', gape: 0.55, sheen: '#7c5ce0' },
  falcon: { head: 'body', len: 226, hook: 0.95, beak: '#a2a8b2', beakHi: '#e6ecf2', beakLo: '#1a1c22',
    crown: 'blade', eyeHue: '#ffd24a', malar: true, gape: 0.5 },
  cardinal: { head: 'body', len: 168, hook: 0.05, beak: '#ffb612', beakHi: '#fff0b0', beakLo: '#8a5a02',
    crown: 'tall', eyeHue: '#fff6d8', mask: '#0b0b0d', gape: 0.4 },
  seahawk: { head: 'body', len: 240, hook: 0.85, beak: '#c4cbd2', beakHi: '#f4f8fb', beakLo: '#2a3038',
    crown: 'blade', eyeHue: '#c8ee72', flash: true, gape: 0.7 },
};

/** Beak authored in a local frame: base at (0,0), tip at (-100, 52), scaled by len. */
function beakSeg(len, hook, dx, dy) {
  const s = len / 100;
  const P = (x, y) => [396 + dx + x * s, 430 + dy + y * s];
  const h = hook;
  return [
    ['m', ...P(2, -10)],
    ['c', ...P(-40, -8), ...P(-76, 8), ...P(-100, 46)],
    ['c', ...P(-104 - 10 * h, 60 + 16 * h), ...P(-98 + 4 * h, 76 + 26 * h), ...P(-80 + 4 * h, 78 + 22 * h)],
    ['c', ...P(-70, 66), ...P(-68, 54), ...P(-74, 42)],
    ['c', ...P(-50, 24), ...P(-24, 16), ...P(4, 22)],
  ];
}

function drawRaptor(c, A) {
  const P = RAPTOR[(A.p && A.p.kind) || 'eagle'] || RAPTOR.eagle;
  const base = A.body, hi = A.bodyHi, lo = A.bodyLo, ink = A.ink;
  const skull = P.head === 'hi' ? lighten(hi, 0.34) : base;
  const skullHi = P.head === 'hi' ? '#ffffff' : hi;
  const skullLo = P.head === 'hi' ? mix(hi, lo, 0.55) : lo;
  const I = inkOf(A);

  /* ---- nape / crown feathers, drawn first so the skull overlaps them ---- */
  const crownSpec = {
    swept: [[688, 320, 236, -0.66, 76], [726, 386, 274, -0.32, 86], [736, 466, 282, -0.02, 84], [720, 546, 252, 0.28, 76], [688, 618, 210, 0.54, 64]],
    shag: [[684, 316, 196, -0.76, 94], [724, 378, 232, -0.38, 100], [740, 458, 238, -0.02, 98], [726, 540, 220, 0.32, 92], [688, 612, 186, 0.62, 80]],
    blade: [[684, 312, 288, -0.60, 58], [724, 376, 330, -0.28, 66], [736, 456, 336, 0.02, 64], [720, 538, 300, 0.32, 58], [684, 608, 248, 0.58, 50]],
    tall: [[544, 320, 274, -1.50, 74], [618, 292, 306, -1.18, 82], [694, 314, 282, -0.82, 78], [744, 388, 236, -0.38, 72], [752, 466, 208, 0.02, 66]],
  }[P.crown] || [];
  for (let i = 0; i < crownSpec.length; i++) {
    const [x0, y0, len, ang, w] = crownSpec[i];
    const dx = Math.cos(ang), dy = Math.sin(ang);
    const px = -dy, py = dx;
    const tip = [x0 + dx * len, y0 + dy * len];
    const seg = [
      [x0 + px * w * 0.5, y0 + py * w * 0.5],
      ['q', x0 + dx * len * 0.55 + px * w * 0.72, y0 + dy * len * 0.55 + py * w * 0.72, tip[0], tip[1]],
      ['q', x0 + dx * len * 0.5 - px * w * 0.6, y0 + dy * len * 0.5 - py * w * 0.6, x0 - px * w * 0.5, y0 - py * w * 0.5],
    ];
    const shade = i % 2 ? 0.18 : 0.0;
    plate(c, seg, Object.assign({}, I, {
      ink: 18,
      fill: lin(c, x0, y0, tip[0], tip[1], [
        [0, lighten(base, 0.34 - shade)], [0.32, mix(base, lo, 0.24 + shade)], [1, darken(lo, 0.24)],
      ]),
    }));
    line(c, [[x0 + dx * len * 0.20, y0 + dy * len * 0.20], [tip[0] - dx * 16, tip[1] - dy * 16]], 7, rgba(ink, 0.5));
  }

  /* ---- neck / chest feathers ------------------------------------------- */
  plate(c, [
    [452, 712], ['c', 556, 736, 664, 768, 736, 830], [778, 906], [652, 936],
    ['c', 554, 910, 466, 866, 400, 802],
  ], Object.assign({}, I, { ink: 24, fill: plateFill(c, [400, 712, 378, 224], darken(base, 0.3), lighten(base, 0.14), darken(lo, 0.52), 1.2) }));
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    line(c, [[438 + t * 246, 786 + t * 92], ['q', 498 + t * 236, 834 + t * 82, 562 + t * 212, 820 + t * 92]], 9, rgba(ink, 0.5));
  }
  spec(c, [[466, 758], [600, 794], [592, 824], [458, 790]], rgba(hi, 0.2));

  /* ---- skull: an aggressive wedge, heavy at the back, tapering forward -- */
  plate(c, [
    ['m', 392, 436],
    ['c', 406, 358, 472, 300, 570, 292],
    ['c', 672, 284, 752, 338, 772, 428],
    ['c', 790, 512, 766, 596, 712, 654],
    ['c', 656, 714, 570, 738, 494, 722],
    ['c', 440, 710, 402, 660, 388, 596],
    ['c', 378, 542, 382, 484, 392, 436],
  ], Object.assign({}, I, { ink: 26, fill: plateFill(c, [378, 284, 412, 454], skull, skullHi, skullLo, 1.0) }));
  facet(c, [[586, 296], [774, 452], [746, 640], [582, 726]], skullLo, 0.36);
  facet(c, [[552, 300], [396, 460], [400, 622], [500, 716]], skullHi, 0.18);
  facet(c, [[430, 396], [536, 322], [566, 368], [456, 448]], '#ffffff', 0.18);
  if (P.sheen) facet(c, [[604, 308], [766, 442], [736, 570], [634, 508]], P.sheen, 0.22);
  if (P.flash) {
    // seahawk's action-green flash sweeping back from the eye
    pathOf(c, [[420, 462], ['c', 512, 428, 626, 424, 726, 452], [712, 508],
      ['c', 618, 480, 512, 484, 432, 512]], true);
    c.fillStyle = lin(c, 420, 430, 726, 512, [
      [0, lighten(A.trim, 0.5)], [0.45, A.trim], [1, darken(A.trim, 0.5)]]);
    c.fill();
    c.strokeStyle = rgba(ink, 0.8); c.lineWidth = 10; c.stroke();
  }
  if (P.mask) {
    // cardinal's black face mask: a patch around the eye plus a throat bib
    pathOf(c, [
      ['m', 386, 452],
      ['c', 424, 424, 500, 428, 542, 470],
      ['c', 578, 506, 574, 566, 534, 598],
      ['c', 492, 630, 428, 622, 400, 582],
      ['c', 378, 546, 372, 480, 386, 452],
    ], true);
    c.fillStyle = lin(c, 386, 430, 570, 620, [[0, '#33333a'], [0.4, P.mask], [1, '#000000']]);
    c.fill();
    c.strokeStyle = rgba(ink, 0.7); c.lineWidth = 9; c.stroke();
    facet(c, [[402, 470], [512, 470], [524, 516], [406, 512]], '#ffffff', 0.08);
    // throat bib under the beak
    pathOf(c, [[396, 588], ['c', 440, 640, 468, 686, 466, 728], [400, 736],
      ['c', 384, 682, 376, 632, 380, 592]], true);
    c.fillStyle = lin(c, 380, 588, 470, 736, [[0, '#26262c'], [1, '#000000']]);
    c.fill();
  }
  if (P.malar) {
    // falcon's malar (moustachial) stripe dropping from the eye
    pathOf(c, [[452, 546], ['c', 476, 616, 480, 676, 466, 726], [524, 720],
      ['c', 534, 656, 522, 596, 500, 540]], true);
    c.fillStyle = lin(c, 452, 546, 524, 726, [[0, lighten(A.trim, 0.4)], [1, darken(A.trim, 0.45)]]);
    c.fill();
    c.strokeStyle = rgba(ink, 0.75); c.lineWidth = 9; c.stroke();
  }

  /* ---- brow: a hard overhanging wedge, thick over the beak, thin at back */
  plate(c, [
    [356, 490], [366, 424],
    ['c', 452, 378, 588, 376, 686, 412],
    [676, 452],
    ['c', 578, 420, 462, 430, 392, 470],
  ], Object.assign({}, I, {
    ink: 18,
    fill: lin(c, 380, 384, 660, 486, [
      [0, mix(skullLo, '#ffffff', 0.30)], [0.42, mix(skullLo, lo, 0.5)], [1, darken(lo, 0.4)],
    ]),
  }));
  facet(c, [[364, 456], [470, 412], [660, 420], [668, 444], [470, 444], [376, 486]], '#000000', 0.34);

  eye(c, 470, 508, 33, 25, -0.16, P.eyeHue);

  /* ---- beak: hooked upper mandible, dark gape, lower mandible ----------- */
  const g = P.gape;
  const gy = 74 + g * 46;

  // gape interior first
  pathOf(c, [[400, 500], [396 - P.len * 0.9, 530 + P.len * 0.10], [400 - P.len * 0.86, 552 + gy * 0.7], [404, 540 + gy * 0.55]], true);
  c.fillStyle = lin(c, 400, 500, 396 - P.len, 560 + gy, [[0, '#5c1018'], [0.5, '#2c070c'], [1, '#0c0204']]);
  c.fill();

  // lower mandible
  plate(c, beakSeg(P.len * 0.92, P.hook * 0.5, -4, gy), Object.assign({}, I, {
    ink: 20,
    fill: lin(c, 392, 430 + gy, 396 - P.len, 500 + gy, [
      [0, mix(P.beak, P.beakHi, 0.35)], [0.45, mix(P.beak, P.beakLo, 0.35)], [1, P.beakLo],
    ]),
  }));

  // upper mandible
  plate(c, beakSeg(P.len, P.hook, 0, 0), Object.assign({}, I, {
    ink: 22,
    fill: lin(c, 400, 408, 396 - P.len * 0.9, 430 + P.len * 0.6, [
      [0, P.beakHi], [0.20, P.beak], [0.60, mix(P.beak, P.beakLo, 0.55)], [1, P.beakLo],
    ]),
  }));
  {
    const s = P.len / 100;
    const Q = (x, y) => [396 + x * s, 430 + y * s];
    facet(c, [Q(0, -6), Q(-70, 6), Q(-100, 46), Q(-88, 50), Q(-64, 20), Q(-2, 8)], '#ffffff', 0.28);
    facet(c, [Q(-2, 14), Q(-62, 30), Q(-86, 56), Q(-76, 70), Q(-46, 34), Q(0, 20)], '#000000', 0.26);
    // nostril
    c.beginPath();
    c.ellipse(396 - 34 * s, 430 + 12 * s, 13 * s, 8 * s, -0.3, 0, Math.PI * 2);
    c.fillStyle = 'rgba(0,0,0,0.85)'; c.fill();
  }
  // corner of the mouth
  line(c, [[404, 496], [404, 512 + gy * 0.6]], 13, rgba(ink, 0.85));
}

/* ========================================================= FELINE HEADS ==== */

const FELINE = {
  tiger: { pattern: 'stripe', mane: 0, ear: 'round', muzzle: '#f3ede0', patColor: '#0d0a08' },
  lion: { pattern: 'none', mane: 1, ear: 'round', muzzle: null, patColor: null },
  jaguar: { pattern: 'rosette', mane: 0, ear: 'round', muzzle: null, patColor: '#05100f' },
  panther: { pattern: 'none', mane: 0, ear: 'point', muzzle: null, patColor: null },
};

function drawFeline(c, A) {
  const P = FELINE[(A.p && A.p.kind) || 'panther'] || FELINE.panther;
  const base = A.body, hi = A.bodyHi, lo = A.bodyLo, ink = A.ink;
  const I = inkOf(A);

  // mane (lion) — spiked ruff behind everything
  if (P.mane) {
    const n = 15;
    for (let i = 0; i < n; i++) {
      const a = (-Math.PI * 0.5) + (i - (n - 1) / 2) * (Math.PI * 1.62 / n);
      const dx = Math.cos(a), dy = Math.sin(a);
      const len = 400 + 62 * Math.cos(i * 1.7);
      const w = 70;
      const px = -dy, py = dx;
      plate(c, [
        [500 + dx * 190 + px * w, 540 + dy * 190 + py * w],
        ['q', 500 + dx * len * 0.7 + px * w * 0.8, 540 + dy * len * 0.7 + py * w * 0.8, 500 + dx * len, 540 + dy * len],
        ['q', 500 + dx * len * 0.7 - px * w * 0.8, 540 + dy * len * 0.7 - py * w * 0.8, 500 + dx * 190 - px * w, 540 + dy * 190 - py * w],
      ], Object.assign({}, I, {
        ink: 17,
        fill: lin(c, 500 + dx * 180, 540 + dy * 180, 500 + dx * len, 540 + dy * len, [
          [0, lighten(A.trim, i % 2 ? 0.1 : 0.34)], [0.45, mix(A.trim, '#4a3a16', 0.45)], [1, '#140f05'],
        ]),
      }));
    }
  }

  // ears
  sym(c, (cc) => {
    const seg = P.ear === 'point'
      ? [[620, 356], [742, 176], [806, 306], [762, 400]]
      : [[618, 342], ['c', 664, 226, 782, 216, 818, 296], ['c', 848, 358, 812, 414, 748, 424], [652, 400]];
    plate(cc, seg, Object.assign({}, I, { ink: 20, fill: plateFill(cc, [618, 180, 200, 244], darken(base, 0.26), lighten(base, 0.3), darken(lo, 0.4), 1.15) }));
    const inner = P.ear === 'point'
      ? [[654, 350], [738, 226], [782, 314], [750, 380]]
      : [[652, 336], ['c', 690, 254, 776, 250, 800, 306], ['c', 818, 350, 790, 386, 744, 392]];
    pathOf(cc, inner, true);
    cc.fillStyle = lin(cc, 660, 240, 800, 400, [[0, '#7a2430'], [0.6, '#3d0f16'], [1, '#170508']]);
    cc.fill();
  });

  // head mass — wide cheekbones, narrow chin
  plate(c, mirrorClose([
    [500, 900],
    ['c', 626, 894, 704, 840, 748, 748],
    ['c', 792, 656, 800, 552, 772, 466],
    ['c', 736, 350, 646, 288, 500, 286],
  ]), Object.assign({}, I, { ink: 27, fill: plateFill(c, [228, 286, 544, 614], base, hi, lo, 1.0) }));
  facet(c, [[500, 296], [236, 470], [258, 700], [500, 772]], hi, 0.19);
  facet(c, [[500, 296], [768, 470], [744, 736], [500, 792]], lo, 0.38);
  facet(c, [[292, 396], [452, 322], [464, 390], [322, 468]], '#ffffff', 0.15);

  // pattern
  if (P.pattern === 'stripe') {
    const st = [
      [[500, 292], [478, 430], [522, 430]],
      [[418, 318], [352, 452], [404, 448], [452, 330]],
      [[582, 318], [648, 452], [596, 448], [548, 330]],
      [[318, 396], [242, 512], [292, 528], [364, 424]],
      [[682, 396], [758, 512], [708, 528], [636, 424]],
      [[286, 566], [232, 636], [286, 640], [326, 588]],
      [[714, 566], [768, 636], [714, 640], [674, 588]],
    ];
    for (const s of st) { pathOf(c, s, true); c.fillStyle = rgba(P.patColor, 0.92); c.fill(); }
  } else if (P.pattern === 'rosette') {
    const rs = [[318, 400, 26], [372, 350, 20], [286, 470, 22], [356, 486, 16],
      [682, 400, 26], [628, 350, 20], [714, 470, 22], [644, 486, 16],
      [300, 592, 20], [700, 592, 20], [420, 330, 15], [580, 330, 15]];
    for (const [x, y, r] of rs) {
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
      c.strokeStyle = rgba(P.patColor, 0.8); c.lineWidth = r * 0.5; c.stroke();
      c.beginPath(); c.arc(x + r * 0.1, y, r * 0.28, 0, Math.PI * 2);
      c.fillStyle = rgba(P.patColor, 0.7); c.fill();
    }
  }

  // brow
  sym(c, (cc) => {
    plate(cc, [[504, 396], [648, 354], [758, 424], [738, 512], [598, 474], [506, 462]],
      Object.assign({}, I, { ink: 19, fill: plateFill(cc, [504, 354, 254, 158], lighten(base, 0.18), lighten(hi, 0.2), darken(lo, 0.2), 1.25) }));
    facet(cc, [[518, 436], [642, 398], [740, 458], [726, 506], [594, 470], [518, 460]], lo, 0.42);
  });
  line(c, [[476, 388], [458, 466]], 13, rgba(ink, 0.85));
  line(c, [[524, 388], [542, 466]], 13, rgba(ink, 0.85));

  slitEye(c, 640, 492, 34, 24, -0.28);
  slitEye(c, 360, 492, 34, 24, 0.28);

  // muzzle
  const muz = P.muzzle || lighten(base, 0.2);
  plate(c, mirrorClose([
    [500, 556], ['c', 622, 562, 676, 610, 674, 676], ['c', 672, 762, 596, 812, 500, 816],
  ]), Object.assign({}, I, { ink: 22, fill: plateFill(c, [326, 556, 348, 260], muz, lighten(muz, 0.45), mix(muz, lo, 0.72), 1.1) }));
  facet(c, [[500, 566], [668, 656], [654, 762], [500, 796]], lo, 0.28);
  // whisker dots
  for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) {
    const dx = 560 + k * 30, dy = 640 + r * 26 + k * 6;
    for (const s of [1, -1]) {
      c.beginPath(); c.arc(500 + s * (dx - 500), dy, 5.5, 0, Math.PI * 2);
      c.fillStyle = rgba(ink, 0.5); c.fill();
    }
  }

  // nose
  plate(c, mirrorClose([[500, 572], ['c', 560, 566, 600, 594, 598, 630], ['c', 596, 668, 548, 690, 500, 704]]),
    { ink: 14, inkColor: '#000000', fill: lin(c, 430, 566, 580, 712, [[0, '#c0707c'], [0.35, '#7e2a38'], [1, '#2a0810']]) });
  spec(c, [[448, 592], [504, 582], [498, 610], [446, 618]], 'rgba(255,255,255,0.42)');

  // snarl
  plate(c, mirrorClose([
    [500, 704], ['c', 606, 706, 656, 740, 646, 792], ['c', 632, 866, 570, 898, 500, 902],
  ]), { ink: 22, inkColor: ink, fill: lin(c, 500, 704, 500, 902, [[0, '#3f0a12'], [0.42, '#701420'], [1, '#150407']]) });
  line(c, [[364, 716], ['c', 424, 758, 576, 758, 636, 716]], 15, rgba(ink, 0.9));
  fang(c, 590, 726, 42, 104, 1, ink);
  fang(c, 410, 726, 42, 104, 1, ink);
  fang(c, 534, 726, 24, 40, 1, ink);
  fang(c, 466, 726, 24, 40, 1, ink);
  fang(c, 566, 888, 30, 56, -1, ink);
  fang(c, 434, 888, 30, 56, -1, ink);
  pathOf(c, [[450, 860], ['q', 500, 836, 550, 860], ['q', 500, 892, 450, 860]], true);
  c.fillStyle = 'rgba(180,52,64,0.55)'; c.fill();
}

/* ========================================================== CANINE (CLE) ==== */

function drawCanine(c, A) {
  const base = A.body, hi = A.bodyHi, lo = A.bodyLo, ink = A.ink;
  const I = inkOf(A);

  sym(c, (cc) => {
    plate(cc, [[604, 336], [706, 202], [752, 288], [716, 388]],
      Object.assign({}, I, { ink: 20, fill: plateFill(cc, [604, 202, 148, 186], darken(base, 0.34), lighten(base, 0.2), darken(lo, 0.38), 1.15) }));
    pathOf(cc, [[644, 322], [702, 240], [726, 288], [696, 350]], true);
    cc.fillStyle = 'rgba(70,22,10,0.9)'; cc.fill();
  });

  plate(c, mirrorClose([
    [500, 858], ['c', 600, 854, 658, 820, 690, 762], ['c', 740, 678, 766, 592, 766, 506],
    ['c', 766, 398, 720, 314, 624, 282], ['c', 586, 268, 542, 262, 500, 262],
  ]), Object.assign({}, I, { ink: 27, fill: plateFill(c, [234, 262, 532, 596], base, hi, lo, 1.0) }));
  facet(c, [[500, 276], [758, 470], [726, 690], [500, 744]], lo, 0.4);
  facet(c, [[500, 276], [244, 456], [266, 668], [500, 730]], hi, 0.18);
  line(c, [[500, 282], [500, 420]], 11, rgba(ink, 0.72));
  spec(c, [[306, 420], [372, 366], [396, 400], [326, 470]], 'rgba(255,255,255,0.3)');

  sym(c, (cc) => {
    plate(cc, [[504, 388], [626, 350], [726, 404], [720, 500], [586, 470], [506, 452]],
      Object.assign({}, I, { ink: 19, fill: plateFill(cc, [504, 350, 222, 150], lighten(base, 0.2), lighten(hi, 0.2), darken(lo, 0.2), 1.2) }));
    facet(cc, [[518, 434], [622, 400], [706, 446], [700, 494], [584, 468], [518, 452]], lo, 0.42);
  });
  line(c, [[480, 392], [466, 466]], 13, rgba(ink, 0.82));
  line(c, [[520, 392], [534, 466]], 13, rgba(ink, 0.82));
  eye(c, 632, 486, 33, 21, -0.22);
  eye(c, 368, 486, 33, 21, 0.22);

  sym(c, (cc) => {
    plate(cc, [[628, 590], [750, 644], [772, 764], [700, 856], [578, 830], [580, 672]],
      Object.assign({}, I, { ink: 23, fill: plateFill(cc, [578, 590, 194, 266], darken(base, 0.16), lighten(base, 0.4), darken(lo, 0.28), 0.86) }));
    line(cc, [[646, 654], ['c', 704, 694, 722, 762, 704, 820]], 9, rgba(ink, 0.55));
  });

  plate(c, mirrorClose([
    [500, 508], ['c', 624, 514, 694, 574, 698, 650], ['c', 702, 740, 616, 798, 500, 802],
  ]), Object.assign({}, I, { ink: 23, fill: plateFill(c, [302, 508, 396, 294], lighten(base, 0.16), lighten(hi, 0.25), mix(base, lo, 0.78), 1.1) }));
  line(c, [[390, 578], ['q', 500, 552, 610, 578]], 11, rgba(ink, 0.72));
  spec(c, [[366, 610], [448, 586], [442, 626], [364, 646]], 'rgba(255,255,255,0.34)');

  plate(c, mirrorClose([[500, 534], ['c', 548, 524, 590, 548, 590, 582], ['c', 590, 616, 542, 640, 500, 658]]),
    { ink: 15, inkColor: '#000000', fill: lin(c, 430, 530, 570, 668, [[0, '#4b4b55'], [0.3, '#1d1d23'], [1, '#08080a']]) });
  spec(c, [[446, 552], [498, 542], [492, 570], [446, 578]], 'rgba(255,255,255,0.36)');

  plate(c, mirrorClose([
    [500, 676], ['c', 612, 678, 668, 710, 662, 762], ['c', 652, 828, 578, 868, 500, 872],
  ]), { ink: 23, inkColor: ink, fill: lin(c, 500, 676, 500, 872, [[0, '#33070e'], [0.4, '#5e1019'], [1, '#110407']]) });
  line(c, [[346, 682], ['c', 414, 724, 586, 724, 654, 682]], 17, rgba(ink, 0.9));
  fang(c, 642, 694, 42, 92, 1, ink); fang(c, 358, 694, 42, 92, 1, ink);
  fang(c, 574, 694, 27, 48, 1, ink); fang(c, 426, 694, 27, 48, 1, ink);
  fang(c, 500, 694, 29, 40, 1, ink);
  fang(c, 614, 862, 32, 56, -1, ink); fang(c, 386, 862, 32, 56, -1, ink);
  fang(c, 554, 862, 23, 36, -1, ink); fang(c, 446, 862, 23, 36, -1, ink);
  pathOf(c, [[440, 828], ['q', 500, 800, 560, 828], ['q', 500, 862, 440, 828]], true);
  c.fillStyle = 'rgba(158,36,48,0.6)'; c.fill();
}

/* ======================================================= UNGULATE HEADS ==== */

function hornPair(c, A, spec2) {
  const { seg, fillFrom, fillTo, ridge } = spec2;
  sym(c, (cc) => {
    plate(cc, seg, { ink: 22, inkColor: A.ink, fill: lin(cc, fillFrom[0], fillFrom[1], fillTo[0], fillTo[1], ridge) });
  });
}

function drawUngulate(c, A) {
  const kind = (A.p && A.p.kind) || 'ram';
  if (kind === 'ram') return drawRam(c, A);
  if (kind === 'buffalo') return drawBuffalo(c, A);
  if (kind === 'bull') return drawBull(c, A);
  return drawHorse(c, A, kind === 'colt');
}

function drawRam(c, A) {
  const base = A.body, hi = A.bodyHi, lo = A.bodyLo, ink = A.ink;
  const I = inkOf(A);
  const horn = A.trim, hornHi = lighten(A.trim, 0.62), hornLo = darken(A.trim, 0.72);

  // massive curled horns — a thick outer sweep spiralling into a tight inner coil
  sym(c, (cc) => {
    plate(cc, [
      [586, 336],
      ['c', 748, 288, 902, 346, 946, 494],
      ['c', 990, 646, 892, 786, 744, 792],
      ['c', 636, 796, 566, 726, 570, 640],
      ['c', 574, 566, 636, 522, 700, 534],
      ['c', 760, 546, 788, 604, 766, 654],
      [688, 626],
      ['c', 700, 604, 686, 586, 664, 588],
      ['c', 628, 592, 616, 648, 644, 690],
      ['c', 686, 750, 796, 750, 862, 686],
      ['c', 936, 612, 930, 470, 856, 400],
      ['c', 780, 328, 664, 322, 592, 380],
    ], Object.assign({}, I, {
      ink: 24,
      fill: lin(cc, 600, 330, 960, 780, [
        [0, hornHi], [0.12, horn], [0.32, mix(horn, hornLo, 0.45)], [0.52, lighten(horn, 0.3)],
        [0.72, mix(horn, hornLo, 0.6)], [1, hornLo],
      ]),
    }));
    // growth rings, following the sweep
    for (let i = 0; i < 8; i++) {
      const a = -0.9 + i * 0.30;
      const r0 = 210, r1 = 300;
      const ox = 758, oy = 552;
      line(cc, [
        [ox + Math.cos(a) * r0, oy + Math.sin(a) * r0],
        [ox + Math.cos(a) * r1, oy + Math.sin(a) * r1],
      ], 9, rgba(ink, 0.3));
    }
    spec(cc, [[648, 372], [812, 366], [826, 410], [660, 416]], 'rgba(255,255,255,0.3)');
  });

  // head
  plate(c, mirrorClose([
    [500, 902], ['c', 580, 898, 626, 860, 646, 786], ['c', 668, 690, 674, 578, 656, 484],
    ['c', 636, 378, 578, 320, 500, 318],
  ]), Object.assign({}, I, { ink: 26, fill: plateFill(c, [344, 318, 312, 584], base, hi, lo, 1.0) }));
  facet(c, [[500, 328], [652, 470], [640, 760], [500, 828]], lo, 0.36);
  facet(c, [[500, 328], [350, 470], [360, 730], [500, 800]], hi, 0.18);
  facet(c, [[382, 400], [478, 348], [488, 402], [396, 456]], '#ffffff', 0.16);
  // blaze
  pathOf(c, [[500, 330], ['c', 542, 400, 546, 560, 526, 690], [474, 690], ['c', 454, 560, 458, 400, 500, 330]], true);
  c.fillStyle = rgba(lighten(hi, 0.4), 0.22); c.fill();

  // ears
  sym(c, (cc) => {
    plate(cc, [[634, 512], [820, 470], [862, 534], [700, 592]],
      Object.assign({}, I, { ink: 19, fill: plateFill(cc, [634, 470, 228, 122], darken(base, 0.2), lighten(base, 0.3), darken(lo, 0.35), 1.2) }));
    facet(cc, [[664, 528], [812, 494], [836, 528], [692, 570]], '#3a1218', 0.6);
  });

  eye(c, 606, 508, 32, 22, -0.3);
  eye(c, 394, 508, 32, 22, 0.3);
  line(c, [[470, 448], [452, 508]], 12, rgba(ink, 0.8));
  line(c, [[530, 448], [548, 508]], 12, rgba(ink, 0.8));

  // muzzle
  plate(c, mirrorClose([[500, 700], ['c', 580, 706, 612, 748, 606, 806], ['c', 600, 878, 556, 918, 500, 922]]),
    Object.assign({}, I, { ink: 21, fill: plateFill(c, [394, 700, 212, 222], lighten(base, 0.24), lighten(hi, 0.34), mix(base, lo, 0.7), 1.1) }));
  pathOf(c, [[456, 764], ['q', 442, 792, 464, 802], ['q', 480, 782, 472, 764]], true);
  c.fillStyle = 'rgba(0,0,0,0.85)'; c.fill();
  pathOf(c, [[544, 764], ['q', 558, 792, 536, 802], ['q', 520, 782, 528, 764]], true);
  c.fillStyle = 'rgba(0,0,0,0.85)'; c.fill();
  line(c, [[430, 860], ['q', 500, 890, 570, 860]], 13, rgba(ink, 0.85));
}

function drawBuffalo(c, A) {
  const base = A.body, hi = A.bodyHi, lo = A.bodyLo, ink = A.ink;
  const I = inkOf(A);
  const horn = '#c9cdd2';

  // horns — short, thick, hooking up
  sym(c, (cc) => {
    plate(cc, [
      [636, 396], ['c', 748, 356, 850, 372, 892, 300], [934, 232], [906, 358],
      ['c', 862, 452, 742, 476, 648, 470],
    ], { ink: 22, inkColor: ink, fill: lin(cc, 660, 380, 920, 300, [[0, darken(horn, 0.6)], [0.3, horn], [0.62, darken(horn, 0.35)], [1, darken(horn, 0.78)]]) });
    spec(cc, [[690, 396], [830, 366], [842, 396], [700, 426]], 'rgba(255,255,255,0.3)');
  });

  // shaggy head mass — the silhouette is deliberately notched, not smooth
  plate(c, mirrorClose([
    [500, 946],
    ['c', 620, 940, 686, 892, 716, 810],
    [744, 782], [716, 742], [762, 700], [720, 662], [762, 606], [716, 566],
    ['c', 748, 470, 700, 372, 604, 330], ['c', 566, 314, 532, 306, 500, 306],
  ]), Object.assign({}, I, { ink: 27, fill: plateFill(c, [238, 306, 524, 640], base, hi, lo, 1.0) }));
  facet(c, [[500, 316], [746, 500], [714, 812], [500, 878]], lo, 0.4);
  facet(c, [[500, 316], [254, 500], [286, 812], [500, 856]], hi, 0.16);
  // shaggy fur strokes
  for (let i = 0; i < 9; i++) {
    const x = 320 + i * 45;
    line(c, [[x, 360 + 40 * Math.cos(i * 1.3)], ['q', x + 16, 480, x - 8, 600 + 30 * Math.sin(i * 2.0)]], 9, rgba(ink, 0.42));
  }

  sym(c, (cc) => {
    plate(cc, [[506, 470], [636, 432], [724, 496], [704, 570], [584, 542], [508, 530]],
      Object.assign({}, I, { ink: 18, fill: plateFill(cc, [506, 432, 218, 138], lighten(base, 0.16), lighten(hi, 0.2), darken(lo, 0.2), 1.25) }));
  });
  eye(c, 620, 566, 30, 21, -0.25);
  eye(c, 380, 566, 30, 21, 0.25);

  // broad muzzle
  plate(c, mirrorClose([[500, 640], ['c', 618, 648, 664, 706, 656, 786], ['c', 648, 878, 580, 926, 500, 930]]),
    Object.assign({}, I, { ink: 22, fill: plateFill(c, [344, 640, 312, 290], darken(base, 0.34), lighten(base, 0.22), darken(lo, 0.5), 1.1) }));
  pathOf(c, [[444, 720], ['q', 420, 758, 452, 772], ['q', 476, 744, 466, 720]], true);
  c.fillStyle = 'rgba(0,0,0,0.88)'; c.fill();
  pathOf(c, [[556, 720], ['q', 580, 758, 548, 772], ['q', 524, 744, 534, 720]], true);
  c.fillStyle = 'rgba(0,0,0,0.88)'; c.fill();
  line(c, [[416, 858], ['q', 500, 890, 584, 858]], 14, rgba(ink, 0.85));
  spec(c, [[380, 690], [452, 664], [446, 706], [376, 726]], 'rgba(255,255,255,0.28)');
}

function drawBull(c, A) {
  const base = A.body, hi = A.bodyHi, lo = A.bodyLo, ink = A.ink;
  const I = inkOf(A);
  const horn = '#e2e6ea';

  // long sweeping horns
  sym(c, (cc) => {
    plate(cc, [
      [598, 396], ['c', 728, 348, 872, 344, 946, 268], [992, 214], [974, 330],
      ['c', 892, 414, 748, 462, 600, 502],
    ], { ink: 21, inkColor: ink, fill: lin(cc, 620, 380, 980, 280, [[0, darken(horn, 0.62)], [0.24, horn], [0.55, darken(horn, 0.3)], [1, darken(horn, 0.8)]]) });
    spec(cc, [[646, 392], [860, 340], [872, 372], [656, 424]], 'rgba(255,255,255,0.34)');
  });

  plate(c, mirrorClose([
    [500, 928], ['c', 606, 922, 662, 876, 686, 796], ['c', 716, 690, 720, 566, 692, 470],
    ['c', 660, 366, 590, 316, 500, 314],
  ]), Object.assign({}, I, { ink: 27, fill: plateFill(c, [308, 314, 384, 614], base, hi, lo, 1.0) }));
  facet(c, [[500, 324], [688, 490], [676, 800], [500, 860]], lo, 0.38);
  facet(c, [[500, 324], [312, 490], [326, 780], [500, 840]], hi, 0.18);
  facet(c, [[366, 404], [472, 348], [482, 404], [378, 460]], '#ffffff', 0.16);

  // ears
  sym(c, (cc) => {
    plate(cc, [[664, 490], [826, 452], [860, 522], [700, 570]],
      Object.assign({}, I, { ink: 19, fill: plateFill(cc, [664, 452, 196, 118], darken(base, 0.2), lighten(base, 0.3), darken(lo, 0.35), 1.2) }));
  });

  sym(c, (cc) => {
    plate(cc, [[506, 452], [630, 414], [712, 478], [694, 552], [582, 524], [508, 512]],
      Object.assign({}, I, { ink: 18, fill: plateFill(cc, [506, 414, 206, 138], lighten(base, 0.18), lighten(hi, 0.22), darken(lo, 0.2), 1.25) }));
  });
  // star-flash eyes (the club's own mark language)
  for (const s of [1, -1]) {
    const ex = 500 + s * 116, ey = 546;
    eye(c, ex, ey, 32, 23, -s * 0.26);
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.translate(ex, ey);
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 ? 12 : 44;
      const px = Math.cos(a) * r, py = Math.sin(a) * r * 0.8;
      if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
    }
    c.closePath();
    c.fillStyle = 'rgba(255,240,200,0.5)'; c.fill();
    c.restore();
  }
  line(c, [[470, 434], [452, 498]], 13, rgba(ink, 0.82));
  line(c, [[530, 434], [548, 498]], 13, rgba(ink, 0.82));

  plate(c, mirrorClose([[500, 660], ['c', 604, 668, 646, 720, 640, 794], ['c', 634, 878, 574, 920, 500, 924]]),
    Object.assign({}, I, { ink: 22, fill: plateFill(c, [360, 660, 280, 264], lighten(base, 0.26), lighten(hi, 0.34), mix(base, lo, 0.68), 1.1) }));
  pathOf(c, [[452, 736], ['q', 428, 772, 460, 786], ['q', 484, 758, 474, 736]], true);
  c.fillStyle = 'rgba(0,0,0,0.88)'; c.fill();
  pathOf(c, [[548, 736], ['q', 572, 772, 540, 786], ['q', 516, 758, 526, 736]], true);
  c.fillStyle = 'rgba(0,0,0,0.88)'; c.fill();
  line(c, [[424, 862], ['q', 500, 892, 576, 862]], 13, rgba(ink, 0.85));
}

function drawHorse(c, A, isColt) {
  const base = A.body, hi = A.bodyHi, lo = A.bodyLo, ink = A.ink;
  const I = inkOf(A);
  const mane = (A.p && A.p.mane) || A.trim;

  if (isColt) {
    // the club's horseshoe, a heavy metal plate the head sits inside
    c.save();
    c.translate(500, 512); c.rotate(0.1); c.translate(-500, -512);
    c.beginPath();
    c.arc(500, 470, 372, Math.PI * 0.86, Math.PI * 0.14, false);
    c.lineTo(700, 848); c.lineTo(586, 848);
    c.arc(500, 470, 258, Math.PI * 0.14, Math.PI * 0.86, true);
    c.lineTo(300, 848); c.lineTo(414, 848);
    c.closePath();
    c.fillStyle = lin(c, 180, 160, 840, 860, [
      [0, '#ffffff'], [0.18, '#eef2f4'], [0.42, '#b9c0c4'], [0.62, '#e6ebee'],
      [0.82, '#5e666b'], [1, '#242a2e'],
    ]);
    c.fill();
    c.strokeStyle = ink; c.lineWidth = 24; c.lineJoin = 'round'; c.stroke();
    // cleat holes
    for (let i = 0; i < 7; i++) {
      const a = Math.PI * (0.86 - i * (0.72 / 6));
      const hx = 500 + Math.cos(a) * 316, hy = 470 - Math.sin(a) * 316;
      c.beginPath(); c.arc(hx, hy, 17, 0, Math.PI * 2);
      c.fillStyle = 'rgba(6,10,16,0.9)'; c.fill();
    }
    c.restore();
  }

  // streaming mane (behind) — four big swept masses, not a comb
  const MANE = [
    [[598, 296], ['c', 720, 258, 828, 292, 892, 380], ['c', 812, 356, 730, 358, 668, 388], ['c', 636, 350, 616, 318, 598, 296]],
    [[640, 372], ['c', 776, 358, 884, 424, 934, 520], ['c', 850, 470, 758, 458, 682, 478], ['c', 668, 434, 654, 400, 640, 372]],
    [[676, 470], ['c', 806, 476, 900, 552, 930, 654], ['c', 856, 588, 768, 564, 700, 574], ['c', 696, 528, 686, 496, 676, 470]],
    [[700, 566], ['c', 812, 594, 880, 672, 892, 764], ['c', 828, 700, 754, 668, 700, 664], ['c', 706, 620, 704, 590, 700, 566]],
  ];
  for (let i = 0; i < MANE.length; i++) {
    plate(c, MANE[i], Object.assign({}, I, {
      ink: 18,
      fill: lin(c, 640 + i * 30, 300 + i * 90, 930, 440 + i * 110, [
        [0, lighten(mane, i % 2 ? 0.2 : 0.5)], [0.4, mane], [1, darken(mane, 0.66)],
      ]),
    }));
    line(c, [[660 + i * 22, 340 + i * 96], ['q', 790 + i * 18, 380 + i * 96, 880 + i * 6, 470 + i * 100]], 8, rgba(ink, 0.4));
  }

  // head — long profile facing left
  plate(c, [
    [214, 700],
    ['c', 218, 620, 254, 546, 306, 494],
    ['c', 372, 428, 452, 372, 528, 336],
    ['c', 622, 292, 700, 308, 736, 386],
    ['c', 778, 478, 768, 606, 708, 706],
    ['c', 650, 802, 548, 850, 452, 840],
    ['c', 356, 830, 274, 782, 236, 738],
  ], Object.assign({}, I, { ink: 27, fill: plateFill(c, [214, 292, 566, 558], base, hi, lo, 1.05) }));
  facet(c, [[540, 340], [762, 470], [716, 720], [560, 800]], lo, 0.36);
  facet(c, [[520, 344], [300, 500], [270, 700], [440, 800]], hi, 0.17);
  facet(c, [[330, 486], [470, 392], [498, 440], [354, 540]], '#ffffff', 0.16);
  // blaze
  pathOf(c, [[490, 348], ['c', 420, 420, 322, 542, 268, 668], [230, 650], ['c', 288, 512, 396, 384, 470, 330]], true);
  c.fillStyle = rgba(lighten(hi, 0.5), 0.2); c.fill();

  // ears
  plate(c, [[606, 330], [614, 174], [688, 288], [672, 356]],
    Object.assign({}, I, { ink: 19, fill: plateFill(c, [606, 174, 82, 182], darken(base, 0.2), lighten(base, 0.34), darken(lo, 0.4), 1.15) }));
  facet(c, [[624, 322], [626, 226], [668, 296], [660, 336]], '#3a1218', 0.6);
  plate(c, [[694, 344], [734, 208], [782, 320], [758, 380]],
    Object.assign({}, I, { ink: 18, fill: plateFill(c, [694, 208, 88, 172], darken(base, 0.36), lighten(base, 0.18), darken(lo, 0.5), 1.15) }));

  // eye + brow
  plate(c, [[418, 424], [540, 402], [566, 452], [446, 474]], { ink: 16, inkColor: ink, fill: rgba(darken(lo, 0.2), 0.9) });
  eye(c, 486, 476, 36, 26, -0.34);

  // nostril + mouth
  pathOf(c, [[268, 668], ['c', 240, 682, 240, 722, 272, 730], ['c', 300, 722, 300, 682, 276, 668]], true);
  c.fillStyle = lin(c, 250, 660, 290, 736, [[0, '#3a1218'], [1, '#080203']]); c.fill();
  c.strokeStyle = rgba(ink, 0.85); c.lineWidth = 10; c.stroke();
  line(c, [[248, 764], ['c', 306, 796, 386, 800, 438, 780]], 14, rgba(ink, 0.9));
  spec(c, [[300, 520], [400, 452], [420, 486], [318, 556]], 'rgba(255,255,255,0.26)');

}

/* ============================================================ MIA — DOLPHIN */

function drawDolphin(c, A) {
  const base = A.body, hi = A.bodyHi, lo = A.bodyLo, ink = A.ink;
  const I = inkOf(A);

  // sun disc behind (the club's own device)
  c.save();
  c.beginPath(); c.arc(500, 470, 330, 0, Math.PI * 2);
  c.fillStyle = rad(c, 420, 380, 20, 500, 470, 340, [
    [0, lighten(A.trim, 0.55)], [0.45, A.trim], [0.85, darken(A.trim, 0.35)], [1, darken(A.trim, 0.6)],
  ]);
  c.fill();
  c.strokeStyle = ink; c.lineWidth = 20; c.stroke();
  c.beginPath(); c.arc(500, 470, 300, 0, Math.PI * 2);
  c.strokeStyle = rgba('#ffffff', 0.22); c.lineWidth = 8; c.stroke();
  c.restore();

  // tail flukes (behind the body)
  plate(c, [
    [268, 838], ['c', 196, 806, 118, 812, 74, 858], ['c', 124, 902, 208, 908, 268, 886],
    ['c', 220, 926, 196, 976, 204, 1024], ['c', 274, 992, 322, 934, 340, 872],
  ], Object.assign({}, I, { ink: 22, fill: plateFill(c, [74, 806, 266, 218], darken(base, 0.26), lighten(base, 0.28), darken(lo, 0.52), 1.2) }));
  line(c, [[262, 862], ['c', 200, 856, 148, 862, 108, 874]], 8, rgba(ink, 0.45));

  // dorsal fin (behind the body)
  plate(c, [
    [452, 570], ['c', 480, 470, 556, 396, 654, 366],
    ['c', 596, 434, 546, 502, 522, 578],
  ], Object.assign({}, I, { ink: 22, fill: plateFill(c, [452, 366, 202, 212], darken(base, 0.22), lighten(base, 0.36), darken(lo, 0.44), 1.1) }));

  // body — a true leaping arc: tail low-left, melon and rostrum high-right
  plate(c, [
    ['m', 892, 368],
    ['c', 846, 328, 776, 322, 714, 348],
    ['c', 598, 396, 468, 490, 380, 604],
    ['c', 330, 672, 292, 754, 268, 842],
    [318, 872],
    ['c', 352, 786, 396, 710, 456, 646],
    ['c', 548, 548, 664, 480, 792, 440],
    ['c', 846, 424, 878, 404, 896, 388],
  ], Object.assign({}, I, { ink: 26, fill: plateFill(c, [268, 322, 628, 550], base, hi, lo, 1.15) }));
  // belly
  pathOf(c, [
    [318, 866], ['c', 356, 782, 402, 712, 462, 650],
    ['c', 552, 556, 668, 490, 794, 450], ['c', 720, 496, 596, 552, 502, 636],
    ['c', 420, 710, 358, 792, 330, 872],
  ], true);
  c.fillStyle = rgba(lighten(hi, 0.45), 0.34); c.fill();
  facet(c, [[714, 350], [890, 372], [850, 420], [640, 456]], lo, 0.26);
  spec(c, [[500, 592], [700, 476], [716, 508], [520, 628]], 'rgba(255,255,255,0.34)');

  // pectoral fin
  plate(c, [[452, 662], ['c', 420, 742, 428, 812, 476, 862], ['c', 508, 796, 546, 728, 570, 682]],
    Object.assign({}, I, { ink: 20, fill: plateFill(c, [420, 662, 150, 200], darken(base, 0.36), lighten(base, 0.16), darken(lo, 0.55), 1.1) }));

  // rostrum (beak) + jaw line
  plate(c, [[830, 388], ['c', 866, 372, 906, 356, 940, 350], [946, 386],
    ['c', 916, 396, 872, 412, 840, 424]],
    Object.assign({}, I, { ink: 18, fill: plateFill(c, [830, 350, 116, 74], lighten(base, 0.18), lighten(hi, 0.4), mix(base, lo, 0.6), 1.1) }));
  line(c, [[836, 406], ['c', 872, 392, 912, 376, 942, 368]], 9, rgba(ink, 0.85));
  // the smile
  line(c, [[760, 420], ['c', 790, 428, 816, 424, 836, 412]], 11, rgba(ink, 0.7));

  eye(c, 768, 386, 22, 18, -0.34);

  // spray off the tail
  for (let i = 0; i < 8; i++) {
    const a = -1.1 - i * 0.14, r = 110 + (i % 3) * 48;
    const x = 250 + Math.cos(a) * r, y = 900 + Math.sin(a) * r;
    c.beginPath(); c.ellipse(x, y, 18 - i * 1.4, 11 - i * 0.8, a, 0, Math.PI * 2);
    c.fillStyle = rgba('#ffffff', 0.26 - i * 0.025); c.fill();
  }
}

/* ============================================================ MIN — VIKING */

function drawViking(c, A) {
  const base = A.body, hi = A.bodyHi, lo = A.bodyLo, ink = A.ink;
  const gold = A.trim, goldHi = lighten(A.trim, 0.62), goldLo = darken(A.trim, 0.68);
  const I = inkOf(A);
  const skin = '#e2b48c', skinHi = '#ffe0bd', skinLo = '#6a3d22';

  // horns
  sym(c, (cc) => {
    plate(cc, [
      [644, 366], ['c', 760, 320, 862, 306, 926, 226], [962, 176], [946, 300],
      ['c', 902, 380, 786, 430, 672, 452],
    ], { ink: 22, inkColor: ink, fill: lin(cc, 660, 360, 950, 220, [
      [0, goldLo], [0.2, goldHi], [0.42, gold], [0.7, darken(gold, 0.4)], [1, goldLo]]) });
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      line(cc, [[700 + t * 200, 372 - t * 84], [716 + t * 200, 430 - t * 92]], 8, rgba(ink, 0.4));
    }
    spec(cc, [[688, 356], [848, 306], [858, 336], [696, 388]], 'rgba(255,255,255,0.34)');
  });

  // helmet dome
  plate(c, mirrorClose([
    [500, 214], ['c', 618, 214, 700, 276, 716, 372], [722, 452], ['c', 660, 424, 580, 412, 500, 412],
  ]), Object.assign({}, I, { ink: 25, fill: plateFill(c, [278, 214, 444, 238], base, hi, lo, 1.0) }));
  facet(c, [[500, 222], [716, 380], [716, 446], [500, 412]], lo, 0.34);
  facet(c, [[500, 222], [284, 380], [292, 440], [500, 406]], hi, 0.2);
  spec(c, [[334, 340], [438, 262], [468, 300], [356, 384]], 'rgba(255,255,255,0.3)');
  // gold band + rivets
  plate(c, [[280, 404], [720, 404], [726, 462], [274, 462]], { ink: 16, inkColor: ink,
    fill: lin(c, 280, 404, 300, 462, [[0, goldHi], [0.32, gold], [0.7, darken(gold, 0.35)], [1, goldLo]]) });
  for (let i = 0; i < 9; i++) {
    const x = 320 + i * 45;
    c.beginPath(); c.arc(x, 433, 8, 0, Math.PI * 2);
    c.fillStyle = rad(c, x - 3, 430, 0, x, 433, 9, [[0, '#fff4cf'], [1, darken(gold, 0.6)]]); c.fill();
  }
  // nasal guard
  plate(c, [[478, 452], [522, 452], [528, 592], [500, 616], [472, 592]], { ink: 15, inkColor: ink,
    fill: lin(c, 470, 452, 530, 616, [[0, goldHi], [0.4, gold], [1, goldLo]]) });

  // braids
  sym(c, (cc) => {
    for (let i = 0; i < 4; i++) {
      const y0 = 470 + i * 26;
      plate(cc, [
        [652, y0], ['c', 742, y0 + 30, 790, y0 + 130, 776, y0 + 250],
        ['c', 742, y0 + 260, 706, y0 + 180, 692, y0 + 96],
      ], Object.assign({}, I, { ink: 15, fill: lin(cc, 660, y0, 790, y0 + 240, [
        [0, '#f0d089'], [0.4, '#c99a4a'], [1, '#5a3a12']]) }));
      for (let k = 0; k < 4; k++) line(cc, [[700 + k * 12, y0 + 60 + k * 46], [762 + k * 6, y0 + 74 + k * 46]], 8, 'rgba(70,44,12,0.6)');
    }
  });

  // face
  plate(c, mirrorClose([
    [500, 856], ['c', 588, 850, 638, 800, 656, 716], ['c', 672, 640, 668, 540, 656, 462], [500, 462],
  ]), Object.assign({}, I, { ink: 24, fill: plateFill(c, [344, 462, 312, 394], skin, skinHi, skinLo, 1.0) }));
  facet(c, [[500, 470], [654, 520], [640, 760], [500, 812]], skinLo, 0.34);
  facet(c, [[500, 470], [346, 520], [356, 720], [500, 780]], skinHi, 0.2);

  // brow ridges — two angled wedges with the nasal guard between them
  sym(c, (cc) => {
    plate(cc, [[540, 528], [648, 494], [654, 560], [546, 580]], { ink: 13, inkColor: ink,
      fill: lin(cc, 540, 494, 654, 580, [[0, darken(skinLo, 0.15)], [1, darken(skinLo, 0.62)]]) });
    facet(cc, [[548, 552], [648, 520], [652, 552], [550, 574]], '#000000', 0.35);
  });
  eye(c, 598, 604, 27, 18, -0.26, '#bfe4ff');
  eye(c, 402, 604, 27, 18, 0.26, '#bfe4ff');
  // cheekbone shadow
  sym(c, (cc) => {
    facet(cc, [[556, 632], [648, 616], [636, 690], [552, 686]], skinLo, 0.3);
  });

  // moustache — sweeping, separate from the beard
  plate(c, mirrorClose([
    [500, 656], ['c', 578, 652, 626, 674, 640, 716],
    ['c', 610, 726, 574, 714, 552, 700], ['c', 532, 690, 514, 686, 500, 686],
  ]), Object.assign({}, I, { ink: 17, fill: lin(c, 360, 652, 640, 726, [
    [0, '#f6de9e'], [0.34, '#dcb35c'], [0.78, '#8e6320'], [1, '#3a2607']]) }));

  // beard — chiselled, forked, not a rounded slab
  plate(c, mirrorClose([
    [500, 700], ['c', 578, 698, 624, 716, 638, 752],
    [608, 792], [640, 812], [596, 856], [560, 838], [536, 902], [500, 872],
  ]), Object.assign({}, I, { ink: 20, fill: lin(c, 372, 700, 640, 900, [
    [0, '#f2d68f'], [0.3, '#d9ae57'], [0.7, '#8f6420'], [1, '#332106']]) }));
  for (let i = 0; i < 5; i++) {
    const t = (i - 2) / 2;
    line(c, [[500 + t * 96, 716], ['q', 500 + t * 132, 800, 500 + t * 82, 864]], 9, 'rgba(56,36,8,0.5)');
  }
  facet(c, [[500, 706], [636, 754], [608, 800], [500, 780]], '#332106', 0.28);
  spec(c, [[386, 742], [462, 720], [458, 758], [382, 776]], 'rgba(255,246,214,0.3)');
}

/* ========================================================= NE — MINUTEMAN */

function drawMinuteman(c, A) {
  const base = A.body, hi = A.bodyHi, lo = A.bodyLo, ink = A.ink;
  const I = inkOf(A);
  const skin = '#e8bb92', skinHi = '#ffe4c2', skinLo = '#71411f';
  const red = A.trim, silver = '#c9d0d6';

  // tricorn hat
  plate(c, [
    [148, 452], ['c', 214, 300, 358, 216, 528, 216], ['c', 700, 216, 830, 306, 878, 452],
    ['c', 820, 424, 742, 466, 684, 430], ['c', 606, 476, 452, 480, 372, 434],
    ['c', 306, 470, 226, 428, 148, 452],
  ], Object.assign({}, I, { ink: 27, fill: plateFill(c, [148, 216, 730, 264], base, hi, lo, 1.0) }));
  facet(c, [[520, 224], [872, 452], [700, 436], [520, 462]], lo, 0.36);
  facet(c, [[500, 224], [156, 452], [330, 448], [500, 462]], hi, 0.18);
  spec(c, [[254, 372], [396, 274], [428, 314], [278, 414]], 'rgba(255,255,255,0.28)');
  // hat band + cockade
  plate(c, [[224, 434], ['c', 356, 486, 654, 486, 796, 428], [806, 470],
    ['c', 656, 528, 352, 528, 214, 470]], { ink: 15, inkColor: ink,
    fill: lin(c, 224, 434, 240, 500, [[0, lighten(red, 0.4)], [0.4, red], [1, darken(red, 0.6)]]) });
  c.beginPath(); c.arc(750, 402, 46, 0, Math.PI * 2);
  c.fillStyle = rad(c, 736, 388, 4, 750, 402, 48, [[0, '#ffffff'], [0.45, silver], [1, '#4b5158']]);
  c.fill(); c.strokeStyle = ink; c.lineWidth = 12; c.stroke();

  // face (3/4, jaw set)
  plate(c, [
    [352, 452], ['c', 356, 560, 380, 660, 428, 730], ['c', 476, 800, 556, 830, 616, 800],
    ['c', 668, 772, 692, 690, 692, 592], ['c', 692, 512, 676, 460, 654, 440],
  ], Object.assign({}, I, { ink: 24, fill: plateFill(c, [352, 440, 340, 390], skin, skinHi, skinLo, 1.0) }));
  facet(c, [[560, 448], [692, 520], [676, 760], [560, 812]], skinLo, 0.32);
  facet(c, [[520, 448], [356, 520], [386, 700], [500, 790]], skinHi, 0.18);

  // brow, eye, nose, mouth, chin
  plate(c, [[380, 512], [520, 486], [536, 540], [392, 560]], { ink: 13, inkColor: ink, fill: rgba(darken(skinLo, 0.35), 0.9) });
  eye(c, 462, 578, 27, 19, -0.2, '#cfe8ff');
  line(c, [[404, 606], ['c', 372, 652, 380, 682, 414, 692]], 13, rgba(ink, 0.65));
  line(c, [[412, 730], ['c', 468, 752, 540, 748, 578, 726]], 14, rgba(ink, 0.85));
  line(c, [[610, 528], ['c', 640, 590, 644, 664, 622, 730]], 11, rgba(ink, 0.4));

  // collar + neckerchief
  plate(c, [[336, 800], ['c', 430, 872, 580, 880, 686, 812], [742, 936], [292, 936]],
    Object.assign({}, I, { ink: 25, fill: plateFill(c, [292, 800, 450, 136], darken(base, 0.24), lighten(base, 0.16), darken(lo, 0.5), 1.2) }));
  plate(c, [[400, 830], ['c', 470, 872, 556, 872, 622, 834], [660, 936], [364, 936]],
    { ink: 18, inkColor: ink, fill: lin(c, 400, 830, 420, 936, [[0, lighten(red, 0.35)], [0.4, red], [1, darken(red, 0.62)]]) });
}

/* ============================================================ LV — RAIDER */

function drawRaider(c, A) {
  const ink = '#000000';
  const sil = '#b6bec3', silHi = '#ffffff', silLo = '#2b3034';
  const I = { ink: 24, inkColor: ink };

  // crossed cutlasses behind
  for (const s of [1, -1]) {
    c.save();
    c.translate(500, 520);
    c.rotate(s * 0.72);
    c.translate(-500, -520);
    plate(c, [[500, 60], [548, 88], [556, 700], [500, 742], [468, 700]], { ink: 18, inkColor: ink,
      fill: lin(c, 468, 80, 556, 700, [[0, silHi], [0.24, sil], [0.6, '#6d757a'], [1, silLo]]) });
    plate(c, [[440, 700], [584, 700], [584, 748], [440, 748]], { ink: 16, inkColor: ink,
      fill: lin(c, 440, 700, 440, 748, [[0, '#5d6165'], [0.5, '#2c2f33'], [1, '#0d0e10']]) });
    plate(c, [[482, 748], [538, 748], [546, 880], [500, 918], [458, 880]], { ink: 16, inkColor: ink,
      fill: lin(c, 458, 748, 546, 918, [[0, '#7d858a'], [0.45, '#33383c'], [1, '#0b0c0e']]) });
    c.restore();
  }

  // helmet shell
  plate(c, mirrorClose([
    [500, 232], ['c', 648, 232, 754, 322, 762, 470], [768, 566], ['c', 690, 528, 594, 512, 500, 512],
  ]), Object.assign({}, I, { ink: 26, fill: plateFill(c, [238, 232, 524, 334], '#4a5155', '#c9d2d8', '#0a0c0e', 1.0) }));
  facet(c, [[500, 240], [762, 470], [762, 560], [500, 512]], '#000000', 0.4);
  facet(c, [[500, 240], [238, 470], [244, 552], [500, 508]], '#ffffff', 0.16);
  spec(c, [[300, 400], [416, 300], [448, 340], [326, 448]], 'rgba(255,255,255,0.34)');
  // helmet stripe
  plate(c, [[470, 234], [530, 234], [534, 512], [466, 512]], { ink: 12, inkColor: ink,
    fill: lin(c, 466, 234, 534, 512, [[0, silHi], [0.4, sil], [1, silLo]]) });

  // face
  plate(c, mirrorClose([
    [500, 862], ['c', 592, 856, 646, 802, 660, 712], ['c', 672, 640, 668, 560, 658, 508], [500, 508],
  ]), Object.assign({}, I, { ink: 24, fill: plateFill(c, [342, 508, 316, 354], '#dcb28c', '#ffe2c0', '#66391d', 1.0) }));
  facet(c, [[500, 516], [656, 566], [644, 764], [500, 818]], '#66391d', 0.34);
  facet(c, [[500, 516], [344, 566], [356, 730], [500, 790]], '#ffe2c0', 0.2);

  // eyepatch (left) and glaring eye (right)
  plate(c, [[300, 520], [470, 556], [462, 638], [292, 610]], { ink: 14, inkColor: ink,
    fill: lin(c, 292, 520, 470, 638, [[0, '#2c2f33'], [0.5, '#0f1113'], [1, '#020203']]) });
  line(c, [[276, 528], ['c', 360, 494, 560, 494, 664, 540]], 13, 'rgba(10,10,12,0.9)');
  eye(c, 596, 592, 28, 19, -0.26, '#ffd76a');
  plate(c, [[534, 540], [660, 512], [672, 566], [540, 586]], { ink: 12, inkColor: ink, fill: 'rgba(50,28,14,0.9)' });

  // scar + snarl + jaw
  line(c, [[600, 640], [648, 728]], 9, 'rgba(96,40,30,0.8)');
  line(c, [[398, 756], ['c', 460, 792, 552, 788, 604, 750]], 16, rgba(ink, 0.9));
  fang(c, 552, 762, 26, 44, 1, ink);
  fang(c, 448, 762, 26, 44, 1, ink);
}

/* ========================================================= TB — BUCCANEER */

function drawBuccaneer(c, A) {
  const ink = A.ink;
  const bone = A.body, boneHi = A.bodyHi, boneLo = A.bodyLo;
  const I = inkOf(A);
  const steel = '#c2c9cf';

  // crossed sabres
  for (const s of [1, -1]) {
    c.save();
    c.translate(500, 520); c.rotate(s * 0.78); c.translate(-500, -520);
    plate(c, [[500, 74], [546, 108], [552, 690], [500, 726], [472, 690]], { ink: 17, inkColor: ink,
      fill: lin(c, 472, 90, 552, 690, [[0, '#ffffff'], [0.24, steel], [0.62, '#71797f'], [1, '#23282c']]) });
    plate(c, [[446, 690], ['c', 470, 726, 534, 726, 558, 690], [566, 736], ['c', 530, 764, 476, 764, 440, 736]],
      { ink: 15, inkColor: ink, fill: lin(c, 440, 690, 460, 764, [[0, lighten(A.trim, 0.4)], [0.45, A.trim], [1, darken(A.trim, 0.66)]]) });
    plate(c, [[478, 764], [526, 764], [530, 880], [500, 906], [472, 880]], { ink: 14, inkColor: ink,
      fill: lin(c, 472, 764, 530, 906, [[0, '#6a4a24'], [0.45, '#3a2612'], [1, '#100a04']]) });
    c.restore();
  }

  // skull cranium
  plate(c, mirrorClose([
    [500, 806], ['c', 612, 800, 674, 742, 700, 654], ['c', 726, 560, 720, 444, 664, 372],
    ['c', 622, 316, 566, 292, 500, 292],
  ]), Object.assign({}, I, { ink: 26, fill: plateFill(c, [300, 292, 400, 514], bone, boneHi, boneLo, 1.0) }));
  facet(c, [[500, 300], [694, 448], [676, 700], [500, 760]], boneLo, 0.3);
  facet(c, [[500, 300], [306, 448], [322, 690], [500, 748]], boneHi, 0.2);
  facet(c, [[358, 386], [468, 320], [488, 366], [378, 434]], '#ffffff', 0.2);
  // cranial suture
  line(c, [[500, 300], ['c', 512, 340, 488, 372, 500, 410]], 8, rgba(ink, 0.35));

  // sockets
  sym(c, (cc) => {
    plate(cc, [[520, 476], [640, 448], [672, 528], [634, 596], [538, 578], [518, 522]],
      { ink: 16, inkColor: ink, fill: lin(cc, 520, 448, 660, 596, [[0, '#2a2620'], [0.5, '#0d0b08'], [1, '#000000']]) });
    cc.save();
    cc.globalCompositeOperation = 'lighter';
    cc.fillStyle = rad(cc, 596, 522, 0, 596, 522, 62, [[0, rgba(A.glow, 0.55)], [1, rgba(A.glow, 0)]]);
    cc.fillRect(500, 430, 200, 180);
    cc.restore();
  });
  // nasal
  plate(c, mirrorClose([[500, 596], ['c', 546, 606, 566, 646, 552, 682], [500, 682]]),
    { ink: 14, inkColor: ink, fill: '#0a0806' });

  // jaw + teeth
  plate(c, mirrorClose([
    [500, 706], ['c', 596, 708, 636, 736, 632, 786], ['c', 626, 848, 574, 878, 500, 882],
  ]), Object.assign({}, I, { ink: 20, fill: plateFill(c, [368, 706, 264, 176], darken(bone, 0.12), boneHi, boneLo, 1.1) }));
  for (let i = -3; i <= 3; i++) {
    const x = 500 + i * 40;
    line(c, [[x, 716], [x, 800]], 7, rgba(ink, 0.55));
  }
  line(c, [[372, 716], ['c', 440, 742, 560, 742, 628, 716]], 12, rgba(ink, 0.8));
  line(c, [[382, 802], ['c', 448, 828, 552, 828, 620, 802]], 12, rgba(ink, 0.8));

  // the club's football, wedged at the crown
  c.save();
  c.translate(500, 300); c.rotate(-0.32);
  c.beginPath(); c.ellipse(0, 0, 132, 76, 0, 0, Math.PI * 2);
  c.fillStyle = lin(c, -130, -70, 130, 76, [[0, '#8a4a22'], [0.35, '#5e2d10'], [1, '#2a1206']]);
  c.fill(); c.strokeStyle = ink; c.lineWidth = 18; c.stroke();
  c.beginPath(); c.moveTo(-46, 0); c.lineTo(46, 0);
  c.strokeStyle = '#efe6d4'; c.lineWidth = 12; c.stroke();
  for (let i = -2; i <= 2; i++) {
    c.beginPath(); c.moveTo(i * 22, -18); c.lineTo(i * 22, 18);
    c.strokeStyle = '#efe6d4'; c.lineWidth = 9; c.stroke();
  }
  c.restore();
}

/* ================================================================= MARKS ==== */

function metalRamp(c, box, col, dir) {
  const [x, y, w, h] = box;
  const a = dir === undefined ? 1.12 : dir;
  const L = Math.max(w, h) * 0.8;
  const cx = x + w / 2, cy = y + h / 2;
  return lin(c, cx - Math.cos(a) * L, cy - Math.sin(a) * L, cx + Math.cos(a) * L, cy + Math.sin(a) * L, [
    [0.00, lighten(col, 0.72)],
    [0.14, lighten(col, 0.34)],
    [0.30, col],
    [0.46, lighten(col, 0.5)],
    [0.60, col],
    [0.80, darken(col, 0.5)],
    [1.00, darken(col, 0.78)],
  ]);
}

function drawArrowhead(c, A) {
  const ink = A.ink;
  const gold = A.trim;
  // outer gold plate
  const shape = [
    [500, 158], ['c', 660, 210, 790, 262, 878, 320],
    ['c', 806, 500, 690, 720, 500, 906],
    ['c', 310, 720, 194, 500, 122, 320],
    ['c', 210, 262, 340, 210, 500, 158],
  ];
  plate(c, shape, { ink: 26, inkColor: ink, fill: metalRamp(c, [122, 158, 756, 748], gold, 1.05) });
  // inner red field
  c.save();
  c.translate(500, 520); c.scale(0.855, 0.855); c.translate(-500, -520);
  plate(c, shape, { ink: 20, inkColor: ink, fill: metalRamp(c, [122, 158, 756, 748], A.body, 1.05) });
  c.restore();
  facet(c, [[500, 200], [846, 340], [700, 700], [500, 800]], '#000000', 0.28);
  facet(c, [[500, 200], [158, 340], [290, 660], [500, 760]], '#ffffff', 0.14);
  spec(c, [[224, 336], [430, 250], [446, 300], [244, 386]], 'rgba(255,255,255,0.34)');

  // interlocking KC, drawn as a heavy white plate
  const F = REG.faces;
  c.save();
  c.translate(500, 560);
  c.scale(0.9, 1);
  F.draw(c, 'KC', 0, 10, { face: 'blitz-block', size: 300, align: 'center', tracking: -0.06, fill: rgba(ink, 0.9) });
  F.draw(c, 'KC', 0, 0, {
    face: 'blitz-block', size: 300, align: 'center', tracking: -0.06,
    fill: lin(c, 0, -240, 0, 40, [[0, '#ffffff'], [0.45, '#e7ebef'], [1, '#8e979e']]),
    stroke: ink, strokeWidth: 14,
  });
  c.restore();
}

function drawStar(c, A) {
  const ink = A.ink;
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
    const r = i % 2 ? 176 : 430;
    pts.push([500 + Math.cos(a) * r, 500 + Math.sin(a) * r]);
  }
  // navy backing star, slightly larger
  c.save();
  c.translate(500, 500); c.scale(1.14, 1.14); c.translate(-500, -500);
  plate(c, pts, { ink: 26, inkColor: ink, fill: metalRamp(c, [70, 70, 860, 860], A.trim, 1.1) });
  c.restore();
  plate(c, pts, { ink: 22, inkColor: ink, fill: metalRamp(c, [70, 70, 860, 860], A.body, 1.05) });
  // facet split: light half / dark half per point
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i / 5) * Math.PI * 2;
    const tip = [500 + Math.cos(a) * 430, 500 + Math.sin(a) * 430];
    const l = -Math.PI / 2 + ((i - 0.5) / 5) * Math.PI * 2;
    const r = -Math.PI / 2 + ((i + 0.5) / 5) * Math.PI * 2;
    const pl = [500 + Math.cos(l) * 176, 500 + Math.sin(l) * 176];
    const pr = [500 + Math.cos(r) * 176, 500 + Math.sin(r) * 176];
    facet(c, [[500, 500], pl, tip], '#ffffff', 0.18);
    facet(c, [[500, 500], pr, tip], '#000000', 0.30);
  }
  spec(c, [[404, 190], [500, 90], [520, 190], [438, 268]], 'rgba(255,255,255,0.4)');
}

function drawHypocycloid(c, A) {
  const ink = '#000000';
  // dark disc
  c.beginPath(); c.arc(500, 500, 400, 0, Math.PI * 2);
  c.fillStyle = rad(c, 400, 380, 30, 500, 500, 420, [
    [0, '#3d4147'], [0.4, '#1a1c1f'], [1, '#050506'],
  ]);
  c.fill();
  c.strokeStyle = ink; c.lineWidth = 26; c.stroke();
  c.beginPath(); c.arc(500, 500, 372, 0, Math.PI * 2);
  c.strokeStyle = rgba(A.trim, 0.5); c.lineWidth = 7; c.stroke();

  const cols = ['#FFB612', '#c60c30', '#00539b'];
  const angs = [-Math.PI / 2, -Math.PI / 2 + Math.PI * 2 / 3, -Math.PI / 2 + Math.PI * 4 / 3];
  for (let i = 0; i < 3; i++) {
    const a = angs[i] + 0.35;
    const cx = 500 + Math.cos(a) * 176, cy = 500 + Math.sin(a) * 176;
    c.save();
    c.translate(cx, cy);
    c.rotate(a + Math.PI / 2);
    // astroid (four-cusped hypocycloid)
    c.beginPath();
    const R = 168;
    for (let k = 0; k <= 96; k++) {
      const th = (k / 96) * Math.PI * 2;
      const px = R * Math.pow(Math.cos(th), 3);
      const py = R * Math.pow(Math.sin(th), 3);
      if (k === 0) c.moveTo(px, py); else c.lineTo(px, py);
    }
    c.closePath();
    c.fillStyle = metalRamp(c, [-R, -R, R * 2, R * 2], cols[i], 1.1);
    c.fill();
    c.strokeStyle = ink; c.lineWidth = 16; c.stroke();
    c.beginPath();
    c.moveTo(-R * 0.62, -R * 0.16); c.lineTo(-R * 0.16, -R * 0.62); c.lineTo(-R * 0.06, -R * 0.42);
    c.lineTo(-R * 0.42, -R * 0.06); c.closePath();
    c.fillStyle = 'rgba(255,255,255,0.4)'; c.fill();
    c.restore();
  }
  c.save();
  c.globalCompositeOperation = 'source-atop';
  c.fillStyle = lin(c, 200, 140, 780, 880, [
    [0, 'rgba(255,255,255,0.20)'], [0.4, 'rgba(255,255,255,0)'], [1, 'rgba(0,0,0,0.40)'],
  ]);
  c.fillRect(60, 60, 880, 880);
  c.restore();
}

function drawMonogram(c, A) {
  const P = A.p || {};
  const text = P.text || 'NFL';
  const ink = A.ink;
  const F = REG.faces;
  const oval = P.style === 'oval';

  if (oval) {
    c.save();
    c.beginPath(); c.ellipse(500, 500, 400, 300, 0, 0, Math.PI * 2);
    c.fillStyle = metalRamp(c, [100, 200, 800, 600], A.body, 1.08);
    c.fill();
    c.strokeStyle = ink; c.lineWidth = 26; c.stroke();
    c.beginPath(); c.ellipse(500, 500, 372, 274, 0, 0, Math.PI * 2);
    c.strokeStyle = lin(c, 140, 240, 860, 760, [
      [0, lighten(A.trim, 0.6)], [0.5, A.trim], [1, darken(A.trim, 0.55)]]);
    c.lineWidth = 16; c.stroke();
    c.restore();
    facet(c, [[500, 206], [886, 470], [820, 640], [500, 500]], '#000000', 0.24);
    facet(c, [[500, 206], [116, 470], [186, 620], [500, 500]], '#ffffff', 0.14);
  }

  const size = text.length > 1 ? 400 : 560;
  c.save();
  c.translate(500, oval ? 640 : 700);
  c.scale(text.length > 1 ? 0.92 : 1, 1);
  F.draw(c, text, 0, 16, { face: 'blitz-block', size, align: 'center', tracking: text.length > 1 ? -0.05 : 0, fill: rgba(ink, 0.92) });
  F.draw(c, text, 0, 0, {
    face: 'blitz-block', size, align: 'center', tracking: text.length > 1 ? -0.05 : 0,
    fill: lin(c, 0, -size * 0.86, 0, size * 0.1, [
      [0, '#ffffff'], [0.30, lighten(A.trim, 0.5)], [0.58, A.trim], [0.82, darken(A.trim, 0.42)], [1, darken(A.trim, 0.7)],
    ]),
    stroke: ink, strokeWidth: 18,
  });
  c.restore();
  c.save();
  c.globalCompositeOperation = 'source-atop';
  c.fillStyle = lin(c, 160, 120, 840, 900, [
    [0, 'rgba(255,255,255,0.22)'], [0.42, 'rgba(255,255,255,0)'], [1, 'rgba(0,0,0,0.42)'],
  ]);
  c.fillRect(40, 40, 920, 920);
  c.restore();
}

function drawBolt(c, A) {
  const ink = A.ink;
  const seg = [
    [566, 96], [252, 546], [438, 546], [332, 926], [716, 452], [520, 452], [700, 96],
  ];
  // gold backing
  c.save();
  c.translate(500, 510); c.scale(1.13, 1.10); c.translate(-500, -510);
  plate(c, seg, { ink: 28, inkColor: ink, fill: metalRamp(c, [252, 96, 464, 830], A.trim, 1.1) });
  c.restore();
  plate(c, seg, { ink: 22, inkColor: ink, fill: metalRamp(c, [252, 96, 464, 830], A.body, 1.05) });
  facet(c, [[566, 110], [300, 500], [400, 512], [640, 130]], '#ffffff', 0.28);
  facet(c, [[690, 110], [530, 452], [706, 452], [360, 900]], '#000000', 0.16);
  spec(c, [[452, 300], [560, 148], [592, 176], [478, 336]], 'rgba(255,255,255,0.45)');
}

function drawFleur(c, A) {
  const ink = A.ink;
  const gold = A.body;
  const P = { ink: 24, inkColor: ink, fill: null };
  // centre petal
  plate(c, mirrorClose([
    [500, 108], ['c', 566, 190, 596, 300, 590, 400], ['c', 586, 470, 560, 512, 528, 540], [500, 548],
  ]), Object.assign({}, P, { fill: metalRamp(c, [410, 108, 180, 440], gold, 1.05) }));
  // side petals
  sym(c, (cc) => {
    plate(cc, [
      [540, 452], ['c', 640, 380, 782, 396, 838, 486], ['c', 880, 560, 836, 654, 748, 664],
      ['c', 700, 668, 668, 640, 664, 604], ['c', 700, 622, 736, 608, 744, 578],
      ['c', 754, 534, 700, 500, 620, 516], ['c', 578, 524, 552, 540, 540, 556],
    ], Object.assign({}, P, { ink: 22, fill: metalRamp(cc, [540, 380, 340, 288], gold, 1.15) }));
  });
  // band
  plate(c, [[386, 566], [614, 566], [622, 640], [378, 640]], { ink: 20, inkColor: ink,
    fill: metalRamp(c, [378, 566, 244, 74], gold, 1.4) });
  // foot
  plate(c, mirrorClose([[500, 640], [560, 640], ['c', 566, 760, 546, 850, 500, 916]]),
    Object.assign({}, P, { ink: 22, fill: metalRamp(c, [440, 640, 120, 276], gold, 1.05) }));
  facet(c, [[500, 120], [586, 380], [560, 520], [500, 540]], '#000000', 0.22);
  facet(c, [[500, 120], [414, 380], [440, 520], [500, 540]], '#ffffff', 0.18);
  spec(c, [[456, 250], [498, 154], [520, 214], [478, 320]], 'rgba(255,255,255,0.42)');
}

function drawFlameT(c, A) {
  const ink = A.ink;
  // disc
  c.beginPath(); c.arc(500, 500, 396, 0, Math.PI * 2);
  c.fillStyle = metalRamp(c, [104, 104, 792, 792], A.body, 1.1);
  c.fill();
  c.strokeStyle = ink; c.lineWidth = 26; c.stroke();
  c.beginPath(); c.arc(500, 500, 366, 0, Math.PI * 2);
  c.strokeStyle = rgba('#ffffff', 0.28); c.lineWidth = 8; c.stroke();
  facet(c, [[500, 118], [880, 420], [790, 700], [500, 500]], '#000000', 0.26);
  facet(c, [[500, 118], [120, 420], [210, 680], [500, 500]], '#ffffff', 0.14);

  // three flame trails
  for (let i = 0; i < 3; i++) {
    const y = 336 + i * 128;
    plate(c, [
      [196, y - 32], ['c', 300, y - 56, 420, y - 44, 500, y - 22],
      ['c', 420, y + 6, 300, y + 18, 196, y + 34],
      ['c', 250, y + 2, 250, y - 4, 196, y - 32],
    ], { ink: 16, inkColor: ink, fill: lin(c, 196, y, 500, y, [
      [0, darken(A.trim, 0.6)], [0.3, A.trim], [1, lighten(A.trim, 0.6)]]) });
  }
  // the T
  plate(c, [[364, 288], [800, 288], [800, 396], [612, 396], [612, 730], [498, 730], [498, 396], [364, 396]],
    { ink: 22, inkColor: ink, fill: lin(c, 364, 288, 800, 730, [
      [0, '#ffffff'], [0.3, '#e8eef4'], [0.62, '#a8b4c0'], [1, '#4a545e']]) });
  spec(c, [[380, 300], [786, 300], [786, 330], [380, 330]], 'rgba(255,255,255,0.5)');
}

function drawJet(c, A) {
  const ink = A.ink;
  const body = A.body, trim = A.trim;
  // afterburner
  c.save();
  c.globalCompositeOperation = 'lighter';
  c.fillStyle = lin(c, 120, 540, 520, 540, [
    [0, rgba(A.glow, 0)], [0.45, rgba(A.glow, 0.35)], [1, rgba('#ffffff', 0.5)],
  ]);
  c.beginPath(); c.moveTo(120, 520); c.lineTo(520, 470); c.lineTo(520, 600); c.closePath(); c.fill();
  c.restore();

  // fuselage + delta wing, swept right
  plate(c, [
    [930, 470], ['c', 828, 448, 700, 452, 610, 476],
    [370, 300], [286, 306], [430, 500],
    [286, 706], [370, 712], [610, 546],
    ['c', 700, 570, 828, 574, 930, 552],
    ['c', 962, 540, 962, 482, 930, 470],
  ], { ink: 26, inkColor: ink, fill: metalRamp(c, [286, 300, 676, 412], body, 1.05) });
  facet(c, [[610, 480], [928, 472], [944, 508], [430, 502]], '#ffffff', 0.2);
  facet(c, [[430, 508], [944, 512], [928, 552], [610, 544]], '#000000', 0.32);
  // canopy
  plate(c, [[770, 468], ['c', 820, 460, 866, 462, 894, 472], ['c', 866, 486, 812, 490, 770, 486]],
    { ink: 14, inkColor: ink, fill: lin(c, 770, 460, 894, 490, [[0, '#cfeaff'], [0.5, '#3d7fa8'], [1, '#0d1a26']]) });
  // tail fin
  plate(c, [[430, 500], [352, 366], [412, 360], [500, 486]], { ink: 20, inkColor: ink,
    fill: metalRamp(c, [352, 360, 148, 140], trim, 1.2) });
  spec(c, [[520, 476], [900, 468], [904, 486], [520, 492]], 'rgba(255,255,255,0.42)');
}

/* ------------------------------------------------------------------ table */

const DRAW = {
  bear: drawBear,
  raptor: drawRaptor,
  feline: drawFeline,
  canine: drawCanine,
  ungulate: drawUngulate,
  dolphin: drawDolphin,
  viking: drawViking,
  minuteman: drawMinuteman,
  raider: drawRaider,
  buccaneer: drawBuccaneer,
  arrowhead: drawArrowhead,
  star: drawStar,
  hypocycloid: drawHypocycloid,
  monogram: drawMonogram,
  bolt: drawBolt,
  fleur: drawFleur,
  flameT: drawFlameT,
  jet: drawJet,
};

/* ------------------------------------------------------------- composition */

const CACHE = new Map();

/**
 * crest(id, sizePx, opts) -> canvas
 * opts.backdrop : force the shard burst on/off (default: on at >= 150 px)
 * opts.flat     : skip grain/scratch (for tiny sizes)
 */
export function crest(id, sizePx = 256, opts = {}) {
  const size = Math.max(8, Math.round(sizePx));
  const key = `${id}|${size}|${opts.backdrop === undefined ? 'a' : opts.backdrop}|${opts.flat ? 1 : 0}`;
  if (CACHE.has(key)) return CACHE.get(key);

  const team = byId(id);
  const A = team.art;
  const draw = DRAW[A.crest] || drawBear;
  const backdrop = opts.backdrop === undefined ? size >= 150 : !!opts.backdrop;
  const detail = !opts.flat && size >= 96;

  const SS = size < 340 ? 2 : 1;
  const W = size * SS;
  const cv = mkCanvas(W, W);
  const c = cv.getContext('2d');
  c.clearRect(0, 0, W, W);
  c.save();
  c.scale(W / U, W / U);

  if (backdrop) {
    let seed = 1000 + team.id.length * 7;
    for (let i = 0; i < team.id.length; i++) seed += team.id.charCodeAt(i) * (i + 3);
    shardBurst(c, 500, 486, 500, A.shard, seed, { count: 14, alpha: 0.42, rot: 0.42 });
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.fillStyle = rad(c, 500, 452, 0, 500, 452, 440, [
      [0, rgba(A.glow, 0.13)], [0.5, rgba(A.glow, 0.045)], [1, rgba(A.glow, 0)],
    ]);
    c.fillRect(0, 0, U, U);
    c.restore();
  }

  // soft contact shadow so the emblem sits on the card instead of floating
  c.save();
  c.globalAlpha = 0.5;
  c.fillStyle = rad(c, 500, 900, 20, 500, 906, 300, [[0, 'rgba(0,0,0,0.75)'], [1, 'rgba(0,0,0,0)']]);
  c.beginPath(); c.ellipse(500, 906, 300, 74, 0, 0, Math.PI * 2); c.fill();
  c.restore();

  c.save();
  c.translate(500, 512);
  c.scale(0.93, 0.93);
  c.translate(-500, -512);
  try {
    draw(c, A);
  } catch (e) {
    console.error('[brand-identity] crest failed', id, e);
    (typeof window !== 'undefined') && (window.__BLITZ_ERRORS__ = window.__BLITZ_ERRORS__ || []).push(`[brand] crest ${id}: ${e && e.message}`);
  }
  c.restore();
  c.restore();

  if (detail) {
    innerGlowPass(c, W, W, A.glow, { alpha: 0.18, r: 0.5, cy: 0.48 });
    sheenPass(c, W, W, { top: 0.18, bot: 0.36 });
    c.save();
    c.globalCompositeOperation = 'source-atop';
    c.fillStyle = rad(c, W * 0.46, W * 0.46, W * 0.12, W * 0.5, W * 0.5, W * 0.62, [
      [0, 'rgba(0,0,0,0)'], [0.66, 'rgba(0,0,0,0.07)'], [1, 'rgba(0,0,0,0.42)'],
    ]);
    c.fillRect(0, 0, W, W);
    c.restore();
    scratchPass(c, W, W, 4400 + size, { count: Math.round(70 + size * 0.12), strength: 0.95 });
    grainPass(c, W, W, 77, 0.055, Math.max(1, Math.round(W / 420)));
  } else if (size >= 40) {
    sheenPass(c, W, W, { top: 0.12, bot: 0.26 });
  }

  let out = cv;
  if (SS > 1) {
    out = mkCanvas(size, size);
    const oc = out.getContext('2d');
    oc.imageSmoothingEnabled = true;
    oc.imageSmoothingQuality = 'high';
    oc.drawImage(cv, 0, 0, size, size);
  }
  CACHE.set(key, out);
  return out;
}

export default { crest };
