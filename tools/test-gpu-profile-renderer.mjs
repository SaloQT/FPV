// Optional profiler integration proof. Compare normal/profile outputs and command order at identical quality.
// VK_ICD_FILENAMES=/usr/lib/chromium/vk_swiftshader_icd.json WEBGPU_MODULE=/path/to/webgpu/index.js \
//   node tools/test-probe-renderer-gpu.mjs BUNDLE_MJS REPO_ROOT OUTPUT_DIR baseline|normal|profile
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [bundle, repo, outputArg, tag] = process.argv.slice(2);
const output = resolve(outputArg); mkdirSync(output, { recursive: true });
const { create, globals } = await import(process.env.WEBGPU_MODULE ? pathToFileURL(process.env.WEBGPU_MODULE).href : 'webgpu');
Object.assign(globalThis, globals);
Object.defineProperty(globalThis, 'navigator', { value: { gpu: create(['backend=vulkan']) }, configurable: true });
globalThis.fetch = async url => {
  assert(String(url).endsWith('data/stars.bin'));
  const b = readFileSync(resolve(repo, 'public/data/stars.bin'));
  return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
};
const { Renderer, DEFAULT_SETTINGS, generateTerrain, createTerrainSampler, computeAstro, quatLookAlong, resolveQuality, createDefaultModules } = await import(pathToFileURL(resolve(bundle)).href);
const width = 64, height = 36, commands = [], records = [];
let target, device, format, operation;
function instrument(d) {
  const original = d.createCommandEncoder;
  d.createCommandEncoder = function (...args) {
    const enc = original.apply(this, args), clear = enc.clearBuffer, begin = enc.beginComputePass;
    enc.clearBuffer = function (buffer, ...rest) {
      if (buffer.label === 'rt active probe dispatch') commands.push({ operation, kind: 'clear', args: rest });
      return clear.call(this, buffer, ...rest);
    };
    enc.beginComputePass = function (...args) {
      const pass = begin.apply(this, args);
      commands.push({ operation, kind: 'computePass', label: args[0]?.label ?? null, timestamp: !!args[0]?.timestampWrites });
      let pipeline;
      for (const method of ['setPipeline', 'dispatchWorkgroups', 'dispatchWorkgroupsIndirect']) {
        const original = pass[method];
        pass[method] = function (...args) {
          if (method === 'setPipeline') pipeline = args[0].label;
          else commands.push({ operation, kind: method, pipeline, args: args.map(a => typeof a === 'number' ? a : a.label) });
          return original.apply(this, args);
        };
      }
      return pass;
    };
    return enc;
  };
}
const context = {
  configure(c) { device = c.device; format = c.format; instrument(device); target = device.createTexture({ size: [width, height], format, usage: c.usage }); },
  getCurrentTexture: () => target, unconfigure() { target.destroy(); },
};
const canvas = { width, height, getContext(type) { assert.equal(type, 'webgpu'); return context; } };
const settings = { ...DEFAULT_SETTINGS, dynamicResolution: false, timeMs: Date.UTC(2026, 5, 21, 12) };
const modules = createDefaultModules(), renderer = await Renderer.create(canvas, settings, modules, undefined, { gpuProfile: tag === 'profile' });
const timings = []; const unlisten = renderer.listenGpuTimings?.(sample => timings.push(sample));
device.pushErrorScope('validation');
const rt = modules.find(m => m.name === 'rt'); assert(rt);
assert.deepEqual(resolveQuality(settings).probes, { dim: [32, 16, 32], raysPerProbe: 64, spacing: 5 });
const terrain = generateTerrain({ seed: 1337, quality: 'high', resolution: 128, cellSize: 8, relief: 100 });
const sampler = createTerrainSampler(terrain);
renderer.setScene({ terrain, sampler, track: null });
const camera = { pos: [0, sampler.heightAt(0, 0) + 15, 0], quat: quatLookAlong(0, -0.25, -1, [0, 0, 0, 1]), fovY: 100 * Math.PI / 180, aspect: width / height, near: 0.05, far: 20000 };
const astro = computeAstro(settings.timeMs, settings.observer);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function read(texture, w, h, depth, bytesPerPixel) {
  const bytesPerRow = Math.ceil(w * bytesPerPixel / 256) * 256;
  const b = device.createBuffer({ size: bytesPerRow * h * depth, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyTextureToBuffer({ texture }, { buffer: b, bytesPerRow, rowsPerImage: h }, [w, h, depth]);
  device.queue.submit([enc.finish()]); await b.mapAsync(GPUMapMode.READ);
  const src = new Uint8Array(b.getMappedRange()), out = new Uint8Array(w * h * depth * bytesPerPixel);
  for (let z = 0; z < depth; z++) for (let y = 0; y < h; y++) out.set(src.subarray((z * h + y) * bytesPerRow, (z * h + y) * bytesPerRow + w * bytesPerPixel), (z * h + y) * w * bytesPerPixel);
  b.unmap(); b.destroy(); return out;
}
async function snapshot(name, captured) {
  await device.queue.onSubmittedWorkDone();
  let rgba = captured?.rgba ?? await read(target, width, height, 1, 4);
  if (!captured && format.startsWith('bgra')) for (let i = 0; i < rgba.length; i += 4) [rgba[i], rgba[i + 2]] = [rgba[i + 2], rgba[i]];
  assert(new Set(rgba).size > 10, 'Rendered image must be nontrivial');
  writeFileSync(resolve(output, `${tag}-${name}.rgba`), rgba);
  const set = rt.probes.sets[rt.parity ^ 1], atlas = [];
  for (const channel of ['r', 'g', 'b']) {
    const bytes = await read(set[channel].texture, 32, 16, 32, 8);
    writeFileSync(resolve(output, `${tag}-${name}-${channel}.rgba16`), bytes); atlas.push(hash(bytes));
  }
  const record = { name, image: hash(rgba), atlas, frameIndex: renderer.frameIndex, rt: rt.stats() };
  records.push(record); console.log('FRAME', JSON.stringify(record));
}
operation = 'fresh'; renderer.render({ dt: 1 / 60, time: 0, camera, astro, quad: null }); await snapshot(operation);
operation = 'steady'; renderer.render({ dt: 1 / 60, time: 1 / 60, camera, astro, quad: null }); await snapshot(operation);
operation = 'capture-a'; await snapshot(operation, await renderer.capture());
operation = 'capture-b'; await snapshot(operation, await renderer.capture());
camera.pos = [5, camera.pos[1], 0];
operation = 'moved'; renderer.render({ dt: 1 / 60, time: 2 / 60, camera, astro, quad: null }); await snapshot(operation);
const validation = await device.popErrorScope();
assert.equal(validation, null); assert.equal(renderer.errors.length, 0); assert.equal(renderer.lost, null);
await renderer.drainGpuTimings?.();
const result = { tag, timings, gpuProfiling: renderer.gpuProfiling ?? null, adapter: renderer.adapter, quality: resolveQuality(settings), width, height, records, commands, errors: renderer.errors, lost: renderer.lost, validation: validation?.message ?? null };
writeFileSync(resolve(output, `${tag}-result.json`), JSON.stringify(result, null, 2));
unlisten?.(); renderer.destroy();
if (tag !== 'baseline') {
  const baseline = JSON.parse(readFileSync(resolve(output, 'baseline-result.json'), 'utf8'));
  assert.deepEqual(result.records.map(r => ({ name: r.name, image: r.image, atlas: r.atlas, frameIndex: r.frameIndex })), baseline.records.map(r => ({ name: r.name, image: r.image, atlas: r.atlas, frameIndex: r.frameIndex })));
  if (tag === 'normal') assert.deepEqual(JSON.parse(JSON.stringify(result.commands)), baseline.commands, 'Default compute command trace is unchanged');
  else {
    const work = commands => JSON.parse(JSON.stringify(commands)).filter(c => c.kind !== 'computePass');
    assert.deepEqual(work(result.commands), work(baseline.commands), 'Profiling preserves compute dispatch order and dimensions');
  }
  writeFileSync(resolve(output, `${tag}-comparison.json`), JSON.stringify({ passed: true, operations: records.length, imagesExact: true, probeAtlasesExact: true, timingClaim: false }, null, 2));
}
console.log('PASS', JSON.stringify({ tag, operations: records.length }));

if (tag !== 'baseline') {
  assert.equal(timings.filter(s => s.status === 'measured').length, 3, 'Only three presented frames, excluding two captures');
  assert.deepEqual(timings.filter(s => s.status === 'measured').map(s => s.frameIndex).sort((a,b)=>a-b), [0,1,2]);
  assert.equal(new Set(timings.map(s => s.sequence)).size, timings.length, 'Unique sample sequence');
}

if (tag !== 'baseline') {
  const measured = timings.filter(s => s.status === 'measured');
  for (const s of measured) {
    assert(Number.isFinite(s.gpuMs) && s.gpuMs >= 0);
    assert.equal(s.passMs.length, 6);
    assert(s.passMs.every(v => Number.isFinite(v) && v >= 0));
    if (tag === 'profile') {
      assert(s.detailWritten !== 0);
      for (const name of ['probes', 'shadowRays', 'shadowDenoise', 'giRays', 'giDenoise', 'specularRays', 'specularDenoise']) {
        assert(Number.isFinite(s.detailMs[name]) && s.detailMs[name] >= 0, `${name} has an actual written timestamp pair`);
      }
    } else assert.equal(s.detailMs, null);
  }
}
