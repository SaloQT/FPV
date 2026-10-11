# Terrain and sky: ground, grass, flowers, understorey, clouds

Design note for the ground side of the world: the layered ground material, rock, the forest floor and understorey, the worn race path,
grass and flowers, clouds and their shadows, and the sun-shadow denoiser fix. Paths are relative to the repo root. "Ultra" and "extreme"
are quality tiers. Everything here is visual only: terrain heights, vegetation placement and colliders come from `src/world/terrain/` and
`src/render/vegetation/placement.ts` and are untouched, unless a section says otherwise.

## Rules that apply to everything below

- Prove every WGSL edit with a real GPU render. The vitest suites read shader text; they do not compile WGSL. A shader that fails to parse
  breaks every agent's renders, so keep the shared checkout compiling between edits.
- Compare with clouds off (`--atmos '{"cloudsEnabled":false}'`). A cloud shadow over a view changes it more than most ground edits do.
- Build the "before" side from a copy (`cp -r src package.json tsconfig.json .bench/x-src/`, then `--source .bench/x-src`). Never swap
  files in the main folder for an A/B.
- One GPU lock (`~/.fpv-native-bench/gpu.lock`, `tools/native-bench/lock.mjs`). Remove it only if its PID is dead.
- Scripted edits in Python on this Windows machine: open with `newline=''`. Text mode writes CRLF, and several tests slice shader source on
  `'\n}\n'` (`groundShaders.test.ts fnBody`), so a CRLF file fails them.
- WGSL: a local named `floor` (or any builtin) shadows the builtin and breaks the whole module ("cannot use 'var floor' as call target").

## Tools

- `node tools/terrain-shots.mjs --out <dir> --quality ultra --width 1600 --time 0 --views rock,stream,trees,meadow,fpv8m,aerial
  --atmos '{"cloudsEnabled":false}' [--hour 18.8] [--source <copy>] [--views-file <json>] [--track <track.json>] [--debug 3]`
  - Views come from the terrain's own maps (meadow, rock, rockClose, stream, trees, boulder, fpv8m, aerial, aerialDown).
  - `--views-file .bench/terrain/cloud-views.json` adds cloudUp (looking up at 1.3 km bases) and cloudHorizon.
  - `--track .bench/hard-track/hard-210-t2.json` renders that track's world and adds views along the racing line (track-N, trackHigh-N).
  - `--time 60` measures GPU ms per pass. The "pre" pass holds the clouds and the grass cull.
  - `--debug 3` shows layer weights, `--debug 6` the flow map.
  - Each view starts from the same clock (time 10 s), so the cloud field is the same on every run. Before that fix, clouds differed
    between runs and could not be A/B'd. That fix is not yet confirmed on the GPU; `.bench/lightcast/measure.mjs --clouds` is deterministic.
- `.bench/terrain/sheet.py out.png ref,before,after ...`: reference | before | after, with the audit metrics (luma p5/p50/p95, saturation,
  colourfulness, local contrast) under each tile. Sheets are full RGB. Sky bands seen in a preview of a sheet or still come from the
  viewer's compression: a 300 px sky column of the PNG holds 120-250 distinct colours.
- Audit: `tools/audit/metrics.py`, `termsplit.py`, `modcost.mjs` (GPU ms per module), photos in `tools/audit/refs/`.
- Fast iteration: `tools/shot-client.mjs --mode terrain` (see `tools/RENDER_SERVER.md`). It doesn't cover `--track` or `--debug`.
- Set `FPV_TREE_CACHE_DIR` to a folder of your own when rendering, or you evict other agents' tree caches.

## Ground layers and palette

Files: `src/render/shaders/terrain/ground_palette.wgsl` (ids, albedos, roughness), `ground_color.wgsl` (weights, macro colour),
`terrain.wgsl` (G-buffer fragment), `detail_gen.wgsl` (one-off bake of 512² detail arrays), `detail_sample.wgsl` (hex tiling, projections).

- 14 layers: 8 base layers (grass, hay, dirt, gravel, rock, sand, snow, loam), which grass placement also reads, refined by
  `terrainMaterialWeights` into moss, litter, needles, mud, cracked earth and scree, for the terrain shader only. Keep
  `terrainLayerWeightsDry` unchanged unless the grass cull should change too; a test pins that grass is placed by the base weights.
- Albedos are measured broadband reflectances (palette header): living grass 0.10-0.14, soil 0.10-0.18, rock 0.15-0.25, litter about 0.10,
  needles 0.08, moss 0.05-0.08. Bare soil reads grey-brown (`glBaseColor(GL_DIRT)` 0.135/0.112/0.088, varied over metres by `case 2` of
  `layerMacroColorDry`); a test keeps red under 1.5x green.
- Grass tints `GL_GRASS_LUSH/YELLOW/CLOVER/RUSSET/DRY` sit at hue 70-75 and saturation about 0.5, matching midday meadow photos. A
  russet/olive cast a few metres across keeps meadows from being one green. `groundVigour` varies the field over hundreds of metres.
- Detail textures: each layer is hex-tiled at its own tile (`dsLayerTile`), plus a 7.13x "macro" lookup. Layers made of pieces (gravel,
  rock, cracked, scree) keep the macro faint (`mk` 0.35), because scaled up 7x their stones become 1-10 m cobbles and crazy paving.
- Stream beds (`streamBed`): narrow drainage lines are bed across their width; broad saturated floodplains become braided channels.
  Beds are a patchwork of coarse and fine stone, sand bars and silt drapes. A damp gravel bed drains: it is darker but has no water film
  (`terrain.wgsl` wet handling).

## Rock

Files: `terrain.wgsl` (`rockFace`, `rockRelief`, `rockRunnels`), `ground_color.wgsl` (`case 4`, scree), `detail_gen.wgsl surfRock`.

- `rockRelief`: 3-15 m swells and hollows (`ROCK_RELIEF_FREQ` 0.09, `ROCK_RELIEF_M` 2.6). It is a world-space height field on the three
  axis planes, blended by the normal. A field in the face's own tangent frame slides as the frame turns across a dome and drew zebra
  stripes. Its normal (`shapeN`) is treated as shape: grazing-light easing pulls fine detail toward `shapeN`, not toward the flat normal.
- `rockFace`: beds 1.1-2.4 m thick, each with its own tone (strata), cut by two wavy vertical joint sets 2-9 m apart into staggered blocks.
  Blocks get gentle facet tilts, some stand proud as ledges on steep faces, and only some stretches of each joint are open cracks. It
  replaced hard-stepped ledge strips that read as rectangles.
- Grazing or back light: detail normals ease toward `shapeN` (`graze` in `terrain.wgsl`), which removed a lit/unlit speckle on backlit
  cliffs.
- Scree is aprons and tongues tens of metres across (`apron` in `terrainMaterialWeights`), not whole hillsides.
- Limit: domes are smooth in the heightfield and stay smooth in silhouette. See open work.

## Forest floor and understorey

Files: `ground_color.wgsl` (litter, herbs, humus, moss), `ground_palette.wgsl GL_CANOPY_LIGHT`, `terrain.wgsl` (`groundCoverAt`,
`trunkFoot`), `src/render/terrain/groundCover.ts` (cover grid), `src/render/vegetation/forestFloor.ts` (publishes it),
`src/render/shaders/vegetation/grass_cull.wgsl floorPlant`, `grass.wgsl` (fern, herb and stick drawing).

- Cover grid (1024², rgba8): r = canopy cover, g = conifer share, b = forest-ness (mean cover over about 35 m), a = distance to the racing
  line (see worn paths). Litter forms where cover and forest-ness are high, so a lone tree keeps its grass.
- `GL_CANOPY_LIGHT` (0.96, 1.0, 0.78) tints albedo under crowns, standing in for green canopy-filtered skylight. It was (1.08, 1.0, 0.5),
  which cut half the blue and turned brown litter orange; that was the "orange forest floor" of the first audit.
- Litter is grey-brown (0.122/0.099/0.078, photo floors sRGB about 95/85/75). Patches of low green plants (the moss layer, fewer under
  conifers) and dark bare humus break it up. Turf under crowns takes the blades' shade-grass tint (`turfShade`).
- Trunk feet (`trunkFoot`, trunk grid in `src/render/terrain/trunkGrid.ts`): contact AO down to 0.45 at the bark, and a ring of dark
  damp humus. Its pale ring read as a halo.
- Understorey rides the grass pipeline as blade records whose head code is `FLOOR_FERN` (16), `FLOOR_HERB` (17) or `FLOOR_STICK` (18),
  with species 4 so no flower or seed head is added. Ferns are 8 fronds round a crown, 40-90 cm, pinnae cut in the fragment shader where
  one pinna spans several pixels. Herbs are rosettes, sticks lie flat. Counted per square metre and divided by the distance thinning;
  `thin` = 1 so they keep their size. Ferns stay 3 m from the racing line. No colliders.
- Understorey always uses the middle blade LOD (`lod = 1u`); see the overflow trap below.

## Worn race path

Files: `groundCover.ts bakeTrackDistance` (CPU), `forestFloor.ts publishForestFloor(terrain, place, track)`, `vegetation/index.ts`
(passes `s.track`; keep that argument), `terrain.wgsl trackWear` and `trackDistAt`, `grass_cull.wgsl` (`trodden`).

- The cover alpha holds min(d / `TRACK_WEAR_RANGE_M`, 1), d = horizontal distance to the racing line (25.5 m range; skipped for park
  courses). `trackWear` turns it into a trodden path 1.5-3 m wide whose width wanders: compacted dark soil, faint ruts, damp hollows,
  a trampled margin that grass reclaims, fine grit across gravel, fading out on slopes over about 0.35. Blades thin down its middle.
- Hollows are damp loam, not mud: a water film mirrored the 18:48 sky as a blue-white speckle.
- On hard-210-t2 the bright gravel strip is a stream bed (the flow map saturates along that valley), not a corridor; hard-10 and
  hard-106-t3 run over meadow.

## Grass and flowers

Files: `grass_cull.wgsl` (placement, species, LOD), `grass.wgsl` (blades, heads, shading), `terrain/grass_tone.wgsl` (shared tuft/swath
tone and streaks), `src/render/vegetation/grass.ts`, `params.ts` (budgets and capacities).

- Sward self-shadow: a blade's key light crosses the blades above it (Beer-Lambert, `SWARD_DENSITY` 6/m, `SWARD_OPACITY` 0.88), passed in
  misc.b to `lighting/deferred.wgsl`. Near the camera the terrain between blades is `MaterialId.SwardFloor` (11, `src/render/contracts.ts`)
  with the same occlusion in misc.g, so meadow gaps are dark. SwardFloor applies wherever blades grow (turfShare > 0.15), whatever the
  layer under them, and is matt with extra sky occlusion. A gravel pixel between blades kept its sheen and speckled at low sun.
- Blades thin on stream beds (`bedHere` in the density, the same `streamBed` the terrain paints). They used to grow densely over painted
  gravel, and the stones showed through as bright speckle.
- Blade variety: fine and broad grasses, twist, folded leaves, dead straw blades, seed heads, forbs, rushes; physically based albedo
  (mean about 0.10).
- Distance calm: per-blade brightness and hue noise fades out fully once a blade is under a pixel (`calm`), and the tuft tone is filtered
  by the blade's pixel size (`grassClumpTone(b.pos.xz, 1.0 / pxPerM)`). Far blades keep more sward shade (keyShade x0.6).
- Flowers: heads on the finest LOD, a drift-and-cluster rate per square metre. `flowerCode` re-hashes the random for each draw (`u01` keeps
  the top 24 bits). Shifting the hash instead collapsed both draws toward 0 and made every flower a daisy. Knapweed keeps about half its
  draws as plain blades.

## Clouds

Files: `src/render/shaders/sky/cloud_density.wgsl` (shape), `cloud_light.wgsl` (lighting terms), `cloud_march.wgsl` (view march),
`cloud_shadow.wgsl` (ground shadow map), `cloud_resolve.wgsl` (temporal), `atmos_uniforms.wgsl` (`cloudStoreScale`),
`src/render/atmosphere/cloudModel.ts` (CPU mirror), `clouds.ts`, `index.ts`.

- Mirror rule: `cloudModel.ts` reproduces the GPU density at mean erosion (weather, presence, tallness, height gradient, shape noise,
  turret tops) for the CPU sun-visibility query. Change both together; the constants `CELL_KM`, `CELL_EMPTY`, `W_A`/`W_B` (1.156/0.583),
  `SHAPE_TILE_KM`, `TOP_LUMPS` and the gradient must match. Detail-only terms (`EDGE_SHARPEN`, `BASE_RAG`, wisps) apply only when
  `detail > 0`, so the shadow map, the light march and the CPU model are unaffected by them.
- Weather: `cumulusCells` puts one jittered dome in each 2.6 km cell (radius 0.3-0.65 cell, half the cells empty). Value-noise octaves
  at 1.6 and 0.7 km break the outlines into lobes, and a log remap fitted to the field's quantiles keeps sky cover at the setting (test
  "covers about the requested fraction"). A thresholded smooth noise made worms and hooks. Recalibrate the remap whenever the field changes:
  sample `cumulusWeather` on a grid, take the quantiles at cover 0.15-0.85, and least-squares fit a + b·ln(raw) to 0.8 − 0.62·cover.
- Shape: billow noise tile 1.6 km (3 km made one smooth lump per cloud). Tallness climbs slowly to the cell maxima, so tops are domes;
  turrets rise over the 400 m Worley blobs (`TOP_LUMPS`). The base is a sharp condensation level (lowest 4% of the layer) that rolls by
  tens of metres (`BASE_RAG`). Detail octaves are 0.45 km, plus 0.13 km and wisps from high up, and a 0.04 km third octave on extreme only.
- Lighting:
  - The first `LIGHT_DETAIL_STEPS` (2) light-march steps use the erosion detail, so billows shade each other.
  - `cloudDiffuse` adds two-stream diffuse transmission (`DIFFUSE_SHARE` 0.18, g 0.85) with side leak (`DIFFUSE_LEAK` 0.07).
  - Base ambient is scaled by the optical depth above (`ambientThroughAt`), so bases under deep towers are darker.
  - The multiple-scattering octave sum and the powder term are unchanged.
- Horizon slices: long grazing march steps are split into up to `MAX_SUB_STEPS` (3) sub-steps of at most 120 m for density and
  transmittance; lighting is computed once per step. It costs about 0.5 ms at ultra on horizon views, and the lead chose to keep it.
- Cloud shadow (`cloud_shadow.wgsl`, 128² over 8 km around the camera): transmittance along the sun and moon rays, plus the diffuse,
  forward-scattered share a cloud passes on (g about 0.85). Under a cloud the ground is dimmed, not black. On review views it counts as
  weather, so compare with clouds off.
- Night: `cloudStoreScale` slides the fp16 storage scale to 1/1024 as the sun sets, or moonlit clouds flush to zero. Night clearing
  (`nightClearing`, `NIGHT_CLEAR_*`) is the extreme agent's: whole regions clear, and the rest keep their daytime shapes. It has its own
  test, `src/render/atmosphere/nightClouds.test.ts`.
- `clouds.ts restart()` (speedup agent) resets every frame counter for the render server. Reset any new counter there too.

## Sun shadow denoiser and canopy shadow map

Files: `src/render/shaders/rt/atrous.wgsl`, `rt/shadow.wgsl`, `src/render/terrain/canopyShadow.ts`, `vegetation/forestFloor.ts`.

- The 30-60 m near-black blobs under lone trees seen from the air came from the shadow denoiser, not the canopy map. Its 5x5 kernel at
  stride 4 spans 16 RT texels, tens of metres on far ground, and the plane stop let every tap through. Probes: canopy map off, blobs stay;
  crowns at half width, same size; spatial blur off, crisp tree-shaped shadows. Fix: shadow taps are also weighted by their ground
  distance, so the blur never exceeds a real penumbra (`SHADOW_PENUMBRA_M` 0.5) or about one texel's footprint.
- Canopy shadow map (2048²): per-texel foliage optical depth (leaf area density `LEAF_DENSITY_*` 0.45/0.6/0.4 times chord), lowest
  crown bottom, highest crown top; alpha = widest crown radius (trees agent, used to skip a leaf's own crown). Spruce crowns are rastered
  as cones standing on the bottom of their box (`ShadowCrown.cone`, set in `forestFloor.ts shadowCrowns`); as ellipsoids they were full
  depth almost to the rim and closed the floor's sun dapple. Crown cores pass about 3% of the sun, so dark crowns from the air are
  physically right.

## Traps

- Grass LOD overflow: the finest LOD's instance buffer fills with near sward. Anything else ranked into it is silently dropped, which is
  why understorey uses the middle LOD, and some near blades are probably dropped too. Not fixed (see open work).
- The forest view changes with other agents' tree and leaf work and with the cloud field. Re-render both sides yourself before
  attributing a change.

## How to verify

- `npx tsc --noEmit -p .`
- `npx vitest run src/render/terrain src/render/atmosphere src/render/rt src/render/vegetation/vegShaders.test.ts
  src/render/vegetation/grass`. The relevant tests:
  - `groundShaders.test.ts`, `grassTone.test.ts` (shader text);
  - `groundCover.test.ts` (track distance bake);
  - `cloudModel.test.ts` (weather range, cover fraction, gradient);
  - `nightClouds.test.ts`.
- GPU: the terrain-shots views above at ultra, clouds off, for ground; the cloud views at 12:00 and 18:48 for clouds; hard-210-t2 track
  views at 18:48 for the path. Cost: `--time 60`, or `node tools/audit/modcost.mjs --tag x --detail 1` for clouds alone.

## Open work

- Rock outcrops (approved by Nick: option (b)): add real rock-block props with colliders on outcrops, so the jointed blocks of the
  photos exist as geometry. It is a gameplay change (new colliders, so brains need retraining). Done when blocks read as jointed outcrops
  beside the rocks-cliff photos, colliders match the visible blocks, nothing stands within the 4 m race-line clearance, and a placement
  test covers it. Next step: generate blocks from the `rockFace` bed and joint pattern where rockShare is high, in placement, with box
  colliders.
- Cloud weather cost: the cells cost 0.26-0.33 ms at ultra (extreme's bisect, `tools/audit/cloudbisect.py`). Bake `cumulusWeather`
  (cells, octaves, remap, night clearing) into a 2D texture around the camera and sample it once per density call. Done when clouds are
  at most 0.8 ms at ultra (modcost) and `tools/audit/abpair.py` shows at most 2/255 difference at 12:00 and 23:30.
- Cloud sides read as stacked bread loaves with stepped flat bases in the 18:48 view; the sides should billow. 18:48 bodies are evenly
  golden. 07:00 bodies near the sun are creamy and flat: that is cloud lighting (extreme proved it is not exposure).
- Clouds and the tighter shadow blur are unchecked in motion: render a flight with an aerial pass over lone trees and forest edges.
  If the shadow shimmers, use more temporal accumulation, not a wider blur.
- Grass LOD overflow: size the finest LOD from the near annulus properly or rank by importance so near blades never drop, with a test.
- Understorey: bramble and moss cushions as geometry; herb leaves are flat diamonds. Its cost in the pre pass is not measured on its own.
- Forest floor brightness waits on the canopy shade (trees); check with `termsplit.py`, interior darkest 5% at least 4 stops under p50.
