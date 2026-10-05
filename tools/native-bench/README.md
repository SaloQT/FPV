# Native frame benchmark

The native runner uses Node and the pinned Dawn `webgpu` package to render production WebGPU passes into a texture. It needs neither Chromium nor an HTTP server. Its results measure offscreen rendering and synchronous Node CPU work, not browser presentation, UI, audio or complete browser FPS. GPU timestamps are elapsed milliseconds, not hardware cycle counts. CPU values are wall time around synchronous work, not retired cycles or all driver-thread CPU consumption.

Implementation is intentionally separated into immutable artifacts, an isolated execution process, paired comparisons, and a persistent queue coordinator. The production renderer only gains a canvas-compatible `RenderSurface` type. Its shaders, module ordering and frame graph are reused.

## Install and identify hardware

Run these later when ready to execute the implementation:

```powershell
npm ci
npm run bench:capabilities -- --backend d3d12
# Alternative on Windows if needed:
npm run bench:capabilities -- --backend vulkan
```

Windows defaults to D3D12, Linux to Vulkan, and macOS to Metal. Backend selection is explicit in results. `--adapter "<adapter name>"` selects a Dawn adapter. Software devices, unidentified adapters and missing timestamp support are rejected. The capability probe submits timestamp queries and reads them back; it does not claim rendering performance. A native frame run is the rendering integration check.

Windows driver versions are discovered with PowerShell/CIM. On other platforms, or if that discovery fails, pass an accurate `--driver-id` such as a GPU-driver build identifier to enable completed-result cache reuse. Unknown driver identity still permits live comparisons and deduplicates pending jobs, but disables persistent result reuse. `WEBGPU_MODULE` can point to an alternative Dawn package entry; its package metadata, entry and native binaries are fingerprinted.

## Build and run

```powershell
npm run bench:artifact
npm run bench:native -- --workload stationary --out .bench/stationary.json
npm run bench:native -- --workload terrain-flight --size 1920x1080 --frames 600 --warmup 240 --out .bench/terrain.json
npm run bench:native -- --workload fpv-flight --out .bench/fpv.json
```

`bench:artifact` emits a directory under `.bench/artifacts/<sha256>/` and prints its path. `bench:native` builds the current checkout if `--artifact` is omitted; otherwise it verifies and runs an existing artifact. Building is outside measurement. Artifacts contain a bundled production renderer, WGSL sources embedded by Vite, the star catalogue, and a hash manifest. Executed bytes, rather than checkout HEAD alone, identify a candidate. Build from isolated checkouts when agents edit concurrently.

```powershell
npm run bench:artifact -- --source C:\path\baseline-checkout
npm run bench:artifact -- --source C:\path\candidate-checkout
npm run bench:compare -- --baseline .bench/artifacts/<baseline-hash> --candidate .bench/artifacts/<candidate-hash> --out .bench/comparison.json
```

Replace the artifact path placeholders with the paths printed by the build commands. Artifact files must stay immutable. The runner verifies them before execution and before publishing results. There is no implicit browser fallback.

The workload implementation stays in the harness, so baseline and candidate run the same scenario protocol. Both use seed 1337, a fixed noon astronomy state, a 512×512 terrain with 4 m cells and 220 m relief, and a generated race track. Terrain resolution is a benchmark workload choice, independent of render quality; these results are not a claim about the browser's larger default terrain.

| Workload | Measured CPU simulation/update scope |
| --- | --- |
| `stationary` | Fixed camera update; no physics |
| `terrain-flight` | Deterministic camera moving across terrain; no physics |
| `fpv-flight` | Production quad physics, scripted pilot, camera rig, gate events and vegetation wash updates |

The FPV workload excludes the browser session/state machine, real input polling, audio and HUD. Its state hashes catch divergent physics/camera output. All workloads render production modules including terrain, vegetation, objects, atmosphere, ray tracing and post-processing.

## Measurement protocol

Defaults are 180 warmup frames, 300 measured frames, 1280×720, high quality, render scale 1, fixed dt 1/60 s and at most two submitted frames per batch. Dynamic resolution and Performance 240 are disabled. Each execution starts a fresh child process, renderer, physics state and temporal history. CPU measurements exclude setup/import time, benchmark pacing and correctness snapshots.

Warmup always advances an identical frame prefix. The final three 20-frame GPU medians are recorded. The stationary workload is invalid when their relative spread exceeds `--stability` (default 0.15). Motion naturally changes rendering cost, so moving-workload spread is diagnostic rather than a convergence gate. These default warmup budgets are provisional until calibrated on hardware; increase `--warmup` identically for both builds if necessary. Every measured frame has a source-indexed GPU timing record. Missing, dropped, duplicate or invalid samples invalidate the run.

The runner waits for queue completion and timestamp callbacks after each bounded batch. This keeps readback slots available and prevents an unlimited GPU backlog. It introduces pacing and can influence GPU clocks: batch throughput is explicitly separate from GPU frame cost and browser FPS. Keep `--in-flight` fixed between comparisons. Midpoint and final output textures are read directly after completed batches without re-encoding the frame, outside timing.

Results contain mean, median, p95, range and raw per-frame values for CPU simulation, CPU render/submit, combined CPU work, GPU frame cost and coarse GPU passes. CPU and GPU overlap; do not add them to estimate frame latency. Timestamp intervals do not include all uploads or work outside the marked rendering interval. `--profile` enables the existing detailed GPU instrumentation and reports optional intervals separately. Profiling changes command segmentation; compare like-for-like and use ordinary coarse mode for headline performance.

Result `status` is `valid` or `invalid`, with faults and provenance. A timeout or crash is a CLI/worker failure rather than a fabricated timing result. Snapshot RGBA files sit beside each result JSON. CPU and GPU costs are hardware/runtime-specific; no measurements are extrapolated from lower resolution or software rendering.

Comparisons keep image files from the final pair and any failing pair. Images from earlier passing pairs are discarded after comparison, with `retained: false` recorded in their JSON; hashes and timings remain. `--keep-images` preserves every image when debugging. Exporting a worker result copies JSON only; its `resultFile` identifies the original spool location for retained snapshots and detailed pair JSON files. Completed jobs/artifacts remain on disk until you archive or remove them.

## Comparisons and correctness

Comparisons alternate baseline→candidate and candidate→baseline. `--pairs 3` controls the first persisted screening summary; `--max-pairs 9` controls total fresh pairs. Final verdicts always run all max pairs to avoid stopping on a favorable early estimate. Both can be set to 3 for inexpensive exploratory screening. The primary metric defaults to `gpuFrameMs`; `--metric cpuCombinedMs` selects CPU work instead. A significant combined-CPU regression also makes the overall verdict `regressed`.

Each pair checks settings/workload agreement, exact state hashes, frame identities and image integrity. Image comparisons default to exact byte equality. Explicit `--image-rmse` and `--image-max` options permit reviewed image differences; both bounds must pass. These are pixel-byte tolerances, not a perceptual similarity score. Representative snapshots cannot prove correctness of every internal buffer or every frame, so keep existing targeted GPU integration checks and review screenshots when changing visual algorithms.

Relative cost reductions use paired batch means with an approximate 95% Student-t interval. Per-frame samples are not treated as independent trials. The practical threshold defaults to 2 percent. A result is `improved` or `regressed` only when its interval clears the threshold; otherwise it is `no clear difference`. Runtime, backend, driver, hardware and harness fingerprints must match across the entire comparison. Three pairs and normality assumptions are exploratory, especially on a busy server. Reserve CPU capacity, avoid concurrent GPU workloads, and validate promising changes with the existing Chromium benchmark before making browser-performance claims.

## Shared agent worker

```powershell
npm run bench:worker -- --backend d3d12
# From another process:
npm run bench:submit -- --artifact .bench/artifacts/<candidate-hash>
npm run bench:submit -- --artifact .bench/artifacts/<candidate-hash> --baseline .bench/artifacts/<baseline-hash> --wait 3600
node tools/bench-native.mjs status --id <job-id>
node tools/bench-native.mjs result --id <job-id> --out .bench/copied-result.json
node tools/bench-native.mjs cancel --id <job-id>
node tools/bench-native.mjs health
```

The coordinator listens only on `127.0.0.1`, uses a random bearer token in `.bench/worker/worker.json`, and executes one child/GPU job at a time. Agents should build isolated artifacts and submit to the shared worker rather than launch separate runners. `--worker <worker.json>` selects another connection file. Keep artifact directories available until jobs complete.

Identical pending submissions share a job ID. Completed valid results are reused for up to `--cache-seconds` (default 3600) only when driver identity is known. The key includes artifact hashes, workload/options, comparison settings, Node/Dawn/native-binary identity, backend, hardware, driver and harness hashes. Invalid and cancelled jobs can be resubmitted. Use `--cache-seconds 0` for fresh confirmation comparisons. Restart the worker after changing drivers or benchmark tooling. Completed JSON files are hashed and checked on reuse/retrieval.

The default queue limit is 1000 pending jobs (`--max-queued`). Cancelling a running job terminates its child; cancelling a queued job removes it from execution. Ctrl+C stops admission, cancels queued work, terminates the active child and releases the GPU lock. State is persisted in the spool. After a crash, unfinished jobs are marked failed on restart instead of silently rerun. Each child has `--timeout` milliseconds (default 180000); a comparison may run many children.

A machine-wide lock in `$HOME\.fpv-native-bench\gpu.lock` prevents other checkouts' direct runners or coordinators from overlapping GPU work. A hard kill can leave a stale lock: inspect the owner PID recorded there, ensure it has exited, then remove that specific lock before restarting. The lock does not prevent unrelated applications from using the GPU. Keep process count bounded and CPU resources available for credible CPU measurements. No unbounded CPU worker pool is launched by this tool.

Useful exit codes: 0 for valid/no-clear-difference results, 1 for invalid measurements or a comparison regression, and 2 for CLI/setup/timeout failures. Queued job status is explicit in the client API. Worker HTTP endpoints are authenticated `GET /health`, `POST /jobs`, `GET /jobs/<id>`, `GET /jobs/<id>/result`, and `DELETE /jobs/<id>`.

The initial local baseline is locked in `.bench/baseline.json`, with its source snapshot, artifact hashes, workload settings and hardware measurements. `.bench/baseline-results.json` contains three runs per workload on the RX 9070 XT through D3D12, at high quality and 1280×720, with 180 warmup and 300 measured frames per run. These local records are ignored by Git; preserve `.bench/baselines`, the selected artifact directory and baseline result files when archiving the project.

The terrain-flight captures repeated exactly. Stationary and FPV captures showed sparse one-byte colour differences between unchanged runs. The locked baseline records measured repeatability and explicit comparison tolerances; the CLI still defaults to exact images unless tolerances are supplied. Native artifact builds, hardware timestamp probes and baseline benchmarks have been executed. Unit tests, typechecking and browser parity checks remain deferred.

## Separate native 4K quality replay

`tools/native-quality` adds an untimed quality evaluation for the 2026-10-05 research session. It does not change the runner, workload, timing boundaries or paired statistics above. All GPU replay jobs use the same machine-wide lock. Each replay renders the identical 480-frame FPV flight at 3840x2160 Ultra, scale 1, D3D12, with dynamic resolution and Performance 240 disabled. It records every flight-state hash and 45 native RGBA images, including four eight-frame consecutive bursts.

```powershell
node tools/native-quality/capture.mjs --artifact <artifact-directory> --out <quality-result.json>
python tools/native-quality/evaluate.py --baseline <original-quality-result.json> --candidate <candidate-quality-result.json> --out <quality-comparison.json>
python tools/native-quality/review.py --baseline <original-quality-result.json> --candidate <candidate-quality-result.json> --out <review-directory>
python tools/native-quality/test_evaluate.py
node tools/native-quality/log.mjs
```

Python uses NumPy, SciPy and Pillow. SSIM is calculated on native RGB pixels with an 11x11 Gaussian window, sigma 1.5, population covariance, K1=0.01, K2=0.03 and data range 255, averaging the valid interior over RGB. Strips with overlapping halos bound memory use without resizing or changing the windows. Every image must score at least 0.98. Settings, scene, frame identities, image hashes and all 480 simulation-state hashes must match. Consecutive-frame residuals are reported separately; review sheets provide native crops for inspecting detail and motion. Overview thumbnails are not inputs to any quality metric.

The evaluator requires the ORIGINAL frozen artifact as reference. The existing ray oracle reports nine BVH/CPU-reference discrepancies on the original RX 9070 XT baseline; this remains an explicit limitation. Replays preserve that report and hash all 2,000 GPU ray answers, requiring the candidate's entire answer buffer to equal the original's, rather than accepting only an unchanged mismatch count. No original baseline, source archive or timed validation gate is modified.

`AUTORESEARCH_RESULTS.tsv` has one row per iteration and can be read using Python `csv.DictReader(file, delimiter='\t')`. For paired iterations, its timing columns average the run summaries (including the mean of run p95 values); artifact prefixes link to full IDs in `PERFORMANCE_4K_ULTRA.json`, which contains hypotheses, changes, decisions and calibration provenance. The final report also provides p95 over all 2,700 measured frames per arm. Detailed runs, rejected artifacts, patches, quality images and comparison summaries are retained under `.bench/research-20261005` and `.bench/artifacts`. Run Python image analysis separately from timed CPU/GPU measurements.

### Faster subsequent iterations

After one coherent code change, the session helper builds with the existing immutable artifact builder, runs the exact native screen and updates both logs:

```powershell
node tools/native-quality/iterate.mjs --id E60 --label 'Short change name' --hypothesis 'Why it should improve GPU time' --change 'Files and algorithm changed' --quick
```

Omit `--quality` for a screen only; add `--dry-run` to inspect the configuration without building, measuring or writing. IDs cannot overwrite prior experiments. Screens that fail to improve original GPU mean by 2% and p95 stop early. This is a triage rule, not a retention gate. Promising screens with `--quality` reuse the preserved ORIGINAL quality captures, run one new untimed candidate replay, evaluate all 45 native images and produce review sheets. Hardware/runtime/configuration changes invalidate reference reuse. The helper prints the three-pair comparison command with the independently calibrated tolerances; native visual review and fresh paired confirmation remain required. Final confirmation still requires nine fresh pairs. The helper does not edit or revert source changes automatically.

For the overnight exploration requested by the user, `--quick` replaces that full replay with SSIM and state checks on the two native snapshots already captured by the screen. Both use the ORIGINAL frozen artifact, never the incumbent candidate. `--reference <run.json>` changes only performance triage: a 0.5% mean reduction plus lower p95 promotes a provisional candidate. Full quality evaluation, manual review, build/tests and paired confirmation are deferred to a finalist. No timing result is cached, and the 180 warmup / 300 measured frame counts stay fixed.

The quick evaluator already computes byte RMSE and maximum difference. The helper now applies the existing independently calibrated paired-image bounds to those values too, without another image pass or GPU run. A candidate that fails this early precheck is not promoted even if its SSIM passes; neither tolerance nor the final paired gate is relaxed.

The table's `elapsed_seconds` records automated build-through-decision time including any host-load wait, with that wait also shown as `host_wait_seconds`. Implementation/planning time is separate. Overnight batches initially used one host CPU reading below 65%, then five readings below 50% after unrelated work slowed otherwise unchanged rendering. Later exploratory batches use three readings below 50%, three seconds apart: the longer admission wait was not preventing mid-run load spikes. The stricter five-reading window is reserved for final confirmation. Each later row records its admission policy. This wait occurs before the native process starts and does not change its measurement protocol. Raw affected results are preserved and marked inconclusive in the experiment log. The exploration cutoff is 07:15 Sydney time, reserving time for final confirmation before 08:00.

Final retained-pair image analysis uses two bounded CPU workers only after the GPU comparison has finished. GPU jobs remain serialized; frame counts, timing boundaries, SSIM computation and acceptance gates are unchanged.

For the final overnight candidate, use one fresh `bench:compare --pairs 3 --max-pairs 9` run. The existing runner persists its three-pair interim result and continues through all nine fresh pairs without early stopping. This supplies both checkpoints without an additional standalone three-pair run; all final gates still apply to the full nine-pair result.

The final selected row keeps its original exploratory `elapsed_seconds` and adds `confirmation_seconds` for the one-time full confirmation (build/tests, replay, full SSIM/manual review, host wait, nine pairs and their saved-image analysis). Do not interpret the exploratory screen duration as the duration of final confirmation. The final report also distinguishes passing the existing CPU significance gate from establishing CPU non-regression; a wide confidence interval can pass the former without establishing the latter.
