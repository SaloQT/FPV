#!/usr/bin/env node
/** Compare prism raster faces and thin-capsule regressions with production hardware RT intersections. */
import { build } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { acquireGpuLock } from './native-bench/lock.mjs';
import { adapterIdentity, openRuntime } from './native-bench/runtime.mjs';

const out = resolve(process.argv[2] ?? '.bench/park-primitives-check'), bundle = resolve(out, 'bundle');
await mkdir(bundle, { recursive: true });
const entry = resolve(bundle, 'entry.ts');
const exports = [['resolveShader, compileShader', 'src/render/shaderLib.ts'], ['packPrim', 'src/render/rt/prims.ts'], ['intersectPrim', 'src/render/rt/cpuReference.ts'],
  ['capsuleRegressionCases', 'src/render/rt/capsuleFixtures.ts'],
  ['parkMesh', 'src/render/park/mesh.ts'], ['partDistance', 'src/world/park/collision.ts'], ['add, sub, mul, unit, cross, rotate, qmul, axisAngle', 'src/world/park/math.ts']];
await writeFile(entry, exports.map(([names, path]) => `export { ${names} } from ${JSON.stringify(resolve(path).replaceAll('\\', '/'))};`).join('\n'));
await build({ configFile: false, logLevel: 'warn', publicDir: false, build: { ssr: entry, outDir: bundle, emptyOutDir: false, target: 'es2022', rolldownOptions: { output: { entryFileNames: 'primitives.mjs' } } } });
const a = await import(pathToFileURL(resolve(bundle, 'primitives.mjs')).href), primitives = [], probes = [], vertices = a.parkMesh('gable');
for (const half of [[3, 1.2, 0.1], [0.12, 2, 4], [6, 0.02, 0.1]]) for (const angle of [0, 0.61, 1.7, 2.95]) {
  const rot = a.qmul(a.axisAngle([0, 1, 0], angle), a.axisAngle([1, 0, 0], 0.37 + angle / 3));
  const p = { type: 'gable', center: [792, 12.2, -831], half, rot, material: { albedo: [0.3, 0.4, 0.5], roughness: 0.8, metalness: 0 } }, index = primitives.length;
  primitives.push(p);
  for (let i = 0; i < vertices.length; i += 21) {
    const tri = [0, 7, 14].map(o => half.map((h, k) => vertices[i + o + k] * h));
    const center = a.mul(a.add(a.add(tri[0], tri[1]), tri[2]), 1 / 3), normal = a.unit(a.cross(a.sub(tri[1], tri[0]), a.sub(tri[2], tri[0])));
    const worldNormal = a.rotate(rot, normal), origin = a.add(p.center, a.rotate(rot, a.add(center, a.mul(normal, 0.7))));
    const collisionNormal = [0, 0, 0], distance = a.partDistance({ shape: 'gable', half }, center, collisionNormal);
    if (Math.abs(distance) > 1e-10 || Math.hypot(...a.sub(normal, collisionNormal)) > 1e-10) throw new Error('Raster and collision prism boundaries differ');
    probes.push({ index, origin, direction: a.mul(worldNormal, -1), normal: worldNormal, hit: true });
  }
  probes.push({ index, origin: p.center, direction: [0, 1, 0], hit: false });
  probes.push({ index, origin: a.add(p.center, a.rotate(rot, [0, 2 * half[1] + 1, 0])), direction: a.rotate(rot, [0, 1, 0]), hit: false });
}
for (const probe of a.capsuleRegressionCases()) { const index = primitives.push(probe.primitive) - 1; probes.push({ ...probe, index }); }
const packed = new Float32Array(primitives.length * 16), words = new Uint32Array(packed.buffer), rays = new Float32Array(probes.length * 8);
primitives.forEach((p, i) => a.packPrim(packed, words, i * 16, p));
probes.forEach((r, i) => rays.set([...r.origin, r.index, ...r.direction, 400], i * 8));
const release = await acquireGpuLock(); let runtime, device;
try {
  runtime = await openRuntime({ backend: 'd3d12' }); const { adapter, identity } = await adapterIdentity(runtime.gpu); device = await adapter.requestDevice();
  device.pushErrorScope('validation');
  const shader = await a.compileShader(device, 'park primitive contact parity', a.resolveShader('rt/rt_prims.wgsl') + `
@group(0) @binding(0) var<storage,read> probeRays:array<vec4f>;
@group(0) @binding(1) var<storage,read_write> probeResults:array<vec4f>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) gid:vec3u) {
  let i=gid.x; if(i>=${probes.length}u){return;} let o=probeRays[2u*i]; let d=probeRays[2u*i+1u];
  let t=intersectPrim(u32(o.w),o.xyz,d.xyz,d.w); var normal=vec3f(0.0);
  if(t<NO_HIT){normal=primNormal(u32(o.w),o.xyz+d.xyz*t);} probeResults[i]=vec4f(t,normal);
}`);
  const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module: shader, entryPoint: 'main' } });
  const input = device.createBuffer({ size: rays.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const prim = device.createBuffer({ size: packed.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const results = device.createBuffer({ size: probes.length * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const read = device.createBuffer({ size: probes.length * 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(input, 0, rays); device.queue.writeBuffer(prim, 0, packed);
  const io = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: input } }, { binding: 1, resource: { buffer: results } }] });
  const empty = device.createBindGroup({ layout: pipeline.getBindGroupLayout(1), entries: [] });
  const shapes = device.createBindGroup({ layout: pipeline.getBindGroupLayout(2), entries: [{ binding: 10, resource: { buffer: prim } }] });
  const command = device.createCommandEncoder(), pass = command.beginComputePass(); pass.setPipeline(pipeline); pass.setBindGroup(0, io); pass.setBindGroup(1, empty); pass.setBindGroup(2, shapes); pass.dispatchWorkgroups(Math.ceil(probes.length / 64)); pass.end();
  command.copyBufferToBuffer(results, 0, read, 0, probes.length * 16); device.queue.submit([command.finish()]); await read.mapAsync(GPUMapMode.READ);
  const values = new Float32Array(read.getMappedRange().slice(0)); read.unmap();
  const failures = []; let maxDistanceError = 0, maxNormalError = 0;
  probes.forEach((r, i) => {
    const ray = rays.subarray(i * 8, i * 8 + 8), cpu = a.intersectPrim(primitives[r.index], [...ray.slice(0, 3)], [...ray.slice(4, 7)], 400), gpu = values[i * 4];
    const hit = gpu < 1e29, numericBound = 64 * 2 ** -23 * Math.max(1, ...r.origin.map(Math.abs));
    if (hit !== r.hit) failures.push({ i, reason: 'entry hit mismatch', gpu, expected: r.hit });
    if (hit && r.hit) {
      const distanceError = Math.abs(cpu - gpu), normalError = r.normal ? Math.hypot(...a.sub([...values.slice(i * 4 + 1, i * 4 + 4)], r.normal)) : 0;
      maxDistanceError = Math.max(maxDistanceError, distanceError); maxNormalError = Math.max(maxNormalError, normalError);
      if (distanceError > numericBound || normalError > 1e-5) failures.push({ i, distanceError, normalError, numericBound });
    }
  });
  const validation = (await device.popErrorScope())?.message ?? null;
  const report = { adapter: identity, shapes: primitives.length, rays: probes.length, maxDistanceError, maxNormalError, validation, failures };
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  for (const b of [input, prim, results, read]) b.destroy();
  if (validation || failures.length) throw new Error('Hardware primitive contact parity failed');
} finally { device?.destroy(); runtime?.close(); await release(); }
