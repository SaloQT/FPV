import type { RenderContext } from './contracts';

const TILE = 8;

/** Deferred lighting compute pass (group 2 = G-buffer inputs + hdr output, see shaders/lighting/deferred.wgsl). */
export class DeferredLighting {
  private readonly pipeline: GPUComputePipeline;
  private readonly layout: GPUBindGroupLayout;
  private group: GPUBindGroup | null = null;
  private width = 0;
  private height = 0;

  /** `fallbackSky` paints the skyView LUT into empty pixels; enable it only when no module draws the sky. */
  constructor(private readonly rc: RenderContext, fallbackSky: boolean) {
    const C = GPUShaderStage.COMPUTE;
    const tex = (binding: number, sampleType: GPUTextureSampleType): GPUBindGroupLayoutEntry => ({ binding, visibility: C, texture: { sampleType } });
    this.layout = rc.device.createBindGroupLayout({
      label: 'lighting',
      entries: [
        tex(0, 'float'), tex(1, 'float'), tex(2, 'float'), tex(3, 'depth'), tex(4, 'unfilterable-float'), tex(5, 'float'), tex(6, 'float'),
        { binding: 7, visibility: C, storageTexture: { access: 'write-only', format: 'rgba16float' } },
      ],
    });
    this.pipeline = rc.device.createComputePipeline({
      label: 'deferred lighting',
      layout: rc.device.createPipelineLayout({ bindGroupLayouts: [rc.frame.layout, rc.world.layout, this.layout] }),
      compute: { module: rc.module('lighting/deferred.wgsl', { FALLBACK_SKY: fallbackSky }), entryPoint: 'main' },
    });
    this.rebuild();
  }

  /** Call after the G-buffer was recreated. */
  rebuild(): void {
    const g = this.rc.gbuf, v = g.views;
    this.group = this.rc.device.createBindGroup({
      label: 'lighting',
      layout: this.layout,
      entries: [
        { binding: 0, resource: v.albedo }, { binding: 1, resource: v.normal }, { binding: 2, resource: v.misc }, { binding: 3, resource: v.depth },
        { binding: 4, resource: v.sunShadow }, { binding: 5, resource: v.giDiffuse }, { binding: 6, resource: v.giSpecular }, { binding: 7, resource: v.hdr },
      ],
    });
    this.width = g.width;
    this.height = g.height;
  }

  encode(enc: GPUCommandEncoder): void {
    const pass = enc.beginComputePass({ label: 'deferred lighting' });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.rc.frame.group);
    pass.setBindGroup(1, this.rc.world.group);
    pass.setBindGroup(2, this.group);
    pass.dispatchWorkgroups(Math.ceil(this.width / TILE), Math.ceil(this.height / TILE));
    pass.end();
  }
}
