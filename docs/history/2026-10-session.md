# October 2026 session: what landed and why

A terse changelog of the work done between about 2026-10-07 and 2026-10-11, rebuilt from the old TASKS.md (kept verbatim in
[2026-10-tasks-archive.md](2026-10-tasks-archive.md)). Open work is in
[TASKS.md](../../TASKS.md). Paths under `.bench/` are ignored scratch on the development machine and are not in a clone. The art areas
(trees, foliage, terrain and sky, lighting and camera) have their own design notes in [docs/](..), which hold the detail this file leaves out.

## AI pilots (PPO drone brains)

- **Brain core** (`src/ai`): observation layout, acro-stick actions through the real FC, fixed policy rate, MLP forward, brain file format
  (JSON + base64 float32), BrainPilot (drives a quad's sticks on physics-step boundaries) and BrainRacer (a brain-flown quad with the
  session's arming and respawn rules).
- **GPU trainer** (`tools/brain`): training worlds packed for the GPU; a WGSL transcription of the flight model and FC, proven against
  `QuadPhysics` by `parity.mjs`; env, policy, GAE and PPO update kernels; gradient check against a CPU reference; GPU observations checked
  against the TypeScript `observe`. 1.5M decisions/s (120M physics steps/s) at 16384 drones on the RX 9070 XT.
- **Game**: a brain flies the player's quad (`?brain=`, AI pilots tab), spectator races (`?race=a,b`, up to 32 racers, `name*n` copies that
  sample their own actions), leaderboards, stall rescue. Roster ace, steady, dash, rookie finish 8/8 unseen tracks.
- **Found**: Dawn's GPU instance must stay referenced or the next call segfaults; Dawn loads only D3D12 here (Vulkan fails with error 87);
  Vite's bundler crashes Dawn in the same process, so the trainer bundles in a child process. Six training worlds overfit, so the trainer
  defaults to 48.
- **Crazy tracks and builder**: new gate kinds (split-S, power loop, corkscrew, ladder, dive, slalom, hairpin), crazy styles, obstacle
  objects with colliders; a track builder mode (recipe variables, previews, export, fly, race brains, leaderboards); custom track files
  and the new styles in the trainer's world mix.
- **Training dashboard** (`npm run train`): 12 templates in four goals, run page with KPI tiles, Training/Settings/Compare tabs,
  alerts on GPU errors and stalled episodes, Compare brains on generated courses, "Watch in game" that starts Vite and opens the game.
- **Finish behaviour**: the beeping "crashed" quad after a race was the low-battery alarm on a quad left on a fixed hover throttle. A brain
  now flies on for 4 s and parks on the pad, disarmed; a quad without a brain lands; a finished race never sets off the lost-model beacon.
- **Train and game made to match**: progress reward paid 37/s for flying on past a missed gate (reward hacking). Progress now pays only up
  to 3 m past the gate due next; spawns, stall time (8 s) and world bounds match training; brains let go at a crash and respawn 1.2 s later.
  A probe went from 10 stall respawns to 0.
- **Obstacle sensing** (observation 40 to 99 inputs): 35 range rays over the FPV view and the nearest collider per side, in TypeScript
  (`src/ai/sense.ts`) and WGSL (`sense.wgsl`), checked value by value. Env step 3.3 to about 5.0 ms at 16384 drones. Old 40-input brains
  still load. Chosen because state-only policies fail on obstacle tracks (Sun 2026: 20-30 % vs 100 % with depth).
- **Theme park racing**: race course generator round the rides (`src/world/park/raceCourse.ts`), pilot tracks for tours and coasters,
  box stand-ins for the park's solids and ride sweeps, park worlds in the trainer (`--parks`), Worlds step in the dashboard. Crash respawns
  keep the pack's charge; a flat pack is swapped on the pad.
- **Bridges**: 25 bridge hits on industrial tracks, mostly climbing into deck undersides at 32-44 m/s; the 20-degree ray rows miss a level
  deck 15-25 m out. Decision pending (see TASKS).
- **Hard tracks campaign**: hard recipe (difficulty 1, tunnels, ladders, corkscrews, hairpins, split-S) on ultra terrain; 31 training and
  5 held-out tracks; chunked training loop that resumes from the best brain at lr 1e-4. Best: hard31s-c, 383/496 clean, 23/31 reliable,
  held out 36/80. Training must reach a drained pack (episodes end below `batteryEmptyV`). Paused 2026-10-11 ~13:05 UTC while the tree
  layout changes; the trainer build is frozen (`.bench/brain/bundle/FROZEN`).

## Theme park construction realism

- Native inspection renderer (`tools/park-inspect.mjs`), convex interference core (GJK, certified intrusion depth), interface contracts,
  rule engine and motion audit (`docs/park-construction.md`). Audit fixtures: 108 cases; switching off the end and pair checks fails 45.
- Flat rides rebuilt from manufacturer sources: wheel, ship, tower, rotary family, Top Spin (HUSS patent counterweights), Enterprise
  (boom pivot, deck notch, cabins on hangers), Scrambler (Eli Bridge bulletins, 12 cars), teacups (Disney patent: 3 turntables, 2 cups
  each), carousel (Tilden Park manual: hung from the top bearing, jumper poles at the withers, 10 in rise at 4 1/3 bobs per turn).
- Shared rules: legs cast in footings, stair flights to ADA 2010 (7 in risers, rail 0.9 m), furniture clearance, metalness 0 for
  non-metals, lights from glowing fittings that match them (`luminaire()`).
- Riders sit on the seats that were built (`riderSeats.test.ts`); guests realism (seated sink, bell-curve heights, stride rate).
- Generation went 6 s to 67 s from an exact leaf-versus-solid test; now 11-13 s by testing only solids whose box holds the point.
- 4K60 park tour and seed-orbit videos (`tools/park-tour.mjs`, `tools/park-seed-orbit.mjs`).

## Rendering and art (2026-10-10 to 2026-10-11)

- **Night gate LEDs**: emissive strips were added at full physical brightness; at night exposure the active gate whited out the screen.
  `emissiveShown()` in `deferred.wgsl` caps emissive display level like the glow ribbons; frames over 2.5x median luma 73 to 0.
- **EXTREME tier**: menu, `?quality=extreme`, saved settings and tools; builds Ultra's world exactly, so gameplay is identical.
- **Leaves**: varied leaf shapes and colours, backlit glow, pine brushes, spruce drooping branchlets, 1024 atlas at extreme; night tree
  edges no longer glow (per-sample sky darkening in TAA and motion blur).
- **Trees**: per-species bark (scans in `public/textures/bark`), root flare, 22 variants (beech stands, snags, birch clumps), up to 4 trunk
  boxes per stem, far LOD to 4 km at extreme, crown self-shading. This changed gameplay colliders (+17-41 % per track), so the brains are
  retrained after the layout settles.
- **Terrain**: new ground materials, rock, grass colour and wind, wet-gravel sparkle fix, extreme grass to 600 m, horizon band fixed at
  the source; jointed bedrock, scree aprons, stream-bed patchwork; forest floor with canopy tint, herbs, humus and trunk-foot AO; track
  corridor wear (`trackWear` in `terrain.wgsl`); lone-tree blob shadows fixed by capping the a-trous shadow blur to the penumbra.
- **Clouds**: overhead base dark, textured and ragged; horizon step slices and the 18:48 flat peach slab fixed.
- **Exposure and colour**: lifted blacks at low sun traced to crown-interior GI and leaf ambient (not aerial perspective or the toe);
  auto white balance now balances golden hour (saturation 0.28-0.35 to 0.39-0.42); exposure key 0.3 kept; cloud sky-light gain wired
  into the RT; GI history resets on time-of-day jumps.
- **Realism audit** (`tools/audit/`): renders matched to 122 licensed reference photos with luma percentiles, saturation, colourfulness
  and local contrast; audit 4 found shadows about 2 stops lifted in crowns and forest local contrast about half the photos'.
- **Real-browser check**: no shader errors in 8 cases (park and track, ultra and extreme, noon and night); night park whiteout fixed.
- **Extreme start**: warm start 14.6-18 s (target 15).

## Tooling and iteration speed

- `tsgo` (a Rust TypeScript 7 port) measured against the native `tsc`: 10-35 % faster on a 0.5 s check, not worth switching.
- Speed-up plan (`.bench/buildresearch/report.md`): the tree cache key hashed every vegetation file, so any edit rebuilt every tree
  (about 122 s). Landed: a cache key from the import graph (`sourceClosure.ts`), a long-lived render server and client, a persistent
  out-of-process bundler and WGSL hot-swap of the affected pipelines. A shot after a shader edit takes about 1 s instead of 15-40 s
  (`tools/RENDER_SERVER.md`).
- Bench tools promoted from `.bench/` into `tools/audit/`, `tools/compare/`, `tools/lightcast/` and `tools/views/` so a fresh clone has them.
