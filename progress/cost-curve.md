# COST CURVE — measured on this container (SwiftShader, 4 cores, no GPU)

Produced by `node scripts/costcurve.mjs`. Every number is a MEASUREMENT taken on
this box with the game loop stopped and this script owning rAF. Nothing here is a
projection and nothing here is a phone number.

## READING THE CURVE — what it says, in one place

Frame cost along the ladder is NOT linear in resolution across its whole range:
the top is fill-bound and slightly sublinear, the bottom is bound by per-triangle
work that no resolution touches. Fitting one line to all sixteen rungs returns an
intercept of 0.5 ms, which the rung 0 measurement contradicts outright. So the
model below is fitted LOCALLY from the two lowest-resolution rungs
(0.004 MP -> 24.2 ms and 0.026 MP -> 42.4 ms) and is only claimed near the floor:

```
    frame_ms  ~  20.8  +  838 * megapixels        (near the floor)
    slope at the top of the ladder: 868 ms per megapixel
```

The **20.8 ms intercept is resolution-independent**: it is per-triangle and
per-draw-call work for the 48342 triangles and 22 draw calls still on screen at
rung 0, and NO render scale can remove it. That single fact is why the floor rung
had to move on two axes rather than one, and why the actor-LOD ordering bug
mattered more than any amount of downscaling: against a 33.3 ms period, an
irreducible 21 ms is most of the budget before a pixel is filled.

An empty scene costs 5.0 ms and skipping GL submission entirely costs
0.0 ms, so that intercept is the SCENE, not the page or the loop.

The ladder as shipped spans **24.2 ms at rung 0 to 1239.4 ms at rung 15** (51x).
The 30 Hz period is 33.3 ms, so on this box only the floor rungs are playable and
everything from rung 3 up is a projection about hardware this container does not
have. That is stated, not hidden.

Surface: 390x844 CSS at dpr 2 (full-res buffer at scale 1.0 = 780x1688 = 1.32 MP).
Base scene: 52044 triangles across 26 visible meshes.

## How these numbers are taken, and why it matters

Every frame is SERIALISED: `renderer.render()`, then a 1x1 `gl.readPixels()`.

That is not a stylistic choice. The first cut of this script measured rAF-to-rAF
interval with one render per rAF and no sync, and reported a flat **16.7 ms for
every point in the grid** — full scene at full resolution included. It was false.
`renderer.render()` only writes commands into Chrome's command buffer; the GPU
process rasterises them later and rAF does not wait. The rAF loop free-ran at
60 Hz while the GPU process fell further behind, and the single `readPixels` that
followed took **26.5 seconds** draining a 16-frame backlog. `gl.finish()` returned
0.0 ms on those same frames, so it cannot be used as the sync either.

The same bug was live in `quality.js`'s boot `gpuProbe`, which used `gl.finish()`
and therefore reported `ms: 0` for all four of its points while burning 1.2 s of
boot — so `classify()` silently skipped the entire GPU branch. Both are fixed.

- `frame p50/p95` — render + readPixels round trip. The honest cost of producing
  one frame's pixels: JS + submission + software raster. THE number.
- `renderJS` — time for `renderer.render()` to return (command submission only).
- `raster` — time for the following `readPixels` to return: the wait on the
  software rasteriser. On real hardware this is overlapped with the next frame.
- `drawn` — `renderer.info.render` for that single frame, AFTER frustum culling.

## Where the base scene's triangles come from

| owner | triangles | meshes |
|---|---:|---:|
| character-anatomy | 31584 | 14 |
| stadium.props | 8628 | 1 |
| stadium.bowl | 5120 | 1 |
| stadium.glow | 1540 | 1 |
| sl.sky | 1088 | 1 |
| stadium.boards | 1032 | 1 |
| stadium.sky | 952 | 1 |
| sl.rain | 840 | 1 |
| turf.field | 672 | 1 |
| impact-fx | 352 | 1 |
| sl.atmos | 212 | 1 |
| sl.shafts | 22 | 1 |
| sl.veil | 2 | 1 |

## Shadows OFF

| render scale | buffer | MP | tris in scene | tris drawn | draw calls | frame p50 | frame p95 | renderJS | raster |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1.00 | 780x1688 | 1.32 | 142156 | 82764 | 42 | 1238.6 | 1301.2 | 2.60 | 1235.0 |
| 1.00 | 780x1688 | 1.32 | 90956 | 70476 | 36 | 1225.3 | 1268.8 | 1.90 | 1223.2 |
| 1.00 | 780x1688 | 1.32 | 43416 | 43416 | 26 | 1146.4 | 1224.8 | 2.90 | 1142.9 |
| 1.00 | 780x1688 | 1.32 | 17992 | 17992 | 16 | 898.6 | 1110.9 | 1.50 | 897.5 |
| 1.00 | 780x1688 | 1.32 | 6712 | 6712 | 11 | 911.8 | 1087.0 | 0.80 | 910.3 |
| 0.75 | 585x1266 | 0.74 | 142156 | 82764 | 42 | 719.2 | 765.5 | 2.20 | 717.0 |
| 0.75 | 585x1266 | 0.74 | 90956 | 70476 | 36 | 693.7 | 763.9 | 1.40 | 691.4 |
| 0.75 | 585x1266 | 0.74 | 43416 | 43416 | 26 | 660.3 | 689.0 | 1.30 | 659.0 |
| 0.75 | 585x1266 | 0.74 | 17992 | 17992 | 16 | 533.0 | 551.3 | 1.10 | 532.0 |
| 0.75 | 585x1266 | 0.74 | 6712 | 6712 | 11 | 514.9 | 530.6 | 0.80 | 513.6 |
| 0.50 | 390x844 | 0.33 | 142156 | 82764 | 42 | 351.6 | 362.5 | 1.70 | 350.4 |
| 0.50 | 390x844 | 0.33 | 90956 | 70476 | 36 | 343.0 | 352.9 | 2.20 | 339.9 |
| 0.50 | 390x844 | 0.33 | 43416 | 43416 | 26 | 330.9 | 343.7 | 1.20 | 329.6 |
| 0.50 | 390x844 | 0.33 | 17992 | 17992 | 16 | 243.4 | 274.6 | 1.00 | 242.4 |
| 0.50 | 390x844 | 0.33 | 6712 | 6712 | 11 | 233.3 | 243.9 | 0.60 | 232.7 |
| 0.35 | 273x591 | 0.16 | 142156 | 82764 | 42 | 196.0 | 223.8 | 1.30 | 194.8 |
| 0.35 | 273x591 | 0.16 | 90956 | 70476 | 36 | 184.1 | 193.2 | 1.40 | 182.6 |
| 0.35 | 273x591 | 0.16 | 43416 | 43416 | 26 | 170.4 | 178.8 | 1.20 | 168.8 |
| 0.35 | 273x591 | 0.16 | 17992 | 17992 | 16 | 131.7 | 150.0 | 1.10 | 130.7 |
| 0.35 | 273x591 | 0.16 | 6712 | 6712 | 11 | 131.8 | 154.6 | 0.60 | 131.2 |
| 0.25 | 195x422 | 0.08 | 142156 | 82764 | 42 | 113.3 | 136.1 | 1.20 | 110.5 |
| 0.25 | 195x422 | 0.08 | 90956 | 70476 | 36 | 107.1 | 119.7 | 1.40 | 105.8 |
| 0.25 | 195x422 | 0.08 | 43416 | 43416 | 26 | 101.6 | 106.3 | 1.60 | 99.4 |
| 0.25 | 195x422 | 0.08 | 17992 | 17992 | 16 | 70.6 | 78.0 | 1.00 | 69.3 |
| 0.25 | 195x422 | 0.08 | 6712 | 6712 | 11 | 64.6 | 67.8 | 0.60 | 63.9 |
| 1.00 * | 780x1688 | 1.32 | 142156 | 82764 | 42 | 1177.2 | 1274.8 | 1.50 | 1175.7 |

`*` = ORDER CONTROL — repeat of row 1. It agrees with row 1 to within run-to-run noise, so the sweep has no order effect.

## Shadows ON

| render scale | buffer | MP | tris in scene | tris drawn | draw calls | frame p50 | frame p95 | renderJS | raster |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1.00 | 780x1688 | 1.32 | 142156 | 82764 | 42 | 1292.3 | 1357.1 | 1.70 | 1286.6 |
| 1.00 | 780x1688 | 1.32 | 90956 | 70476 | 36 | 1242.1 | 1383.9 | 1.50 | 1237.4 |
| 1.00 | 780x1688 | 1.32 | 43416 | 43416 | 26 | 1222.8 | 1308.0 | 1.20 | 1221.6 |
| 1.00 | 780x1688 | 1.32 | 17992 | 17992 | 16 | 947.4 | 1000.2 | 0.90 | 946.5 |
| 1.00 | 780x1688 | 1.32 | 6712 | 6712 | 11 | 918.1 | 1000.0 | 0.90 | 917.4 |
| 0.75 | 585x1266 | 0.74 | 142156 | 82764 | 42 | 751.6 | 784.1 | 1.70 | 750.2 |
| 0.75 | 585x1266 | 0.74 | 90956 | 70476 | 36 | 735.8 | 851.1 | 1.50 | 734.5 |
| 0.75 | 585x1266 | 0.74 | 43416 | 43416 | 26 | 693.2 | 707.4 | 1.20 | 692.0 |
| 0.75 | 585x1266 | 0.74 | 17992 | 17992 | 16 | 553.7 | 665.4 | 1.00 | 552.6 |
| 0.75 | 585x1266 | 0.74 | 6712 | 6712 | 11 | 540.3 | 594.5 | 0.80 | 539.6 |
| 0.50 | 390x844 | 0.33 | 142156 | 82764 | 42 | 383.5 | 439.6 | 1.60 | 382.2 |
| 0.50 | 390x844 | 0.33 | 90956 | 70476 | 36 | 368.6 | 410.8 | 1.70 | 366.0 |
| 0.50 | 390x844 | 0.33 | 43416 | 43416 | 26 | 356.5 | 366.8 | 1.40 | 355.4 |
| 0.50 | 390x844 | 0.33 | 17992 | 17992 | 16 | 257.0 | 287.5 | 0.90 | 256.1 |
| 0.50 | 390x844 | 0.33 | 6712 | 6712 | 11 | 242.4 | 307.2 | 0.80 | 241.8 |
| 0.35 | 273x591 | 0.16 | 142156 | 82764 | 42 | 219.0 | 237.3 | 1.70 | 217.2 |
| 0.35 | 273x591 | 0.16 | 90956 | 70476 | 36 | 213.8 | 227.7 | 1.70 | 212.1 |
| 0.35 | 273x591 | 0.16 | 43416 | 43416 | 26 | 194.1 | 206.6 | 1.50 | 192.4 |
| 0.35 | 273x591 | 0.16 | 17992 | 17992 | 16 | 138.7 | 143.9 | 1.00 | 137.6 |
| 0.35 | 273x591 | 0.16 | 6712 | 6712 | 11 | 130.5 | 137.5 | 0.80 | 129.8 |
| 0.25 | 195x422 | 0.08 | 142156 | 82764 | 42 | 134.1 | 145.7 | 1.40 | 132.0 |
| 0.25 | 195x422 | 0.08 | 90956 | 70476 | 36 | 125.9 | 147.4 | 1.30 | 123.6 |
| 0.25 | 195x422 | 0.08 | 43416 | 43416 | 26 | 119.4 | 130.4 | 1.50 | 117.7 |
| 0.25 | 195x422 | 0.08 | 17992 | 17992 | 16 | 80.8 | 84.6 | 1.00 | 79.7 |
| 0.25 | 195x422 | 0.08 | 6712 | 6712 | 11 | 70.5 | 75.3 | 0.70 | 69.5 |

## Control points

| control | tris in scene | tris drawn | frame p50 | raster |
|---|---:|---:|---:|---:|
| rAF only, GL submission skipped | 52044 | 82764 | 0.0 | 0.0 |
| empty scene @0.50 buffer, both layers | 0 | 0 | 5.0 | 4.6 |
| empty scene @1.00 buffer, both layers | 0 | 0 | 5.6 | 5.2 |
| empty scene @0.50 buffer, GL layer only | 0 | 0 | 4.5 | 4.1 |
| base scene @0.50 buffer, GL layer only | 52044 | 52044 | 335.7 | 333.9 |
| base scene @0.50 buffer | 52044 | 52044 | 337.9 | 336.3 |
| base scene @0.25 buffer | 52044 | 52044 | 108.5 | 107.0 |
| base scene @0.125 buffer | 52044 | 52044 | 44.9 | 43.4 |

## THE LADDER, MEASURED

Each row applies a real rung through the real `applyRung` path — drawing buffer,
shadow state, and every piece's own `applyRung` — then measures it. A rung that
does not cost less than the rung above it is not a rung, it is a label.

| rung | tier | buffer | MP | tris drawn | draw calls | frame p50 ms | vs 33.3 ms (30 Hz) |
|---:|---|---:|---:|---:|---:|---:|---|
| 0 | floor | 43x93 | 0.004 | 48342 | 22 | 24.2 | **FITS** |
| 1 | floor | 109x236 | 0.026 | 48342 | 22 | 42.4 | 1.3x over |
| 2 | floor | 195x422 | 0.082 | 48342 | 22 | 83.5 | 2.5x over |
| 3 | low | 302x654 | 0.198 | 50094 | 24 | 186.1 | 5.6x over |
| 4 | low | 312x675 | 0.211 | 50094 | 24 | 193.3 | 5.8x over |
| 5 | low | 380x823 | 0.313 | 50094 | 24 | 273.0 | 8.2x over |
| 6 | low | 380x823 | 0.313 | 50094 | 24 | 269.1 | 8.1x over |
| 7 | mid | 478x1034 | 0.494 | 52044 | 27 | 472.8 | 14.2x over |
| 8 | mid | 512x1108 | 0.567 | 52044 | 27 | 538.1 | 16.2x over |
| 9 | mid | 624x1350 | 0.842 | 52044 | 27 | 772.3 | 23.2x over |
| 10 | mid | 640x1384 | 0.886 | 52044 | 27 | 840.0 | 25.2x over |
| 11 | mid | 663x1435 | 0.951 | 52044 | 27 | 856.6 | 25.7x over |
| 12 | high | 702x1519 | 1.066 | 52044 | 27 | 989.6 | 29.7x over |
| 13 | high | 733x1587 | 1.163 | 52044 | 27 | 1137.8 | 34.2x over |
| 14 | high | 757x1637 | 1.239 | 52044 | 27 | 1172.2 | 35.2x over |
| 15 | high | 780x1688 | 1.317 | 52044 | 27 | 1239.4 | 37.2x over |

Note the `tris drawn` column. It moves by a few per cent across the whole ladder,
because the only geometry lever any rung has is the actor LOD mix — and that mix
is chosen when an actor is BUILT. Before this round the world was built BEFORE the
boot rung was ever applied, so every device got the high tier's mix and the column
read 134,058 at rung 0 against 137,760 at rung 15: a 2.7% span across sixteen
rungs, over a floor-tier structural cap of 90,000. Fixing the ordering took the
base scene from 137,760 triangles and 69 draw calls to 52,044 and 27.

## ABLATION — who owns the frame cost at rung 0

Baseline at rung 0, nothing hidden: **25.8 ms** (52044 triangles drawn). Each row hides one owner and re-measures.
At rung 0's tiny buffer the fill term is nearly gone, so what remains is mostly
per-triangle and per-draw-call cost. Small negative numbers are run-to-run noise.

| owner hidden | triangles removed | frame p50 ms | ms saved |
|---|---:|---:|---:|
| turf.field | 672 | 21.4 | 4.4 |
| stadium.props | 8628 | 22.6 | 3.2 |
| sl.veil | 2 | 22.6 | 3.2 |
| stadium.glow | 1540 | 23.0 | 2.8 |
| stadium.bowl | 5120 | 23.1 | 2.7 |
| sl.rain | 840 | 23.2 | 2.6 |
| sl.sky | 1088 | 23.3 | 2.5 |
| character-anatomy | 31584 | 23.5 | 2.3 |
| stadium.boards | 1032 | 23.9 | 1.9 |
| impact-fx | 352 | 24.8 | 1.0 |
| stadium.sky | 952 | 25.2 | 0.6 |
| sl.shafts | 22 | 26.2 | -0.4 |
| sl.atmos | 212 | 26.6 | -0.8 |

## FLOOR PROBE — choosing rung 0 from the curve

Rung 0's row in the live `RUNGS` table is overwritten with each candidate and
applied for real — real buffer resize, real actor-LOD rebuild, real per-piece
`applyRung` — then measured. The 30 Hz period is 33.3 ms; the contract's
main-thread wall at 30 Hz is 30.00 ms with 3.33 ms of inviolable slack.

The two LOD mixes below draw the SAME triangle count. That is the finding, not a
mistake: `character-anatomy` builds LOD2 and LOD3 identically, so the rung table's
`imposter` column currently moves nothing.

| actor LOD mix | renderScale (dprCap 1.0) | buffer | MP | tris drawn | draw calls | frame p50 | frame p95 | holds 30 Hz? |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| 6 skinned + 8 imposter (as shipped) | 0.50 | 195x422 | 0.0823 | 48342 | 22 | 104.0 | 110.1 | no |
| 6 skinned + 8 imposter (as shipped) | 0.40 | 156x338 | 0.0527 | 48342 | 22 | 71.8 | 88.1 | no |
| 6 skinned + 8 imposter (as shipped) | 0.32 | 125x270 | 0.0338 | 48342 | 22 | 50.3 | 54.9 | no |
| 6 skinned + 8 imposter (as shipped) | 0.26 | 101x219 | 0.0221 | 48342 | 22 | 38.6 | 46.9 | no |
| 6 skinned + 8 imposter (as shipped) | 0.22 | 86x186 | 0.0160 | 48342 | 22 | 36.1 | 53.7 | no |
| 6 skinned + 8 imposter (as shipped) | 0.18 | 70x152 | 0.0106 | 48342 | 22 | 32.4 | 43.6 | marginal |
| 6 skinned + 8 imposter (as shipped) | 0.14 | 55x118 | 0.0065 | 48342 | 22 | 28.1 | 34.2 | marginal |
| 0 skinned + 14 imposter | 0.50 | 195x422 | 0.0823 | 48342 | 22 | 90.1 | 106.0 | no |
| 0 skinned + 14 imposter | 0.40 | 156x338 | 0.0527 | 48342 | 22 | 67.5 | 81.8 | no |
| 0 skinned + 14 imposter | 0.32 | 125x270 | 0.0338 | 48342 | 22 | 49.3 | 53.8 | no |
| 0 skinned + 14 imposter | 0.26 | 101x219 | 0.0221 | 48342 | 22 | 38.5 | 44.3 | no |
| 0 skinned + 14 imposter | 0.22 | 86x186 | 0.0160 | 48342 | 22 | 35.5 | 46.1 | no |
| 0 skinned + 14 imposter | 0.18 | 70x152 | 0.0106 | 48342 | 22 | 28.6 | 33.5 | marginal |
| 0 skinned + 14 imposter | 0.14 | 55x118 | 0.0065 | 48342 | 22 | 25.2 | 31.7 | marginal |

The shipped rung 0 was then chosen from REAL HARNESS RUNS rather than from this
serialised proxy — see the note at the top of `RUNGS` in `src/foundation/quality.js`
and `scripts/perf.mjs --rung-scale=X`.
