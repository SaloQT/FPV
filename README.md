# FPV Sim

A WebGPU first-person-view quadcopter simulator that runs in the browser: a rigid-body quad with a Betaflight-style flight controller,
procedurally eroded terrain with grass and trees, generated race tracks, a physically based sky with a real star catalogue and a
day/night cycle, and a hybrid renderer (rasterised G-buffer plus compute-shader ray tracing for shadows, global illumination and
reflections). Keyboard and mouse (WASD plus pointer lock), gamepads and USB radio transmitters fly it.

**What this is not.** The aim was "1:1 with real life, path-traced, 240 fps". That is beyond what a browser GPU can do today, and this
project does not claim it. It is a real-time hybrid renderer that pursues 240 fps with dynamic resolution and quality tiers on a strong
GPU and a 240 Hz display, and nobody has measured it on such hardware yet (see [Performance](#how-240-fps-is-pursued) and
[Known limitations](#known-limitations)).

## Quick start

```bash
npm install
npm run dev          # Vite dev server on port 5173
```

Open **http://localhost:5173** in a WebGPU browser and click "Click to fly".

- **Browser**: Chrome or Edge 113 or newer (Windows, macOS, ChromeOS; Linux may need `chrome://flags/#enable-unsafe-webgpu` and
  `#enable-vulkan`). Safari 26 and recent Firefox builds ship WebGPU on some platforms but are not tested here.
- **Hardware acceleration must be on**, and `chrome://gpu` should list WebGPU as "Hardware accelerated". Software adapters work but
  render at about 1 fps (see below).
- **Use `localhost` or HTTPS.** WebGPU only exists on secure pages: `npm run dev` also listens on the network (`--host 0.0.0.0`), but
  opening it by a LAN address such as `http://192.168.1.20:5173` gives "WebGPU is not available". Use `http://localhost:5173` (the failure
  panel's hint names the port the page was actually served on, so `npm run preview` says 4173).
- If WebGPU is missing (no `navigator.gpu`, or an insecure page), no adapter is found, the app code fails to load or startup fails, the page shows a
  full-screen explanation with troubleshooting steps and a Reload button; it never stays blank.
- Other scripts: `npm run build` (typecheck, then the production build), `npm run preview` (serves `dist/` on port 4173), `npm run typecheck`,
  `npm test`, `npm run shot` (headless screenshots) and `npm run bench` (benchmark runner, see [Benchmark](#benchmark)).
- Node.js: a current LTS (developed on Node 22).

### Production build

`npm run build` writes `dist/`: `index.html`, six script chunks in `dist/assets/` (WGSL shader sources about 360 kB, renderer code about 240 kB,
world and physics code about 130 kB, UI and app code about 160 kB, a ~10 kB entry that holds only the failure screen, so a chunk that fails to load still
shows the panel, and a 66-byte `app` file that only re-exports the UI chunk's entry), the 20 kB terrain worker (a seventh `.js` file), two stylesheets (the
failure panel and the rest of the UI) and `data/stars.bin` (660 kB). No chunk is over Vite's 500 kB warning limit.
Asset URLs are relative (`base: './'`) and the star catalogue is fetched under `import.meta.env.BASE_URL`, so `dist/` runs from any directory
of a static host, not only from the domain root; WebGPU still needs HTTPS (or localhost). Source maps are not built unless you ask for them:
`FPV_SOURCEMAP=1 npm run build`. The `?dev=<name>` module pages exist only on the dev server (`npm run dev`), not in the production build.

## Controls

Read from `src/input/bindings.ts`, `src/input/gamepadMap.ts` and the in-game cheat sheet (**F1**). Click the canvas to capture the mouse,
**Esc** gives it back and opens the menu.

| Input | Action |
| --- | --- |
| Mouse (captured) | Roll and pitch (a virtual gimbal; mouse up is nose up). Settings: sensitivity, centring spring, expo, deadzone, invert |
| **W / S** | Throttle up / down. Hold to ramp; release to ease down, faster at high thrust and gently near idle |
| **Shift** | Throttle ramps 2.5x faster while held. **X** cuts the throttle to zero |
| **A / D** | Yaw left / right |
| **Q / E** or **Left / Right** | Roll left / right |
| **Up / Down** | Pitch nose up / down |
| **Space** | Arm / disarm |
| **T** (hold) | Turtle mode: flips an upside-down quad over |
| **R** | Respawn at the last gate. **Backspace** restarts the run. **N** generates a new track |
| **C** | Cycle camera: FPV, chase, free (free camera: drag to orbit, wheel to zoom) |
| **V** | Cycle flight mode: Acro, Angle, Horizon |
| **P** | Pause |
| **, / .** | Time of day minus / plus 15 minutes (hold to repeat) |
| **Esc** / **F1** / **F3** | Menu and settings / controls cheat sheet / performance overlay |
| Gamepad | Sticks fly. Buttons (standard layout): A arm, B turtle, X camera, Y respawn, LB flight mode, Start menu |
| USB radio | Detected automatically; AETR or TAER channel order; arm and mode switches on channels 5 and 6. Calibrate in Settings |

The settings menu (Esc, or "Settings" on the start screen) has Graphics, Camera, Controls, Simulation and Audio tabs. Settings are saved in
`localStorage` (key `fpv.settings.v1`). Audio starts only after the first click or key press, as browsers require.

### URL parameters

Handy for sharing a world and for the test tooling (`src/app/params.ts`, `src/app/perfParams.ts`):

| Parameter | Meaning |
| --- | --- |
| `seed=<n>` `style=race\|freestyle\|mountain\|sprint\|technical\|acro\|industrial` `gates=<n>` `laps=<n>` `diff=<0-100>` | World and track (difficulty in percent) |
| `tseed=<n>` | The track's own seed when it is not the terrain seed (the N key and the generator's retries move it). Honoured by the first build too, also with `autostart=1`; `window.__fpv.stats.request` shows the track request that was built |
| `t=<0-24>` | Local solar hour at the flying site |
| `quality=low\|medium\|high\|ultra` `perf240=1` `scale=<0.25-1>` `dyn=0\|1` | Rendering |
| `target=<fps>` `cap=<fps>` `refresh=<hz>` | Dynamic-resolution target (0 = display), frame cap (0 = none), assumed display refresh |
| `cam=fpv\|chase\|free` `autostart=1` `scenario=hover\|fly\|crash\|gate` | Skip the menu, scripted autopilot (`agl=<m>` hover height) |
| `countdown=0\|1` `hold=1` `advance=<frames>` `fixeddt=<s>` | Force the 3-2-1-GO on or off (off for `autostart` runs), do not start the real-time loop once the app is ready, run this many deterministic frames before ready, and use a fixed frame step (test tooling) |
| `wind=<m/s>` `winddir=<deg>` | Wind |
| `bench=1` `benchSeconds=<s>` `benchWarmup=<s>` | Benchmark (below) |
| `gpuProfile=1` | Explicit diagnostic timestamp breakdown; off by default, with RT pass segmentation overhead |
| `brain=<name>` `race=<a,b,c>` | A trained brain from `public/brains` flies your quad, or a spectator race between those brains starts (AI pilots below) |
| `mode=builder` `trk=<code>` | Open the track builder instead of the start screen; `trk` is a builder recipe (builder share links carry it), built on the terrain of `seed` and `quality` |

Parameters change the running session only; they never overwrite the pilot's saved settings. **Share links** (the world card's Copy link) carry
`seed`, `tseed` (only when it differs), `style`, `gates`, `laps`, `diff` and `quality`: the terrain grid size depends on the quality tier, so a link
names the tier its terrain was built on.

## Features, exactly

- **Flight model**: 4 kHz fixed-step rigid body (quaternion attitude; the rate is selectable from 1 to 8 kHz), four brushless motor and
  ESC models, propeller thrust and torque from rotor speed and local inflow with air density by altitude and Cheng ground effect, a LiPo
  pack (open-circuit voltage curve, ohmic resistance, one RC polarisation branch), anisotropic quadratic body drag, wind with
  Dryden-style turbulence and travelling gusts, and a sphere-proxy contact solver against the terrain height field and oriented boxes
  (gates, trees, rocks). One airframe preset exists, a 5 inch 6S quad (`src/sim/presets.ts`); the menu shows it as a fixed airframe, not a choice.
- **Flight controller** (Betaflight-style, `src/sim/fc`): gyro low-pass filters, RPM-locked notch bank, Betaflight "actual" / "betaflight" /
  "quick" rate curves, angle and horizon self-levelling on a Mahony attitude filter, rate PID with D on measurement, I-term relax,
  anti-gravity, TPA and feed-forward, a quad-X mixer with airmode, idle, thrust linearisation and turtle mode, and an IMU model with noise,
  bias and motor-locked vibration.
- **Terrain** (`src/world/terrain`, built in a Web Worker): a domain-warped ridged macro shape with a valley corridor, stream-power valley
  incision, grid refinement, Beyer droplet hydraulic erosion, thermal talus and soil creep, then material maps (flow, soil depth,
  sediment, wetness) and optional lakes. Map size 2 to 4 km by tier (512 x 512 at 4 m on Low up to 2048 x 2048 at 2 m on High), 220 m of
  relief. Rendered as a geometry clipmap with procedural micro-relief and ground materials driven by the maps.
- **Vegetation**: GPU-driven grass blades with three LODs, wind and prop-wash, with meadow flowers (round heads in four colours, white ox-eye
  daisy, buttercup yellow, violet and pink clover, on a small share of the blades, in drifts); procedurally grown trees and bushes with LODs and
  wind; boulders. Placement follows slope, soil depth and wetness (nothing grows in rivers).
- **Track generator**: seven styles with gate spacing, turn-radius, slope and clearance validation; gates with LEDs, flags, cones and
  obstacles; gate timing, laps and splits. race, freestyle, mountain and sprint are the original four (their tracks are unchanged, so old
  share links still work). **technical**, **acro** and **industrial** are built from manoeuvres: split-S, power loop, corkscrew, ladder,
  dive, drop, slalom, hairpin, tunnel, window and hurdle. Gate kinds: square, arch, hoop, dive, flag, window (an opening in a wall), ladder
  rungs, tunnel (a sleeve of walls and roof), hurdle (a low bar near the ground) and drop (a flat ring flown straight down). Obstacles:
  trees, rocks, poles, cones, walls, flagpoles, towers, shipping containers, pillars, beams, bridges and scaffolds. Every kind collides as
  boxes, so the physics and the GPU trainer fly them like the old ones.
- **Track builder** (Track builder on the start screen or in the menu, or `?mode=builder`): every variable of a track on sliders (seed,
  circuit or point to point, laps, gates, length, difficulty, elevation, twist, obstacles, the share of manoeuvres, and weights for each
  manoeuvre, gate kind and object), a 3D preview you can steer (mouse and WASD, Spin, Fit), a top-down map and a side elevation strip.
  **Fly it** flies the track yourself; **Race** and **Benchmark** put the AI pilots on it. Each track has its own **leaderboard** (your
  runs and the brains', kept in the browser per track and terrain). The library saves and loads tracks, **Export** writes a JSON file that the
  trainer flies with `--track`, and Copy link shares the recipe.
- **Start screen and race flow**: the first screen has the big "Click to fly" button, the world card (a **seed** field that takes a number or any
  word, with Random and Copy link buttons; the track style, gates and laps; and a **top-down map of the track** with numbered gates, height
  colouring, scale bar and a progress bar while the next course is generated), the time-of-day control and a controls reminder. A race starts with a
  **3-2-1-GO** countdown on the pad (the quad stays disarmed until GO; switch it off in Settings, Simulation for free flight). After the last gate a
  **result card** shows the total time, the best lap, every lap against the best, the best lap's gate-to-gate bars and the buttons Restart (**R**), New track
  (**N**) and Menu. A **stick indicator** on the OSD (two boxes with roll, pitch, yaw and throttle; Settings, Camera, On-screen display) shows what you send.
- **Sky and time**: Hillaire-style atmosphere (transmittance, multiple-scattering, sky-view and aerial-perspective tables), ray-marched clouds
  with temporal accumulation (default cover 0.40 cumulus and 0.30 cirrus, no menu field; through twilight the cumulus falls to 35 % of that), the Sun
  (Meeus), the Moon (full ELP truncation, phase and light) and Mercury to Saturn (JPL elements). **Stars are real**: 41,487 stars to magnitude 8 from the
  HYG v4.1 catalogue (`public/data/stars.bin`), plus a baked Milky Way, airglow and zodiacal light. At night the **ambient light** carries them too,
  not only airglow: the zodiacal light, the Milky Way and the stars brighter than magnitude 6.5 are integrated over the sky dome
  (`src/render/atmosphere/nightDome.ts`) into the sky-view table that lights the ground and the reflections (together about 35 % of a moonless
  sky's illuminance). **Cloud shadows**: the clouds bake a top-down transmittance map for the Sun and the Moon; the ray-traced key-light shadow and the
  shading of ray hits (which feeds the GI and the probes) multiply it in, and the deferred pass reads the ray-traced shadow. The date and the hour are in the menu,
  and the clock can be fixed at an hour, follow the real time, or run as a day cycle at **1x to 1000x** (a day in 86 s at the top speed); the observer
  (default 46 N, 8 E, 1200 m) is part of the saved settings but has no menu field. The light is physical (lux and nits) with a camera-style auto
  exposure (see [Rendering pipeline](#rendering-pipeline)).
- **FPV camera**: tilt, field of view, lens distortion, chromatic aberration, vignette, rolling-shutter lean, motor vibration ("jello"), physical
  motion blur (1/400 s exposure), sensor shot noise and an analogue/digital video-noise look, plus an OSD (battery, speed, altitude, timer, gate).
- **Audio**: motor tones from the rotor speeds, wind, prop-wash, impacts and beeps, synthesised with Web Audio.

## AI pilots (PPO drone brains)

A brain is a small neural network (40 inputs, two tanh layers of 128, 4 outputs) trained with PPO to fly this game's quad. It sees
what a pilot would know (body-frame velocity and rates, which way is up, height above the ground, the next two gates in body
axes, its last sticks, motor speeds, battery) and moves the acro sticks 50 times a second. The real flight controller, motors and
airframe in `src/sim` do the rest, so a brain flies exactly the quad you fly.

**Watch one fly:** Esc, **AI pilots** tab, pick a brain, **Fly**. It arms on the pad, flies the track and respawns at the last gate
after a crash. **Stop** gives the sticks back (a quad in the air keeps hover throttle). **Load a brain file** adds any brain JSON
the trainer wrote. `?brain=ace` does the same from the URL.

**Spectator race:** tick two or more brains under **Spectator race** and **Start race** (or `?race=ace,dash,steady,rookie`). The
first brain flies your quad; the others fly their own copies of the physics in lockstep with it, on the same ground, obstacles
and wind, after the same 3-2-1-GO. They are ghosts: drones do not collide with each other. Each racer's rear LEDs carry its
colour on the leaderboard (top right). **Camera follows** picks whose quad the camera rides with; C still switches first person,
chase and free. Restart run (Backspace) restarts the race.

**Training** runs headless on the GPU in Node (Dawn through the `webgpu` package; D3D12 on Windows):

```
node tools/brain/train.mjs --name ace --minutes 30            # writes public/brains/ace.json; dashboard on http://127.0.0.1:8787
node tools/brain/train.mjs --name ace2 --resume public/brains/ace.json --minutes 10 --lr 1e-4
node tools/brain/train.mjs --name tech --styles technical,acro --recipes 12 --track my-track.json
node tools/brain/eval.mjs public/brains/ace.json --worlds 4 --styles technical,acro --recipes 2   # times it in the TypeScript sim on unseen tracks
```

Every drone of a training batch (16384 by default) runs on the GPU: a WGSL transcription of `src/sim` (rigid body, motors,
props, battery, IMU, wind, the flight controller with its filters, PID and mixer, contacts with terrain, pad, track boxes,
trees and rocks), the gates, reward and resets, then the policy, GAE and the PPO update (tiled GEMMs, split-K gradients, Adam).
Only a few metrics come back to the CPU per iteration. On an RX 9070 XT that is about 1.5 million decisions (120 million
physics steps at 4 kHz) per second on the original four styles once the policy stops crashing (a fresh run starts nearer 1.3
million); the default mix with the new styles is heavier, about 1.0 to 1.1 million.

The reward follows progress along the track's racing line, plus each gate passed. On a point-to-point track the line starts at
the pad, so the take-off leg to the first gate pays too. Options: `--envs`, `--steps`, `--worlds [48]` (few worlds overfit),
`--styles` (default every generated style in turn), `--recipes [worlds / 6]` random track-builder recipes among the worlds, `--track
a.json,b.json` builder exports or track files flown as extra worlds, `--seed`, `--lr`, `--lrEnd`, `--every` (checkpoint minutes),
`--out`, `--env crashPenalty=30,ratePenalty=4e-4` (reward settings in `src/ai/gpu/envKernel.ts`). `--styles
race,freestyle,mountain,sprint --recipes 0` gives the 48 worlds the trainer used before the new styles.

**Live dashboard:** while it trains, `train.mjs` serves a dashboard on http://127.0.0.1:8787 (`--dash <port>`, `--dash 0` turns it
off). It shows 15 interactive charts (return, crash rate, gates per minute, laps, best lap, KL, losses, action spread, throughput and more), a top-down
view and a side profile of the training worlds with the traced drones (`--trace [256]`) flying them, and a timeline you can scrub back
through or keep on Live. On a chart, Ctrl or Shift + wheel zooms, drag pans, click scrubs and double-click resets. Save writes a
checkpoint after the current iteration; Stop ends the run. The dashboard costs under 1 % of throughput. Every run is also written to
`.bench/brain/runs/<name>.train.ndjson` and `.trace.bin`; `node tools/brain/dashboard.mjs --run .bench/brain/runs/<name>` replays it,
and `node tools/brain/dashboard-demo.mjs` shows the dashboard with made-up data and no GPU.

Checks that the GPU copy is the game's flight model:

- `node tools/brain/parity.mjs`: five scripted flights (pad take-off, windy gate run, flips, a drop into the ground, a flight
  into an obstacle) on the GPU and in `QuadPhysics`; positions agree to a few millimetres over 2 s.
- `node tools/brain/obscheck.mjs`: the GPU observation against `src/ai/observe.ts`, slot by slot.
- `node tools/brain/gradcheck.mjs`: GPU PPO gradients against a float64 CPU reference.

`npm run brain:check` runs all three. `node tools/brain/publish.mjs <brain.json>...` copies brains into `public/brains` and
rebuilds its `index.json`. `npm run test:dash` runs the dashboard's tests (`npm test` runs them after vitest).

Code: `src/ai` (spec, observation, brain file and policy, BrainPilot, BrainRacer), `src/ai/gpu` (WGSL kernels),
`src/ai/train` (worlds, trainer, checks, evaluation), `src/app/brains.ts` (the hub behind the AI pilots tab and the race).

## Architecture

```
src/
  main.ts        entry: checks for WebGPU, then loads the app (or, on the dev server, a stand-alone module page with ?dev=<name>)
  app/           boot, the real-time loop (frame cap), scene and world loading, settings wiring, test hooks,
                 benchmark, display-refresh measurement, failure screen and device-loss recovery
  audio/         Web Audio engine: motor synthesis, wind, impacts, beeper
  contracts.ts   shared types: settings, quad state, terrain and track data
  dev/           stand-alone pages for one module each (sky, terrain, vegetation, objects, post, rt, render, audio, ui); dev server only
  game/          session state machine, fixed-step stepper, gate timing, camera rig, simulated clock
  input/         keyboard, mouse (pointer lock), gamepad and radio, merged into one stick input
  render/        Renderer, frame graph, G-buffer, deferred lighting, dynamic resolution, GPU timer, quality profiles,
                 shader library (shaders/*.wgsl) and the modules atmosphere/, terrain/, vegetation/, objects/, rt/, post/
  sim/           quad physics (motor, propeller, battery, aero, collision, IMU, wind) and fc/ (the flight controller)
  ui/            menu and settings schema/store, HUD and OSD, help sheet, F3 overlay, loading, failure screen, benchmark panel
  world/         terrain/ (generation and erosion), track/ (generator and validation), astro/ (Sun, Moon, planets, stars, clock)
  ai/            drone brains: observation, policy, BrainPilot, BrainRacer; gpu/ (WGSL trainer kernels), train/ (PPO trainer, checks)
tools/           shot.mjs (headless screenshots), bench.mjs (benchmark runner), build_stars.py (star catalogue), brain/ (train, eval, checks, live dashboard)
public/data/     stars.bin (HYG v4.1, magnitude <= 8)
public/brains/   trained brains and index.json (the AI pilots list)
```

For browser-free GPU measurements and a serialized shared agent queue, see [Native frame benchmark](tools/native-bench/README.md). `npm run bench:native` executes the production renderer through Dawn in Node, and `npm run bench:compare` compares immutable artifacts after fixed warmup. These measure offscreen costs; the browser harness remains the check for browser behavior and presentation.

`src/render/README.md` documents the render core (frame graph, bind groups, units, how to write a module).

## Rendering pipeline

Per frame, in this order:

1. **CPU update, pre-passes** (compute): atmosphere tables and clouds, grass and tree culling and generation.
2. **G-buffer** (raster): terrain clipmap, water, grass, trees, boulders, gates and the quad into four render targets plus reverse-Z depth.
3. **Ray tracing** (compute): sun shadows, diffuse global illumination (1 or 2 rays per pixel), optional specular reflections, and a camera-centred
   grid of radiance probes (SH-L1) for multi-bounce light and rough surfaces; temporal accumulation and an a-trous denoiser. Run at full, half or
   quarter resolution depending on the tier.
4. **Deferred lighting** (compute) into an HDR target, then **sky** and clouds and a forward pass (glow, translucent parts).
5. **Post**: motion blur, temporal anti-aliasing with upscaling (TAAU, render size to output size), auto exposure and bloom on the resolved image, then
   one composite pass: the camera model (lens, rolling shutter, vibration, video noise), tonemap and sensor noise.
   - **Auto exposure** is depth-split: the stage keeps a log-luminance histogram of the resolved image for the sky pixels (G-buffer depth 0) and one
     for the ground, weighted towards the centre and the ground, and the ground leads. A sky far brighter than the ground (dusk) is folded down to a
     fixed margin above the ground's metered level before the trimmed mean is taken, so it cannot push the grass into black; a daylight sky is
     metered as it is, and with the ground out of frame the sky is metered. The adapted state is the total exposure (CPU pre-exposure times a
     GPU-computed ratio), so a pre-exposure change does not make it hunt. In the dark it follows the astronomy, up to a starlight-camera gain of
     about +22.8 EV. The exposure ratio buffer is 32 bytes: ratio, sensor gain EV, metered mean EV, total EV, highlight knee, roll-off strength and two
     spare floats.
   - **Highlight roll-off** keeps hue: the tonemap curve acts on luminance and the colour keeps its chromaticity, with a smooth knee on chroma so the
     brightest channel does not sit on white. Luminance far above the ground's metered level (a dusk sky, a sun-side horizon glow) is also compressed
     by a knee the exposure stage reports (off when the camera looks up and in the dark), so the sky keeps its gradient and colour below the clip.

**What is and is not ray traced.** The scene is a *software* BVH built on the CPU over analytic primitives (boxes, capsules, spheres, tori): the gates,
the quad, and the trunk (capsule) and canopy (sphere) proxies of the 300 trees nearest the track start. A canopy sphere is not opaque: light
crossing it is attenuated by a leaf-density extinction (leaf area density times a clumping index of 0.8, with a noisy, fluffy rim and clump-scale
gaps), so a crown casts a soft, partly transparent shadow, and a ray that ends inside a crown sees leaf scatter (leaves reflect and transmit, so a
crown glows green with the single-scatter albedo, not the dark reflectance of the proxy) blended with the sky behind it. Terrain is ray marched
through a height-field max pyramid. There is no hardware ray tracing (WebGPU has no such API) and it is not path tracing. **Foliage is not traced**:
grass, bushes, boulders and individual leaves cast no ray-traced shadows or bounce light; the trees only through their coarse proxies.

### Quality tiers

| Tier | Ray targets | GI rays | Ray steps | Reflections | Probe grid (rays, spacing) | Cloud steps | Grass per m2 / distance | Terrain view | Detail octaves | Terrain map |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Low | 1/4 | 1 | 48 | off | 16x8x16 (32, 8 m) | 16 | 60 / 35 m | 1500 m | 2 | 512 x 512 at 4 m |
| Medium | 1/2 | 1 | 64 | off | 24x12x24 (48, 6 m) | 24 | 150 / 55 m | 2500 m | 3 | 1024 x 1024 at 3 m |
| High | 1/2 | 2 | 96 | on | 32x16x32 (64, 5 m) | 32 | 400 / 80 m | 3500 m | 4 | 2048 x 2048 at 2 m |
| Ultra | 1/1 | 2 | 128 | on | 48x24x48 (96, 4 m) | 48 | 900 / 120 m | 5000 m | 5 | 2048 x 2048 at 1.5 m |
| **Performance 240** | 1/2 | 1 | 64 | on | 24x12x24 (32, 6.5 m) | 19 | 260 / 68 m | 3500 m | 3 | as High |

Low has no bloom. **Performance 240** is High with the budgets that cost most cut where temporal accumulation hides it: one GI ray, shorter ray
walks, a smaller probe grid that refreshes more often, fewer cloud steps, thinner and nearer grass and one detail octave less. Ray-target
resolution, reflections, bloom and TAA stay. It derives from the High profile (`src/render/qualityPresets.ts`). The probe ray budget is not a fixed
number: it follows the profile's GI rays x ray steps (150,000 probe rays per frame at High's 2 x 96, never below 20,000), so a cheaper tier traces
fewer probe rays per frame and refreshes each probe less often (the longest rotation allowed is 16 frames at High's ray work, up to 32 for less). The tests
check that every tier costs more than the one below it and that the preset costs clearly less than High, using an analytic proxy of the work each
profile asks for (`qualityCostIndex`, which takes the same probe limits the ray-tracing module uses), which is not a GPU measurement. Switching the
preset or the tier live changes the ray, probe, cloud and grass budgets at once. Performance 240 keeps the tier, so only the grass is rebuilt (thinner and
nearer); a tier change also rebuilds the trees and the far-forest cards, while the terrain keeps the grid it was built with until the next world build (the start screen
builds one in the background when the tier changes; in flight it is the next **N**).

## How 240 fps is pursued

- **The display decides.** A browser canvas cannot turn v-sync off: frames are paced by `requestAnimationFrame`, so the frame rate can never
  exceed the display refresh. 240 fps needs a 240 Hz display *and* a GPU that renders a frame in under 4.17 ms. The old "V-sync" setting did
  nothing and was removed.
- **Measured refresh.** At startup, about 60 idle frames are timed; the median interval of the on-time frames is snapped to a common rate
  (50, 60, 75, 90, 100, 120, 144, 165, 180, 240, 360 Hz) and used as the default target frame rate ("Display refresh (measured)"). `?refresh=` overrides it.
- **Dynamic resolution** (on by default): the render scale steps through 100, 90, 80, 70, 60, 50 and 42% of the Render scale setting. It decides
  on GPU time from timestamp queries when the device has `timestamp-query`, otherwise on missed refreshes. It steps down when the mean of six
  frames is 2% over budget (two steps when 1.6x over), and steps up only when the cost predicted for the next step stays under 85% of the budget.
  Without timestamp queries it has to probe upwards to find headroom: a probe is abandoned as soon as three of its frames (from the sixth on) have missed a refresh, and
  a step that keeps failing is not retried for 8 s, then 16, 32, 64, 128 and at most 256 s, so it settles instead of oscillating. A frame over a second
  long (a device under 1 fps) counts as a missed refresh instead of being ignored, so even a software renderer is scaled down, a step every four seconds or so;
  one huge frame from a background tab moves nothing.
- **TAAU** reconstructs the output resolution from the lower-resolution jittered frames.
- **Frame cap** (Graphics, "Frame cap"): Display / 240 / 144 / 120 / 60 / 30. It skips refreshes to hold the cap on average; a cap at or above the
  refresh rate does nothing, and the dynamic-resolution target never aims above it.
- **Tiers** and the **Performance 240** preset (above).
- **Measuring**: F3 shows the measured refresh, target, actual fps, render size and scale, GPU time and, when `timestamp-query` exists, a table of GPU time per
  pass (pre-passes, G-buffer, ray tracing, lighting, sky and forward, post) plus the count of GPU errors. Browsers coarsen timestamps and GPUs can overlap
  neighbouring passes, so the per-pass times are estimates.

**Hardware needed.** A 240 Hz display and a strong discrete GPU. None of this has been timed on real GPUs: development ran on SwiftShader, a
software WebGPU, which renders at about 1 fps and is used only to check correctness in tests and screenshots. Expect to need Performance 240
and/or a lower render scale before a mid-range GPU holds 240.

### Benchmark

`http://localhost:5173/?bench=1` flies a scripted 20 s fly-through (the `fly` autopilot, FPV camera, noon, seed 1337, still air) at fixed settings:
no dynamic resolution, no frame cap, full render scale; `quality=`, `scale=`, `perf240=1`, `seed=`, `t=` choose another setup. After a 2 s warm-up it measures and then
shows a results panel and sets `window.__fpv.bench = { avgFps, p1LowFps, avgGpuMs, perPassMs, renderScale, device: { vendor, architecture, ... }, ... }`
(`window.__fpv.benchDone` is the promise of it). `benchSeconds=3&benchWarmup=0` gives a quick run. From a shell (`npm run bench -- <options>` is the same):

```bash
node tools/bench.mjs                              # SwiftShader: proves the pipeline runs, numbers are meaningless
CHROME_BIN=/usr/bin/google-chrome node tools/bench.mjs --gpu --seconds 20 --query "quality=high"
CHROME_BIN=/usr/bin/google-chrome node tools/bench.mjs --gpu --uncapped   # also lifts Chrome's frame limit (--disable-frame-rate-limit --disable-gpu-vsync)
```

`tools/bench.mjs` starts the Vite dev server (or uses `--url`), drives Chromium with Playwright, waits for `window.__fpv.bench`, prints it as JSON
(`--out file.json` also saves it) and exits 1 on any page error. Other options: `--seconds`, `--warmup`, `--size 1920x1080`, `--query "quality=ultra&perf240=1"`,
`--headed`. **`CHROME_BIN` must point at a Chrome or Chromium executable that has WebGPU** for `--gpu`: Playwright's package here ships no browser. Without
`CHROME_BIN` the software run falls back to `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`, the Chromium of the development container, which
exists nowhere else (`tools/shot.mjs` has the same fallback); both tools report a browser that cannot start with this hint instead of a stack trace (exit code 2),
and stop the Vite server they started on that path and on Ctrl-C.

Observed frame rate includes CPU work, GPU work and browser scheduling, and may be presentation-limited. GPU timestamps describe GPU intervals, not guaranteed achievable FPS. `--gpu` requests the browser's default adapter but does not prove hardware rendering; check adapter identity. `--uncapped` uses the runner's existing frame-limit/v-sync overrides and has not been verified on physical hardware.

#### Optional detailed GPU diagnostics

`?bench=1&gpuProfile=1` (or `node tools/bench.mjs --profile`) exports diagnostic GPU categories in `profile.perCategoryMs`: probes, screen-space rays, denoising, clouds, post, RT auxiliary and RT latch. The existing panel's **Copy JSON**, `window.__fpv.benchDone`, and the runner's `--out` include the same result. This does not change saved settings, quality budgets or shaders.

- With profiling **off**, the existing seven coarse timestamps, single RT compute pass and GPU command order are retained
- With profiling **on** and `timestamp-query` supported, RT is split only at category boundaries. Trace → temporal → à-trous order, dispatch sizes and history/probe updates remain unchanged. Cloud timings use the existing combined cloud pass; post reuses its coarse interval
- Probe timing includes planning/compaction and updates. Screen rays sum shadow/GI/optional specular trace intervals; denoising sums their temporal and à-trous intervals. Clouds include lighting precompute, march, temporal resolve and the shadow map. Categories are subsets of coarse sections: do not add them to the coarse total
- Pass segmentation and queries add overhead. Detailed runs diagnose costs; compare normal throughput with profiling off. Timestamp granularity and backend scheduling also limit precision; zero-duration samples may be quantized
- Unsupported timestamp queries yield explicit `unsupported` mode and null GPU values, with no profiling-only segmentation. Software adapters are labeled software; unknown/unverified adapters are never certified as physical hardware by the runner
- GPU samples are attributed once to their originating presented frame, excluding warmup and captures. Three asynchronous readback slots never block rendering. The result reports dropped, failed, invalid and pending samples; skipped category slots cannot reuse old query values. A bounded asynchronous drain runs outside the measured window; timeout/device loss/configuration change marks the result incomplete

Schema version 2 retains `avgFps`, `p1LowFps`, `avgGpuMs`, `perPassMs` and existing device/size fields. It adds profiling mode, per-category sample/skip/invalid counts, frame attribution and provenance: full effective settings/quality profile, scenario/world, resolution, refresh source and browser identity. Runner exports also include launch arguments, browser version and source snapshots before/after the run. A clean unchanged locally served checkout has a verified source commit; dirty or external `--url` builds have a null exact revision, with the uncertainty recorded. A Git HEAD alone is not proof of the served build.

For a baseline/final comparison on the user's physical GPU:

1. Use separate clean checkouts and identical browser, launch mode, viewport, effective quality, scale, scene, time, camera, warmup and duration. Keep foreground state/power conditions consistent. The benchmark still inherits some saved simulation/observer settings; compare the exported settings, not just the command line
2. Run alternating repeated baseline/final measurements with profiling off, keeping every JSON and comparing the spread. Example: `CHROME_BIN=/path/to/chrome node tools/bench.mjs --gpu --size 1920x1080 --seconds 20 --warmup 5 --query "quality=high&scale=1&seed=1337&scenario=hover&cam=fpv&t=12" --out ../baseline-normal.json`; repeat unchanged in the final checkout with a different output path outside the checkout (untracked result files would make later source snapshots dirty)
3. For category comparison, apply the **same instrumentation** to both revisions and repeat with `--profile`. Never compare an uninstrumented baseline against a segmented final run as an optimization gain
4. Reject comparisons with incompatible provenance, renderer errors, loss, changed configuration or unfinished readbacks. Inspect sample/drop counts and adapter identity. Capture visual comparisons separately from the measured run
5. The real-time fly scenario is not a frame-identical replay across different performance. Use a stable hover scene as an additional controlled comparison; no result is a guarantee of 240 FPS

Cloud-native Dawn/SwiftShader validation can check descriptors, readbacks, dispatch order and image/probe parity. It is software correctness evidence only; physical-GPU speed and instrumentation overhead remain unmeasured. See [GPU diagnostics validation](PERFORMANCE_GPU_DIAGNOSTICS.md) for the separately recorded native checks.

## Testing

- `npm test`: the vitest suite (over 170 files: physics against known values, terrain and track generators, input mapping, the astronomy against
  worked examples from the astronomy literature, WGSL include resolution, CPU references of the ray tracer, the dynamic-resolution controller, settings, the failure and perf models).
- `npm run typecheck`: strict TypeScript.
- `node tools/shot.mjs --query "autostart=1&scenario=hover&cam=fpv&t=12&seed=1337&quality=low&dyn=0&scale=0.5" --out shots/x.png --size 960x540 --wait 300000`
  starts Vite, opens the app in headless Chromium with software WebGPU, waits for `window.__fpv.ready`, prints errors and a stats JSON and saves a
  screenshot. `?dev=sky|terrain|vegetation|objects|post|rt|render|audio|ui` open single-module pages for the same tool (dev server only; the tool starts one). Every WGSL compile error and
  WebGPU validation error is printed and fails the run. A screenshot at 1 fps takes minutes; add `hold=1` to freeze the loop.
- `window.__fpv` (`ready`, `error`, `stats`, `state()`, `race()`, `capture()`, `brightness()`, `advance(n)`, `newTrack()`, `newWorld()`, `patch()`, `cam()`,
  `loseDevice()`, `brains`, `bench`) is what tests and tools drive. `stats` carries the seeds (`seed`, `baseSeed`, `terrainSeed`) and the exact track request
  that was built (`request`). With `hold=1` the loop does not start, but a lost device still shows the failure panel and Recover starts the loop.

## When things go wrong

- **No WebGPU, no adapter, device refused, app code that fails to load**: a full-screen panel names the cause, lists steps (hardware acceleration,
  `chrome://gpu`, flags, drivers, secure context) and offers Reload. `main.ts` checks `navigator.gpu` before it loads the app, no module reads a WebGPU
  global when it is loaded (a test imports every non-dev module without those globals), and a GPU that cannot start is reported at once, without waiting
  for the terrain to finish building. Checked in headless Chromium on an insecure origin, with `navigator.gpu` removed, and with the app chunk blocked.
- **Device lost mid-session** (driver reset, GPU hang): the loop stops and the panel offers **Recover**, which builds a fresh renderer on the same canvas and
  puts the world back without reloading; your settings and the run are kept.
- **Uncaught errors** show the panel too, with "Keep going". GPU validation errors go to the console and to the error count in F3.

## Known limitations

- 240 fps is a target, not a result: no real-GPU timings exist for this build. Literal 1:1 realism and full path tracing at 240 fps are out of reach for current browser GPUs.
- The ray tracing is a software BVH on the CPU plus a ray-marched height field, not path tracing and not hardware ray tracing. It covers terrain, gates,
  the quad and the 300 trees nearest the track start as trunk capsules and canopy spheres; **foliage, grass, bushes, boulders and individual leaves are not
  traced**, and trees beyond those 300 and the far-forest cards cast no ray-traced shadow. A crown is a proxy sphere with a statistical leaf density (extinction,
  clumping index, noisy rim), not real leaf geometry, so its shadow and glow are plausible, not exact. Reflections are traced only on High, Ultra and Performance 240.
- The terrain is a height field: 4 m cells on Low, 3 m on Medium, 2 m on High and 1.5 m on Ultra. Relief finer than a cell is shading only (detail normal, albedo
  and cavity textures), and there are no overhangs or caves; collisions use the height field.
- One airframe exists: the 5 inch 6S quad (`src/sim/presets.ts`). There is no other size or build to choose (the menu shows the airframe as fixed).
- Night is a camera model: the auto exposure runs up to about +22.8 EV of gain (a Starvis-class starlight camera, which reaches it with long integration and
  frame averaging), the ISO-style gain stops at +10 EV and the rest adds no noise of its own, and the noise is a Poisson-Gaussian model with a temporal
  noise-reduction floor. The grain and the brightness of a moonless night are plausible but not calibrated against a real camera or a real night.
- The frame rate is capped by the display refresh; the frame cap can only lower it. A page opened in a background tab cannot measure the refresh and assumes 60 Hz as its default target.
- Timestamp queries (per-pass times, GPU-driven dynamic resolution) need `timestamp-query`; without it the controller works from frame times.
- Terrain generation is CPU work in a worker and takes from a few seconds (Low) to much longer (Ultra), longer still without a fast CPU.
- The map is a bounded 2 to 4 km square; there is no mobile or touch control scheme and no VR.
- Everything was verified in headless Chromium on SwiftShader (software WebGPU, about 1 fps) and in unit tests. The exposure, colour, noise and shadow tuning
  was judged on those software frames; no real GPU, no real display and no other browser has been exercised.
