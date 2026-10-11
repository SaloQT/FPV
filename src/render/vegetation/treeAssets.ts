import { isExtreme, type RenderContext } from '../contracts';
import { DEPTH_STATE, GBUFFER_TARGETS } from '../contracts';
import { EXTREME_TILE_SIZE, TILES_X, TILES_Y, TILE_SIZE, atlasMips, buildLeafAtlasSliced, type LeafAtlas } from './leafAtlas';
import { BARK_NOISE_SIZE, buildBarkNoiseSliced } from './barkNoise';
import { loadBarkScans, scanMipSkip, uploadBarkScans, type BarkScans } from './barkScans';
import { VERTEX_STRIDE, packMeshes } from './meshBuilder';
import { buildTreesInWorkers } from './treeBuildPool';
import { atlasCacheKey, loadCachedAtlas, loadCachedVariant, storeCachedAtlas, storeCachedVariant, treeCacheKey } from './treeCache';
import { DRAW_COUNT, LOD_COUNT, VARIANT_DEFS, buildVariantAssetsSliced, seedVariantLods, isRockVariant, type VariantAsset } from './variants';

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

/**
 * Every variant's meshes (dense: the extreme tier's crowns): each tree variant read from the disk cache (treeCache.ts) where its entry is
 * there, the rest built (on worker threads where there are any, else on this thread, in time slices) and stored; rocks are always built.
 */
async function cachedVariants(dense: boolean): Promise<VariantAsset[]> {
  const trees = VARIANT_DEFS.map((d, v) => (d.rock < 0 ? v : -1)).filter((v) => v >= 0);
  const keys = trees.map((v) => treeCacheKey(v, dense));
  const cached = await Promise.all(trees.map((v, i) => (keys[i] ? loadCachedVariant(keys[i]!, v) : null)));
  const prebuilt: (VariantAsset | null)[] = VARIANT_DEFS.map(() => null);
  trees.forEach((v, i) => { prebuilt[v] = cached[i]; });
  const missing = trees.filter((_, i) => !cached[i]);
  if (missing.length) {
    const built = await buildTreesInWorkers(dense, missing);
    if (built) for (const v of missing) prebuilt[v] = built[v];
  }
  const variants = await buildVariantAssetsSliced(8, undefined, dense, prebuilt);
  await Promise.all(trees.map((v, i) => (!cached[i] && keys[i] ? storeCachedVariant(keys[i]!, variants[v]) : null)));
  return variants;
}

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
  /** Tileable 3D noise the bark shader samples (barkNoise.ts). */
  readonly barkNoiseView: GPUTextureView;
  /**
   * Photoscanned bark arrays (barkScans.ts) and their repeating, anisotropic sampler. Where the scans are not used (low and medium tiers, no BC
   * compression, file missing) these are one-layer stand-ins, which tells the shader to keep the procedural bark.
   */
  readonly barkColourView: GPUTextureView;
  readonly barkSurfaceView: GPUTextureView;
  readonly barkSampler: GPUSampler;
  cullPipe!: GPUComputePipeline;
  finalizePipe!: GPUComputePipeline;
  /** One tree pipeline per LOD (the shader dithers a LOD in and out of its hand-over bands). */
  treePipes!: GPURenderPipeline[];
  rockPipe!: GPURenderPipeline;
  /** Resolves once the pipelines above have compiled (in the background, so the compile overlaps the later modules' start-up). */
  readonly ready: Promise<void>;
  private readonly atlas: GPUTexture;
  private readonly atlasData: GPUTexture;
  private readonly barkNoise: GPUTexture;
  private readonly barkTextures: GPUTexture[];
  /**
   * The leaf atlas sampler: trilinear, and at the extreme tier with 16x anisotropic filtering, so leaves seen at a slant keep their veins and teeth
   * instead of blurring (it cost about 1 ms of G-buffer at ultra, so the budgeted tiers keep plain trilinear filtering).
   */
  readonly leafSampler: GPUSampler;

  /** Whether the meshes carry the extreme tier's dense crowns (treeGen.ts FoliageOptions). */
  readonly dense: boolean;

  /**
   * Builds the meshes (read from the disk cache, treeCache.ts, or built on worker threads, treeBuildPool.ts, and otherwise on this thread)
   * and the leaf atlas (also cached) in time slices (the loading screen keeps painting), then the GPU objects.
   */
  static async create(rc: RenderContext): Promise<TreeAssets> {
    const dense = isExtreme(rc.quality);
    const tileSize = dense ? EXTREME_TILE_SIZE : TILE_SIZE, atlasKey = atlasCacheKey(tileSize);
    // The cached entries are read and inflated side by side (inflating runs off this thread), so a warm start waits for the largest only.
    // The budgeted tiers' meshes back placement checks and the ray-traced canopy fits (variantLods); at the extreme tier they are the plain
    // set next to the dense one, so they come from the cache too instead of being built again on every start.
    const [variants, cachedPlain, cachedAtlas] = await Promise.all([cachedVariants(dense), dense ? cachedVariants(false) : null, atlasKey ? loadCachedAtlas(atlasKey) : null]);
    const plain = cachedPlain ?? variants;
    seedVariantLods(plain);
    let atlas = cachedAtlas;
    if (!atlas) {
      atlas = await buildLeafAtlasSliced(8, undefined, tileSize);
      if (atlasKey) await storeCachedAtlas(atlasKey, atlas);
    }
    const noise = await buildBarkNoiseSliced();
    const skip = scanMipSkip(rc.quality.tier);
    const scans = skip !== null && rc.features.has('texture-compression-bc') ? await loadBarkScans() : null;
    return new TreeAssets(rc, variants, atlas, noise, dense, scans);
  }

  private constructor(rc: RenderContext, variants: VariantAsset[], atlas: LeafAtlas, barkNoise: Uint8Array, dense: boolean, scans: BarkScans | null) {
    const dev = rc.device;
    this.variants = variants;
    this.dense = dense;
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
      const W = atlas.tileSize * TILES_X, H = atlas.tileSize * TILES_Y;
      const tex = dev.createTexture({ label, size: [W, H], mipLevelCount: atlasMips(atlas.tileSize), format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      levels.forEach((data, level) => {
        const w = W >> level, h = H >> level;
        dev.queue.writeTexture({ texture: tex, mipLevel: level }, data, { bytesPerRow: w * 4 }, [w, h]);
      });
      return tex;
    };
    this.atlas = atlasTexture('leaf-atlas-colour', atlas.colour);
    this.atlasData = atlasTexture('leaf-atlas-data', atlas.data);
    this.atlasView = this.atlas.createView();
    this.leafSampler = dev.createSampler({ label: 'leaf-atlas', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', maxAnisotropy: dense ? 16 : 1 });
    this.atlasDataView = this.atlasData.createView();
    const n = BARK_NOISE_SIZE;
    this.barkNoise = dev.createTexture({ label: 'bark-noise', size: [n, n, n], dimension: '3d', format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    dev.queue.writeTexture({ texture: this.barkNoise }, barkNoise, { bytesPerRow: n * 4, rowsPerImage: n }, [n, n, n]);
    this.barkNoiseView = this.barkNoise.createView({ dimension: '3d' });
    if (scans) {
      const t = uploadBarkScans(dev, scans, scanMipSkip(rc.quality.tier) ?? 0);
      this.barkTextures = [t.colour, t.surface];
    } else {
      const stand = (label: string): GPUTexture => {
        const t = dev.createTexture({ label, size: [1, 1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
        dev.queue.writeTexture({ texture: t }, new Uint8Array([128, 128, 128, 255]), { bytesPerRow: 4 }, [1, 1, 1]);
        return t;
      };
      this.barkTextures = [stand('bark-scans-none-colour'), stand('bark-scans-none-surface')];
    }
    this.barkColourView = this.barkTextures[0].createView({ dimension: '2d-array' });
    this.barkSurfaceView = this.barkTextures[1].createView({ dimension: '2d-array' });
    this.barkSampler = dev.createSampler({ label: 'bark-scans', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat', maxAnisotropy: dense ? 16 : 8 });

    const C = GPUShaderStage.COMPUTE, V = GPUShaderStage.VERTEX, F = GPUShaderStage.FRAGMENT;
    const buffer = (binding: number, visibility: number, type: GPUBufferBindingType): GPUBindGroupLayoutEntry => ({ binding, visibility, buffer: { type } });
    this.drawLayout = dev.createBindGroupLayout({
      label: 'tree-draw',
      entries: [
        buffer(0, V | F, 'uniform'), buffer(1, V | F, 'read-only-storage'), buffer(2, V, 'read-only-storage'), buffer(3, V | F, 'read-only-storage'),
        { binding: 4, visibility: F, texture: { sampleType: 'float' } },
        { binding: 5, visibility: F, texture: { sampleType: 'float' } },
        { binding: 6, visibility: V | F, texture: { sampleType: 'float', viewDimension: '3d' } },
        { binding: 7, visibility: F, sampler: { type: 'filtering' } },
        { binding: 8, visibility: V | F, texture: { sampleType: 'float', viewDimension: '2d-array' } },
        { binding: 9, visibility: V | F, texture: { sampleType: 'float', viewDimension: '2d-array' } },
        { binding: 10, visibility: V | F, sampler: { type: 'filtering' } },
        buffer(11, F, 'read-only-storage'),
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
    const cullPending = dev.createComputePipelineAsync({ label: 'tree-cull', layout: layout(this.cullLayout), compute: { module: cull, entryPoint: 'cull' } });
    const finalizePending = dev.createComputePipelineAsync({ label: 'tree-finalize', layout: layout(this.finalizeLayout), compute: { module: fin, entryPoint: 'finalize' } });
    const draw = (label: string, file: string, constants?: Record<string, number>): Promise<GPURenderPipeline> => {
      const module = rc.module(file);
      return dev.createRenderPipelineAsync({
        label,
        layout: layout(this.drawLayout),
        vertex: { module, entryPoint: 'vs', buffers: [VERTEX_LAYOUT], constants },
        fragment: { module, entryPoint: 'fs', targets: GBUFFER_TARGETS },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: DEPTH_STATE,
      });
    };
    this.ready = Promise.all([cullPending, finalizePending, draw('rock-draw', 'vegetation/rock.wgsl'), ...[0, 1, 2].map((lod) => draw(`tree-draw-lod${lod}`, 'vegetation/tree.wgsl', { LOD: lod }))])
      .then(([cullPipe, finalizePipe, rockPipe, ...treePipes]) => {
        this.cullPipe = cullPipe; this.finalizePipe = finalizePipe; this.rockPipe = rockPipe; this.treePipes = treePipes;
      });
  }

  /** True for draws that use the rock pipeline. */
  isRockDraw(k: number): boolean {
    return isRockVariant(Math.floor(k / LOD_COUNT));
  }

  destroy(): void {
    this.vertexBuffer.destroy();
    this.indexBuffer.destroy();
    this.atlas.destroy();
    this.atlasData.destroy();
    this.barkNoise.destroy();
    for (const t of this.barkTextures) t.destroy();
  }
}
