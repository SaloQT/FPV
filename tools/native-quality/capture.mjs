// Untimed visual/correctness replay. Reuses the frozen workload and native runtime;
// deliberately does not change or wrap the timed runner.
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, checkArgs, runOptions, stable, sha256, writeJson } from '../native-bench/common.mjs';
import { loadArtifact } from '../native-bench/artifact.mjs';
import { acquireGpuLock } from '../native-bench/lock.mjs';
import { runtimeIdentity, openRuntime, adapterIdentity, offscreenSurface } from '../native-bench/runtime.mjs';
import { createWorkload } from '../native-bench/workload.mjs';

const args = parseArgs(process.argv.slice(2));
checkArgs(args, ['artifact', 'out', 'child']);
if (typeof args.artifact !== 'string' || typeof args.out !== 'string') throw new Error('--artifact and --out required');
const artifactPath = resolve(args.artifact), outputPath = resolve(args.out);
if (!args.child) {
  const release = await acquireGpuLock();
  try {
    const code = await new Promise((accept, reject) => {
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--artifact', artifactPath, '--out', outputPath, '--child'],
        { stdio: 'inherit', windowsHide: true });
      const timer = setTimeout(() => child.kill(), 300000);
      child.on('error', reject);
      child.on('close', code => { clearTimeout(timer); accept(code ?? 2); });
    });
    process.exitCode = code;
  } finally { await release(); }
} else {
  const options = runOptions({ workload: 'fpv-flight', quality: 'ultra', size: '3840x2160', scale: '1', warmup: '180', frames: '300', backend: 'd3d12' });
  const manifest = await loadArtifact(artifactPath), environment = await runtimeIdentity(options);
  const runtime = await openRuntime(options);
  let renderer, scoped = false;
  const faults = [], snapshots = [], states = [];
  // Fixed before candidate testing: broad flight coverage plus consecutive bursts
  // around acceleration, mid-flight, a later view and the end. Native pixels only.
  const frames = new Set([0, 59, 119, 179, 209, 239, 269, 299, 329, 359, 389, 419, 449, 479,
    ...[180, 300, 400, 472].flatMap(start => Array.from({ length: 8 }, (_, i) => start + i))]);
  const result = { kind: 'untimed-native-quality-replay', status: 'invalid', startedAt: new Date().toISOString(), artifact: manifest.id, options, environment,
    captureScriptSha256: sha256(await readFile(fileURLToPath(import.meta.url))),
    coverage: { frames: [...frames].sort((a, b) => a - b), bursts: [[180, 187], [300, 307], [400, 407], [472, 479]] }, snapshots, states, faults };
  try {
    await mkdir(dirname(outputPath), { recursive: true });
    result.adapter = (await adapterIdentity(runtime.gpu)).identity;
    globalThis.fetch = async url => {
      if (!/(^|\/)data\/stars\.bin$/.test(String(url))) throw new Error(`Unexpected asset ${url}`);
      const bytes = await readFile(resolve(artifactPath, 'data/stars.bin'));
      return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    };
    const api = await import(pathToFileURL(resolve(artifactPath, manifest.entry)).href);
    const modules = api.createDefaultModules(), workload = createWorkload(api, options, modules);
    const output = offscreenSurface(options.width, options.height);
    renderer = await api.Renderer.create(output.surface, workload.settings, modules, undefined, { gpuProfile: false });
    if (renderer.adapter.software || ['vendor', 'device', 'architecture', 'description'].some(k => renderer.adapter[k] !== result.adapter[k])) throw new Error('Adapter mismatch');
    if (result.adapter.device !== 'amd-radeon-rx-9070-xt' || result.adapter.fallback) throw new Error('RX 9070 XT required');
    renderer.device.pushErrorScope('validation'); scoped = true;
    renderer.setScene(workload.scene); workload.afterScene();
    result.settings = workload.settings; result.workload = workload.describe;
    for (let index = 0; index < options.warmup + options.frames; index++) {
      renderer.render(workload.step());
      const state = JSON.parse(JSON.stringify(workload.state()));
      if (!state.quad) throw new Error('Missing FPV state');
      const finite = value => {
        if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Nonfinite state');
        if (value && typeof value === 'object') for (const v of Object.values(value)) finite(v);
      };
      finite(workload.state());
      states.push(sha256(stable(state)));
      if ((index + 1) % options.inFlight === 0 || frames.has(index)) {
        await renderer.device.queue.onSubmittedWorkDone();
        if (!await renderer.drainGpuTimings(10000)) throw new Error('Timing readback drain failed');
        if (renderer.lost || renderer.totalErrorCount) throw new Error(renderer.lost ?? renderer.errors.join('; '));
      }
      if (frames.has(index)) {
        if (renderer.stats.frameIndex !== index) throw new Error('Frame identity mismatch');
        const rgba = await output.read();
        const imageFile = `${basename(outputPath)}.frame-${index}.rgba`;
        await writeFile(resolve(dirname(outputPath), imageFile), rgba);
        snapshots.push({ frameIndex: index, width: options.width, height: options.height, imageFile, imageSha256: sha256(rgba), stateSha256: states[index], state });
      }
    }
    // Run the production GPU/CPU ray oracle after all captures, outside rendering.
    // Record the existing oracle independently: the ORIGINAL already disagrees
    // on nine BVH rays on this adapter. Preserve its report and hash the entire
    // GPU answer buffer so regressions cannot hide behind an unchanged count.
    const readbacks = [];
    const createBuffer = renderer.device.createBuffer.bind(renderer.device);
    renderer.device.createBuffer = descriptor => {
      const buffer = createBuffer(descriptor);
      if (descriptor.label === 'rt test readback') {
        const getMappedRange = buffer.getMappedRange.bind(buffer);
        buffer.getMappedRange = (...args) => {
          const range = getMappedRange(...args);
          readbacks.push(sha256(new Uint8Array(range)));
          return range;
        };
      }
      return buffer;
    };
    try { result.raySelfTest = await modules.find(m => m.name === 'rt').selfTest(); }
    finally { renderer.device.createBuffer = createBuffer; }
    if (readbacks.length !== 1) throw new Error('Missing ray oracle readback');
    result.raySelfTest.readbackSha256 = readbacks[0];
    result.raySelfTest.referenceAgreement = !result.raySelfTest.heightfield.mismatches && !result.raySelfTest.bvh.mismatches;
    const validation = await renderer.device.popErrorScope(); scoped = false;
    if (validation) faults.push(validation.message);
    result.status = faults.length ? 'invalid' : 'valid';
  } catch (error) { faults.push(error.stack ?? String(error)); }
  finally {
    if (scoped && renderer && !renderer.lost) {
      const validation = await renderer.device.popErrorScope();
      if (validation) faults.push(validation.message);
    }
    renderer?.destroy(); runtime.close();
  }
  try { await loadArtifact(artifactPath); } catch (error) { faults.push(String(error)); }
  if (faults.length) result.status = 'invalid';
  result.finishedAt = new Date().toISOString();
  await writeJson(outputPath, result);
  console.log(JSON.stringify({ status: result.status, snapshots: snapshots.length, raySelfTest: result.raySelfTest, faults, outputPath }));
  process.exit(result.status === 'valid' ? 0 : 1);
}
