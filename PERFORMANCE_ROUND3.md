# Performance round 3

Incremental baseline: `562768c8f1fcdfec2fbebb1d174e1fcfd8aa93aa` (round 2).
Original upstream: `4f56d904aa2b46acafcab4238d423e2fc6934940`.

Water-mask queries now use an exact summed-area table of the existing Float32 block-minimum `< waterLevel` decisions. Every query uses the same inclusive block bounds, mirrored extension and far-water decision. This avoids repeatedly scanning dry blocks during moving-camera tile churn. No terrain geometry, culling boundary, shader, quality setting or sample count changes.

A contact-solver invariant-cache candidate passed differential tests but was rejected for lack of repeatable useful performance gains. It is not in the shipped source.

## Reproduce

```
npm ci
npm test
npm run build
git worktree add --detach ../fpv-round3-baseline 562768c8f1fcdfec2fbebb1d174e1fcfd8aa93aa
node tools/perf-terrain-compare.mjs --baseline ../fpv-round3-baseline --out ../round3-terrain-incremental.json
node tools/perf-compare.mjs --baseline ../fpv-round3-baseline --out ../round3-physics-incremental.json
```

For cumulative comparison, point those tools at a clean original-upstream checkout. Node 24+ is required. The terrain comparison loads each checkout's actual Clipmap, WaterMask and TilePayload; only pre-cache upstream checkouts use frozen original packing loops. It first checks 10,000 exact active GPU-payload frames, then performs alternating timed trials. This is CPU submission preparation, not hardware FPS.

The older `perf-terrain-payload.mjs` isolates payload caching with the CURRENT water-query algorithm on both arms. Its frozen-packing reference is not a full previous-release comparison; use `perf-terrain-compare.mjs` for that.

See the release report for samples, workload units, unchanged/slower cases, constructor/memory costs and GPU verification status. A successful offline software-WebGPU smoke test does not establish complete FPV visual parity or hardware performance.
