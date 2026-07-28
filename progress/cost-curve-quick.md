# COST CURVE — measured on this container (SwiftShader, 4 cores, no GPU)

Produced by `node scripts/costcurve.mjs`. Every number is a MEASUREMENT taken on
this box with the game loop stopped and this script owning rAF. Nothing here is a
projection and nothing here is a phone number.

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

- `frame p50/p95` — render + readPixels round trip. The honest cost of producing
  one frame's pixels: JS + submission + software raster. THE number.
- `renderJS` — time for `renderer.render()` to return (command submission only).
- `raster` — time for the following `readPixels` to return: the wait on the
  software rasteriser. On real hardware this is overlapped with the next frame.
- `drawn` — `renderer.info.render` for that single frame, AFTER frustum culling.

Surface: 390x844 CSS at dpr 2 (full-res buffer at scale 1.0 = 780x1688 = 1.32 MP).
Base scene: 52044 triangles across 26 visible meshes.

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
| 1.00 | 780x1688 | 1.32 | 142156 | 82764 | 42 | 1234.2 | 1251.2 | 2.40 | 1232.4 |
| 1.00 | 780x1688 | 1.32 | 43416 | 43416 | 26 | 1219.5 | 1261.0 | 1.90 | 1216.6 |
| 1.00 | 780x1688 | 1.32 | 6712 | 6712 | 11 | 920.3 | 932.4 | 0.80 | 919.5 |
| 0.50 | 390x844 | 0.33 | 142156 | 82764 | 42 | 357.4 | 377.5 | 1.50 | 355.1 |
| 0.50 | 390x844 | 0.33 | 43416 | 43416 | 26 | 330.3 | 355.3 | 1.30 | 329.0 |
| 0.50 | 390x844 | 0.33 | 6712 | 6712 | 11 | 245.4 | 257.8 | 0.80 | 244.2 |
| 0.25 | 195x422 | 0.08 | 142156 | 82764 | 42 | 122.4 | 131.8 | 1.60 | 120.9 |
| 0.25 | 195x422 | 0.08 | 43416 | 43416 | 26 | 107.0 | 125.8 | 1.30 | 105.3 |
| 0.25 | 195x422 | 0.08 | 6712 | 6712 | 11 | 72.1 | 91.0 | 0.70 | 71.4 |
| 1.00 * | 780x1688 | 1.32 | 142156 | 82764 | 42 | 1147.4 | 1159.4 | 1.20 | 1146.2 |

`*` = ORDER CONTROL — repeat of row 1.

## Control points

| control | tris in scene | tris drawn | frame p50 | raster |
|---|---:|---:|---:|---:|
| rAF only, GL submission skipped | 52044 | 82764 | 0.0 | 0.0 |
| empty scene @0.50 buffer, both layers | 0 | 0 | 3.5 | 3.2 |
| empty scene @1.00 buffer, both layers | 0 | 0 | 4.7 | 4.3 |
| empty scene @0.50 buffer, GL layer only | 0 | 0 | 4.3 | 3.7 |
| base scene @0.50 buffer, GL layer only | 52044 | 52044 | 321.3 | 319.9 |
| base scene @0.50 buffer | 52044 | 52044 | 322.3 | 321.3 |
| base scene @0.25 buffer | 52044 | 52044 | 106.3 | 103.7 |
| base scene @0.125 buffer | 52044 | 52044 | 43.8 | 41.7 |

## THE LADDER, MEASURED

Each row applies a real rung through the real `applyRung` path — drawing buffer,
shadow state, and every piece's own `applyRung` — then measures it. A rung that
does not cost less than the rung above it is not a rung, it is a label.

| rung | tier | buffer | MP | tris drawn | draw calls | frame p50 ms | vs 33.3 ms (30 Hz) |
|---:|---|---:|---:|---:|---:|---:|---|
| 0 | floor | 195x422 | 0.082 | 48342 | 22 | 85.5 | 2.6x over |
| 1 | floor | 215x464 | 0.100 | 48342 | 22 | 102.4 | 3.1x over |
| 2 | floor | 234x506 | 0.118 | 48342 | 22 | 120.0 | 3.6x over |
| 3 | low | 302x654 | 0.198 | 50094 | 24 | 219.9 | 6.6x over |
| 4 | low | 312x675 | 0.211 | 50094 | 24 | 198.0 | 5.9x over |
| 5 | low | 380x823 | 0.313 | 50094 | 24 | 273.1 | 8.2x over |
| 6 | low | 380x823 | 0.313 | 50094 | 24 | 267.4 | 8.0x over |
| 7 | mid | 478x1034 | 0.494 | 52044 | 27 | 458.6 | 13.8x over |
| 8 | mid | 512x1108 | 0.567 | 52044 | 27 | 525.8 | 15.8x over |
| 9 | mid | 624x1350 | 0.842 | 52044 | 27 | 761.8 | 22.9x over |
| 10 | mid | 640x1384 | 0.886 | 52044 | 27 | 823.0 | 24.7x over |
| 11 | mid | 663x1435 | 0.951 | 52044 | 27 | 916.3 | 27.5x over |
| 12 | high | 702x1519 | 1.066 | 52044 | 27 | 980.4 | 29.4x over |
| 13 | high | 733x1587 | 1.163 | 52044 | 27 | 1035.1 | 31.1x over |
| 14 | high | 757x1637 | 1.239 | 52044 | 27 | 1140.1 | 34.2x over |
| 15 | high | 780x1688 | 1.317 | 52044 | 27 | 1253.6 | 37.6x over |

## ABLATION — who owns the frame cost at rung 0

Baseline at rung 0, nothing hidden: **95.3 ms** (52044 triangles drawn). Each row hides one owner and re-measures.

| owner hidden | triangles removed | frame p50 ms | ms saved |
|---|---:|---:|---:|
| turf.field | 672 | 58.0 | 37.3 |
| sl.sky | 1088 | 88.5 | 6.8 |
| stadium.sky | 952 | 88.7 | 6.6 |
| stadium.boards | 1032 | 90.1 | 5.2 |
| sl.shafts | 22 | 90.1 | 5.2 |
| stadium.glow | 1540 | 90.2 | 5.1 |
| stadium.props | 8628 | 91.2 | 4.1 |
| impact-fx | 352 | 92.7 | 2.6 |
| sl.rain | 840 | 93.7 | 1.6 |
| character-anatomy | 31584 | 94.2 | 1.1 |
| sl.atmos | 212 | 94.5 | 0.8 |
| stadium.bowl | 5120 | 96.2 | -0.9 |
| sl.veil | 2 | 96.3 | -1.0 |

## FLOOR PROBE — choosing rung 0 from the curve

Rung 0's row in the live `RUNGS` table is overwritten with each candidate and
applied for real — real buffer resize, real actor-LOD rebuild, real per-piece
`applyRung` — then measured. The 30 Hz period is 33.3 ms; the contract's
main-thread wall at 30 Hz is 30.00 ms with 3.33 ms of inviolable slack.

| actor LOD mix | renderScale (dprCap 1.0) | buffer | MP | tris drawn | draw calls | frame p50 | frame p95 | holds 30 Hz? |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| 6 skinned + 8 imposter (as shipped) | 0.50 | 195x422 | 0.0823 | 48342 | 22 | 93.8 | 96.4 | no |
| 6 skinned + 8 imposter (as shipped) | 0.40 | 156x338 | 0.0527 | 48342 | 22 | 68.2 | 73.2 | no |
| 6 skinned + 8 imposter (as shipped) | 0.32 | 125x270 | 0.0338 | 48342 | 22 | 51.5 | 52.2 | no |
| 6 skinned + 8 imposter (as shipped) | 0.26 | 101x219 | 0.0221 | 48342 | 22 | 40.3 | 45.9 | no |
| 6 skinned + 8 imposter (as shipped) | 0.22 | 86x186 | 0.0160 | 48342 | 22 | 33.8 | 38.1 | no |
| 6 skinned + 8 imposter (as shipped) | 0.18 | 70x152 | 0.0106 | 48342 | 22 | 31.1 | 33.2 | marginal |
| 6 skinned + 8 imposter (as shipped) | 0.14 | 55x118 | 0.0065 | 48342 | 22 | 26.9 | 30.9 | marginal |
| 0 skinned + 14 imposter | 0.50 | 195x422 | 0.0823 | 48342 | 22 | 85.9 | 107.1 | no |
| 0 skinned + 14 imposter | 0.40 | 156x338 | 0.0527 | 48342 | 22 | 65.2 | 69.3 | no |
| 0 skinned + 14 imposter | 0.32 | 125x270 | 0.0338 | 48342 | 22 | 50.3 | 57.5 | no |
| 0 skinned + 14 imposter | 0.26 | 101x219 | 0.0221 | 48342 | 22 | 40.9 | 44.7 | no |
| 0 skinned + 14 imposter | 0.22 | 86x186 | 0.0160 | 48342 | 22 | 35.9 | 39.5 | no |
| 0 skinned + 14 imposter | 0.18 | 70x152 | 0.0106 | 48342 | 22 | 31.0 | 35.9 | marginal |
| 0 skinned + 14 imposter | 0.14 | 55x118 | 0.0065 | 48342 | 22 | 26.5 | 31.9 | marginal |
