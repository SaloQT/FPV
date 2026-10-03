# Exact-preserving performance changes

Baseline: `4f56d904aa2b46acafcab4238d423e2fc6934940` from https://github.com/SaloQT/FPV.

The optimizations do not lower resolution, change quality presets, edit shader source, reduce ray/denoiser samples, alter draw distances, change physics rates/iterations, or change simulation arithmetic. They remove redundant work:

- The RT exposure-history latch dispatches one scalar writer, rather than one per RT workgroup. Its existing WGSL and order are unchanged.
- Track gate-state buffers are uploaded only when the packed float32 values differ. Time/cloth uniforms remain updated every frame; new buffers always get an initial upload.
- RPM notch coefficients are calculated once and copied between axes. Each axis retains independent delay state.
- Dense static collider lists cache a conservative ordered candidate list per 8 m query cell. Each step still runs the original exact reach test and contact solver; original ordering and the 32-near-box limit are preserved. Replacing colliders invalidates the cache. Small lists and unusual coordinates retain the linear scan. A collider set also falls back to the original scan if a cache rebuild retains at least half its boxes or the exact 32-near-box list saturates, avoiding repeated expensive rebuilds in heavily overlapping scenes. This conservative fallback resets when colliders are replaced.
- The immutable terrain sampler caches the four vertex normals of its last queried cell, retaining float64 precision and the original interpolation.

## Verify

```
npm ci
npm test
npm run build
```

The added tests cover RT command order, first-frame/scene-replacement gate uploads, flashes and rewind, exact notch-filter outputs, and terrain cell/border transitions. Original performance tests now actually arm the quad at zero throttle before applying flight throttle.

## Repeatable CPU comparison

Requires Node 24 or newer for its TypeScript loader; no extra benchmark dependencies are needed. From this repository:

```
git worktree add --detach ../fpv-baseline 4f56d904aa2b46acafcab4238d423e2fc6934940
node tools/perf-compare.mjs --baseline ../fpv-baseline --out ../cpu-comparison.json
```

Both source trees must be clean. The harness first compares every public QuadState output over seeded flight and ground scenarios, with and without 1,024 static obstacles, plus 20,000 terrain normal queries. It then warms each path and records twelve alternating-order timing trials. Medians and all individual samples are reported. Ground tests use an immutable nonflat terrain field; dense tests use a fixed distributed 1,024-box scene. An adversarial 6,000-overlapping-box test alternates across a cell boundary every collision resolve to expose cache-rebuild regressions. These are synthetic CPU workloads, not full-frame rendering benchmarks. Full internal FC/IMU state is not compared by this harness; targeted filter tests separately compare exact filtering results.

## Hardware FPS and visual verification

Actual before/after FPS and GPU visual equivalence require a working WebGPU browser on the same hardware. Do not interpret software-WebGPU performance or isolated CPU speedups as a game FPS increase. Hold output size, quality, scale, dynamic-resolution setting, seed, hour, camera, and scenario fixed. Example (run separately in each checkout):

```
CHROME_BIN=/path/to/chrome node tools/bench.mjs --gpu --uncapped --seconds 30 --warmup 10 --size 1920x1080 --query "seed=7&t=12&quality=high&scale=1&dyn=0&perf240=0&cap=0&autostart=1&scenario=hover" --out bench.json
```

Also compare noon, twilight, and night captures with fixed `hold=1`, `fixeddt=0.016666666666666666` and `advance` counts, testing camera changes, gate flashes, scene replacement, resize, and temporal exposure transitions. Do not enable adaptive quality as a performance shortcut. Run several alternating baseline/optimized trials and retain adapter, render dimensions, errors, frame times, and per-pass times.

Cloud validation cannot establish visual parity or GPU FPS when Chromium/WebGPU is blocked or no hardware adapter exists. In that case the delivery report must state the limit explicitly.
