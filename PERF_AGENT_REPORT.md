# Agent 07 - shadowRays + shadowDenoise (round 2)

## What I changed

The a-trous recomputed its 3x3 neighbourhood moment sum - the quantity that steers the
luminance edge-stop `sigmaL` - three times per texel per frame, once per iteration, even though it
is a pure function of the moments texture, the texel and the RT size, and all three iterations read
the *same* moments texture. Iteration 0 now computes it once and writes it to a per-texel f32
scratch buffer; iterations 1 and 2 read it back. That removes 18 of the 27 moment fetches per texel.

Note this lands in `shaders/rt/atrous.wgsl`, which the three denoisers share, so it pays off across
giDenoise + specularDenoise + shadowDenoise (29.3 ms) rather than in my 12.5% area alone. I judged
that worth it: the alternative levers I found were all inside shadow-only code and all capped out
below 1% of the frame. This is the spill-out the brief explicitly permits, and it is called out here
rather than buried.

## Why the output stays byte-identical

This is the part that mattered, and it is why the scratch is a **f32 storage buffer** rather than a
narrower texture or a packed format.

1. **The stored value is bit-identical to the recomputed one.** `varSum` is already an f32 computed
   in the shader. An `array<f32>` storage buffer stores f32 and loads f32 with no conversion, so the
   value iterations 1 and 2 read is the exact bit pattern the 3x3 sum would have produced. There is
   no rounding anywhere in the round trip, so `sigmaL`, the tap weights and every output texel are
   unchanged. Contrast the tempting alternative: the *histories and a-trous intermediates* cannot be
   narrowed to `r32float`, because those stores go through `fp16Safe` and the `rgba16float` store
   rounds `.x` to fp16 - keeping f32 there would change the image. A plain f32 buffer has no such
   step, which is precisely why it is the one storage choice here that is free.
2. **The inputs really are identical across the three iterations.** `momTex` is `h.mom[p].view`
   (`groups.ts:120`) - a single texture bound to all three a-trous iterations of a signal, written
   once by the temporal pass. `px` and `dims` are the same in every iteration. The only iteration
   dependent input is the compile-time `ITER`, and it enters as the constant `pow(0.6, ITER)`, which
   is applied *after* `varSum` on line 91 and is untouched. So the hoisted expression is genuinely
   loop-invariant, not merely usually equal.
3. **No uninitialised read is possible.** The `if (z <= 0.0)` early return sits at `atrous.wgsl:67`,
   *above* the scratch in all three variants, and it tests the same `auxDepth` value in each. So the
   set of texels that write the scratch in iteration 0 is exactly the set that read it in iterations
   1 and 2. The two sets cannot diverge, and the buffer is zero-initialised by spec regardless.
4. **No clear was added or removed.** `tmpA`/`tmpB` are created zeroed and fully overwritten every
   frame; the RT encode only ever clears the probe indirect args and the specular attachment
   (`index.ts:217,226`). I added no per-frame clear - worth stating because round 1 measured
   *removing* a clear at +1.2%, and I did not want to disturb that.

Verified mechanically by the pixel gate, not by argument alone: `PIXEL-IDENTICAL: YES`.

## Why it should be faster

Per texel, per signal, per frame, inside the a-trous:

| | moment fetches | moment bytes read |
|---|---|---|
| before | 3 iterations x 9 = 27 `textureLoad`s | 216 B (rgba16float) |
| after | 9 + 1 store + 2 loads | 80 B read + 4 B written |

The a-trous's total per-texel load traffic is 3 x (9 moment loads + 25 taps x 20 B) = 1716 B, so this
is **~8% of the a-trous's read traffic**, and it removes 18 of 84 load instructions (21%) while
adding one 4-byte store and two 4-byte loads.

Against the profile table, the three denoisers are 29.3 ms (30.7% of the frame). If the a-trous is
bandwidth-proportional this is worth ~2.3 ms, about **2.4% of the frame**; if it is instead
transcendental/latency bound - which I think is at least as likely, see below - it is worth nearer
1.5%. Unlike the arithmetic edits round 1 measured as free, this removes *fetches*, which is the one
class round 1 showed the denoisers are actually sensitive to.

## Honest confidence and best estimate

**Roughly 2% of the frame, and that is the problem.** The noise floor here is ~2% (7% cross-seed CV),
so my own best estimate straddles the threshold I would need to call a result. Confidence that it is
*not a regression*: high - it is strictly less work, and the only added traffic is 4 B written and
8 B read per texel. Confidence that it is *measurable as a win*: low-to-moderate. I would not be
surprised if this lands inside the noise.

I want to be explicit about the uncertainty, because it cuts against my own change. Counting the
per-tap cost (3 texture loads, 3 transcendentals - two `exp` and a `pow`, i.e. an SFU-bound
`log2`+`exp2` pair - plus ~10 FMA), the SFU is roughly half the ALU cost and the loads are a minority
of it. That argues the a-trous is *not* cleanly bandwidth-bound, and that removing 8% of its read
traffic will not return 8% of its time. The reason I still believe it is worth taking is that it is
one of very few remaining changes in the 30.7% denoiser region that remove memory operations
specifically, and it is exact with no precision trickery.

## Risks and what I deliberately did not do

The extra allocation is 4 bytes per RT texel - 33 MB at 4K ultra (`rtDivisor: 1`, so the RT grid is
the full 3840x2160). It is freed in `RtTextures.destroy` and re-created on resize. `bytes`/`textureBytes`
is deliberately left reporting textures only.

Ruled out, with reasons - this is the part I would most want a second opinion on:

- **Narrowing the shadow a-trous ping-pong to r32float.** Shadow's `.y/.z/.w` are provably exactly
  zero end to end (`shadow.wgsl:26` writes `vec4f(vis,0,0,0)`; `temporal.wgsl` mixes only zero
  channels; `atrous.wgsl` stores `vec4f(sum/wSum,0,0,0)`), so tmpA/tmpB carry 4 bytes of dead payload
  per texel. But the store goes through `fp16Safe` into `rgba16float`, so the value iterations 1 and 2
  read is the *fp16-rounded* one; an r32float store would keep f32 and change the image. Making it
  exact needs `unpack2x16float(pack2x16float(...))` to emulate the rounding, which relies on a spec
  equivalence for ~1.4% of frame and only for the shadow signal. Bad trade; not taken.
- **Packing the BVH stack in `traceBvhTransmit`, the shadow ray's traversal.** This is the real "pair"
  finding and it is a miss, not an opportunity. Agent 01's landed packing merges a node index and an
  entry distance into one 8-byte stack slot, and `traceBvh` got it (`rt_bvh.wgsl:24,59-64`).
  `traceBvhTransmit` - which `keyVisibility` and therefore `shadow.wgsl:24` uses - did not
  (`rt_bvh.wgsl:74,103-108`, still `array<u32,32>`). It cannot be copied: it never carried an entry
  distance, so there is no second word to merge, and *adding* one would introduce the
  `top.entry > best.t` culling that `traceBvh` has, changing which nodes are visited inside the
  visit cap and therefore the image. The landed GI work genuinely does not reach the shadow ray.
- **`traceBvhTransmit` pushes children in the opposite order to `traceBvh`.** It writes the near
  child at `sp` and the far child at `sp+1` (`rt_bvh.wgsl:102-108`), so the *far* child is popped
  first - the opposite of `traceBvh`'s near-first walk and of the file header's stated intent. That is
  a genuine traversal-order inefficiency. Fixing it is **not** byte-identical: the walk is bounded by
  `visits < cap` and short-circuits on `tau > CANOPY_OPAQUE_TAU`, so a different order visits a
  different node set and changes `tau`. Flagged for a future agent with a tolerance, not taken here.
- **Hoisting the moment sum into the temporal pass** (so the a-trous never fetches moments at all).
  Not possible: temporal reads `momPrev` and writes `momCur`, so it cannot see the current frame's
  moments that the a-trous sums.
- **Fusing the three iterations into one dispatch**, which would remove the intermediate round-trips
  *and* the sum entirely. Not possible: iterations 1 and 2 read a full image written by the previous
  dispatch, and a compute pass has no global barrier.
- **Specialising the centre tap.** The `i=0,j=0` tap re-fetches `auxDepth`/`srcTex`/`auxNormal` and
  redoes `octDecode`/`rtSrc`/`worldFromLinear` that are already in registers. It is 3 of 75 loads and
  it is an arithmetic-class edit, which round 1 measured as free twice. Rejected.
- **Changing the ray/denoiser split.** I did not touch `keyVisibility`, `traceTerrain`, the cloud
  transmittance, the temporal clamp, or any tap weight. The tempting framing "the ray stage makes
  noise the denoiser must clean up" does not have a legal fix here: any change to the traced value or
  to the filter weights moves pixels.

## Verification output

```
$ npx tsc --noEmit
TSC_EXIT=0

$ npx vitest run src/render/rt/rtShaders.test.ts
 Test Files  1 passed (1)
      Tests  22 passed (22)

$ /home/ubuntu/gpu-runtime/wt-setup.sh /home/ubuntu/fpv-opt/r07 r07
built /home/ubuntu/gpu-runtime/wt/r07/bundle/renderer-harness.mjs

# baseline / normal / profile, all three in one output dir
PASS {"tag":"baseline","operations":5}
PASS {"tag":"normal","operations":5}
PASS {"tag":"profile","operations":5}

$ node /home/ubuntu/gpu-runtime/check-pixels.mjs .../baseline-result.json
  fresh      image same | probe atlas same | rt stats same | frameIndex same
  steady     image same | probe atlas same | rt stats same | frameIndex same
  capture-a  image same | probe atlas same | rt stats same | frameIndex same
  capture-b  image same | probe atlas same | rt stats same | frameIndex same
  moved      image same | probe atlas same | rt stats same | frameIndex same
PIXEL-IDENTICAL: YES
GATE_EXIT=0
```

All nine preprocessed a-trous variants (3 signals x 3 iterations) were also resolved and inspected:
iteration 0 has the moment fetch, iterations 1 and 2 have none, and every `textureStore` still goes
through `fp16Safe` (2/2 per variant), so the existing fp16-safety test is unaffected.

## Files

- `src/render/shaders/rt/atrous.wgsl:12` - the `varBuf` binding; `:75-90` the hoisted sum
- `src/render/rt/textures.ts:21-26,39,63` - the per-texel f32 scratch and its lifetime
- `src/render/rt/layouts.ts:51-52` - `storageRw(6)` on both a-trous layouts
- `src/render/rt/groups.ts:120` - binding the scratch into every a-trous bind group
- `src/render/rt/pipelines.ts:41-42` - the `VARSTORE` define on iteration 0
- `src/render/rt/rtShaders.test.ts:78` - focused test locking the hoist
