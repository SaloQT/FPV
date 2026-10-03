// Bounded actual-Dawn exposure reduce regression; counters are not timings/FPS.
// WEBGPU_MODULE=/absolute/path/to/webgpu/index.js node tools/test-exposure-reduce-gpu.mjs BASELINE_ROOT OUTPUT_DIR
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baseline = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
mkdirSync(output, { recursive: true });
// Resolve actual production tuning instead of maintaining a test-only copy.
async function defines(repo, tag) {
  const entry = resolve(output, `${tag}-defines-entry.ts`);
  writeFileSync(entry, `export { exposureDefines } from ${JSON.stringify(resolve(repo, 'src/render/post/exposure.ts'))};`);
  const result = await build({ root, configFile: false, logLevel: 'error', build: {
    ssr: entry, write: false, minify: false,
    rolldownOptions: { output: { format: 'es' } },
  } });
  const chunk = result.output.find(v => v.type === 'chunk' && v.isEntry);
  assert(chunk && !chunk.imports.length, 'Tuning bundle must be self-contained');
  const module = await import(`data:text/javascript;base64,${Buffer.from(chunk.code).toString('base64')}`);
  return module.exposureDefines();
}
const constants = await defines(root, 'candidate');
assert.deepEqual(constants, await defines(baseline, 'baseline'));
writeFileSync(resolve(output, 'constants.json'), JSON.stringify(constants, null, 2));
const { create, globals } = await import(process.env.WEBGPU_MODULE ? pathToFileURL(process.env.WEBGPU_MODULE).href : 'webgpu');
Object.assign(globalThis, globals);
const gpu = create(['backend=vulkan']);
const adapter = await gpu.requestAdapter();
assert(adapter, 'Vulkan adapter required');
const device = await adapter.requestDevice();
const errors = [];
device.addEventListener('uncapturederror', e => errors.push(e.error.message));
device.pushErrorScope('validation');
function shader(repo) {
  return readFileSync(resolve(repo, 'src/render/shaders/post/histogram.wgsl'), 'utf8')
    .replace(/\$\{(\w+)\}/g, (_, name) => { assert(name in constants, name); return String(constants[name]); });
}
function instrument(code) {
  code += '\n@group(1) @binding(0) var<storage, read_write> counters : array<atomic<u32>, 4>;\n';
  for (const [name, index] of [['trimmedMeanEv', 0], ['highlightRoll', 1]]) {
    const pattern = new RegExp(`(fn ${name}\\([^]*?\\) -> f32 \\{)`);
    assert(pattern.test(code), `Missing ${name}`);
    code = code.replace(pattern, `$1\n  atomicAdd(&counters[${index}], 1u);`);
  }
  // Count exactly the body iterations of the expensive trimmed-mean loop.
  const point = '    let w = max(min(cum + h, hi) - max(cum, lo), 0.0);';
  assert(code.includes(point));
  return code.replace(point, `    atomicAdd(&counters[2], 1u);\n${point}`);
}
const pipelines = {};
for (const [tag, repo] of [['baseline', baseline], ['candidate', root]]) {
  for (const counted of [false, true]) {
    const code = counted ? instrument(shader(repo)) : shader(repo);
    writeFileSync(resolve(output, `${tag}-${counted ? 'counted' : 'production'}.wgsl`), code);
    const module = device.createShaderModule({ code });
    const messages = (await module.getCompilationInfo()).messages;
    assert.equal(messages.filter(v => v.type === 'error').length, 0, JSON.stringify(messages));
    pipelines[`${tag}-${counted}`] = await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'reduce' } });
  }
}
const histogram = (...points) => {
  const result = new Uint32Array(128);
  for (const [bin, count] of points) result[bin] += count;
  return Array.from(result);
};
const mixed = histogram([3, 120], [16, 500], [27, 1000], [40, 120], [64 + 37, 1000], [64 + 55, 50]);
const sky = histogram([64 + 4, 40], [64 + 36, 800], [64 + 51, 120]);
const ground = histogram([2, 100], [24, 700], [41, 40]);
const threshold = constants.EXPECTED_MEAN_EV - constants.TRIM_BLEND_LO_EV;
const highThreshold = constants.EXPECTED_MEAN_EV - constants.TRIM_BLEND_HI_EV;
const fixtures = [
  { name: 'night-mixed', bins: mixed, preEv: 8 },
  { name: 'day-mixed', bins: mixed, preEv: -14 },
  { name: 'blend-mixed', bins: mixed, preEv: (threshold + highThreshold) / 2 },
  ...[-0.0001, 0, 0.0001].map(delta => ({ name: `trim-low-boundary-${delta}`, bins: mixed, preEv: threshold + delta })),
  ...[-0.0001, 0, 0.0001].map(delta => ({ name: `trim-high-boundary-${delta}`, bins: mixed, preEv: highThreshold + delta })),
  { name: 'night-sky-only', bins: sky, preEv: 8 },
  { name: 'day-sky-only', bins: sky, preEv: -14 },
  { name: 'night-ground-only', bins: ground, preEv: 8 },
  { name: 'day-ground-only', bins: ground, preEv: -14 },
  ...[0, 1, 2].map(weight => ({ name: `ground-presence-${weight}`, bins: histogram([27, weight], [99, 800]), preEv: -2 })),
  ...[0, 1, 2].map(weight => ({ name: `total-presence-${weight}`, bins: histogram([30, weight]), preEv: 8 })),
  { name: 'sky-median-last-bin', bins: histogram([10, 200], [127, 300]), preEv: 8 },
];
// Cover initialisation, adaptation, reset, negative/clamped dt and persistent state.
const states = [
  { name: 'initial', adapt: [0, 0, 0, 0], ratio: [1, 0, 0, 0, 1e12, 0, 17, -3], dt: 1 / 60, reset: 0 },
  { name: 'adapt', adapt: [-5, 1, 2, 0.65], ratio: [0.75, 1, -3, -2, 8, 0.65, 17, -3], dt: 1 / 30, reset: 0 },
  { name: 'reset', adapt: [-5, 1, 2, 0.65], ratio: [0.75, 1, -3, -2, 8, 0.65, 17, -3], dt: 0.8, reset: 1 },
  { name: 'negative-dt', adapt: [-5, 1, 2, 0.65], ratio: [0.75, 1, -3, -2, 8, 0.65, 17, -3], dt: -0.1, reset: 0 },
];
async function run(tag, counted, fixture, state) {
  const buffers = [];
  function buffer(data, uniform = false) {
    const b = device.createBuffer({ size: data.byteLength, usage: (uniform ? GPUBufferUsage.UNIFORM : GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC) | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(b, 0, data); buffers.push(b); return b;
  }
  const params = new ArrayBuffer(16), pf = new Float32Array(params), pu = new Uint32Array(params);
  pf[0] = 2 ** fixture.preEv; pf[1] = state.dt; pu[2] = 19; pu[3] = state.reset;
  const hist = buffer(new Uint32Array(fixture.bins));
  const p = buffer(new Uint8Array(params), true);
  const adapt = buffer(new Float32Array(state.adapt)), ratio = buffer(new Float32Array(state.ratio));
  const counter = buffer(new Uint32Array(4));
  const pipeline = pipelines[`${tag}-${counted}`];
  const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [[1, hist], [2, p], [3, adapt], [4, ratio]].map(([binding, buffer]) => ({ binding, resource: { buffer } })) });
  const read = device.createBuffer({ size: 576, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass();
  pass.setPipeline(pipeline); pass.setBindGroup(0, group);
  if (counted) pass.setBindGroup(1, device.createBindGroup({ layout: pipeline.getBindGroupLayout(1), entries: [{ binding: 0, resource: { buffer: counter } }] }));
  pass.dispatchWorkgroups(1); pass.end();
  encoder.copyBufferToBuffer(adapt, 0, read, 0, 16); encoder.copyBufferToBuffer(ratio, 0, read, 16, 32);
  encoder.copyBufferToBuffer(hist, 0, read, 48, 512); encoder.copyBufferToBuffer(counter, 0, read, 560, 16);
  device.queue.submit([encoder.finish()]); await read.mapAsync(GPUMapMode.READ);
  const bytes = Buffer.from(new Uint8Array(read.getMappedRange()).slice()); read.unmap();
  for (const b of [...buffers, read]) b.destroy();
  return bytes;
}
const results = [];
for (const fixture of fixtures) {
  for (const state of states) {
    const a = await run('baseline', false, fixture, state), b = await run('candidate', false, fixture, state);
    assert(a.equals(b), `Production mismatch: ${fixture.name}/${state.name}`);
    assert(Array.from(new Float32Array(b.buffer, b.byteOffset, 12)).every(Number.isFinite));
    assert(b.subarray(48, 560).every(v => v === 0), 'Histogram must be consumed/cleared');
    writeFileSync(resolve(output, `${fixture.name}-${state.name}-baseline.bin`), a);
    writeFileSync(resolve(output, `${fixture.name}-${state.name}-candidate.bin`), b);
    const result = { fixture: fixture.name, state: state.name, exact: true, sha256: createHash('sha256').update(b).digest('hex'), values: Array.from(new Float32Array(b.buffer, b.byteOffset, 12)) };
    if (state.name === 'initial') {
      const ac = await run('baseline', true, fixture, state), bc = await run('candidate', true, fixture, state);
      assert(ac.subarray(0, 560).equals(a.subarray(0, 560)), 'Baseline instrumentation changed results');
      assert(bc.subarray(0, 560).equals(b.subarray(0, 560)), 'Candidate instrumentation changed results');
      result.counts = { baseline: Array.from(new Uint32Array(ac.buffer, ac.byteOffset + 560, 4)), candidate: Array.from(new Uint32Array(bc.buffer, bc.byteOffset + 560, 4)) };
    }
    results.push(result);
  }
}
// Assert the intended conditional savings and the unchanged daylight active path.
const expectedCounts = {
  'night-mixed': [[4, 1, 256, 0], [2, 1, 128, 0]],
  'night-sky-only': [[2, 1, 128, 0], [1, 0, 64, 0]],
  'day-sky-only': [[2, 1, 128, 0], [2, 0, 128, 0]],
  'day-mixed': [[4, 1, 256, 0], [4, 1, 256, 0]],
};
for (const [name, [baselineCounts, candidateCounts]] of Object.entries(expectedCounts)) {
  const actual = results.find(r => r.fixture === name && r.state === 'initial').counts;
  assert.deepEqual(actual.baseline, baselineCounts, name);
  assert.deepEqual(actual.candidate, candidateCounts, name);
}
assert.equal(await device.popErrorScope(), null); assert.deepEqual(errors, []);
const report = { adapter: Object.fromEntries(['vendor', 'architecture', 'device', 'description', 'isFallbackAdapter'].map(k => [k, adapter.info[k]])), productionCases: results.length, fixtureCount: fixtures.length, counterLabels: ['trimmedMeanEv calls', 'highlightRoll calls', 'trimmedMeanEv bin iterations', 'unused'], errors, constants, fixtures, states, results, limitations: 'Bounded reduce-kernel equivalence, not full-frame or all-input proof. Test-only counters indicate skipped algorithm work, not elapsed time or FPS. Small serial reduction kernel; benefit is conditional.' };
writeFileSync(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ adapter: report.adapter, productionCases: results.length, exact: true, counters: results.filter(r => r.counts).map(({fixture, counts}) => ({fixture, ...counts})) }, null, 2));
device.destroy();
