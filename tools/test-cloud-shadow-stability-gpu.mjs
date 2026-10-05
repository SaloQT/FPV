// Functional GPU regression: a frozen cloud field must cast the same shadow across frame indices.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { create, globals } from 'webgpu';
Object.assign(globalThis, globals);
const shaderRoot = new URL('../src/render/shaders/', import.meta.url);
const seen = new Set();
function shader(path) {
  if (seen.has(path)) return '';
  seen.add(path);
  return readFileSync(new URL(path, shaderRoot), 'utf8').replace(/^#include "([^"]+)"/gm, (_, p) => shader(p)).replaceAll('${MARIA_ROWS}', '2');
}
const gpu = create([`backend=${process.platform === 'win32' ? 'd3d12' : process.platform === 'darwin' ? 'metal' : 'vulkan'}`]);
const adapter = await gpu.requestAdapter(); assert(adapter, 'GPU adapter required');
const device = await adapter.requestDevice(); device.pushErrorScope('validation');
const code = shader('sky/cloud_shadow.wgsl');
const module = device.createShaderModule({ code });
const info = await module.getCompilationInfo();
assert.deepEqual(info.messages.filter(m => m.type === 'error'), []);
const pipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } });
const U = GPUBufferUsage, T = GPUTextureUsage;
const width = 8, height = 8, row = 256;
function uniform(data) {
  const b = device.createBuffer({ size: data.byteLength, usage: U.UNIFORM | U.COPY_DST });
  device.queue.writeBuffer(b, 0, data); return b;
}
const frame = new Float32Array(192);
frame.set([0, 20, 0, 0], 144);
frame.set([0.6, 0.8, 0, 0], 156);
frame.set([0, 0.8, 0.6, 0], 164);
frame.set([6360, 6460, 0.02, 1], 188);
const atmos = new Float32Array(52);
atmos[0] = 1; atmos[6] = 1;
atmos.set([0.6, 0.5, 1, 17], 8);
atmos.set([1, 2.5, 6, 7], 12);
atmos.set([32, 0, 0, 0], 20);
atmos.set([0.9, 0, 5, 8000], 24);
const fb = uniform(frame), ab = uniform(atmos);
const noise = device.createTexture({ size: [4, 4, 4], dimension: '3d', format: 'rgba8unorm', usage: T.TEXTURE_BINDING | T.COPY_DST });
const bytes = Uint8Array.from({ length: 256 }, (_, i) => [240, 180, 210, 190][i % 4] - Math.floor(i / 4) % 17);
device.queue.writeTexture({ texture: noise }, bytes, { bytesPerRow: 16, rowsPerImage: 4 }, [4, 4, 4]);
const out = device.createTexture({ size: [width, height], format: 'rgba16float', usage: T.STORAGE_BINDING | T.COPY_SRC });
const read = device.createBuffer({ size: row * height, usage: U.COPY_DST | U.MAP_READ });
const group = (i, entries) => device.createBindGroup({ layout: pipeline.getBindGroupLayout(i), entries });
const g0 = group(0, [{ binding: 0, resource: { buffer: fb } }]);
const g1 = group(1, [
  { binding: 3, resource: out.createView() }, { binding: 5, resource: { buffer: ab } },
  { binding: 6, resource: noise.createView() }, { binding: 7, resource: noise.createView() },
  { binding: 8, resource: device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat', addressModeW: 'repeat' }) },
]);
async function run(index, centerX = 0) {
  atmos[21] = index; atmos[22] = centerX;
  device.queue.writeBuffer(ab, 0, atmos);
  const enc = device.createCommandEncoder(), pass = enc.beginComputePass();
  pass.setPipeline(pipeline); pass.setBindGroup(0, g0); pass.setBindGroup(1, g1); pass.dispatchWorkgroups(1); pass.end();
  enc.copyTextureToBuffer({ texture: out }, { buffer: read, bytesPerRow: row }, [width, height]);
  device.queue.submit([enc.finish()]); await read.mapAsync(GPUMapMode.READ);
  const src = new Uint8Array(read.getMappedRange());
  const pixels = new Uint8Array(width * height * 8);
  for (let y = 0; y < height; y++) pixels.set(src.subarray(y * row, y * row + width * 8), y * width * 8);
  read.unmap(); return pixels;
}
const frozen = await run(0);
assert(new Uint16Array(frozen.buffer).some((v, i) => i % 4 === 0 && v < 0x3c00), 'Fixture must include actual cloud shadows');
for (let index = 1; index <= 8; index++) assert.deepEqual(await run(index), frozen, `Frozen sunlight must not change at frame ${index}`);
const shifted = await run(11, 8000 / width);
for (let y = 0; y < height; y++) for (let x = 0; x < width - 1; x++) {
  const a = (y * width + x) * 8, b = (y * width + x + 1) * 8;
  assert.deepEqual(shifted.subarray(a, a + 8), frozen.subarray(b, b + 8), 'Overlapping world columns must survive map recentering');
}
assert.equal(await device.popErrorScope(), null);
device.destroy();
console.log('GPU frozen-cloud frame invariance and map recentering checks passed.');
process.exit(0);
