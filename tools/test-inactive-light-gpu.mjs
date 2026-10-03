// Bounded actual-Dawn A/B test of full production deferred-lighting entry points.
// VK_ICD_FILENAMES=/path/to/vulkan/icd.json WEBGPU_MODULE=/path/to/webgpu/index.js node tools/test-inactive-light-gpu.mjs BASELINE_ROOT OUTPUT_DIR
// Synthetic finite G-buffer/LUT fixtures; separate instrumented source-work counters, no hardware timing claims.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baseline = resolve(process.argv[2]), output = resolve(process.argv[3]);
mkdirSync(output, { recursive: true });
console.log('PHASE import-webgpu');
const { create, globals } = await import(process.env.WEBGPU_MODULE ? pathToFileURL(process.env.WEBGPU_MODULE).href : 'webgpu');
Object.assign(globalThis, globals);
const gpu = create(['backend=vulkan']);
const adapter = await gpu.requestAdapter();
assert(adapter, 'A Vulkan adapter is required');
const device = await adapter.requestDevice();
console.log('PHASE device-ready');
const errors = []; let lost = null;
device.addEventListener('uncapturederror', e => errors.push(e.error.message));
device.lost.then(info => { if (info.reason !== 'destroyed') lost = info.message; });
device.pushErrorScope('validation');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function shader(repo, fallback) {
  const seen = new Set(), defines = { FALLBACK_SKY: fallback };
  function expand(name) {
    if (seen.has(name)) return ''; seen.add(name);
    const out = [], skip = [];
    for (const line of readFileSync(resolve(repo, 'src/render/shaders', name), 'utf8').split('\n')) {
      const t = line.trim(); let m;
      if ((m = t.match(/^#ifdef\s+(\w+)/))) { skip.push(!defines[m[1]]); continue; }
      if ((m = t.match(/^#ifndef\s+(\w+)/))) { skip.push(!!defines[m[1]]); continue; }
      if (t.startsWith('#else')) { skip.push(!skip.pop()); continue; }
      if (t.startsWith('#endif')) { skip.pop(); continue; }
      if (skip.some(Boolean)) continue;
      out.push((m = t.match(/^#include "([^"]+)"/)) ? expand(m[1]) : line);
    }
    return out.join('\n');
  }
  return expand('lighting/deferred.wgsl');
}
function instrument(code) {
  code += '\n@group(3) @binding(0) var<storage, read_write> counts : array<atomic<u32>, 2>;\n';
  for (const [name, i] of [['sampleTransmittance', 0], ['directLight', 1]]) {
    const re = new RegExp(`(fn ${name}\\([^]*?\\) -> vec3f \\{)`);
    assert(re.test(code), `Missing instrumentation point ${name}`);
    code = code.replace(re, `$1\n atomicAdd(&counts[${i}], 1u);`);
  }
  return code;
}
const C = GPUShaderStage.COMPUTE;
const texEntry = (binding, sampleType = 'float', viewDimension = '2d') => ({ binding, visibility: C, texture: { sampleType, viewDimension } });
const b0 = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: C, buffer: { type: 'uniform' } }] });
const b1 = device.createBindGroupLayout({ entries: [
  ...[0, 1].map(binding => ({ binding, visibility: C, sampler: { type: 'filtering' } })),
  ...[2, 3].map(b => texEntry(b, 'unfilterable-float')), ...[4, 5, 6, 7, 8, 10].map(b => texEntry(b)), texEntry(9, 'float', '3d'),
] });
const b2 = device.createBindGroupLayout({ entries: [
  ...[0, 1, 2, 5, 6].map(b => texEntry(b)), texEntry(3, 'depth'), texEntry(4, 'unfilterable-float'),
  { binding: 7, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float' } },
] });
const b3 = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: C, buffer: { type: 'storage' } }] });
async function moduleFor(code, label) {
  const module = device.createShaderModule({ label, code });
  const messages = (await module.getCompilationInfo()).messages;
  assert.equal(messages.filter(m => m.type === 'error').length, 0, JSON.stringify(messages)); return module;
}
const pipelines = new Map();
async function pipelineFor(tag, counted, fallback) {
  const key = `${tag}-${counted}-${fallback}`;
  if (pipelines.has(key)) return pipelines.get(key);
  let code = shader(tag === 'baseline' ? baseline : root, fallback);
  if (counted) code = instrument(code);
  writeFileSync(resolve(output, `${key}.wgsl`), code);
  console.log(`PHASE compile ${key}`);
  const module = await moduleFor(code, key);
  const pipeline = await device.createComputePipelineAsync({ layout: device.createPipelineLayout({ bindGroupLayouts: counted ? [b0, b1, b2, b3] : [b0, b1, b2] }), compute: { module, entryPoint: 'main' } });
  pipelines.set(key, pipeline); return pipeline;
}
// The half conversion is the same round-to-nearest-even routine as production half.ts.
const bitsF = new Float32Array(1), bitsU = new Uint32Array(bitsF.buffer);
function half(value) {
  bitsF[0] = value; const x = bitsU[0], sign = (x >>> 16) & 0x8000, exp = (x >>> 23) & 0xff, mant = x & 0x7fffff;
  if (exp === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0);
  const e = exp - 127 + 15;
  if (e >= 31) return sign | 0x7c00;
  if (e <= 0) { if (e < -10) return sign; const m = mant | 0x800000, shift = 14 - e, h = m >>> shift, rem = m & ((1 << shift) - 1), mid = 1 << (shift - 1); return sign | (h + (rem > mid || (rem === mid && (h & 1)) ? 1 : 0)); }
  let h = sign | (e << 10) | (mant >>> 13); const rem = mant & 0x1fff;
  if (rem > 0x1000 || (rem === 0x1000 && (h & 1))) h++; return h;
}
const allTextures = [];
function texture(format, w, h, d, fn) {
  const channels = format === 'r32float' ? 1 : format === 'rg8unorm' ? 2 : 4;
  const ArrayType = format === 'rgba16float' ? Uint16Array : format === 'r32float' ? Float32Array : Uint8Array;
  const data = new ArrayType(w * h * d * channels);
  for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const vals = fn(x, y, z);
    for (let c = 0; c < channels; c++) data[((z * h + y) * w + x) * channels + c] = format === 'rgba16float' ? half(vals[c]) : vals[c];
  }
  const t = device.createTexture({ format, dimension: d > 1 ? '3d' : '2d', size: [w, h, d], usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({ texture: t }, data, { bytesPerRow: w * channels * data.BYTES_PER_ELEMENT, rowsPerImage: h }, [w, h, d]);
  allTextures.push(t); return t;
}
const dummy32 = texture('r32float', 1, 1, 1, () => [0]);
const dummy8 = texture('rgba8unorm', 1, 1, 1, () => [128, 255, 128, 255]);
const trans = texture('rgba16float', 32, 8, 1, (x, y) => [0.05 + 0.9 * x / 31, 0.15 + 0.8 * y / 7, 0.25 + 0.6 * ((x + y) % 9) / 8, 1]);
const sky = texture('rgba16float', 24, 12, 1, (x, y) => [0.2 + x / 24, 0.3 + y / 12, 0.4 + (x + y) / 36, 1]);
const aerial = texture('rgba16float', 4, 4, 4, (x, y, z) => [0.03 * x, 0.02 * y, 0.01 * z, 0.75 + 0.05 * z]);
const noise = texture('rg8unorm', 128, 128, 1, (x, y) => [(x * 47 + y * 71) & 255, (x * 13 + y * 11) & 255]);
const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
const g1 = device.createBindGroup({ layout: b1, entries: [
  ...[0, 1].map(binding => ({ binding, resource: sampler })),
  ...[[2, dummy32], [3, dummy32], [4, dummy8], [5, dummy8], [6, trans], [7, sky], [8, sky], [9, aerial], [10, noise]].map(([binding, t]) => ({ binding, resource: t.createView() })),
] });
const width = 17, height = 9, row = 256;
const geometryCount = Array.from({ length: width * height }, (_, i) => i % width % 7 !== 0).filter(Boolean).length;
const depth = device.createTexture({ size: [width, height], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
const depthModule = await moduleFor(`
@vertex fn vs(@builtin(vertex_index) i : u32) -> @builtin(position) vec4f { return vec4f(f32((i << 1u) & 2u) * 2.0 - 1.0, 1.0 - f32(i & 2u) * 2.0, 0.0, 1.0); }
@fragment fn fs(@builtin(position) p : vec4f) -> @builtin(frag_depth) f32 {
 if (u32(p.x) % 7u == 0u) { return 0.0; } return 0.05 + 0.05 * f32((u32(p.x) + u32(p.y)) % 7u);
}`, 'fixture-depth');
const depthPipeline = await device.createRenderPipelineAsync({ layout: 'auto', vertex: { module: depthModule, entryPoint: 'vs' }, fragment: { module: depthModule, entryPoint: 'fs', targets: [] }, depthStencil: { format: 'depth32float', depthCompare: 'always', depthWriteEnabled: true } });
{
  const enc = device.createCommandEncoder(), pass = enc.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: depth.createView(), depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 0 } });
  pass.setPipeline(depthPipeline); pass.draw(3); pass.end(); device.queue.submit([enc.finish()]);
}
function oct(n) {
  const sum = n.reduce((a, x) => a + Math.abs(x), 0), a = n.map(x => x / sum);
  const xy = a[2] < 0 ? [(1 - Math.abs(a[1])) * (a[0] >= 0 ? 1 : -1), (1 - Math.abs(a[0])) * (a[1] >= 0 ? 1 : -1)] : a.slice(0, 2);
  return xy.map(x => x * 0.5 + 0.5);
}
const normals = [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0.1, 0.99, 0.01], [0.6, 0.4, 0.6]];
const alb = texture('rgba8unorm', width, height, 1, (x, y) => [20 + x * 12, 40 + y * 18, 180 - x * 7, 40 + ((x + y) % 6) * 43]);
const nrm = texture('rgba16float', width, height, 1, (x, y) => [...oct(normals[(x + y * 3) % normals.length]), [0.02, 0.06, 0.25, 0.6, 1][x % 5], [0, 0.5, 1][y % 3]]);
const misc = texture('rgba8unorm', width, height, 1, (x, y) => [1 + x % 10, [0, 128, 255][x % 3], [0, 128, 255][y % 3], (x + y) % 9 === 0 ? 20 : 0]);
const rt = new Map();
for (const div of [1, 2, 4]) {
  const w = Math.ceil(width / div), h = Math.ceil(height / div);
  rt.set(div, {
    shadow: texture('r32float', w, h, 1, (x, y) => [((x + y) % 5) / 4]),
    diffuse: texture('rgba16float', w, h, 1, (x, y) => [0.1 + x * 0.01, 0.2 + y * 0.02, 0.3, (x + y) % 3 === 0 ? 0 : 0.6]),
    specular: texture('rgba16float', w, h, 1, (x, y) => [0.4, 0.3 + x * 0.01, 0.2 + y * 0.01, ((x + y) % 5) / 4]),
  });
}
function makeFrame(f) {
  const a = new Float32Array(192), u = new Uint32Array(a.buffer);
  for (let o = 0; o < 144; o += 16) for (let i = 0; i < 4; i++) a[o + i * 5] = 1;
  // Normally use a finite varying test surface; special cases collapse it to a point to get exact V=-L.
  a.set([0, 20, 3, 0], 144); a.set([width, height, 1 / width, 1 / height], 148);
  if (f.opposed) { a.fill(0, 96, 112); a.set([-f.opposed[0], 20 - f.opposed[1], 3 - f.opposed[2], 1], 108); }
  else { a[101] = 2; a[109] = 18; }
  a.set([...(f.sunDir ?? [0.6, 0.8, 0]), 0.00465], 156);
  a.set([...(f.zeroIrradiance ? [0, 0, 0] : [127000, 127000, 127000]), f.sun], 160);
  a.set([...(f.moonDir ?? [0, f.moonY, Math.sqrt(1 - f.moonY ** 2)]), 0.0045], 164);
  a.set([...(f.zeroIrradiance ? [0, 0, 0] : [0.26, 0.3, 0.35]), 1], 168);
  a.set([1, 1, 0, 1], 172); u[180] = 13; u[183] = f.key ?? 0;
  a.set([1 / 60, f.pre ?? (f.sun ? 0.0002 : 5), 0.05, 0], 184); a.set([6360, 6460, 0.02, 1], 188); return a;
}
async function run(tag, counted, f) {
  const pipeline = await pipelineFor(tag, counted, f.fallback);
  const frame = makeFrame(f), fb = device.createBuffer({ size: frame.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(fb, 0, frame);
  const target = device.createTexture({ size: [width, height], format: 'rgba16float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC });
  const counter = device.createBuffer({ size: 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const read = device.createBuffer({ size: row * height + 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const r = rt.get(f.div);
  const g0 = device.createBindGroup({ layout: b0, entries: [{ binding: 0, resource: { buffer: fb } }] });
  const g2 = device.createBindGroup({ layout: b2, entries: [[0, alb], [1, nrm], [2, misc], [3, depth], [4, r.shadow], [5, r.diffuse], [6, r.specular], [7, target]].map(([binding, t]) => ({ binding, resource: t.createView() })) });
  const enc = device.createCommandEncoder(), pass = enc.beginComputePass();
  pass.setPipeline(pipeline); pass.setBindGroup(0, g0); pass.setBindGroup(1, g1); pass.setBindGroup(2, g2);
  if (counted) pass.setBindGroup(3, device.createBindGroup({ layout: b3, entries: [{ binding: 0, resource: { buffer: counter } }] }));
  pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8)); pass.end();
  enc.copyTextureToBuffer({ texture: target }, { buffer: read, bytesPerRow: row }, [width, height]); enc.copyBufferToBuffer(counter, 0, read, row * height, 8);
  device.queue.submit([enc.finish()]);
  const validation = await device.popErrorScope(); assert.equal(validation, null, validation?.message); device.pushErrorScope('validation');
  await read.mapAsync(GPUMapMode.READ);
  const mapped = new Uint8Array(read.getMappedRange()), pixels = Buffer.concat(Array.from({ length: height }, (_, y) => Buffer.from(mapped.subarray(y * row, y * row + width * 8))));
  const counts = Array.from(new Uint32Array(mapped.buffer, row * height, 2));
  read.unmap(); [fb, target, counter, read].forEach(x => x.destroy());
  writeFileSync(resolve(output, `${f.name}-${tag}-${counted ? 'counted' : 'production'}.rgba16`), pixels);
  return { pixels, counts, hash: hash(pixels) };
}
function adjacent(x, offset) { bitsF[0] = x; bitsU[0] += offset; return bitsF[0]; }
const moonThreshold = Math.fround(-0.0145);
const cases = [
  { name: 'both-on', sun: 1, moonY: 0.8 },
  { name: 'sun-only', sun: 1, moonY: -0.8 },
  { name: 'moon-only', sun: 0, moonY: 0.8, key: 1 },
  { name: 'both-off', sun: 0, moonY: -0.8 },
  { name: 'moon-below-threshold', sun: 1, moonY: adjacent(moonThreshold, 1) },
  { name: 'moon-at-threshold', sun: 1, moonY: moonThreshold },
  { name: 'moon-above-threshold', sun: 1, moonY: adjacent(moonThreshold, -1) },
  { name: 'sun-negative-zero', sun: -0, moonY: 0.8, key: 1 },
  { name: 'sun-fraction', sun: 0.5, moonY: 0.8 },
  { name: 'sun-opposed-inactive', sun: 0, moonY: -0.8, sunDir: [0, 0, 1], opposed: [0, 0, -1] },
  { name: 'sun-opposed-active', sun: 1, moonY: -0.8, sunDir: [0, 0, 1], opposed: [0, 0, -1] },
  { name: 'moon-opposed-inactive', sun: 0, moonY: -1, moonDir: [0, -1, 0], opposed: [0, 1, 0] },
  { name: 'moon-opposed-active', sun: 0, moonY: 1, moonDir: [0, 1, 0], opposed: [0, -1, 0] },
  { name: 'sun-near-opposed-inactive', sun: 0, moonY: -0.8, sunDir: [0, 0, 1], opposed: [0.000001, 0, -1] },
  { name: 'sun-only-zero-irradiance', sun: 1, moonY: -0.8, zeroIrradiance: true },
  { name: 'moon-only-zero-irradiance', sun: 0, moonY: 0.8, key: 1, zeroIrradiance: true },
  { name: 'zero-irradiance-active', sun: 1, moonY: 0.8, zeroIrradiance: true },
  { name: 'zero-irradiance-opposed', sun: 1, moonY: 0.8, zeroIrradiance: true, sunDir: [0, 0, 1], opposed: [0, 0, -1] },
];
const results = [];
for (const base of cases) for (const div of [1, 2, 4]) for (const fallback of [false, true]) {
  const f = { ...base, div, fallback, name: `${base.name}-rt${div}-sky${+fallback}` };
  console.log(`PHASE production ${f.name}`);
  const a = await run('baseline', false, f), b = await run('candidate', false, f);
  assert.deepEqual(b.pixels, a.pixels, `${f.name}: exact production rgba16float readback`);
  assert(new Set(b.pixels).size > 12, 'Nontrivial production output required');
  for (let i = 0; i < b.pixels.length; i += 2) assert.notEqual(b.pixels.readUInt16LE(i) & 0x7c00, 0x7c00, 'Every output channel must be finite');
  results.push({ fixture: f, exactProductionMatch: true, sha256: b.hash });
  console.log(JSON.stringify({ phase: 'production', fixture: f.name, exactProductionMatch: true, sha256: b.hash }));
}
const activeControls = [];
for (const light of ['sun', 'moon']) for (const div of [1, 2, 4]) for (const fallback of [false, true]) {
  const suffix = `-rt${div}-sky${+fallback}`;
  const lit = readFileSync(resolve(output, `${light}-only${suffix}-candidate-production.rgba16`));
  const zero = readFileSync(resolve(output, `${light}-only-zero-irradiance${suffix}-candidate-production.rgba16`));
  assert.notDeepEqual(lit, zero, `${light} alone must make a visible difference at unchanged exposure/geometry`);
  activeControls.push({ light, div, fallback, sameExposureActiveContribution: true });
}
console.log(`PRODUCTION PASS ${results.length}`);
const counterResults = [];
for (const base of cases) {
  const f = { ...base, div: 1, fallback: false, name: `${base.name}-rt1-sky0` };
  const a = await run('baseline', true, f), b = await run('candidate', true, f);
  const original = readFileSync(resolve(output, `${f.name}-baseline-production.rgba16`));
  const changed = readFileSync(resolve(output, `${f.name}-candidate-production.rgba16`));
  assert.deepEqual(a.pixels, original, 'Baseline instrumentation preserves output'); assert.deepEqual(b.pixels, changed, 'Candidate instrumentation preserves output');
  const activeLights = Number(f.sun !== 0) + Number(Math.fround(f.moonY) > moonThreshold);
  assert.deepEqual(a.counts, [geometryCount * 2, geometryCount * 2]);
  assert.deepEqual(b.counts, [geometryCount * activeLights, geometryCount * activeLights]);
  counterResults.push({ fixture: f.name, baselineCounts: a.counts, candidateCounts: b.counts });
}
const validation = await device.popErrorScope(); assert.equal(validation, null); assert.deepEqual(errors, []); assert.equal(lost, null);
const report = { width, height, geometryCount, adapter: Object.fromEntries(['vendor', 'architecture', 'device', 'description', 'isFallbackAdapter'].map(k => [k, adapter.info[k]])), productionComparisons: results.length, allProductionChannelsFinite: true, results, activeControls, counterResults, errors, validation, lost,
  limitation: 'Synthetic finite full-production deferred dispatches on a software adapter establish sampled exact output parity, including opposing/grazing normals and degenerate half-vectors. Not universal equivalence for corrupt nonfinite resources, other backends, full-game visual QA or hardware FPS. Counters prove executed instrumented WGSL calls and may inhibit compiler DCE; they are not uninstrumented machine-code counts.' };
writeFileSync(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ phase: 'summary', productionComparisons: results.length, countedComparisons: counterResults.length, errors, validation, lost }));
console.log('ALL PASS'); allTextures.forEach(t => t.destroy()); depth.destroy(); device.destroy();
