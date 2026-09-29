import type { RenderContext } from '../contracts';

export const CLOUD_SHAPE_SIZE = 128;
export const CLOUD_DETAIL_SIZE = 32;

/** The two tileable 3D noise volumes the cloud density is built from (see shaders/sky/cloud_noise.wgsl). */
export class CloudNoise {
  readonly shape: GPUTexture;
  readonly detail: GPUTexture;
  readonly shapeView: GPUTextureView;
  readonly detailView: GPUTextureView;

  /** Bakes both volumes into the encoder; the textures are valid for every later submission. */
  constructor(rc: RenderContext, enc: GPUCommandEncoder) {
    const d = rc.device;
    const make = (label: string, size: number): GPUTexture => d.createTexture({
      label, dimension: '3d', format: 'rgba8unorm', size: [size, size, size],
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    });
    this.shape = make('cloud shape noise', CLOUD_SHAPE_SIZE);
    this.detail = make('cloud detail noise', CLOUD_DETAIL_SIZE);
    this.shapeView = this.shape.createView({ dimension: '3d' });
    this.detailView = this.detail.createView({ dimension: '3d' });

    const layout = d.createBindGroupLayout({
      label: 'cloud noise',
      entries: [{ binding: 0, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba8unorm', viewDimension: '3d' } }],
    });
    const pipelineLayout = d.createPipelineLayout({ bindGroupLayouts: [rc.frame.layout, layout] });
    const bake = (label: string, defines: Record<string, boolean>, view: GPUTextureView, size: number): void => {
      const pipeline = d.createComputePipeline({
        label, layout: pipelineLayout, compute: { module: rc.module('sky/cloud_noise.wgsl', defines), entryPoint: 'main' },
      });
      const group = d.createBindGroup({ layout, entries: [{ binding: 0, resource: view }] });
      const pass = enc.beginComputePass({ label });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, rc.frame.group);
      pass.setBindGroup(1, group);
      const n = size / 4;
      pass.dispatchWorkgroups(n, n, n);
      pass.end();
    };
    bake('cloud shape bake', { SHAPE: true }, this.shapeView, CLOUD_SHAPE_SIZE);
    bake('cloud detail bake', { DETAIL: true }, this.detailView, CLOUD_DETAIL_SIZE);
  }

  destroy(): void {
    this.shape.destroy();
    this.detail.destroy();
  }
}
