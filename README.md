# BLITZ RELOADED

Arcade football. Real-time 3D in **three.js / WebGL2**, rendered headless through
SwiftShader, split into a **3D world layer** and a **deterministic Canvas2D overlay layer**.

The bar is `bar/` — ten panels off a concept sheet. Every piece is judged blind against
one named panel or one named quality, side by side, at matched height.

---

## 0. TL;DR for a builder agent

```bash
cd /home/user/nflblitz

# see what exists
node scripts/shoot.mjs --list

# capture your piece's scenes (self-heals: npm ci + vite build + server + playwright)
node scripts/shoot.mjs --piece=<your-piece-id>

# put it next to the bar
node scripts/compare.mjs --panel=truck --shot=shots/<your-piece-id>/truck.png \
                         --out=shots/<your-piece-id>/cmp.png

# sanity gate before any verdict
node scripts/lint-determinism.mjs

# log what happened (append-only, race-free, 16 agents can do this concurrently)
node scripts/log-event.mjs --piece=<id> --round=1 --agent=builder --event=build_done
```

**You own exactly one directory: `src/pieces/<your-piece-id>/`.** Nothing else. Ever.
Your screenshots go in `shots/<your-piece-id>/`, which is also yours.

---

## 1. Architecture

```
index.html
 └─ #stage  (1920x1080, CSS-sized to ?w x ?h)
     ├─ <canvas id="gl">   three.js WebGL2 world           <- 3D pieces
     └─ <canvas id="ui">   Canvas2D overlay, logical 1920x1080  <- UI pieces
```

Both layers are captured in **one** Playwright screenshot.

Canvas2D (not DOM/CSS) for the overlay because it is deterministic — no font metric or
layout drift between runs — pixel-exact, and it supports the bevels, gradient maps,
roughened edges and grain the bar's UI needs.

```
src/
  main.js                      boot; imports src/pieces/index.js
  foundation/                  FROZEN. Nobody but foundation ever edits these.
    engine.js                  renderer, accumulation capture, readiness flag
    registry.js                the plug board + PIECE_IDS + PIECE_HEROES + SCENE_PANELS
    contracts.js               ShotSpec schema, FIELD coords, MAT_SLOTS
    params.js                  URL params + quality profiles
    rng.js                     makeRng / hash / gauss / halton
    rig.js                     THE 26-BONE RIG (the anatomy|pose|uniform seam)
    texlab.js                  fBm / worley / curl / ridged / heightToNormal / ramps / decals
    typeface.js                vector type engine + fallback face set
    overlay.js                 the 1920x1080 Canvas2D layer + draw order
    world.js                   buildFromShot(shot, ctx) — the fixed assembly order
    scenes.js                  scene resolution: isoShots FIRST, then cinema.shots
    input.js                   keyboard/gamepad (live mode only)
    fallbacks/*.js             one deliberately-plain fallback per contract
  pieces/
    index.js                   FROZEN. static import of all 16 pieces, alphabetical.
    <piece-id>/index.js        YOURS.
```

---

## 2. The 16 pieces

| piece id | slot it registers | judged on | hero panels |
|---|---|---|---|
| `brand-identity` | `registerBrand` | crests, wordmarks, skylines, league mark, BLITZ logotype | team_select, title |
| `character-anatomy` | `registerWorld('anatomy')` | silhouette, pad bulk, helmet form, archetype proportion | truck, leveler |
| `cinematography` | `registerCinema` | staging, lens, bokeh DOF, bloom, grade, vignette | midair_hit, touchdown |
| `hud-overlay` | `registerUI('hud')` | top-left HUD + blue TURBO meter | qb_dropback, truck |
| `impact-fx` | `registerWorld('fx')` | sparks, turf spray, debris, smoke, flaming ball | leveler, midair_hit |
| `menu-playcall` | `registerUI('playcall')` | DEFENSE! PICK A PLAY, 8 route tiles, :09 clock | playcall_def |
| `menu-team-select` | `registerUI('teamSelect')` | CHOOSE YOUR CITY, 4 cards, gold stat bars | team_select |
| `menu-title` | `registerUI('title')` | chrome BLITZ / red RELOADED / skyline / lightning | title |
| `play-sim` | `registerSim` | 7-on-7 arcade play sim driving `live_play` | live_play, qb_dropback |
| `pose-animation` | `registerWorld('pose')` | weight, extension, follow-through, contact | truck, catch |
| `score-callout` | `registerUI('callout')` | hand-lettered italic callouts, gold numerals | midair_hit, truck |
| `stadium-env` | `registerWorld('stadium')` | night bowl, crowd, jumbotron, atmospheric depth | qb_dropback, catch |
| `stadium-lighting` | `registerWorld('lighting')` | rim light placement, shafts, lightning, exposure | midair_hit, qb_dropback |
| `turf-field` | `registerWorld('turf')` | wet torn turf that scatters and holds cleat marks | truck, touchdown |
| `typeface-lettering` | `registerFaces` | the four vector faces | title, midair_hit |
| `uniform-kit` | `registerWorld('uniform')` **and** `registerUI('uniformScreen')` | materials per team+variant, numbers, dirt, wet | uniform, truck |

Foundation ships a **working, deliberately plain fallback for every one of these**, so on
round 1 all 16 build, run and screenshot in isolation with nothing missing.

Fallbacks are untextured grey capsules, system-font text and flat lighting, and UI
fallbacks stamp a red `FALLBACK · <piece-id>` tag. A critic can never mistake a fallback
for a piece's real output.

---

## 3. How to add a piece

Everything happens inside `src/pieces/<your-id>/`. Your `index.js` performs the
registration as an **import side effect** — `src/pieces/index.js` already imports it.

```js
// src/pieces/turf-field/index.js
import { registerWorld, registerIsoShot } from '../../foundation/registry.js';
import { FIELD } from '../../foundation/contracts.js';
import { makeRng } from '../../foundation/rng.js';
import { buildTurf } from './turf.js';          // your own files, your own directory

export const PIECE = 'turf-field';

registerWorld('turf', {
  piece: PIECE,                                  // provenance, shows in --list
  build(ctx) { return buildTurf(ctx); },
  addDivot(x, z, dirX, dirZ, strength) { /* ... */ },
  addCleatMark(x, z, rotY, depth) { /* ... */ },
  addSkid(x0, z0, x1, z1, w) { /* ... */ },
  reset() { /* ... */ },
  update(t, ctx) { /* ... */ },
});

// Your OWN capture scene. The resolver checks isoShots BEFORE cinema.shots, which is
// what keeps per-piece capture scenes file-disjoint.
registerIsoShot('iso:turf-field', {
  piece: PIECE,
  panel: 'truck',                                // the bar panel it is judged against
  camera: { pos: [0, 1.1, 5.0], target: [0, 0.1, -1], fov: 32 },
  lens: { fStop: 2.2, focusDist: 5, bokehScale: 1, shutter: 1/90 },
  actors: [],
  hud: { visible: false },
  turfDamage: [
    { type: 'divot', x: 0.4, z: 1.2, rot: 0.3, strength: 1 },
    { type: 'skid',  x: -2, z: 1.5, x1: 1, z1: 1.1, w: 0.6, strength: 1 },
  ],
  note: 'raking light across torn wet turf — this is what I am claiming',
});
```

Then:

```bash
node scripts/shoot.mjs --piece=turf-field     # -> shots/turf-field/*.png
```

### Rules

1. **File ownership.** You write only inside `src/pieces/<your-id>/`. You may IMPORT
   from `src/foundation/*` and you may read another piece's public surface through the
   registry (`REG.faces`, `REG.brand`, `REG.world.turf`, …). You must **never** import
   another piece's files directly and never edit any file outside your directory.
2. **Determinism.** No `Math.random`, `Date.now`, `performance.now`, `new Date()`, or
   `crypto.getRandomValues` anywhere under `src/pieces/`.
   `node scripts/lint-determinism.mjs` fails the build on them. Use
   `makeRng(seed)` from `foundation/rng.js`, and make every animation a pure function of
   the simulated time `t` you are handed.
3. **Never regress a neighbour.** If your slot throws, `world.js` catches it, logs to
   `window.__BLITZ_ERRORS__`, and keeps going — but your capture will be visibly broken.
4. **Fallbacks stay honest.** Do not make your placeholder look finished.

---

## 4. Shared contracts

### 4.1 ctx — handed to every build/update

```js
ctx = { THREE, renderer, scene, camera, rng, texlab, brand, faces,
        quality:'capture'|'live', profile, t, seed, shot, variant, debug,
        W:1920, H:1080, pixelW, pixelH, input }
```

### 4.2 World slot interfaces

```js
stadium : { build(ctx) -> Object3D, update(t, ctx) }
lighting: { build(ctx) -> { group, key:DirectionalLight, env:Texture|null,
                            exposure:number, applyToRenderer(renderer) }, update(t,ctx) }
turf    : { build(ctx) -> Object3D,
            addDivot(x,z,dirX,dirZ,strength), addCleatMark(x,z,rotY,depth),
            addSkid(x0,z0,x1,z1,w), reset(), update(t,ctx) }
anatomy : { build(ctx, {archetype,heightM,massKg,seed}) -> Actor, setMaterials(actor, matSet) }
uniform : { materials(ctx, teamId, variant, {number,name,dirt,wet}) -> matSet, screen: UIScreen }
pose    : { list() -> string[], apply(skeleton, poseId, phase, seed), velocityHint(poseId, phase) }
fx      : { build(ctx) -> Object3D, emitImpact(pos,dir,power,kind),
            ball(ctx) -> {mesh, setFlame(0..1), setSpin(rps)}, update(t,ctx) }

Actor = { root:Object3D, mesh:SkinnedMesh, skeleton:Skeleton,
          sockets:{head,rightHand,leftHand,chest,hips,rightFoot,leftFoot},
          slotOrder:string[] }
```

`matSet` keys, EXACTLY:
`skin, undershirt, jersey, pants, sock, cleat, glove, helmetShell, facemask, visor, pad, towel`

`slotOrder` is the order of `mesh.material[]`; `world.js` fills any missing slot with
plain grey so a partial matSet can never crash a capture.

### 4.3 Field coordinates (everyone shares these)

Origin at midfield. **+X** toward the right sideline, **+Z** toward the near sideline
(the camera side), **+Y** up. 1 unit = 1 metre. Field 91.44 x 48.8; endzones at
`|X| > 45.72`. A 1.88 m actor stands with `hips` at `y = 0.98`. See `FIELD` in
`foundation/contracts.js`.

### 4.4 The rig — `foundation/rig.js`

26 bones, frozen, in this order (index == skinIndex):

```
root, hips, spine01, spine02, chest, neck, head,
clavicle_L/R, upperarm_L/R, forearm_L/R, hand_L/R,
thigh_L/R, shin_L/R, foot_L/R, toe_L/R
```

This file is the seam that lets three agents work without collision:

* **character-anatomy** skins a `SkinnedMesh` to `makeSkeleton()`. Geometry + weights only.
* **uniform-kit** writes materials only.
* **pose-animation** writes `bone.quaternion` / `bone.position` only.

Conventions, deliberately simple: canonical wide A-pose, **every rest quaternion is
identity and every bone's local axes are world-aligned at bind**, so a pose author reasons
in plain world axes with no bone-roll bookkeeping. `REST[name].dir` / `.len` give the
limb direction and length if you want limb space. `PROPORTIONS[archetype]` carries limb
multipliers, shoulder width, neck girth and pad bulk for `qb | skill | lineman | lb`.

### 4.5 ShotSpec — `foundation/contracts.js`

```js
{ id, aspect:1.777,
  camera:{pos:[x,y,z], target:[x,y,z], fov, roll /* degrees */},
  lens:{fStop, focusDist, bokehScale, shutter},
  exposure, tod:'night', weather:{rain, lightning, haze},
  actors:[{team, variant, number, name, archetype, pose, phase, pos, rotY, scale, airborne,
           dirt, wet, role, hero}],
  ball:{pos, rotQ, flame:0..1, visible, spin},
  fx:[{kind:'hit'|'truck'|'catch'|'cleat', pos, dir, power, age}],
  turfDamage:[{type:'divot'|'cleat'|'skid', x, z, rot, strength, x1, z1, w}],
  hud:{visible, clock, quarter, down, dist, yards, teamA, teamB, scoreA, scoreB,
       turbo, momentumA, momentumB},
  callout:{visible, line1, line2, pts, accent:'red'|'gold', age},
  ui:{screen:null|'title'|'teamSelect'|'uniform'|'playcall', state:{}} }
```

`makeShot(partial)` fills every field, so downstream code may assume all of them exist.

### 4.6 World assembly order — `foundation/world.js`

`buildFromShot(shot, ctx)` runs, always, in this order:

```
turf.build -> stadium.build -> lighting.build
  -> per actor { anatomy.build, uniform.materials, anatomy.setMaterials, pose.apply }
  -> fx.build + fx.ball
  -> shot.turfDamage -> turf.addDivot / addCleatMark / addSkid
  -> cinema.applyShot -> cinema.buildPost
```

Every call is wrapped: a throwing slot is logged to `window.__BLITZ_ERRORS__` and the
rest of the frame still renders.

### 4.7 Overlay + UI screens — `foundation/overlay.js`

The overlay context is **always logical 1920x1080** regardless of capture size — the
backing store is `w x h` and the context is pre-scaled — so UI pieces may hard-code
1920x1080 coordinates and get identical layout at any resolution.

Draw order, fixed:

```
REG.ui.hud.draw(c2d, t, shot.hud, ui)
REG.ui.callout.draw(c2d, t, shot.callout, ui)
if (shot.ui.screen) REG.ui[slot].draw(c2d, t, shot.ui.state, ui)
```

```js
UIScreen = { draw(c2d, t, state, ui) }
ui = { W:1920, H:1080, faces, brand, safe:{l:48,t:36,r:48,b:36}, rng, texlab, px(n), ... }
```

### 4.8 Faces — `foundation/typeface.js`

```js
faces.measure(text, faceName, sizePx, opts) -> {w,h,ascent,descent}
faces.path(text, faceName, sizePx, opts)    -> Path2D
faces.draw(c2d, text, x, y, {face,size,align,baseline,tracking,slant,fill,stroke,shadow}) -> {w,h}
```

Face names any consumer may request:
`'blitz-brush'` (hand-lettered bold italic display), `'blitz-block'` (condensed squarish
HUD/label sans), `'blitz-num'` (tall gold numerals), `'blitz-techno'` (TURBO / tech labels).

Frozen glyph-data schema (what `typeface-lettering` must produce):

```json
{ "unitsPerEm": 1000, "ascent": 750, "descent": -250, "defaultSlant": 0.18,
  "glyphs": { "A": { "adv": 620, "cmds": [["M",x,y],["C",x1,y1,x2,y2,x,y],["L",x,y],["Z"]] } },
  "kern": { "AV": -40 } }
```

Y is up in glyph space; the engine flips it. Build a faces object with
`makeFaces(data)` and hand it to `registerFaces`. Any face missing from `data` silently
falls back to system italic 900, so you can ship one face at a time.

### 4.9 Brand

```js
brand = { teams:[Team], byId(id), crest(id, sizePx) -> canvas (cached),
          wordmark(c2d, id, box, opts), skyline(c2d, cityId, box, opts),
          leagueMark(c2d, box), blitzLogo(c2d, box, opts) }
```

Frozen roster ids: `NYC CHI DAL LA SEA MIA BAL PHI`. Cities/names/colours/stats in
`foundation/fallbacks/brand.js` are frozen too — `uniform-kit`, `hud-overlay` and
`menu-team-select` all key off them. A brand piece re-renders every mark but keeps the
identities.

**Fictional league only.** No real NFL shield, no real team marks. `leagueMark` is a
plain chevron badge.

### 4.10 Sim

```js
sim = { create(seed, opts) -> state, step(state, dt), seekTo(state, t),
        snapshot(state) -> {actors:[ShotActor], ball, hud, events:[{kind,pos,power,t}]} }
```

The `live_play` scene calls `seekTo` then `snapshot` and feeds the result straight into
`buildFromShot`. `seekTo` re-simulates from `t=0` in fixed `1/120 s` steps so `?t=2.6` is
byte-reproducible.

### 4.11 texlab

```js
noise2 noise3 fbm2 fbm3 worley2 curl3 ridged2
canvas(w,h) -> {cv,ctx,w,h}
toTexture(cv,{srgb,wrap,aniso,repeat}) heightToNormal(cv,strength)
ramp(stops) -> (t)=>[r,g,b]  (+ .css(t), .gradient(ctx,...))
dataTexture(fn,w,h,{float,nearest,wrap}) blueNoise(size)
decal(target, src, opts) fillPixels(cvo, fn) cached(key, fn)
```

All noise is stateless — it hashes its integer lattice, it does not draw from an RNG
stream. Same inputs, same bytes, forever.

### 4.12 rng

```js
makeRng(seed) -> ()=>[0,1)   (also .int(n) .range(a,b) .sign() .fork(tag))
hash(...ints) hash01(...ints) pick(rng,arr) gauss(rng) seedFromString(s) halton(i,base)
```

---

## 5. URL parameters

```
scene    required, any id from `--list`
seed     default 7
t        simulated seconds, default 0        (animation is a pure function of t)
w / h    default 1920 / 1080
quality  capture | live   (default live; shoot.mjs always sends capture)
accum    accumulation passes, default 32     (forced to 1 in live)
warmup   throwaway frames, default 8
hud      1 | 0   force HUD visibility
ui       1 | 0   force menu-screen visibility
layer    all | gl | overlay                  (overlay-only draws on neutral grey)
variant  free string for a piece's own iso-scene sub-poses
debug    1 draws the safe-area / measure grid
list     1 enumerates scenes without touching WebGL
```

Underlying capture URL (a critic can open this in their own Playwright session):

```
http://127.0.0.1:5178/?scene=<id>&seed=7&t=0&quality=capture&accum=32&warmup=8&w=1920&h=1080
```

Quality modes: `capture` = SSAA 1.5x, 32-frame accumulation, 4096² shadows, full post,
64k particle budget. `live` = 1x, no accumulation, 2048² shadows, reduced post — so the
game stays interactive while stills stay maximal.

---

## 6. Capture protocol

ONE command produces a PNG. It self-heals: `npm ci` if `node_modules/` is missing,
`vite build` if `dist/` is stale, static server on `127.0.0.1:5178`, Playwright, teardown.

```bash
node scripts/shoot.mjs --scene=<sceneId> --out=shots/<piece-id>/<name>.png
```

| flag | meaning |
|---|---|
| `--scene=<id>` | any id in `REG.isoShots` or `cinema.shots` |
| `--seed=7` | RNG seed |
| `--t=0` | simulated seconds |
| `--variant=<str>` | piece-defined sub-pose inside its own iso scene |
| `--w= --h=` | capture size, default 1920x1080 |
| `--layer=all\|gl\|overlay` | both layers / 3D only / Canvas2D only |
| `--hud=0\|1 --ui=0\|1` | force HUD / menu visibility |
| `--out=<path>` | output PNG |
| `--all` | every registered scene -> `shots/all/<sceneId>.png` |
| `--piece=<id>` | every scene that piece declares -> `shots/<id>/` |
| `--list` | print scene ids, per-piece scene sets and slot provenance |
| `--progress-snapshot` | rebuild `progress/index.built.html` fully inlined |

### Readiness — never sleep, always wait on this

```js
await page.waitForFunction('window.__BLITZ_READY__===true', { timeout: 240000 });
```

The engine raises it only after warmup frames, all `accum` jittered accumulation passes,
the post resolve, **and** the Canvas2D overlay draw have completed.
`window.__BLITZ_STATS__` then holds
`{ms, frames, drawCalls, tris, sceneId, seed, t, quality, ssaa, accum, accumType, provenance, errors}`.

Chromium is launched with
`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --no-sandbox
--force-device-scale-factor=1` and `deviceScaleFactor: 1`.
Browsers live at `/opt/pw-browsers` (`PLAYWRIGHT_BROWSERS_PATH` is set) — **never run
`playwright install`**.

Typical capture cost on this box: ~20 s per 1920x1080 frame at `accum=32, ssaa=1.5`.

---

## 7. Side by side against the bar

No ImageMagick and no PIL on this box, so compositing is done by Chromium.

```bash
node scripts/compare.mjs --panel=truck --shot=shots/pose-animation/truck.png \
                         --out=shots/pose-animation/cmp-truck.png
```

Both images are scaled to an **identical 720 px height** — the bar panels are only
310–376 px tall, and unmatched scaling would confound the judgement — labelled BAR / OURS
and butted together with a 16 px gutter.

```
--wipe=0.5     single split composite with a seam instead of side by side
--crop=hud|callout|turbo|face|left|right     compare a named region
--h=720        matched height
--label=OURS   right-hand label
```

Panel names (the `bar/panel-<name>.png` suffixes):
`title qb_dropback midair_hit team_select truck defense_playcall leveler touchdown
uniform catch`

---

## 8. The critic loop

```bash
node scripts/shoot.mjs --piece=<piece-id>
node scripts/compare.mjs --panel=<barPanel> --shot=shots/<piece-id>/<scene>.png \
                         --out=shots/<piece-id>/cmp.png
# read shots/<piece-id>/cmp.png, score it, name ONE gap
node scripts/log-event.mjs --piece=<id> --round=<n> --agent=critic --event=verdict \
     --score=<0-100> --gap="..." --shot=<path> --cmp=<path>
```

**Sanity gate before any verdict:**

```bash
node scripts/lint-determinism.mjs                       # must pass
node scripts/shoot.mjs --scene=<id> --out=/tmp/a.png
node scripts/shoot.mjs --scene=<id> --out=/tmp/b.png
md5sum /tmp/a.png /tmp/b.png                            # must match
```

If the two PNGs differ, **that non-determinism IS the finding**.

---

## 9. Progress page

```bash
node tools/progress.mjs                 # -> progress/index.html (self-contained)
node scripts/serve.mjs --progress       # -> http://127.0.0.1:5179/progress/
node scripts/shoot.mjs --progress-snapshot   # -> progress/index.built.html, fully inlined
```

Data source is `progress/events.jsonl`, append-only, one JSON object per line, written
only via `scripts/log-event.mjs` (a single `O_APPEND` write, so 16 concurrent agents
cannot corrupt it).

```
{ts, round, piece, agent, event, shot?, cmp?, score?, gap?, text?, ms?}
event ∈ start | build_done | shot | verdict | gap | fixed | note | round_open | round_close
```

The page shows, top to bottom: a header band with the current round / elapsed / three
live counters; a convergence chart (one line per piece, score on Y, round on X, dashed
"bar reached" line at 90); the 16-piece board **ordered worst-score-first**, each card
carrying a BAR|OURS pair at matched height, a score ring, the latest named gap verbatim,
and a round filmstrip badged with score deltas; a click-through detail view with a
draggable wipe plus difference and onion-skin toggles and the piece's full event
timeline; and a live feed. Served over http it tails `events.jsonl` with byte-Range
requests every 3 s and re-renders only what changed.

---

## 10. What foundation changed from the original spec, and why

1. **`--deterministic-mode` and `--js-flags=--random-seed=7` are NOT passed to Chromium.**
   With them, `page.screenshot()` hung for minutes under SwiftShader. Determinism comes
   from the engine — seeded RNG plus animation as a pure function of `t` — not from the
   browser. Verified: the same URL shot twice is byte-identical (`md5` match).
2. **Tone mapping happens in foundation's resolve pass, not in three's material chain.**
   Accumulation must happen in linear HDR, and three disables tone mapping when rendering
   to a render target. The resolve shader applies `renderer.toneMappingExposure` and the
   curve selected by `renderer.toneMapping` (ACES / Reinhard / none), then encodes sRGB.
   Consequence for pieces: `material.toneMapped = false` is **not** honoured — everything
   goes through the same curve. Use emissive intensity instead.
3. **`cinema.buildPost` returns a `Post` object, not an `EffectComposer`.**
   `Post = { render(scene, camera, target, t, dt, ctx), setSize(w,h), dispose() }`.
   The engine hands it the accumulation target to write into. An `EffectComposer` wrapped
   in that shape works fine; the indirection is what lets accumulation own the sequencing.
   The fallback returns `null` = "render straight to the target".
4. **Added `cinema.apertureOffset(i, n, shot, camera, ctx) -> [dx,dy] | null`.**
   This is the accumulation-buffer DOF hook. The engine translates the camera across the
   aperture disc and applies a compensating projection shear so the focus plane stays put.
   Without it there is no way for a cinema piece to get real bokeh out of the accumulation
   path. The fallback returns `null`.
5. **`turf.addCleatMark(x, z, rotY, depth)`** is called by `world.js` as
   `(d.x, d.z, d.rot, d.strength)` — `strength` maps to `depth`.
6. **Piece placeholders export `export const PIECE = '<id>'`** rather than exporting
   nothing. It is used for slot provenance in `--list` and costs nothing.
7. **`registerCinema` merges `shots` per key** rather than replacing the map, so a
   cinematography piece can override one panel's staging without deleting the other nine.
8. **`--piece=<id>` resolves to `PIECE_HEROES[id]` plus every `isoShot` whose
   `spec.piece === id`.** `PIECE_HEROES` is a frozen foundation-owned map, so a piece
   never has to edit a shared file just to get a capture set.
9. **`progress/index.html` is generated by `tools/progress.mjs`**, not hand-maintained.
   It is a single self-contained file that inlines a bootstrap snapshot (so `file://`
   works) *and* polls `events.jsonl` with Range requests when served over http. Thumbnail
   inlining is budgeted (default 44 MB, `--inline` raises it); anything past the budget
   falls back to a relative URL, which still resolves when the page is served.
10. **`shadowMap.type = PCFShadowMap`** — `PCFSoftShadowMap` is deprecated in r0.185 and
    silently downgrades anyway.
