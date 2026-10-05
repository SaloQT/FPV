import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { create, globals } from 'webgpu';
Object.assign(globalThis, globals);
const included = new Set();
const shaderRoot = fileURLToPath(new URL('../src/render/shaders/', import.meta.url));
function expand(path) {
  if (included.has(path)) return '';
  included.add(path);
  return readFileSync(resolve(shaderRoot, path), 'utf8').split('\n').map(line => {
    const m = line.trim().match(/^#include "([^"]+)"/);
    return m ? expand(m[1]) : line.replaceAll('${GRP}', '2');
  }).join('\n');
}
const gpu = create([`backend=${process.platform === 'win32' ? 'd3d12' : process.platform === 'darwin' ? 'metal' : 'vulkan'}`]);
const adapter = await gpu.requestAdapter();
assert(adapter, 'No GPU adapter');
const device = await adapter.requestDevice();
device.pushErrorScope('validation');
const module = device.createShaderModule({ code: expand('rt/aux_pass.wgsl') });
const info = await module.getCompilationInfo();
assert.deepEqual(info.messages.filter(m => m.type === 'error'), []);
const pipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } });
const U = GPUBufferUsage, T = GPUTextureUsage;
function uniform(data) {
  const b = device.createBuffer({ size: data.byteLength, usage: U.UNIFORM | U.COPY_DST });
  device.queue.writeBuffer(b, 0, data); return b;
}
const f = new Float32Array(192);
for (let m = 0; m < 9; m++) for (let j = 0; j < 4; j++) f[m * 16 + j * 5] = 1;
f.set([1, 1, 1, 1], 148);
f.set([32, 1, 0, 220], 172);
f.set([-16, -16, 32, 32], 176);
f[186] = 1;
const frame = uniform(f);
const rp = new Uint32Array(36); rp.set([1, 1, 1, 1, 1, 64, 1, 2]);
const params = uniform(rp);
function texture(format, extra = 0) {
  return device.createTexture({ size: [1, 1], format, usage: T.TEXTURE_BINDING | extra });
}
function write(tex, data) { device.queue.writeTexture({ texture: tex }, data, { bytesPerRow: data.byteLength }, [1, 1]); }
const terrainNormal = texture('rgba8unorm', T.COPY_DST);
write(terrainNormal, new Uint8Array([128, 255, 128, 255]));
const depth = texture('depth32float', T.RENDER_ATTACHMENT);
const normal = texture('rgba16float', T.COPY_DST);
const misc = texture('rgba8unorm', T.COPY_DST);
const outDepth = texture('r32float', T.STORAGE_BINDING);
const outNormal = texture('rgba16float', T.STORAGE_BINDING | T.COPY_SRC);
const readback = device.createBuffer({ size: 256, usage: U.COPY_DST | U.MAP_READ });
const group = (index, entries) => device.createBindGroup({ layout: pipeline.getBindGroupLayout(index), entries });
const groups = [
  group(0, [{ binding: 0, resource: { buffer: frame } }]),
  group(1, [{ binding: 0, resource: device.createSampler({ magFilter: 'linear', minFilter: 'linear' }) },
    { binding: 4, resource: terrainNormal.createView() }]),
  group(2, [{ binding: 0, resource: { buffer: params } }, ...[depth, normal, misc, outDepth, outNormal].map((t, i) => ({ binding: i + 1, resource: t.createView() }))]),
];
async function sample(grass, x, terrain = true, reverseDepth = 1) {
  rp[7] = terrain ? 2 : 0; device.queue.writeBuffer(params, 0, rp);
  write(normal, new Uint16Array([x, 0x3800, 0x3800, 0]));
  write(misc, new Uint8Array([2, grass ? 100 : 0, 0, 0]));
  const enc = device.createCommandEncoder();
  enc.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: depth.createView(), depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: reverseDepth } }).end();
  const pass = enc.beginComputePass(); pass.setPipeline(pipeline);
  groups.forEach((g, i) => pass.setBindGroup(i, g)); pass.dispatchWorkgroups(1); pass.end();
  enc.copyTextureToBuffer({ texture: outNormal }, { buffer: readback, bytesPerRow: 256 }, [1, 1]);
  device.queue.submit([enc.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  const result = [...new Uint16Array(readback.getMappedRange()).slice(0, 4)]; readback.unmap();
  return result;
}
const right = await sample(true, 0x3c00);
const left = await sample(true, 0);
assert.deepEqual(right, left, 'Blade normal changes must not change the RT normal');
assert.deepEqual(right.slice(2), [0x3800, 0], 'Keep roughness and metalness');
assert.notEqual(right[0], 0x3c00, 'Use terrain normal rather than blade normal');
assert.deepEqual(await sample(false, 0x3c00), [0x3c00, 0x3800, 0x3800, 0], 'Opaque terrain material must retain its normal');
assert.deepEqual(await sample(true, 0x3c00, false), [0x3c00, 0x3800, 0x3800, 0], 'No-terrain path remains valid');
assert.deepEqual(await sample(true, 0x3c00, true, 0), [0x3c00, 0x3800, 0x3800, 0], 'Do not reconstruct sky');
assert.equal(await device.popErrorScope(), null);
device.destroy();
console.log('GPU grass normal stability, other materials, no-terrain and sky checks passed.');
process.exit(0);
