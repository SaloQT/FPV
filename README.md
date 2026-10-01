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
  opening it by a LAN address such as `http://192.168.1.20:5173` gives "WebGPU is not available". Use `http://localhost:5173`.
- If startup fails the page shows a full-screen explanation with troubleshooting steps and a Reload button.
- Other scripts: `npm run build` (typecheck and production build), `npm run preview`, `npm run typecheck`, `npm test`.
- Node.js: a current LTS (developed on Node 22).

## Controls

Read from `src/input/bindings.ts`, `src/input/gamepadMap.ts` and the in-game cheat sheet (**F1**). Click the canvas to capture the mouse,
**Esc** gives it back and opens the menu.

| Input | Action |
| --- | --- |
| Mouse (captured) | Roll and pitch (a virtual gimbal; mouse up is nose up). Settings: sensitivity, centring spring, expo, deadzone, invert |
| **W / S** | Throttle up / down. Latched like a real throttle: hold to ramp, it stays where you leave it |
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
| `seed=<n>` `style=race\|freestyle\|mountain\|sprint` `gates=<n>` `laps=<n>` | World and track |
| `t=<0-24>` | Local solar hour at the flying site |
| `quality=low\|medium\|high\|ultra` `perf240=1` `scale=<0.25-1>` `dyn=0\|1` | Rendering |
| `target=<fps>` `cap=<fps>` `refresh=<hz>` | Dynamic-resolution target (0 = display), frame cap (0 = none), assumed display refresh |
| `cam=fpv\|chase\|free` `autostart=1` `scenario=hover\|fly\|crash\|gate` | Skip the menu, scripted autopilot |
| `wind=<m/s>` `winddir=<deg>` | Wind |
| `bench=1` `benchSeconds=<s>` `benchWarmup=<s>` | Benchmark (below) |

Parameters change the running session only; they never overwrite the pilot's saved settings.

## Features, exactly

- **Flight model**: 4 kHz fixed-step rigid body (quaternion attitude; the rate is selectable from 1 to 8 kHz), four brushless motor and
  ESC models, propeller thrust and torque from rotor speed and local inflow with air density by altitude and Cheng ground effect, a LiPo
  pack (open-circuit voltage curve, ohmic resistance, one RC polarisation branch), anisotropic quadratic body drag, wind with
  Dryden-style turbulence and travelling gusts, and a sphere-proxy contact solver against the terrain height field and oriented boxes
  (gates, trees, rocks). Presets: 5 inch 6S and 3 inch 4S.
- **Flight controller** (Betaflight-style, `src/sim/fc`): gyro low-pass filters, RPM-locked notch bank, Betaflight "actual" / "betaflight" /
  "quick" rate curves, angle and horizon self-levelling on a Mahony attitude filter, rate PID with D on measurement, I-term relax,
  anti-gravity, TPA and feed-forward, a quad-X mixer with airmode, idle, thrust linearisation and turtle mode, and an IMU model with noise,
  bias and motor-locked vibration.
- **Terrain** (`src/world/terrain`, built in a Web Worker): a domain-warped ridged macro shape with a valley corridor, stream-power valley
  incision, grid refinement, Beyer droplet hydraulic erosion, thermal talus and soil creep, then material maps (flow, soil depth,
  sediment, wetness) and optional lakes. Map size 2 to 4 km by tier (512 x 512 at 4 m on Low up to 2048 x 2048 at 2 m on High), 220 m of
  relief. Rendered as a geometry clipmap with procedural micro-relief and ground materials driven by the maps.
- **Vegetation**: GPU-driven grass blades with three LODs, wind and prop-wash; procedurally grown trees and bushes with LODs and wind;
  boulders. Placement follows slope, soil depth and wetness (nothing grows in rivers).
- **Track generator**: four styles (race, freestyle, mountain, sprint) with gate spacing, turn-radius, slope and clearance validation;
  gates with LEDs, flags, cones and obstacles; gate timing, laps and splits.
- **Sky and time**: Hillaire-style atmosphere (transmittance, multiple-scattering, sky-view and aerial-perspective tables), ray-marched clouds
  with temporal accumulation and cloud shadows, the Sun (Meeus), the Moon (full ELP truncation, phase and light) and Mercury to Saturn (JPL
  elements). **Stars are real**: 41,487 stars to magnitude 8 from the HYG v4.1 catalogue (`public/data/stars.bin`), plus a baked Milky Way, airglow
  and zodiacal light. Date, latitude, longitude and altitude are settings, time can be frozen or run at 10x, 60x and 600x, and the light is
  physical (lux and nits) with a camera-style auto exposure.
- **FPV camera**: tilt, field of view, lens distortion, chromatic aberration, vignette, rolling-shutter lean, motor vibration ("jello"), physical
  motion blur (1/400 s exposure), sensor shot noise and an analogue/digital video-noise look, plus an OSD (battery, speed, altitude, timer, gate).
- **Audio**: motor tones from the rotor speeds, wind, prop-wash, impacts and beeps, synthesised with Web Audio.

## Architecture

```
src/
  main.ts        entry: the app, or a stand-alone module page with ?dev=<name>
  app/           boot, the real-time loop (frame cap), scene and world loading, settings wiring, test hooks,
                 benchmark, display-refresh measurement, failure screen and device-loss recovery
  audio/         Web Audio engine: motor synthesis, wind, impacts, beeper
  contracts.ts   shared types: settings, quad state, terrain and track data
  dev/           stand-alone pages for one module each (sky, terrain, vegetation, objects, post, rt, render, audio, ui)
  game/          session state machine, fixed-step stepper, gate timing, camera rig, simulated clock
  input/         keyboard, mouse (pointer lock), gamepad and radio, merged into one stick input
  render/        Renderer, frame graph, G-buffer, deferred lighting, dynamic resolution, GPU timer, quality profiles,
                 shader library (shaders/*.wgsl) and the modules atmosphere/, terrain/, vegetation/, objects/, rt/, post/
  sim/           quad physics (motor, propeller, battery, aero, collision, IMU, wind) and fc/ (the flight controller)
  ui/            menu and settings schema/store, HUD and OSD, help sheet, F3 overlay, loading, failure screen, benchmark panel
  world/         terrain/ (generation and erosion), track/ (generator and validation), astro/ (Sun, Moon, planets, stars, clock)
tools/           shot.mjs (headless screenshots), bench.mjs (benchmark runner), build_stars.py (star catalogue)
public/data/     stars.bin (HYG v4.1, magnitude <= 8)
```

`src/render/README.md` documents the render core (frame graph, bind groups, units, how to write a module).

## Rendering pipeline

Per frame, in this order:

1. **CPU update, pre-passes** (compute): atmosphere tables and clouds, grass and tree culling and generation.
2. **G-buffer** (raster): terrain clipmap, water, grass, trees, boulders, gates and the quad into four render targets plus reverse-Z depth.
3. **Ray tracing** (compute): sun shadows, diffuse global illumination (1 or 2 rays per pixel), optional specular reflections, and a camera-centred
   grid of radiance probes (SH-L1) for multi-bounce light and rough surfaces; temporal accumulation and an a-trous denoiser. Run at full, half or
   quarter resolution depending on the tier.
4. **Deferred lighting** (compute) into an HDR target, then **sky** and clouds and a forward pass (glow, translucent parts).
5. **Post**: temporal anti-aliasing with upscaling (TAAU, render size to output size), bloom, motion blur, the camera model (lens, rolling shutter,
   vibration, video noise), auto exposure, tonemap and sensor noise.

**What is and is not ray traced.** The scene is a *software* BVH built on the CPU over analytic primitives (boxes, capsules, spheres, tori): the gates,
the quad, and the trunk (capsule) and canopy (sphere) proxies of the 300 trees nearest the track start. Terrain is ray marched through a
height-field max pyramid. There is no hardware ray tracing (WebGPU has no such API) and it is not path tracing. **Foliage is not traced**:
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
resolution, reflections, bloom and TAA stay. It derives from the High profile (`src/render/qualityPresets.ts`); the tests check that
every tier costs more than the one below it and that the preset costs clearly less than High, using an analytic proxy of the work each
profile asks for, which is not a GPU measurement. Switching the preset live changes ray, probe and cloud budgets at once; the grass density
only follows after a reload (the vegetation module rebuilds its grass on a tier change, not on a budget change).

## How 240 fps is pursued

- **The display decides.** A browser canvas cannot turn v-sync off: frames are paced by `requestAnimationFrame`, so the frame rate can never
  exceed the display refresh. 240 fps needs a 240 Hz display *and* a GPU that renders a frame in under 4.17 ms. The old "V-sync" setting did
  nothing and was removed.
- **Measured refresh.** At startup, about 60 idle frames are timed; the median interval of the on-time frames is snapped to a common rate
  (50, 60, 75, 90, 100, 120, 144, 165, 180, 240, 360 Hz) and used as the default target frame rate ("Display refresh (measured)"). `?refresh=` overrides it.
- **Dynamic resolution** (on by default): the render scale steps through 100, 90, 80, 70, 60, 50 and 42% of the Render scale setting. It decides
  on GPU time from timestamp queries when the device has `timestamp-query`, otherwise on missed refreshes. It steps down when the mean of six
  frames is 2% over budget (two steps when 1.6x over), steps up only when the cost predicted for the next step stays under 85% of the budget, and a step that fails soon after being
  reached is not retried for 8 s, doubling up to 64 s, so it settles instead of oscillating.
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
(`window.__fpv.benchDone` is the promise of it). `benchSeconds=3&benchWarmup=0` gives a quick run. From a shell:

```bash
node tools/bench.mjs                              # SwiftShader: proves the pipeline runs, numbers are meaningless
node tools/bench.mjs --gpu --seconds 20 --query "quality=high"
node tools/bench.mjs --gpu --uncapped             # also lifts Chrome's frame limit (--disable-frame-rate-limit --disable-gpu-vsync)
```

In a normal browser the average is capped by the refresh rate, so read `avgGpuMs` for the headroom. The results panel says whether the display or the GPU limited the run. `--uncapped` is a
measuring aid for the command-line runner only and has not been verified on real hardware.

## Testing

- `npm test`: the vitest suite (about 150 files: physics against known values, terrain and track generators, input mapping, the astronomy against
  worked examples from the astronomy literature, WGSL include resolution, CPU references of the ray tracer, the dynamic-resolution controller, settings, the failure and perf models).
- `npm run typecheck`: strict TypeScript.
- `node tools/shot.mjs --query "autostart=1&scenario=hover&cam=fpv&t=12&seed=1337&quality=low&dyn=0&scale=0.5" --out shots/x.png --size 960x540 --wait 300000`
  starts Vite, opens the app in headless Chromium with software WebGPU, waits for `window.__fpv.ready`, prints errors and a stats JSON and saves a
  screenshot. `?dev=sky|terrain|vegetation|objects|post|rt|render|audio|ui` open single-module pages for the same tool. Every WGSL compile error and
  WebGPU validation error is printed and fails the run. A screenshot at 1 fps takes minutes; add `hold=1` to freeze the loop.
- `window.__fpv` (stats, `state()`, `capture()`, `advance(n)`, `patch()`, `loseDevice()`, `bench`) is what tests and tools drive.

## When things go wrong

- **No WebGPU, no adapter, device refused**: a full-screen panel names the cause, lists steps (hardware acceleration, `chrome://gpu`, flags, drivers,
  secure context) and offers Reload.
- **Device lost mid-session** (driver reset, GPU hang): the loop stops and the panel offers **Recover**, which builds a fresh renderer on the same canvas and
  puts the world back without reloading; your settings and the run are kept.
- **Uncaught errors** show the panel too, with "Keep going". GPU validation errors go to the console and to the error count in F3.

## Known limitations

- 240 fps is a target, not a result: no real-GPU timings exist for this build. Literal 1:1 realism and full path tracing at 240 fps are out of reach for current browser GPUs.
- Ray tracing is software-BVH based and covers terrain, gates, the quad and coarse tree proxies. Foliage, grass and boulders are not traced; reflections are
  traced only on High, Ultra and Performance 240.
- The frame rate is capped by the display refresh; the frame cap can only lower it. A page opened in a background tab cannot measure the refresh and assumes 60 Hz as its default target.
- Live switching of Performance 240 does not change the grass density until a reload.
- Timestamp queries (per-pass times, GPU-driven dynamic resolution) need `timestamp-query`; without it the controller works from frame times.
- Terrain generation is CPU work in a worker and takes from a few seconds (Low) to much longer (Ultra), longer still without a fast CPU.
- The map is a bounded 2 to 4 km square; there is no mobile or touch control scheme and no VR.
- Tested in headless Chromium on SwiftShader and in unit tests; other browsers and GPUs have not been exercised.
