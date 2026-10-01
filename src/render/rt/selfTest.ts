import type { RenderContext, RTPrimitive } from '../contracts';
import type { TerrainSampler, Vec3 } from '../../contracts';
import { TORUS_STEPS_SHADER, bruteForce, type CpuHit } from './cpuReference';
import type { RtLayouts } from './layouts';
import { RtParamBlock, RT_PARAM_BYTES } from './params';
import { primBounds } from './prims';
import { DYNAMIC_MAX_PRIMS, type SceneBuffers } from './sceneBuffers';

export interface RtSelfTest {
  heightfield: { n: number; maxErr: number; mismatches: number };
  /** `mismatches` compares against a CPU brute force with the shader's torus step budget (traversal correctness); `torusBudgetMisses` counts extra rays whose only disagreement is a grazing torus hit the 32-step sphere trace cannot reach. */
  bvh: { n: number; mismatches: number; torusBudgetMisses: number };
}

const TERRAIN_RAYS = 1000;
const BVH_RAYS = 1000;
const HIT_TOLERANCE_M = 0.5;
const BVH_TOLERANCE_M = 0.05;
const TERRAIN_TMAX = 4000;
const BVH_VISIT_CAP = 512;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function unitVector(rand: () => number): [number, number, number] {
  const z = 2 * rand() - 1, a = 2 * Math.PI * rand(), r = Math.sqrt(1 - z * z);
  return [r * Math.cos(a), z, r * Math.sin(a)];
}

/** Rays [2i] = (origin, tMax), [2i+1] = (dir, kind) exactly as shaders/rt/test.wgsl expects them. */
function terrainRays(sampler: TerrainSampler, rand: () => number, out: Float32Array, base: number): void {
  const d = sampler.data;
  const extent = d.resolution * d.cellSize;
  for (let i = 0; i < TERRAIN_RAYS; i++) {
    const x = d.origin[0] + extent * (0.05 + 0.9 * rand());
    const z = d.origin[1] + extent * (0.05 + 0.9 * rand());
    const y = sampler.heightAt(x, z) + 1 + 150 * rand() * rand();
    const dir = unitVector(rand);
    dir[1] = -Math.abs(dir[1]) * (rand() < 0.7 ? 1 : 0.15);
    const len = Math.hypot(dir[0], dir[1], dir[2]);
    out.set([x, y, z, TERRAIN_TMAX, dir[0] / len, dir[1] / len, dir[2] / len, 0], (base + i) * 8);
  }
}

function bvhRays(prims: readonly RTPrimitive[], rand: () => number, out: Float32Array, base: number): void {
  const box = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < BVH_RAYS; i++) {
    const p = prims[Math.floor(rand() * prims.length)];
    primBounds(p, box);
    const target = [0, 1, 2].map((k) => box[k] + (box[k + 3] - box[k]) * rand());
    const away = unitVector(rand);
    const dist = 4 + 60 * rand();
    const o = [0, 1, 2].map((k) => target[k] + away[k] * dist);
    let dir = [0, 1, 2].map((k) => target[k] - o[k]);
    if (rand() < 0.2) dir = unitVector(rand);
    const len = Math.hypot(dir[0], dir[1], dir[2]);
    out.set([o[0], o[1], o[2], 400, dir[0] / len, dir[1] / len, dir[2] / len, 1], (base + i) * 8);
  }
}

/**
 * Runs the GPU heightfield tracer against TerrainSampler.raycast and the GPU BVH against a CPU brute-force loop on random rays.
 * One dispatch, one readback. Needs a rendered frame first (the terrain shape lives in the frame uniforms).
 */
export async function runSelfTest(
  rc: RenderContext, L: RtLayouts, pipeline: GPUComputePipeline, buffers: SceneBuffers, sampler: TerrainSampler | null, steps: number,
): Promise<RtSelfTest> {
  const rand = mulberry32(0x5eed);
  const statics = rc.rt.allStatic();
  const dynamics = rc.rt.allDynamic().slice(0, DYNAMIC_MAX_PRIMS);
  const prims = [...statics, ...dynamics];
  const nTerrain = sampler ? TERRAIN_RAYS : 0;
  const nBvh = prims.length ? BVH_RAYS : 0;
  const total = nTerrain + nBvh;
  const result: RtSelfTest = { heightfield: { n: nTerrain, maxErr: 0, mismatches: 0 }, bvh: { n: nBvh, mismatches: 0, torusBudgetMisses: 0 } };
  if (total === 0) return result;

  buffers.sync(rc.rt);
  const rays = new Float32Array(total * 8);
  if (sampler) terrainRays(sampler, rand, rays, 0);
  if (nBvh) bvhRays(prims, rand, rays, nTerrain);

  const d = rc.device;
  const U = GPUBufferUsage;
  const params = new RtParamBlock();
  params.write({
    rtWidth: total, rtHeight: 1, fullWidth: total, fullHeight: 1, divisor: 1, maxSteps: steps, giRays: 0, spec: false, terrain: true,
    staticRoot: buffers.staticRoot, dynamicRoot: buffers.dynamicRoot, visitCap: BVH_VISIT_CAP, frameIndex: 0, debugView: 0, seed: 0,
    probeStride: 1, probePhase: 0, probeLo: [0, 0, 0], probeRays: 0, probePrevLo: [0, 0, 0], probeAllFresh: true, probeDim: [1, 1, 1],
    softness: 1, probeSpacing: 1, probeHysteresis: 0, rayRange: 1, cloudCenterX: 0, cloudCenterZ: 0, cloudExtentM: 1,
  });
  const paramBuf = d.createBuffer({ label: 'rt test params', size: RT_PARAM_BYTES, usage: U.UNIFORM | U.COPY_DST });
  const rayBuf = d.createBuffer({ label: 'rt test rays', size: rays.byteLength, usage: U.STORAGE | U.COPY_DST });
  const resBytes = total * 16;
  const resBuf = d.createBuffer({ label: 'rt test results', size: resBytes, usage: U.STORAGE | U.COPY_SRC });
  const readBuf = d.createBuffer({ label: 'rt test readback', size: resBytes, usage: U.COPY_DST | U.MAP_READ });
  d.queue.writeBuffer(paramBuf, 0, params.buffer);
  d.queue.writeBuffer(rayBuf, 0, rays);
  const group = d.createBindGroup({
    label: 'rt test', layout: L.test,
    entries: [
      { binding: 0, resource: { buffer: paramBuf } }, { binding: 1, resource: { buffer: buffers.nodes } }, { binding: 2, resource: { buffer: buffers.prims } },
      { binding: 3, resource: { buffer: rayBuf } }, { binding: 4, resource: { buffer: resBuf } },
    ],
  });
  const enc = d.createCommandEncoder({ label: 'rt test' });
  const pass = enc.beginComputePass({ label: 'rt test' });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, rc.frame.group);
  pass.setBindGroup(1, rc.world.group);
  pass.setBindGroup(2, group);
  pass.dispatchWorkgroups(Math.ceil(total / 64));
  pass.end();
  enc.copyBufferToBuffer(resBuf, 0, readBuf, 0, resBytes);
  d.queue.submit([enc.finish()]);
  await readBuf.mapAsync(GPUMapMode.READ);
  const out = new Float32Array(readBuf.getMappedRange().slice(0));
  readBuf.unmap();
  for (const b of [paramBuf, rayBuf, resBuf, readBuf]) b.destroy();

  for (let i = 0; i < nTerrain; i++) {
    const r = rays.subarray(8 * i, 8 * i + 8);
    const cpu = sampler!.raycast([r[0], r[1], r[2]], [r[4], r[5], r[6]], TERRAIN_TMAX);
    const gpu = out[4 * i];
    if ((cpu === null) !== (gpu < 0)) { result.heightfield.mismatches++; continue; }
    if (cpu === null) continue;
    const err = Math.abs(cpu.t - gpu);
    result.heightfield.maxErr = Math.max(result.heightfield.maxErr, err);
    if (err >= HIT_TOLERANCE_M) result.heightfield.mismatches++;
  }
  for (let i = nTerrain; i < total; i++) {
    const r = rays.subarray(8 * i, 8 * i + 8);
    const o: Vec3 = [r[0], r[1], r[2]], dir: Vec3 = [r[4], r[5], r[6]];
    const gpu = out[4 * i];
    const disagrees = (cpu: CpuHit): boolean => (cpu.index >= 0) !== gpu >= 0 || (cpu.index >= 0 && Math.abs(cpu.t - gpu) > BVH_TOLERANCE_M);
    if (disagrees(bruteForce(prims, o, dir, r[3], TORUS_STEPS_SHADER))) result.bvh.mismatches++;
    else if (disagrees(bruteForce(prims, o, dir, r[3]))) result.bvh.torusBudgetMisses++;
  }
  return result;
}
