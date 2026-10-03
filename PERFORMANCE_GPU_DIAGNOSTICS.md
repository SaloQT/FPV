# Optional GPU diagnostics

This edition builds on Round 11 (`352c33e02637e65b5cf232fb1b3e764ab6d1ce18`). It adds measurement tools, not a claimed performance improvement. Quality settings, shaders, ray budgets, resolution and production dispatch work are unchanged.

## Measurement scope

The normal rendering path retains its six coarse timestamp sections and seven timestamp queries. Detailed timing is explicitly opt-in. It splits the RT compute pass at existing auxiliary, probe, shadow/GI/specular trace, denoise and latch boundaries, preserving their original execution order and resource bindings. Clouds receive a timestamp pair around their existing pass. Post processing remains available through the coarse `post` interval.

Detailed mode adds pass boundaries, timestamp queries and readback work. These can perturb GPU scheduling and synchronization. Compare detailed results only with the same instrumentation enabled on both revisions. Use normal mode for ordinary throughput comparisons. The intervals are diagnostic estimates, not independent costs guaranteed to sum to a theoretical maximum FPS.

Asynchronous timing results identify their originating presented frame and submission. Benchmark aggregation must count each sample once, reject warm-up/outside-window frames, exclude capture re-encodes and disclose dropped, failed or incomplete samples. Unwritten detailed sections are unavailable rather than stale measurements. Equal valid timestamps may reflect timer quantization.

No physical GPU was available in this cloud workspace. Native Dawn 0.6.2 with Vulkan SwiftShader exposed `timestamp-query`; actual query resolution and mapped readback succeeded without validation errors. Software timings prove instrumentation works, not hardware performance.

## Bounded native validation

Three runs use the same production renderer and High settings: the clean Round 11 baseline, the candidate normal mode and the candidate detailed mode. Each run performs fresh, steady, two capture re-encodes and moved-camera operations. Output is 64×36, internal render 64×64, RT 32×32, with the production 16,384-probe/64-rays configuration and a generated scene containing 600 primitives and 771 BVH nodes.

- All five RGBA outputs and all three probe atlas channels per operation match the baseline byte-for-byte in both candidate modes
- The candidate normal mode matches all 296 recorded compute pass/dispatch/clear trace entries
- Detailed mode preserves compute dispatch/clear ordering, dimensions and indirect-buffer references while introducing timed pass boundaries
- Each candidate mode produces three unique presented-frame samples with source frame indices 0, 1 and 2; both capture re-encodes are excluded
- Detailed probe, shadow/GI/specular ray and denoiser timestamp pairs resolve to finite, nonnegative durations
- Validation scopes, renderer error lists and device-loss checks are clear

This is a bounded correctness check, not exhaustive visual equivalence across every GPU, scene, resolution or timestamp implementation. The native harness initially compared an in-memory `undefined` property against an omitted JSON property; normalizing serialization fixed that assertion, and the persisted command records independently matched without repeating the GPU run.

## Automated checks

The final aggregate suite passes 2,249 tests across 190 files. Strict TypeScript checking and the production build pass. Focused coverage includes timer ring saturation, mapping errors, written masks, quantized zero, listener exceptions, source-frame admission, warmup, out-of-order/duplicate samples, capture exclusion, drain timeout/late callbacks, loss and replacement generations, unsupported queries and preexisting/asynchronous renderer errors. Two independent read-only reviews found no remaining correctness blocker. Browser UI interaction and physical-GPU throughput were not exercised here.

## Reproduction

`tools/test-gpu-timestamp-capability.mjs` checks feature availability and real timestamp readback. `tools/test-gpu-profile-renderer.mjs` checks baseline, normal and profile renderer modes using a bundled renderer. Both accept `WEBGPU_MODULE` pointing to an optional official `webgpu` runtime; the application has no new runtime dependency. The archive includes exact logs, JSON results, image/atlas readbacks and bundle fingerprints.

Use a fresh checkout for recovery. Do not overwrite an existing working tree with uncommitted changes. No remote push, merge or deployment of the simulator is included.
