# Round 4 — where the ultra-4K frame actually goes

Rounds 1–3 (see `PERFORMANCE.md`, `PERFORMANCE_ROUND2.md`, `PERFORMANCE_ROUND3.md`) optimised the CPU
side: track generation, terrain query cost, physics substeps. That work is done and the CPU is no longer
where the time is. This round re-measured from scratch on the real GPU and attacked the renderer.

## Baseline, measured fresh

Hardware: NVIDIA L4, 23 GB, 4 CPU cores. Output 3840×2160, quality `ultra`, 2 GI rays/texel, RT at full
resolution (`rtDivisor` 1), flying the real generated track so adaptive work never settles.

```
gpuMs mean = 82.2  p50 = 74.7  p90 = 112.8  fps = 12.3
COARSE  pre 4.1  gbuffer 12.7  rt 59.1  lighting 1.0  sky 0.16  post 4.5
DETAIL  probes 1.6  shadowRays 2.2  shadowDenoise 7.8  giRays 27.9  giDenoise 8.9
        specularRays 1.5  specularDenoise 8.6
```

The 91.71 ms quoted for the end of round 2 was measured in a different session; this round's control sits
at 82–85 ms depending on card temperature. **Only same-session paired deltas are meaningful** — see
"Method" below.

## CPU: not the bottleneck, measured not assumed

| | ms/frame |
|---|---|
| Renderer submission (`renderer.render`) | 1.75 |
| Physics, 333 substeps at 4 kHz on sloped terrain | 1.29 |
| **Total CPU** | **≈3.0 against 82 ms of GPU** |

About 4% CPU utilisation. The app is ~96% GPU-bound, so no amount of CPU work raises frame rate. This is
consistent with rounds 1–3 already having done that work. CPU optimisation is closed.

## Cost map: each term measured by deliberately deleting it

The method is to break the maths on purpose, measure, and only then decide whether a bit-exact way to
avoid the work is worth finding. Percentages are of the ~84.6 ms control in that batch.

| Term deleted | Frame | Δ | Reading |
|---|---|---|---|
| all BVH traversal | 62.5 | **−26.1%** | the single biggest item |
| the 3 radiance-probe 3D samples | 85.0 | +0.5% | free; texture cache absorbs it |
| terrain DDA raycast | 86.2 | ~0 | free |
| `keyVisibility` shadow traversal | ~86 | ~0 | free |
| BVH visit cap 128 → 32 | 82.8 | −1.1% | the cap barely binds |
| primitive intersection only | 82.1 | −2.9% | small; `LEAF_SIZE` is 2 |
| à-trous `pow(dot,16)` | 78.9 | −6.7% | transcendental |
| à-trous per-tap unprojection | 77.5 | −8.4% | a mat4×vec4 + divide per tap |
| à-trous both `exp` calls | 76.2 | −9.9% | transcendental |
| à-trous `tapWeight` selects | 82.6 | −1.2% | the only avoidable term |

**So the frame is: BVH traversal ≈19 ms (23%), à-trous weight ALU ≈12–13 ms (15%), G-buffer 12.7 ms,
primitive intersection 2.5 ms, and the rest small.** The two hot kernels are the whole story.

Two of those numbers do not survive the 20-term sweep below, and both are marked here rather than left to
be discovered later: "BVH traversal ≈19 ms" comes from deleting all traversal, which also changes every
hit and therefore the downstream work, and the 15 ms of "node-load divergence" in the original reading of
the sweep turned out to be half the GI rays terminating early. The rebuilt pass-timer map is in **What the
frame is actually made of** at the end of this file; trust that one over this table's first row.

## The 20-term sweep, and two conclusions from it that had to be withdrawn

A second sweep of 20 terms at 4K/ultra, control `w00` = **82.253 ms**, one term deleted per probe, output
wrong on purpose. The full pass timers, because the frame total turns out to be a misleading instrument:

| probe | term removed | frame ms | gbuffer | rt | giRays | reading |
|---|---|---|---|---|---|---|
| w00 | *control* | 82.253 | 12.880 | 59.525 | 28.14 | — |
| w01 | à-trous source fetch | 79.422 | 12.706 | 57.067 | 27.95 | −2.83 |
| w02 | à-trous normal fetch + `octDecode` | 79.157 | 13.165 | 56.166 | 28.19 | **−3.10**, largest fetch |
| w03 | à-trous depth fetch | 81.803 | 12.860 | 59.106 | 28.49 | cheap |
| w04 | à-trous accumulate (control) | 82.891 | 13.155 | 59.821 | 28.81 | +0.64 → free |
| w05 | `sigmaL` sqrt | 84.860 | 13.198 | 61.524 | 28.96 | +2.61 → the noise floor |
| w07 | BVH slab arithmetic | 142.446 | 12.496 | 120.532 | 63.98 | **invalid**, see below |
| w08 | BVH node index pinned to node 0 | 67.163 | 13.115 | 44.176 | 13.58 | **−15.09, the headline** |
| w11 | constant ray direction | 67.498 | 13.090 | 44.264 | 12.11 | confirms w08 |
| w12 | sky radiance on miss | 82.299 | 12.906 | 59.487 | 28.04 | free |
| w13 | constant basis | 89.290 | 13.018 | 66.331 | 34.60 | slower; workload changed |
| w14 | per-texel probe irradiance | 83.373 | 13.168 | 60.093 | 28.11 | free |
| w15 | terrain sample | 84.406 | 13.618 | 60.681 | 28.65 | no gbuffer change |
| w16 | layer weights | 84.236 | 12.591 | 61.546 | 28.52 | no gbuffer change |
| w17 | per-layer detail textures | 83.415 | **10.772** | 62.420 | 28.00 | **valid: 2.11 ms** |
| w18 | micro fbm noise | 82.682 | 12.511 | 60.142 | 28.26 | free |
| w19 | clump tone | 84.835 | 13.127 | 61.556 | 29.12 | no gbuffer change |
| w20 | motion vector | — | — | — | — | failed twice, not re-run |

Four things fall out of this table, and three of them are about the method rather than the renderer.

**1. `w08` does not show what it first appeared to show, and the correction matters more than the number.**
Pinning every node index to node 0 saves 15.09 ms, which reads like "node loads are 18% of the frame and it is
all warp divergence". But look at the `giRays` column: it falls 28.14 → 13.58 at the same time. A degenerate
tree returns a near hit almost immediately, so **half the GI rays terminate early — the probe halved the
work**. And the whole `rt` delta is that one effect: `rt` drops 15.35 ms while `giRays` alone drops
14.56 ms, so the other six RT passes are unchanged to within 0.8 ms in total. `w11` does the same thing
by a different route (one constant ray direction makes the whole warp descend in lockstep) and lands within
0.3 ms of the same figure, which is what made the divergence story look so convincing. Both probes
measure *the GI pass doing half as much traversal*, not the price of a coalesced node fetch. **The 15 ms
was never a measurement of divergence, and no fix for divergence was ever justified by it.** The honest
statement is the plain one: GI ray tracing is 28.1 ms, 34% of the frame, and it is the largest pass.
The traversal inside it is most of that, but the sweep does not cleanly separate traversal from shading,
prim intersection and the terrain DDA inside that pass.

**2. w07 is invalid as a cost measure, and it is worth saying why.** Deleting the slab test looks like it
should isolate the arithmetic. It does not: the slab test *is* the culling mechanism. Without it every
subtree is descended to its leaves, giRays goes 28 → 64 and the frame goes to 142 ms. A probe that
destroys the workload it is measuring cannot price the term. The only thing w07 tells us is that the box
test prunes roughly three quarters of all traversal work.

**3. The frame total is the wrong instrument for a G-buffer probe; the pass timer is the right one.**
w17 removes the per-layer detail textures. Its frame time went *up* by 1.2 ms, which reads as "free" or
"worse" — but its `gbuffer` timer went 12.880 → 10.772 with giRays flat at 28.0, so the workload really
is preserved and the detail textures really cost **2.11 ms**. The frame rose because a flatter G-buffer
makes the RT pass work harder downstream. Any probe that feeds a pass whose output another pass reads is
contaminated in the total, and only the patched pass's own timer is workload-independent. Re-reading
w15/w16/w19 that way **retires them all**: their gbuffer timers are 13.6/12.6/13.1 against a 12.88
control, i.e. none of them removed any measurable G-buffer work at all. Of ~12.9 ms of G-buffer, 2.1 ms
is the detail textures and the other ~10.8 ms is not terrain sampling, layer weights, clump tone, micro
fbm or per-texel probe irradiance.

**4. The noise floor is ±2.6 ms.** w05 and w13 are single-term deletions that came out *slower* than
control by 2.6 ms and 7.0 ms, with no plausible mechanism, and w04 — a deliberate no-op — came out +0.64
ms. So `pre` and `post` are rock steady across all 18 probes (4.19/4.51 ± 0.15, which is what proves they
are turnaround) while everything downstream of the G-buffer swings by several ms between identical
workloads. Any single-run probe delta below ~2.6 ms is not evidence.

**The general lesson, which cost two wrong conclusions.** A probe that makes a kernel terminate early
looks exactly like a probe that makes a kernel faster, and the only tell is a *sibling* timer in the same
pass. `giRays` is what exposed w08 and w11; the per-pass `gbuffer` timer is what exposed w17's true sign.
Every future probe here has to be judged on whether its own pass's timer moved while the workload stayed
put — not on the frame total, and not on the size of the number.

**Not re-run:** w20 (the terrain motion vector) failed twice on a fragment-pipeline validation error
that I did not chase, and w17's first attempt failed the same way. w17 was fixed and re-run; w20 was not,
because a motion vector is inside the ~10.8 ms of G-buffer that the six valid G-buffer probes all failed to
localise, and one more of them would not change the picture.

## Two probes that closed the two open questions

The sweep left exactly two things worth knowing and neither could be priced with a deletion probe, because
both are about *size* rather than *work*. Both were run against a fresh control on the same tree
(`ctl21` = **82.788 ms**, gbuffer 13.057, giRays 28.393), and both keep the traversal and the output
bit-identical, so they are the first probes here whose only variable is bytes moved.

**`w21` — how much is BVH node traffic worth?** Double the node record from 32 B to 64 B, leaving the
first 8 words and everything the shader reads untouched. Same nodes, same visits, same results; each
scattered node fetch simply moves twice the bytes.

| | frame | gbuffer | giRays |
|---|---|---|---|
| `ctl21` control | 82.788 | 13.057 | 28.393 |
| `w21` node 32 → 64 B | 83.537 (**+0.90%**) | 13.167 | 28.780 (+0.39) |

**Doubling all node traffic costs 0.39 ms in the pass that uses it.** That is the whole prize, and it is
small enough to end the question. The GPU only ever reads 2 of a node record's 8 words, so a 4-word record
looked like a free 4× cut — but the child boxes have to live somewhere, and they are 48 of the 96 bytes a
visit moves. Shrinking the record from 32 B to 16 B removes 16 of 96 bytes, a predicted **0.07 ms**, an
order of magnitude under the 0.3% bar. Halving the boxes instead means quantising them, which changes
which nodes are culled and therefore the image. **The BVH is closed**: not because traversal is free, but
because 96 bytes per visit is close to what a binary tree of float AABBs actually costs, and the measured
sensitivity to that number is 0.4 ms per doubling.

**`w22` — are the per-layer mean-colour lookups worth hoisting?** `dsPlane` calls `dsPlain` twice and each
call re-fetches the layer's mean colour at the same fixed coordinate, same layer, same mip — a value that
does not depend on the pixel at all, so hoisting it into a per-layer constant table is exactly bit-exact
and looked free to do.

| | frame | gbuffer |
|---|---|---|
| `ctl21` control | 82.788 | 13.057 |
| `w22` mean lookups removed | 83.720 | 13.195 (**+0.14**) |

**0.14 ms: free.** The repeated identical fetch is an L1 hit every time, so the redundancy that made the
code look wasteful costs nothing to execute. The 2.11 ms that `w17` attributed to the per-layer detail
textures is in the *distinct* per-layer, per-pixel samples, which genuinely differ and cannot be shared.
**Rejected before writing a line of it.**

Both probes also re-confirm the noise floor from the other direction: the frame total moved +0.90% and
+1.13% while the pass each probe actually touched moved +0.39 ms and +0.14 ms, and in `w22`'s case the
frame moved *against* the pass by more than the pass moved at all.

## A bit-exact BVH change that was correct, verified, and still not worth landing

The child-box array (`bvhKids`: each node's two children's boxes, indexed by the parent, so a visit issues
one independent 64 B fetch instead of a 32 B node fetch followed by a *dependent* 64 B child-box fetch).
Same floats, same arithmetic, same visit order, same push order — bit-exact by construction, and the
oracle agreed (all three tags, every image and every probe atlas byte-identical; the only diff in the whole
result was `bvhBytes` 139264 → 278528, which is the memory this array costs).

Paired interleaved A/B, 858 frames per arm, 10 seeds, both arms built from the same HEAD:

| round | base | candidate | delta |
|---|---|---|---|
| 1 | 91.64 ms | 91.53 ms | −0.12% |
| 2 | 90.83 ms | 91.58 ms | **+0.83%** |

A −0.12% and a +0.83% on 858 frames each is a spread, not a result: with enough warps in flight the second
load was never the critical path, so removing its dependency bought nothing. **Not landed** — it doubles
BVH node memory and adds 8 files for a change indistinguishable from zero. `w21` then explained why the
gain was never there to be had.



Rebuilt from the pass timers of the same control, because it is the version of this map that survives the
correction above. The RT pass's 59.5 ms is not one thing:

| pass | ms | % of the 82.25 ms frame |
|---|---|---|
| GI ray tracing (`giRays`) | 28.1 | **34%** |
| à-trous denoising, 3 signals | 25.4 | **31%** |
| G-buffer | 12.9 | 16% |
| `pre` + `post` turnaround | 8.7 | 11% |
| shadow rays | 2.2 | 3% |
| specular rays | 1.5 | 2% |
| probe update | 1.6 | 2% |
| lighting | 1.0 | 1% |
| sky + forward | 0.2 | ~0 |

**Two kernels are 65% of the frame: GI ray tracing and à-trous denoising.** The à-trous half is
irreducible bit-exactly — it is `pow`, two `exp` and a per-tap mat4 unprojection per tap, and none of
those can be reassociated into cheaper arithmetic without changing the bits. The GI half is where the
remaining headroom would have to be, and `w21` has now bounded it: all BVH node traffic is worth 0.39 ms
per doubling, so the traversal's own memory cost is nearly exhausted and the pass's 28 ms is in its slab
arithmetic, its primitive intersection and its shading. The G-buffer's 12.9 ms is 2.11 ms of per-layer
detail sampling (`w17`) plus roughly 10.8 ms that six separate fragment probes could not move at all —
which points at rasterisation and vertex work rather than shading, and neither can be changed without
changing the image.

That is the honest floor of this round. Across four rounds, 40+ probes and one landed win, the measured
addressable headroom left under the byte-identical rule is on the order of **1–2 ms, under 2%**, spread
thin enough that no single remaining change clears the 0.3% bar on its own. The remaining large levers —
quantised BVH boxes, fewer GI rays, a cheaper à-trous weight, lower internal resolution — all change the
output, which is the one thing this work is not allowed to do.

## Landed

`e5fafdd` — hoist `tapWeight(j)` out of the à-trous inner loop. The 5×5 kernel recomputed each of the 5
row weights 5 times. Paired, interleaved, 5 seeds: à-trous pass sum **−1.84%**, every seed negative
(−1.36 to −2.06), i.e. −0.58% of the frame. Byte-identical.

## Rejected, with the measurements that rejected them

- **Back-facing à-trous early-out (+2%, reject).** `max(dot,0) == 0` implies `pow(0,16) == 0` implies the
  tap weight is exactly 0, so skipping before the unprojection and both `exp` calls is *provably*
  bit-identical. It measured 2% slower: back-facing taps are too rare to pay for the branch, and moving
  the normal fetch ahead of the source fetch serialised two independent texture loads.
- **Packed BVH stack entry (+5.1% on giRays, reject).** Carrying each child's `first`/`count` in the stack
  entry removes the 32-byte `bvhNodes` load on pop. Byte-identical, but consistently slower on all 4 seeds.
  The node load is a free L1 hit; growing the entry from 8 to 12 bytes is real thread-local-memory
  traffic. This also rules out "make the traversal load less" as a family — the stack traffic is the
  sensitive part, not the buffer reads.
- **Probe texture consolidation (dropped before writing).** 3 rgba16float 3D textures hold one channel
  each; merging them into one rgb texture would cut 3 trilinear samples to 1. The probe above shows those
  samples cost nothing. A day of work, zero return.
- **Merging `auxDepth` (r32float) with `auxNormal` (rgba16float).** Would need rgba32float — 16 bytes
  against the 12 the pair uses today. A loss on bandwidth.

## Method notes, including two harness bugs that produced false results

Both of these produced a *confident wrong answer*, so they are worth recording:

1. **`&&` chains silently swallow a failed patch.** `probe.sh` applied patches as
   `cp ... && python3 ... && rm ...`. Bash's `errexit` does **not** fire for a command on the left of `&&`,
   so a patch whose anchor string did not match was skipped and the **unpatched** bundle was measured.
   `p6` (remove the BVH traversal) reported "no win" this way — its anchor had the wrong spacing, wrong
   parameter name and wrong return type. Re-run correctly it showed **−26%**, which reversed the entire
   conclusion of that hour. `probe.sh` now refuses to measure unless the patch's marker string is present
   in the built bundle, and the patch step is not an `&&` chain.
2. **Two measurement jobs on one GPU.** Running a screen and a probe concurrently inflated every pass
   (giRays 28 → 76 ms) and produced a meaningless table. All scripts now take an exclusive `flock` on
   `/tmp/fpv-gpu.lock`.

Also: `public/data/stars.bin` is gitignored (generated by `tools/build_stars.py`), so a fresh worktree has
no copy and any harness resolving it against the repo root dies with ENOENT. `wt-setup.sh` now copies it.

Paired and interleaved runs are mandatory. The card throttles 2040 → 1470 MHz over a long session, which
moves absolute frame time by ~2%; a baseline measured minutes apart from a candidate says nothing. The
card also drifts upward as the session heats (82 → 85 ms over an hour), so every batch carries its own
control. Across-seed variance on total frame time is ~13% (the camera path changes how much sky and how
many back-facing taps each track shows), so screening scores the à-trous or giRays **pass** rather than
the total — the per-texel kernel cost is far more stable than the whole frame.

## Where the remaining time is, and why it is hard

The two hot kernels are both close to their **bit-exact floor**:

- The à-trous spends ~12–13 ms on three transcendentals and a mat4×vec4 unprojection per tap, ×25 taps ×
  3 iterations × 3 signals at 4K. `exp`/`pow` cannot be replaced with multiplies bit-exactly, and the
  unprojection cannot be reassociated (a matrix multiply against the inverse-view-projection is not the
  same expression as folding the basis out of the dot product).
- The BVH traversal is ~19 ms and, per the rejected experiments above, the cost is the slab arithmetic and
  the thread-local stack, not the node loads and not the visit count.

## The `pre` and `post` intervals are not GPU work

`pre` (4.2 ms) and `post` (4.5 ms) together look like 8.7 ms — 10% of the frame — of never-examined time.
They are not. The six COARSE intervals sum exactly to the reported frame time, and the decisive evidence is
that **deleting real work from `pre` did not shrink `pre`**: disabling the whole vegetation pre-pass (grass
and tree culling plus instance generation, a real compute workload) left `pre` at 4.243 ms against a ~4.2 ms
baseline. Work that does not respond to removing work is not work.

The cause is in the harness: `harness-perf.mjs` awaits `device.queue.onSubmittedWorkDone()` after **every**
frame. The GPU therefore drains completely between frames, and the submit/drain turnaround is attributed by
the timestamp queries to the first interval of the next frame (`pre`) and the last of the current one
(`post`). The independent check agrees: CPU submission is 1.75 ms, reported GPU time is 82.2 ms, and
measured wall time is 93.7 ms — about 11.5 ms of turnaround that the real app hides by pipelining.

So the optimisable GPU work in a frame is about **74.6 ms** (G-buffer 13.4 + RT 60 + lighting 1.0 +
sky 0.16), and the real app at ultra 4K runs nearer **13.4 fps** than the 12.3 the harness reports.

This does not invalidate anything above. The overhead is a fixed per-frame constant, so it cancels in every
paired A/B, and every acceptance decision in this document was made on paired deltas. Only the absolute
baseline was pessimistic. (A pipelined harness variant was attempted and could not work: the GPU-timer ring
holds three frames, so timings must be drained per frame or the samples are lost.)

## The G-buffer, probed

The G-buffer pass is 12.7–13.6 ms (~15%) and had never been examined. Two ceilings were measured in it:

- **Terrain top-3 layer selection, −3.00 ms (−22.5% of the pass), all 4 seeds negative.** The fragment
  shader picks the three heaviest ground layers with a selection sort: 3 rounds of an 8-way argmax with
  the winner zeroed, over a function-local array with dynamic indexing. Implemented faithfully with
  register scalars (`c7`) it recovered only **−1.62% of the pass (0.22 ms, −0.26% of the frame)**, and
  one seed was a regression. So the cost is not thread-local memory, as the dynamic indexing suggested —
  the compiler was already promoting the array, and the 3 ms is the selection sort itself, which a
  bit-exact patch has to keep. **Rejected: below the 0.3% bar.**
- **Slope-plane detail branch, −0.44 ms.** `dsLayerDetail` is called up to three times per pixel and each
  call recomputes `pow(abs(c.n), vec3f(6.0))` from the same `c.n`, which looked like free redundancy. The
  branch is off for most terrain (`ctx.planes` needs the flag *and* `normal.y < 0.85`), so the ceiling was
  0.44 ms and the change would alter the image anyway. **Rejected.**

## The shared-front GI traversal: priced, then dropped

The GI pass traces 2 rays per texel from the same origin through the same tree independently, so a
shared-front or common-prefix pair traversal would visit each shared node once instead of twice. The
32-entry stack was confirmed never to overflow (raising it to 256 renders identically), so the merge
would not have changed results, and the near-hit is order-independent given the cap barely binds.

It was priced before being written: making the second ray reuse the first ray's hit — one scene trace
instead of two — saves only **2.38 ms (8.2% of giRays, 2.8% of the frame)**, not the ~9.5 ms that
"half the traversal" implies. The two rays diverge early and the second one prunes harder, so it is much
cheaper than the first. A realistic common-prefix implementation would capture perhaps half of that,
about **1% of the frame, for a high-risk rewrite of the walk with real divergence subtleties**.
**Dropped before implementation.**

## What the two surprises teach

Both c4 and c7 were reasoned predictions that the measurement contradicted:

- c4 predicted the redundant `bvhNodes` load on pop was real traffic. It was a free L1 hit, and growing
  the stack entry cost more than it saved (+5.1%).
- c7 predicted the dynamically indexed local array was spilling to thread-local memory. The compiler had
  already promoted it, so a faithful rewrite gained 7% of the ceiling.

Both were caught only because the ceiling was measured first. Neither would have been caught by writing
the "obvious" optimisation and benchmarking it — that is the whole argument for probing before porting.

## The GI pass: a 16 ms hole that is not a hole

The single largest unexplained number in the renderer. It took eight probes to characterise, and the
answer is not the one the arithmetic suggested, so it is written down in full.

`p25` removes the secondary shadow ray that `shadeSurface` fires for hits inside 250 m, and the frame goes
from ~81 ms to ~65 ms — **16 ms, 20% of the frame**, reproducible to within 0.5 ms across two runs and
three controls. That reads as "the shadow ray costs 16 ms". It does not:

| probe | what went | frame | giRays |
|---|---|---|---|
| control ×5 | — | 80.3, 80.8, 80.9, 81.1, 81.4 | 29.0–29.5 |
| p25 ×2 | `keyVisibility`'s **call** removed | **64.7, 65.1** | **14.9** |
| p28 | its BVH half skipped, function still inlined | 80.9 | 29.4 |
| p29 | its terrain-DDA half removed | 79.8 | 28.1 |
| p33 | transmit stack alone 32→8 | 79.8 | 28.8 |
| p34 | canopy optical-depth body gutted | 81.4 | 29.5 |
| p316 / p38 | both stacks 32→16 / 32→8 | 82.0 / 82.4 | worse |
| p35 | the GI ray loop's **shading** removed | 64.9 | **12.7** |

Removing either half of the shadow ray is worth ~0 and ~0.5 ms, and its two most plausible internal costs
(the stack arrays and the canopy noise integration) are worth nothing. But removing the call is worth 16 ms,
and removing the shading around it is worth 16 ms too. **p25 is not measuring the shadow ray; it is
measuring all of GI hit shading, of which the shadow ray is a part that happens to be inside the removed
region.**

That splits the GI pass cleanly: `traceScene` is 12.7 ms, hit shading is ~16 ms. The remaining puzzle is
that *no individual piece of the shading registers*: the per-hit terrain material (p27), the radiance-probe
samples (p26), the shadow ray's two halves (p28/p29) and the canopy integration (p34) are each 0–0.9 ms.
Six terms that are each below the noise floor add up to 16 ms. **This is the failure mode of the ceiling-probe
method, in its purest form** — the method finds the big single term, and here there is no big single term. To
make GI shading cheaper it has to get cheaper as a whole, not by deleting a piece.

The register-cliff theory that the split was built on (a second inlined traversal capping occupancy) is
**not supported**. `feat/gi-split` implements the split anyway: an 8-byte per-ray hit record in two
`rg32float` storage textures, the ray origin and direction rebuilt in the shade dispatch from the same
G-buffer and blue-noise inputs so only kind/prim/distance crosses the boundary. It is byte-identical
(max channel difference 0/255 on every oracle frame) and 2,342 tests pass — and it recovers **1.5 ms of the
16**, for 132 MB of VRAM and a second dispatch. Kept on its own branch, not merged: the shape is right and
the work is sound, but the payoff does not justify it, and the number it was built for is not there.
