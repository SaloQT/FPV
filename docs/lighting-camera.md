# Lighting and camera: exposure, white balance, tonemap, haze, lighting resets, props, and the realism audit

Design note for the camera side of the renderer (how scene light becomes a picture), the atmosphere's haze and aerial perspective, the
RT ground bounce and cloud sky light, resets when the lighting jumps, the track props' materials, and how image realism and performance
are measured. Paths are relative to the repo root. Codes are 8-bit display values (0-255); EV is a factor of two.

## The EXTREME tier

**What.** A fifth quality tier above ultra with no frame-time budget: `qualityProfile('extreme')` is ultra plus `EXTREME_PROFILE`
(`src/render/contracts.ts`). Modules opt values in with `tierTable(budgeted, extremeValue)` and test `isExtreme(q)`. Extreme-only paths
include full-resolution clouds, 160 cloud steps, 600 m grass, per-leaf outer shells, far trees to 4 km and 20 bark parallax steps.

**Why.** The goal is a picture that matches photographs at any cost; ultra stays the budgeted top tier (`BUDGETED_TIERS`), so budget and
triangle tests skip extreme.

**Traps.** Nothing that decides where things stand or what the quad can hit (terrain, track, placement, colliders) may depend on the tier
(`gameplayQuality` in `src/contracts.ts`): extreme must fly identically to ultra. Never tune ultra cost by comparing against extreme.

**Verify.** `?quality=extreme` in the browser; `tools/audit/browser-check.mjs --qualities extreme` (no console errors, first frame time).

## Exposure

Two stages. The CPU pre-exposure (`src/render/exposure.ts`) is set from astronomy alone (an estimate of a 0.18 card's luminance), slewed
at most 2% a frame. The GPU auto exposure (`src/render/post/exposure.ts`, `src/render/shaders/post/histogram.wgsl`) corrects it from a
histogram of the resolved image. The adapted state is the total exposure in EV (open loop: the meter never sees its own output).
`exposure.ts` mirrors every shader formula in TypeScript, and `exposure.test.ts` checks the mirror against the shader constants.

**Key 0.30** (`EXPOSURE_TUNING.key`). Against the audit photos, the render p50 is +7 codes on average (median +13) over 16 world
pairs; the scene-to-scene spread is ±60, so the key was kept. 0.22 rendered every scene about 15 codes darker than the photos. The night
camera levels below were tuned with 0.30: changing the key shifts them.

**Metering.** Centre- and ground-weighted (`centerBias` 0.6, `vertBias` 0.3). The sky is binned apart (G-buffer depth 0) and folded onto
the ground mean + `skyCapEv` (2), so a dusk sky 4-6 EV over the ground can't set the exposure. By day the darkest `trimLow` 30% of the
weight is ignored, so forest shade doesn't decide how bright the sunlit grass is. Highlight priority: the brightest `clipFrac` 12% may
sit at most `clipEv` 1.5 EV over the key (`protectMaxEv` 3).

**The shade trim stays at 0.30.** Trims of 0.45 and 0.60 were scored against the photos (`tools/audit/meterscore.py`): mean |p50 error|
28.2 / 29.2 / 36.7. Forest frames render brighter than their photos and meadow-edge frames darker, so any brighter-weighted law fixes
one half and worsens the other. The forest gap is crown shade that is too bright (lighting), not metering. Re-score after lighting changes.

**Night camera.** Below `nightBlendLoNits` the astronomy estimate replaces the metered mean (a night frame of black trees and stars says
nothing about how bright the night is). Below `keyNightKneeNits` (0.78 nits, sun about 5 degrees down) the key falls only `keyNightSlope`
0.05 per EV, so a 0.18 card shows at about code 54 in deep twilight, 44 under the moon and 33 on a moonless night, with the camera near
its `maxGainEv` 24.5 (a Starvis-class low-light FPV camera). The sky is held where the +22 EV exposure had it (`skyHoldGainEv`), so a
moonless sky stays a dark blue-grey above a fainter ground. A frame metered darker than the estimate lifts the gain, at most
`nightLiftMaxEv` 2 EV. A moonlit forest interior at 23:00 (p50 about 14, a quarter near-black) is meant to look like that.

**Lamp cap** (`nightLampEv` 1). In the dark, the brightest 12% of the frame may sit at most `clipEv` + 1 EV over the key. Why: the
metered mean soft-clips highlights about 4.5 EV over the key and the day highlight rule is off at night, so a floodlit theme park could
lower the exposure only about 2.5 EV and 36% of the frame burned white. Gate LEDs and distant lamps are under 12% of the frame and don't
darken the night. Measured in the browser: park at 23:30 went from 36% clipped to 0.7%; track night and every day frame unchanged.

**Histogram range** -10 to +12 EV over the pre-exposure (`evMin`, `evMax`; 64 bins of 0.34 EV). Lamp-lit areas sit 10-14 EV over the
night estimate; with the old top at +8 the lit tenth piled into the last bin and the lamp cap saw too little light.

**Traps.** Every tuning key reaches the shader through `exposureDefines()` and a `${NAME}` const in `histogram.wgsl`: add both, or the
shader fails to compile and every frame is white. The TS mirror (`targetTotalEv`) must change with the WGSL. A test that assumes a value
sits mid-bin breaks when the bin grid moves.

**Verify.** `npx vitest run src/render/post`; park and track at 23:30 in `tools/audit/browser-check.mjs` (clipped share, mean); the
night levels in `exposure.test.ts`.

## White balance

**What** (`src/render/post/whiteBalance.ts`, `src/render/shaders/post/whitebalance.wgsl`). Each sampled pixel near the camera
(`maxDistance` 150 m) is a grey card: the meter divides the lit HDR by the albedo, so leaves don't read as a green illuminant. It
averages log chromaticity weighted by the square root of the light, smooths over `tau` 1.5 s, and corrects toward D65: nearly all of a
small cast, less of a strong one (`strength` 1, `soft` 0.8). Gains are written into the exposure buffer for the composite.

**Fade rules.** The correction is full with the sun 2 degrees up or higher (`sunHi` 0.035) and gone 4 degrees down (`sunLo` -0.07). Why: it
used to fade out below 15 degrees, which left a golden-hour frame (mostly skylit shade) blue-grey, with grass at r/g 0.7-0.8 where nine
golden-hour photos have 0.9-1.1. Balancing on the shade makes the sunlit parts warm: saturation at 18:48 went from 0.28-0.35 to
0.39-0.42 (photo mean 0.45). Blue hour, with the sun a few degrees down, stays blue.

**Golden-hour warmth** (`warmRG` 0.06, `warmBG` -0.12, `goldenWarmth`). Near the horizon the camera keeps part of a low sun's amber: the
log gains get this tilt in full from the horizon to 2 degrees up, none by 15 degrees (`warmSunHi`) or 4 degrees below. Why: balanced
fully, the 18:48 frames had a mean saturation of 0.41 against the photos' 0.45; with it 0.46. Noon and blue hour unchanged.

**Night white point.** Between sensor gain `gainLo` 9 and `gainHi` 14 EV the camera locks to a fixed cool white point (`nightRG` -0.3,
`nightBG` 0.45, about 3600 K): a moonless sky reads navy, the land cool grey.

**Verify.** `npx vitest run src/render/post/whiteBalance.test.ts`; audit saturation at 18:48 (`tools/audit/metrics.py`).

## Tonemap white point

**What** (`src/render/shaders/post/tonemap.wgsl`, `GRADE.dayWhite` 4.0, `dayPreScale` 0.58). By day the filmic curve is scaled so scene
luminance 4.0 (about 3.7 EV over the key) reaches display white; `dayPreScale` was refit so grass at 0.26 keeps code 135. It fades with
the daylight shadow lift, so the night curve is untouched.

**Why.** The Narkowicz fit needs 5x the key for code 250, so sunlit cloud tops stalled near 236 and frames fell 30-50 codes short of the
photos' p95. Gain: p95 +2 to +6 codes, mid-tones within 1 code. A clean A/B toward a 07:00 sun shows clipping only in the silver lining
next to the sun (0.06-0.34% of the frame), as photographs clip. Flat creamy cloud bodies are cloud lighting, not this.

**Trap.** `composite.test.ts` parses `GRADE` from the shader and mirrors the curve (`filmicRaw`, `whiteGain`): change both. The tonemap
curve is shared with the foliage owner (see `docs/foliage.md`); agree changes there.

## Haze and aerial perspective

**Boundary layer** (`HAZE_*` in `src/render/atmosphere/physics.ts`, mirrored in `src/render/shaders/sky/atmos_params.wgsl` `mediumAt`).
Aerosol of extinction 0.06/km (scattering 0.055) at the land datum, falling with a 0.5 km scale height above it. The datum is the observer
altitude: `frame.sky.z - camPos.y / 1000`. Why: the Mie layer runs from sea level, so at the 1200 m observer the valley air saw about
70 km and mountains 5-10 km away were as crisp as the foreground. Now about 34 km near the ground and 0.43 transmittance at 7.5 km, with only
about 0.03 extra zenith optical depth, so the zenith stays blue. Doubling Mie instead bleached the zenith and the clouds.

**Range** `AP_MAX_DISTANCE_M` 40 km (`physics.ts` and `src/render/shaders/common/atmosphere_sample.wgsl`). Why: the terrain's horizon
rings reach past the old 12 km, so far land got 12 km of haze against a full-path sky: a hard horizon line.

**AP shade** (`AP_SHADE_SKY_SHARE` 0.35, `AP_SHADE_RANGE_M` 60-400 m, in `src/render/shaders/lighting/deferred.wgsl`). The froxel volume
treats all air as sunlit; the air between the camera and a shaded surface nearby is mostly in the same shade. Near a pixel with RT sun
visibility 0 only the skylight share of the in-scatter stays; the term fades out by 400 m. p5 of shaded crowns fell 2-6 codes. At night it
is a no-op (pixel-identical at 23:30).

**Traps.** The transmittance and multiscatter LUTs are baked once per observer altitude (`src/render/atmosphere/lutPasses.ts`
`bakedAltitudeM`), because the haze sits on the land. The dev harness (`src/dev/render/atmosphereMath.ts`) imports the same medium; keep
it that way. `measure.mjs`'s `rap` term prints the AP before the shade factor.

**Verify.** `npx vitest run src/render/atmosphere`; vista and distant views in `tools/lightcast/measure.mjs` with
`--views-file tools/audit/views/vista.json`.

## RT ground bounce and cloud sky light

**Ground bounce** (`terrainGroundAlbedo` in `src/render/shaders/rt/rt_scene.wgsl`): GI rays that hit terrain take the mean albedo of the
ground layers there, at their noise means, so the bounce has the colour the raster draws.

**Cloud sky gain** (`rp.cloud.w`, set from `cloudAmbientScale` in `src/render/atmosphere/cloudModel.ts` by `src/render/rt/index.ts`). The
sky-view LUT is a clear sky, so the light clouds send down was missing from GI. The sky dome in RT `envRadiance` is multiplied by
1 + 0.8 c^1.5 (c the mean cover): 1.18 at the default cover, 1.8 overcast. Effect at the default: p5 +1, interior p50 +4.

## Night clouds

**What** (`src/render/shaders/sky/cloud_density.wgsl`, `cumulusDay`, `nightClearing`). Fair-weather cumulus dissipates after sunset. At
night the clearing takes weather off region by region (a broad value-noise mask `NIGHT_CLEAR_KM` 12 km across, depth `NIGHT_CLEAR_DEPTH`
0.6 above `NIGHT_CLEAR_LO` 0.3), so the clouds left keep their daytime shapes, a little flatter (`NIGHT_CUMULUS_TALL` 0.7).
`cumulusCoverage()` stays the day cover.

**Why.** Cutting the cover by raising the presence threshold (`NIGHT_CUMULUS_SCALE`) left only the cells' weather maxima: rows of
identical full-height domes that read as bullets with no moon and mushrooms under it. With the clearing, a full moon gives grey-blue bodies
with bright rims toward the moon, and a moonless sky gives irregular dark silhouettes against the airglow and Milky Way (the airglow sits
at about 90 km, above the clouds).

**Verify.** `npx vitest run src/render/atmosphere/nightClouds.test.ts`. Renders: `tools/lightcast/measure.mjs --clouds --date 2026-06-28`
(full moon, 14 degrees up at 22:00 and 23:30 UTC; 2026-06-21 has a half moon that sets near 23:00; `tools/audit/astro.mjs` prints both).
Flicker: `tools/lightcast/flight.mjs --clouds --date 2026-06-28 --hour 22 --static` logs `topDiff` (sky third, codes per frame): 1.3 at
extreme, under the 2-code check.

## Lighting cuts (time-of-day jumps)

**What** (`src/render/lightingCut.ts`). A frame whose sun or moon moved over 1 degree, or whose astronomy luminance estimate jumped over 2
EV, is a cut. `Renderer` then snaps the CPU pre-exposure, calls `RenderModule.resetLighting()` on every module (RT marks every probe
fresh and the temporal pass drops its GI, shadow and specular history; the atmosphere restarts the cloud history) and
`PostProcessor.resetHistory()` (TAA, exposure and white-balance adaptation start over).

**Why.** Moving the time slider from noon to midnight left noon light in the probes for seconds, which the night gain turned into
green-glowing crowns under a black sky. Root cause beyond history: a fresh probe took its bounce from the old probe set (noon light
rescaled into night exposure, about 2^20 too bright). On a fresh-probe frame (`rp.probePrev.w == 1`) `probeIrradiance` returns the
current sky and ground fallback instead. Eight frames after a noon-to-midnight jump the picture matches a fresh midnight render within 1.5
codes (36 before).

**Verify.** `npx vitest run src/render/lightingCut.test.ts`; render 12 then 23.5 in one renderer (`measure.mjs --hours 12,23.5`) and
compare with a fresh 23.5.

## Track props, gates and async pipelines

**Materials** (`src/render/shaders/objects/track_materials.wgsl`). `wearAt` gives fine terms (dust on upward faces, grime from the vertex
AO, soil splash in the bottom half metre, chips mostly low down, scuffs) and the large-scale terms that still read at 10-50 m (rain
streaks down vertical faces, grime over the bottom 1.5 m, blotchy tone, sun fade on sky- and south-facing paint). `weathered` applies
them once after the per-kind switch, which picks the bare material under chipped paint. Concrete is a mottled 0.25-0.3 with damp
patches and algae low on north faces; printed boards are 0.52; gate frame paint reflects 0.75 of the gate colour. Gate geometry,
colliders and LEDs are untouched, and the night LED cap holds (`src/render/objects/ledGlow.test.ts`).

**Traps.** `macro` is a reserved word in WGSL. Weathering was first called from six switch branches; the compiler inlined its noise six
times and the track pipeline took 3.8 s to compile (2.1 s now). Keep one call.

**Async pipelines.** The track pipelines compile with `createRenderPipelineAsync` (`src/render/objects/trackObjects.ts`), and the module
exposes `ready()`. `ModuleHost.init` awaits every module's `ready()` after all inits (`src/render/moduleHost.ts`), so compiles overlap
the later modules' init and the renderer reports ready only once everything can draw. Draws skip while a pipeline is null. Objects init:
2.34 to 0.33 s.

**Verify.** `npx vitest run src/render/objects src/render/moduleHost.test.ts`; gate close-ups on `.bench/hard-track/hard-106-t3.json`
with `tools/audit/views/props.json`.

## Realism audit method

**Photos.** `tools/audit/refs/<scene>/` holds Wikimedia Commons photographs with `sources.json` (title, licence, page, artist). Fetch
with `tools/audit/fetchrefs.py`. Before adopting one, list candidates with `tools/audit/findref.py "<query>"` (camera model and licence)
and look at it: one reference turned out to be a painting.

**Renders.** `tools/lightcast/measure.mjs` renders tree-shot views (`.bench/trees/views.json`) or a track's gate views (`--track`) with
the production renderer in Node (Dawn). Clouds are off by default, `--clouds` turns them on, and `--source <dir>` renders another copy
of `src/`. Use clouds off for A/B comparisons and the default sky for final sheets. `--dump` writes the pre-exposed HDR for
`tools/audit/termsplit.py` (sun, GI, specular and AP shares of the darkest 5%). Set `FPV_TREE_CACHE_DIR` to a folder of your own, or
agents rendering different source evict each other's tree cache.

**Metrics.** `python tools/audit/metrics.py <world-run> <track-run> <tag>`: luma p5/p50/p95, saturation, colourfulness and local
contrast beside each view's photo, plus a sheet. Views at 18:48 compare against the golden-hour photo. A photo of a different scene
answers "same kind of picture", not "same picture": read gaps by sign and spread over many pairs, not per pair.

**Browser.** `node tools/audit/browser-check.mjs` runs the real game (Vite, hmr and watch off, newest Playwright Chromium, hardware
WebGPU, autostart hover) per world, quality and hour: console errors, time to ready, renderer fps and GPU ms per pass, screenshots.
`--root <copy>` serves another copy of the app for A/B. Chrome compiles WGSL more strictly than Node and only the browser runs
IndexedDB, the worker tree build and BC7 bark, so check there before calling a shader change done.

**Performance.** `git worktree add --detach .bench/perf-head HEAD`, then `node tools/audit/perf-ab.mjs` and
`python tools/audit/perf-summary.py`: HEAD against the working tree, interleaved per case and round. HEAD before the theme park loads its
default track world for `world=theme-park`, so compare tracks. Per-module cost: `node tools/audit/modcost.mjs --tag x [--source dir]
[--detail 1]` times every module's init and setScene and the frame's GPU ms with each module's hooks switched off (`--detail` adds the RT
sub-passes and clouds). Run-to-run noise is about ±0.2 ms; wall-clock init times swing 1.5-3x while other work loads the machine.

**GPU lock.** Every tool takes the machine-wide lock (`tools/native-bench/lock.mjs`) per job. Keep jobs short and never delete a lock
whose process is alive.
