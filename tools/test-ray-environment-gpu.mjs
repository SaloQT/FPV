// Exact f32 Env diagnostic using complete resolved production RT scene source, plus separate source-call counters.
// VK_ICD_FILENAMES=/path/to/icd.json WEBGPU_MODULE=/path/to/webgpu/index.js node tools/test-ray-environment-gpu.mjs BASELINE_ROOT OUTPUT_DIR
// Synthetic finite supported resources; not a replacement GI/spec/probe entry point or a hardware timing test.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baseline = resolve(process.argv[2]), output = resolve(process.argv[3]);
mkdirSync(output, { recursive: true });
const { create, globals } = await import(process.env.WEBGPU_MODULE ? pathToFileURL(process.env.WEBGPU_MODULE).href : 'webgpu');
Object.assign(globalThis, globals);
const gpu = create(['backend=vulkan']), adapter = await gpu.requestAdapter();
assert(adapter, 'A Vulkan adapter is required');
const device = await adapter.requestDevice(), errors = []; let lost = null;
device.addEventListener('uncapturederror', e => errors.push(e.error.message));
device.lost.then(info => { if (info.reason !== 'destroyed') lost = info.message; });
device.pushErrorScope('validation');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function shader(repo) {
  const seen = new Set(), defines = { GRP: 2 };
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
      out.push((m = t.match(/^#include "([^"]+)"/)) ? expand(m[1]) : line.replaceAll('${GRP}', '2'));
    }
    return out.join('\n');
  }
  return expand('rt/rt_scene.wgsl');
}

const diagnostic = `
@group(3) @binding(0) var<storage, read> heights : array<f32>;
@group(3) @binding(1) var<storage, read_write> values : array<u32>;
@compute @workgroup_size(8)
fn diagnosticMain(@builtin(global_invocation_id) gid : vec3u) {
  if (gid.x >= arrayLength(&heights)) { return; }
  let e = envAt(heights[gid.x]);
  let fields = array<vec3f, 4>(e.sunE, e.moonE, e.zenith, e.ground);
  for (var field = 0u; field < 4u; field++) {
    for (var channel = 0u; channel < 3u; channel++) {
      values[gid.x * 12u + field * 3u + channel] = bitcast<u32>(fields[field][channel]);
    }
  }
}`;
function instrument(code) {
  code += '\n@group(3) @binding(2) var<storage, read_write> counts : array<atomic<u32>, 3>;\n';
  for (const [name, type, i] of [['envAt', 'Env', 0], ['sampleTransmittance', 'vec3f', 1], ['skyNits', 'vec3f', 2]]) {
    const re = new RegExp(`(fn ${name}\\([^]*?\\) -> ${type} \\{)`);
    assert(re.test(code), `Missing instrumentation point ${name}`);
    code = code.replace(re, `$1\n atomicAdd(&counts[${i}], 1u);`);
  }
  return code;
}
const pipelines = new Map();
for (const [tag, repo] of [['baseline', baseline], ['candidate', root]]) for (const counted of [false, true]) {
  let code = shader(repo) + diagnostic;
  if (counted) code = instrument(code);
  const name = `${tag}-${counted ? 'counted' : 'diagnostic'}`;
  writeFileSync(resolve(output, `${name}.wgsl`), code);
  console.log(`PHASE compile ${name}`);
  const module = device.createShaderModule({ label: name, code });
  const messages = (await module.getCompilationInfo()).messages;
  assert.equal(messages.filter(m => m.type === 'error').length, 0, JSON.stringify(messages));
  pipelines.set(name, await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'diagnosticMain' } }));
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

const textures = [];
function texture(w, h, fn) {
  const data = new Uint16Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = fn(x, y);
    for (let c = 0; c < 4; c++) data[(y * w + x) * 4 + c] = half(v[c]);
  }
  const t = device.createTexture({ size: [w, h], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({ texture: t }, data, { bytesPerRow: w * 8 }, [w, h]);
  textures.push(t); return t;
}
const lut = new Map([
  ['varying', texture(256, 64, (x, y) => [x < 32 ? 0 : 0.03 + 0.95 * x / 255, y < 8 ? 0 : 0.01 + 0.98 * y / 63, ((x + y) % 17) / 16, 1])],
  ['zero', texture(256, 64, () => [0, 0, 0, 1])],
  ['one', texture(256, 64, () => [1, 1, 1, 1])],
]);
const sky = texture(192, 108, (x, y) => [0.2 + x / 192, 0.3 + y / 108, 0.4 + (x + y) / 300, 1]);
const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
const heights = new Float32Array([-100, -20, -0, 0.75, 1, 10, 20, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 50000, 100000]);
function buffer(data, usage) {
  const b = device.createBuffer({ size: data.byteLength, usage: usage | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(b, 0, data); return b;
}
const heightBuffer = buffer(heights, GPUBufferUsage.STORAGE);
const moonThreshold = Math.fround(-0.0145);
function adjacent(x, offset) { bitsF[0] = x; bitsU[0] += offset; return bitsF[0]; }
const cases = [
  { name: 'both-on', sun: 1, moonY: 0.8 },
  { name: 'sun-only', sun: 1, moonY: -0.8 },
  { name: 'moon-only', sun: 0, moonY: 0.8 },
  { name: 'both-off', sun: 0, moonY: -0.8 },
  { name: 'moon-below', sun: 1, moonY: adjacent(moonThreshold, 1) },
  { name: 'moon-equal', sun: 1, moonY: moonThreshold },
  { name: 'moon-above', sun: 1, moonY: adjacent(moonThreshold, -1) },
  { name: 'sun-negative-zero', sun: -0, moonY: 0.8 },
  { name: 'sun-fraction', sun: 0.5, moonY: 0.8 },
  { name: 'sun-negative-fraction', sun: -0.5, moonY: 0.8 },
  { name: 'zero-irradiance-active', sun: 1, moonY: 0.8, zeroIrradiance: true },
  { name: 'negative-zero-rgb-inactive', sun: 0, moonY: -0.8, signedRgb: true },
  { name: 'negative-zero-rgb-active', sun: 1, moonY: 0.8, signedRgb: true },
  { name: 'sun-only-zero-irradiance', sun: 1, moonY: -0.8, zeroIrradiance: true },
  { name: 'moon-only-zero-irradiance', sun: 0, moonY: 0.8, zeroIrradiance: true },
  { name: 'sun-below-horizon-enabled', sun: 1, sunY: -0.8, moonY: 0.8 },
];
function makeFrame(f) {
  const frame = new Float32Array(192);
  frame.set([0, 20, 0, 0], 144);
  const sunY = f.sunY ?? 0.8;
  frame.set([Math.sqrt(1 - sunY ** 2), sunY, 0, 0.00465], 156);
  frame.set([...(f.zeroIrradiance ? [0, 0, 0] : f.signedRgb ? [-0, 127000, -0] : [127000, 124000, 121000]), f.sun], 160);
  frame.set([0, f.moonY, Math.sqrt(1 - f.moonY ** 2), 0.0045], 164);
  frame.set([...(f.zeroIrradiance ? [0, 0, 0] : f.signedRgb ? [-0, 0.3, -0] : [0.26, 0.3, 0.35]), 1], 168);
  frame.set([1 / 60, 1, 0.05, 0], 184); frame.set([6360, 6460, 0.02, 1], 188);
  return frame;
}
async function run(tag, counted, f, lutName) {
  const pipeline = pipelines.get(`${tag}-${counted ? 'counted' : 'diagnostic'}`);
  const fb = buffer(makeFrame(f), GPUBufferUsage.UNIFORM), bytes = heights.length * 12 * 4;
  const target = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const counts = device.createBuffer({ size: 12, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const read = device.createBuffer({ size: bytes + 12, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const groups = [
    device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: fb } }] }),
    device.createBindGroup({ layout: pipeline.getBindGroupLayout(1), entries: [{ binding: 0, resource: sampler }, { binding: 6, resource: lut.get(lutName).createView() }, { binding: 8, resource: sky.createView() }] }),
    device.createBindGroup({ layout: pipeline.getBindGroupLayout(2), entries: [] }),
    device.createBindGroup({ layout: pipeline.getBindGroupLayout(3), entries: [{ binding: 0, resource: { buffer: heightBuffer } }, { binding: 1, resource: { buffer: target } }, ...(counted ? [{ binding: 2, resource: { buffer: counts } }] : [])] }),
  ];
  const enc = device.createCommandEncoder(), pass = enc.beginComputePass();
  pass.setPipeline(pipeline); groups.forEach((g, i) => pass.setBindGroup(i, g));
  pass.dispatchWorkgroups(Math.ceil(heights.length / 8)); pass.end();
  enc.copyBufferToBuffer(target, 0, read, 0, bytes); enc.copyBufferToBuffer(counts, 0, read, bytes, 12);
  device.queue.submit([enc.finish()]);
  const validation = await device.popErrorScope(); assert.equal(validation, null, validation?.message); device.pushErrorScope('validation');
  await read.mapAsync(GPUMapMode.READ);
  const mapped = read.getMappedRange();
  const values = Buffer.from(new Uint8Array(mapped).slice(0, bytes));
  const callCounts = Array.from(new Uint32Array(mapped, bytes, 3));
  read.unmap(); [fb, target, counts, read].forEach(x => x.destroy());
  writeFileSync(resolve(output, `${f.name}-${lutName}-${tag}-${counted ? 'counted' : 'diagnostic'}.u32`), values);
  return { values, counts: callCounts, sha256: hash(values) };
}
const results = [], counterResults = [], activeControls = [];
for (const f of cases) for (const lutName of lut.keys()) {
  console.log(`PHASE diagnostic ${f.name} ${lutName}`);
  const a = await run('baseline', false, f, lutName), b = await run('candidate', false, f, lutName);
  assert.deepEqual(b.values, a.values, `${f.name}/${lutName}: all twelve f32 Env components, bitwise`);
  for (let i = 0; i < b.values.length; i += 4) assert.notEqual(b.values.readUInt32LE(i) & 0x7f800000, 0x7f800000, 'Every Env component must be finite');
  const signedZeros = Array.from({ length: b.values.length / 4 }, (_, i) => b.values.readUInt32LE(i * 4)).filter(x => x === 0x80000000).length;
  if (f.name === 'sun-negative-zero' || f.name === 'negative-zero-rgb-inactive') assert(signedZeros > 0, 'Signed-zero cases must expose raw negative zero');
  results.push({ fixture: { ...f, sunNegativeZero: Object.is(f.sun, -0), lut: lutName }, exactF32Match: true, signedZeros, sha256: b.sha256 });
}
console.log(`F32 DIAGNOSTIC PASS ${results.length}`);
for (const f of cases) {
  const a = await run('baseline', true, f, 'varying'), b = await run('candidate', true, f, 'varying');
  for (const [tag, r] of [['baseline', a], ['candidate', b]]) assert.deepEqual(r.values, readFileSync(resolve(output, `${f.name}-varying-${tag}-diagnostic.u32`)), 'Instrumentation must preserve every f32 bit');
  const n = heights.length, active = Number(f.sun !== 0) + Number(Math.fround(f.moonY) > moonThreshold);
  assert.deepEqual(a.counts, [n, n * 2, n]); assert.deepEqual(b.counts, [n, n * active, n]);
  counterResults.push({ fixture: f.name, baselineCounts: a.counts, candidateCounts: b.counts });
}
for (const light of ['sun', 'moon']) {
  const lit = readFileSync(resolve(output, `${light}-only-varying-candidate-diagnostic.u32`));
  const zero = readFileSync(resolve(output, `${light}-only-zero-irradiance-varying-candidate-diagnostic.u32`));
  for (const [field, offset] of [[light + 'E', light === 'sun' ? 0 : 3], ['ground', 9]]) {
    assert(lit.some((v, i) => Math.floor(i / 4) % 12 >= offset && Math.floor(i / 4) % 12 < offset + 3 && v !== zero[i]), `${light} must affect ${field}`);
    activeControls.push({ light, field, contributionChanges: true });
  }
}
const validation = await device.popErrorScope(); assert.equal(validation, null); assert.deepEqual(errors, []); assert.equal(lost, null);
const report = { baseline, sourceSha256: hash(readFileSync(resolve(root, 'src/render/shaders/rt/rt_scene.wgsl'))), heights: Array.from(heights), componentsPerEnv: 12,
  adapter: Object.fromEntries(['vendor', 'architecture', 'device', 'description', 'isFallbackAdapter'].map(k => [k, adapter.info[k]])),
  diagnosticComparisons: results.length, envComparisons: results.length * heights.length, allComponentsFinite: true, results, counterResults, activeControls, errors, validation, lost,
  limitation: 'Complete production rt_scene source with an added diagnostic entry point; not full GI/spec/probe output parity. Synthetic finite nonnegative LUTs on a software adapter. Signed-zero bits checked. Separate instrumented helper-call counters can inhibit DCE and are not machine-code counts or hardware timing. Corrupt/nonfinite resources and other adapters are not covered.' };
writeFileSync(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ phase: 'summary', diagnosticComparisons: results.length, envComparisons: report.envComparisons, countedComparisons: counterResults.length, errors, validation, lost }));
console.log('ALL PASS'); heightBuffer.destroy(); textures.forEach(t => t.destroy()); device.destroy();
