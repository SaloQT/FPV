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
