# PPO drone brains

Goal: train a neural pilot with PPO on this game's own flight model, headless on the GPU (AMD RX 9070 XT via Dawn), then load a
trained brain into the player's drone or watch several brains race in a spectator mode.

Rules: the flight model in `src/sim` is not changed. The GPU trainer runs a WGSL transcription of it, proven against the
TypeScript model by a parity test. The brain always flies the real TypeScript model in the game.

## Shared brain core (`src/ai`)
- [x] Brain spec: observation layout, action mapping (acro sticks through the real FC), fixed policy rate, physics rate
- [x] Observation builder in TS (runtime) with the same maths as the WGSL one
- [x] MLP policy forward in TS, brain file format (JSON + base64 float32), load/validate
- [x] BrainPilot: drives a quad's sticks at the fixed policy rate on physics-step boundaries
- [x] BrainRacer: a brain-flown QuadPhysics with the session's arming and respawn rules (rivals, eval)

## GPU trainer (headless, `tools/brain`)
- [x] Training worlds: terrain, PadGround, track, track + vegetation colliders, packed for the GPU (heights, boxes, grid)
- [x] WGSL flight model: rigid body, motors, props, battery, IMU, wind, FC (Mahony, RPM filter, PT1s, rates, PID, mixer), contacts
- [x] Parity test: GPU model vs `QuadPhysics` on scripted stick sequences (`node tools/brain/parity.mjs`)
- [x] Env kernel: K substeps per action, gates, reward, termination, resets, observations, all resident on the GPU
- [x] Policy kernels: tiled matmul forward, sampling, value
- [x] GAE kernel, advantage normalisation
- [x] PPO update kernels: loss, backward (tanh MLP), split-K weight gradients, grad-norm clip, Adam
- [x] Gradient check against a CPU reference (`node tools/brain/gradcheck.mjs`)
- [x] GPU observation vs TS `observe` check (`node tools/brain/obscheck.mjs`)
- [x] Trainer host: iteration loop, metrics readback only, checkpoints into `public/brains`
- [x] Evaluation in the real TS sim on unseen tracks (`node tools/brain/eval.mjs`)
- [x] Throughput: 1.5M decisions/s = 120M physics steps/s at 16384 drones

## Game integration
- [x] Session pilot hook (brain flies the player's quad, arms after GO, always respawns)
- [x] Load a brain into the player's drone (AI pilots tab, file load, `?brain=`) and watch it fly
- [x] Spectator mode: race several brains on the same track (`?race=a,b`), N drones rendered, follow camera, leaderboard
- [x] Train the race roster into `public/brains`: ace, steady, dash, rookie (all finish 8/8 unseen tracks in the TS sim; mean finish 35.9 / 40.9 / 51.2 / 55.0 s)
- [x] Tests, typecheck
- [x] Build
- [x] Stall rescue: a brain with no gate for 15 s goes back to its last gate (racers and the player quad)
- [x] README section, npm scripts brain:train/eval/publish/check
- [ ] Screenshots: blocked, CloakBrowser's Chromium has no dxil.dll so WebGPU cannot start in it

## Found
- Dawn (npm `webgpu` 0.6.2): the GPU instance returned by `create()` must stay referenced, or the next GPU call segfaults.
- Dawn cannot load Vulkan on this machine (`vulkan-1.dll` LoadLibrary error 87); the trainer runs on D3D12.
- Vite's bundler loaded in the same process as Dawn crashed it too; the trainer bundles in a child process.
- CloakBrowser's Chromium 146 build ships without dxil.dll/dxcompiler.dll; Dawn D3D12 fails at requestDevice (error 87). Launching it with `--disable-dawn-features=use_dxc` should make Dawn fall back to FXC.
- run1 (20 min, 1.7B decisions, 6 worlds) finishes all 4 unseen eval tracks in the TS sim (22 crashes). 15 more minutes on the same 6 worlds (first ace) got better training numbers but 68 crashes on unseen tracks: overfitting. On 48 fresh worlds run1 crashes in 62-67% of episodes vs 30% on its own. The trainer now defaults to 48 worlds; the roster retrains on 48.

# Crazy tracks, live training dashboard, track builder

Goal: more gate types (split-S and friends), crazy tracks and new objects, all flyable by the GPU trainer; a live training
dashboard (scrubbing, interactive charts, top-down view) at no real cost to throughput; a separate track builder mode with
variables whose tracks drones can fly and race on, with leaderboards.

- [x] Map the subsystems (track generator, render/colliders, trainer, app/UI): .bench/maps/*.json
- [x] Shared contracts: gate kinds, obstacle kinds, track recipe, styles (src/contracts.ts, .bench/plan/CONTRACTS.md)
- [x] Implementation workflow running: units A track gen, B meshes/colliders, C trainer, D dashboard, E builder (each reviewed + fixed)
- [x] New gate kinds + meshes + colliders + GPU shape support
- [x] Manoeuvre features (split-S, power loop, corkscrew, ladder, dive, slalom, hairpin) and crazy styles in the generator
- [x] New obstacle objects (meshes + box colliders)
- [x] Live training dashboard (server in train.mjs, trajectory ring buffer on the GPU, charts, scrubbing, top-down)
- [x] Track builder mode (recipe variables, previews, save/export, fly, race brains, leaderboards)
- [x] Trainer: custom track files, new styles in the world mix
- [ ] Retrain the roster on the new tracks; eval on split-S tracks
- [x] Integration: typecheck, 2630 vitest + 32 dashboard tests, build, brain:check, 1-minute train run with the dashboard
- [ ] Cross-unit review pass
- [ ] Not checked in a browser: builder 3D view, Fly it, the new meshes (CloakBrowser WebGPU fails with dxil.dll error 87)
- [ ] Throughput note: 1.5M decisions/s is the long-run figure on the classic 4 styles; a fresh 1-min run gives 1.27-1.30M, the new default mix about 1.02-1.07M (heavier worlds). Dashboard + path reward cost under 1 %.
