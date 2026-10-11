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

Measured at 640x360, high, one view, 15 frames: medians of 3 rounds, fresh and server alternating, lock waits excluded
(`.bench/speedup/bench.mjs`, results in `.bench/speedup/results-full.json`).

| Edit | What the server does | Fresh process | Server |
|---|---|---|---|
| None (another view, same code) | Reuses the renderer | 15 s | 0.2 s |
| A shader (`.wgsl`) | Recompiles the pipelines that include the file | 13-25 s | 1.7-3.6 s |
| TypeScript in one render module (`terrain/clipmap.ts`) | Swaps that module for a new instance | 17.0 s | 1.65 s |
| Vegetation TS outside the generators (`grass.ts`, `params.ts`) | Swaps vegetation; tree meshes stay cached | 14.7-16.7 s | 1.7-1.9 s |
| Tree generator (`treeGen.ts`) | Swaps vegetation, rebuilds the trees | 26.8 s | 17.7 s |
| Renderer core (`lighting.ts`) | New renderer on the same device | 14.7 s | 7.7 s |
| A comment only | Nothing (the bundle comes out the same) | 15 s | 0.2 s |

The log line of each shot says what was done: `reuse`, `pipelines N`, `swap terrain`, `rebuild (<file>)`.

## Commands

```
node tools/render-server.mjs [--port 47811] [--max-rss-gb 12] [--idle-exit 120] [--source <checkout>]
curl -s http://127.0.0.1:47811/status
curl -s -X POST http://127.0.0.1:47811/stop
```

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
  - the renderer core (renderer.ts and its imports, less the module list): a new renderer;
  - a render module's own files: that module is swapped (`Renderer.replaceModules`);
  - the world generators: a new scene.
- A shader edit goes into the live shaderLib (`setShaderSource`). `tools/render-hotswap.mjs` recreates the shader modules whose code
  included the file and the pipelines built on them, and points `setPipeline` at the new ones. It refuses where a swap could leave
  something stale, and the owning module is swapped instead:
  - a pipeline with `layout: 'auto'`;
  - shader text a module changed before compiling.
- Between shots `Renderer.resetHistory()` puts the frame state back to a new renderer's. A module that keeps its own frame counters must
  reset them in `resetLighting()` (see the atmosphere's clouds), or its shots will differ from a fresh renderer's.

## Checking it

`node .bench/speedup/bench.mjs` edits a scratch copy of `src/`, renders the same view through the server and through a fresh process
after each edit, and compares the pixels. The last run differed by at most 1/255 per channel, which matches the repeatability of two
fresh runs.
