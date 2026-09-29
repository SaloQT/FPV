import type { RenderContext } from '../contracts';

export const DETAIL_SIZE = 512;
export const DETAIL_LAYERS = 8;
const MIP_LEVELS = Math.log2(DETAIL_SIZE) + 1;

export interface DetailTextures {
  /** rgb = albedo (sampled through an sRGB view), a = height. */
  viewA: GPUTextureView;
  /** rg = slope, b = roughness, a = cavity AO. */
  viewB: GPUTextureView;
  sampler: GPUSampler;
  destroy(): void;
}

/** Generates the procedural ground detail arrays once on the GPU (compute), then fills the mip chain. */
export function createDetailTextures(rc: RenderContext): DetailTextures {
  const device = rc.device;
  const usage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING;
  const size = { width: DETAIL_SIZE, height: DETAIL_SIZE, depthOrArrayLayers: DETAIL_LAYERS };
  const texA = device.createTexture({ label: 'terrain-detail-a', size, format: 'rgba8unorm', mipLevelCount: MIP_LEVELS, usage, viewFormats: ['rgba8unorm-srgb'] });
  const texB = device.createTexture({ label: 'terrain-detail-b', size, format: 'rgba8unorm', mipLevelCount: MIP_LEVELS, usage });
  const level = (t: GPUTexture, mip: number): GPUTextureView =>
    t.createView({ dimension: '2d-array', baseMipLevel: mip, mipLevelCount: 1 });

  const gen = device.createComputePipeline({ label: 'terrain-detail-gen', layout: 'auto', compute: { module: rc.module('terrain/detail_gen.wgsl'), entryPoint: 'main' } });
  const mip = device.createComputePipeline({ label: 'terrain-detail-mips', layout: 'auto', compute: { module: rc.module('terrain/detail_mips.wgsl'), entryPoint: 'main' } });

  const enc = device.createCommandEncoder({ label: 'terrain-detail-init' });
  const genGroup = device.createBindGroup({ layout: gen.getBindGroupLayout(0), entries: [{ binding: 0, resource: level(texA, 0) }, { binding: 1, resource: level(texB, 0) }] });
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

  return {
    viewA: texA.createView({ dimension: '2d-array', format: 'rgba8unorm-srgb', usage: GPUTextureUsage.TEXTURE_BINDING }),
    viewB: texB.createView({ dimension: '2d-array', usage: GPUTextureUsage.TEXTURE_BINDING }),
    sampler: device.createSampler({ addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: 8 }),
    destroy() { texA.destroy(); texB.destroy(); },
  };
}
