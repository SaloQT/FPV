/** Small WebGPU helpers shared by the trainer, the parity harness and the benchmarks. */

export type Binding = GPUBuffer | { buffer: GPUBuffer; offset?: number; size?: number };

const U = (): typeof GPUBufferUsage => GPUBufferUsage;

/** A storage buffer, filled from `data` or zeroed with `size` bytes. */
export function storageBuffer(device: GPUDevice, data: ArrayBufferView | ArrayBuffer | number, label: string): GPUBuffer {
  const size = typeof data === 'number' ? data : data.byteLength;
  const buffer = device.createBuffer({ label, size: Math.max(16, Math.ceil(size / 4) * 4), usage: U().STORAGE | U().COPY_SRC | U().COPY_DST });
  if (typeof data !== 'number') device.queue.writeBuffer(buffer, 0, data instanceof ArrayBuffer ? data : (data.buffer as ArrayBuffer), data instanceof ArrayBuffer ? 0 : data.byteOffset, size);
  return buffer;
}

export function uniformBuffer(device: GPUDevice, size: number, label: string): GPUBuffer {
  return device.createBuffer({ label, size: Math.ceil(size / 16) * 16, usage: U().UNIFORM | U().COPY_DST });
}

/** Binds `entries` in order (binding 0, 1, ...) to `group` of `pipeline`; `null` skips a binding the shader dropped. */
export function bindGroup(device: GPUDevice, pipeline: GPUComputePipeline, group: number, entries: (Binding | null)[], label?: string): GPUBindGroup {
  return device.createBindGroup({
    label,
    layout: pipeline.getBindGroupLayout(group),
    entries: entries.flatMap((b, i) => (b === null ? [] : [{ binding: i, resource: b instanceof GPUBuffer ? { buffer: b } : b }])),
  });
}

/** Copies `size` bytes of `src` from `offset` back to the CPU. */
export async function readBuffer(device: GPUDevice, src: GPUBuffer, offset = 0, size = src.size - offset): Promise<ArrayBuffer> {
  const staging = device.createBuffer({ size, usage: U().COPY_DST | U().MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyBufferToBuffer(src, offset, staging, 0, size);
  device.queue.submit([enc.finish()]);
  await staging.mapAsync(GPUMapMode.READ);
  const out = staging.getMappedRange().slice(0);
  staging.unmap();
  staging.destroy();
  return out;
}

/** Compiles `code` and throws with the compiler's messages (and the offending lines) on any error. */
export async function compileModule(device: GPUDevice, code: string, label: string): Promise<GPUShaderModule> {
  const module = device.createShaderModule({ label, code });
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter((m) => m.type === 'error');
  if (errors.length) {
    const lines = code.split('\n');
    throw new Error(`${label}: ${errors.map((m) => `${m.lineNum}:${m.linePos} ${m.message}\n  > ${lines[m.lineNum - 1] ?? ''}`).join('\n')}`);
  }
  return module;
}

/** Binding kinds of a bind group, in binding order: read-write storage, read-only storage, uniform. */
export type BindKind = 'rw' | 'ro' | 'uniform';

/** World.wgsl's group: tracks, heights, gates, boxes, grid cells, grid items, paths. */
export const WORLD_GROUP: BindKind[] = ['ro', 'ro', 'ro', 'ro', 'ro', 'ro', 'ro'];

/** An explicit layout, so every declared binding is part of it whether or not an entry point reads it. */
export function pipelineLayout(device: GPUDevice, groups: BindKind[][]): GPUPipelineLayout {
  const type = { rw: 'storage', ro: 'read-only-storage', uniform: 'uniform' } as const;
  return device.createPipelineLayout({
    bindGroupLayouts: groups.map((g) => device.createBindGroupLayout({
      entries: g.map((k, i) => ({ binding: i, visibility: GPUShaderStage.COMPUTE, buffer: { type: type[k] } })),
    })),
  });
}

export function pipeline(device: GPUDevice, module: GPUShaderModule, entryPoint: string, groups: BindKind[][]): Promise<GPUComputePipeline> {
  return device.createComputePipelineAsync({ label: entryPoint, layout: pipelineLayout(device, groups), compute: { module, entryPoint } });
}

/** One compute dispatch inside an open pass. */
export function dispatch(pass: GPUComputePassEncoder, p: GPUComputePipeline, groups: GPUBindGroup[], x: number, y = 1, z = 1): void {
  pass.setPipeline(p);
  groups.forEach((g, i) => pass.setBindGroup(i, g));
  pass.dispatchWorkgroups(x, y, z);
}
