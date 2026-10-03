# PERF_AGENT_REPORT — agent 06, gbuffer

Commit: `74bda49` on `perf/agent-06`.

## What I changed

The ground "dryness" field `glDryness` — two 3-octave gradient-noise FBMs, the single most
expensive helper in the terrain material — was being recomputed with *identical arguments* at
every point that needed it: **twice** per pixel in the G-buffer terrain fragment shader and
**three times** per thread in the grass blade-culling compute shader. I hoisted it to one
evaluation per point and threaded the value through.

Reductions per point: **1 of 2** in the G-buffer fragment shader (8.29 M pixels/frame at
3840x2160), **2 of 3** in grass culling, **1 of 2** in `groundBaseColorAt` (the far-canopy
G-buffer draw). Each removed call is 6 `tnGradient` evaluations = 24 `pcg3` hashes and 24
`cos`/`sin` pairs.

I stayed inside my assigned area but the change necessarily spans two stages: the G-buffer
fragment shader (11.5 % of the frame) and the grass cull that feeds it, which is counted
under `pre` (3.7 %). **I did not abandon the gbuffer for something bigger** — I looked and
this was the largest exact duplication I could find there (see "ruled out" below).

## Files

- `src/render/shaders/terrain/ground_color.wgsl` — added `grassTintFromMapsDry` (`:29`),
  `terrainLayerWeightsDry` (`:47`), `layerMacroColorDry` (`:110`); kept `grassTintFromMaps`
  (`:38`), `terrainLayerWeights` (`:105`), `layerMacroColor` (`:138`) as wrappers that
  evaluate `glDryness` themselves; `groundBaseColorAt` (`:144`) now takes the value once.
- `src/render/shaders/terrain/terrain.wgsl:69` — `let dryField = glDryness(w.xz, maps.w);`
  feeds `:70` (`terrainLayerWeightsDry`) and `:124` (`layerMacroColorDry`).
- `src/render/shaders/vegetation/grass_cull.wgsl:124` — `let dryField = glDryness(xz, maps.w);`
  feeds `:125` (`terrainLayerWeightsDry`), `:163` (`max(dryField, …)`) and `:172`
  (`grassTintFromMapsDry`).
- `src/render/terrain/groundShaders.test.ts` — focused regression test (below).

## Why the output stays byte-identical

This is a pure common-subexpression elimination, and the argument is structural rather than
empirical:

1. **`glDryness` is a pure function of its two arguments.** `ground_color.wgsl:21-25` is
   `tnFbm(xz*0.012 + …, 3)`, `tnFbm(xz*0.17 + …, 3)`, a `smoothstep` chain and `saturate1`.
   Those reach `tnFbm → tnGradient → tnQuintic / tnLatticeHash / tnLatticeGradient → pcg3,
   cos, sin` — integer hashes and `sin`/`cos` of a hashed angle. **No texture reads, no
   `dpdx`/`dpdy`, no atomics, no control flow that depends on anything but the arguments.**
   There is no image, no resource and no per-lane state it could differ on, so two calls with
   the same inputs return the same `f32`, bit for bit.

2. **The arguments really are the same at each hoisted site.**
   - In `terrain.wgsl`, `terrainLayerWeights(w.xz, …, maps, …)` reached `glDryness(xz, maps.w)`
     with `xz = w.xz`; `layerMacroColor(lid[k], w.xz, w.y, maps)` reached
     `grassTintFromMaps(w.xz, maps) → glDryness(w.xz, maps.w)`. Same `w.xz`, same `maps`.
   - In `grass_cull.wgsl`, all three sites used the same local `xz` and `maps`.
   `maps` is `ts.maps` in the fragment shader and `terrainMapsAt(xz)` in the cull; neither is
   reassigned between the hoisted call and the uses that replaced it.

3. **The hoisted call is placed where the first call already was**, so no work moved into a
   region that previously had none. In `grass_cull.wgsl` the hoist sits immediately above
   `terrainLayerWeightsDry` (`:124`), the same position as the `glDryness` that
   `terrainLayerWeights` used to call internally — the four early `return`s above it
   (out-of-bounds, distance, frustum, cover) still skip everything, and the later
   `return` at the density test is unaffected. In `terrain.wgsl` the hoist is where
   `terrainLayerWeights`'s internal call was, so the debug-mode path (`:159`) pays exactly
   what it paid before.

4. **No downstream expression was touched.** The `dry`/`dryField` value is a parameter now,
   not a recomputed local, and every use site keeps the same operator order: `sparse` at
   `ground_color.wgsl:83`, `grass`/`hay` at `:86-87`, `mix(c, GL_GRASS_DRY, dry)` at `:35`,
   and the blade-side `max`/`pack4x8unorm` in `grass_cull.wgsl`. Floating-point addition is
   not associative, so this matters — but nothing was re-associated; a value that was already
   in a register is now passed in.

5. **The wrappers preserve every other call site's behaviour exactly.** `layerMacroColor` is
   the subtle one: it dispatches on `layer`, and only `case 0` (grass) ever read
   `glDryness`. Eagerly computing `dry` for all eight layers would have been a *regression*
   for `groundBaseColorAt`, which loops over up to eight. So the wrapper short-circuits:
   `if (layer == 0) { return grassTintFromMaps(xz, maps); }` then
   `return layerMacroColorDry(layer, xz, y, maps, 0.0);`. The `0.0` is never read by
   cases 1-6 and `default`, and case 0 never sees it.

6. **A WGSL ordering constraint was checked, not assumed.** WGSL requires declaration before
   use, so `terrainLayerWeights` had to move *after* `terrainLayerWeightsDry`; I reordered it
   and the shaders compile and run (all three oracle tags PASS, which compiles every WGSL
   module through `compileShader`).

So the only thing that changed is *how many times a deterministic function is evaluated*.

## Why it should be faster

The G-buffer is 13.38 ms of a 116.86 ms frame (11.5 %). The terrain clipmap is the one draw in
that pass that covers most of the screen, and its fragment shader is ALU-bound on procedural
noise: `terrainLayerWeights` alone runs `tnWarp2` (4 octaves) plus six more `tnFbm` calls, and
the grass macro colour adds three more — roughly 36 `tnGradient` per grass pixel, each with
four `pcg3` hashes and a `cos`/`sin` pair. `glDryness` is 6 of those, and it was being paid
**twice**. The win therefore comes off the terrain fragment shader, which is the largest
fragment workload in the gbuffer, and it scales with how much of the screen is grass-covered
ground — it helps the *cheap* end of the 2.8-3.7x viewpoint distribution at least as much as
the expensive end, because it is per-covered-pixel rather than per-visible-object.

The grass-cull half lands in `pre` (4.28 ms, 3.7 %), where 900 blades/m² over a 120 m radius
means the cull runs for a very large number of threads, and there the saving is the larger
one: **two** of three `glDryness` evaluations removed per surviving thread, 48 `pcg3` +
48 `cos`/`sin` pairs.

No memory traffic, attachment count, format, resolution, budget or pass structure changes —
this is pure instruction-count reduction inside existing shaders.

## Verification output actually observed

```
$ npx tsc --noEmit
TYPECHECK: OK

$ /home/ubuntu/gpu-runtime/wt-setup.sh /home/ubuntu/fpv-opt/06 06
built /home/ubuntu/gpu-runtime/wt/06/bundle/renderer-harness.mjs
```

Oracle, all three tags, one shared output dir:

```
===== TAG: baseline =====
FRAME {"name":"steady","image":"8248418c6d34370e59b228f156323a8dea1ace4cb30f5f2758e8aabba8470067", ...}
FRAME {"name":"capture-a","image":"e950e1a3a518f173909c1ebf59de8607ff72bf80511d564a7c2e8a51922a49ad", ...}
FRAME {"name":"capture-b","image":"7aefa2d5d69bd43d5e19f632ba3424bd11409740ce86614820f4412836d0d237", ...}
FRAME {"name":"moved","image":"8d8ae10f64396a16c3c0bbc6f28da93823c85cf0b140915c806d9bf23fb6da19", ...}
PASS {"tag":"baseline","operations":5}
===== TAG: normal =====
... (same four image/atlas hashes) ...
PASS {"tag":"normal","operations":5}
===== TAG: profile =====
... (same four image/atlas hashes) ...
PASS {"tag":"profile","operations":5}
```

Quality gate:

```
$ node /home/ubuntu/gpu-runtime/check-pixels.mjs /home/ubuntu/gpu-runtime/wt/06/oracle/baseline-result.json
  fresh      image same | probe atlas same | rt stats same | frameIndex same
  steady     image same | probe atlas same | rt stats same | frameIndex same
  capture-a  image same | probe atlas same | rt stats same | frameIndex same
  capture-b  image same | probe atlas same | rt stats same | frameIndex same
  moved      image same | probe atlas same | rt stats same | frameIndex same
PIXEL-IDENTICAL: YES
EXIT: 0
```

Focused tests (not the full suite, per instructions):

```
$ npx vitest run src/render/terrain/ src/render/vegetation/ src/render/shaderLib.test.ts
 Test Files  28 passed (28)
      Tests  258 passed (258)
```

I added four focused tests in `src/render/terrain/groundShaders.test.ts` that count `glDryness(`
call sites inside the resolved `terrain.wgsl` `fs` body and the `grass_cull.wgsl`
`blades_main` body (one each) and assert the wrappers still delegate — so re-introducing the
duplicate call fails a cheap test rather than silently costing frames. Worth noting: the test
caught a false positive from its own first draft counting the word `glDryness(` inside a code
*comment*; the helper now strips `//` lines before counting, so a comment can no longer
satisfy a call-count assertion.

## Risks / what could regress

- **Low, and the failure mode is loud.** The pixel oracle is bit-exact and the change is a
  pure-function dedup, so a mistake would show up as `PIXEL-IDENTICAL: NO` rather than as a
  subtle visual drift. I saw no intermediate state that was not either exactly-equal or
  compile-broken.
- **The oracle scene is not the ultra target.** It runs at 64x64 with divisor 2, 600
  primitives, no water surface necessarily in frame, and a limited number of visible blades.
  It confirms exactness, not coverage. In particular the *sizes* of the saving at
  3840x2160 ultra are extrapolated from code, not measured.
- **A slow path that I made marginally worse:** `layerMacroColor` for layers 1-7 now goes
  through an extra `if` and a call with a dead `0.0` argument. It is dead-stripped or inlined
  away; I judged it not worth a second `switch` to avoid.
- **Dead code:** `terrainLayerWeights` and `layerMacroColor` now have no callers in the tree.
  I kept them deliberately — they are the file's documented public entry points (header
  contract, lines 3-7), they cost nothing after dead-stripping, and removing them would have
  widened the diff and the risk for no gain. A reviewer may reasonably prefer them gone.
- **Compilers may already have been CSE-ing part of this.** If Tint/SPIR-V common-subexpression
  elimination had collapsed some of these, the real-world gain is smaller than the static call
  count suggests. The `layerMacroColor` call sits inside a `switch` on a loop-carried dynamic
  index, which is exactly the case a value-numbering pass cannot fold, so I expect the G-buffer
  half was genuinely duplicated; the grass-cull half is three straight-line calls in one body
  and is the case most likely to have been folded already.

## What I deliberately did not do

- **No format/attachment change.** The gbuffer pass writes `rgba8unorm` + `rgba16float` +
  `rgba8unorm` + `rg16float` + `depth32float` (`frameGraph.ts:32`). All five are read
  downstream (`gMotion` by TAA/motion blur, `gNormal`/`gAlbedo`/`gMisc` by deferred lighting
  and the RT passes). Narrowing any of them would change the RT and lighting arithmetic, so
  it is not byte-identical.
- **No reduction of the 199 MB/frame of gbuffer clear traffic** (8.29 M px x 24 B). The clear
  values are load-bearing (uncovered pixels shade as rough dielectric, `frameGraph.ts:9`), so
  there is no byte-identical way to skip them.
- **No `detail_sample.wgsl` biplanar dedup.** `dsHex` does two `textureSampleLevel` mean
  lookups at a *fixed* coordinate and mip 9 (`detail_sample.wgsl:106-107`), keyed only on
  `layer`. `dsLayerDetail` calls `dsPlane` up to three times for the same layer on steep
  pixels, so those are redundant there — up to 4 of 6 fetches. I scoped it out: it only
  applies when `tp.flags & 1` and `ts.normal.y < 0.85` (slope > ~32 deg), so the win is
  confined to a minority of pixels, it would change function signatures in the most
  texture-fetch-dense code in the renderer, and I could not measure it. **This is the most
  promising thing I found and did not ship** — worth a follow-up with a profiler.
- **Did not touch grass vertex processing.** At 900 blades/m² over 120 m, the grass draw is
  plausibly the single largest gbuffer cost, and I suspect it is vertex/draw-bound rather than
  fragment-bound. That is a much bigger lever than anything in the fragment shaders, but
  reducing blades, distances or LOD budgets is explicitly forbidden and I found no
  byte-identical restructuring of it.
- **Did not run any timing benchmark** and did not run the full `npx vitest run` suite.

## Confidence and estimated gain

- **Byte-identical: very high confidence.** The argument is structural (pure function, proven
  equal arguments, expression order untouched) *and* independently machine-verified across
  three renderer modes, five operations, image + probe atlas + RT stats + frame index.
- **Directionally correct: high confidence.** Fewer instructions in a hot shader cannot make
  it slower; the only way to lose is if the compiler had already folded the duplicates.
- **Magnitude: honest estimate, low single-digit at best.** I did not measure. Static
  accounting: the gbuffer fragment win is 6 of ~36 `tnGradient` on grass pixels (~17 % of that
  noise block) over the terrain portion of a 11.5 %-of-frame stage; the grass-cull win is 12 of
  its per-thread noise. If terrain fragments are ~40 % of gbuffer time, that is roughly
  **0.2-0.4 % of the frame** — order half a millisecond of 116.86 ms. I would not defend a
  larger number. The honest headline is that this is a real, provably free removal of duplicated
  work, not a large win, and the gbuffer's remaining cost is dominated by grass geometry and
  detail-texture fetch throughput rather than by this kind of noise duplication.
