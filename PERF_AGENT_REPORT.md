# Agent 04 — shadowDenoise (7.7% of the frame)

## What I changed

The shadow a-trous now accumulates a scalar instead of a `vec4f`, removing three of the four
vector multiply-adds from each of its 25 taps in all three iterations — and, because the compiler
can then see that only `.x` of the source is live, narrowing the source fetch from 64 bits to 16.

Commit: `aef97d1` (perf), `b2188cc` (focused test). Both on `perf/agent-04`.

**This is a small win.** Honest estimate: **~3% of shadowDenoise, ~0.25% of the frame**
(0.2–0.3 ms of 116.86 ms). I explain below why I believe that is close to the ceiling available
in this area, and what I rejected and why. If the orchestrator only merges changes above some
threshold, this one should probably be judged on its zero-risk exactness rather than its size.

## Why the output is byte-identical

The claim is *not* "GI and shadow look the same". It is that the shadow a-trous's non-`.x`
channels were already dead, and that the one place they were still observable, I reproduced
exactly.

1. **Only `.x` of the a-trous source is ever read, for SHADOW.** Two readers, both `.x`-only:
   - `src/render/shaders/rt/atrous.wgsl:22-28` — `tapLuma()` returns `v.x` under `#ifdef SHADOW`.
   - `src/render/shaders/rt/atrous.wgsl:30-35` — `dstValue()` under `#ifdef SHADOW` returns
     `vec4f(select(0.0, v.x, dbg <= 1u), 0.0, 0.0, 0.0)`.
   The producers supply nothing else either: `src/render/shaders/rt/shadow.wgsl:27` stores
   `vec4f(vis, 0.0, 0.0, 0.0)`, and the temporal pass's SHADOW branch
   (`src/render/shaders/rt/temporal.wgsl:140-147`) only ever modifies `.x` of the history.
   So `s.y/.z/.w` contributes to nothing that reaches a pixel.

2. **Therefore `sum.y/.z/.w` were exactly `0.0`** in the old code: `sum` starts at `vec4f(0.0)` and
   only `sum += s * w` touches it, with `s.y/z/w == 0.0` (1). `0.0 * w` is `±0.0` and
   `±0.0 + ±0.0` is `±0.0`, so the vector form's unused channels were a *sign-dependent zero*,
   never a real value.

3. **The one observable case, reproduced exactly.** `src/render/shaders/rt/atrous.wgsl:123`:
   ```wgsl
   let acc = select(centre, vec4f(sum / wSum, 0.0, 0.0, 0.0), wSum > 1e-6);
   ```
   The old final line was `select(centre, sum / wSum, wSum > 1e-6)`. When `wSum > 1e-6` the vec4
   form yielded `(sum.x/wSum, 0, 0, 0)`, which is what I store. When `wSum <= 1e-6` it yielded
   `centre` *including its non-zero `.y/.z/.w`*, which I also store. I did **not** "fix" that
   fallback to store zeros — that would have been a behaviour change, and this preserves the
   stored texels of `tmpA`/`tmpB` channel for channel, not just the final pixel.

4. **The accumulation order and the arithmetic are untouched.** Same `for` loops, same
   `continue` conditions, same `w`, same left-to-right f32 add sequence. `sum += s.x * w` is the
   `.x` of `sum += s * w`: the products are the same f32 values and they are added in the same
   order into the same kind of f32 accumulator. IEEE-754 addition is commutative in the
   sign-of-zero sense only, and no ordering change was made anyway.

5. **GI and SPEC are untouched**, so the other two denoise passes are bit-identical by
   construction — they are not merely "unaffected", they take a literally different branch.
   `dstValue`'s GI and SPEC arms genuinely use `.a` (the confidence divide at
   `atrous.wgsl:52` and the AO views at `atrous.wgsl:41`), so this narrowing would be *wrong* for
   them. `#ifdef SHADOW` keeps them on the original `vec4f` path, and
   `src/render/rt/rtShaders.test.ts:78-100` now pins both directions of that split.

## Why it should be faster

**Where the time actually goes** (my model, derived from the source — I did not run a benchmark):

- `ultra` is `rtDivisor: 1` (`src/render/contracts.ts:109`), so the RT grid is the full
  **3840×2160 = 8.29 M px**, not a quarter-resolution buffer. That makes this one of the heaviest
  passes in the frame per unit of source code.
- Per a-trous tap the body is ≈95 warp instructions. Dominated by six **IEEE `f32` divisions**:
  four in `worldFromLinear` (`src/render/shaders/rt/rt_common.wgsl:36` → `math.wgsl:62-66`:
  one `params.z / z` plus `w.xyz / w.w`), and one each in the `wz` and `wl` weights
  (`atrous.wgsl:101,103`). `div.rn.f32` expands to ~9-10 instructions, so **~60% of a tap is
  division**, plus six SFU ops from the two `exp`s and the `pow`.
- Per pixel: 25 taps × 3 iterations ≈ 7,125 instructions, plus ~320 for the temporal pass and the
  moment loops. So **the three a-trous iterations are ~96% of the pass** and the temporal is ~4%.
  Cross-check: at 8.29 M px / 32 = 259 k warps × ~7,500 instructions ≈ 1.95 G warp-instructions,
  and 8.96 ms implies roughly **50% of the L4's peak issue rate** (58 SMs × 4 schedulers ×
  ~1.9 GHz ≈ 441 G/s). That is a healthy IPC for a division-heavy kernel.
- Corroborating the pass timings: specular (8.51 ms) is *cheaper* than shadow (8.96) only because
  `atrous.wgsl:85-88` widens its stride with roughness, so more taps hit the bounds `continue`.

**So the pass is instruction-issue-bound, not DRAM-bound.** Its unique DRAM traffic is only
~1.5 GB/frame, i.e. ~160 GB/s at the measured rate — far below what an L4 can sustain. The
consequence matters for how the rest of this report reads: **removing bytes buys almost nothing
here; only removing instructions pays.** That is why I went after the accumulator rather than at
texture formats.

**The mechanism of this change:** `sum += s * w` on a `vec4f` is 4 vector multiply-adds (4
FMA-class instructions); the scalar is 1. That is 3 instructions saved per tap × 25 taps ×
3 iterations = **225 per pixel**, ~3% of the pass's ~7,500. Second-order: with only `s.x` live,
the compiler can narrow `textureLoad(srcTex, q, 0)` (`atrous.wgsl:105`) from a 64-bit fetch to a
16-bit fetch, which halves the shadow chain's `srcTex` TEX/L1 traffic — a bonus, not the
mechanism, since the pass is issue-bound.

Per the profile table, shadowDenoise is 8.96 ms of a 116.86 ms frame. A 3% cut of the pass is
~0.27 ms, i.e. **~0.23% of the frame**, and it should be uniform across the seed/lap
distribution rather than concentrating on the cheap or expensive end: it removes a fixed fraction
of every executed tap, and taps-executed is what the 2.8-3.7× cost swing tracks (more geometry →
fewer `zq <= 0` / bounds `continue`s → more taps doing full work).

## Verification actually observed

`npx tsc --noEmit` → clean, exit 0.

Bundle rebuilt from my source: `built /home/ubuntu/gpu-runtime/wt/04/bundle/renderer-harness.mjs`

```
=== TAG baseline ===
PASS {"tag":"baseline","operations":5}
=== TAG normal ===
PASS {"tag":"normal","operations":5}
=== TAG profile ===
PASS {"tag":"profile","operations":5}
=== QUALITY GATE ===
  fresh      image same | probe atlas same | rt stats same | frameIndex same
  steady     image same | probe atlas same | rt stats same | frameIndex same
  capture-a  image same | probe atlas same | rt stats same | frameIndex same
  capture-b  image same | probe atlas same | rt stats same | frameIndex same
  moved      image same | probe atlas same | rt stats same | frameIndex same
PIXEL-IDENTICAL: YES
GATE_EXIT=0
```

This was run twice: once on the shader commit alone, and once after adding the focused test, on
the final tree (`aef97d1` + `b2188cc`, worktree clean).

Focused tests (not the full suite, per instructions):
`src/render/rt/rtShaders.test.ts` + `src/render/rt/dispatch.test.ts` + `src/render/rt/params.test.ts`
→ 3 files / 22 tests passed. Adding my test took `rtShaders.test.ts` from 15 to 18 tests.

Caveat I want on the record: the oracle runs a **32×32 RT grid at `divisor: 2`** with 600 prims
(see the harness `rt` stats in its output). It proves exactness of the shader *logic* across 5
operations including two capture re-encodes and a moved camera, but it does not exercise
3840×2160 / `divisor: 1`. My argument for the large majority of pixels (every pixel with
`wSum > 1e-6`) does not depend on resolution, so I am comfortable; the `wSum <= 1e-6` fallback
and the f16/subnormal edges are the parts only the central benchmark can truly exercise.

## Risks and what could regress

- **Very low.** The change is inside one `#ifdef SHADOW` region of one file, adds no bindings,
  no textures, no dispatch changes, no formats, and no TypeScript. `git diff` is 1 shader + 1
  test file.
- The residual risk is concentrated in one thing: I rely on `s.y/.z/.w == 0` for the shadow a-trous
  source. That holds today via two independent routes (the trace writes `vec4f(vis,0,0,0)`, and
  the temporal SHADOW branch only edits `.x`), and the new test asserts the *consumer* side
  (`tapLuma`/`dstValue` read `.x` only). But if someone later gives the shadow history a real
  `.y/.z/.w` (e.g. carrying a second channel for free), the scalar would silently discard it. The
  test is the guard; it is a source-level assertion, not a behavioural one.
- The narrowed `srcTex` fetch is a compiler decision, not a contract. If ptxas ever chooses to
  keep the 64-bit fetch, the win shrinks to the 3 FMAs and nothing breaks.
- **Merge note:** `src/render/shaders/rt/atrous.wgsl` is shared by all three denoise passes, so
  this file can conflict with whichever agent owns GI/spec. My hunks are `#ifdef SHADOW`-scoped
  and the `GI`/`SPEC` arms of those lines are textually unchanged (`sum += s * w;` and
  `select(centre, sum / wSum, ...)` are byte-identical to before), so a conflict should resolve
  without a semantic decision. I did not refactor the other two passes.

## What I deliberately did not do, and why

Most of this is the useful part of the report: the mission suggested a *generalising* structural
fix across the three denoise passes, and I could not find one, because the specific inefficiency
I found is **unique to shadow** and the shared cost is provably untouchable.

- **The big one — hoisting the perspective divide out of the tap loop.** `worldFromLinear` is
  ~50% of a tap (4 of 6 divisions plus a 4×4 mat4). The algebra is attractive:
  `dot(n, pq - pos)` = `dot(n, w.xyz)/w.w - dot(n, pos)`, which replaces three per-tap divisions
  and a 3-vector with one dot3 and one division, and is a big instruction win. **It is not
  bit-identical.** `dot(n, a/d + b/d + c/d)` ≠ `(dot(n,w.xyz))/d`; IEEE-754 is not associative and
  the baseline's rounding is part of the output contract. Rejected.
- **Reciprocal-multiply for the loop-invariant divisors.** `x / zTol` and `x / sigmaL`
  (`atrous.wgsl:101,103`) have per-pixel-constant denominators, so `x * (1.0/zTol)` would hoist
  the division out of the loop. Also not bit-identical (`a/b ≠ a*(1/b)` in general). Rejected.
- **`pow(x, 16.0)` → four squarings.** WGSL `pow` is `exp2(16*log2(x))`; `x^16` by squaring is 4
  roundings instead of 2. Not bit-identical. Rejected.
- **Centre-tap specialisation.** For the `i==0,j==0` tap, `wz` and `wl` are provably `exp(-0.0) = 1.0`
  and the three texture loads CSE against the centre values already in registers — but `wn` is
  `pow(max(dot(n,n),0),16)` and `octDecode`'s `normalize` does **not** produce an exactly unit
  vector, so `wn ≠ 1` and cannot be folded. What is left is ~34 instructions = **~1.4%**, and
  capturing it needs a branch inside the accumulation loop purely to preserve summation order.
  Not worth the risk or the code damage for 1.4%.
- **Shadow a-trous ping-pong to `r32float`.** This is the *byte* win I expected to be the answer:
  it would cut `srcTex` from 8 to 4 bytes per tap in iterations 1 and 2 (~12% of the pass's
  traffic). I rejected it on exactness, not cost: the baseline's `rgba16float` **store** is what
  rounds each iteration's output to f16, and the next iteration reads those f16 values. An
  `r32float` store would not round, so I would have to re-implement the rounding in the shader
  with `unpack2x16float(pack2x16float(x))`. I cannot *prove* that matches the driver's f32→f16
  storage conversion for f16 **subnormals**, and subnormals are reachable here: the temporal mix
  `res = mix(hist, cur, alpha)` with `alpha ≥ 1/16` decays a lit-shadow value geometrically, so
  a signal can walk into the subnormal range and then to zero. It would also need two extra
  full-resolution r32float textures (tmpA/tmpB are shared with GI/SPEC, `rt/groups.ts:116-117`),
  +33 MB at ultra. An unverifiable rounding assumption is exactly the kind of change that gets a
  patch rejected, so I dropped it. **Given the model above this is also the smaller prize than it
  looks** — a byte cut in an issue-bound kernel.
- **Narrowing `auxNormal` to 2 channels** (the denoisers read only `.xy`; 4 of 8 bytes). This is
  the *only* idea I found that would be a real win, and it is not mine: `auxNormal` is produced by
  the aux pass and `src/render/shaders/rt/rt_trace_io.wgsl:12` reads `.z/.w` as roughness and
  metalness, so it would need a sibling 2-channel texture and edits to aux, trace, both denoiser
  shaders, layouts, groups and textures. It is a different stage, it affects all three denoise
  passes another agent owns, and it would only pay off if the band is really bandwidth-bound —
  which my model says it is not. **Handing this to the gbuffer/RT-aux owner is my main
  recommendation.**
- **Workgroup shared-memory tiling of the 5×5 and 3×3 tiles.** ITER=0 tiles to 12×12, but ITER=1
  and ITER=2 both tile to 24×24 (stride 2 and 4, radius 8) = 11.5 KB per 64-thread workgroup, which
  caps occupancy near 8 warps/SM. And since the pass is issue-bound rather than L1-bound, staging
  replaces TEX instructions with LDS instructions without removing the divisions. Rejected on both
  counts.
- **Fusing the three a-trous iterations into one dispatch.** Composed support is
  ±(2 + 2·2 + 2·4) = **±14 texels**, so a fused kernel would need 29×29 = 841 taps per output
  against today's 75. Strictly worse; and WebGPU has no grid-wide barrier regardless.
- **Scalarising the temporal pass's history for SHADOW** — this looked like a free extension of
  the same idea and it is **wrong**, which is worth recording. `temporal.wgsl:121` guards the
  history with `all(abs(hq) <= FP16_SAFE)` over **all four channels**: a non-finite `.y`/`.z`/`.w`
  correctly disqualifies the history texel, so those channels genuinely affect the output. I did
  not touch the temporal pass. (Its 3×3 loop and `nCnt`/`nLuma` are already fine — `nCnt`/`nLuma`
  are dead under `SHADOW` and the compiler drops them.)

I also checked and rejected, for completeness: the dispatch geometry (`ceil(rtWidth/8) ×
ceil(rtHeight/8)` = 480×270 exactly at 3840×2160, no wasted threads); the `z <= 0.0` early-outs
(already before the heavy work in both passes); and the ping-pong ordering (shadow/gi/spec
denoise chains are serialized and reuse `tmpA`/`tmpB` without conflict).

## Confidence and expected gain

- **Confidence the output is byte-identical: high (≈0.97).** The argument is structural, not
  empirical: the non-`.x` channels have no reader for SHADOW, the one path where they were
  observable is reproduced exactly, the arithmetic and its order are untouched, and GI/SPEC take a
  different branch. It is independently confirmed by the oracle on all three tags. The residual
  0.03 is the `wSum <= 1e-6` fallback and f16 edges at 3840×2160, which a 32×32 oracle cannot
  reach and which my reasoning says are unaffected.
- **Confidence in the gain estimate: low-to-moderate (≈0.5).** The instruction model is
  self-consistent and reproduces the measured 8.96 ms at ~50% of peak issue, and it correctly
  explains why specular is cheaper than shadow — but I was forbidden from timing, so the
  instruction count per tap (≈95) is my estimate, not a measurement. If the true tap cost is
  dominated by something I under-counted, the saving could be under 3%.
- **Best estimate: ~0.2-0.3 ms, ~0.2-0.25% of the frame (~3% of shadowDenoise).** I would not
  claim more. If the orchestrator wants to compare against my cost model rather than take the
  number on faith, the cheapest check is to build this revision and read the `shadowDenoise`
  interval against the current build's 8.96 ms at `divisor: 1` — the 32×32 oracle config will
  not resolve a 3% difference.
- **Did I find something clearly bigger elsewhere? No.** I stayed in shadowDenoise. My best
  lead for a genuinely large byte-identical win in this neighbourhood is the `auxNormal` 2-channel
  split described above, which is worth a look but belongs to whoever owns the RT aux/G-buffer
  path, and which pays only if the band is really bandwidth-bound.
