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
- **Clouds**: overhead base dark, textured and ragged; horizon step slices and the 18:48 flat peach slab fixed. Second pass: the worm
  shapes and flat cotton bodies became separate convective cells with cauliflower tops and lumpy bases.
- **Terrain, final pass**: the blue-white speckle along the track corridor at 18:48 is gone (stream-bed grass thinned, the sward floor
  applies under every blade); a 3D understorey of ferns, herbs and sticks (visual only, no colliders); backlit cliff mottle eased (still
  to be checked in motion); far grass colour matched to the photos. Design note: [terrain-sky.md](../terrain-sky.md).
- **Exposure and colour**: lifted blacks at low sun traced to crown-interior GI and leaf ambient (not aerial perspective or the toe);
  auto white balance now balances golden hour (saturation 0.28-0.35 to 0.39-0.42); exposure key 0.3 kept; cloud sky-light gain wired
  into the RT; GI history resets on time-of-day jumps.
- **Realism audit** (`tools/audit/`): renders matched to 122 licensed reference photos with luma percentiles, saturation, colourfulness
  and local contrast; audit 4 found shadows about 2 stops lifted in crowns and forest local contrast about half the photos'.
- **Real-browser check**: no shader errors in 8 cases (park and track, ultra and extreme, noon and night); night park whiteout fixed.
- **Extreme start**: warm start 14.6-18 s (target 15).
- **Trees, second pass**: aerial forest no longer reads as identical broccoli (per-crown tint jitter, storeys, spires and snags off the
  race line, LOD2 crown clumps); trunks vary in lean and girth, with snags, fallen tops, logs and reshaped surface roots; the baked crown
  AO that was double counted with RT GI is undone where the RT proxies already shade; RT proxies follow the camera at extreme. Plain-LOD canopy spheres come from the disk cache, so a warm start no longer refits them. The canopy march in
  `shadow.wgsl` skips a leaf's own crown, which lifted the backlit fringe leaves from 4.15 to 3.21 stops under the sky (photos 2.06-2.77).
  Mature tree sizes, the reshaped open oak and the Scots pine's needle clumps landed (gameplay effects listed below). The ultra lodScale
  went to 1.0 (-0.35 ms). A forest-floor dapple regression from the widened spruce crowns, drawn as ellipsoids in the canopy shadow map,
  was fixed by drawing them as cones (`canopyShadow.ts`, `forestFloor.ts`).
- **Gameplay change, spruce crowns**: the spruces' crowns widened to the photos' width (reach 0.31 open, 0.22 forest, 0.28 old) and their
  settled layout crowns with them (`variants.ts LAYOUT_CROWNS`), so placement keeps wider spruces clear of gates and obstacles. On the
  1337 world (high and extreme) 4 trees moved and the colliders went 1266 to 1265 (4 boxes removed, 3 added); the nearest moved tree is
  11 m from the racing line. The seed 7 test world is unchanged. Retrain with the other layout changes.
- **Leaves, final pass**: ultra conifers stay clash-free in strong wind; spruce crowns went from 37 % to about 20 % sky at 10 m (ultra)
  and from 41 % to 14 % (extreme), against 9.4 % in the photo; sunlit and backlit leaf colour measured against the oak photos and left
  as it is; no blue clipping in noon grass in flight frames; vegetation tests green. Design note: [foliage.md](../foliage.md).
- **Gates and props**: new materials and weathering; the track ground wear landed in the terrain shader.
- **Ultra performance against HEAD** measured in the browser; the cuts went to trees (tree draw, RT proxies) and terrain (clouds,
  terrain draw).
- **Night clouds** were flat black and smooth. Cutting the cover by threshold left rows of identical domes, so at night the cover now
  clears region by region and the clouds that remain keep their daytime shapes: grey-blue with moonlit rims under a full moon, dark
  silhouettes against the airglow without one. Flicker is 1.3 codes per frame at extreme. Details in
  [lighting-camera.md](../lighting-camera.md#night-clouds).
- **Moonlit forest at extreme** left as it is: still readable, and a real low-light camera is that dark.
- **Golden hour**: white balance keeps a low sun's amber (`whiteBalance.ts` warmRG, warmBG); 18:48 mean saturation 0.46 at ultra over
  6 views (was 0.41). The extreme re-run is still open.
- **Shade trim** left at 0.30: after the crown-shadow fix, 0.30 and 0.45 score the same against the photos (mean |p50 error| 28.2 and
  28.1). Meadow-edge frames render darker than their photos and forest frames brighter, so no metering law wins; the forest gap is the
  crown-interior floor, not exposure.
- **Ultra GPU cost** on track 210-t2 rose from 6.0 ms at HEAD to 8.2-8.45 ms with the art work; trees cut the ultra lodScale (-0.35 ms)
  and the rest is in TASKS.

## Gameplay changes that need retraining

The pilots train on worlds built by the trainer bundle, frozen 2026-10-10 22:30 (`.bench/brain/bundle/FROZEN`) with the tree layout of
that evening. Each change below moves trees, colliders or obstacles after that point, so the hard tracks are regenerated and the
brains re-scored and retrained once retraining resumes (paused until Nick asks). Only the worlds named were measured; others were not.

1. **Tree layout, 2026-10-10** (in the frozen bundle): species and forms placed directly (beech stands, snags, birch clumps, 22
   variants), spacing per variant, up to 4 trunk boxes per stem and 6 per clump. Colliders +17-41 % per track; closest trunk box
   4.61 m from the racing line (was 5.9 m).
2. **Mature tree sizes, 2026-10-11**: oak open 15 to 20 m, forest 17 to 25, veteran 12 to 16; birch 13 to 16, clump 12 to 15, weeping
   14 to 17; beech open 17 to 22, forest 24 to 30. Trunk collider boxes are taller and thicker to match, and crown keep-outs drop a few
   trees near gates. Crown spread in closed stands is visual only (tint alpha): positions and colliders do not change with it. Park
   plantings grow with the new sizes. Test scene: 501 trees near the line, 755 trunk boxes, 840 colliders; closest trunk box 4.61 m from
   the racing line.
3. **Oak changes, 2026-10-11**: the open oak's trunk is thicker (breast-height radius 0.46 to 0.56 m at scale 1) and forks at 3.4-5 m
   into 4-6 heavy limbs, a crown about 25 m across on a 16-17 m top; forest and veteran oaks share the skeleton with their own
   proportions. The trunk-box half-width cap rose from 0.4 to 1.2 m for every species, so any trunk wider than the old cap got a wider
   box. The three oak entries in `variants.ts` LAYOUT_CROWNS were updated. Seed 1337: 99.9 % of plants keep their spot and species, 11
   oaks dropped or moved by the wider gate keep-outs, 22 got a new size; test scene colliders 840 to 835, closest trunk box 4.62 m from
   the racing line.
4. **Park oak colliders**: park trees build their collider rods from the plan's trunk and main limbs (`src/world/park/planting.ts`, up
   to 24 rods per tree), so park oak colliders follow the new trunk and limbs. Park collider counts were not measured.
5. **Wider spruce crowns**: 4 trees moved on the 1337 world (high and extreme), colliders 1266 to 1265; nearest moved tree 11 m from
   the racing line; the seed 7 test world is unchanged. In parks, the default 1337 parks plant no spruce and are byte-identical; space-
   and alpine-themed beds plant spruce scaled to fit the bed, and the open spruce's footprint grew 6.15 to 9.92 m (forest 5.87 to
   8.55), so those spruces come out up to about 35 % shorter with colliders to match (ride-row beds cap an open spruce at 6.8 m, was up
   to 10.3; planters at 4.4 m, was up to 6.3).
6. **Scots pine in parks** (in commit 99a97d6): needle clumps replaced three big clusters per limb, so the pine's park footprint
   (plantingBounds) shrank from 7.15 to 6.21 m radius at scale 1, and park districts pack trees by that footprint. Seed 1337: compact
   park 1118 to 1113 plantings (parts 87835 to 87736), destination park 2073 to 2041 plantings (parts 164494 to 164239). The park race
   track keeps the same path.
7. **Planned, approved by Nick 2026-10-11: rock outcrops as rock-block props with colliders**, chosen over displacing the terrain
   geometry. New solid obstacles on the ground, so the training worlds and the brains' sensing change when it lands.

## Tooling and iteration speed

- `tsgo` (a Rust TypeScript 7 port) measured against the native `tsc`: 10-35 % faster on a 0.5 s check, not worth switching.
- Speed-up plan (`.bench/buildresearch/report.md`): the tree cache key hashed every vegetation file, so any edit rebuilt every tree
  (about 122 s). Landed: a cache key from the import graph (`sourceClosure.ts`), a long-lived render server and client, a persistent
  out-of-process bundler and WGSL hot-swap of the affected pipelines. A shot after a shader edit takes about 1 s instead of 15-40 s
  (`tools/RENDER_SERVER.md`). Dawn already compiles with DXC by default, so `use_dxc` changes nothing; a pipeline cache that lasts
  across processes would need a rebuilt dawn.node, so it is out of scope.
- Final speed-up numbers: a per-species tree cache key took an extreme render after a `grass.ts` edit from 140.9 to 15.8 s, and after
  one species' parameter from 141.0 to 20.0 s. Async pipeline creation for terrain and vegetation took the ultra renderer start from
  10.45 to 7.88 s with matching pixels. In the render server, a TypeScript edit in a render module, the lighting stage or post shoots in
  0.2-0.34 s (about 12 s fresh); vegetation edits take 0.75 s, shader edits 1.2 s, renderer core edits 1.9 s and tree generator edits
  18 s. The full table is in `tools/RENDER_SERVER.md`, "What an edit costs".
- The render server gives the GPU up while another process holds the GPU lock: within 1-3 s its worker drops the renderers, pipeline
  cache and Dawn device (472 MB to 67 MB of GPU memory), and the next shot matches a fresh render exactly.
- The extreme leaf atlas cache went from 224 MB to 25.5 MB, stored deflated (covered by `treeCache.test.ts`).
- `tools/compare/ab-swap.mjs` used to swap files in the shared `src/` for its A side; it now builds the A side as a scratch copy under
  `.bench/ab/` and renders it with the new `tree-shots.mjs --source`, so the working tree is never written to. AGENTS.md now forbids
  swap-based A/Bs and changing the session's folder into a worktree.
- Bench tools promoted from `.bench/` into `tools/audit/`, `tools/compare/`, `tools/lightcast/` and `tools/views/` so a fresh clone has them.
