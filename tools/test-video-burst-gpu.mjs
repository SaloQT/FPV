// Bounded actual-Dawn regression for the inactive video-burst fast path.
// VK_ICD_FILENAMES=/path/to/vulkan/icd.json WEBGPU_MODULE=/path/to/webgpu/index.js node tools/test-video-burst-gpu.mjs BASELINE_ROOT OUTPUT_DIR
// Full production composite readbacks are separate from function-boundary and instrumented checks.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baseline = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
mkdirSync(output, { recursive: true });
console.log('PHASE import-webgpu');
const { create, globals } = await import(process.env.WEBGPU_MODULE ? pathToFileURL(process.env.WEBGPU_MODULE).href : 'webgpu');
Object.assign(globalThis, globals);
console.log('PHASE create-vulkan');
const gpu = create(['backend=vulkan']);
console.log('PHASE request-adapter');
const adapter = await gpu.requestAdapter();
assert(adapter, 'A Vulkan adapter is required');
console.log('PHASE request-device');
const device = await adapter.requestDevice();
console.log('PHASE device-ready');
const errors = [];
let lost = null;
device.addEventListener('uncapturederror', e => errors.push(e.error.message));
device.lost.then(info => { if (info.reason !== 'destroyed') lost = info.message; });
device.pushErrorScope('validation');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function shader(repo, entry, defines = {}) {
  const seen = new Set();
  function expand(name) {
    if (seen.has(name)) return '';
    seen.add(name);
    const lines = readFileSync(resolve(repo, 'src/render/shaders', name), 'utf8').split('\n');
    const skip = [], out = [];
    for (const line of lines) {
      const t = line.trim(); let m;
      if ((m = t.match(/^#ifdef\s+(\w+)/))) { skip.push(!defines[m[1]]); continue; }
      if ((m = t.match(/^#ifndef\s+(\w+)/))) { skip.push(!!defines[m[1]]); continue; }
      if (t.startsWith('#else')) { skip.push(!skip.pop()); continue; }
      if (t.startsWith('#endif')) { skip.pop(); continue; }
      if (skip.some(Boolean)) continue;
      if ((m = t.match(/^#include "([^"]+)"/))) out.push(expand(m[1]));
      else out.push(line.replace(/\$\{(\w+)\}/g, (_, k) => { assert(k in defines); return String(defines[k]); }));
    }
    return out.join('\n');
  }
  return expand(entry);
}
async function moduleFor(code, name) {
  writeFileSync(resolve(output, `${name}.wgsl`), code);
  const module = device.createShaderModule({ label: name, code });
  const messages = (await module.getCompilationInfo()).messages;
  assert.equal(messages.filter(m => m.type === 'error').length, 0, JSON.stringify(messages));
  return module;
}
function buffer(data, usage) {
  const b = device.createBuffer({ size: data.byteLength, usage: usage | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(b, 0, data); return b;
}
async function readBuffer(encoder, source, size) {
  const read = device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  encoder.copyBufferToBuffer(source, 0, read, 0, size);
  device.queue.submit([encoder.finish()]);
  await read.mapAsync(GPUMapMode.READ);
  const bytes = Buffer.from(read.getMappedRange().slice(0));
  read.unmap(); read.destroy(); return bytes;
}
function f32FromBits(bits) { return new Float32Array(Uint32Array.of(bits).buffer)[0]; }
const thresholdBits = new Uint32Array(Float32Array.of(0.7).buffer)[0];
const noiseValues = [-1, -0, 0, 0.15, 0.4, 0.5, f32FromBits(thresholdBits - 1), f32FromBits(thresholdBits), f32FromBits(thresholdBits + 1), 0.71, 0.8, 0.9, 1, 1.1];
const vValues = [-0.1, -0, 0, ...Array.from({ length: 65 }, (_, i) => i / 64), 1.1];
const frameValues = [...Array.from({ length: 64 }, (_, i) => i * 6), 0xffffffff];
const samples = [];
for (const vn of noiseValues) for (const frame of frameValues) for (const v of vValues) samples.push({ vn, frame, v });
const inputData = new ArrayBuffer(samples.length * 16);
const inputF32 = new Float32Array(inputData), inputU32 = new Uint32Array(inputData);
samples.forEach((s, i) => { inputF32[i * 4] = s.v; inputF32[i * 4 + 1] = s.vn; inputU32[i * 4 + 2] = s.frame; });
writeFileSync(resolve(output, 'function-inputs.bin'), Buffer.from(inputData));
const inputs = buffer(inputData, GPUBufferUsage.STORAGE);
async function functionRun(repo, tag, counted) {
  console.log(`PHASE function ${tag} ${counted ? 'counted' : 'plain'}`);
  let code = shader(repo, 'post/video.wgsl');
  if (counted) {
    const needle = '  let h = pcg3d(vec3u(frame / 6u, 0x51u, 0x9du));';
    assert.equal(code.split(needle).length, 2);
    code = code.replace(needle, '  atomicAdd(&work[0], 1u);\n' + needle);
    code += '\n@group(0) @binding(2) var<storage, read_write> work : array<atomic<u32>, 1>;\n';
  }
  code += `\nstruct Sample { v : f32, vn : f32, frame : u32, pad : u32 }
@group(0) @binding(0) var<storage, read> inputs : array<Sample>;
@group(0) @binding(1) var<storage, read_write> results : array<u32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id : vec3u) {
  if (id.x >= ${samples.length}u) { return; }
  let s = inputs[id.x]; results[id.x] = bitcast<u32>(videoBurstCover(s.v, s.frame, s.vn));
}`;
  const module = await moduleFor(code, `${tag}-function-${counted ? 'counted' : 'plain'}`);
  const pipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } });
  const results = device.createBuffer({ size: samples.length * 4 + 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
  const counts = device.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const entries = [{ binding: 0, resource: { buffer: inputs } }, { binding: 1, resource: { buffer: results, size: samples.length * 4 } }];
  if (counted) entries.push({ binding: 2, resource: { buffer: counts } });
  const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries });
  const enc = device.createCommandEncoder(), pass = enc.beginComputePass();
  pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.dispatchWorkgroups(Math.ceil(samples.length / 64)); pass.end();
  if (counted) enc.copyBufferToBuffer(counts, 0, results, samples.length * 4, 4);
  const read = await readBuffer(enc, results, results.size);
  results.destroy(); counts.destroy();
  return { bytes: read.subarray(0, samples.length * 4), count: read.readUInt32LE(samples.length * 4) };
}
const plainBase = await functionRun(baseline, 'baseline', false), plainNext = await functionRun(root, 'candidate', false);
assert.deepEqual(plainNext.bytes, plainBase.bytes, 'Exact f32 function outputs, including zero sign');
writeFileSync(resolve(output, 'baseline-function.u32'), plainBase.bytes);
writeFileSync(resolve(output, 'candidate-function.u32'), plainNext.bytes);
const bits = new Uint32Array(plainNext.bytes.buffer, plainNext.bytes.byteOffset, samples.length);
let activeNonzero = 0, inactiveSamples = 0;
samples.forEach((s, i) => {
  if (Math.fround(s.vn) <= Math.fround(0.7)) { assert.equal(bits[i], 0, 'Inactive result must be positive zero'); inactiveSamples++; }
  else if (bits[i] !== 0) activeNonzero++;
});
assert(activeNonzero > 0, 'Function fixtures must actually exercise visible bursts');
console.log(JSON.stringify({ phase: 'function', samples: samples.length, exactF32Match: true, inactiveSamples, activeNonzero, sha256: hash(plainNext.bytes) }));
const countedBase = await functionRun(baseline, 'baseline', true), countedNext = await functionRun(root, 'candidate', true);
assert.deepEqual(countedBase.bytes, plainBase.bytes, 'Baseline counting preserves output');
assert.deepEqual(countedNext.bytes, plainNext.bytes, 'Candidate counting preserves output');
assert.equal(countedBase.count, samples.length);
assert.equal(countedBase.count - countedNext.count, inactiveSamples);
inputs.destroy();
// Full production shaders and bindings, with no instrumentation or altered entry points.
const width = 32, height = 16, row = 256;
function inputTexture(bloom) {
  const data = new Uint16Array(width * height * 4);
  const levels = [0, 0x0001, 0x0800, 0x1400, 0x2400, 0x3000, 0x3800, 0x3c00, 0x4000, 0x4800, 0x5800, 0x7400];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 4;
    for (let c = 0; c < 3; c++) data[at + c] = levels[(x + y * 3 + c * 5 + (bloom ? 2 : 0)) % levels.length];
    data[at + 3] = 0x3c00;
  }
  const t = device.createTexture({ size: [width, height], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({ texture: t }, data, { bytesPerRow: width * 8 }, [width, height]); return t;
}
const resolved = inputTexture(false), bloom = inputTexture(true);
const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
const layout = device.createBindGroupLayout({ entries: [
  ...[0, 1].map(binding => ({ binding, visibility: GPUShaderStage.FRAGMENT, texture: {} })),
  { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
  ...[3, 4].map(binding => ({ binding, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } })),
] });
const pipelines = {};
for (const format of ['rgba8unorm', 'rgba8unorm-srgb']) for (const [tag, repo] of [['baseline', baseline], ['candidate', root]]) {
  console.log(`PHASE composite-compile ${tag} ${format}`);
  const module = await moduleFor(shader(repo, 'post/composite.wgsl', { DITHER_LSB: 1 / 255, OUT_HW_SRGB: format.endsWith('-srgb') }), `${tag}-composite-${format}`);
  pipelines[`${tag}-${format}`] = await device.createRenderPipelineAsync({ layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format }] }, primitive: { topology: 'triangle-list' } });
}
function activeFrame(vn, full) {
  const frame = frameValues.find(frame => {
    const values = samples.flatMap((s, i) => Math.fround(s.vn) === Math.fround(vn) && s.frame === frame && s.v >= 0 && s.v <= 1 ? [bits[i]] : []);
    return full ? values.every(b => b === 0x3f800000) : values.some(b => b > 0);
  });
  assert.notEqual(frame, undefined); return frame;
}
const frames = [0, activeFrame(0.8, false), activeFrame(1, true)];
async function compositeRun(tag, format, fixture) {
  const p = new Float32Array(28), u = new Uint32Array(p.buffer);
  p.set([width, height, 1 / width, 1 / height]);
  const lens = fixture.lens;
  p.set([-0.25 * lens, 0.05 * lens, 1 - 0.2 * lens, 0.8 * lens / (0.5 * Math.hypot(width, height))], 4);
  p.set([0.35 + 0.65 * lens, 1.2 * lens, fixture.bloom, 2 * fixture.vn], 8);
  p.set(fixture.motion ? [0.5, -1, 0.2, 12] : [0, 0, 0, 12], 12);
  p.set(fixture.motion ? [0.25, 0.4, 1.2, 0.008] : [0, 0, 0, 0.008], 16);
  p[20] = fixture.vn; u[24] = fixture.frame; u[25] = fixture.debug;
  const ep = Float32Array.of(fixture.ratio, fixture.gain, 0, 0, fixture.knee, fixture.roll, 0, 0);
  const pb = buffer(p, GPUBufferUsage.UNIFORM), eb = buffer(ep, GPUBufferUsage.UNIFORM);
  const texture = device.createTexture({ size: [width, height], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
  const group = device.createBindGroup({ layout, entries: [
    { binding: 0, resource: resolved.createView() }, { binding: 1, resource: bloom.createView() }, { binding: 2, resource: sampler },
    { binding: 3, resource: { buffer: eb } }, { binding: 4, resource: { buffer: pb } },
  ] });
  const read = device.createBuffer({ size: row * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder(), pass = enc.beginRenderPass({ colorAttachments: [{ view: texture.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
  pass.setPipeline(pipelines[`${tag}-${format}`]); pass.setBindGroup(0, group); pass.draw(3); pass.end();
  enc.copyTextureToBuffer({ texture }, { buffer: read, bytesPerRow: row }, [width, height]);
  device.queue.submit([enc.finish()]); await read.mapAsync(GPUMapMode.READ);
  const mapped = new Uint8Array(read.getMappedRange());
  const bytes = Buffer.concat(Array.from({ length: height }, (_, y) => Buffer.from(mapped.subarray(y * row, y * row + width * 4))));
  read.unmap(); read.destroy(); texture.destroy(); pb.destroy(); eb.destroy(); return bytes;
}
const styles = [
  { lens: 0, bloom: 0, motion: false, ratio: 1, gain: 0, knee: 1e12, roll: 0, debug: 0 },
  { lens: 0.35, bloom: 0.08, motion: true, ratio: 0.01, gain: 10, knee: 0.5, roll: 1, debug: 2 },
  { lens: 1, bloom: 0.08, motion: true, ratio: 2, gain: 22.8, knee: 4, roll: 0.3, debug: 3 },
];
const results = [];
for (const format of ['rgba8unorm', 'rgba8unorm-srgb']) for (const vn of noiseValues.filter(x => x >= 0 && x <= 1)) for (let i = 0; i < styles.length; i++) {
  const fixture = { vn, frame: frames[i], ...styles[i] };
  const a = await compositeRun('baseline', format, fixture), b = await compositeRun('candidate', format, fixture);
  assert.deepEqual(b, a, `Exact production composite output ${JSON.stringify({ format, fixture })}`);
  assert(new Set(b).size > 3, 'Composite fixtures must produce nontrivial pixels');
  writeFileSync(resolve(output, `baseline-composite-${results.length}.rgba`), a);
  writeFileSync(resolve(output, `candidate-composite-${results.length}.rgba`), b);
  results.push({ format, fixture, exactProductionMatch: true, sha256: hash(b) });
}
assert.deepEqual(errors, []); assert.equal(lost, null);
const validation = await device.popErrorScope(); assert.equal(validation, null);
const report = {
  adapter: Object.fromEntries(['vendor', 'architecture', 'device', 'description', 'isFallbackAdapter'].map(k => [k, adapter.info[k]])),
  function: { sampleCount: samples.length, noiseValues, frames: frameValues, vValues, exactF32Match: true, positiveZeroInactiveSamples: inactiveSamples, activeNonzeroSamples: activeNonzero,
    sha256: hash(plainNext.bytes), countedBaselineHashCalls: countedBase.count, countedCandidateHashCalls: countedNext.count },
  composite: { width, height, count: results.length, results }, errors, validation, lost,
  limitation: 'Small deterministic software-adapter tests establish sampled output equivalence. Counters show conditional WGSL source-work reduction and may inhibit compiler DCE; they do not establish uninstrumented machine-code savings or hardware FPS. This is not full-game/full-resolution visual QA.',
};
writeFileSync(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ phase: 'composite', productionComparisons: results.length, exactMatches: results.length, hashCalls: [countedBase.count, countedNext.count], errors, validation, lost }));
console.log('ALL PASS'); resolved.destroy(); bloom.destroy(); device.destroy();
