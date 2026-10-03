// Bounded actual-Dawn cloud-shadow regression. No GPU timings are claimed.
// WEBGPU_MODULE=/absolute/path/to/webgpu/index.js node tools/test-cloud-shadow-gpu.mjs BASELINE_ROOT OUTPUT_DIR
// Uses complete production shader includes; test-only counters are separate from exact production readbacks.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baseline = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
const { create, globals } = await import(process.env.WEBGPU_MODULE ? pathToFileURL(process.env.WEBGPU_MODULE).href : 'webgpu');
Object.assign(globalThis, globals);
const gpu = create(['backend=vulkan']);
const adapter = await gpu.requestAdapter();
assert(adapter, 'A Vulkan adapter is required');
const device = await adapter.requestDevice();
const errors = [];
device.addEventListener('uncapturederror', e => errors.push(e.error.message));
device.pushErrorScope('validation');
mkdirSync(output, { recursive: true });
const width = 8, height = 8, row = 256;
function shader(repo) {
  const seen = new Set();
  function expand(name) {
    if (seen.has(name)) return '';
    seen.add(name);
    return readFileSync(resolve(repo, 'src/render/shaders', name), 'utf8')
      .replace(/^#include "([^"]+)"/gm, (_, name) => expand(name));
  }
  return expand('sky/cloud_shadow.wgsl').replaceAll('${MARIA_ROWS}', '2');
}
function instrument(code) {
  code += '\n@group(2) @binding(0) var<storage, read_write> counts : array<atomic<u32>, 4>;\n';
  for (const [name, i] of [['columnTransmittance', 0], ['cumulusDensity', 1], ['cirrusDensity', 2]]) {
    const re = new RegExp(`(fn ${name}\\([^]*?\\) -> f32 \\{)`);
    assert(re.test(code), `Missing instrumentation point ${name}`);
    code = code.replace(re, `$1\n atomicAdd(&counts[${i}], 1u);`);
  }
  // Count executed noise texture sample expressions, including their early-out behavior.
  return code.replace(/(\s*)(let [sv] = textureSampleLevel\((?:shapeNoise|detailNoise),)/g,
    '$1atomicAdd(&counts[3], 1u);$1$2');
}
const b0 = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }] });
const b1 = device.createBindGroupLayout({ entries: [
  { binding: 3, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float' } },
  { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
  ...[6, 7].map(binding => ({ binding, visibility: GPUShaderStage.COMPUTE, texture: { viewDimension: '3d' } })),
  { binding: 8, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
] });
const b2 = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }] });
const pipelines = {};
for (const [tag, repo] of [['baseline', baseline], ['candidate', root]]) {
  for (const counted of [false, true]) {
    const code = counted ? instrument(shader(repo)) : shader(repo);
    writeFileSync(resolve(output, `${tag}-${counted ? 'counted' : 'production'}.wgsl`), code);
    const module = device.createShaderModule({ code });
    const messages = (await module.getCompilationInfo()).messages;
    assert.equal(messages.filter(m => m.type === 'error').length, 0, JSON.stringify(messages));
    pipelines[`${tag}-${counted}`] = await device.createComputePipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: counted ? [b0, b1, b2] : [b0, b1] }),
      compute: { module, entryPoint: 'main' },
    });
  }
}
const noise = device.createTexture({ size: [4, 4, 4], dimension: '3d', format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
const noiseBytes = Uint8Array.from({ length: 256 }, (_, i) => [240, 180, 210, 190][i % 4] - Math.floor(i / 4) % 17);
device.queue.writeTexture({ texture: noise }, noiseBytes, { bytesPerRow: 16, rowsPerImage: 4 }, [4, 4, 4]);
const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat', addressModeW: 'repeat' });
async function run(tag, counted, fixture) {
  const frame = new Float32Array(192);
  frame.set([0, 20, 0, 0], 144); // 9 matrices, then camPos
  frame.set([0.6, 0.8, 0, 0], 156);
  frame.set([0, fixture.moonY, Math.sqrt(1 - fixture.moonY ** 2), 0], 164);
  frame.set([6360, 6460, 0.02, 1], 188);
  const atmos = new Float32Array(52);
  atmos[0] = fixture.flag;
  atmos[6] = fixture.clouds ?? 1;
  atmos.set([1, 1, 1, 17], 8);
  atmos.set([1, 2.5, 6, 7], 12);
  atmos.set([32, 3, 0, 0], 20);
  atmos.set([0.9, 0, 5, 8000], 24);
  const uniform = data => {
    const buffer = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(buffer, 0, data); return buffer;
  };
  const fb = uniform(frame), ab = uniform(atmos);
  const texture = device.createTexture({ size: [width, height], format: 'rgba16float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC });
  const counter = device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const read = device.createBuffer({ size: row * height + 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const g0 = device.createBindGroup({ layout: b0, entries: [{ binding: 0, resource: { buffer: fb } }] });
  const g1 = device.createBindGroup({ layout: b1, entries: [
    { binding: 3, resource: texture.createView() }, { binding: 5, resource: { buffer: ab } },
    { binding: 6, resource: noise.createView() }, { binding: 7, resource: noise.createView() }, { binding: 8, resource: sampler },
  ] });
  const enc = device.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipelines[`${tag}-${counted}`]); pass.setBindGroup(0, g0); pass.setBindGroup(1, g1);
  if (counted) pass.setBindGroup(2, device.createBindGroup({ layout: b2, entries: [{ binding: 0, resource: { buffer: counter } }] }));
  pass.dispatchWorkgroups(1, 1); pass.end();
  enc.copyTextureToBuffer({ texture }, { buffer: read, bytesPerRow: row }, [width, height]);
  enc.copyBufferToBuffer(counter, 0, read, row * height, 16);
  device.queue.submit([enc.finish()]);
  const validation = await device.popErrorScope();
  assert.equal(validation, null, validation?.message);
  device.pushErrorScope('validation');
  await read.mapAsync(GPUMapMode.READ);
  const mapped = new Uint8Array(read.getMappedRange());
  const pixels = new Uint8Array(width * height * 8);
  for (let y = 0; y < height; y++) pixels.set(mapped.subarray(y * row, y * row + width * 8), y * width * 8);
  const counts = Array.from(new Uint32Array(mapped.buffer, row * height, 4));
  read.unmap(); [fb, ab, texture, counter, read].forEach(r => r.destroy());
  writeFileSync(resolve(output, `${fixture.name}-${tag}-${counted ? 'counted' : 'production'}.rgba16`), pixels);
  return { pixels, counts, hash: createHash('sha256').update(pixels).digest('hex') };
}
const results = [];
for (const fixture of [
  { name: 'disabled-positive-moon', flag: 0, moonY: 0.8 },
  { name: 'threshold-disabled-positive-moon', flag: 0.5, moonY: 0.8 },
  { name: 'enabled-positive-moon', flag: 1, moonY: 0.8 },
  { name: 'enabled-below-horizon', flag: 1, moonY: -0.8 },
  { name: 'clouds-disabled', flag: 0, moonY: 0.8, clouds: 0 },
]) {
  const original = await run('baseline', false, fixture), changed = await run('candidate', false, fixture);
  assert.deepEqual(changed.pixels, original.pixels, `${fixture.name}: exact production readback`);
  const a = await run('baseline', true, fixture), b = await run('candidate', true, fixture);
  assert.deepEqual(a.pixels, original.pixels, `${fixture.name}: baseline instrumentation leaves output unchanged`);
  assert.deepEqual(b.pixels, changed.pixels, `${fixture.name}: candidate instrumentation leaves output unchanged`);
  if (fixture.flag <= 0.5 && fixture.clouds !== 0) {
    assert.equal(a.counts[0] - b.counts[0], 64);
    assert.equal(a.counts[1] - b.counts[1], 64 * 16);
    assert.equal(a.counts[2] - b.counts[2], 64 * 8);
    assert(a.counts[3] > b.counts[3], 'Disabled moon must skip actual noise samples');
    for (let i = 1; i < 256; i += 4) assert.equal(new Uint16Array(changed.pixels.buffer)[i], 0x3c00, 'Disabled moon is exactly 1');
  } else assert.deepEqual(a.counts, b.counts, 'Enabled/cloud-disabled operation counts unchanged');
  const result = { fixture, exactProductionMatch: true, sha256: changed.hash, baselineCounts: a.counts, candidateCounts: b.counts };
  results.push(result); console.log(JSON.stringify(result));
}
assert.deepEqual(errors, []);
assert.equal(await device.popErrorScope(), null);
const report = { adapter: Object.fromEntries(['vendor', 'architecture', 'device', 'description', 'isFallbackAdapter'].map(k => [k, adapter.info[k]])), width, height,
  counterLabels: ['column calls', 'cumulus density calls', 'cirrus density calls', 'noise texture samples'], results,
  limitation: 'Instrumented counters establish WGSL execution savings, not uninstrumented machine-code counts or hardware frame-rate gains; backend compilers may already optimize pure select operands.' };
writeFileSync(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
console.log('ALL PASS'); device.destroy();
