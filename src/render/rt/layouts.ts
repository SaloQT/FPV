/** Bind group layouts of the RT passes. Binding numbers mirror the @binding declarations in shaders/rt/*.wgsl. */
export interface RtLayouts {
  /** group 2 of shadow / gi / spec. */
  trace: GPUBindGroupLayout;
  /** group 2 of probe_update. */
  probe: GPUBindGroupLayout;
  /** group 2 of the self-test kernel. */
  test: GPUBindGroupLayout;
  /** group 1 of the non-world passes (which must not include world_bindings.wgsl). */
  aux: GPUBindGroupLayout;
  temporal: GPUBindGroupLayout;
  atrousRgba: GPUBindGroupLayout;
  atrousR32: GPUBindGroupLayout;
  latch: GPUBindGroupLayout;
}

export function createLayouts(device: GPUDevice): RtLayouts {
  const C = GPUShaderStage.COMPUTE;
  const uniform = (binding: number): GPUBindGroupLayoutEntry => ({ binding, visibility: C, buffer: { type: 'uniform' } });
  const storageRo = (binding: number): GPUBindGroupLayoutEntry => ({ binding, visibility: C, buffer: { type: 'read-only-storage' } });
  const storageRw = (binding: number): GPUBindGroupLayoutEntry => ({ binding, visibility: C, buffer: { type: 'storage' } });
  const tex2d = (binding: number): GPUBindGroupLayoutEntry => ({ binding, visibility: C, texture: { sampleType: 'unfilterable-float' } });
  const tex3d = (binding: number): GPUBindGroupLayoutEntry => ({ binding, visibility: C, texture: { sampleType: 'float', viewDimension: '3d' } });
  const store2d = (binding: number, format: GPUTextureFormat): GPUBindGroupLayoutEntry => ({ binding, visibility: C, storageTexture: { access: 'write-only', format } });
  const store3d = (binding: number): GPUBindGroupLayoutEntry => ({ binding, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '3d' } });
  const layout = (label: string, entries: GPUBindGroupLayoutEntry[]) => device.createBindGroupLayout({ label: `rt ${label}`, entries });
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => tex2d(from + i));
  const probeSampler: GPUBindGroupLayoutEntry = { binding: 10, visibility: C, sampler: { type: 'filtering' } };

  return {
    trace: layout('trace', [
      uniform(0), storageRo(1), storageRo(2), tex3d(3), tex3d(4), tex3d(5), tex2d(6), tex2d(7), store2d(8, 'rgba16float'), store2d(9, 'rgba16float'), probeSampler,
    ]),
    probe: layout('probe', [
      uniform(0), storageRo(1), storageRo(2), tex3d(3), tex3d(4), tex3d(5), store3d(6), store3d(7), store3d(8), storageRo(9), probeSampler,
    ]),
    test: layout('test', [uniform(0), storageRo(1), storageRo(2), storageRo(3), storageRw(4)]),
    aux: layout('aux', [
      uniform(0), { binding: 1, visibility: C, texture: { sampleType: 'depth' } }, tex2d(2), tex2d(3), store2d(4, 'r32float'), store2d(5, 'rgba16float'),
    ]),
    temporal: layout('temporal', [uniform(0), ...range(1, 9), storageRo(10), store2d(11, 'rgba16float'), store2d(12, 'rgba16float')]),
    atrousRgba: layout('atrous rgba', [uniform(0), ...range(1, 4), store2d(5, 'rgba16float')]),
    atrousR32: layout('atrous r32', [uniform(0), ...range(1, 4), store2d(5, 'r32float')]),
    latch: layout('latch', [uniform(0), storageRw(1)]),
  };
}
