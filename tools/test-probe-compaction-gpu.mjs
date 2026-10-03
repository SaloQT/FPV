// Exact production probe-update scheduling proof, using native WebGPU (no browser or screenshot).
// Run deliberately; this is not a performance benchmark and High is never part of the default stage.
// VK_ICD_FILENAMES=/usr/lib/chromium/vk_swiftshader_icd.json \
// WEBGPU_MODULE=../fpv-gpu-lab/node_modules/webgpu/index.js \
// node tools/test-probe-compaction-gpu.mjs ../fpv-round11-baseline OUTPUT_DIR --stage=initial
// --stage=expanded adds odd/tiny/moved/jumped/ray-count cases. --stage=high runs only actual High fresh/steady.
// --case=REGEXP selects fixture names. --counters separately instruments actual primary-loop iterations.
// --list-cases prints the CPU plan without importing WebGPU or compiling/running any GPU code.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2), positional = argv.filter(a => !a.startsWith('--'));
const option = (name, fallback) => argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const stage = option('stage', 'initial'), counted = argv.includes('--counters');
assert(['initial', 'expanded', 'high'].includes(stage), `Unknown stage: ${stage}`);
for (const a of argv.filter(a => a.startsWith('--'))) assert(/^--(stage=|case=|counters$|list-cases$)/.test(a), `Unknown option ${a}`);
const baseline = resolve(positional[0] ?? resolve(root, '../fpv-round11-baseline'));
const output = resolve(positional[1] ?? resolve(root, '../fpv-probe-compaction-proof', stage));
assert(positional.length <= 2, 'Usage: BASELINE_ROOT OUTPUT_DIR [--stage=initial|expanded|high] [--case=REGEXP] [--counters]');
const sha = data => createHash('sha256').update(data).digest('hex');
const N = d => d[0] * d[1] * d[2];
const f32 = Math.fround;
const posmod = (a, m) => ((a % m) + m) % m;
const defaultLo = [-3, -1, -2];
const frame = (name, extra = {}) => ({ name, dim: [4, 4, 4], lo: defaultLo, prevLo: defaultLo, allFresh: false,
  rays: 32, stride: 3, phase: 0, frame: 6, seed: 0x13579bdf, pre: 0.25, spacing: 5, hysteresis: 0.92, steps: 96, ...extra });
function fixtures() {
  const initial = [
    { name: 'fresh-4x4x4-r32', prevPre: 0, frames: [frame('fresh', { allFresh: true, frame: 0 })] },
    { name: 'steady-rotation-stride3', prevPre: 0.25, frames: [0, 1, 2].map(phase => frame(`phase${phase}`, { phase, frame: 6 + phase })) },
    { name: 'one-cell-move', prevPre: 0.25, frames: [frame('move-x', { lo: [-2, -1, -2], phase: 1, frame: 7 })] },
    { name: 'exposure-increase', prevPre: 0.25, frames: [frame('gain4', { pre: 1, phase: 2, frame: 8 })] },
    // Same frame index preserves read/write parity, seed and planned window. The first latch changes prevPre, so the second ratio is 1.
    { name: 'repeated-encode-latch-ratio', prevPre: 0.25, expectRepeatDifference: true,
      frames: [frame('first', { pre: 1, frame: 12 }), frame('again', { pre: 1, frame: 12 })] },
  ];
  if (stage === 'initial') return initial;
  if (stage === 'high') {
    const high = { dim: [32, 16, 32], lo: [-16, -1, -16], prevLo: [-16, -1, -16], rays: 64, spacing: 5,
      stride: 7, phase: 0, frame: 14, steps: 96 };
    // Current production High: 16,384 probes x 64 rays, budget 150,000, ceil(1,048,576 / 150,000) = 7.
    return [
      { name: 'real-high-steady', prevPre: 0.25, frames: [frame('steady', high)] },
      { name: 'real-high-fresh', prevPre: 0, frames: [frame('fresh', { ...high, allFresh: true })] },
    ];
  }
  return initial.concat([
    { name: 'odd-5x3x7-rotation', prevPre: 0.25,
      frames: [0, 1, 2, 3].map(phase => frame(`phase${phase}`, { dim: [5, 3, 7], stride: 4, phase, frame: 20 + phase })) },
    { name: 'tiny-no-active-k-gt-n', prevPre: 0.25,
      frames: [frame('empty', { dim: [1, 1, 1], stride: 8, phase: 7, frame: 7, pre: 1 })] },
    { name: 'tiny-active-k-gt-n', prevPre: 0.25,
      frames: [frame('one', { dim: [1, 1, 1], stride: 8, phase: 0, frame: 8 })] },
    { name: 'negative-move-odd', prevPre: 0.25,
      frames: [frame('move-minus', { dim: [5, 3, 7], lo: [-4, -2, -3], phase: 2, frame: 8 })] },
    { name: 'positive-move-all-axes', prevPre: 0.25,
      frames: [frame('move-plus', { lo: [-2, 0, -1], phase: 1, frame: 7 })] },
    { name: 'jump-at-dimension', prevPre: 0.25,
      frames: [frame('jump', { lo: [1, -1, -2], phase: 2, frame: 8 })] },
    { name: 'jump-beyond-dimension', prevPre: 0.25,
      frames: [frame('jump', { lo: [-12, 9, 15], phase: 1, frame: 7 })] },
    { name: 'stride1', prevPre: 0.25, frames: [frame('all', { stride: 1, frame: 9 })] },
    { name: 'exposure-decrease', prevPre: 1, frames: [frame('gain-quarter', { phase: 1, frame: 7 })] },
    { name: 'prev-pre-zero-steady', prevPre: 0, frames: [frame('fallback-ratio-one', { pre: 1 })] },
    { name: 'repeated-fresh-encode', prevPre: 0.25,
      frames: [frame('first', { allFresh: true, frame: 0 }), frame('again', { allFresh: true, frame: 0 })] },
    ...[32, 48, 64, 96].map(rays => ({ name: `ray-count-${rays}`, prevPre: 0.25,
      frames: [frame('trace', { rays, phase: 2, frame: 8 })] })),
  ]);
}
function oracle(f, prevPre) {
  assert(f.dim.every(v => Number.isInteger(v) && v > 0), 'Positive integer dimensions required');
  assert(f.phase < Math.max(f.stride, 1), 'Phase must be in stride range');
  assert.equal(f.phase, f.frame % Math.max(f.stride, 1), 'Fixture phase must match production frame rotation');
  const active = [], inactive = [], fresh = [], lattice = [];
  const [dx, dy, dz] = f.dim;
  for (let z = 0; z < dz; z++) for (let y = 0; y < dy; y++) for (let x = 0; x < dx; x++) {
    const id = x + dx * (y + dy * z), cell = [x, y, z];
    const point = cell.map((v, i) => f.lo[i] + posmod(v - f.lo[i], f.dim[i]));
    lattice.push(point);
    const isFresh = f.allFresh || point.some((v, i) => v < f.prevLo[i] || v >= f.prevLo[i] + f.dim[i]);
    if (isFresh) fresh.push(id);
    (isFresh || id % Math.max(f.stride, 1) === f.phase ? active : inactive).push(id);
  }
  return { active, inactive, fresh, lattice, ratio: prevPre > 0 ? f32(f32(f.pre) / f32(prevPre)) : 1 };
}
const selected = fixtures().filter(f => new RegExp(option('case', '.*')).test(f.name));
assert(selected.length, 'No matching fixtures');
const plan = selected.map(f => ({ name: f.name, frames: f.frames.map((s, i) => ({ ...s,
  prevPre: i ? f.frames[i - 1].pre : f.prevPre, active: oracle(s, i ? f.frames[i - 1].pre : f.prevPre).active.length,
  probes: N(s.dim), primaryRays: oracle(s, i ? f.frames[i - 1].pre : f.prevPre).active.length * s.rays })) }));
if (argv.includes('--list-cases')) { console.log(JSON.stringify({ stage, counted, plan }, null, 2)); process.exit(0); }

mkdirSync(output, { recursive: true });
const report = { status: 'running', baseline, candidate: root, output, stage, counted, plan, shaderSources: {}, compilation: [], results: [],
  validation: [], uncapturedErrors: [], deviceLost: null,
  limitations: [
    'Synthetic finite signed fp16 histories and a nonuniform sky/LUT fixture; terrain is disabled and both BVH roots are NO_NODE. No hit-shading coverage.',
    'Runs production WGSL with harness-owned resources. It does not execute TypeScript ProbeGrid/encodeRT or prove browser integration, performance, or other adapters.',
    'Every candidate fixture forcibly exercises compact scheduling, including fresh/stride1. Candidate-direct separately verifies the production fallback shader.',
    'Planner checkpoint is diagnostic-only; final compact validation clears args and executes planner plus indirect tracing in the same compute pass, then the production latch.',
    'Optional counters are a separate instrumented run and are not shader instructions, cycle counts, or hardware timings.',
  ] };
const saveReport = () => writeFileSync(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
function artifact(name, bytes) { writeFileSync(resolve(output, name), bytes); return { file: name, bytes: bytes.byteLength, sha256: sha(bytes) }; }
function resolveShader(repo, path, defines = {}) {
  // Mirrors src/render/shaderLib.ts, including include-once and truthy conditional semantics.
  const seen = new Set(), out = [], sources = {};
  function emit(name) {
    if (seen.has(name)) return; seen.add(name);
    const src = readFileSync(resolve(repo, 'src/render/shaders', name), 'utf8'); sources[name] = sha(src);
    const skip = [];
    for (const [n, line] of src.split('\n').entries()) {
      const t = line.trim(); let m;
      if ((m = t.match(/^#ifdef\s+(\w+)/))) { skip.push(!defines[m[1]]); continue; }
      if ((m = t.match(/^#ifndef\s+(\w+)/))) { skip.push(!!defines[m[1]]); continue; }
      if (t.startsWith('#else')) { assert(skip.length, `${name}:${n + 1}: orphan #else`); skip.push(!skip.pop()); continue; }
      if (t.startsWith('#endif')) { assert(skip.length, `${name}:${n + 1}: orphan #endif`); skip.pop(); continue; }
      if (skip.some(Boolean)) continue;
      if ((m = t.match(/^#include\s+"([^"]+)"/))) { emit(m[1]); continue; }
      out.push(line.replace(/\$\{(\w+)\}/g, (_, k) => { assert(k in defines, `${name}:${n + 1}: undefined ${k}`); return String(defines[k]); }));
    }
    assert.equal(skip.length, 0, `${name}: unterminated conditional`);
  }
  emit(path); return { code: out.join('\n'), sources };
}
const scratchF32 = new Float32Array(1), scratchU32 = new Uint32Array(scratchF32.buffer);
function half(value) {
  scratchF32[0] = value;
  const x = scratchU32[0], sign = (x >>> 16) & 0x8000, exp = (x >>> 23) & 0xff, mant = x & 0x7fffff;
  if (exp === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0);
  const e = exp - 127 + 15;
  if (e >= 31) return sign | 0x7c00;
  if (e <= 0) {
    if (e < -10) return sign;
    const m = mant | 0x800000, shift = 14 - e, h = m >>> shift, rem = m & ((1 << shift) - 1), mid = 1 << (shift - 1);
    return sign | (h + (rem > mid || (rem === mid && (h & 1)) ? 1 : 0));
  }
  let h = sign | (e << 10) | (mant >>> 13); const rem = mant & 0x1fff;
  if (rem > 0x1000 || (rem === 0x1000 && (h & 1))) h++; return h;
}
function unhalf(h) {
  const sign = h & 0x8000 ? -1 : 1, e = (h >>> 10) & 31, m = h & 1023;
  return sign * (e === 0 ? m * 2 ** -24 : e === 31 ? (m ? NaN : Infinity) : (1 + m / 1024) * 2 ** (e - 15));
}
function history(dim, channel, bank) {
  const data = Buffer.alloc(N(dim) * 8);
  for (let id = 0; id < N(dim); id++) for (let c = 0; c < 4; c++) {
    const key = (id * 37 + c * 101 + channel * 233 + bank * 557) % 4093;
    const value = (key + 1) * (c === 0 ? 0.25 : (key & 1 ? -0.125 : 0.125));
    data.writeUInt16LE(half(value), id * 8 + c * 2);
  }
  // Finite half extremes exercise the fp16-safe carry clamp when exposure increases.
  if (N(dim) > 8) { data.writeUInt16LE(half(-40000), 6 * 8 + 2); data.writeUInt16LE(half(40000), 7 * 8 + 4); }
  return data;
}
function sentinel(dim, channel) {
  const data = Buffer.alloc(N(dim) * 8);
  for (let id = 0; id < N(dim); id++) for (let c = 0; c < 4; c++) {
    data.writeUInt16LE(half((c & 1 ? -1 : 1) * (56000 + ((id + channel * 7 + c * 11) % 100) * 32)), id * 8 + c * 2);
  }
  return data;
}
function checkFinite(data, label) {
  for (let i = 0; i < data.length; i += 2) assert.notEqual(data.readUInt16LE(i) & 0x7c00, 0x7c00, `${label}: nonfinite f16 at component ${i / 2}`);
}
function exact(actual, expected, label) {
  if (actual.equals(expected)) return;
  let first = 0; while (first < Math.min(actual.length, expected.length) && actual[first] === expected[first]) first++;
  throw new Error(`${label}: exact-byte mismatch at byte ${first}, texel ${Math.floor(first / 8)}, component ${Math.floor(first / 2) % 4}; ` +
    `actual=${actual.subarray(Math.max(0, first - 8), first + 16).toString('hex')}, expected=${expected.subarray(Math.max(0, first - 8), first + 16).toString('hex')}`);
}
function carryExpected(old, ratio) {
  const out = Buffer.alloc(old.length);
  for (let i = 0; i < old.length; i += 2) {
    const clamped = Math.max(-60000, Math.min(60000, unhalf(old.readUInt16LE(i))));
    out.writeUInt16LE(half(Math.max(-60000, Math.min(60000, f32(clamped * ratio)))), i);
  }
  return out;
}
function checkCarry(actual, old, ids, ratio, label) {
  const expected = carryExpected(old, ratio);
  for (const id of ids) exact(actual.subarray(id * 8, id * 8 + 8), expected.subarray(id * 8, id * 8 + 8), `${label} inactive id ${id}`);
}
function frameBytes(f) {
  const a = new Float32Array(192), u = new Uint32Array(a.buffer);
  for (let m = 0; m < 9; m++) for (let d = 0; d < 4; d++) a[m * 16 + d * 5] = 1;
  a.set([0, 20, 0, 1], 144); a.set([16, 16, 1 / 16, 1 / 16], 148);
  a.set([0.6, 0.8, 0, 0.00465], 156); a.set([127000, 124000, 121000, 1], 160);
  a.set([0, 0.6, 0.8, 0.0045], 164); a.set([0.26, 0.3, 0.35, 1], 168);
  a.set([8, 5, 0, 0], 172); a.set([-20, -20, 35, 35], 176); u.set([f.frame, 0, f.seed, 0], 180);
  a.set([1 / 60, f.pre, 0.05, 0], 184); a.set([6360, 6460, 0.02, 1], 188); return a;
}
function paramBytes(f) {
  const a = new ArrayBuffer(144), u = new Uint32Array(a), i = new Int32Array(a), v = new Float32Array(a);
  u.set([8, 8, 16, 16], 0); u.set([2, f.steps, 2, 0], 4); u.set([0xffffffff, 0xffffffff, f.steps * 2, f.frame], 8);
  u.set([0, f.seed, f.stride, f.phase], 12); i.set([...f.lo, f.rays], 16); i.set([...f.prevLo, f.allFresh ? 1 : 0], 20);
  u.set([...f.dim, 0], 24); v.set([1, f.spacing, f.hysteresis, 300], 28); v.set([0, 0, 256, 0], 32); return a;
}
function instrument(code) {
  const entry = /(fn main\([^]*?@builtin\(local_invocation_index\) lid\s*:\s*u32\)\s*\{)/;
  const loop = /(for\s*\(var r = lid; r < total; r \+= GROUP_SIZE\)\s*\{)/;
  assert(entry.test(code), 'Instrumentation requires the production 64-thread main signature');
  assert(loop.test(code), 'Instrumentation requires the actual production primary-ray loop');
  assert(code.includes('probeGain = ratio;'), 'Instrumentation requires trace entry');
  return code.replace(entry, '$1\n if (lid == 0u) { atomicAdd(&proofCounts[0], 1u); }')
    .replace('probeGain = ratio;', 'probeGain = ratio;\n if (lid == 0u) { atomicAdd(&proofCounts[1], 1u); }')
    .replace(loop, '$1\n atomicAdd(&proofCounts[2], 1u);') +
    '\n@group(3) @binding(0) var<storage, read_write> proofCounts : array<atomic<u32>, 3>;\n';
}
let device;
async function main() {
  const defs = [
    ['baseline-direct', baseline, 'rt/probe_update.wgsl', { GRP: 2 }],
    ['candidate-direct', root, 'rt/probe_update.wgsl', { GRP: 2 }],
    ['candidate-compact', root, 'rt/probe_update.wgsl', { GRP: 2, COMPACT: true }],
    ['candidate-plan', root, 'rt/probe_plan.wgsl', { GRP: 1 }],
    ['baseline-latch', baseline, 'rt/latch.wgsl', { GRP: 1 }],
    ['candidate-latch', root, 'rt/latch.wgsl', { GRP: 1 }],
  ];
  const resolved = new Map();
  for (const [name, repo, path, defines] of defs) {
    const { code, sources } = resolveShader(repo, path, defines); resolved.set(name, code);
    report.shaderSources[name] = { repo, path, defines, sources, resolved: artifact(`${name}.wgsl`, Buffer.from(code)) };
  }
  // The scheduling experiment must not quietly change ray generation, radiance, SH summation or blending.
  const rayTail = code => {
    const start = code.indexOf('  var p = vec3f(lattice)'); assert(start >= 0, 'Missing production ray-math start');
    return code.slice(start).replace(/\/\*[^]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/\s+/g, '');
  };
  assert.equal(rayTail(resolved.get('candidate-direct')), rayTail(resolved.get('baseline-direct')), 'Candidate direct changed production ray/reduction/store math');
  assert.equal(rayTail(resolved.get('candidate-compact')), rayTail(resolved.get('baseline-direct')), 'Candidate compact changed production ray/reduction/store math');
  report.rayMathSha256 = sha(rayTail(resolved.get('baseline-direct')));
  assert(/@binding\(12\)[^]*?var<storage,\s*read>/.test(resolved.get('candidate-compact')), 'COMPACT must bind the actual readonly active-ID buffer');
  assert.notEqual(resolved.get('candidate-direct'), resolved.get('candidate-compact'), 'COMPACT define did not change the production shader');
  saveReport();

  const defaultModule = resolve(root, '../fpv-gpu-lab/node_modules/webgpu/index.js');
  const modulePath = process.env.WEBGPU_MODULE ? resolve(process.env.WEBGPU_MODULE) : defaultModule;
  report.runtime = { modulePath, vkIcdFilenames: process.env.VK_ICD_FILENAMES ?? null };
  const { create, globals } = await import(pathToFileURL(modulePath).href); Object.assign(globalThis, globals);
  const gpu = create(['backend=vulkan']), adapter = await gpu.requestAdapter(); assert(adapter, 'A native Vulkan adapter is required');
  device = await adapter.requestDevice();
  report.adapter = Object.fromEntries(['vendor', 'architecture', 'device', 'description', 'isFallbackAdapter'].map(k => [k, adapter.info[k]]));
  report.limits = Object.fromEntries(['maxComputeWorkgroupsPerDimension', 'maxStorageBufferBindingSize', 'maxBufferSize', 'maxTextureDimension3D'].map(k => [k, device.limits[k]]));
  device.addEventListener('uncapturederror', e => { report.uncapturedErrors.push(e.error.message); saveReport(); });
  device.lost.then(info => { if (info.reason !== 'destroyed') { report.deviceLost = { reason: info.reason, message: info.message }; saveReport(); } });
  const C = GPUShaderStage.COMPUTE, B = GPUBufferUsage, T = GPUTextureUsage;
  async function scoped(label, fn) {
    device.pushErrorScope('out-of-memory'); device.pushErrorScope('internal'); device.pushErrorScope('validation');
    let result, thrown;
    try { result = await fn(); } catch (e) { thrown = e; }
    const validation = await device.popErrorScope(), internal = await device.popErrorScope(), oom = await device.popErrorScope();
    const errors = [validation, internal, oom].filter(Boolean).map(e => e.message);
    report.validation.push({ label, errors });
    assert.equal(report.deviceLost, null, `Device lost: ${JSON.stringify(report.deviceLost)}`);
    assert.deepEqual(report.uncapturedErrors, [], 'Uncaptured GPU errors'); assert.deepEqual(errors, [], `${label}: GPU validation/internal/OOM error`);
    if (thrown) throw thrown; return result;
  }
  const uniform = binding => ({ binding, visibility: C, buffer: { type: 'uniform' } });
  const storage = (binding, writable = false) => ({ binding, visibility: C, buffer: { type: writable ? 'storage' : 'read-only-storage' } });
  const sampled = (binding, dimension = '2d', sampleType = 'float') => ({ binding, visibility: C, texture: { sampleType, viewDimension: dimension } });
  const store = binding => ({ binding, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '3d' } });
  const samp = binding => ({ binding, visibility: C, sampler: { type: 'filtering' } });
  const layout = (label, entries) => device.createBindGroupLayout({ label, entries });
  const frameLayout = layout('proof frame', [uniform(0)]);
  const worldLayout = layout('proof world', [samp(0), samp(1), sampled(2, '2d', 'unfilterable-float'), sampled(3, '2d', 'unfilterable-float'),
    ...[4, 5, 6, 7, 8].map(b => sampled(b)), sampled(9, '3d'), sampled(10)]);
  const traceEntries = [uniform(0), storage(1), storage(2), sampled(3, '3d'), sampled(4, '3d'), sampled(5, '3d'),
    store(6), store(7), store(8), storage(9), samp(10), sampled(11)];
  const traceLayout = layout('proof direct trace', traceEntries), compactLayout = layout('proof compact trace', [...traceEntries, storage(12)]);
  const planLayout = layout('proof plan', [uniform(0), sampled(3, '3d'), sampled(4, '3d'), sampled(5, '3d'), store(6), store(7), store(8), storage(9), storage(12, true), storage(13, true)]);
  const latchLayout = layout('proof latch', [uniform(0), storage(1, true)]), counterLayout = layout('proof counters', [storage(0, true)]);
  const pipelines = new Map();
  for (const [name, code] of resolved) {
    const groups = name.endsWith('-plan') ? [frameLayout, planLayout] : name.endsWith('-latch') ? [frameLayout, latchLayout] :
      [frameLayout, worldLayout, name.endsWith('-compact') ? compactLayout : traceLayout];
    const variants = counted && !name.endsWith('-plan') && !name.endsWith('-latch') ? [false, true] : [false];
    for (const withCounters of variants) {
      const label = name + (withCounters ? '-counted' : ''), source = withCounters ? instrument(code) : code;
      if (withCounters) artifact(`${label}.wgsl`, Buffer.from(source));
      console.log(`PHASE compile ${label}`);
      await scoped(`compile ${label}`, async () => {
        const shader = device.createShaderModule({ label, code: source });
        const messages = (await shader.getCompilationInfo()).messages.map(m => ({ type: m.type, message: m.message, lineNum: m.lineNum, linePos: m.linePos, offset: m.offset, length: m.length }));
        report.compilation.push({ label, messages }); saveReport();
        assert.equal(messages.filter(m => m.type === 'error').length, 0, `${label}: ${JSON.stringify(messages)}`);
        pipelines.set(label, await device.createComputePipelineAsync({ label, layout: device.createPipelineLayout({ bindGroupLayouts: withCounters ? [...groups, counterLayout] : groups }),
          compute: { module: shader, entryPoint: 'main' } }));
      });
    }
  }
  const globalResources = [];
  function buffer(label, bytes, usage, track = globalResources) {
    const data = typeof bytes === 'number' ? null : bytes;
    const b = device.createBuffer({ label, size: Math.max(4, data?.byteLength ?? bytes), usage: usage | B.COPY_DST });
    if (data) device.queue.writeBuffer(b, 0, data); track.push(b); return b;
  }
  function texture(label, size, format, data, dimension = '2d', usage = T.TEXTURE_BINDING | T.COPY_DST, track = globalResources) {
    const t = device.createTexture({ label, size, dimension, format, usage }); track.push(t);
    if (data) device.queue.writeTexture({ texture: t }, data, { bytesPerRow: size[0] * (format === 'r32float' ? 4 : 8), rowsPerImage: size[1] }, size);
    return t;
  }
  function texData(w, h, fn) {
    const a = new Uint16Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = fn(x, y); for (let c = 0; c < 4; c++) a[(y * w + x) * 4 + c] = half(v[c]);
    }
    return a;
  }
  const clampSampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
  const repeatSampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat', addressModeW: 'repeat' });
  const height = texture('finite flat height', [8, 8, 1], 'r32float', new Float32Array(64));
  // Terrain is disabled. Still provide valid backing resources because select() evaluates terrainHeightAt() eagerly.
  const maxPyr = texture('finite unused max height', [8, 8, 1], 'r32float', new Float32Array(64));
  const normals = texture('finite normals', [8, 8, 1], 'rgba16float', texData(8, 8, () => [0.5, 1, 0.5, 1]));
  const maps = texture('finite maps', [8, 8, 1], 'rgba16float', texData(8, 8, () => [0.2, 0, 0, 0]));
  const lut = texture('varying transmittance', [256, 64, 1], 'rgba16float', texData(256, 64, (x, y) => [0.1 + 0.8 * x / 255, 0.2 + 0.7 * y / 63, 0.3 + 0.6 * ((x + 3 * y) % 47) / 46, 1]));
  const multi = texture('finite multiscatter', [32, 32, 1], 'rgba16float', texData(32, 32, () => [0.1, 0.2, 0.3, 1]));
  const sky = texture('varying sky', [192, 108, 1], 'rgba16float', texData(192, 108, (x, y) => [4 + x / 3, 2 + y / 2, 3 + ((x * 7 + y * 11) % 137) / 4, 1]));
  const aerial = texture('finite aerial', [1, 1, 1], 'rgba16float', texData(1, 1, () => [0, 0, 0, 1]), '3d');
  const noise = texture('finite blue noise', [128, 128, 1], 'rgba16float', texData(128, 128, (x, y) => [((x * 73 + y * 31) % 251) / 251, ((x * 17 + y * 101) % 251) / 251, 0, 1]));
  const cloud = texture('finite clear cloud', [1, 1, 1], 'rgba16float', texData(1, 1, () => [1, 1, 1, 1]));
  const worldGroup = device.createBindGroup({ layout: worldLayout, entries: [
    { binding: 0, resource: clampSampler }, { binding: 1, resource: repeatSampler },
    ...[height, maxPyr, normals, maps, lut, multi, sky, aerial, noise].map((t, i) => ({ binding: i + 2, resource: t.createView() })),
  ] });
  const nodes = buffer('empty scene nodes backing', 32, B.STORAGE), prims = buffer('empty scene prims backing', 64, B.STORAGE);
  const bind = (binding, b) => ({ binding, resource: { buffer: b } });
  const view = (binding, t) => ({ binding, resource: t.createView({ dimension: '3d' }) });
  function makeEngine(tag, fixture, withCounters = false) {
    const dim = fixture.frames[0].dim, total = N(dim), resources = [], cpu = [0, 1].map(bank => [0, 1, 2].map(c => history(dim, c, bank)));
    assert(total <= device.limits.maxComputeWorkgroupsPerDimension, 'Forced compact trace exceeds one-dimensional indirect workgroup limit');
    assert(dim.every(n => n <= device.limits.maxTextureDimension3D), 'Grid exceeds 3D texture limit');
    assert(total * 4 <= device.limits.maxStorageBufferBindingSize, 'Active-ID buffer exceeds adapter limit');
    const atlases = cpu.map((set, bank) => set.map((data, c) => texture(`${tag} bank${bank} ${'RGB'[c]}`, dim, 'rgba16float', data, '3d', T.STORAGE_BINDING | T.TEXTURE_BINDING | T.COPY_SRC | T.COPY_DST, resources)));
    const f = fixture.frames[0], fb = buffer(`${tag} frame`, frameBytes(f), B.UNIFORM, resources), rp = buffer(`${tag} params`, paramBytes(f), B.UNIFORM, resources);
    const prevPre = buffer(`${tag} previous exposure`, new Float32Array([fixture.prevPre, 0, 0, 0]), B.STORAGE | B.COPY_SRC, resources);
    const ids = buffer(`${tag} active IDs`, total * 4, B.STORAGE | B.COPY_SRC, resources);
    const args = buffer(`${tag} indirect args`, new Uint32Array([0, 1, 1, 0]), B.STORAGE | B.INDIRECT | B.COPY_SRC, resources);
    const counts = buffer(`${tag} actual loop counters`, 12, B.STORAGE | B.COPY_SRC, resources);
    const frameGroup = device.createBindGroup({ layout: frameLayout, entries: [bind(0, fb)] });
    const latchGroup = device.createBindGroup({ layout: latchLayout, entries: [bind(0, rp), bind(1, prevPre)] });
    const countGroup = device.createBindGroup({ layout: counterLayout, entries: [bind(0, counts)] });
    return { tag, dim, total, resources, cpu, atlases, fb, rp, prevPre, ids, args, counts, frameGroup, latchGroup, countGroup,
      withCounters, readBank: 0, writeBank: 1, lastFrame: null, pre: fixture.prevPre, results: [] };
  }
  function groups(e) {
    const io = [...e.atlases[e.readBank].map((t, i) => view(i + 3, t)), ...e.atlases[e.writeBank].map((t, i) => view(i + 6, t))];
    const trace = device.createBindGroup({ layout: e.tag === 'candidate-compact' ? compactLayout : traceLayout,
      entries: [bind(0, e.rp), bind(1, nodes), bind(2, prims), ...io, bind(9, e.prevPre), { binding: 10, resource: repeatSampler }, { binding: 11, resource: cloud.createView() },
        ...(e.tag === 'candidate-compact' ? [bind(12, e.ids)] : [])] });
    const planner = device.createBindGroup({ layout: planLayout, entries: [bind(0, e.rp), ...io, bind(9, e.prevPre), bind(12, e.ids), bind(13, e.args)] });
    return { trace, planner };
  }
  function plannerPass(pass, e, g) {
    pass.setPipeline(pipelines.get('candidate-plan')); pass.setBindGroup(0, e.frameGroup); pass.setBindGroup(1, g.planner);
    pass.dispatchWorkgroups(...e.dim.map(v => Math.ceil(v / 4)));
  }
  function snapshot(enc, e) {
    const rowBytes = e.dim[0] * 8, pitch = Math.ceil(rowBytes / 256) * 256, volumeBytes = pitch * e.dim[1] * e.dim[2];
    const metaOffset = volumeBytes * 6, size = metaOffset + 16 + e.total * 4 + 16 + 12;
    const read = device.createBuffer({ size, usage: B.MAP_READ | B.COPY_DST });
    for (let bank = 0; bank < 2; bank++) for (let c = 0; c < 3; c++) enc.copyTextureToBuffer({ texture: e.atlases[bank][c] },
      { buffer: read, offset: (bank * 3 + c) * volumeBytes, bytesPerRow: pitch, rowsPerImage: e.dim[1] }, e.dim);
    enc.copyBufferToBuffer(e.args, 0, read, metaOffset, 16); enc.copyBufferToBuffer(e.ids, 0, read, metaOffset + 16, e.total * 4);
    enc.copyBufferToBuffer(e.prevPre, 0, read, metaOffset + 16 + e.total * 4, 16);
    enc.copyBufferToBuffer(e.counts, 0, read, metaOffset + 32 + e.total * 4, 12);
    return async () => {
      try {
        await read.mapAsync(GPUMapMode.READ); const raw = Buffer.from(read.getMappedRange());
        const banks = [0, 1].map(bank => [0, 1, 2].map(c => {
          const packed = Buffer.alloc(e.total * 8), base = (bank * 3 + c) * volumeBytes;
          for (let z = 0; z < e.dim[2]; z++) for (let y = 0; y < e.dim[1]; y++) {
            const row = z * e.dim[1] + y; raw.copy(packed, row * rowBytes, base + row * pitch, base + row * pitch + rowBytes);
          }
          return packed;
        }));
        const a = Array.from({ length: 4 }, (_, i) => raw.readUInt32LE(metaOffset + i * 4));
        const ids = Array.from({ length: e.total }, (_, i) => raw.readUInt32LE(metaOffset + 16 + i * 4));
        const pp = raw.readFloatLE(metaOffset + 16 + e.total * 4);
        const counts = Array.from({ length: 3 }, (_, i) => raw.readUInt32LE(metaOffset + 32 + e.total * 4 + i * 4));
        return { banks, args: a, ids, prevPre: pp, counts };
      } finally { if (read.mapState === 'mapped') read.unmap(); read.destroy(); }
    };
  }
  function checkMembership(s, o, e, label) {
    assert.deepEqual(s.args, [o.active.length, 1, 1, 0], `${label}: indirect arguments (x must reset every encode)`);
    const actual = s.ids.slice(0, s.args[0]);
    assert.equal(new Set(actual).size, actual.length, `${label}: duplicate active IDs`);
    assert(actual.every(id => id < e.total), `${label}: out-of-bounds ID`);
    assert.deepEqual([...actual].sort((a, b) => a - b), o.active, `${label}: CPU/GPU active membership mismatch`);
  }
  function saveSnapshot(prefix, s) {
    return { atlases: s.banks.map((set, b) => set.map((data, c) => artifact(`${prefix}-bank${b}-${'RGB'[c]}.rgba16f`, data))),
      ids: artifact(`${prefix}-ids.u32`, Buffer.from(new Uint32Array(s.ids).buffer)),
      args: artifact(`${prefix}-args.u32`, Buffer.from(new Uint32Array(s.args).buffer)), prevPre: s.prevPre, counts: s.counts };
  }
  async function runStep(e, f, prefix) {
    assert.deepEqual(f.dim, e.dim, 'Fixture cannot resize an existing engine');
    const repeat = e.lastFrame === f.frame;
    if (e.lastFrame !== null && !repeat) { [e.readBank, e.writeBank] = [e.writeBank, e.readBank]; }
    const o = oracle(f, e.pre), old = e.cpu[e.readBank], poison = [0, 1, 2].map(c => sentinel(e.dim, c));
    const previousPre = e.pre;
    device.queue.writeBuffer(e.fb, 0, frameBytes(f)); device.queue.writeBuffer(e.rp, 0, paramBytes(f));
    function poisonOutput() {
      for (let c = 0; c < 3; c++) device.queue.writeTexture({ texture: e.atlases[e.writeBank][c] }, poison[c], { bytesPerRow: e.dim[0] * 8, rowsPerImage: e.dim[1] }, e.dim);
    }
    poisonOutput();
    const g = groups(e); let checkpoint = null;
    if (e.tag === 'candidate-compact') {
      checkpoint = await scoped(`${prefix} planner checkpoint`, async () => {
        const enc = device.createCommandEncoder({ label: `${prefix} plan checkpoint` }); enc.clearBuffer(e.args, 0, 4);
        const pass = enc.beginComputePass(); plannerPass(pass, e, g); pass.end(); const read = snapshot(enc, e);
        device.queue.submit([enc.finish()]); return await read();
      });
      const checkpointArtifact = saveSnapshot(`${prefix}-planner`, checkpoint);
      checkMembership(checkpoint, o, e, `${prefix} planner`);
      assert.equal(checkpoint.prevPre, f32(previousPre), 'Planner must not latch prevPre');
      for (let c = 0; c < 3; c++) {
        exact(checkpoint.banks[e.readBank][c], old[c], `${prefix}: planner mutated old ${'RGB'[c]}`);
        checkCarry(checkpoint.banks[e.writeBank][c], old[c], o.inactive, o.ratio, `${prefix}: planner ${'RGB'[c]}`);
        for (const id of o.active) exact(checkpoint.banks[e.writeBank][c].subarray(id * 8, id * 8 + 8), poison[c].subarray(id * 8, id * 8 + 8), `${prefix}: planner touched active id ${id}`);
      }
      checkpoint = checkpointArtifact;
      // Execute the actual final path again from identical poisoned outputs, leaving the checkpoint's nonzero args.x in place.
      // Only command-encoder clearBuffer(x) below can prevent accumulation into that previous append count.
      poisonOutput();
    }
    const result = await scoped(`${prefix} production encode`, async () => {
      const enc = device.createCommandEncoder({ label: `${prefix} production encode` });
      if (e.tag === 'candidate-compact') enc.clearBuffer(e.args, 0, 4);
      if (e.withCounters) enc.clearBuffer(e.counts);
      const pass = enc.beginComputePass({ label: `${prefix} planner + trace + latch` });
      if (e.tag === 'candidate-compact') plannerPass(pass, e, g);
      pass.setPipeline(pipelines.get(e.tag + (e.withCounters ? '-counted' : ''))); pass.setBindGroup(0, e.frameGroup);
      pass.setBindGroup(1, worldGroup); pass.setBindGroup(2, g.trace); if (e.withCounters) pass.setBindGroup(3, e.countGroup);
      if (e.tag === 'candidate-compact') pass.dispatchWorkgroupsIndirect(e.args, 0); else pass.dispatchWorkgroups(...e.dim);
      pass.setPipeline(pipelines.get(e.tag.startsWith('baseline') ? 'baseline-latch' : 'candidate-latch'));
      pass.setBindGroup(1, e.latchGroup); pass.dispatchWorkgroups(1); pass.end();
      const read = snapshot(enc, e); device.queue.submit([enc.finish()]); return await read();
    });
    const files = saveSnapshot(prefix, result);
    if (e.tag === 'candidate-compact') checkMembership(result, o, e, prefix);
    assert.equal(result.prevPre, f32(f.pre), `${prefix}: latch must store this encode's exposure`);
    for (let c = 0; c < 3; c++) {
      exact(result.banks[e.readBank][c], old[c], `${prefix}: trace/latch mutated old ${'RGB'[c]}`);
      checkFinite(result.banks[e.writeBank][c], `${prefix}: ${'RGB'[c]}`);
      checkCarry(result.banks[e.writeBank][c], old[c], o.inactive, o.ratio, `${prefix}: final ${'RGB'[c]}`);
      for (const id of o.active) assert(!result.banks[e.writeBank][c].subarray(id * 8, id * 8 + 8).equals(poison[c].subarray(id * 8, id * 8 + 8)), `${prefix}: traced id ${id} left sentinel ${'RGB'[c]}`);
    }
    if (e.withCounters) assert.deepEqual(result.counts, [e.tag === 'candidate-compact' ? o.active.length : e.total, o.active.length, o.active.length * f.rays], `${prefix}: actual group/trace/primary-loop counts`);
    e.cpu[e.writeBank] = result.banks[e.writeBank].map(b => Buffer.from(b)); e.pre = f32(f.pre); e.lastFrame = f.frame;
    const summary = { tag: e.tag, counted: e.withCounters, frame: f, sameFrameReencode: repeat, readBank: e.readBank, writeBank: e.writeBank,
      prevPreBefore: previousPre, ratio: o.ratio, active: o.active.length, fresh: o.fresh.length, inactive: o.inactive.length,
      expectedPrimaryRays: o.active.length * f.rays, checkpoint, files, exactCarryOracle: true, oldBankUnchanged: true, allFinalComponentsFinite: true };
    e.results.push({ output: result.banks[e.writeBank], summary }); return e.results.at(-1);
  }
  for (const fixture of selected) {
    const engines = ['baseline-direct', 'candidate-direct', 'candidate-compact'].map(tag => makeEngine(tag, fixture));
    const countedEngines = counted ? ['baseline-direct', 'candidate-direct', 'candidate-compact'].map(tag => makeEngine(tag, fixture, true)) : [];
    try {
      for (let i = 0; i < fixture.frames.length; i++) {
        const f = fixture.frames[i], label = `${fixture.name}-${i}-${f.name}`;
        console.log(`PHASE parity ${label}`);
        const results = [];
        for (const e of engines) results.push(await runStep(e, f, `${label}-${e.tag}`));
        for (let e = 1; e < results.length; e++) for (let c = 0; c < 3; c++) exact(results[e].output[c], results[0].output[c], `${label}: ${engines[e].tag} vs uninstrumented baseline ${'RGB'[c]}`);
        const counterResults = [];
        for (const [j, e] of countedEngines.entries()) {
          const result = await runStep(e, f, `${label}-${e.tag}-counted`);
          for (let c = 0; c < 3; c++) exact(result.output[c], results[j].output[c], `${label}: counters altered ${e.tag} ${'RGB'[c]}`);
          counterResults.push(result.summary);
        }
        const entry = { fixture: fixture.name, step: i, exactAllThreeAtlasMatch: true, production: results.map(r => r.summary), counterResults };
        report.results.push(entry); saveReport();
        console.log(JSON.stringify({ phase: 'pass', fixture: fixture.name, step: i, probes: N(f.dim), active: results[2].summary.active, fresh: results[2].summary.fresh,
          ratio: results[2].summary.ratio, expectedPrimaryRays: results[2].summary.expectedPrimaryRays, outputSha256: results[2].output.map(sha) }));
      }
      if (fixture.expectRepeatDifference) {
        for (const e of engines) {
          assert.equal(e.results[0].summary.readBank, e.results[1].summary.readBank, 'Same frame must preserve input-bank ownership');
          assert.equal(e.results[0].summary.writeBank, e.results[1].summary.writeBank, 'Same frame must preserve output-bank ownership');
          assert.equal(e.results[0].summary.ratio, 4); assert.equal(e.results[1].summary.ratio, 1);
          assert(e.results[0].output.some((data, c) => !data.equals(e.results[1].output[c])), 'Latch ratio control must visibly change a same-frame repeated output');
        }
      }
    } finally { for (const e of [...engines, ...countedEngines]) for (const r of e.resources) r.destroy(); }
  }
  await scoped('final queue completion', () => device.queue.onSubmittedWorkDone());
  report.status = 'passed'; report.comparisons = report.results.length; report.instrumentedComparisons = counted ? report.results.length : 0;
  saveReport(); console.log(JSON.stringify({ phase: 'summary', status: report.status, stage, comparisons: report.comparisons, counted, output }));
  console.log('ALL PASS'); for (const r of globalResources) r.destroy(); device.destroy();
}
try { await main(); } catch (error) {
  report.status = 'failed'; report.failure = { name: error.name, message: error.message, stack: error.stack }; saveReport();
  console.error(error.stack ?? String(error)); device?.destroy(); process.exitCode = 1;
}
