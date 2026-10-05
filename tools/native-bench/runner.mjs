import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { tmpdir } from 'node:os';
import { VERSION, TOOL_DIR, sha256, stable, summary, percentile, writeJson, readJson, removeTemporary } from './common.mjs';
import { loadArtifact } from './artifact.mjs';
import { runtimeIdentity, openRuntime, adapterIdentity, offscreenSurface } from './runtime.mjs';
import { createWorkload } from './workload.mjs';

function finiteState(value) {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Nonfinite simulation/camera state');
  if (value && typeof value === 'object') for (const item of Object.values(value)) finiteState(item);
}
export async function runNative(artifactPath, options, outputPath) {
  const startedAt = new Date().toISOString(), manifest = await loadArtifact(artifactPath);
  const environment = await runtimeIdentity(options), runtime = await openRuntime(options);
  let renderer, unlisten, scoped = false;
  const faults = [], rows = new Map(), snapshots = [], warmupSamples = new Map(), frameIds = new Set(), earlySamples = [];
  let phase = 'setup', adapter, workload;
  const diagnostics = { measured: 0, dropped: 0, failed: 0, invalid: 0, duplicate: 0, pending: 0 };
  const previousFetch = globalThis.fetch;
  const result = { schemaVersion: VERSION, kind: 'native-offscreen-frame-cost', status: 'invalid', startedAt,
    artifact: { id: manifest.id, source: manifest.source }, options, environment, snapshots,
    units: 'milliseconds; GPU timestamps are elapsed time, not hardware cycles',
    scope: 'Offscreen GPU frame and synchronous CPU work; excludes browser UI/audio/presentation and benchmark waits.' };
  try {
    adapter = (await adapterIdentity(runtime.gpu)).identity;
    result.adapter = adapter;
    globalThis.fetch = async url => {
      if (!/(^|\/)data\/stars\.bin$/.test(String(url))) throw new Error(`Unexpected benchmark asset: ${url}`);
      const bytes = await readFile(resolve(artifactPath, 'data/stars.bin'));
      return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    };
    const api = await import(pathToFileURL(resolve(artifactPath, manifest.entry)).href);
    const modules = api.createDefaultModules();
    workload = createWorkload(api, options, modules);
    const output = offscreenSurface(options.width, options.height);
    renderer = await api.Renderer.create(output.surface, workload.settings, modules, undefined, { gpuProfile: options.profile });
    if (renderer.adapter.software || !renderer.gpuProfiling.supported) throw new Error('Renderer did not select a hardware timestamp adapter');
    const actual = renderer.adapter;
    if (['vendor', 'architecture', 'device', 'description'].some(key => (actual[key] ?? '') !== adapter[key])) throw new Error('Renderer selected a different adapter');
    result.settings = workload.settings; result.workload = workload.describe; result.profiling = renderer.gpuProfiling;
    renderer.device.pushErrorScope('validation'); scoped = true;
    renderer.setScene(workload.scene); workload.afterScene();
    const recordTiming = sample => {
      if (phase === 'warmup') {
        if (sample.status === 'measured' && Number.isFinite(sample.gpuMs)) warmupSamples.set(sample.frameIndex, sample.gpuMs);
        else faults.push(`Warmup timing ${sample.status}`);
        return;
      }
      const row = rows.get(sample.frameIndex);
      if (!row) { if (phase === 'measured') earlySamples.push(sample); return; }
      if (frameIds.has(sample.frameIndex)) { diagnostics.duplicate++; return; }
      frameIds.add(sample.frameIndex);
      if (sample.status !== 'measured') { diagnostics[sample.status]++; return; }
      if (!Number.isFinite(sample.gpuMs) || sample.gpuMs < 0 || sample.passMs.length !== 6 || !sample.passMs.every(x => Number.isFinite(x) && x >= 0)) {
        diagnostics.invalid++; return;
      }
      if (options.profile && (!sample.detailMs || Object.values(sample.detailMs).some(x => x !== null && (!Number.isFinite(x) || x < 0)))) {
        diagnostics.invalid++; return;
      }
      diagnostics.measured++; row.gpuMs = sample.gpuMs; row.passMs = [...sample.passMs]; row.detailMs = sample.detailMs;
    };
    unlisten = renderer.listenGpuTimings(recordTiming);
    const drain = async () => {
      await renderer.device.queue.onSubmittedWorkDone();
      if (!await renderer.drainGpuTimings(10000)) throw new Error('GPU timing readback drain timed out');
      if (renderer.lost || renderer.totalErrorCount) throw new Error(renderer.lost ?? renderer.errors.join('; '));
    };
    phase = 'warmup';
    for (let i = 0; i < options.warmup; i++) {
      renderer.render(workload.step());
      if ((i + 1) % options.inFlight === 0 || i + 1 === options.warmup) await drain();
    }
    const warmupGpu = [...warmupSamples.entries()].sort((a, b) => a[0] - b[0]).map(([, ms]) => ms);
    const windows = [3, 2, 1].map(back => {
      const end = warmupGpu.length - (back - 1) * 20;
      return percentile(warmupGpu.slice(Math.max(0, end - 20), end), .5);
    });
    const warmupSpread = windows.every(x => x !== null && x > 0) ? (Math.max(...windows) - Math.min(...windows)) / Math.max(...windows) : null;
    result.warmup = { frames: options.warmup, measured: warmupGpu.length, finalWindowMediansMs: windows,
      relativeSpread: warmupSpread, stable: warmupSpread !== null && warmupSpread <= options.stability,
      note: 'Fixed workload prefix. Stability gate applies to stationary workload; moving scenes naturally change cost.' };
    if (warmupGpu.length !== options.warmup) faults.push('Incomplete warmup timings');
    if (options.workload === 'stationary' && !result.warmup.stable) faults.push('Stationary warmup has not settled; increase fixed warmup for both builds');
    const checkpoints = new Set([Math.floor(options.frames / 2) - 1, options.frames - 1]);
    let elapsedMs = 0, batchStart = performance.now();
    phase = 'measured';
    for (let i = 0; i < options.frames; i++) {
      const start = performance.now(), frame = workload.step(), simulated = performance.now();
      renderer.render(frame);
      const end = performance.now(), frameIndex = renderer.stats.frameIndex;
      if (rows.has(frameIndex)) throw new Error('Renderer did not advance frame index');
      rows.set(frameIndex, { frameIndex, simulationMs: simulated - start, renderMs: end - simulated,
        cpuMs: end - start, gpuMs: null, passMs: null, detailMs: null });
      // A dropped sample can be published synchronously during render(), before the row exists.
      for (const sample of earlySamples.splice(0)) recordTiming(sample);
      if ((i + 1) % options.inFlight === 0 || checkpoints.has(i)) {
        await drain(); elapsedMs += performance.now() - batchStart;
        if (checkpoints.has(i)) {
          const state = JSON.parse(JSON.stringify(workload.state())); finiteState(workload.state());
          const rgba = await output.read();
          let min = 255, max = 0;
          for (let p = 0; p < rgba.length; p += 4) for (let c = 0; c < 3; c++) { min = Math.min(min, rgba[p + c]); max = Math.max(max, rgba[p + c]); }
          if (max - min < 8) faults.push(`Trivial output at frame ${frameIndex}`);
          const imageFile = `${basename(outputPath)}.frame-${frameIndex}.rgba`;
          await writeFile(resolve(dirname(outputPath), imageFile), rgba);
          snapshots.push({ frameIndex, width: options.width, height: options.height, imageFile,
            retained: true, imageSha256: sha256(rgba), state, stateSha256: sha256(stable(state)), rgbRange: [min, max] });
        }
        batchStart = performance.now();
      }
    }
    await drain(); unlisten(); unlisten = null;
    phase = 'complete';
    const validation = await renderer.device.popErrorScope(); scoped = false;
    if (validation) faults.push(`WebGPU validation: ${validation.message}`);
    diagnostics.pending = rows.size - frameIds.size;
    if (diagnostics.measured !== options.frames || diagnostics.duplicate || diagnostics.pending || earlySamples.length) faults.push('Incomplete or duplicate GPU frame samples');
    const samples = [...rows.values()];
    result.timing = { cpuSimulationMs: summary(samples.map(s => s.simulationMs)), cpuRenderMs: summary(samples.map(s => s.renderMs)),
      cpuCombinedMs: summary(samples.map(s => s.cpuMs)), gpuFrameMs: summary(samples.filter(s => s.gpuMs !== null).map(s => s.gpuMs)),
      perPassMs: Object.fromEntries(['pre', 'gbuffer', 'rt', 'lighting', 'sky+fwd', 'post'].map((name, index) =>
        [name, summary(samples.filter(s => s.passMs).map(s => s.passMs[index]))])),
      detailsMs: options.profile ? Object.fromEntries([...new Set(samples.flatMap(s => Object.keys(s.detailMs ?? {})))].map(name =>
        [name, summary(samples.map(s => s.detailMs?.[name]).filter(x => Number.isFinite(x) && x >= 0))])) : null,
      batch: { completedFrames: options.frames, elapsedMs, fps: options.frames * 1000 / elapsedMs,
        note: 'Includes bounded queue waits/readback bookkeeping; excludes snapshot readback and setup.' } };
    result.samples = samples; result.gpuTiming = diagnostics;
    result.status = faults.length ? 'invalid' : 'valid';
  } catch (error) { faults.push(error.stack ?? String(error)); }
  finally {
    unlisten?.();
    if (scoped && renderer && !renderer.lost) {
      try { const error = await renderer.device.popErrorScope(); if (error) faults.push(error.message); } catch (error) { faults.push(String(error)); }
    }
    try { renderer?.destroy(); } catch (error) { faults.push(String(error)); }
    globalThis.fetch = previousFetch; runtime.close();
  }
  result.faults = faults;
  if (faults.length) result.status = 'invalid';
  result.finishedAt = new Date().toISOString();
  // Catch changes to artifacts/assets during a run before publishing a valid measurement.
  try { await loadArtifact(artifactPath); } catch (error) { result.faults.push(String(error)); result.status = 'invalid'; }
  await writeJson(outputPath, result);
  return result;
}

// Every artifact gets a fresh process. Startup/import/JIT warmup is outside measured frame costs.
export async function runChild(artifact, options, output, signal) {
  const result = await isolatedChild({ mode: 'run', artifact: resolve(artifact), options, output: resolve(output) }, options.timeoutMs, signal);
  if (result.artifact?.id !== (await loadArtifact(artifact)).id || stable(result.options) !== stable(options)) throw new Error('Child result identity mismatch');
  return result;
}
export async function probeChild(options, output, signal) {
  return isolatedChild({ mode: 'capabilities', options, output: resolve(output) }, options.timeoutMs, signal);
}
async function isolatedChild(payload, timeoutMs, signal) {
  const temp = await mkdtemp(resolve(tmpdir(), 'fpv-native-job-'));
  try {
    const request = resolve(temp, 'request.json');
    await writeJson(request, payload);
    let log = '';
    await new Promise((accept, reject) => {
      const child = spawn(process.execPath, [resolve(TOOL_DIR, '../bench-native.mjs'), 'internal-run', '--request', request],
        { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let timedOut = false;
      const abort = () => child.kill();
      const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { log = (log + data).slice(-16384); });
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
      child.on('error', error => { cleanup(); reject(error); });
      child.on('close', code => {
        cleanup();
        if (signal?.aborted) reject(new Error('Benchmark cancelled'));
        else if (timedOut) reject(new Error(`Benchmark exceeded ${timeoutMs} ms`));
        else if (code === 0 || code === 1) accept();
        else reject(new Error(`Benchmark process exited ${code}: ${log}`));
      });
    });
    return await readJson(payload.output);
  } finally { await removeTemporary(temp, tmpdir(), 'fpv-native-job-'); }
}
