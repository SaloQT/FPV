# Trees: plans, bark, colliders, ray-traced proxies, crown occlusion, far LOD

Design note for the wood and structure side of the trees: how a tree's skeleton is planned, how its bark is drawn, how it collides, how
the ray tracer sees it, how its crown is darkened, and how a forest gets its variety. Leaves, needles, the atlas, wind and leaf shading are
in `docs/foliage.md`. Paths are relative to the repo root. "Ultra" and "extreme" are quality tiers; "dense" in code means extreme's crowns.

## Plans and skeletons

A variant (`src/render/vegetation/variants.ts`, `VARIANT_DEFS`) is a species, a growth form and a seed. Its plan (`treePlan.ts`
`sprucePlan`/`pinePlan`, `treePlanBroad.ts` `oakPlan`/`birchPlan`/`beechPlan`/`snagPlan`/`bushPlan`/`juniperPlan`) is a list of limbs
(polylines with radii, `order` 0 = trunk), leaf clusters (broadleaves and pine) or fronds (spruce, juniper), and the crown ellipsoid.
`treeGen.ts buildTreeLods` turns a plan into three LODs: `emitLimbs` for wood, the foliage emitters (see `docs/foliage.md`), and
`emitBillboards` for LOD2.

- Growth forms per species: open-grown (low limbs, broad crown), forest-grown (long bare bole), and a character form (old drooping
  spruce, crooked pine, stag-headed veteran oak, weeping birch). Variants 0-7 keep their old species order because the theme park plants
  them by index.
- Oak: low fork, heavy limbs, wide crown, 11 sprigs of 0.45 m per cluster (`treePlanBroad.ts`, `cardsPerCluster`/`cardSize`). LOD0
  budget 32k triangles (`meshes.test.ts`): the cost against 9 sprigs at 0.52 m was within GPU noise on the oak and forest views.
- Pine: each primary limb gets 2-4 side branches and some a last fork, each with a needle clump (`pineSecondaries`, its own random
  stream so the trunk and primary limbs are unchanged). Pine open: 144 clusters, about 15k LOD0 triangles, 6 cards per cluster.
- Spruce: whorls of 5-7 branches, 3 fronds per branch. `reach` (crown radius as a share of height) is 0.31 open, 0.22 forest, 0.28 old,
  to match photos of open-grown Norway spruce (about 0.65-0.7 as wide as tall at the base). A drawn crown may be at most 1.4 times its
  layout radius (`colliders.test.ts`), so widening past that means re-settling `LAYOUT_CROWNS` (done for the spruces; a gameplay change,
  logged in `docs/history/`).
- Dead wood: `deadBranches` (snapped stubs), `killLimb` (broken limbs), `snagPlan` (standing dead trees), `fallenLog` (a log beside old
  spruces, veteran oaks and snags; no collider). Each draws from its own `Rng` stream so the living tree grows the same with or without it.
- Rule for any plan edit: keep the number and order of draws from the plan's main `rng`, or give new parts their own `new Rng(seed)`. A
  shifted stream reshapes every later limb.

## Layout freeze

`variants.ts LAYOUT_CROWNS` holds, per variant, the crown radius, top, crown top and trunk radius as they were when the race worlds'
layout was settled. Placement keep-outs and spacing (`placement.ts`), scale limits and trunk collider heights (`colliders.ts stemBoxes`)
read these through `layoutCrown(v)`, never the drawn crown. So crowns, branches and foliage can be reshaped without moving a tree or a
collider. Change an entry only when the layout itself is meant to change, and list it as a gameplay change (the AI pilots retrain on it).

What still moves colliders: the trunk polyline (`order` 0 limbs: their boxes follow the stem) and the instance `scale`. Keep trunks
generated first in each plan, from the main stream.

## Colliders and race-line keep-outs

`colliders.ts buildColliders`: trees within `TREE_COLLIDER_RANGE` (60 m) of the racing line get trunk boxes (`stemBoxes`: up to 4 stacked
boxes per stem, 6 per clump, half-width clamped to `TRUNK_HALF_MIN`/`TRUNK_HALF_MAX` = 0.15/1.2 m, up to 0.9 of the height), boulders
over `MIN_BOULDER_RADIUS` within 40 m get boxes; `MAX_COLLIDERS` 2400, nearest first. Track tree obstacles become real trees first
(`placement.ts placeObstacleTrees`). Nothing grows within `PATH_CLEARANCE` (6.5 m) of the line, and the `CORRIDOR_WIDTH` (70 m) is thinned
to `CORRIDOR_DENSITY`.

Visual-only variety must stay inside the boxes: per-tree girth only slims (`tree.wgsl TRUNK_JITTER` 0.16), and the per-tree lean
(`TREE_LEAN` 0.03 of height at the top) grows with the square of height, about 2 cm at a fifth of a 20 m tree.

Verify: `src/render/vegetation/colliders.test.ts`, `placement.test.ts`. For any placement change, compare positions, scales and the
collider list before and after on the test world and the 1337 world at high and extreme. They must be identical within 65 m of the line.

## Placement variety (the aerial "broccoli")

`placementRules.ts`: `crownTint` (stand patches about 45 m across, per-crown brightness 0.72-1.18 broadleaf and 0.82-1.12 conifer, a
yellow-to-blue cast), `canopyLayer` (in closed stands about 28 % of trees a storey down, scale 0.62; conifers up to `EMERGENT_MAX` 1.3 as
spires). `placement.ts` applies the layer and `EXTRA_SNAGS` (5 %) only beyond `TREE_COLLIDER_RANGE` + 5 m, and spacing always uses the
placed scale, so no spot or collider moves. `placement.test.ts` divides far conifers' scale by `EMERGENT_MAX` for that reason.

Far LOD: broadleaf LOD2 is five clumps of three tetrahedral cards on the crown's main leaf masses (`treeGen.ts crownClumps`, k-means over
clusters) with twice the bake's crown occlusion, instead of three whole-crown billboards; spruce keeps its cone cards. A clump's cards are
clamped under the crown's top and inside the reach of the mid LOD's cluster cards round the axis, so the far crown is no wider than the
near one; `src/world/park/planting.test.ts` checks every LOD against the footprint the park reserves (`plantingBounds`). Beyond the tree draw
distance, `veg_far.wgsl` cards give each of their 1-3 crowns its own shade; their clump and gap detail runs at extreme only.

Measure with local contrast of the forest area at 9/33/97 px windows (`tools/audit/metrics.py` style), against `tools/audit/refs/aerial`.

## Bark

Near trunks at high and up use photoscanned CC0 bark (`public/textures/bark/bark.bin`, `LICENSE.md` beside it; loaded by
`barkScans.ts`, sampled in `src/render/shaders/vegetation/tree_bark.wgsl scanBark`); low and medium, and devices without BC
compression, keep the procedural bark.

- Rebuild: `python tools/bark/build_bark_scans.py` (downloads from ambientCG, Poly Haven and cgbookcase into `--cache`, needs numpy,
  Pillow, scipy and etcpak; writes BC7 arrays with a full mip chain). The sources and tile sizes are its `LAYERS`.
- Each tile is stored whole. A tall scan (oak, beech: 1024x2048) is squeezed into its square tile, and the layer records `along`, the
  metres it covers up the limb. Cropping a scan to a square broke its tiling and put a hard seam across oak and beech trunks every tile.
  The shader's `SCAN_METRES`/`SCAN_ALONG` must match the file (`barkScans.test.ts`).
- `scanGrade` grades each layer to measured bark albedo. Measured from the G-buffer (`tools/lightcast/measure.mjs --terms alb`):
  beech 0.20, oak 0.12, pine 0.11, spruce 0.08, within literature ranges. Pine plates are graded to a hue of 30-35 degrees on a sunlit
  trunk at noon. Pale-looking trunks are a lighting problem (shade open to the sky), not albedo.
- Moss and lichen (`barkWeathering`): foot moss mostly on the north side, in hand-wide patches. The fine noise fades in by pixel
  footprint (`barkFine`) instead of switching on, because a hard switch drew a line round trunks at mid distance.

Verify: `barkScans.test.ts`, `vegShaders.test.ts`, then close-up renders of each species (views `bark-<species>-close`, `bark-oak`).

## Root flares and roots

The trunk tube swells into a buttressed flare (`Flare`, `tube` `buttress` in `meshBuilder.ts`); `treePlan.ts surfaceRoots` adds roots
along its ridges: broad where they leave the trunk, rising out of the flare as a rounded ridge and diving within one to two trunk radii,
at irregular angles and unequal sizes (same four draws per root as before, so nothing else changes). Thick roots get 8 sides at LOD0. Long
thin half-buried roots read as a regular star of blades; five-sided roots read as wedges. The lower trunk is sheared onto the slope in
`tree.wgsl footOnSlope`.

## Ray-traced proxies (what the GI, shadow and specular rays hit)

`colliders.ts buildRtProxies` gives each plant a trunk capsule and 1-3 canopy spheres (`plantShadows.ts canopyShadowFit`) and each big
rock an ellipsoid. Canopy spheres are porous (`src/render/shaders/rt/rt_canopy.wgsl`, Beer-Lambert, `CANOPY_EXTINCTION` 0.19 per m, CPU
mirror in `src/render/rt/canopy.ts`).

- Which plants: `vegetation/index.ts publishRt`. Ultra and below: the `RT_PRIM_CAP` (1500) primitives nearest the track start. Extreme:
  `RT_PRIM_CAP_EXTREME` (16000) ranked by distance to the race line (about 100 m either side), of which `cameraShare` (up to
  `RT_CAMERA_PRIMS`, 3000) goes to the plants within `RT_CAMERA_WITHIN` (150 m) of the camera that the line set leaves out. The camera
  round sits in a dynamic group (`vegetation-camera`), re-ranked every `RT_CAMERA_RERANK` (50 m), so moving it never rebuilds the static
  BVH (about 2 ms CPU to rank, 1.5 ms to build).
- Budget: `forestRtCap` takes whatever the park and track groups leave under `MAX_PRIMS` (131072, `src/render/rt/bvh.ts`) minus
  `RT_PRIM_MARGIN` (1024). The mega park alone uses about 117k.
- Why not more at ultra: race-line coverage cost the RT pass 1.3 to 3.7 ms on forest views at ultra; a 1500-primitive camera round
  cost 0.5 to 2.5 ms. The crown darkness is carried by the bake instead (below).
- Trap, the inside-sphere ray: an analytic sphere test returns only the entry root, so a GI ray leaving a leaf inside its own crown
  missed that crown and read open sky. `rt_canopy.wgsl canopyInsideExit` (used in `rt_bvh.wgsl traceBvh`) makes such a ray meet its crown
  at the far side. Shadow rays were never affected: `canopyOpticalDepth` clamps the chord at 0.
- Crown hits are shaded at the chord's middle (`src/render/shaders/rt/rt_scene.wgsl canopyScatter`), not at the sunlit rim, and short
  chords (transmittance above `CANOPY_SHADOW_CHORD` 0.8) skip the BVH shadow ray. The rim made deep leaves glow at low sun, and the shadow
  rays were the cost.

- Sun shadow from crowns comes from the canopy shadow map (`src/render/terrain/canopyShadow.ts`: optical depth, crown bottom and top,
  and in alpha the widest crown's horizontal radius), marched in `rt/shadow.wgsl canopyTransmittance`. Crowns go in as the plan's
  ellipsoids, a spruce's as a cone standing on the bottom of its box (`forestFloor.ts shadowCrowns`): as an ellipsoid, the widened spruce
  crown was full depth almost to its rim, closed the gaps between neighbours, and the floor of a spruce stand lost its sun dapple (terrain's
  forest view, floor p5 61 → 73; 67 with the cone). A leaf skips the samples within its
  own crown's radius: the map merges every crown, so a sun-side leaf was shaded as if deep inside its crown (backlit fringe 4.2 stops
  under the sky against 2.1-2.8 in photos; 3.2 with the skip). Its own crown's shading comes from the leaf shader's sunflecks instead. The
  shadow pass knows a leaf by `AUX_FOLIAGE` (2.0) in the RT aux normal's w (`aux_pass.wgsl`, `rt_trace_io.wgsl loadPixel` `pix.leaf`).

Verify: `colliders.test.ts` (budget, line coverage, camera round), `src/world/park/parkBudget.test.ts`, `src/render/rt/` tests. Cost on
track 210-t2 gate 3: `node tools/audit/modcost.mjs --tag <t> --source <dir> --quality ultra --detail 1`.

## Baked crown occlusion and the proxy-aware undo

Every leaf and bark vertex bakes an occlusion (`treeGen.ts shading aoAt`): the crown shell, height in the crown, and the foliage above
(`foliageShade`). The bake keeps only `CROWN_AO_SHARE` (0.3) of it, because the GI rays against canopy proxies supply the rest. But only
trees with proxies have that, so `tree.wgsl crownAo` undoes the share per tree: each slot has a "has proxies" bit (buffer `tree-proxied`,
draw binding 11, written by `vegetation/index.ts publishProxied` whenever the line or camera set changes; `instanceData.ts` returns each
run's slots). Without a bit, a leaf takes the full term (`1 - (1 - ao) / 0.3`) only where it lies `CROWN_SHELL_OUT`-`CROWN_SHELL_IN`
(1-2 m) or more inside the crown ellipsoid (the variant's `crown` vec4) and its bake also says shaded (0.92 to 0.84): the outer shell,
sunlit or backlit, is not shaded by its own crown, and the plan's ellipsoid is padded round a lumpy crown, so depth alone is not enough.
Bark uses the bake gate only (a trunk under a crown is shaded whatever its depth). LOD2 keeps the bake.

Measured on ultra, darkest 5 % of pixels against the median (photos: 4-5 stops), restore off to on: lone oak 3.6 to 4.1 stops at noon,
3.0 to 3.6 at 07:00; side oak 4.3 to 4.6; edge 4.5 to 4.7, with the lone oak's brightest 10 % of crown leaves within 2.5-4 % of their
unrestored value. The forest interior is still short (1.4-1.8); its floor is leaf specular, near haze and the GI of ground and bark.

Verify: `vegShaders.test.ts` (shader `CROWN_AO_SHARE` equals `treeGen.ts`), then `node tools/lightcast/measure.mjs --tag <t> --dump
--views lone,oak-lone,oak-side,edge,interior,distant --hours 7,12,18.8 --quality ultra --terms real,rsun,rgi,rspec,rap` and
`python tools/audit/termsplit.py <t>` (stops between the median and the darkest 5 %, and each term's share there).

## The tree cache

`treeCache.ts` stores built meshes and the leaf atlas (IndexedDB in a browser, `.cache/tree-meshes/` under Node). The key hashes the
code the trees are built from, found by following the imports (`sourceClosure.ts`): an edit to any module the build reaches rebuilds
the trees (90-180 s cold at extreme); an edit elsewhere (shaders, placement) does not. Under Node, set `FPV_TREE_CACHE_DIR` to a folder of your own when several people or tools render different
sources at once, or they evict each other's entries. Shader (`.wgsl`) edits do not touch the cache.

## Checking a change

- Tests: `npx vitest run src/render/vegetation/ src/render/rt/`, and `npx tsc --noEmit -p .`. `meshes.test.ts` holds the triangle
  budgets (oak 32k, other broadleaves 28k, spruce 24k, the rest 16k at LOD0; LOD2 at most 60). `foliageSpace.test.ts` holds the clash
  limits that plan changes most often break (under 20 % of foliage dropped at rest).
- Renders: `node tools/tree-shots.mjs --out <dir> --quality ultra --no-clouds [--only views] [--hour h]` (the views are picked from the
  placement on the first run and saved to `.bench/trees/views.json`); `node tools/shot-client.mjs` for fast repeat shots
  (`tools/RENDER_SERVER.md`). Compare with clouds off; keep the default sky for final look sheets. Render extreme only for final sheets.
- WGSL is not compiled by the tests: every shader change needs a real render (a broken shader shows as `GPU errors` in tree-shots).
- Before/after renders never swap files in `src/`: `node tools/compare/ab-swap.mjs --prefix p --a <dir with the old files> -- <tree-shots
  args>` renders A from a scratch copy under `.bench/ab/` (`tools/tree-shots.mjs --source <copy>`); light and cost splits take
  `--source <copy>` too (`tools/lightcast/measure.mjs`, `tools/audit/modcost.mjs`).
- Mid-LOD bark covers almost nothing (about 0.01 % of a frame at 100 m): cost cuts there do not pay; bark cost is the near trunks.
- The GPU is shared: `tools/native-bench/lock.mjs`. Timings on a shared machine move ±1-3 ms between runs, so interleave A and B rounds and
  compare medians.
