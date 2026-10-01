import type { RenderContext } from '../contracts';
import { DEPTH_STATE, GBUFFER_TARGETS } from '../contracts';
import { ATLAS_H, ATLAS_MIPS, ATLAS_W, buildLeafAtlas } from './leafAtlas';
import { VERTEX_STRIDE, packMeshes } from './meshBuilder';
import { DRAW_COUNT, FIRST_ROCK, LOD_COUNT, buildVariantAssets, type VariantAsset } from './variants';

export const ARGS_WORDS = 5;
export const ARGS_BYTES = DRAW_COUNT * ARGS_WORDS * 4;

const VERTEX_LAYOUT: GPUVertexBufferLayout = {
  arrayStride: VERTEX_STRIDE,
  attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x3' },
    { shaderLocation: 1, offset: 12, format: 'unorm16x2' },
    { shaderLocation: 2, offset: 16, format: 'unorm16x2' },
    { shaderLocation: 3, offset: 20, format: 'unorm8x4' },
  ],
};

/** GPU objects that do not depend on the scene or the quality tier: meshes, leaf atlas, layouts and pipelines. */
export class TreeAssets {
  readonly variants: VariantAsset[];
  readonly vertexBuffer: GPUBuffer;
  readonly indexBuffer: GPUBuffer;
  /** Indirect draw arguments with instanceCount 0, one entry per (variant, LOD): draw k = variant * LOD_COUNT + lod. */
  readonly argsTemplate: Uint32Array;
  readonly triangles: number[] = [];
  readonly vertexBytes: number;
  readonly indexBytes: number;
  readonly drawLayout: GPUBindGroupLayout;
  readonly cullLayout: GPUBindGroupLayout;
  readonly finalizeLayout: GPUBindGroupLayout;
  readonly atlasView: GPUTextureView;
  readonly atlasDataView: GPUTextureView;
  readonly cullPipe: GPUComputePipeline;
  readonly finalizePipe: GPUComputePipeline;
  /** One tree pipeline per LOD (the shader dithers a LOD in and out of its hand-over bands). */
  readonly treePipes: GPURenderPipeline[];
  readonly rockPipe: GPURenderPipeline;
  private readonly atlas: GPUTexture;
  private readonly atlasData: GPUTexture;

  constructor(rc: RenderContext) {
    const dev = rc.device;
    this.variants = buildVariantAssets();
    const packed = packMeshes(this.variants.flatMap((v) => v.lods));
    this.argsTemplate = new Uint32Array(DRAW_COUNT * ARGS_WORDS);
    packed.ranges.forEach((r, k) => {
      this.argsTemplate.set([r.indexCount, 0, r.firstIndex, r.baseVertex, 0], k * ARGS_WORDS);
      this.triangles.push(r.indexCount / 3);
    });
    this.vertexBytes = packed.vertices.byteLength;
    this.indexBytes = packed.indices.byteLength;
    this.vertexBuffer = dev.createBuffer({ label: 'tree-vertices', size: this.vertexBytes, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    dev.queue.writeBuffer(this.vertexBuffer, 0, packed.vertices);
    this.indexBuffer = dev.createBuffer({ label: 'tree-indices', size: this.indexBytes, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    dev.queue.writeBuffer(this.indexBuffer, 0, packed.indices);

    const atlasTexture = (label: string, levels: Uint8Array[]): GPUTexture => {
      const tex = dev.createTexture({ label, size: [ATLAS_W, ATLAS_H], mipLevelCount: ATLAS_MIPS, format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      levels.forEach((data, level) => {
        const w = ATLAS_W >> level, h = ATLAS_H >> level;
        dev.queue.writeTexture({ texture: tex, mipLevel: level }, data, { bytesPerRow: w * 4 }, [w, h]);
      });
      return tex;
    };
    const atlas = buildLeafAtlas();
    this.atlas = atlasTexture('leaf-atlas-colour', atlas.colour);
    this.atlasData = atlasTexture('leaf-atlas-data', atlas.data);
    this.atlasView = this.atlas.createView();
    this.atlasDataView = this.atlasData.createView();

    const C = GPUShaderStage.COMPUTE, V = GPUShaderStage.VERTEX, F = GPUShaderStage.FRAGMENT;
    const buffer = (binding: number, visibility: number, type: GPUBufferBindingType): GPUBindGroupLayoutEntry => ({ binding, visibility, buffer: { type } });
    this.drawLayout = dev.createBindGroupLayout({
      label: 'tree-draw',
      entries: [
        buffer(0, V | F, 'uniform'), buffer(1, V, 'read-only-storage'), buffer(2, V, 'read-only-storage'), buffer(3, V | F, 'read-only-storage'),
        { binding: 4, visibility: F, texture: { sampleType: 'float' } },
        { binding: 5, visibility: F, texture: { sampleType: 'float' } },
      ],
    });
    this.cullLayout = dev.createBindGroupLayout({
      label: 'tree-cull',
      entries: [buffer(0, C, 'uniform'), buffer(1, C, 'read-only-storage'), buffer(2, C, 'read-only-storage'), buffer(3, C, 'storage'), buffer(4, C, 'storage')],
    });
    this.finalizeLayout = dev.createBindGroupLayout({
      label: 'tree-finalize',
      entries: [buffer(0, C, 'uniform'), buffer(1, C, 'read-only-storage'), buffer(2, C, 'storage')],
    });

    const layout = (l: GPUBindGroupLayout): GPUPipelineLayout => dev.createPipelineLayout({ bindGroupLayouts: [rc.frame.layout, rc.world.layout, l] });
    const cull = rc.module('vegetation/tree_cull.wgsl');
    const fin = rc.module('vegetation/tree_finalize.wgsl');
    this.cullPipe = dev.createComputePipeline({ label: 'tree-cull', layout: layout(this.cullLayout), compute: { module: cull, entryPoint: 'cull' } });
    this.finalizePipe = dev.createComputePipeline({ label: 'tree-finalize', layout: layout(this.finalizeLayout), compute: { module: fin, entryPoint: 'finalize' } });
    const draw = (label: string, file: string, constants?: Record<string, number>): GPURenderPipeline => {
      const module = rc.module(file);
      return dev.createRenderPipeline({
        label,
        layout: layout(this.drawLayout),
        vertex: { module, entryPoint: 'vs', buffers: [VERTEX_LAYOUT], constants },
        fragment: { module, entryPoint: 'fs', targets: GBUFFER_TARGETS },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: DEPTH_STATE,
      });
    };
    this.treePipes = [0, 1, 2].map((lod) => draw(`tree-draw-lod${lod}`, 'vegetation/tree.wgsl', { LOD: lod }));
    this.rockPipe = draw('rock-draw', 'vegetation/rock.wgsl');
  }

  /** True for draws that use the rock pipeline. */
  isRockDraw(k: number): boolean {
    return Math.floor(k / LOD_COUNT) >= FIRST_ROCK;
  }

  destroy(): void {
    this.vertexBuffer.destroy();
    this.indexBuffer.destroy();
    this.atlas.destroy();
    this.atlasData.destroy();
  }
}
