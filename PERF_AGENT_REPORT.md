# PERF_AGENT_REPORT — agent 01 — giRays (screen-space GI ray march)

## What I changed

The GI march integrated a leaf crown's optical depth **twice per crown hit** (once inside `hitRadiance`
for the radiance blend, once inside `hitSolidity` for the contact-visibility term) and integrated it
**at all for every hit past `CONTACT_RANGE`**, where its weight in the visibility term is exactly
zero. I now integrate the chord once per ray and only when a term actually consumes it, and I pack
the nearest-hit BVH stack's node index and its entry distance into one 8-byte local slot.

Commits on `perf/agent-01`:

- `33c9173` perf(rt): integrate a crown's leaf chord once per GI ray and pack the BVH stack
- `d37bffd` test(rt): pin the exactness of the shared-chord contact-visibility term

## Files and lines

- `src/render/shaders/rt/gi.wgsl:38-47` — the per-ray hit branch. The chord is computed once, and the
  visibility term is taken only inside `if (h.t < CONTACT_RANGE)`, with the unconditional `vis += 1.0`
  on the other side.
- `src/render/shaders/rt/rt_scene.wgsl:181-186` — new `hitChordT`, the single integrator of
  `exp(-CANOPY_DIFFUSE_TAU_SCALE * canopyOpticalDepth(...))`.
- `src/render/shaders/rt/rt_scene.wgsl:189-196` — `hitRadianceChord`, the former `hitRadiance` body
  taking the chord as a parameter.
- `src/render/shaders/rt/rt_scene.wgsl:198-200` — `hitRadiance` is now a one-line wrapper that supplies
  `hitChordT`, so `spec.wgsl:32` and `probe_update.wgsl:82` are untouched in behaviour and cost.
- `src/render/shaders/rt/rt_scene.wgsl:204-207` — `hitSolidity` now takes the already-integrated chord
  instead of re-deriving it.
- `src/render/shaders/rt/rt_bvh.wgsl:24` — `struct BvhStackEntry { node : u32, entry : f32 }`.
- `src/render/shaders/rt/rt_bvh.wgsl:30-63` — `traceBvh` uses one `array<BvhStackEntry, 32>` instead of
  the parallel `array<u32, 32>` + `array<f32, 32>`.
- `src/render/rt/canopyScatter.test.ts:42-50` — source guard updated to the new structure.
- `src/render/rt/canopyScatter.test.ts:51-64` — new exactness test for the visibility algebra.

## Why the output stays identical — the actual argument

**Change 1 (shared chord, skipped past CONTACT_RANGE).** Three separate claims:

1. *Same arithmetic for the radiance.* `hitRadianceChord` is the byte-for-byte same expression list as
   the old `hitRadiance`, with `exp(-CANOPY_DIFFUSE_TAU_SCALE * canopyOpticalDepth(h.prim, o, d, rp.f.w))`
   replaced by the `chord` argument, which `hitChordT` computes with exactly that expression from the
   same arguments. One `exp` of one `canopyOpticalDepth` value either way — the substitution removes a
   *redundant evaluation*, it does not reassociate or re-round anything.

2. *Same arithmetic for the solidity.* The old `hitSolidity` returned `1.0 - exp(-K * tau)`; the new one
   returns `1.0 - chord` where `chord` is that same `exp(-K * tau)`. Subtracting the identical float
   from `1.0` gives the identical float.

3. *The `h.t < CONTACT_RANGE` branch is exact, not approximate.* The old expression was
   `1.0 - solidity * (1.0 - saturate1(h.t / 2.0))`. When `h.t >= 2.0`, `h.t / CONTACT_RANGE >= 1.0`,
   so `saturate1` returns exactly `1.0` and the weight `1.0 - 1.0` is exactly `0.0`. The product is then
   `solidity * 0.0`, which is exactly `+0.0` for every finite `solidity` in `[0, 1]` (which it always
   is: `1.0 - chord` with `chord = exp(...) ∈ (0, 1]`, or the literal `1.0` for a non-canopy hit). So the
   old value was exactly `1.0 - 0.0 = 1.0`, which is precisely what the new branch adds. There is no
   rounding window, no tolerance argument, and no case where the two differ. `h.t` is a finite
   `tMax`-bounded distance or the hit is `KIND_MISS` (which takes the other branch), so the comparison
   is never against a NaN.

The new `canopyScatter.test.ts` case asserts claim 3 directly by evaluating both forms over
`t ∈ {0, 0.25, 0.999, 1.5, 1.9999, 2, 2.0001, 3, 17.5, 1e4}` × `solidity ∈ {0, 0.25, 0.5, 0.999, 1}`
with `toBe` (exact `Object.is`, not `toBeCloseTo`).

**Change 2 (packed BVH stack).** This is a pure data-layout change. The node index and the entry
distance keep their exact `u32`/`f32` values and their exact comparison uses are untouched
(`top.entry > best.t`, the far-first / near-first `select` pair, and `sp + 2u > STACK_SIZE` are all
unchanged); only their storage is interleaved into one 8-byte struct so a pop reads both with a single
8-byte local access and a push writes both with a single store. No float operation is added, removed or
reordered anywhere in `traceBvh`.

`traceBvhTransmit` was deliberately left alone: its stack holds only a node index (no entry distance),
so there is nothing to pack.

## Why it should be faster — mechanism, against the profile

The stage is 59.36 ms / 50.8% of the frame, and the profile note that its cost swings 3.5x with
viewpoint points at BVH walk length and divergence rather than raw per-pixel ALU. Both changes attack
exactly the two costs that scale with walk length:

**The duplicate/dead chord integration.** `canopyOpticalDepth` is not a cheap function: it is a
4-sample march (`CANOPY_SAMPLES = 4`) and each sample evaluates `valueNoise3`, which is 8 `hash31`
calls plus 7 `mix`es, plus a `canopyLobe` (`sin`, `sin`) and a `length`. That is roughly 150-200 ALU
ops with several transcendentals per call. The old march did this **twice per crown hit** and
**once for every hit beyond 2 m regardless**. Because the scene's canopy proxies are the most common
non-terrain GI hit in a vegetated FPV view, and because the GI ray budget is per-texel over the whole
RT grid, this was a real per-hit cost paid on the critical path of the hit branch — the same branch
that already contains a second BVH walk (the near-hit shadow ray in `shadeSurface`). It is now paid at
most once per ray, and not at all when only the far term wants it.

**The stack packing.** A variable index into a function-scope array forces the stack into per-thread
local memory on NVIDIA, and inside a divergent BVH walk each lane's `sp` differs, so `stack[sp]` and
`stackT[sp]` were two separate scattered local accesses per pop and two per push. Interleaving them
into one 8-byte slot halves the number of local-memory instructions and address computations in the
hottest loop of the stage. The size is unchanged (32 × 8 B), so the local-memory footprint, the
occupancy-relevant register pressure and the stack depth semantics are all unchanged — this is a
traffic-density change, not a capacity change.

I did **not** touch ray counts, `rtMaxSteps`, `rtDivisor`, resolution, step caps, shading maths,
sampling or any quality preset. The visit caps (`bvhCap`, `max(16u, steps / 3u)`), the
`CANOPY_OPAQUE_TAU` early-out and the `traceBvhTransmit` traversal are all exactly as they were.

## Verification output actually observed

```
$ npx tsc --noEmit
TSC_EXIT=0

$ npx vitest run src/render/rt/canopyScatter.test.ts src/render/rt/rtShaders.test.ts \
      src/render/rt/dispatch.test.ts src/render/rt/canopy.test.ts
 Test Files  4 passed (4)
      Tests  39 passed (39)

$ /home/ubuntu/gpu-runtime/wt-setup.sh /home/ubuntu/fpv-opt/01 01
built /home/ubuntu/gpu-runtime/wt/01/bundle/renderer-harness.mjs

# oracle, run on the final committed tree
PASS {"tag":"baseline","operations":5}
PASS {"tag":"normal","operations":5}
PASS {"tag":"profile","operations":5}

$ node /home/ubuntu/gpu-runtime/check-pixels.mjs .../oracle2/baseline-result.json
  fresh      image same | probe atlas same | rt stats same | frameIndex same
  steady     image same | probe atlas same | rt stats same | frameIndex same
  capture-a  image same | probe atlas same | rt stats same | frameIndex same
  capture-b  image same | probe atlas same | rt stats same | frameIndex same
  moved      image same | probe atlas same | rt stats same | frameIndex same
PIXEL-IDENTICAL: YES
EXIT=0
```

The oracle scene is the same one the tool always uses (600 static prims, 771 BVH nodes, 16,384 probes,
`giRays: 2`, `rayRange: 300`), and the five operations include a fresh frame, a steady frame, two
capture re-encodes and a moved camera. Note the oracle runs at 32×32 RT with divisor 2, so it is a
correctness gate, not a performance measurement — and per the mission rules I ran no timing or
benchmark of any kind.

## Risks, what could regress, what I deliberately did not do

**Regression risk is low but the win is small.** Both changes remove work; neither adds a branch that
did not already exist in a meaningful sense, and the packed stack adds no capacity. The one thing I
cannot rule out without measuring is that the compiler's own scheduling of the old parallel arrays was
already optimal on this driver — in which case change 2 is neutral rather than positive.

**Change 2 is the one I would defend least strongly.** It is provably identical and the mechanism is
sound (one 8-byte local access instead of two 4-byte ones per pop/push in a divergent loop), but the
magnitude depends on how Tint/Naga lowers the struct into local memory. If the struct lowers to two
separate 4-byte stores anyway, this is a no-op; it cannot be a regression, but it also may not be a
win. Change 1 is the change I actually expect to pay.

**Interaction with the nine other agents:** my diff is confined to three RT shader files and one test
file. `hitRadiance`'s signature is unchanged, so anything else calling it (specular, probes) is
unaffected.

**What I deliberately did not do, and why:**

- I did not change the traversal *order* in `traceBvhTransmit` or `traceBvh`. Near-first ordering with
  `stackT` pruning is the classic big win for a divergent BVH, but it changes which node is tested
  first, and therefore which hit `t < best.t` accepts and what the `cap` truncation returns. That is a
  different image, not a faster one. Ruled out on correctness grounds, not effort.
- I did not touch the `traceTerrain` max-mip DDA or its 4-texel `nodeMax` gather. The gather is
  genuinely expensive (4 `textureLoad`s per DDA step, up to `steps` steps) but any restructuring that
  reduces it — different pyramid level, caching across steps — changes the cell a ray reports as hit.
- I did not try to pack the three `probeR/G/B` 3D probe lookups in `probeIrradiance` into fewer
  fetches, even though 3 trilinear 3D fetches per hit looks expensive. The three textures are separate
  bindings and merging them is a layout change in `textures.ts`/`probe_update.wgsl` that risks
  changing filtered values, and it is a much larger blast radius than this area warrants.
- I did not reduce ray budgets, step caps, the canopy sample count, the probe grid, or any denoiser.

## Honest confidence and best estimate of the gain

**Confidence in byte-identity: high.** The argument is algebraic rather than empirical — the removed
computation is either recomputed identically or provably multiplied by exactly `0.0` — and it is
backed by `PIXEL-IDENTICAL: YES` across all three tags and all five operations. The one soft spot is
coverage: the oracle scene's RT grid is 32×32, so it exercises the changed code paths but is a weak
sampler of view-dependent canopy geometry. I consider that acceptable here precisely because the
correctness argument does not depend on the sampling.

**Confidence in the gain: modest.** I want to be straight about the ceiling: I did the accounting on
where the stage's time goes (roughly: two BVH walks per hit — the primary `traceBvh` and the near-hit
`keyVisibility` walk in `shadeSurface` — plus the terrain DDA, plus the probe fetches), and the chord
integration is a real but *minority* slice of a hit's cost. My honest estimate is **~1-3% of the
giRays stage, i.e. ~0.5-1.5% of the frame** — and that estimate leans on change 1 alone; I would
treat change 2 as possibly neutral. The profile's 3.5x viewpoint swing is a symptom of walk length and
divergence, and neither of these changes shortens a walk; they make each visited node and each hit
marginally cheaper. If a large win exists in this stage it is in traversal order or in the terrain
DDA's `nodeMax` gather, and I ruled both out above for correctness reasons rather than because they
were hard.

If the orchestrator's measurement shows this at the noise floor, that is a legitimate outcome and the
result stands as "no large byte-identical win was available in the GI march's control flow". I did not
find something clearly bigger elsewhere, and I would flag the BVH walk order and the `nodeMax` gather
as the two places a later agent with more time should look first.
