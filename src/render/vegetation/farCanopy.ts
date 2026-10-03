import type { RenderContext } from '../contracts';
import { DEPTH_STATE, GBUFFER_TARGETS } from '../contracts';
import { FAR_CARD_BYTES, farToneDefines, type FarForest } from './treePlanFar';

/** The shader module, bind-group layout and pipeline of the far canopy: scene independent, so built once and shared by every FarCanopy. */
export class FarCanopyPipeline {
  readonly layout: GPUBindGroupLayout;
  readonly pipeline: GPURenderPipeline;

  constructor(rc: RenderContext) {
    const dev = rc.device;
    this.layout = dev.createBindGroupLayout({
      label: 'far-canopy',
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      ],
    });
    const module = rc.module('vegetation/veg_far.wgsl', farToneDefines());
    this.pipeline = dev.createRenderPipeline({
      label: 'far-canopy',
      layout: dev.createPipelineLayout({ bindGroupLayouts: [rc.frame.layout, rc.world.layout, this.layout] }),
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: GBUFFER_TARGETS },
      primitive: { topology: 'triangle-strip', cullMode: 'none' },
      depthStencil: DEPTH_STATE,
    });
  }
}

/**
 * The far-field canopy cards (treePlanFar.ts) as one instanced draw into the G-buffer: 4 vertices per card (2 triangles), static
 * instance buffer, culling and distance fades in the vertex and fragment shaders (veg_far.wgsl), so there is no compute pass.
 * Per scene it owns only the card buffer and its bind group.
 */
export class FarCanopy {
  readonly cards: number;
  readonly bytes: number;
  private readonly buffer: GPUBuffer | null;
  private readonly group: GPUBindGroup | null;
  private readonly pipeline: GPURenderPipeline | null;

  constructor(rc: RenderContext, shared: FarCanopyPipeline, params: GPUBuffer, forest: FarForest) {
    this.cards = forest.count;
    this.bytes = forest.count * FAR_CARD_BYTES;
    if (forest.count === 0) {
      this.buffer = null; this.group = null; this.pipeline = null;
      return;
    }
    const dev = rc.device;
    this.buffer = dev.createBuffer({ label: 'far-canopy-cards', size: this.bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    dev.queue.writeBuffer(this.buffer, 0, forest.words.buffer, forest.words.byteOffset, this.bytes);
    this.group = dev.createBindGroup({ label: 'far-canopy', layout: shared.layout, entries: [{ binding: 0, resource: { buffer: params } }, { binding: 1, resource: { buffer: this.buffer } }] });
    this.pipeline = shared.pipeline;
  }

  encodeGBuffer(pass: GPURenderPassEncoder | GPURenderBundleEncoder): void {
    if (!this.pipeline || !this.group) return;
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(2, this.group);
    pass.draw(4, this.cards);
  }

  destroy(): void {
    this.buffer?.destroy();
  }
}
