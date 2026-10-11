# FPV Sim: start here

This file is the entry point for any agent session (Claude Code, Codex or another harness). Read it first, then the design note for the
area you work in. Facts here come from package.json, the tools, README.md, src/render/README.md and the logs of the 2026-10-11 session;
anything not confirmed is marked **unconfirmed**.

## What the project is

A WebGPU FPV quadcopter simulator in the browser (TypeScript, Vite): a rigid-body quad with a Betaflight-style flight controller,
procedurally eroded terrain with grass and trees, generated race tracks, a seeded operating theme park, a physically based sky, and a
hybrid renderer (rasterised G-buffer plus compute ray tracing for shadows, GI and reflections). AI pilots ("brains") are trained with PPO
on the GPU, headless, and fly the game's own TypeScript flight model. The same renderer runs offline in Node through Dawn (npm `webgpu`)
for screenshots, videos and benchmarks. The full feature description is [README.md](README.md).

## Layout

| Path | What it holds |
| --- | --- |
| `src/main.ts`, `src/app.ts` | Entry: checks for WebGPU, then loads the app (or a `?dev=<name>` module page on the dev server) |
| `src/app/` | Boot, real-time loop, scene and world loading, settings wiring, test hooks (`window.__fpv`), recovery |
| `src/render/` | Renderer, frame graph, G-buffer, deferred lighting, quality profiles, WGSL in `shaders/`, modules `atmosphere/ terrain/ vegetation/ objects/ rt/ post/ park/`. Read [src/render/README.md](src/render/README.md) before touching it |
| `src/world/` | `terrain/` generation and erosion, `track/` generator, `astro/` sky bodies, `park/` the theme park ([its README](src/world/park/README.md)) |
| `src/sim/` | Quad physics and `fc/` the flight controller. The trainer's WGSL copy must match it (parity test) |
| `src/ai/` | Brains: observation, sensing, policy, BrainPilot, BrainRacer; `gpu/` WGSL trainer kernels; `train/` the PPO trainer |
| `src/game/`, `src/input/`, `src/audio/`, `src/ui/` | Session state machine and camera, input devices, audio engine, menus/HUD/OSD |
| `src/prop/` | Propeller model for the prop lab |
| `src/dev/` | Stand-alone module pages (`/?dev=render` etc.), dev server only |
| `tools/` | Offline tools: shot and render tools, render server, native benchmark, brain trainer and dashboard, park tools, videos |
| `tools/audit/` | Realism audit: photo-match metrics, reference photos (`refs/`), real-browser check, per-module GPU cost, perf A/B |
| `tools/compare/` | Before/after tooling: interleaved A/B renders, comparison sheets, image stats, pixel diffs |
| `tools/lightcast/` | Light-term probe (`measure.mjs`) and flight clips (`flight.mjs`) through patched copies of `src/` |
| `tools/views/` | Fixed camera views (`trees.json`) and the `hard-210-t2.json` track the audit tools render |
| `public/` | Shipped assets: `data/stars.bin`, `brains/` (trained brains and `index.json`), `textures/` (bark scans), `props/` |
| `docs/` | Design notes per area (see the ownership map below), `history/` changelogs |
| `.bench/` | **Ignored.** Scratch and outputs of every tool (renders, logs, runs, bundles). A fresh clone has none of it |
| `.cache/` | **Ignored.** Built tree meshes and leaf atlases (`.cache/tree-meshes/`, or `FPV_TREE_CACHE_DIR`). Tens to hundreds of MB |
| `PERFORMANCE*.md` | Earlier performance research write-ups |

## Setup

- Windows 11 is the development machine (AMD RX 9070 XT, D3D12). Node 24 is in use (README says a current LTS; developed on Node 22).
- `npm install`, then `npm run dev` and open http://localhost:5173 in Chrome or Edge with hardware acceleration (WebGPU needs
  `localhost` or HTTPS).
- Offline GPU tools use Dawn through npm `webgpu` 0.6.2 on D3D12. Dawn cannot load Vulkan on this machine, and Vite's bundler must not
  share a process with Dawn (the tools bundle in a child process).
- `ffmpeg` on PATH for videos and PNG writes; Python 3 with `numpy`, `Pillow` and `scipy` for the audit and compare scripts (use `python`,
  not `python3`). The real-browser check needs a Playwright Chromium (`npx playwright-core install chromium`) or `CHROME_BIN`.

## Verify before calling anything done

1. **Types**: `npx tsc --noEmit` (`npm run typecheck`). TypeScript 7 is the native compiler (`@typescript/typescript-win32-x64`); a
   check takes about 0.5 s.
2. **Unit tests, scoped to what you changed**: `npx vitest run src/<area>`; for example `src/render` takes about 50 s (105 files).
   - The full `npm test` (300 files plus the dashboard tests) took 32 min on 2026-10-11 with other GPU work running, and 19 park files timed
     out under that load. Run park tests on their own: `npx vitest run src/world/park --maxWorkers=3`.
   - Known slow, timeout-prone even alone: `src/world/park/validation.test.ts` ("100 reproducible seeds", 600 s limit; "every attraction
     repeatedly", 120 s limit) and `src/world/park/motionAudit.test.ts` (300 s limit). Re-run a timed-out file alone before you call it a failure.
   - On 2026-10-11 12:34, `src/render` had 4 failures in `vegetation/meshes`, `plantShadows` and `foliageSpace`, with the tree and leaf work
     still in progress. Check the current state before you assume your change caused them.
   - Dashboard: `npm run test:dash`.
3. **WGSL changes need a real GPU render.** Text tests and tsc do not compile WGSL. Render the affected views with a shot tool (below):
   the shot tools fail on any GPU validation or compile error. Open the PNG and look at it.
4. **Browser check** for anything the game shows: `node tools/audit/browser-check.mjs --cases park,track --qualities ultra,extreme --hours 12,23.5`
   loads the real game in headless Chromium on the hardware GPU. A case passes with no `fail`, no `error` and an empty `console`.
   `node tools/shot.mjs` is the software-WebGPU (SwiftShader) check; it shows correctness only, never performance.
5. **Build**: `npm run build` for app-facing changes.
6. Python you add: `python -I -m py_compile <file>`. Node scripts: `node --check <file>`.

## Rendering offline

### The GPU lock

- Every offline GPU tool takes one machine-wide lock: `tools/native-bench/lock.mjs`, file `%USERPROFILE%\.fpv-native-bench\gpu.lock`
  (pid, token, start time). A tool holds it for its own render and releases it after. Most tools wait and retry while it is held.
- Never delete a live lock. Remove it only when the pid in it no longer runs (`tasklist /FI "PID eq <pid>"`).
- One GPU job at a time, the smallest that proves the point. Never send stress, oversized or deliberately invalid work to the GPU or to a
  model server; a runaway job can hang the machine. If one runs away, stop that process and say so.

### Render server and client (fastest)

`node tools/shot-client.mjs --out .bench/trees/after --quality high --width 1280 --only bark-oak,edge --views tools/views/trees.json`

The client starts `tools/render-server.mjs` on first use (127.0.0.1:47811, log `.bench/render-server/server.log`). The server keeps the
device, bundle and renderer between shots and redoes only what an edit reaches: about 1 s after a shader edit instead of 15-40 s.
`--fresh` renders in a new process when the server is suspect; `--raw` also writes `.rgba` for pixel diffs; `--mode terrain` takes
terrain-shots' world and arguments. Full reference: [tools/RENDER_SERVER.md](tools/RENDER_SERVER.md) (owned by the speedup work).

### Shot tools

| Tool | What it renders | Key flags |
| --- | --- | --- |
| `tools/tree-shots.mjs` | Tree close-ups and forest views, with GPU ms per view | `--out --quality high,ultra,extreme --width --views <file> --only a,b --hour --seed --no-clouds --frames --timed` |
| `tools/terrain-shots.mjs` | Ground views picked from the terrain maps (meadow, rock, stream, under trees, FPV run, aerial, park) | `--out --quality --width --views a,b --hour --warm --time --source <checkout>` |
| `tools/shot-client.mjs` | Either of the above through the render server | as above, plus `--fresh --raw --mode terrain` |
| `tools/lightcast/measure.mjs` | Patched copies of `src/` that output one lighting term on grey cards; colour of light in shade and sun | `--tag --views --hours --quality --terms all,sun,gi,spec --gi ... --track --views-file --clouds --dump --source` |
| `tools/shot.mjs` | The app in headless Chromium, software WebGPU | `--query --out --size --wait 300000` |
| `tools/audit/shot-gpu.mjs` | One screenshot of the running dev server on the real GPU (Edge) | `<url> <out.png>` |
| `tools/park-tour.mjs`, `tools/park-seed-orbit.mjs`, `tools/pilot-lap-video.mjs` | Videos | see each file's header |

- Views: `tools/views/trees.json` is a tracked copy of the views the 2026-10-11 renders used. Without `--views`, tree-shots and the render
  server read `.bench/trees/views.json` and pick new views when it is missing, so pass `--views tools/views/trees.json` to frame the same spots.
- **Clouds off for A/B**: comparisons run with clouds off (`--no-clouds`; `measure.mjs` turns them off unless `--clouds`), so a cloud
  shadow over one image and not the other does not read as a difference.
- **Parallel agents**: set a cache directory per agent, `FPV_TREE_CACHE_DIR=.cache/trees-<agent>`, so builds of different sources do not
  overwrite each other's tree meshes. A cold tree cache costs about 2 min of tree building at the first render.
- Interleave A and B rounds (`tools/compare/ab-swap.mjs`, `tools/compare/terrain-ab.mjs`, `tools/audit/perf-ab.mjs`) so background GPU
  load hits both arms alike.
- Native benchmark and shared queue: [tools/native-bench/README.md](tools/native-bench/README.md) (`npm run bench:native`, `bench:compare`).

### Audit and compare tools

Each file's header has its usage. Outputs go under `.bench/`.

- `tools/audit/metrics.py`: renders beside reference photos (`tools/audit/refs/`, credits in
  [refs/CREDITS.md](tools/audit/refs/CREDITS.md)) with luma p5/p50/p95, saturation, colourfulness and local contrast; writes the audit sheet.
- `tools/audit/meterscore.py`, `termsplit.py`, `pstats.py`, `darkmask.py`: exposure scores, dark-pixel lighting terms, run statistics.
- `tools/audit/skyfrac.py`: sky fraction inside a crown's silhouette, the same way for a photo and a render (crown-density checks).
- `tools/audit/modcost.mjs`: start-up time and GPU ms of each render module (one module switched off at a time).
- `tools/audit/perf-ab.mjs` then `perf-summary.py`: HEAD worktree against the working tree in the browser.
- `tools/audit/fetchrefs.py`, `findref.py`, `contact.py`: find, fetch and review reference photos (licence kept in `sources.json`).
- `tools/compare/`: `sheet.py` (photo | before | after), `metric-sheet.py` (with metrics), `pair.py`, `row.py`, `refpair.py`,
  `imgstats.py`, `diffimg.mjs` (raw frame diff), `ab-swap.mjs`, `terrain-ab.mjs`.
- `tools/audit/profsum.mjs`: summary of a `.cpuprofile`.

## Quality tiers

`low`, `medium`, `high`, `ultra`, `extreme`, plus the **Performance 240** preset (High with the costliest budgets cut). The table of what
each tier sets is in [README.md, Quality tiers](README.md#quality-tiers); profiles live in `src/render/qualityPresets.ts`.

**Extreme** is the best picture the renderer can make, for stills and videos: no frame-rate target, dynamic resolution off, no budget
test. It builds exactly Ultra's world (terrain, track, where every plant stands, every collider), so brains, saved tracks, leaderboards
and share links treat the two alike. A module raises detail for Extreme only through `src/render/contracts.ts`: `EXTREME_PROFILE`,
`tierTable(...)` and `isExtreme(q)`. Pick it with `?quality=extreme`, Settings > Quality, or `--quality extreme` in the tools.

## AI pilots and brain training

- Commands: `npm run train` (dashboard on http://localhost:8787), `node tools/brain/train.mjs --name <n> --minutes 30 [--resume <brain>]
  [--track a.json] [--parks 1337:destination:race] [--template <id>]`, `node tools/brain/eval.mjs <brain.json> --worlds 4`
  (times brains in the TypeScript sim on unseen tracks), `node tools/brain/publish.mjs <brain.json>...` (into `public/brains` and its
  `index.json`), `npm run brain:check` (GPU vs TypeScript parity, observation check and gradient check). Full guide: README "AI pilots".
- Rule: `src/sim` is the flight model of record. The GPU trainer runs a WGSL copy of it, proven by `tools/brain/parity.mjs`; observations
  have a TypeScript and a WGSL copy checked by `obscheck.mjs`. Change both copies together.
- **FROZEN marker**: `tools/brain/bundle.mjs` bundles the trainer into `.bench/brain/bundle/trainer.mjs`. While a file named
  `.bench/brain/bundle/FROZEN` exists it reuses that build, so a long campaign keeps the same worlds while others edit the world code.
  It is in place now (2026-10-11): the trainer does not see source changes until it is deleted. Delete it when the art work settles, then
  regenerate the hard track files and re-score (see [TASKS.md](TASKS.md)).
- `node tools/pilot-lap-video.mjs --brain public/brains/ace.json --out .bench/pilot-video/lap.mp4 [--park destination | --track export.json]`:
  a video of a brain's lap (FPV with OSD, chase and helicopter views, the drone's own sound). Flags in its header.
- Training runs, logs and the hard-track campaign (`.bench/hard-track/`, `loop.mjs`, `train-set.txt`, `holdout-set.txt`) live in the
  ignored `.bench/` and are not in a fresh clone.

## House rules

- No heredocs and no PowerShell here-strings. Write files with the editor tool; for multi-line input write a temp file and pass it
  (`git commit -F msg.txt`).
- Commit only when asked. Never push to main, force-push or rewrite history without explicit instruction.
- Commit and PR titles in plain English that say what the change does, e.g. "trees: oaks grow wider crowns in open meadows". No AI
  attribution lines in commits.
- Never stress the GPU or a model server (see the GPU lock).
- Python that writes text files opens them with `newline=''` so they get LF line endings; read and write with `encoding='utf-8'`.
- Don't edit files another agent is working on; agree first. Copy rather than move anything in `.bench/` that someone may be using.
- Outbound requests (User-Agent, URLs, payloads) never carry the developer's name, handle or email.

## Areas and their design notes

| Area | Code | Design note |
| --- | --- | --- |
| Trees: species, forms, bark, placement, trunk colliders, far LOD, RT proxies | `src/render/vegetation/` (tree*, placement*, plantShadows, colliders), `shaders/vegetation/tree*.wgsl` | [docs/trees.md](docs/trees.md) |
| Foliage: leaf cards and atlas, pine and spruce brushes, backlit leaves | `src/render/vegetation/` (leaf atlas, foliage), `shaders/vegetation/` | [docs/foliage.md](docs/foliage.md) |
| Terrain and sky: ground materials, grass, rock, forest floor, clouds, atmosphere | `src/render/terrain/`, `src/render/atmosphere/`, `src/world/terrain/` | [docs/terrain-sky.md](docs/terrain-sky.md) |
| Lighting and camera: deferred lighting, GI, exposure, white balance, tonemap, emissive, gates and props | `src/render/lighting.ts`, `src/render/post/`, `src/render/rt/`, `src/render/objects/` | [docs/lighting-camera.md](docs/lighting-camera.md) |
| Build and render speed: render server, bundler, WGSL hot-swap, tree cache key | `tools/render-*.mjs`, `tools/shot-client.mjs`, `src/render/vegetation/treeCache.ts`, `sourceClosure.ts` | [tools/RENDER_SERVER.md](tools/RENDER_SERVER.md) |
| Render core | `src/render/` | [src/render/README.md](src/render/README.md) |
| Theme park: generator, rides, guests, construction audit | `src/world/park/`, `src/render/park/`, `tools/park-*.mjs` | [src/world/park/README.md](src/world/park/README.md), [docs/park-construction.md](docs/park-construction.md) |
| AI pilots and trainer | `src/ai/`, `tools/brain/` | README "AI pilots" |
| Native benchmark | `tools/native-bench/` | [tools/native-bench/README.md](tools/native-bench/README.md) |

The four art notes under `docs/` were being written on 2026-10-11; if one is missing, the area's history is in
[docs/history/2026-10-session.md](docs/history/2026-10-session.md).

## Open issues

The backlog is [TASKS.md](TASKS.md): open items only, by area, each with an owner and an acceptance check. What landed and why is in
[docs/history/2026-10-session.md](docs/history/2026-10-session.md).
