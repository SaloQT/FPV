# Performance round 2

Incremental baseline: `8f2e342c60370151af45840569678d21aadfbd78` (the delivered first round).
Original upstream baseline: `4f56d904aa2b46acafcab4238d423e2fc6934940`.

This round removes more redundant CPU work and uploads without changing shader source, quality settings, render resolution, draw distances, simulation rates, solver iterations, or contact limits.

- Collision gathering stops obstacle narrowphase once its existing 64-contact list is full. The same first 64 contacts are retained; terrain sampler calls still execute in their original order.
- The terrain renderer still rebuilds/frustum-culls the clipmap every frame. Identical packed tile lists can reuse their exact water suffix and skip redundant buffer uploads. Scene/buffer and water-query inputs invalidate the cache; animated uniforms continue updating.
- Planet instances are repacked each frame to observe mutable input, then compared bitwise with the uploaded payload. Identical uploads are skipped; changed data, signed zero, counts and initialization are preserved. Star magnitude selection retains its original calculation.

A combined motor-bus calculation was tested and rejected: exactness passed but repeated full-simulation timing showed no reliable benefit. It is not part of the shipped source.

## Verify and compare

```
npm ci
npm test
npm run build
git worktree add --detach ../fpv-round2-baseline 8f2e342c60370151af45840569678d21aadfbd78
node tools/perf-compare.mjs --baseline ../fpv-round2-baseline --out ../round2-incremental.json
git worktree add --detach ../fpv-original-baseline 4f56d904aa2b46acafcab4238d423e2fc6934940
node tools/perf-compare.mjs --baseline ../fpv-original-baseline --out ../round2-cumulative.json
node tools/perf-terrain-payload.mjs ../round2-terrain.json
```

Node 24 or newer is needed by the comparison harness. Both compared source trees must be clean. CPU results are synthetic workloads with every sample retained, not game FPS. GPU payload/command tests are mocked and do not establish rendered-pixel equivalence. The separate delivery report records exact source commits, measurements and verification limits. See PERFORMANCE.md for hardware benchmark commands.
