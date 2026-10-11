# Backlog

Open items only, one line each: what, owner, and the check that proves it done. Owners are areas (see the map in [AGENTS.md](AGENTS.md));
**Nick** marks a decision or a run left for the developer. What landed and why: [docs/history/2026-10-session.md](docs/history/2026-10-session.md).
Rules for every render change: A/B with clouds off, interleaved rounds, and a real GPU render for any WGSL edit.

## AI pilots and training

- [ ] Hard-track campaign, after the tree layout is final: delete `.bench/brain/bundle/FROZEN`, regenerate the hard track files, re-score hard31s-c, restart the loop at lr 5e-5 (brains). Check: every training track 12/16 clean or better; the final brain is picked by its held-out score.
- [ ] Find why held-out scores fall while training scores rise on the new tree layout (hard31n-a 7/80, hard31n-b 8/80 against hard31s-c 27/80) (brains). Check: a chunk that raises training clean flights without lowering held-out.
- [ ] Speed polish on the hard tracks without losing reliability, then final scores on training and held-out tracks (brains). Check: faster mean lap at the same clean count.
- [ ] Retrain the published roster with obstacle sensing, the progress-reward fix and the game's spawns, on the new styles; eval on split-S tracks (Nick). Check: `node tools/brain/eval.mjs` finishes every unseen track, mean finish no slower than the current ace.
- [ ] Train a theme park brain for real with the Theme park racing template, 30+ min, when the GPU is free (Nick). Check: finishes 2 laps of the race course on 3 park seeds in the CPU sim.
- [ ] Train with the dashboard templates and compare lap time and smoothness against Balanced (Nick). Check: Compare brains report for each template.
- [ ] Bridges: decide between more headroom under bridges (track change, keeps brains) and a level ray row (new sensing layout, every brain retrained) (Nick). Check: a decision recorded here, then 0 bridge hits on the 4 industrial eval tracks.
- [ ] Park racing verify: full vitest, `npm run brain:check`, build, every-route sweep (brains). Check: all pass.
- [ ] Cross-unit review of the crazy-tracks work (track gen, meshes and colliders, trainer, dashboard, builder) (brains). Check: review notes with each finding fixed or filed here.
- [ ] Browser check of the builder 3D view, Fly it and the new gate and obstacle meshes (brains). Check: `node tools/audit/shot-gpu.mjs "http://localhost:5173/?mode=builder" .bench/audit/builder.png` with no console errors, and the screenshots looked at.

## Trees

- [ ] Night clouds flat black and smooth (trees). Check: night render with clouds on shows lit edges and texture.
- [ ] Forest floor too bright: the canopy barely shades the sun (trees with terrain). Check: `tools/audit/metrics.py` interior view p50 within the photo's range.
- [ ] Aerial forest reads as identical broccoli (trees, far LOD; terrain for bare beige far hills). Check: audit distant and flyover views beside their photos.
- [ ] Trunks too pale and uniform, no dead wood (trees). Check: bark close-up sheets against the conifer and forest-interior photos.
- [ ] Dark crowns: baked crown AO double counted with RT GI; crown interiors about 2 stops bright (trees). Check: audit-4 dark-pixel term split (`tools/audit/termsplit.py`) on the forest views.
- [ ] Forest local contrast about half the photos' (trees for crown structure, leaves for self-shadow). Check: local contrast within 20 % of the photos on the forest views.
- [ ] canopyShadowFit plain-LOD cache, for extreme start-up (trees). Check: warm extreme start at or under 15 s.
- [ ] Camera-following RT proxies at EXTREME (trees). Check: shadows and GI from trees beyond the 300 nearest the start in an extreme render.

## Foliage

- [ ] Leaf spec and back-face ambient lift the crown shadows; partly done (leaves). Check: `tools/audit/termsplit.py` on views edge, interior, lone and oak-lone at 07:00, 12:00 and 18:48, ultra, clouds off: darkest 5 % at least 4 stops under the frame median on every view (now oak-lone 3.8-4.6, edge 2.6-4.8, interior 2.4-3.0, lone 1.9-3.6).
- [ ] Photo-referenced spruce crown; partly done (leaves). Check: `.bench/leaves/skyfrac.py` on the spruce-10m view: sky inside the crown silhouette 4-9 % (photos spruce-tree/3.jpg and 7.jpg; 7.jpg is only in `.bench/audit/refs`). Was 37 %, about 13 % on the CPU probe, render pending.
- [ ] Scots pine crown density, waiting on the trees' pinePlan secondary branches (leaves). Check: the same skyfrac check on pine-10m, 7-13 % (photos pine-crown/9.jpg and 4.jpg); now about 40 %.
- [ ] Photo-referenced broadleaf crowns (leaves). Check: skyfrac on oak-20m and birch-20m within 5 points of the oak-crown photos.
- [ ] Backlit leaf transmission (leaves). Check: the oak-lone view against the sun shows yellow-green transmitted leaves, with only deep layered regions dark; beside oak-crown/0.jpg and 3.jpg, outer backlit leaf hue 70-90 degrees and luma above the crown median.
- [ ] Foliage reads as flat stamped cards with hard edges at 10-20 m (leaves). Check: `tools/audit/metrics.py` forest local contrast at least 0.8 (photos 0.84-1.38, now 0.45-0.64), and a fly-through mp4 with no stair-stepped card outlines.
- [ ] Leaf self-shadow (leaves, with trees for crown structure). Check: metrics.py local contrast on oak about 1.08 (now 0.45-0.51) and on conifers about 1.38 (now about 0.6).

## Terrain and sky

- [ ] Forest floor too bright, green and patchy (terrain). Check: forest-interior view beside its photo.
- [ ] Clouds flat with worm shapes, flat orange at 18:48 (terrain). Check: noon and 18:48 cloud renders beside the golden-hour photo.
- [ ] Ultra near-cloud softness in motion (half-res march or history) (terrain). Check: flight clip at ultra with no smeared cloud edges.
- [ ] Track corridor blue-white speckle at 18:48 (terrain). Check: hard-210-t2 corridor render at 18:48 with no speckle.
- [ ] 3D understorey in the ground-cover instancing: ferns, bracken, bramble, seedlings, sticks, moss, no colliders (terrain). Check: forest-floor render; colliders unchanged.
- [ ] Backlit cliff mottle, landed but unconfirmed in motion (terrain). Check: flight clip past a backlit cliff.
- [ ] Rock domes look like putty at 5-20 m (terrain). Check: rock view at 5, 10 and 20 m against the rocks-cliff photos.

## Lighting and camera

- [ ] Golden hour saturation, after the crown shadow fix (extreme). Check: audit golden-hour saturation within the photo's.
- [ ] Dark-dominated frames over-exposed (shade trim), after the crown shadow fix (extreme). Check: interior view p50 within the photo's.
- [ ] Moonlit forest near-black at extreme (extreme). Check: night extreme render with readable trunks and ground.
- [ ] Gates and props weathered and concrete redone; track ground wear waits on terrain (extreme). Check: gate close-up render beside the race-gate photos.
- [ ] Ultra performance against HEAD in the browser (extreme). Check: `tools/audit/perf-ab.mjs` then `perf-summary.py`, ultra no slower than HEAD.

## Build and render speed

- [ ] Async pipeline creation, kept only if faster (speedup). Check: cold start time against the synchronous build.
- [ ] Dawn `use_dxc`, kept only if faster and pixel-identical (speedup). Check: shot timing and a raw frame diff.
- [ ] Persistent pipeline cache: feasibility report only (speedup). Check: a written finding.
- [ ] Theme park is CPU-bound (ultra 37-49 fps, high 19.6 fps, ready 34-42 s); deferred by Nick on 2026-10-11 (Nick). Check: a decision to start.

## Theme park

- [ ] Mega park over the ray-tracing primitive budget: 136,591 against 131,072 (park). Check: primitive count under the budget for mega seeds.
- [ ] Space coaster show building built across its own station and queue; `furniturePlacement.test.ts` fails at 1337 destination (park). Check: that test passes.
- [ ] `validation.test.ts`: coaster segment check fails; "every attraction repeatedly" takes 243 s against its 120 s limit (park). Check: the file passes alone.
- [ ] rideConnections: 18-27 rail-tie welds per seed lost their rail after the knuckle change (park). Check: `rideConnections.test.ts` with 0 lost welds.
- [ ] Hyper coupler: drawbar end 1 mm outside its socket ball at an angle (park). Check: construction audit 0 findings for hyper trains.
- [ ] Paving pads against paving gables, 89 per round ride at 100 mm (park). Check: construction audit 0 paving findings.
- [ ] Coaster station stairs: 0.2 m risers, 70 mm grip, 1.1 m rail; use the shared stair rule (park). Check: `stairs.test.ts` covers coaster stations.
- [ ] Motion audit past dispatch (park). Check: motion audit run through a full ride cycle with 0 findings.
- [ ] Unconfirmed whether fixed by later work: weldedTube bends standing proud (teacups, Enterprise), rideSeat wider than the Top Spin row pitch, carousel horses floating (park). Check: rerun the construction audit and close or reopen each.
- [ ] Walk-to-sit foot jump of 0.44 m and carousel straddle pose (park, approved). Check: guest tests and a render.
- [ ] Child leg proportions (no measured source yet); planted foot with no heel-to-toe roll (needs a visual check) (park). Check: a source cited and a render.
- [ ] Confirm figures taken from search summaries: Strathprints stride rates, head-to-height fractions, CDC average height for women (park). Check: primary sources cited.
- [ ] Reference research for coasters, structures and materials (park). Check: entries in `docs/park-construction-sources.md`.
- [ ] Per-family review with contracts declared at the call sites; after renders, gallery, coverage inventory, docs (park). Check: `docs/park-construction.md` coverage table up to date.
- [ ] Final park checks: tsc, park and render park tests, realismBuildings and theme, build, 240 s motion audit of the 11 flat families, several seeds and sizes, joint ledger, gallery (park). Check: all pass.

## Repo and tooling

- [ ] Tree-shots and the render server still default to `.bench/trees/views.json`; default them to `tools/views/trees.json` (speedup, owns render-core). Check: a fresh clone renders the same views without `--views`.
- [ ] Promote the hard-track campaign scripts (`.bench/hard-track/loop.mjs`, `score.mjs`, `gen.mjs`, `scan.mjs`, `scout.mjs`) and the track lists into `tools/` when the campaign ends (brains). Check: `node --check` and a dry run from the repo root.
- [ ] `npm run stars` calls `python3` with a bash-style `$HYG_CSV`, which fails on Windows (anyone). Check: the script runs under PowerShell and Git Bash.
- [ ] Commit the session's work in the chunks proposed in the handover report (Nick). Check: `git status` clean apart from ignored files.
