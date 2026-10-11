# Render server

A long-lived process that renders tree-shots-style views through the production renderer (Dawn in Node), and keeps the Dawn device,
the bundle, the scene and the renderer between shots. After an edit it redoes only what the edit reaches, so a shot after an edit takes
about a second instead of 15-40 s.

## Use

```
node tools/shot-client.mjs --out .bench/trees/after --quality high --width 1280 --only bark-oak,edge
```

The client starts the server on first use (log: `.bench/render-server/server.log`) and talks to it on 127.0.0.1:47811. Arguments follow
`tools/tree-shots.mjs`:

| Argument | Meaning |
|---|---|
| `--out <dir>` | Writes `<view>-<quality>.png` and `timings.json` there. |
| `--quality high,ultra` | One renderer per quality; the server keeps the last two resident. |
| `--width 1280` or `--size 1280x720` | Output size (height 9/16 of the width by default). |
| `--views <file>` | Views JSON, default `.bench/trees/views.json` (run `tools/tree-shots.mjs` once to pick them). |
| `--view '{"name":{"eye":[x,y,z],"target":[x,y,z],"fov":75}}'` | Views given inline instead. |
| `--only a,b` | Only these views. |
| `--frames 90 --timed 60` | Frames per view, and how many of the last are timed. |
| `--hour 9`, `--seed 1337` | Time of day, world seed. |
| `--no-clouds`, `--atmos JSON`, `--skip modules`, `--no-scans` | As in tree-shots. |
| `--raw` | Also writes the raw RGBA frame (`.rgba`) for pixel comparisons. |
| `--fresh` | Renders in this process from a new bundle and a new device instead: the fallback when the server is suspect. |
| `--no-start` | Fails instead of starting a server. |

The frame loop is tree-shots' (frames at 60 Hz from time 10, a 1024-cell terrain at 2.5 m, a race track), so a view renders the same
as there.

### terrain-shots views

`--mode terrain` switches to terrain-shots' world and loop, with its argument names:

```
node tools/shot-client.mjs --mode terrain --out .bench/terrain/after --quality high --width 1920 \
  --views-file .bench/terrain/before/timing.json --views meadow,rock [--warm 48] [--time 60] [--hour 9.5] [--date 2026-06-21] \
  [--settings JSON] [--atmos JSON] [--wind 4]
```

| Argument | Meaning |
|---|---|
| world | The quality's own terrain, no track (extreme builds ultra's). |
| `--views-file` | The views, either `{ name: { eye, target, fov } }` or a terrain-shots `timing.json` (its views carry eye, target and fov). The client doesn't pick views itself: run `tools/terrain-shots.mjs` once and reuse its `timing.json`. |
| `--views a,b` | Which of the views to render. |
| `--warm 48` | Frames before the still. |
| `--time 60` | GPU-timed frames after it. |
| output | `<out>/<view>.png`. |

The views share one clock, as in terrain-shots. Not supported: the park views, `--track`, `--debug`, `--face-sun` and `--dump-sky`.

Each shot takes the shared GPU lock (`tools/native-bench/lock.mjs`) for its own render and releases it after. Other agents' renders run
between shots as before.

## What an edit costs

Measured at 640x360, high, one view, 15 frames: medians of 3 rounds, fresh and server alternating, lock waits excluded, on a shared and
loaded machine (`.bench/speedup/bench.mjs`; results in `.bench/speedup/results-push3.json`, the tree generator row in `results-full.json`).

| Edit | What the server does | Fresh process | Server | Cut |
|---|---|---|---|---|
| None (another view, same code) | Reuses the renderer | 12 s | 0.2 s | 98% |
| TS in one render module (`terrain/clipmap.ts`) | Swaps that module; its pipelines come from the cache | 12.5 s | 0.21 s | 98.3% |
| TS in the lighting stage (`lighting.ts`) | Swaps the lighting stage alone | 11.95 s | 0.20 s | 98.3% |
| TS in post-processing (`post/composite.ts`) | Swaps the post stage alone | 12.3 s | 0.34 s | 97.2% |
| Vegetation TS outside the tree generator (`grass.ts`, `params.ts`) | Swaps vegetation; meshes, bark noise and placement kept | 12.4-12.8 s | 0.75-0.78 s | 94% |
| A shader edit that changes the image (`vegetation/tree.wgsl`) | Recompiles the 3 pipelines that include the file | 12.4 s | 1.24 s | 90% |
| Renderer core (`renderer.ts`) | New renderer on the same device; pipelines from the cache | 12.6 s | 1.87 s | 85% |
| Tree generator (`treeGen.ts`) | Swaps vegetation, rebuilds every tree | 26.8 s | 17.7 s | 34% |
| A comment only | Nothing (the bundle comes out the same) | 12 s | 0.2 s | 98% |

These times assume no other process rendered since the server's last shot. If one did, the server gave its GPU up (see Commands) and
builds the renderer again first: about 11 s at high.

The server's frames matched the fresh process's: max 4/255, in at most 6 pixels. Two fresh runs of the same source differ by just as much
(max 4, in 5 pixels).

The log line of each shot says what was done: `reuse`, `pipelines N`, `swap terrain`, `swap lighting stage`, `rebuild (<file>)`.

### What is left before every edit takes 2% of a fresh shot

- **Vegetation edits (0.75 s).** What remains is real work in the new module:
  - init (0.3 s: reading the 18 cached tree entries, the bark scans, the leaf atlas);
  - setScene (0.35 s: RT proxies, park plantings, forest floor, far forest).
  To go lower, the server would have to carry the old module's scene state into the new one, which needs the module's cooperation.
- **Shader edits (1.2 s).** The time is the driver compiling the edited pipelines (about 1 s for the three tree LODs, side by side). A
  shader shared by many pipelines recompiles all of them.
- **Renderer core edits (1.9 s).** Every module is set up again. Their pipelines come from the cache, but their CPU work (vegetation,
  terrain upload, placement) runs again.
- **Tree generator edits (18 s).** Building the trees is the cost; only the species whose plan or parameters changed rebuild.
- **Fixed overhead per shot (0.15-0.2 s).** Rendering the 15 frames and reading them back takes about 0.12 s. The rest:
  - checking `src/` for edits: 20 ms;
  - the client process: about 60 ms;
  - the PNG, now encoded in the process: 30 ms instead of an ffmpeg run.

  Bundling (0.13 s) and reading the import graph (50 ms) start when a file is saved, so a shot that follows a few hundred ms after the save
  doesn't wait for them.

## Commands

```
node tools/render-server.mjs [--port 47811] [--max-rss-gb 12] [--idle-exit 120] [--source <checkout>]
curl -s http://127.0.0.1:47811/status
curl -s -X POST http://127.0.0.1:47811/stop
```

- **GPU memory.** While another process holds the GPU lock, the worker gives the GPU up, so that render gets all the GPU memory (an
  extreme-tier run next to an idle server once ran out of it). The worker checks the lock every second; when another live process holds it,
  the worker drops its renderers, its pipeline cache and its Dawn device. That took it from 472 MB to 67 MB within 1-3 s. The next shot opens a new device and builds the renderer again: about 11 s at
  high, then fast again. To free everything before a big run by hand, stop the server: `curl -s -X POST http://127.0.0.1:47811/stop`
  (the next shot-client call starts it again).
- The worker restarts by itself when it crashes or grows past `--max-rss-gb`.
- Renderers idle for 10 minutes are dropped, to free GPU memory (`FPV_RENDER_SERVER_IDLE_MIN`).
- `FPV_RENDER_SERVER_KEEP` sets how many renderers stay resident (default 2).
- `FPV_RENDER_SERVER_FULL=1` makes every edit rebuild the renderer: use it to rule the partial paths out.
- `FPV_TREE_CACHE_DIR` works as for the other tools.

## How it decides

- The worker (`tools/render-worker.mjs`) compares the files under `src/` with the last shot's by size and time, then by content.
- A TypeScript edit is bundled by a bundler process that stays up (`tools/render-bundler.mjs`, 0.13 s; Vite's bundler cannot share a
  process with Dawn). It writes one file per source module, named by content hash. An unchanged module keeps its file name, so Node hands
  the new build the instance it already has, with its state. Only the edited files and the files that import them are new instances.
- What the edit reaches comes from the import graph (`src/render/vegetation/sourceClosure.ts`):
  - the renderer core (renderer.ts and its imports, less the module list and the two stages): a new renderer;
  - only the lighting (`lighting.ts`) or post-processing (`post/`) code: that stage is swapped (`Renderer.replaceStages`);
  - a render module's own files: that module is swapped (`Renderer.replaceModules`);
  - the world generators: a new scene.
- Pipelines are kept by content (shader code, entry points, constants, state, layout content) in `tools/render-hotswap.mjs`. A module set
  up again gets the pipelines it had before instead of compiling them: Dawn itself compiles every request again.
- Work that doesn't depend on the edit is kept by the modules themselves:
  - the tree meshes (disk cache, keyed on the generator code);
  - the bark noise (built once);
  - the placement (kept for the same world, by content).
- A shader edit goes into the live shaderLib (`setShaderSource`). `tools/render-hotswap.mjs` recreates the shader modules whose code
  included the file and the pipelines built on them, and points `setPipeline` at the new ones. It refuses where a swap could leave
  something stale, and the owning module is swapped instead:
  - a pipeline with `layout: 'auto'`;
  - shader text a module changed before compiling.
- Between shots `Renderer.resetHistory()` puts the frame state back to a new renderer's. A module that keeps its own frame counters must
  reset them in `resetLighting()` (see the atmosphere's clouds), or its shots will differ from a fresh renderer's.

## Checking it

`node .bench/speedup/bench.mjs` edits a scratch copy of `src/`, renders the same view through the server and through a fresh process
after each edit, and compares the pixels (`--kinds` picks the edits; the `-visible` ones change the image, to prove the server picks them
up). The last run differed by at most 4/255 in at most 6 pixels, which matches two fresh runs of the same source.
