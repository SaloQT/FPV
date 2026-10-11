import type { RenderContext } from '../contracts';

export const DETAIL_SIZE = 512;
/** One per ground layer of ground_palette.wgsl (GL_COUNT). */
export const DETAIL_LAYERS = 14;
const MIP_LEVELS = Math.log2(DETAIL_SIZE) + 1;

export interface DetailTextures {
  /** rgb = albedo (sampled through an sRGB view), a = height. */
  viewA: GPUTextureView;
  /** rg = slope, b = roughness, a = cavity AO. */
  viewB: GPUTextureView;
  sampler: GPUSampler;
  /** Resolves once the generator and mip pipelines have compiled (in the background) and the arrays are filled. */
  ready: Promise<void>;
  destroy(): void;
}

/**
 * Generates the procedural ground detail arrays once on the GPU (compute), then fills the mip chain. The pipelines compile in the
 * background (ready), so the compile overlaps the other modules' start-up.
 */
export function createDetailTextures(rc: RenderContext): DetailTextures {
  const device = rc.device;
  const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING;
  const size = { width: DETAIL_SIZE, height: DETAIL_SIZE, depthOrArrayLayers: DETAIL_LAYERS };
  const texA = device.createTexture({ label: 'terrain-detail-a', size, format: 'rgba8unorm', mipLevelCount: MIP_LEVELS, usage, viewFormats: ['rgba8unorm-srgb'] });
  const texB = device.createTexture({ label: 'terrain-detail-b', size, format: 'rgba8unorm', mipLevelCount: MIP_LEVELS, usage });
  const level = (t: GPUTexture, mip: number): GPUTextureView =>
    t.createView({ dimension: '2d-array', baseMipLevel: mip, mipLevelCount: 1 });

  const genPending = device.createComputePipelineAsync({ label: 'terrain-detail-gen', layout: 'auto', compute: { module: rc.module('terrain/detail_gen.wgsl'), entryPoint: 'main' } });
  // Loop bounds the generator reads at run time (detail_gen.wgsl, `bounds`): with them unknown to the compiler its neighbour-cell loops stay
  // loops instead of being unrolled, which made the D3D12 compile take about 10 s.
  const bounds = device.createBuffer({ label: 'terrain-detail-bounds', size: 16, usage: GPUBufferUsage.UNIFORM, mappedAtCreation: true });
  new Int32Array(bounds.getMappedRange()).set([1, 0, 0, 0]);
  bounds.unmap();
  const mipPending = device.createComputePipelineAsync({ label: 'terrain-detail-mips', layout: 'auto', compute: { module: rc.module('terrain/detail_mips.wgsl'), entryPoint: 'main' } });

  /** Records and submits the generator pass and the mip chain once both pipelines exist. */
  function fill(gen: GPUComputePipeline, mip: GPUComputePipeline): void {
    const enc = device.createCommandEncoder({ label: 'terrain-detail-init' });
    const genGroup = device.createBindGroup({ layout: gen.getBindGroupLayout(0), entries: [{ binding: 0, resource: level(texA, 0) }, { binding: 1, resource: level(texB, 0) }, { binding: 2, resource: { buffer: bounds } }] });
    let pass = enc.beginComputePass({ label: 'detail-gen' });
    pass.setPipeline(gen);
    pass.setBindGroup(0, genGroup);
    pass.dispatchWorkgroups(DETAIL_SIZE / 8, DETAIL_SIZE / 8, DETAIL_LAYERS);
    pass.end();

    for (let m = 1; m < MIP_LEVELS; m++) {
      const dim = DETAIL_SIZE >> m;
      const group = device.createBindGroup({
        layout: mip.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: level(texA, m - 1) },
          { binding: 1, resource: level(texB, m - 1) },
          { binding: 2, resource: level(texA, m) },
          { binding: 3, resource: level(texB, m) },
        ],
      });
      pass = enc.beginComputePass({ label: `detail-mip-${m}` });
      pass.setPipeline(mip);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(Math.ceil(dim / 8), Math.ceil(dim / 8), DETAIL_LAYERS);
      pass.end();
    }
    device.queue.submit([enc.finish()]);
  }
  const ready = Promise.all([genPending, mipPending]).then(([gen, mip]) => fill(gen, mip));

  return {
    ready,
    viewA: texA.createView({ dimension: '2d-array', format: 'rgba8unorm-srgb', usage: GPUTextureUsage.TEXTURE_BINDING }),
    viewB: texB.createView({ dimension: '2d-array', usage: GPUTextureUsage.TEXTURE_BINDING }),
    sampler: device.createSampler({ addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: 8 }),
    destroy() { texA.destroy(); texB.destroy(); },
  };
}
