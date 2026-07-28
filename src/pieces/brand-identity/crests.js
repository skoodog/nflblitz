// PIECE brand-identity — the crest generator.
//
// Eight procedurally drawn vector emblems in the e-sports / arcade-sports mascot
// idiom the bar art uses: heavy dark keyline, faceted plate shading with hard
// tonal steps, one or two near-white specular slivers, amber glowing eyes, a
// team-colour shard burst behind, an inner glow, and a scratch + grain finish.
//
// Everything is authored in a 1000x1000 unit space and scaled to the requested
// size, so a crest is sharp at 24 px on a HUD chip and at 900 px on a hero card.

import { makeRng } from '../../foundation/rng.js';
import {
  mkCanvas, plate, line, spec, sym, lin, rad, mirrorClose,
  lighten, darken, mix, rgba,
  scratchPass, grainPass, sheenPass, innerGlowPass, shardBurst, pathOf,
} from './gfx.js';
import { byId } from './teams.js';

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

function eye(c, cx, cy, rx, ry, rot = 0) {
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
    [0, EYE_HOT], [0.36, EYE], [0.8, '#c07a06'], [1, '#7c4402'],
  ]);
  c.fill();
  c.beginPath();
  c.ellipse(-rx * 0.34, -ry * 0.36, rx * 0.3, ry * 0.34, 0, 0, Math.PI * 2);
  c.fillStyle = 'rgba(255,255,255,0.8)';
  c.fill();
  c.restore();
}

/* ------------------------------------------------------- NYC — LIBERTY HEAD */

function drawLiberty(c, A) {
  const base = A.body, hi = A.bodyHi, lo = A.bodyLo, ink = A.ink;
  const INK = { ink: 20, inkColor: ink };

  // ---- crown spikes -----------------------------------------------------
  const HX = 500, HY = 486;
  const angs = [-92, -63, -32, 0, 32, 63, 92];
  const lens = [432, 448, 466, 486, 466, 448, 432];
  for (let i = 0; i < angs.length; i++) {
    const a = (angs[i] - 90) * Math.PI / 180;
    const px = Math.cos(a), py = Math.sin(a);
    const qx = -py, qy = px;
    const r0 = 176, r1 = lens[i];
    const hw = 46;
    const p = (r, o) => [HX + px * r + qx * o, HY + py * r + qy * o];
    const mid = r0 + (r1 - r0) * 0.5;
    plate(c, [p(r0, hw), p(mid, hw * 0.46), p(r1, 0), p(mid, -hw * 0.46), p(r0, -hw)],
      Object.assign({}, INK, {
        ink: 18,
        fill: lin(c, ...p(r0, hw), ...p(r1, -hw), [
          [0, lighten(hi, 0.1)], [0.3, lighten(base, 0.38)], [0.6, base], [1, darken(lo, 0.25)],
        ]),
      }));
    pathOf(c, [p(r0, 2), p(r1 - 4, 0), p(mid, -hw * 0.46), p(r0, -hw + 8)], true);
    c.fillStyle = rgba(darken(lo, 0.3), 0.72); c.fill();
    pathOf(c, [p(r0 + 26, hw - 14), p(mid + 26, hw * 0.36), p(mid + 18, hw * 0.15), p(r0 + 32, hw - 32)], true);
    c.fillStyle = rgba(lighten(hi, 0.4), 0.6); c.fill();
  }

  // ---- shoulders / robe -------------------------------------------------
  plate(c, [
    [232, 876], ['c', 348, 812, 420, 792, 500, 792], ['c', 580, 792, 652, 812, 768, 876],
    [736, 962], ['q', 500, 1014, 264, 962],
  ], Object.assign({}, INK, {
    ink: 24, fill: plateFill(c, [232, 792, 536, 222], darken(base, 0.44), lighten(base, 0.1), darken(lo, 0.6), 1.2),
  }));
  line(c, [[500, 806], [500, 988]], 12, rgba(ink, 0.85));
  line(c, [[384, 830], [420, 984]], 9, rgba(ink, 0.5));
  line(c, [[616, 830], [580, 984]], 9, rgba(ink, 0.5));
  spec(c, [[300, 862], [430, 812], [438, 848], [316, 900]], rgba(hi, 0.16));

  // ---- neck -------------------------------------------------------------
  plate(c, [[424, 656], [576, 656], [594, 828], [406, 828]], Object.assign({}, INK, {
    ink: 20, fill: plateFill(c, [406, 656, 188, 172], darken(base, 0.36), lighten(base, 0.04), darken(lo, 0.48), 1.4),
  }));

  // ---- hair drapes (smooth wide masses, chiselled only at the tips) ------
  sym(c, (cc) => {
    plate(cc, [
      [566, 356],
      ['c', 668, 372, 728, 448, 742, 560],
      ['c', 752, 646, 748, 706, 736, 764],
      [700, 700], [682, 800], [644, 736], [612, 826],
      ['c', 582, 738, 570, 600, 574, 462],
    ], Object.assign({}, INK, {
      ink: 22, fill: plateFill(cc, [560, 356, 192, 470], darken(base, 0.3), lighten(base, 0.42), darken(lo, 0.5), 0.84),
    }));
    line(cc, [[628, 402], ['c', 676, 520, 682, 660, 664, 792]], 11, rgba(ink, 0.7));
    line(cc, [[700, 500], ['c', 726, 590, 728, 668, 718, 730]], 8, rgba(ink, 0.5));
    spec(cc, [[596, 392], [636, 424], [644, 660], [610, 648]], rgba(lighten(hi, 0.3), 0.32));
  });

  // ---- face -------------------------------------------------------------
  plate(c, mirrorClose([
    [500, 782],
    ['c', 556, 772, 590, 736, 604, 686],
    ['c', 622, 620, 630, 548, 626, 494],
    ['c', 622, 424, 592, 378, 544, 360],
    ['c', 528, 356, 514, 354, 500, 354],
  ]), Object.assign({}, INK, {
    ink: 22,
    fill: plateFill(c, [384, 354, 240, 424], lighten(base, 0.14), hi, darken(lo, 0.24), 0.92),
  }));
  pathOf(c, [[500, 366], [628, 494], [598, 698], [500, 762]], true);
  c.fillStyle = rgba(darken(lo, 0.35), 0.52); c.fill();
  pathOf(c, [[500, 366], [382, 484], [404, 682], [500, 750]], true);
  c.fillStyle = rgba(hi, 0.28); c.fill();
  pathOf(c, [[440, 686], [560, 686], [548, 756], [500, 782], [452, 756]], true);
  c.fillStyle = rgba(darken(lo, 0.3), 0.3); c.fill();
  pathOf(c, [[396, 518], [446, 542], [432, 630], [392, 604]], true);
  c.fillStyle = rgba(hi, 0.34); c.fill();
  pathOf(c, [[606, 526], [566, 548], [578, 634], [608, 606]], true);
  c.fillStyle = rgba(darken(lo, 0.25), 0.34); c.fill();

  // ---- diadem band (sits over the hair; the emblem's brightest element) --
  const RB = 232, BCY = 540;
  plate(c, [
    ['m', 500 - RB * Math.sin(1.22), BCY - RB * Math.cos(1.22)],
    ['c', 386, 350, 430, 300, 500, 298],
    ['c', 570, 300, 614, 350, 500 + RB * Math.sin(1.22), BCY - RB * Math.cos(1.22)],
    [500 + (RB - 62) * Math.sin(1.24), BCY - (RB - 62) * Math.cos(1.24)],
    ['c', 588, 400, 554, 364, 500, 362],
    ['c', 446, 364, 412, 400, 500 - (RB - 62) * Math.sin(1.24), BCY - (RB - 62) * Math.cos(1.24)],
  ], Object.assign({}, INK, {
    ink: 20,
    fill: plateFill(c, [280, 298, 440, 190], lighten(base, 0.3), '#ffffff', darken(lo, 0.2), 1.32),
  }));
  for (let i = -4; i <= 4; i++) {
    const a = (i / 4) * 1.16 - Math.PI / 2;
    const r = RB - 32;
    const bx = 500 + Math.cos(a) * r, by = BCY + Math.sin(a) * r;
    c.save();
    c.translate(bx, by);
    c.rotate(a + Math.PI / 2);
    c.fillStyle = rgba(ink, 0.96);
    c.fillRect(-8.5, -24, 17, 48);
    c.fillStyle = rgba(lighten(hi, 0.6), 0.5);
    c.fillRect(-8.5, -24, 4.5, 48);
    c.restore();
  }
  // band shadow cast onto the forehead
  pathOf(c, [
    ['m', 500 - (RB - 66) * Math.sin(1.2), BCY - (RB - 66) * Math.cos(1.2)],
    ['c', 414, 404, 448, 370, 500, 368],
    ['c', 552, 370, 586, 404, 500 + (RB - 66) * Math.sin(1.2), BCY - (RB - 66) * Math.cos(1.2)],
    [500 + (RB - 92) * Math.sin(1.2), BCY - (RB - 92) * Math.cos(1.2)],
    ['c', 566, 428, 540, 402, 500, 400],
    ['c', 460, 402, 434, 428, 500 - (RB - 92) * Math.sin(1.2), BCY - (RB - 92) * Math.cos(1.2)],
  ], true);
  c.fillStyle = 'rgba(0,0,0,0.34)'; c.fill();

  // ---- features ---------------------------------------------------------
  sym(c, (cc) => {
    pathOf(cc, [[522, 506], [598, 484], [606, 512], [530, 526]], true);
    cc.fillStyle = rgba(darken(lo, 0.45), 0.9); cc.fill();
  });
  eye(c, 556, 532, 21, 13, -0.14);
  eye(c, 444, 532, 21, 13, 0.14);

  plate(c, [[482, 474], [518, 474], [538, 626], [500, 646], [462, 626]], {
    ink: 0, fill: plateFill(c, [462, 474, 76, 172], lighten(base, 0.3), lighten(hi, 0.25), darken(lo, 0.18), 0.8),
  });
  line(c, [[518, 484], [538, 620]], 9, rgba(ink, 0.55));
  spec(c, [[486, 484], [500, 484], [503, 614], [489, 614]], rgba(lighten(hi, 0.45), 0.66));
  pathOf(c, [[456, 624], [478, 610], [486, 642], [460, 644]], true);
  c.fillStyle = rgba(ink, 0.84); c.fill();
  pathOf(c, [[544, 624], [522, 610], [514, 642], [540, 644]], true);
  c.fillStyle = rgba(ink, 0.84); c.fill();

  pathOf(c, [[440, 696], ['q', 500, 712, 560, 696], ['q', 500, 726, 440, 696]], true);
  c.fillStyle = rgba(ink, 0.95); c.fill();
  pathOf(c, [[456, 722], ['q', 500, 740, 544, 722], ['q', 500, 756, 456, 722]], true);
  c.fillStyle = rgba(darken(lo, 0.25), 0.5); c.fill();
}

/* ------------------------------------------------------- CHI — BULLDOG HEAD */

function drawBulldog(c, A) {
  const base = A.body, hi = A.bodyHi, lo = A.bodyLo, ink = A.ink;
  const INK = { ink: 22, inkColor: ink };

  // ---- cropped ears (behind) -------------------------------------------
  sym(c, (cc) => {
    plate(cc, [[604, 336], [706, 202], [752, 288], [716, 388]], Object.assign({}, INK, {
      ink: 20, fill: plateFill(cc, [604, 202, 148, 186], darken(base, 0.34), lighten(base, 0.2), darken(lo, 0.38), 1.15),
    }));
    pathOf(cc, [[644, 322], [702, 240], [726, 288], [696, 350]], true);
    cc.fillStyle = 'rgba(84,16,20,0.9)'; cc.fill();
  });

  // ---- head mass --------------------------------------------------------
  plate(c, mirrorClose([
    [500, 858],
    ['c', 600, 854, 658, 820, 690, 762],
    ['c', 740, 678, 766, 592, 766, 506],
    ['c', 766, 398, 720, 314, 624, 282],
    ['c', 586, 268, 542, 262, 500, 262],
  ]), Object.assign({}, INK, {
    ink: 27, fill: plateFill(c, [234, 262, 532, 596], base, hi, lo, 1.0),
  }));
  pathOf(c, [[500, 276], [758, 470], [726, 690], [500, 744]], true);
  c.fillStyle = rgba(darken(lo, 0.3), 0.48); c.fill();
  pathOf(c, [[500, 276], [244, 456], [266, 668], [500, 730]], true);
  c.fillStyle = rgba(hi, 0.2); c.fill();
  line(c, [[500, 282], [500, 420]], 11, rgba(ink, 0.72));
  spec(c, [[306, 420], [372, 366], [396, 400], [326, 470]], rgba('#ffffff', 0.32));

  // ---- brow ridges ------------------------------------------------------
  sym(c, (cc) => {
    plate(cc, [[504, 388], [626, 350], [726, 404], [720, 500], [586, 470], [506, 452]], Object.assign({}, INK, {
      ink: 19, fill: plateFill(cc, [504, 350, 222, 150], lighten(base, 0.2), lighten(hi, 0.2), darken(lo, 0.2), 1.2),
    }));
    pathOf(cc, [[518, 434], [622, 400], [706, 446], [700, 494], [584, 468], [518, 452]], true);
    cc.fillStyle = rgba(darken(lo, 0.3), 0.42); cc.fill();
  });
  // brow furrow
  line(c, [[480, 392], [466, 466]], 13, rgba(ink, 0.82));
  line(c, [[520, 392], [534, 466]], 13, rgba(ink, 0.82));

  eye(c, 632, 486, 33, 21, -0.22);
  eye(c, 368, 486, 33, 21, 0.22);

  // ---- jowls ------------------------------------------------------------
  sym(c, (cc) => {
    plate(cc, [[628, 590], [750, 644], [772, 764], [700, 856], [578, 830], [580, 672]], Object.assign({}, INK, {
      ink: 23, fill: plateFill(cc, [578, 590, 194, 266], darken(base, 0.16), lighten(base, 0.4), darken(lo, 0.28), 0.86),
    }));
    line(cc, [[646, 654], ['c', 704, 694, 722, 762, 704, 820]], 9, rgba(ink, 0.55));
  });

  // ---- muzzle -----------------------------------------------------------
  plate(c, mirrorClose([
    [500, 508],
    ['c', 624, 514, 694, 574, 698, 650],
    ['c', 702, 740, 616, 798, 500, 802],
  ]), Object.assign({}, INK, {
    ink: 23, fill: plateFill(c, [302, 508, 396, 294], lighten(base, 0.16), lighten(hi, 0.25), mix(base, lo, 0.78), 1.1),
  }));
  line(c, [[390, 578], ['q', 500, 552, 610, 578]], 11, rgba(ink, 0.72));
  line(c, [[372, 630], ['q', 500, 604, 628, 630]], 9, rgba(ink, 0.55));
  spec(c, [[366, 610], [448, 586], [442, 626], [364, 646]], rgba('#ffffff', 0.36));

  // ---- nose -------------------------------------------------------------
  plate(c, mirrorClose([
    [500, 534],
    ['c', 548, 524, 590, 548, 590, 582],
    ['c', 590, 616, 542, 640, 500, 658],
  ]), { ink: 15, inkColor: '#000000', fill: lin(c, 430, 530, 570, 668, [[0, '#4b4b55'], [0.3, '#1d1d23'], [1, '#08080a']]) });
  spec(c, [[446, 552], [498, 542], [492, 570], [446, 578]], 'rgba(255,255,255,0.36)');
  pathOf(c, [[468, 592], ['q', 452, 616, 474, 630], ['q', 488, 608, 480, 592]], true);
  c.fillStyle = 'rgba(0,0,0,0.92)'; c.fill();
  pathOf(c, [[532, 592], ['q', 548, 616, 526, 630], ['q', 512, 608, 520, 592]], true);
  c.fillStyle = 'rgba(0,0,0,0.92)'; c.fill();

  // ---- snarling mouth ---------------------------------------------------
  plate(c, mirrorClose([
    [500, 676],
    ['c', 612, 678, 668, 710, 662, 762],
    ['c', 652, 828, 578, 868, 500, 872],
  ]), { ink: 23, inkColor: ink, fill: lin(c, 500, 676, 500, 872, [[0, '#33070e'], [0.4, '#5e1019'], [1, '#110407']]) });

  // upper lip line
  line(c, [[346, 682], ['c', 414, 724, 586, 724, 654, 682]], 17, rgba(ink, 0.9));

  for (const [s, off, w, h] of [[-1, 142, 42, 92], [1, 142, 42, 92], [-1, 74, 27, 48], [1, 74, 27, 48], [0, 0, 29, 40]]) {
    const x = 500 + s * off;
    plate(c, [[x - w / 2, 694], [x + w / 2, 694], [x + w * 0.28, 694 + h], [x, 694 + h * 1.26], [x - w * 0.28, 694 + h]], {
      ink: 9, inkColor: ink, fill: lin(c, x - w / 2, 694, x + w / 2, 694 + h * 1.3, [[0, '#ffffff'], [0.45, '#efeadd'], [1, '#a49a86']]),
    });
  }
  for (const [s, off, w, h] of [[-1, 114, 32, 56], [1, 114, 32, 56], [-1, 54, 23, 36], [1, 54, 23, 36], [0, 0, 23, 34]]) {
    const x = 500 + s * off;
    plate(c, [[x - w / 2, 862], [x + w / 2, 862], [x + w * 0.28, 862 - h], [x, 862 - h * 1.22], [x - w * 0.28, 862 - h]], {
      ink: 8, inkColor: ink, fill: lin(c, x, 862, x, 862 - h * 1.3, [[0, '#9a9182'], [0.5, '#ded9cb'], [1, '#ffffff']]),
    });
  }
  pathOf(c, [[440, 828], ['q', 500, 800, 560, 828], ['q', 500, 862, 440, 828]], true);
  c.fillStyle = 'rgba(158,36,48,0.6)'; c.fill();
}

/* ------------------------------------------------------ DAL — LONGHORN SKULL */

function drawLonghorn(c, A) {
  const base = A.body, hi = A.bodyHi, lo = A.bodyLo, ink = A.ink;
  const horn = '#17251b', hornHi = '#8ba184', hornLo = '#040705';
  const INK = { ink: 20, inkColor: ink };

  // ---- horns: thick, dark, sweeping wide, tips flicking up --------------
  sym(c, (cc) => {
    plate(cc, [
      [586, 388],
      ['c', 716, 334, 866, 328, 940, 248],
      [994, 186], [978, 310],
      ['c', 898, 392, 752, 446, 590, 506],
    ], Object.assign({}, INK, {
      ink: 22,
      fill: lin(cc, 640, 300, 880, 440, [
        [0, hornHi], [0.07, horn], [0.34, darken(horn, 0.45)], [0.7, darken(horn, 0.7)], [1, hornLo],
      ]),
    }));
    // hot top edge
    pathOf(cc, [[606, 398], ['c', 724, 348, 858, 344, 928, 272], [948, 250], [934, 296],
      ['c', 862, 360, 734, 388, 610, 434]], true);
    cc.fillStyle = 'rgba(196,216,190,0.30)'; cc.fill();
    line(cc, [[606, 478], ['c', 754, 428, 872, 380, 944, 300]], 11, 'rgba(0,0,0,0.55)');
  });

  // ---- skull: broad cranium, long narrow muzzle -------------------------
  plate(c, mirrorClose([
    [500, 892],
    ['c', 540, 888, 554, 862, 556, 828],
    ['c', 560, 764, 550, 700, 544, 656],
    ['c', 602, 630, 654, 584, 664, 512],
    ['c', 680, 424, 660, 330, 592, 284],
    ['c', 568, 262, 534, 252, 500, 252],
  ]), Object.assign({}, INK, {
    ink: 26, fill: plateFill(c, [326, 252, 348, 640], base, hi, lo, 1.0),
  }));

  // faceted planes
  pathOf(c, [[500, 264], [674, 458], [560, 660], [524, 878], [500, 890]], true);
  c.fillStyle = rgba(darken(lo, 0.3), 0.4); c.fill();
  pathOf(c, [[500, 264], [326, 458], [440, 660], [476, 878], [500, 890]], true);
  c.fillStyle = rgba('#ffffff', 0.26); c.fill();
  line(c, [[500, 258], [500, 646]], 9, rgba(ink, 0.45));

  // brow plates
  sym(c, (cc) => {
    plate(cc, [[506, 336], [626, 314], [676, 400], [630, 442], [508, 412]], {
      ink: 14, inkColor: ink, fill: plateFill(cc, [506, 314, 170, 128], lighten(base, 0.16), '#ffffff', mix(base, lo, 0.6), 1.2),
    });
  });

  // cheek ridge
  sym(c, (cc) => {
    line(cc, [[560, 470], ['c', 636, 486, 662, 540, 640, 596]], 11, rgba(ink, 0.42));
  });

  // ---- eye sockets ------------------------------------------------------
  sym(c, (cc) => {
    plate(cc, [[522, 450], [648, 424], [678, 500], [618, 566], [532, 532]], {
      ink: 12, inkColor: ink,
      fill: rad(cc, 606, 486, 6, 606, 494, 92, [[0, '#241f18'], [0.5, '#0c0a07'], [1, '#030202']]),
    });
  });
  eye(c, 610, 494, 30, 21, -0.2);

  // ---- nasal cavity -----------------------------------------------------
  sym(c, (cc) => {
    plate(cc, [[500, 640], [534, 660], [542, 752], [512, 790], [500, 760]], {
      ink: 10, inkColor: ink, fill: lin(cc, 500, 640, 522, 790, [[0, '#191510'], [1, '#040302']]),
    });
  });

  // ---- teeth ------------------------------------------------------------
  for (let i = -2; i <= 2; i++) {
    const x = 500 + i * 28;
    const h = 44 - Math.abs(i) * 7;
    plate(c, [[x - 12.5, 838], [x + 12.5, 838], [x + 10, 838 + h], [x - 10, 838 + h]], {
      ink: 8, inkColor: ink, fill: lin(c, x, 838, x, 838 + h, [[0, '#fbf8ee'], [1, '#a49e90']]),
    });
  }

  spec(c, [[352, 350], [412, 330], [400, 512], [346, 486]], rgba('#ffffff', 0.5));
  spec(c, [[468, 676], [494, 668], [494, 850], [472, 840]], rgba('#ffffff', 0.26));
  line(c, [[554, 646], ['q', 500, 626, 446, 646]], 9, rgba(ink, 0.4));
}

/* ------------------------------------------------------- LA — SPARTAN HELMET */

function drawSpartan(c, A) {
  const gold = A.trim, ink = A.ink;
  const shell = A.body, shellHi = A.bodyHi, shellLo = A.bodyLo;
  const INK = { ink: 22, inkColor: ink };
  const goldFill = (box, dir) => plateFill(c, box, gold, '#fff6cc', '#63430a', dir);

  // ---- plume: dark scythe sweep behind ---------------------------------
  plate(c, [
    [402, 352], ['c', 292, 214, 356, 66, 520, 44],
    ['c', 692, 22, 792, 124, 790, 240],
    [716, 250], ['c', 710, 142, 632, 96, 530, 118],
    ['c', 410, 148, 388, 250, 462, 356],
  ], Object.assign({}, INK, {
    ink: 20, fill: lin(c, 400, 320, 790, 70, [[0, '#5a5a66'], [0.35, '#1d1d24'], [1, '#07070a']]),
  }));

  // ---- plume blades ------------------------------------------------------
  const blades = [
    [[424, 352], [346, 186], [444, 114], [488, 302]],
    [[478, 328], [444, 140], [550, 90], [554, 290]],
    [[540, 314], [540, 92], [644, 100], [618, 294]],
    [[602, 320], [638, 120], [732, 178], [674, 318]],
  ];
  blades.forEach((b, i) => {
    plate(c, b, Object.assign({}, INK, {
      ink: 16, fill: goldFill([b[1][0] - 50, 80, 200, 250], 1.06 + i * 0.08),
    }));
    spec(c, [[b[0][0] + 10, b[0][1] - 12], [b[1][0] + 14, b[1][1] + 18], [b[1][0] + 30, b[1][1] + 26], [b[0][0] + 28, b[0][1] - 6]],
      'rgba(255,248,214,0.55)');
    pathOf(c, [b[2], b[3], [b[3][0] - 18, b[3][1] - 10], [b[2][0] - 16, b[2][1] + 12]], true);
    c.fillStyle = 'rgba(0,0,0,0.34)'; c.fill();
  });

  // ---- steel face inside the opening ------------------------------------
  plate(c, [[382, 404], [618, 404], [632, 652], [500, 752], [368, 652]], {
    ink: 18, inkColor: ink,
    fill: lin(c, 372, 404, 640, 752, [[0, '#bcc2cc'], [0.32, '#828892'], [0.7, '#4b5058'], [1, '#1e2126']]),
  });
  pathOf(c, [[446, 640], ['q', 500, 622, 554, 640], ['q', 500, 668, 446, 640]], true);
  c.fillStyle = 'rgba(5,5,7,0.92)'; c.fill();
  for (let i = -2; i <= 2; i++) {
    c.fillStyle = 'rgba(216,220,228,0.5)';
    c.fillRect(500 + i * 21 - 6.5, 634, 13, 18);
  }

  // ---- helmet shell ------------------------------------------------------
  plate(c, mirrorClose([
    [500, 236],
    ['c', 616, 240, 696, 304, 722, 400],
    ['c', 740, 466, 734, 530, 720, 586],
    [656, 606],
    ['c', 652, 480, 592, 400, 500, 396],
  ]), Object.assign({}, INK, {
    ink: 25, fill: plateFill(c, [284, 240, 432, 372], shell, shellHi, shellLo, 1.0),
  }));
  spec(c, [[340, 400], [418, 300], [468, 322], [378, 442]], 'rgba(198,204,220,0.44)');
  line(c, [[500, 244], [500, 414]], 9, rgba('#000000', 0.4));

  // gold brow trim
  plate(c, mirrorClose([
    [500, 396], ['c', 602, 400, 656, 470, 662, 570], [710, 556],
    ['c', 704, 442, 628, 366, 500, 362],
  ]), Object.assign({}, INK, { ink: 15, fill: goldFill([290, 362, 420, 208], 1.28) }));

  // ---- nose guard --------------------------------------------------------
  plate(c, mirrorClose([
    [500, 366], [534, 400], [532, 604], ['q', 516, 660, 500, 668],
  ]), Object.assign({}, INK, { ink: 16, fill: goldFill([466, 366, 68, 302], 0.9) }));
  spec(c, [[486, 392], [499, 388], [499, 634], [488, 626]], 'rgba(255,250,222,0.6)');

  eye(c, 434, 486, 26, 16, 0.16);
  eye(c, 566, 486, 26, 16, -0.16);

  // ---- cheek guards ------------------------------------------------------
  sym(c, (cc) => {
    plate(cc, [[646, 456], [734, 514], [740, 644], [686, 764], [624, 720], [622, 548]], Object.assign({}, INK, {
      ink: 22, fill: plateFill(cc, [622, 456, 118, 308], shell, lighten(shell, 0.5), shellLo, 1.15),
    }));
    plate(cc, [[650, 480], [708, 524], [714, 630], [674, 732], [638, 704], [634, 554]], {
      ink: 0, fill: lin(cc, 636, 480, 722, 734, [[0, lighten(gold, 0.25)], [0.35, gold], [0.7, darken(gold, 0.4)], [1, darken(gold, 0.75)]]),
    });
    pathOf(cc, [[664, 502], [694, 528], [698, 618], [666, 700], [654, 640]], true);
    cc.fillStyle = 'rgba(0,0,0,0.44)'; cc.fill();
  });

  // ---- gold mane flare ---------------------------------------------------
  sym(c, (cc) => {
    plate(cc, [[602, 690], [706, 734], [746, 838], [672, 902], [584, 848], [572, 748]], Object.assign({}, INK, {
      ink: 21, fill: goldFill([572, 690, 174, 212], 1.05),
    }));
    line(cc, [[618, 730], [664, 860]], 10, rgba(ink, 0.6));
    line(cc, [[674, 748], [700, 832]], 8, rgba(ink, 0.45));
  });

  plate(c, [[434, 714], [566, 714], [594, 812], [500, 880], [406, 812]], Object.assign({}, INK, {
    ink: 21, fill: plateFill(c, [406, 714, 188, 166], darken(shell, 0.2), lighten(shell, 0.36), shellLo, 1.3),
  }));
}

/* --------------------------------------------------------- secondary crests */

function drawStormcrow(c, A) {
  const base = A.body, hi = A.bodyHi, lo = A.bodyLo, ink = A.ink;
  const INK = { ink: 20, inkColor: ink };
  sym(c, (cc) => {
    plate(cc, [[520, 330], [792, 232], [864, 380], [716, 470], [548, 434]], Object.assign({}, INK, {
      ink: 19, fill: plateFill(cc, [520, 232, 344, 238], darken(base, 0.2), hi, darken(lo, 0.3), 1.1),
    }));
    line(cc, [[578, 356], [792, 268]], 8, rgba(ink, 0.5));
  });
  plate(c, mirrorClose([
    [500, 812], ['c', 596, 800, 656, 730, 664, 626],
    ['c', 672, 508, 610, 388, 500, 380],
  ]), Object.assign({}, INK, { ink: 23, fill: plateFill(c, [336, 380, 328, 432], base, hi, lo, 1.0) }));
  pathOf(c, [[500, 384], [662, 556], [606, 756], [500, 790]], true);
  c.fillStyle = rgba(darken(lo, 0.3), 0.44); c.fill();
  plate(c, mirrorClose([[500, 580], [572, 610], [552, 706], [500, 892]]), Object.assign({}, INK, {
    ink: 19, fill: lin(c, 432, 580, 566, 892, [[0, lighten(A.trim, 0.5)], [0.35, A.trim], [1, darken(A.trim, 0.68)]]),
  }));
  line(c, [[430, 656], [570, 656]], 11, rgba(ink, 0.85));
  eye(c, 592, 546, 28, 24, 0);
  eye(c, 408, 546, 28, 24, 0);
  spec(c, [[386, 460], [438, 442], [420, 646], [378, 620]], rgba('#ffffff', 0.3));
}

function drawVoltage(c, A) {
  const ink = A.ink;
  const INK = { ink: 20, inkColor: ink };
  plate(c, mirrorClose([
    [500, 856], ['c', 570, 846, 602, 800, 602, 744],
    ['c', 672, 700, 710, 618, 710, 534],
    ['c', 710, 392, 616, 292, 500, 288],
  ]), Object.assign({}, INK, { ink: 25, fill: plateFill(c, [290, 288, 420, 568], '#cfc9d8', '#ffffff', '#453d54', 1.0) }));
  pathOf(c, [[500, 300], [704, 496], [618, 770], [500, 812]], true);
  c.fillStyle = 'rgba(34,20,54,0.4)'; c.fill();
  sym(c, (cc) => {
    plate(cc, [[526, 444], [644, 424], [662, 522], [580, 566], [528, 524]], {
      ink: 11, inkColor: ink, fill: rad(cc, 594, 494, 4, 594, 494, 80, [[0, '#2e1246'], [1, '#06020b']]),
    });
  });
  eye(c, 596, 496, 25, 19, -0.16);
  eye(c, 404, 496, 25, 19, 0.16);
  sym(c, (cc) => {
    plate(cc, [[500, 636], [544, 658], [532, 730], [500, 706]], { ink: 9, inkColor: ink, fill: '#100a18' });
  });
  for (let i = -2; i <= 2; i++) {
    const x = 500 + i * 33;
    plate(c, [[x - 14, 786], [x + 14, 786], [x + 11, 846], [x - 11, 846]], {
      ink: 8, inkColor: ink, fill: lin(c, x, 786, x, 846, [[0, '#f6f3fb'], [1, '#98melon'.length ? '#968fa8' : '#968fa8']]),
    });
  }
  plate(c, [[736, 132], [430, 506], [576, 522], [292, 902], [692, 462], [538, 444]], Object.assign({}, INK, {
    ink: 19, fill: lin(c, 300, 140, 740, 890, [[0, '#ffffff'], [0.28, lighten(A.trim, 0.4)], [0.7, A.trim], [1, darken(A.trim, 0.45)]]),
  }));
}

function drawIronside(c, A) {
  const base = A.body, hi = A.bodyHi, lo = A.bodyLo, ink = A.ink;
  const INK = { ink: 22, inkColor: ink };
  plate(c, [[288, 412], [672, 330], [764, 428], [766, 706], [652, 822], [344, 822], [268, 690]], Object.assign({}, INK, {
    ink: 25, fill: plateFill(c, [268, 330, 498, 492], base, hi, lo, 1.0),
  }));
  for (let i = 0; i < 4; i++) {
    const y = 438 + i * 94;
    plate(c, [[320, y], [724, y - 38], [728, y + 46], [324, y + 70]], {
      ink: 15, inkColor: ink, fill: plateFill(c, [320, y - 38, 408, 108], lighten(base, 0.16 - i * 0.035), '#ffffff', darken(lo, 0.2), 1.15),
    });
    spec(c, [[344, y + 10], [676, y - 26], [680, y - 4], [346, y + 30]], rgba(hi, 0.3));
  }
  plate(c, [[250, 552], [332, 516], [374, 640], [308, 736], [234, 682]], Object.assign({}, INK, {
    ink: 21, fill: plateFill(c, [234, 516, 140, 220], darken(base, 0.16), hi, darken(lo, 0.2), 0.9),
  }));
  plate(c, [[306, 812], [726, 812], [704, 916], [330, 916]], Object.assign({}, INK, {
    ink: 21, fill: lin(c, 306, 812, 726, 916, [[0, lighten(A.trim, 0.35)], [0.45, A.trim], [1, darken(A.trim, 0.6)]]),
  }));
  for (let i = 0; i < 6; i++) {
    c.beginPath();
    c.arc(360 + i * 66, 862, 12, 0, Math.PI * 2);
    c.fillStyle = lin(c, 0, 850, 0, 876, [[0, '#ffffff'], [1, '#544d70']]);
    c.fill();
    c.strokeStyle = rgba(ink, 0.85); c.lineWidth = 4.5; c.stroke();
  }
}

function drawForge(c, A) {
  const base = A.body, hi = A.bodyHi, lo = A.bodyLo, ink = A.ink;
  const INK = { ink: 22, inkColor: ink };
  plate(c, [[168, 600], [832, 600], [784, 678], [648, 700], [674, 830], [326, 830], [352, 700], [216, 678]], Object.assign({}, INK, {
    ink: 25, fill: plateFill(c, [168, 600, 664, 230], base, hi, lo, 1.05),
  }));
  spec(c, [[212, 616], [804, 616], [782, 644], [228, 648]], rgba(hi, 0.36));
  c.save();
  c.translate(500, 384);
  c.rotate(-0.36);
  plate(c, [[-244, -92], [186, -92], [186, 92], [-244, 92]], Object.assign({}, INK, {
    ink: 25, fill: plateFill(c, [-244, -92, 430, 184], lighten(base, 0.1), hi, lo, 1.1),
  }));
  plate(c, [[186, -74], [284, -36], [284, 36], [186, 74]], Object.assign({}, INK, {
    ink: 21, fill: plateFill(c, [186, -74, 98, 148], base, hi, lo, 1.2),
  }));
  spec(c, [[-218, -66], [158, -66], [158, -32], [-218, -32]], rgba(hi, 0.42));
  plate(c, [[-246, -36], [-452, -6], [-452, 46], [-246, 34]], Object.assign({}, INK, {
    ink: 19, fill: lin(c, -452, 0, -246, 42, [[0, darken(A.trim, 0.7)], [0.5, darken(A.trim, 0.38)], [1, darken(A.trim, 0.64)]]),
  }));
  c.restore();
  const rng = makeRng(91);
  for (let i = 0; i < 26; i++) {
    const a = -Math.PI * (0.12 + rng() * 0.76);
    const r = 130 + rng() * 320;
    const x = 500 + Math.cos(a) * r * (rng() < 0.5 ? -1 : 1);
    const y = 600 + Math.sin(a) * r * 0.66;
    const s = 5 + rng() * 14;
    c.beginPath();
    c.moveTo(x, y); c.lineTo(x + s * 1.7, y - s * 0.8); c.lineTo(x + s * 0.4, y + s * 0.5);
    c.closePath();
    c.fillStyle = rgba(rng() < 0.45 ? '#ffffff' : A.trim, 0.3 + rng() * 0.6);
    c.fill();
  }
}

const DRAW = {
  liberty: drawLiberty,
  bulldog: drawBulldog,
  longhorn: drawLonghorn,
  spartan: drawSpartan,
  stormcrow: drawStormcrow,
  voltage: drawVoltage,
  ironside: drawIronside,
  forge: drawForge,
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
  const draw = DRAW[A.crest] || drawLiberty;
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
    shardBurst(c, 500, 486, 500, A.shard, 1000 + team.id.charCodeAt(0) * 7 + team.id.length, {
      count: 14, alpha: 0.42, rot: 0.42,
    });
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
  draw(c, A);
  c.restore();
  c.restore();

  if (detail) {
    innerGlowPass(c, W, W, A.glow, { alpha: 0.18, r: 0.5, cy: 0.48 });
    sheenPass(c, W, W, { top: 0.18, bot: 0.36 });
    // edge falloff — pushes the emblem's outer forms into shadow
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
