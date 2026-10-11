# Foliage: leaves, needles, their shading and the image pipeline after them

Design note for the leaf and needle side of the trees: geometry per tier, the leaf atlas, the clash pass, wind, the build workers and disk
cache, leaf shading, and the tonemap, TAA and CAS settings that decide how foliage reads. Tree skeletons (plans, limbs, bark, baked crown AO)
are described by their own code in `src/render/vegetation/treePlan*.ts` and `treeGen.ts emitLimbs`.

Paths are relative to the repo root. "Ultra" and "extreme" are quality tiers; "dense" in code means the extreme tier's crowns.

## Geometry per tier

Each tree variant (`src/render/vegetation/variants.ts`) is built by `buildTreeLods` (`treeGen.ts`) into three LODs: LOD0 near (full
foliage, clash-checked), LOD1 mid (merged cards), LOD2 far (crossed billboards). Only LOD0 is described here; LOD1/2 use plain `card()`.

**Broadleaves (oak, birch, beech, bush).** Each plan cluster grows a twig (`emitClusters`) carrying `cardsPerCluster` sprigs (`sprig`): a
shoot card of the species' atlas tile, bent into a shallow shape (`shapedCard`, `CardShape` fold/curl/twist) and anchored by a stationary
root vertex on the twig. Sprigs of one twig face the twig's light direction and fan out in that plane, so a crown shows leaf faces, not
edges. Oak uses 11 sprigs of 0.45 m (half-size) per cluster.

**Extreme per-leaf geometry.** At the extreme tier, shoots in the outer 5% of the crown by depth (`shellDepth > OUTER_SHELL`, 0.95) are
built leaf by leaf (`leafShoot`): each painted leaf of the tile becomes a small bent mesh cut from the species' single-leaf sheet tile, at the
painted leaf's place. Inner shoots stay cards (they are hidden). Applying it to the whole crown once produced 1.6M-triangle trees.
Leaves keep `LEAF_LEAF_ROOM` (4 mm) from each other and spread `SHOOT_SPREAD` (3.5 cm) off the card plane.

**Spruce (Norway).** Each plan frond is cut into `FROND_SHOOTS` (2) shoots along its branch plus `INNER_SHOOTS` (1) carrying the spray on
toward the trunk. Each shoot is split down the branch into two half-cards, each 0.4 of the frond's width, that hang `SPRAY_DROOP` (1.15
rad) either side, the "comb" form of a Norway spruce. One hanging bottle-brush branchlet per frond (`branchlet`, a `ribbon`). At extreme,
sprays in the crown's outer shell (`shellDepth > SPRAY_SHELL`, 0.85) are built shoot by shoot from the tile's painted layout
(`sprayShoots`, `SprayLayout` in `treeNeedleShapes.ts`) and the rest as the half-cards above. Why: flat sprays 1-2 m wide crossed their
neighbours in wind (4-13 pairs per tree) and read edge-on as bare branches from eye height; built shoot by shoot everywhere, the extreme
crown was sparser than ultra's. State (lone spruce, 10 m, clouds off, `skyfrac.py` on the render): ultra 37% sky before this work, about
20% now; extreme 41% before, 14% now; photographs 4-10%. What is left is sky in the notches between branch tiers at the silhouette's edge
(edge-on thinning is not it: switching it off changes nothing; a lower alpha cut gains 4 points but fattens needles beyond their paint).

**Scots pine.** Each branch-end cluster grows `cardsPerCluster * PINE_SHOOTS_PER_CARD` (5) shoots (`pineShoots`): straight ribbons of the
single-shoot `pine2` tile, 0.5-0.8 of the cluster radius long (the radius taken as at least `PINE_SHOOT_SCALE_MIN`, 0.7 m, so a small
clump's shoots are still 35-55 cm), leaving the wood out and up, in near-level layers (twisted at most `PINE_SHOOT_TWIST`, 0.35 rad).
Extreme uses two crossed ribbons per shoot. Why: the former 2 m tuft cards read as palm fronds and cut through each other in wind (16-29
pairs); random twist made neighbours meet at steep angles and cross again. The plan (`pinePlan`, `pineSecondaries`) now has secondary
branches and many small clumps. Open: pine is still sparse, about 31% sky on the cover probe and more in renders, against 7-13% in
photographs. More shoots per card, crossed ribbons at ultra or more twist each push drops past 20% or wind crossings past the allowance,
so the remaining density has to come from the plan (more clumps along the outer 1-1.5 m of every branch), reached at extreme first.

**Juniper.** Each frond is one upright page (`shapedCard`, two rows) in a vertical plane through the shrub's axis, moved out until its inner
edge clears the axis by `JUNIPER_AXIS_ROOM` (0.15 m) (pages crossing the axis cut every page on the far side), with four side shoots
(`juniperShoots`) merged into the page piece so it keeps one root on the wood.

**Budgets** (`meshes.test.ts`, LOD0 triangles at ultra): oak 32k, other broadleaves 28k, spruce and pine 24k, the rest 16k. The ultra GPU
cost of a cap raise must stay within about 1 ms on the worst view (interleaved medians). Measured with `tools/audit/modcost.mjs` on track
210-t2: cutting the conifers back (no inner spruce shoot, 3 pine shoots per card) changed nothing (8.85 ms both), so conifer triangles are
not what the ultra frame pays for there.

## Leaf atlas and painters

`src/render/vegetation/leafAtlas.ts`: 4 x 5 tiles (`TILE`), `TILE_SIZE` 512 per tile (ultra and below), `EXTREME_TILE_SIZE` 1024.
Two RGBA8 mip pyramids: colour (rgb = colour multiplier / `COLOUR_RANGE`, a = coverage) and data (normal, translucency, cavity). Each mip
rescales alpha per tile so alpha-tested coverage matches level 0 (`tileCoverage`), so crowns keep their mass at distance.

Painters: broadleaf sprigs and sheets in `treeLeafShapes.ts`, needles in `treeNeedleShapes.ts`. A needle shoot (`shoot`) paints
`NEEDLES_PER_STEP` (8) needles per step all round the shoot: with 3-4 a spray tile painted a quarter of its area and a crown of them read
as a skeleton. `pinePainter(.., single)` paints one branchlet (`pine2`) with needles about 15% of its length (5-8 cm on a 30-50 cm shoot).

Traps: nothing may reach a tile border (bilinear and mips bleed into the neighbour). `tileOpacity(tile)` is a coarse 128-cell mask for
the clash pass, not the painted share: fine needles barely register in it, so measure density from the atlas alpha or a render.

## Clash pass (foliage space)

`src/render/vegetation/foliageSpace.ts`: a spatial hash of placed pieces. `settle` tries a piece as built, then slid along its twig,
lifted, turned about its axes and shrunk (`poses`); the first pose that crosses nothing is kept, else the piece is dropped. Two pieces
clash if they visibly cross (paint on both sides of the intersection) or their paint comes within `room` of the other's surface.

Room: `LEAF_ROOM` 10 mm (broadleaf), `NEEDLE_ROOM` 15 mm (conifer trees), `BUSH_NEEDLE_ROOM` 6 mm (juniper), `LEAF_LEAF_ROOM` 4 mm
(extreme per-leaf). The needle room is wind-driven: a tall crown bends a few mm differently from piece to piece, and at 6 mm one pair in
100-200 pieces brushed through in a strong wind; at 15 mm about one in 2000. Pieces of one `group` (a crossed pair sharing a stem) may cross.

When a pose moves a piece, `resway` moves its sway weights to the new heights (`heightSway`); otherwise a page turned toward the ground
kept crown-top sway and moved apart from its neighbours in wind.

Wind allowance: broadleaf crowns must have no crossing at rest and at most one pair per 500 pieces at any of six phases of a strong wind
at maximum tree scale (`foliageSpace.test.ts`, which mirrors `tree.wgsl`'s wind field in `windAt`). Conifers are tested at rest; the
same allowance is met in practice (check with the probe below). Drops must stay under 20% of pieces.

Verify: `npx vitest run src/render/vegetation/foliageSpace.test.ts src/render/vegetation/treeAttachments.test.ts`. Ad-hoc probes
(copy into `src/render/vegetation/` as `zz*.test.ts`, run, delete): `tools/audit/probes/foliageWind.test.ts.txt` (wind crossings per
variant and which piece shapes cross), `tools/audit/probes/foliageCover.test.ts.txt` (side-view cover through the real atlas alpha,
triangles, drops). On a loaded machine the heaviest vegetation tests can pass 60 s and time out; rerun them with `--maxWorkers=1`.

## Wind

`src/render/shaders/vegetation/tree.wgsl`, mirrored in `foliageSpace.test.ts`. Hierarchical, all smooth fields over the tree's frame:
whole-crown lean, branch sway (`BRANCH_SWAY` 6 mm per m/s, `BRANCH_WAVE` about 0.8 rad/m so limbs metres apart swing out of step while a
card barely bends), leaf flutter (`LEAF_FLAP_HZ` 2.6, `FLUTTER_K1`/`K2` ripples about a metre long), and each leaf's petiole twist
(`PETIOLE_TWIST` 1.5 mm per unit scale). Flutter weighs a vertex by its place in the crown (`outer`), not its own sway, so wood and leaves
move together. The test requires the flutter slope `flutter * MAX_TREE_SCALE * (|K1| + 0.6 |K2|)` under 0.6 (no folding) and two
neighbours' twist under the 4 mm extreme leaves keep apart.

## Build workers and disk cache

`treeBuildPool.ts` builds variants on worker threads in the browser (one share per core, heavy variants dealt round-robin); Node tools
build on the calling thread. `treeCache.ts` caches each variant's meshes and the atlas:

- Key: the import closure of the generator (`sourceClosure.ts`, type-only imports skipped) plus each variant's table entry and plan output,
  so a change to one species rebuilds only it; a `treeGen.ts`, `leafAtlas.ts` or painter change rebuilds all. `FORMAT` (3) is bumped when
  the stored layout changes; a new entry deletes older ones of its kind, any format.
- Entries are deflate-raw (`CompressionStream`), loaded and inflated in parallel: the extreme atlas is 25.5 MB on disk (224 MB raw), for
  IndexedDB. Inflating one at a time added 1.5 s to a warm start.
- Storage: IndexedDB in the browser; under Node, `.cache/tree-meshes/` or the directory in `FPV_TREE_CACHE_DIR`. Set your own directory
  when several people or agents render different sources at once, or every store evicts the others' entries and forces a cold build
  (90-180 s at extreme).

Verify: `npx vitest run src/render/vegetation/treeCache.test.ts`; start-up times per module with `node tools/audit/modcost.mjs --tag X`.

## Leaf shading

G-buffer side (`tree.wgsl`): albedo alpha carries the leaf's openness, `ao = mix(LEAF_AO_FLOOR, 1, occ)` with `occ` from the baked crown
occlusion (`treeGen.ts aoAt`, through `crownAo`, which restores the full bake for trees without GI proxies) times the atlas cavity.
Translucency comes from the atlas data. Sunflecks: each shoot of a near card draws sun or shade once (its phase byte and the tree's slot),
with its own crown's transmittance along the sun (`LEAF_SELF_EXTINCTION` over its depth to the crown ellipsoid, the variant record's
`crown` vec4), written as sun occlusion in `misc.b`; the crown's mean shading still comes from the canopy shadow map, which is smooth.
`LEAF_SELF_EXTINCTION` is 0.15, half a real crown's: the map already darkens a crown by its mean, and at 0.3 the crown median fell a third
of a stop. Local contrast (`tools/audit/lc.py`, as metrics.py) rose 3-8% (oak 0.49 to 0.53, forest edge 0.64 to 0.68); photographs of oak
crowns read about 1.08.
Cards seen edge-on thin out (`EDGE_ON_LO/HI`) so grazing broadleaf cards show slivers, not streaks;
needle cards use the narrow `NEEDLE_EDGE_ON` band, because a needle spray seen edge-on is still a band of needles.

Lighting (`src/render/shaders/common/pbr.wgsl`, `src/render/shaders/lighting/deferred.wgsl`):

- Direct: wrapped diffuse (a quarter of the range at full translucency) plus transmission through the leaf, coloured by
  `leafTransmitColour` (yellow-green: chlorophyll passes green and absorbs red and blue). `leafBackDiffuse` adds the diffuse light a leaf
  passes from its back face; without it backlit crowns read dull grey-green. A backlit view's grazing GGX glints are cut by
  `LEAF_BACKLIT_GLINT_CUT` as the view turns to the sun.
- Ambient: `leafAmbient = (1 + LEAF_AMBIENT_BACK * LEAF_TRANSMITTANCE * translucency * ao) * mix(ao, 1, LEAF_AO_FILL * translucency * ao)`.
  The back-face share and the multiple-scattering refill are both in proportion to the leaf's openness: a deep leaf sees leaves behind it,
  not sky, and the light scattered into a pocket is what got into that part of the crown.
- Specular: environment reflection times `LEAF_SPECULAR_OCCLUSION` (0.35) times `ao^2` for leaves: a spray is porous and a deep leaf's
  mirror directions hit shaded leaves. Without it needles read teal and crown interiors grey.

Evidence: the darkest 5% of a frame (crown interiors) sat 1.2-2 stops under the frame median against 4-5 in photographs. The cause was the
AO input (`ao` about 0.7 in deep pockets at ultra, since most trees had no GI proxy); with the bake restored (`crownAo`, gated so the
sunlit outer shell stays open) and the terms above, oak-lone and edge reach 3.8-4.8 stops; interior and lone at low sun are still 2-3,
where the light left is GI (65-89%), not haze.

Leaf colour: sunlit leaves (brightest quarter of crown pixels, `tools/audit/leafcolour.py`) read hue 75-89 degrees, saturation 0.44-0.46
against 69-88 and 0.25-0.44 in oak photographs, and backlit leaves rgb 199/224/135 against 189/227/136; no colour change is needed.

Backlit fringe (open): leaves one or two layers deep against the sky (`tools/audit/fringe.py`) on the lone oak looking toward the sun sit
4.15 stops under the adjacent sky, against 2.1-2.6 in backlit oak photographs (`tools/audit/refs/oak-crown/3.jpg`, `0.jpg`), and grey
(saturation 0.31 against 0.5-0.6). The sun term is 78% of their light; transmittance and transmit colour are not the limit
(`LEAF_TRANSMITTANCE` 1.0 gains 0.1 stop). Sun visibility is: the canopy shadow map (`src/render/shaders/rt/shadow.wgsl`
`canopyTransmittance`) shades a sun-side leaf through its own crown's density column (+0.8 stop with it off), and the sunflecks cost 0.3.
Agreed fix, pending: the canopy march skips a leaf's own crown, whose shading then comes from the sunflecks' exact crown depth.

Verify: `node tools/lightcast/measure.mjs --tag X --views edge,interior,lone,oak-lone --hours 7,12,18.8 --quality ultra --terms
real,rsun,rgi,rspec,rap --dump`, then `python tools/audit/termsplit.py X` (p50/p5 stops and each term's share in the dark pixels).
`--source <dir>` renders a frozen copy of `src/` for A/B. `--terms ao` dumps the G-buffer openness. Tests: `src/render/rt/canopyScatter.test.ts`,
`src/render/vegetation/leafShading.test.ts`.

## Tonemap, TAA and CAS

**Tonemap** (`src/render/shaders/post/tonemap.wgsl`, `GRADE`): a hue-preserving filmic curve on luminance (Narkowicz ACES fit), so foliage
does not drift to neon yellow-green as it brightens; smooth gamut compression so a saturated colour approaches but never plateaus on one
channel. Daylight adds a shadow lift (`dayToe` 0.045), mid-tone chroma (`midSat`) and a white point (`dayWhite` 4: scene luminance about
3.7 stops over the key reaches display white). All of these fade with sensor gain toward the night curve. Owned with the exposure work;
`src/render/post/composite.test.ts` mirrors the curve.

**TAA** (`src/render/shaders/post/taau.wgsl`, `TAA_TUNING` in `src/render/post/taa.ts`): temporal upsampling with a 3x3 gaussian kernel
(`kernelK` 4), Catmull-Rom history, variance clipping in YCoCg (`varianceGamma` 1.25), feedback 0.9 static / 0.7 in motion, depth-based
disocclusion. Leaf alpha is a one-pixel ramp compared against a blue-noise threshold (`tree.wgsl alphaThreshold`), so TAA resolves an
anti-aliased outline. This is the TAA form of alpha-to-coverage; the deferred renderer has no MSAA. Trap: above about 0.5 px of motion per
frame the threshold falls back to a fixed 0.5 cut, so in FPV flight leaf edges are hard binary cuts. Keeping 40% of the dither in motion
was tried on flight video past an oak: outlines softened only slightly and thin twigs turned to dotted speckle, so it was not kept. Judge
edges from flight video (`leaves.mjs fly`), not stills.

**CAS** (`src/render/shaders/post/composite.wgsl`, `SHARPEN` 0.9): contrast-adaptive sharpening after the resolve, because TAA and the
lens resample halve the local contrast of leaves, needles and grass against photographs. It works in the squashed domain `c / (1 + c)`,
backs off near black and white (no halos) and fades out at night.

Noon grass does not clip its blue channel in motion: in flight frames under 0.01% of grass pixels reach 254, and the bluish pixels are bark
and litter. Stills band in the readback, so they look worse than the game.

## Tools and views

- `node tools/shot-client.mjs --out <dir> --quality ultra --only <views>` (`tools/RENDER_SERVER.md`) renders the views in
  `tools/views/trees.json` in seconds after an edit. For a before side, build from a copy of `src/`; never swap files in the shared
  checkout.
- Untracked, in `.bench/leaves/` on the original machine only: `node .bench/leaves/leaves.mjs build --tag T`, then `shots --tag T --quality ultra --only <views> --clouds off [--size WxH] [--timings 1]`,
  `fly --tag T --view V --seconds 2 --speed 10`, and `time --tags A,B`. It holds the shared GPU lock (`tools/native-bench/lock.mjs`).
- Views: oak-close, forest-edge, backlit, distant-forest, spruce-close, pine-close, juniper-close, conifer-stand, oak-20m, birch-20m,
  broad-200m, meadow-edge, leaf-1m/3m/10m, and spruce/pine-3m/10m/30m (the loneliest big tree of each species, clearest direction).
- `python tools/audit/skyfrac.py image x0,y0,x1,y1 [mask.png]` gives the sky fraction inside a crown silhouette, the same for photos and
  renders. `tools/audit/lc.py` gives local contrast, `leafcolour.py` sunlit leaf hue and saturation, `fringe.py` backlit fringe leaves. Photo references are in `tools/audit/refs/`: spruce-tree/3.jpg (9%), pine-crown/9.jpg (12%), 4.jpg (13%), 2.jpg (7%).
- Compare renders with clouds off. Render extreme only for final checks; it costs minutes on a cold cache.
